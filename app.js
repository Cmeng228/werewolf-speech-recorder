const STORAGE_KEY = "werewolfSpeechRecorder:v1";
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const phaseNames = {
  police: "警上发言",
  day: "白天",
  night: "夜晚",
  vote: "投票",
  other: "补充"
};

const statusNames = {
  alive: "在场",
  dead: "出局",
  suspect: "重点",
  trusted: "偏好"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const commonRoleOptions = [
  { id: "camp:good", name: "好人", camp: "判断" },
  { id: "camp:god", name: "神职", camp: "判断" },
  { id: "camp:villager", name: "平民", camp: "判断" },
  { id: "camp:wolf", name: "狼人", camp: "判断" },
  { id: "camp:special", name: "特殊身份", camp: "判断" }
];

let state = loadState();
let boardConfig = {
  roleOptions: [],
  boards: []
};
let recognition = null;
let speechListening = false;
let mediaRecorder = null;
let mediaStream = null;
let audioContext = null;
let analyser = null;
let animationFrame = 0;
let transcribeQueue = Promise.resolve();
let serverConfig = {
  transcribeConfigured: false,
  model: "whisper-1"
};

const els = {
  sessionTitle: $("#sessionTitle"),
  compactModeBtn: $("#compactModeBtn"),
  exportMdBtn: $("#exportMdBtn"),
  exportJsonBtn: $("#exportJsonBtn"),
  importBtn: $("#importBtn"),
  importFile: $("#importFile"),
  dayTabs: $("#dayTabs"),
  addDayBtn: $("#addDayBtn"),
  activeSeatLabel: $("#activeSeatLabel"),
  seatCountSelect: $("#seatCountSelect"),
  boardSelect: $("#boardSelect"),
  boardSummary: $("#boardSummary"),
  rolePool: $("#rolePool"),
  seatGrid: $("#seatGrid"),
  phaseButtons: $$(".phase-bar button"),
  manualSeatSelect: $("#manualSeatSelect"),
  manualText: $("#manualText"),
  addManualBtn: $("#addManualBtn"),
  searchInput: $("#searchInput"),
  filterSeatSelect: $("#filterSeatSelect"),
  filterDaySelect: $("#filterDaySelect"),
  entryList: $("#entryList"),
  speakerHint: $("#speakerHint"),
  speakerButtons: $("#speakerButtons"),
  transcribeStatus: $("#transcribeStatus"),
  autoSeatToggle: $("#autoSeatToggle"),
  serverModeToggle: $("#serverModeToggle"),
  audioDeviceSelect: $("#audioDeviceSelect"),
  levelFill: $("#levelFill"),
  startListenBtn: $("#startListenBtn"),
  stopListenBtn: $("#stopListenBtn"),
  interimText: $("#interimText"),
  noteSeatLabel: $("#noteSeatLabel"),
  clearRolesBtn: $("#clearRolesBtn"),
  playerNameInput: $("#playerNameInput"),
  playerRoleInput: $("#playerRoleInput"),
  playerStatusInput: $("#playerStatusInput"),
  playerNoteInput: $("#playerNoteInput"),
  entryTemplate: $("#entryTemplate")
};

init();

function defaultState() {
  const seats = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    name: "",
    role: "",
    roleId: "",
    status: "alive",
    note: ""
  }));

  return {
    sessionTitle: `狼人杀对局 ${new Date().toLocaleDateString("zh-CN")}`,
    seatCount: 12,
    currentBoardId: "",
    currentDay: 0,
    currentPhase: "police",
    activeSeatId: 1,
    selectedSeatId: 1,
    filters: {
      seat: "all",
      day: "current",
      search: ""
    },
    settings: {
      compact: false,
      autoSeatByPrefix: true,
      serverMode: false,
      chunkSeconds: 9
    },
    days: [
      {
        id: 0,
        label: "警上"
      },
      {
        id: 1,
        label: "第1天"
      }
    ],
    seats,
    entries: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return migrateState(parsed);
  } catch {
    return defaultState();
  }
}

