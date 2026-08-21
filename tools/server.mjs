import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 5186);
const maxUploadBytes = 26 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function json(res, statusCode, data) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function getStaticPath(url) {
  const pathname = decodeURIComponent(url.pathname);
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const target = resolve(root, `.${filePath}`);
  if (!target.startsWith(root)) {
    return null;
  }
  return target;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxUploadBytes) {
      throw new Error("UPLOAD_TOO_LARGE");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function extensionFromContentType(contentType) {
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

async function transcribeAudio(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    json(res, 501, {
      ok: false,
      error: "OPENAI_API_KEY is not configured"
    });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error.message === "UPLOAD_TOO_LARGE") {
      json(res, 413, {
        ok: false,
        error: "Audio chunk is too large"
      });
      return;
    }
    throw error;
  }

  if (!body.length) {
    json(res, 400, {
      ok: false,
      error: "Missing audio body"
    });
    return;
  }

  const contentType = req.headers["content-type"] || "audio/webm";
  const model = process.env.TRANSCRIBE_MODEL || "whisper-1";
  const form = new FormData();
  form.append("model", model);
  form.append("language", "zh");
  form.append("response_format", "json");
  form.append(
    "file",
    new Blob([body], { type: contentType }),
    `chunk.${extensionFromContentType(contentType)}`
  );

  const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    json(res, upstream.status, {
      ok: false,
      error: text
    });
    return;
  }

  const parsed = JSON.parse(text);
  json(res, 200, {
    ok: true,
    text: parsed.text || ""
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/config") {
      json(res, 200, {
        ok: true,
        transcribeConfigured: Boolean(process.env.OPENAI_API_KEY),
        model: process.env.TRANSCRIBE_MODEL || "whisper-1"
      });
      return;
    }

    if (url.pathname === "/api/transcribe" && req.method === "POST") {
      await transcribeAudio(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      json(res, 405, {
        ok: false,
        error: "Method not allowed"
      });
      return;
    }

    const target = getStaticPath(url);
    if (!target) {
      json(res, 403, {
        ok: false,
        error: "Forbidden"
      });
      return;
    }

    const info = await stat(target);
    if (!info.isFile()) {
      json(res, 404, {
        ok: false,
        error: "Not found"
      });
      return;
    }

    res.writeHead(200, {
      "content-type": mimeTypes[extname(target)] || "application/octet-stream",
      "cache-control": "no-cache"
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    res.end(await readFile(target));
  } catch (error) {
    if (error.code === "ENOENT") {
      json(res, 404, {
        ok: false,
        error: "Not found"
      });
      return;
    }

    console.error(error);
    json(res, 500, {
      ok: false,
      error: error.message || "Server error"
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Werewolf speech recorder: http://127.0.0.1:${port}`);
});
