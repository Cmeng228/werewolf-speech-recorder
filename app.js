const STORAGE_KEY = "werewolfSpeechRecorder:simple:v1";
const LEGACY_STORAGE_KEY = "werewolfSpeechRecorder:v1";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const phaseNames = {
  police: "警上发言",
  day: "白天发言",
  vote: "投票发言",
  other: "补充记录"
};

const sourceNames = {
  manual: "手记",
  voice: "语音"
};

const seatCountOptions = [6, 7, 8, 9, 10, 12, 20];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let state = loadState();
let recognition = null;
let speechListening = false;

const els = {
  sessionTitle: $("#sessionTitle"),
  exportMdBtn: $("#exportMdBtn"),
  exportJsonBtn: $("#exportJsonBtn"),
  importBtn: $("#importBtn"),
  importFile: $("#importFile"),
  dayTabs: $("#dayTabs"),
  addDayBtn: $("#addDayBtn"),
  activeSeatLabel: $("#activeSeatLabel"),
  seatCountSelect: $("#seatCountSelect"),
  seatGrid: $("#seatGrid"),
  activeSeatNameInput: $("#activeSeatNameInput"),
  phaseButtons: $$(".phase-bar button"),
  manualSeatSelect: $("#manualSeatSelect"),
  manualText: $("#manualText"),
  addManualBtn: $("#addManualBtn"),
  searchInput: $("#searchInput"),
  filterSeatSelect: $("#filterSeatSelect"),
  filterDaySelect: $("#filterDaySelect"),
  entryList: $("#entryList"),
  transcribeStatus: $("#transcribeStatus"),
  mobileTranscribeStatus: $("#mobileTranscribeStatus"),
  autoSeatToggle: $("#autoSeatToggle"),
  startListenBtn: $("#startListenBtn"),
  stopListenBtn: $("#stopListenBtn"),
  mobileStartListenBtn: $("#mobileStartListenBtn"),
  mobileStopListenBtn: $("#mobileStopListenBtn"),
  interimText: $("#interimText"),
  entryTemplate: $("#entryTemplate")
};

init();

function defaultState() {
  return {
    sessionTitle: `狼人杀发言记录 ${new Date().toLocaleDateString("zh-CN")}`,
    seatCount: 12,
    currentDay: 0,
    currentPhase: "police",
    activeSeatId: 1,
    filters: {
      seat: "all",
      day: "current",
      search: ""
    },
    settings: {
      autoSeatByPrefix: true
    },
    days: [
      { id: 0, label: "警上" },
      { id: 1, label: "第1天" }
    ],
    seats: makeSeats(20),
    entries: []
  };
}

function makeSeats(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: ""
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return defaultState();
    return migrateState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

function migrateState(input = {}) {
  const base = defaultState();
  const incomingSeats = Array.isArray(input.seats) ? input.seats : [];
  const maxSeatId = Math.max(
    20,
    Number(input.seatCount) || base.seatCount,
    ...incomingSeats.map((seat) => Number(seat.id) || 0)
  );
  const seatsById = new Map(incomingSeats.map((seat) => [Number(seat.id), seat]));
  const seats = Array.from({ length: maxSeatId }, (_, index) => {
    const id = index + 1;
    const seat = seatsById.get(id) || {};
    return {
      id,
      name: String(seat.name || "")
    };
  });

  const days = normalizeDays(input.days);
  const seatCount = normalizeSeatCount(input.seatCount || base.seatCount);
  const currentDay = days.some((day) => day.id === Number(input.currentDay)) ? Number(input.currentDay) : 0;
  const currentPhase = phaseNames[input.currentPhase] ? input.currentPhase : currentDay === 0 ? "police" : "day";
  const activeSeatId = clamp(Number(input.activeSeatId || input.selectedSeatId || 1), 1, seatCount);

  return {
    ...base,
    sessionTitle: String(input.sessionTitle || base.sessionTitle),
    seatCount,
    currentDay,
    currentPhase,
    activeSeatId,
    filters: {
      ...base.filters,
      ...(input.filters || {})
    },
    settings: {
      ...base.settings,
      ...(input.settings || {})
    },
    days,
    seats,
    entries: normalizeEntries(input.entries, seatCount)
  };
}

function normalizeDays(days) {
  const inputDays = Array.isArray(days) ? days : [];
  const merged = new Map([
    [0, { id: 0, label: "警上" }],
    [1, { id: 1, label: "第1天" }]
  ]);

  inputDays.forEach((day) => {
    const id = Number(day.id);
    if (!Number.isFinite(id) || id < 0) return;
    merged.set(id, {
      id,
      label: String(day.label || makeDayLabel(id))
    });
  });

  return Array.from(merged.values()).sort((left, right) => left.id - right.id);
}

function normalizeEntries(entries, seatCount) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      id: entry.id || makeId(),
      dayId: Number(entry.dayId) || 0,
      phase: phaseNames[entry.phase] ? entry.phase : "other",
      seatId: clamp(Number(entry.seatId) || 1, 1, seatCount),
      text: String(entry.text || "").trim(),
      source: entry.source === "manual" ? "manual" : "voice",
      createdAt: entry.createdAt || new Date().toISOString()
    }))
    .filter((entry) => entry.text);
}