function migrateState(input) {
  const base = defaultState();
  const incomingSeats = Array.isArray(input.seats) ? input.seats : [];
  const maxSeatId = Math.max(20, ...incomingSeats.map((seat) => Number(seat.id) || 0));
  const merged = {
    ...base,
    ...input,
    filters: {
      ...base.filters,
      ...(input.filters || {})
    },
    settings: {
      ...base.settings,
      ...(input.settings || {})
    }
  };

  const seatsById = new Map(incomingSeats.map((seat) => [Number(seat.id), seat]));
  merged.seats = Array.from({ length: maxSeatId }, (_, index) => {
    const id = index + 1;
    const seat = {
      id,
      name: "",
      role: "",
      roleId: "",
      status: "alive",
      note: ""
    };
    return {
      ...seat,
      ...(seatsById.get(id) || {})
    };
  });

  const days = Array.isArray(input.days) && input.days.length ? input.days : base.days;
  const hasPoliceDay = days.some((day) => Number(day.id) === 0);
  const hasFirstDay = days.some((day) => Number(day.id) === 1);
  merged.days = [
    ...(hasPoliceDay ? [] : [{ id: 0, label: "警上" }]),
    ...(hasFirstDay ? [] : [{ id: 1, label: "第1天" }]),
    ...days
  ]
    .map((day) => ({
      id: Number(day.id),
      label: day.label || (Number(day.id) === 0 ? "警上" : `第${Number(day.id)}天`)
    }))
    .sort((left, right) => left.id - right.id);
  merged.entries = Array.isArray(input.entries) ? input.entries : [];
  return merged;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function init() {
  bindEvents();
  await loadServerConfig();
  await loadBoardConfig();
  normalizeBoardSelection();
  render();
  await refreshAudioDevices(false);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function bindEvents() {
  els.sessionTitle.addEventListener("input", () => {
    state.sessionTitle = els.sessionTitle.value;
    saveState();
  });

  els.compactModeBtn.addEventListener("click", () => {
    state.settings.compact = !state.settings.compact;
    saveAndRender();
  });

  els.exportMdBtn.addEventListener("click", exportMarkdown);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", importJson);

  els.addDayBtn.addEventListener("click", () => {
    const nextId = Math.max(1, ...state.days.map((day) => day.id).filter((id) => id > 0)) + 1;
    state.days.push({
      id: nextId,
      label: `第${nextId}天`
    });
    state.currentDay = nextId;
    state.filters.day = "current";
    saveAndRender();
  });

  els.seatCountSelect.addEventListener("change", () => {
    state.seatCount = Number(els.seatCountSelect.value);
    state.currentBoardId = "";
    if (state.activeSeatId > state.seatCount) state.activeSeatId = 1;
    if (state.selectedSeatId > state.seatCount) state.selectedSeatId = 1;
    saveAndRender();
  });

  els.boardSelect.addEventListener("change", () => {
    applyBoard(els.boardSelect.value);
    saveAndRender();
  });

  els.phaseButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.currentPhase = button.dataset.phase;
      if (state.currentPhase === "police") {
        state.currentDay = 0;
        state.filters.day = "current";
      } else if (state.currentDay === 0) {
        state.currentDay = 1;
        state.filters.day = "current";
      }
      saveAndRender();
    });
  });

  els.manualSeatSelect.addEventListener("change", () => {
    state.activeSeatId = Number(els.manualSeatSelect.value);
    state.selectedSeatId = state.activeSeatId;
    saveAndRender();
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

  els.serverModeToggle.addEventListener("change", () => {
    state.settings.serverMode = els.serverModeToggle.checked;
    saveAndRender();
  });

  els.audioDeviceSelect.addEventListener("focus", () => refreshAudioDevices(true));
  els.audioDeviceSelect.addEventListener("change", () => {
    if (mediaRecorder) {
      stopListening();
      startListening();
    }
  });

  els.startListenBtn.addEventListener("click", startListening);
  els.stopListenBtn.addEventListener("click", stopListening);

  els.clearRolesBtn.addEventListener("click", () => {
    activeSeats().forEach((seat) => {
      seat.role = "";
      seat.roleId = "";
    });
    saveAndRender();
  });

  els.playerNameInput.addEventListener("input", updateSelectedSeat);
  els.playerRoleInput.addEventListener("change", updateSelectedSeat);
  els.playerStatusInput.addEventListener("change", updateSelectedSeat);
  els.playerNoteInput.addEventListener("input", updateSelectedSeat);
}

async function loadServerConfig() {
  try {
    const response = await fetch("./api/config");
    if (response.ok) {
      serverConfig = await response.json();
    }
  } catch {
    serverConfig = {
      transcribeConfigured: false,
      model: "whisper-1"
    };
  }
}

async function loadBoardConfig() {
  try {
    const response = await fetch(`./boards-config.json?v=${Date.now()}`);
    if (!response.ok) return;
    const data = await response.json();
    boardConfig = {
      roleOptions: Array.isArray(data.roleOptions) ? data.roleOptions : [],
      boards: Array.isArray(data.boards) ? data.boards : []
    };
  } catch {
    boardConfig = {
      roleOptions: [],
      boards: []
    };
  }
}

function normalizeBoardSelection() {
  if (!boardConfig.boards.length) return;
  if (state.currentBoardId && getBoard(state.currentBoardId)) return;
  const standardBoard =
    boardConfig.boards.find((board) => board.name === "12人标准场") ||
    boardConfig.boards.find((board) => board.seatCount === state.seatCount) ||
    boardConfig.boards[0];
  state.currentBoardId = standardBoard?.id || "";
  saveState();
}

function getBoard(id = state.currentBoardId) {
  return boardConfig.boards.find((board) => String(board.id) === String(id)) || null;
}

function applyBoard(boardId) {
  const board = getBoard(boardId);
  if (!board) {
    state.currentBoardId = "";
    return;
  }

  state.currentBoardId = board.id;
  state.seatCount = board.seatCount || state.seatCount;
  if (state.activeSeatId > state.seatCount) state.activeSeatId = 1;
  if (state.selectedSeatId > state.seatCount) state.selectedSeatId = 1;

  const allowedRoleIds = new Set(boardRoleOptions(board).map((role) => String(role.id)));
  state.seats.forEach((seat) => {
    if (!seat.roleId) return;
    if (!allowedRoleIds.has(String(seat.roleId))) {
      seat.role = "";
      seat.roleId = "";
    }
  });
}

function saveAndRender() {
  saveState();
  render();
}

function render() {
  document.body.classList.toggle("compact", state.settings.compact);
  els.sessionTitle.value = state.sessionTitle;
  els.seatCountSelect.value = String(state.seatCount);
  els.boardSelect.value = state.currentBoardId || "";
  els.autoSeatToggle.checked = state.settings.autoSeatByPrefix;
  els.serverModeToggle.checked = state.settings.serverMode;
  els.compactModeBtn.classList.toggle("active", state.settings.compact);
  els.compactModeBtn.textContent = state.settings.compact ? "展开" : "紧凑";
  els.serverModeToggle.disabled = !serverConfig.transcribeConfigured;

  renderDays();
  renderBoardControls();
  renderPhase();
  renderSeats();
  renderSelects();
  renderSpeakerButtons();
  renderSelectedSeat();
  renderEntries();
  renderTranscribeStatus();
}

function activeSeats() {
  return state.seats.slice(0, state.seatCount);
}

function getSeat(id) {
  return state.seats.find((seat) => seat.id === Number(id)) || state.seats[0];
}

function seatLabel(id) {
  const seat = getSeat(id);
  return `${seat.id}号${seat.name ? ` · ${seat.name}` : ""}`;
}

function getRoleById(roleId) {
  const id = String(roleId);
  return (
    boardConfig.roleOptions.find((role) => String(role.id) === id) ||
    getBoard()?.roleOptions?.find((role) => String(role.id) === id) ||
    null
  );
}

function seatRoleLabel(seat) {
  if (seat.roleId) {
    return getRoleById(seat.roleId)?.name || seat.role || `角色${seat.roleId}`;
  }
  return seat.role || "";
}

function boardRoleOptions(board = getBoard()) {
  if (!board) return boardConfig.roleOptions;
  const roleMap = new Map();
  [...(board.roleOptions || []), ...(board.rolePool || [])].forEach((role) => {
    if (role?.id) roleMap.set(String(role.id), role);
  });
  return Array.from(roleMap.values());
}

function renderBoardControls() {
  const current = getBoard();
  els.boardSelect.replaceChildren(
    option("", boardConfig.boards.length ? "不使用板型" : "未读取到板型"),
    ...boardConfig.boards.map((board) =>
      option(String(board.id), `${board.modeName} · ${board.seatCount}人 · ${board.name}`)
    )
  );
  els.boardSelect.value = state.currentBoardId || "";

  if (!current) {
    els.boardSummary.textContent = boardConfig.boards.length ? "可手动设置人数和身份" : "没有可用板型配置";
    els.rolePool.replaceChildren();
    return;
  }

  const pool = rolePoolCounts(current);
  const marked = markedRoleCounts();
  els.boardSummary.textContent = `${current.name} · ${current.modeName} · ${current.seatCount}人 · ${pool.total}个身份位`;

  const chips = pool.items.map(({ role, total }) => {
    const used = marked.get(String(role.id)) || 0;
    const chip = document.createElement("span");
    chip.className = `role-chip${used >= total ? " done" : ""}`;
    chip.textContent = `${role.name} ${used}/${total}`;
    chip.title = `${role.camp || "身份"} · ID ${role.id}`;
    return chip;
  });

  for (const [roleId, used] of marked.entries()) {
    if (pool.items.some((item) => String(item.role.id) === roleId)) continue;
    const role = getRoleById(roleId);
    const chip = document.createElement("span");
    chip.className = "role-chip extra";
    chip.textContent = `${role?.name || `角色${roleId}`} +${used}`;
    chips.push(chip);
  }

  els.rolePool.replaceChildren(...chips);
}

function rolePoolCounts(board = getBoard()) {
  const counts = new Map();
  const roles = board?.rolePool?.length ? board.rolePool : boardRoleOptions(board);
  roles.forEach((role) => {
    const key = String(role.id);
    const item = counts.get(key) || {
      role,
      total: 0
    };
    item.total += 1;
    counts.set(key, item);
  });
  return {
    total: roles.length,
    items: Array.from(counts.values())
  };
}

function markedRoleCounts() {
  const counts = new Map();
  activeSeats().forEach((seat) => {
    if (!seat.roleId) return;
    const key = String(seat.roleId);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function renderDays() {
  els.dayTabs.replaceChildren(
    ...state.days.map((day) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `day-tab${day.id === state.currentDay ? " active" : ""}`;
      button.textContent = day.label;
      button.addEventListener("click", () => {
        state.currentDay = day.id;
        if (day.id === 0) state.currentPhase = "police";
        if (day.id !== 0 && state.currentPhase === "police") state.currentPhase = "day";
        state.filters.day = "current";
        saveAndRender();
      });
      return button;
    })
  );
}

function renderPhase() {
  els.phaseButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.phase === state.currentPhase);
  });
}

