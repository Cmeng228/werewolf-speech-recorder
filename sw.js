self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("werewolf-speech-recorder-v2").then((cache) =>
      cache.addAll([
        "./",
        "./index.html",
        "./styles.css",
        "./app.js",
        "./boards-config.json",
        "./manifest.webmanifest"
      ])
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