function normalizeSeatCount(value) {
  const count = Number(value);
  return seatCountOptions.includes(count) ? count : 12;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function init() {
  bindEvents();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function bindEvents() {
  els.sessionTitle.addEventListener("input", () => {
    state.sessionTitle = els.sessionTitle.value;
    saveState();
  });

  els.exportMdBtn.addEventListener("click", exportMarkdown);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", importJson);

  els.addDayBtn.addEventListener("click", () => {
    const nextId = Math.max(1, ...state.days.map((day) => day.id).filter((id) => id > 0)) + 1;
    state.days.push({ id: nextId, label: makeDayLabel(nextId) });
    state.currentDay = nextId;
    state.currentPhase = "day";
    state.filters.day = "current";
    saveAndRender();
  });

  els.seatCountSelect.addEventListener("change", () => {
    state.seatCount = normalizeSeatCount(els.seatCountSelect.value);
    state.activeSeatId = clamp(state.activeSeatId, 1, state.seatCount);
    saveAndRender();
  });

  els.activeSeatNameInput.addEventListener("input", () => {
    const seat = getSeat(state.activeSeatId);
    seat.name = els.activeSeatNameInput.value.trim();
    saveAndRender();
  });

  els.phaseButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentPhase = button.dataset.phase;
      if (state.currentPhase === "police") {
        state.currentDay = 0;
      } else if (state.currentDay === 0) {
        state.currentDay = 1;
      }
      state.filters.day = "current";
      saveAndRender();
    });
  });

  els.manualSeatSelect.addEventListener("change", () => {
    setActiveSeat(Number(els.manualSeatSelect.value));
  });

  els.addManualBtn.addEventListener("click", () => {
    const text = els.manualText.value.trim();
    if (!text) return;
    addEntryFromText(text, "manual", Number(els.manualSeatSelect.value));
    els.manualText.value = "";
  });

  els.manualText.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      els.addManualBtn.click();
    }
  });

  els.searchInput.addEventListener("input", () => {
    state.filters.search = els.searchInput.value.trim();
    saveAndRender();
  });

  els.filterSeatSelect.addEventListener("change", () => {
    state.filters.seat = els.filterSeatSelect.value;
    saveAndRender();
  });

  els.filterDaySelect.addEventListener("change", () => {
    state.filters.day = els.filterDaySelect.value;
    saveAndRender();
  });

  els.autoSeatToggle.addEventListener("change", () => {
    state.settings.autoSeatByPrefix = els.autoSeatToggle.checked;
    saveState();
  });

  els.startListenBtn.addEventListener("click", startListening);
  els.stopListenBtn.addEventListener("click", stopListening);
  els.mobileStartListenBtn.addEventListener("click", startListening);
  els.mobileStopListenBtn.addEventListener("click", stopListening);
}

function saveAndRender() {
  saveState();
  render();
}

function render() {
  document.body.classList.toggle("is-listening", speechListening);
  els.sessionTitle.value = state.sessionTitle;
  els.seatCountSelect.value = String(state.seatCount);
  els.autoSeatToggle.checked = Boolean(state.settings.autoSeatByPrefix);

  renderDays();
  renderPhase();
  renderSeats();
  renderSelects();
  renderEntries();
  renderTranscribeStatus();
}

function renderDays() {
  const tabs = state.days.map((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `day-tab${day.id === state.currentDay ? " active" : ""}`;
    button.textContent = day.label;
    button.addEventListener("click", () => {
      state.currentDay = day.id;
      state.currentPhase = day.id === 0 ? "police" : state.currentPhase === "police" ? "day" : state.currentPhase;
      state.filters.day = "current";
      saveAndRender();
    });
    return button;
  });

  els.dayTabs.replaceChildren(...tabs);
}

function renderPhase() {
  els.phaseButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.phase === state.currentPhase);
  });
}