function renderSeats() {
  els.activeSeatLabel.textContent = `正在记录：${seatLabel(state.activeSeatId)}`;

  const cards = activeSeats().map((seat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "seat-card",
      seat.id === state.activeSeatId ? "active" : "",
      seat.status || "alive"
    ]
      .filter(Boolean)
      .join(" ");
    button.addEventListener("click", () => {
      state.activeSeatId = seat.id;
      state.selectedSeatId = seat.id;
      saveAndRender();
    });

    const count = state.entries.filter((entry) => entry.seatId === seat.id).length;
    const roleLabel = seatRoleLabel(seat);
    button.innerHTML = `
      <div class="seat-no"><span>${seat.id}号</span><span class="seat-status-dot"></span></div>
      <div class="seat-name">${escapeHtml(seat.name || "未命名")}</div>
      <div class="seat-role">${escapeHtml(roleLabel || "身份未标")}</div>
      <div class="seat-count">${count} 条记录</div>
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

function renderSpeakerButtons() {
  els.speakerHint.textContent = `${phaseNames[state.currentPhase]} · ${seatLabel(state.activeSeatId)}`;
  const buttons = activeSeats().map((seat) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = seat.id === state.activeSeatId ? "active" : "";
    button.textContent = `${seat.id}号`;
    button.title = seat.name || `${seat.id}号玩家`;
    button.addEventListener("click", () => {
      state.activeSeatId = seat.id;
      state.selectedSeatId = seat.id;
      saveAndRender();
    });
    return button;
  });
  els.speakerButtons.replaceChildren(...buttons);
}

function renderSelectedSeat() {
  const seat = getSeat(state.selectedSeatId);
  els.noteSeatLabel.textContent = `${seat.id}号玩家`;
  els.playerNameInput.value = seat.name || "";
  renderRoleSelect(seat);
  els.playerStatusInput.value = seat.status || "alive";
  els.playerNoteInput.value = seat.note || "";
}

function renderRoleSelect(seat) {
  const boardRoles = boardRoleOptions();
  const options = [
    option("", "身份未标"),
    ...boardRoles.map((role) => option(`role:${role.id}`, `${role.name} · ${role.camp || "身份"}`)),
    ...commonRoleOptions.map((role) => option(String(role.id), role.name))
  ];
  els.playerRoleInput.replaceChildren(...options);
  const roleMatch = boardRoles.find((role) => role.name === seat.role);
  const commonValue = commonRoleOptions.find((role) => role.name === seat.role)?.id || "";
  const targetValue = seat.roleId ? `role:${seat.roleId}` : roleMatch ? `role:${roleMatch.id}` : commonValue;
  els.playerRoleInput.value = targetValue;
  if (els.playerRoleInput.value !== targetValue) {
    els.playerRoleInput.value = "";
  }
}

function renderEntries() {
  const entries = filteredEntries();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂无记录";
    els.entryList.replaceChildren(empty);
    return;
  }

  const nodes = entries.map((entry) => {
    const node = els.entryTemplate.content.firstElementChild.cloneNode(true);
    const seat = getSeat(entry.seatId);
    const day = state.days.find((item) => item.id === entry.dayId);
    $(".entry-meta", node).innerHTML = `
      <strong>${seat.id}号${seat.name ? ` · ${escapeHtml(seat.name)}` : ""}</strong>
      <span>${escapeHtml(day?.label || `第${entry.dayId}天`)}</span>
      <span>${escapeHtml(phaseNames[entry.phase] || "补充")}</span>
      <span>${escapeHtml(formatTime(entry.createdAt))}</span>
      <span>${entry.source === "auto" ? "转写" : "手记"}</span>
    `;
    $(".entry-text", node).textContent = entry.text;
    const editor = $(".entry-editor", node);
    editor.value = entry.text;

    $(".copy-entry", node).addEventListener("click", () => {
      navigator.clipboard.writeText(`${seat.id}号：${entry.text}`).catch(() => {});
    });

    $(".edit-entry", node).addEventListener("click", (event) => {
      if (node.classList.contains("editing")) {
        entry.text = editor.value.trim() || entry.text;
        node.classList.remove("editing");
        event.currentTarget.textContent = "编辑";
        saveAndRender();
      } else {
        node.classList.add("editing");
        event.currentTarget.textContent = "保存";
        editor.focus();
      }
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
  if (message) {
    els.transcribeStatus.textContent = message;
    return;
  }

  if (mediaRecorder || speechListening) {
    els.transcribeStatus.textContent = state.settings.serverMode ? "指定输入源转写中" : "浏览器听写中";
    return;
  }

  if (state.settings.serverMode && !serverConfig.transcribeConfigured) {
    els.transcribeStatus.textContent = "转写服务未配置";
    return;
  }

  if (!state.settings.serverMode && !SpeechRecognition) {
    els.transcribeStatus.textContent = "浏览器不支持听写";
    return;
  }

  els.transcribeStatus.textContent = "待启动";
}

function filteredEntries() {
  const search = state.filters.search.toLowerCase();
  return [...state.entries]
    .filter((entry) => {
      if (state.filters.day === "current" && entry.dayId !== state.currentDay) return false;
      if (state.filters.day !== "all" && state.filters.day !== "current" && entry.dayId !== Number(state.filters.day)) return false;
      if (state.filters.seat !== "all" && entry.seatId !== Number(state.filters.seat)) return false;
      if (search && !entry.text.toLowerCase().includes(search) && !seatLabel(entry.seatId).toLowerCase().includes(search)) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function updateSelectedSeat() {
  const seat = getSeat(state.selectedSeatId);
  const selectedRole = readSelectedRole();
  seat.name = els.playerNameInput.value.trim();
  seat.role = selectedRole.name;
  seat.roleId = selectedRole.roleId;
  seat.status = els.playerStatusInput.value;
  seat.note = els.playerNoteInput.value.trim();
  saveState();
  renderBoardControls();
  renderSeats();
  renderSelects();
  renderSpeakerButtons();
}

function readSelectedRole() {
  const value = els.playerRoleInput.value;
  if (!value) {
    return {
      name: "",
      roleId: ""
    };
  }
  if (value.startsWith("role:")) {
    const roleId = value.slice("role:".length);
    return {
      name: getRoleById(roleId)?.name || `角色${roleId}`,
      roleId
    };
  }
  const common = commonRoleOptions.find((role) => String(role.id) === value);
  return {
    name: common?.name || value,
    roleId: ""
  };
}

function addEntryFromText(rawText, source = "auto", fallbackSeatId = state.activeSeatId) {
  const parsed = state.settings.autoSeatByPrefix ? detectSeatPrefix(rawText) : null;
  const seatId = parsed?.seatId || fallbackSeatId || state.activeSeatId;
  const text = (parsed?.text || rawText).trim();
  if (!text) return;

  state.activeSeatId = seatId;
  state.selectedSeatId = seatId;
  state.entries.push({
    id: crypto.randomUUID(),
    dayId: state.currentDay,
    phase: state.currentPhase,
    seatId,
    text,
    source,
    createdAt: new Date().toISOString()
  });
  saveAndRender();
}

async function startListening() {
  if (state.settings.serverMode) {
    await startServerTranscription();
  } else {
    startBrowserSpeech();
  }
}

function stopListening() {
  speechListening = false;

  if (recognition) {
    recognition.onend = null;
    recognition.stop();
    recognition = null;
  }

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  mediaRecorder = null;

  stopMediaStream();
  els.interimText.textContent = "";
  renderTranscribeStatus();
}

function startBrowserSpeech() {
  if (!SpeechRecognition) {
    renderTranscribeStatus("浏览器不支持听写");
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
        addEntryFromText(text, "auto");
      } else {
        interim += text;
      }
    }
    els.interimText.textContent = interim;
  };

  recognition.onerror = (event) => {
    renderTranscribeStatus(event.error === "not-allowed" ? "麦克风未授权" : "听写中断");
  };

  recognition.onend = () => {
    if (!speechListening) return;
    try {
      recognition.start();
    } catch {
      renderTranscribeStatus("听写重启中");
    }
  };

  try {
    recognition.start();
    renderTranscribeStatus();
  } catch {
    renderTranscribeStatus("听写已启动");
  }
}

async function startServerTranscription() {
  if (!serverConfig.transcribeConfigured) {
    renderTranscribeStatus("转写服务未配置");
    return;
  }

  stopListening();

  try {
    await refreshAudioDevices(true);
    const deviceId = els.audioDeviceSelect.value;
    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true
    };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    startLevelMeter(mediaStream);

    const mimeType = pickRecorderMimeType();
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 1200) {
        queueTranscription(event.data, event.data.type || mimeType || "audio/webm");
      }
    });
    mediaRecorder.addEventListener("stop", stopMediaStream);
    mediaRecorder.start(state.settings.chunkSeconds * 1000);
    renderTranscribeStatus();
  } catch {
    renderTranscribeStatus("输入源不可用");
    stopMediaStream();
  }
}

function pickRecorderMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function queueTranscription(blob, contentType) {
  els.interimText.textContent = "转写片段处理中";
  transcribeQueue = transcribeQueue
    .then(() => sendAudioChunk(blob, contentType))
    .catch(() => {
      renderTranscribeStatus("转写失败");
    });
}

async function sendAudioChunk(blob, contentType) {
  const response = await fetch("./api/transcribe", {
    method: "POST",
    headers: {
      "content-type": contentType
    },
    body: blob
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    renderTranscribeStatus("转写失败");
    return;
  }

  const text = (data.text || "").trim();
  els.interimText.textContent = text;
  if (text) {
    addEntryFromText(text, "auto");
  }
}

async function refreshAudioDevices(requestPermission) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    els.audioDeviceSelect.replaceChildren(option("", "无输入源"));
    return;
  }

  if (requestPermission) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      els.audioDeviceSelect.replaceChildren(option("", "麦克风未授权"));
      return;
    }
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter((device) => device.kind === "audioinput");
  const currentValue = els.audioDeviceSelect.value;
  const options = audioInputs.map((device, index) =>
    option(device.deviceId, device.label || `输入源 ${index + 1}`)
  );
  els.audioDeviceSelect.replaceChildren(...(options.length ? options : [option("", "默认输入源")]));
  if (audioInputs.some((device) => device.deviceId === currentValue)) {
    els.audioDeviceSelect.value = currentValue;
  }
}

function startLevelMeter(stream) {
  stopLevelMeter();
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  const draw = () => {
    if (!analyser) return;
    analyser.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;
    const percent = Math.min(100, Math.round((average / 128) * 100));
    els.levelFill.style.width = `${percent}%`;
    animationFrame = requestAnimationFrame(draw);
  };

  draw();
}

function stopLevelMeter() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  analyser = null;
  els.levelFill.style.width = "0%";
}

function stopMediaStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  stopLevelMeter();
}

function detectSeatPrefix(text) {
  const match = text
    .trim()
    .match(/^(?:第)?([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*号(?:玩家|位)?(?:发言|说|[:：,，\s])/);

  if (!match) return null;

  const seatId = parseSeatNumber(match[1]);
  if (!seatId || seatId < 1 || seatId > state.seatCount) return null;

  const stripped = text.slice(match[0].length).trim();
  return {
    seatId,
    text: stripped || text.trim()
  };
}

function parseSeatNumber(value) {
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);

  const normalized = text.replace("两", "二");
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

  if (normalized === "十") return 10;
  if (normalized.startsWith("十")) return 10 + (digits[normalized[1]] || 0);
  if (normalized.endsWith("十")) return (digits[normalized[0]] || 0) * 10;
  if (normalized.includes("十")) {
    const [tens, ones] = normalized.split("十");
    return (digits[tens] || 0) * 10 + (digits[ones] || 0);
  }
  return digits[normalized] || 0;
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
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
  const currentBoard = getBoard();
  if (currentBoard) {
    lines.push(`- 板型：${currentBoard.name}`);
    lines.push(`- 人数：${currentBoard.seatCount}`);
    lines.push("");
  }

  for (const day of state.days) {
    lines.push(`## ${day.label}`, "");
    const entries = state.entries
      .filter((entry) => entry.dayId === day.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    if (!entries.length) {
      lines.push("- 暂无记录", "");
      continue;
    }

    for (const entry of entries) {
      const seat = getSeat(entry.seatId);
      lines.push(`- ${formatTime(entry.createdAt)} ${phaseNames[entry.phase]} ${seat.id}号${seat.name ? `（${seat.name}）` : ""}：${entry.text}`);
    }
    lines.push("");
  }

  lines.push("## 玩家备注", "");
  activeSeats().forEach((seat) => {
    const details = [seatRoleLabel(seat), statusNames[seat.status]].filter(Boolean).join(" / ");
    lines.push(`### ${seat.id}号${seat.name ? ` ${seat.name}` : ""}`);
    if (details) lines.push(`- ${details}`);
    if (seat.note) lines.push(`- ${seat.note}`);
    lines.push("");
  });

  downloadFile(`${safeFileName(state.sessionTitle)}.md`, lines.join("\n"), "text/markdown");
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

async function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    state = migrateState(JSON.parse(text));
    normalizeBoardSelection();
    saveAndRender();
  } catch {
    renderTranscribeStatus("导入失败");
  } finally {
    event.target.value = "";
  }
}

function safeFileName(value) {
  return (value || "werewolf-notes").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