function renderSeats() {
  const activeSeat = getSeat(state.activeSeatId);
  els.activeSeatLabel.textContent = `正在记录：${seatLabel(activeSeat.id)}`;
  els.activeSeatNameInput.value = activeSeat.name || "";

  const cards = activeSeats().map((seat) => {
    const button = document.createElement("button");
    const count = state.entries.filter((entry) => entry.seatId === seat.id).length;
    button.type = "button";
    button.className = `seat-card${seat.id === state.activeSeatId ? " active" : ""}`;
    button.addEventListener("click", () => setActiveSeat(seat.id));
    button.innerHTML = `
      <span class="seat-no">${seat.id}号</span>
      <span class="seat-name">${escapeHtml(seat.name || "未命名")}</span>
      <span class="seat-count">${count} 条</span>
    `;
    return button;
  });

  els.seatGrid.replaceChildren(...cards);
}

function renderSelects() {
  const seatOptions = activeSeats().map((seat) => option(String(seat.id), seatLabel(seat.id)));

  els.manualSeatSelect.replaceChildren(...seatOptions.map((item) => item.cloneNode(true)));
  els.manualSeatSelect.value = String(state.activeSeatId);

  els.filterSeatSelect.replaceChildren(
    option("all", "全部席位"),
    ...seatOptions.map((item) => item.cloneNode(true))
  );
  els.filterSeatSelect.value = state.filters.seat;

  els.filterDaySelect.replaceChildren(
    option("current", "当前天"),
    option("all", "全部天"),
    ...state.days.map((day) => option(String(day.id), day.label))
  );
  els.filterDaySelect.value = state.filters.day;
  els.searchInput.value = state.filters.search;
}

function renderEntries() {
  const entries = filteredEntries();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无发言记录";
    els.entryList.replaceChildren(empty);
    return;
  }

  const nodes = entries.map((entry) => {
    const node = els.entryTemplate.content.firstElementChild.cloneNode(true);
    const seat = getSeat(entry.seatId);
    const day = state.days.find((item) => item.id === entry.dayId);
    $(".entry-meta", node).innerHTML = `
      <strong>${escapeHtml(seatLabel(seat.id))}</strong>
      <span>${escapeHtml(day?.label || makeDayLabel(entry.dayId))}</span>
      <span>${escapeHtml(phaseNames[entry.phase] || phaseNames.other)}</span>
      <span>${escapeHtml(formatTime(entry.createdAt))}</span>
      <span>${escapeHtml(sourceNames[entry.source] || "记录")}</span>
    `;
    $(".entry-text", node).textContent = entry.text;

    const editor = $(".entry-editor", node);
    editor.value = entry.text;

    $(".copy-entry", node).addEventListener("click", () => {
      navigator.clipboard?.writeText(`${seatLabel(seat.id)}：${entry.text}`).catch(() => {});
    });

    $(".edit-entry", node).addEventListener("click", (event) => {
      if (node.classList.contains("editing")) {
        entry.text = editor.value.trim() || entry.text;
        node.classList.remove("editing");
        event.currentTarget.textContent = "编辑";
        saveAndRender();
        return;
      }

      node.classList.add("editing");
      event.currentTarget.textContent = "保存";
      editor.focus();
    });

    $(".delete-entry", node).addEventListener("click", () => {
      state.entries = state.entries.filter((item) => item.id !== entry.id);
      saveAndRender();
    });

    return node;
  });

  els.entryList.replaceChildren(...nodes);
}

function renderTranscribeStatus(message = "") {
  let statusText;
  if (message) {
    statusText = message;
  } else if (speechListening) {
    statusText = "正在转文字";
  } else if (!SpeechRecognition) {
    statusText = "当前浏览器不支持";
  } else {
    statusText = "待启动";
  }

  els.transcribeStatus.textContent = statusText;
  els.mobileTranscribeStatus.textContent = statusText;
  els.startListenBtn.disabled = !SpeechRecognition || speechListening;
  els.stopListenBtn.disabled = !speechListening;
  els.mobileStartListenBtn.disabled = !SpeechRecognition || speechListening;
  els.mobileStopListenBtn.disabled = !speechListening;
}

function filteredEntries() {
  const search = state.filters.search.toLowerCase();
  return [...state.entries]
    .filter((entry) => {
      if (state.filters.day === "current" && entry.dayId !== state.currentDay) return false;
      if (state.filters.day !== "all" && state.filters.day !== "current" && entry.dayId !== Number(state.filters.day)) return false;
      if (state.filters.seat !== "all" && entry.seatId !== Number(state.filters.seat)) return false;
      if (search) {
        const haystack = `${entry.text} ${seatLabel(entry.seatId)} ${phaseNames[entry.phase] || ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function activeSeats() {
  ensureSeatCapacity(state.seatCount);
  return state.seats.slice(0, state.seatCount);
}

function ensureSeatCapacity(count) {
  while (state.seats.length < count) {
    state.seats.push({ id: state.seats.length + 1, name: "" });
  }
}

function getSeat(id) {
  ensureSeatCapacity(Math.max(Number(id) || 1, state.seatCount));
  return state.seats.find((seat) => seat.id === Number(id)) || state.seats[0];
}

function seatLabel(id) {
  const seat = getSeat(id);
  return `${seat.id}号${seat.name ? ` · ${seat.name}` : ""}`;
}

function setActiveSeat(id) {
  state.activeSeatId = clamp(Number(id) || 1, 1, state.seatCount);
  saveAndRender();
}

function addEntryFromText(rawText, source = "voice", fallbackSeatId = state.activeSeatId) {
  const parsed = state.settings.autoSeatByPrefix ? detectSeatPrefix(rawText) : null;
  const seatId = clamp(parsed?.seatId || fallbackSeatId || state.activeSeatId, 1, state.seatCount);
  const text = (parsed?.text || rawText).trim();
  if (!text) return;

  state.activeSeatId = seatId;
  state.entries.push({
    id: makeId(),
    dayId: state.currentDay,
    phase: state.currentPhase,
    seatId,
    text,
    source,
    createdAt: new Date().toISOString()
  });
  saveAndRender();
}

function startListening() {
  if (!SpeechRecognition) {
    renderTranscribeStatus("当前浏览器不支持");
    return;
  }

  stopListening();
  speechListening = true;
  recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0]?.transcript?.trim() || "";
      if (!text) continue;

      if (result.isFinal) {
        addEntryFromText(text, "voice");
      } else {
        interim += text;
      }
    }
    els.interimText.textContent = interim;
  };

  recognition.onerror = (event) => {
    const message = event.error === "not-allowed" ? "麦克风未授权" : "转写中断";
    renderTranscribeStatus(message);
  };

  recognition.onend = () => {
    if (!speechListening || !recognition) return;
    window.setTimeout(() => {
      if (!speechListening || !recognition) return;
      try {
        recognition.start();
      } catch {
        renderTranscribeStatus("转写重启中");
      }
    }, 300);
  };

  try {
    recognition.start();
    renderTranscribeStatus();
  } catch {
    renderTranscribeStatus("转写已启动");
  }
}

function stopListening() {
  speechListening = false;
  if (recognition) {
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {}
    recognition = null;
  }
  els.interimText.textContent = "";
  renderTranscribeStatus();
}

function detectSeatPrefix(text) {
  const match = text
    .trim()
    .match(/^(?:第?\s*)?([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*号(?:玩家|位)?[，,:：、\s]*(.*)$/);

  if (!match) return null;

  const seatId = parseSeatNumber(match[1]);
  if (!seatId || seatId < 1 || seatId > state.seatCount) return null;

  return {
    seatId,
    text: match[2].trim()
  };
}

function parseSeatNumber(value) {
  const text = String(value).trim().replaceAll("两", "二");
  if (/^\d+$/.test(text)) return Number(text);

  const digits = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };

  if (text === "十") return 10;
  if (text.startsWith("十")) return 10 + (digits[text[1]] || 0);
  if (text.endsWith("十")) return (digits[text[0]] || 0) * 10;
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (digits[tens] || 0) * 10 + (digits[ones] || 0);
  }
  return digits[text] || 0;
}

function exportJson() {
  downloadFile(
    `${safeFileName(state.sessionTitle)}.json`,
    JSON.stringify(state, null, 2),
    "application/json"
  );
}

function exportMarkdown() {
  const lines = [`# ${state.sessionTitle}`, ""];
  for (const day of state.days) {
    lines.push(`## ${day.label}`, "");
    const entries = state.entries
      .filter((entry) => entry.dayId === day.id)
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));

    if (!entries.length) {
      lines.push("- 暂无发言记录", "");
      continue;
    }

    for (const entry of entries) {
      lines.push(
        `- ${formatTime(entry.createdAt)} ${phaseNames[entry.phase] || phaseNames.other} ${seatLabel(entry.seatId)}：${entry.text}`
      );
    }
    lines.push("");
  }

  downloadFile(`${safeFileName(state.sessionTitle)}.md`, lines.join("\n"), "text/markdown");
}

async function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    state = migrateState(JSON.parse(text));
    saveAndRender();
    renderTranscribeStatus("导入成功");
  } catch {
    renderTranscribeStatus("导入失败");
  } finally {
    event.target.value = "";
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function makeDayLabel(id) {
  return id === 0 ? "警上" : `第${id}天`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeFileName(value) {
  return (value || "werewolf-speech-records").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
