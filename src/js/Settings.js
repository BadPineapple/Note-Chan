/* ──────────────────────────────  Settings.js  ────────────────────────────── */
// Renderer da janela de Configurações.

let settings = { theme: "gold", transparency: 60, shortcuts: {}, alarm: { enabled: true, volume: 70, sound: "sininho" } };
let recordingAction = null;

const themeButtons   = document.querySelectorAll(".theme-swatch");
const slider         = document.getElementById("transparency-slider");
const sliderValue    = document.getElementById("transparency-value");
const hint           = document.getElementById("shortcut-hint");
const recorders      = {
    toggleWidget: document.getElementById("rec-toggleWidget"),
    quickCapture: document.getElementById("rec-quickCapture")
};
const alarmEnabledToggle = document.getElementById("alarm-enabled-toggle");
const alarmVolumeSlider  = document.getElementById("alarm-volume-slider");
const alarmVolumeValue   = document.getElementById("alarm-volume-value");
const alarmSoundList     = document.getElementById("alarm-sound-list");

function saveSettings(partial) {
    settings = {
        ...settings,
        ...partial,
        shortcuts: { ...settings.shortcuts, ...partial.shortcuts },
        alarm: { ...settings.alarm, ...partial.alarm }
    };
    window.api.send("save-settings", partial);
}

function applyToUI(s) {
    settings = s;
    document.documentElement.dataset.theme = s.theme;
    themeButtons.forEach(btn => btn.classList.toggle("selected", btn.dataset.theme === s.theme));

    slider.value = s.transparency;
    sliderValue.textContent = `${s.transparency}%`;

    alarmEnabledToggle.checked = !!s.alarm?.enabled;
    alarmVolumeSlider.value = s.alarm?.volume ?? 70;
    alarmVolumeValue.textContent = `${alarmVolumeSlider.value}%`;
    renderAlarmSoundList();

    recorders.toggleWidget.textContent = s.shortcuts.toggleWidget || "(nenhum)";
    recorders.quickCapture.textContent = s.shortcuts.quickCapture || "(nenhum)";
}

/* ─────────────────────────────────  Temas  ──────────────────────────────── */

themeButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        document.documentElement.dataset.theme = btn.dataset.theme;
        themeButtons.forEach(b => b.classList.toggle("selected", b === btn));
        saveSettings({ theme: btn.dataset.theme });
    });
});

/* ────────────────────────────  Transparência  ───────────────────────────── */

let sliderTimer = null;
slider.addEventListener("input", () => {
    sliderValue.textContent = `${slider.value}%`;
    clearTimeout(sliderTimer);
    sliderTimer = setTimeout(() => saveSettings({ transparency: Number(slider.value) }), 200);
});

/* ────────────────────────────────  Alarme  ──────────────────────────────── */

alarmEnabledToggle.addEventListener("change", () => {
    saveSettings({ alarm: { enabled: alarmEnabledToggle.checked } });
});

let alarmVolumeTimer = null;
alarmVolumeSlider.addEventListener("input", () => {
    alarmVolumeValue.textContent = `${alarmVolumeSlider.value}%`;
    clearTimeout(alarmVolumeTimer);
    alarmVolumeTimer = setTimeout(() => saveSettings({ alarm: { volume: Number(alarmVolumeSlider.value) } }), 200);
});

let stopAlarmPreview = null;

function renderAlarmSoundList() {
    alarmSoundList.innerHTML = "";
    Object.entries(AlarmSounds.SOUNDS).forEach(([key, sound]) => {
        const row = document.createElement("div");
        row.className = "alarm-sound-row" + (settings.alarm?.sound === key ? " selected" : "");
        row.innerHTML = `
            <span class="alarm-sound-label">${sound.label}</span>
            <button type="button" class="alarm-sound-preview" title="Testar">▶</button>
        `;
        row.addEventListener("click", () => {
            saveSettings({ alarm: { sound: key } });
            renderAlarmSoundList();
        });
        row.querySelector(".alarm-sound-preview").addEventListener("click", (e) => {
            e.stopPropagation();
            if (stopAlarmPreview) stopAlarmPreview();
            stopAlarmPreview = AlarmSounds.play(key, Number(alarmVolumeSlider.value));
            setTimeout(() => { if (stopAlarmPreview) { stopAlarmPreview(); stopAlarmPreview = null; } }, 2600);
        });
        alarmSoundList.appendChild(row);
    });
}

/* ────────────────────────────────  Atalhos  ──────────────────────────────── */

const KEY_MAP = {
    " ": "Space", "ArrowUp": "Up", "ArrowDown": "Down", "ArrowLeft": "Left", "ArrowRight": "Right",
    "Escape": "Escape"
};

function eventToAccelerator(e) {
    const parts = [];
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");

    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;

    let keyName = KEY_MAP[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    parts.push(keyName);
    return parts;
}

function startRecording(action, btn) {
    if (recordingAction) stopRecording(false);
    recordingAction = action;
    btn.classList.add("recording");
    btn.textContent = "Pressione a combinação...";
    hint.textContent = "Pressione Ctrl/Alt/Shift + uma tecla. Esc para cancelar.";
    hint.classList.remove("error");
}

function stopRecording(restoreLabel = true) {
    if (!recordingAction) return;
    const btn = recorders[recordingAction];
    btn.classList.remove("recording");
    if (restoreLabel) btn.textContent = settings.shortcuts[recordingAction] || "(nenhum)";
    recordingAction = null;
}

Object.entries(recorders).forEach(([action, btn]) => {
    btn.addEventListener("click", () => startRecording(action, btn));
});

window.addEventListener("keydown", (e) => {
    if (!recordingAction) return;
    e.preventDefault();

    if (e.key === "Escape") {
        stopRecording();
        hint.textContent = "Clique num atalho e pressione a combinação desejada (precisa de Ctrl, Alt ou Shift).";
        return;
    }

    const parts = eventToAccelerator(e);
    if (!parts) return; // só modificador sozinho, espera a tecla principal

    if (parts.length < 2) {
        hint.textContent = "Use pelo menos um modificador (Ctrl, Alt ou Shift).";
        hint.classList.add("error");
        return;
    }

    const accelerator = parts.join("+");
    const action = recordingAction;
    recorders[action].textContent = accelerator;
    stopRecording(false);
    hint.textContent = "Clique num atalho e pressione a combinação desejada (precisa de Ctrl, Alt ou Shift).";
    hint.classList.remove("error");
    saveSettings({ shortcuts: { [action]: accelerator } });
});

/* ══════════════════════════════  ABAS DO SETTINGS  ════════════════════════ */

const stabButtons = document.querySelectorAll(".stab-btn");

function setSettingsTab(tab) {
    stabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.stab === tab));
    document.querySelectorAll(".stab-panel").forEach(panel =>
        panel.classList.toggle("active", panel.id === `stab-${tab}`));
}

stabButtons.forEach(btn => {
    btn.addEventListener("click", () => setSettingsTab(btn.dataset.stab));
});

/* ═════════════════════════════  ANIVERSARIANTES  ═════════════════════════ */

let birthdays = [];
const bdayExpanded = new Set();
const bdayBoard = document.getElementById("bday-board");
const bdayNewBtn = document.getElementById("bday-new-btn");

const BIRTHDAY_CATEGORY_LABELS = { "": "Sem categoria", familia: "👪 Família", amigo: "👫 Amigo", trabalho: "💼 Trabalho" };

function newId() { return crypto.randomUUID(); }
function now() { return Date.now(); }

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

function formatBR(iso) {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
}

// Sem window.confirm() aqui também, por consistência com o widget (ver
// Widget.js) — dois cliques no próprio botão em vez de diálogo bloqueante.
function armDeleteConfirm(btn, onConfirm) {
    if (btn.classList.contains("confirm-armed")) {
        clearTimeout(btn._armTimer);
        onConfirm();
        return;
    }
    btn.classList.add("confirm-armed");
    btn.textContent = "?";
    btn._armTimer = setTimeout(() => {
        btn.classList.remove("confirm-armed");
        btn.textContent = "✕";
    }, 2500);
}

function birthdayBadge(dateStr) {
    const occ = EventUtils.nextBirthdayOccurrence(dateStr);
    const today = EventUtils.todayISO();
    if (occ === today) return { text: "🎂 Hoje!", cls: "today" };
    if (occ === EventUtils.addInterval(today, "daily")) return { text: "🎂 Amanhã", cls: "soon" };
    const diffDays = Math.round((new Date(occ) - new Date(today)) / 86400000);
    return { text: `${formatBR(occ)} · faltam ${diffDays}d`, cls: "" };
}

let bdaySaveTimer = null;
function scheduleBdaySave() {
    clearTimeout(bdaySaveTimer);
    bdaySaveTimer = setTimeout(() => window.api.send("save-data", { birthdays }), 400);
}

function renderBdayBoard() {
    bdayBoard.innerHTML = "";
    const items = [...birthdays].sort((a, b) => {
        const occA = EventUtils.nextBirthdayOccurrence(a.date);
        const occB = EventUtils.nextBirthdayOccurrence(b.date);
        return occA < occB ? -1 : occA > occB ? 1 : 0;
    });

    if (items.length === 0) {
        const msg = document.createElement("div");
        msg.className = "empty-msg";
        msg.textContent = "Nenhum aniversariante ainda. Crie o primeiro acima.";
        bdayBoard.appendChild(msg);
        return;
    }

    const frag = document.createDocumentFragment();
    items.forEach(b => frag.appendChild(birthdayCardNode(b)));
    bdayBoard.appendChild(frag);
}

function birthdayCardNode(birthday) {
    const card = document.createElement("div");
    card.className = "card" + (bdayExpanded.has(birthday.id) ? " expanded" : "");
    card.dataset.id = birthday.id;

    card.innerHTML = `
        <div class="card-delete" title="Excluir aniversariante">✕</div>
        <div class="card-header">
            <span class="card-title" spellcheck="false">${escapeHtml(birthday.name)}</span>
        </div>
        <div class="card-preview"></div>
        <div class="card-body">
            <div class="event-fields">
                <div class="event-row">
                    <label>Data de nascimento
                        <input type="date" class="bd-date" value="${birthday.date}" />
                    </label>
                    <label>Categoria
                        <select class="bd-category">
                            ${Object.entries(BIRTHDAY_CATEGORY_LABELS).map(([value, label]) =>
                                `<option value="${value}" ${birthday.category === value ? "selected" : ""}>${label}</option>`
                            ).join("")}
                        </select>
                    </label>
                </div>
            </div>
        </div>
    `;

    const preview = card.querySelector(".card-preview");

    function refreshPreview() {
        const badge = birthdayBadge(birthday.date);
        const age = EventUtils.ageAtOccurrence(birthday.date, EventUtils.nextBirthdayOccurrence(birthday.date));
        const catLabel = birthday.category ? BIRTHDAY_CATEGORY_LABELS[birthday.category] : "";
        preview.innerHTML =
            `<span class="birthday-badge ${badge.cls}">${badge.text}</span>` +
            (age ? ` faz ${age} anos` : "") +
            (catLabel ? ` <span class="birthday-category">${catLabel}</span>` : "");
    }
    refreshPreview();

    card.querySelector(".card-header").addEventListener("click", () => {
        card.classList.toggle("expanded");
        if (card.classList.contains("expanded")) bdayExpanded.add(birthday.id);
        else bdayExpanded.delete(birthday.id);
    });

    const title = card.querySelector(".card-title");
    title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        title.contentEditable = "true";
        title.focus();
        document.execCommand("selectAll", false, null);
    });
    title.addEventListener("click", (e) => { if (title.isContentEditable) e.stopPropagation(); });
    title.addEventListener("blur", () => {
        title.contentEditable = "false";
        birthday.name = title.textContent.trim() || "Sem nome";
        title.textContent = birthday.name;
        birthday.updatedAt = now();
        scheduleBdaySave();
    });
    title.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        title.blur();
    });

    card.querySelector(".bd-date").addEventListener("change", (e) => {
        birthday.date = e.target.value || EventUtils.todayISO();
        e.target.value = birthday.date;
        birthday.updatedAt = now();
        refreshPreview();
        scheduleBdaySave();
    });

    card.querySelector(".bd-category").addEventListener("change", (e) => {
        birthday.category = e.target.value;
        birthday.updatedAt = now();
        refreshPreview();
        scheduleBdaySave();
    });

    card.querySelector(".card-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        armDeleteConfirm(e.currentTarget, () => {
            birthdays = birthdays.filter(b => b.id !== birthday.id);
            bdayExpanded.delete(birthday.id);
            scheduleBdaySave();
            card.remove();
            if (birthdays.length === 0) renderBdayBoard();
        });
    });

    return card;
}

function createBirthday() {
    const birthday = {
        id: newId(), name: "Novo aniversariante", date: EventUtils.todayISO(), category: "",
        createdAt: now(), updatedAt: now()
    };
    birthdays.push(birthday);
    scheduleBdaySave();
    renderBdayBoard();
    bdayExpanded.add(birthday.id);
    const card = bdayBoard.querySelector(`.card[data-id="${birthday.id}"]`);
    if (card) {
        card.classList.add("expanded");
        const title = card.querySelector(".card-title");
        title.contentEditable = "true";
        title.focus();
        document.execCommand("selectAll", false, null);
    }
}

bdayNewBtn.addEventListener("click", createBirthday);

window.api.on("quick-create", (type) => {
    if (type !== "aniversario") return;
    setSettingsTab("aniversarios");
    createBirthday();
});

/* ══════════════════════════════════  TAGS  ════════════════════════════════ */

let tags = [];
const tagBoard = document.getElementById("tag-board");
const tagNewBtn = document.getElementById("tag-new-btn");

let tagSaveTimer = null;
function scheduleTagSave() {
    clearTimeout(tagSaveTimer);
    tagSaveTimer = setTimeout(() => window.api.send("save-data", { tags }), 400);
}

function renderTagBoard() {
    tagBoard.innerHTML = "";
    if (tags.length === 0) {
        const msg = document.createElement("div");
        msg.className = "empty-msg";
        msg.textContent = "Nenhuma tag ainda. Crie a primeira acima.";
        tagBoard.appendChild(msg);
        return;
    }
    const frag = document.createDocumentFragment();
    tags.forEach(tag => frag.appendChild(tagCardNode(tag)));
    tagBoard.appendChild(frag);
}

function tagCardNode(tag) {
    const card = document.createElement("div");
    card.className = "card tag-item";
    card.dataset.id = tag.id;

    card.innerHTML = `
        <div class="card-delete" title="Excluir tag">✕</div>
        <div class="tag-name-row">
            <span class="tag-color-dot" style="background:#${tag.color}"></span>
            <span class="tag-name" contenteditable="false" spellcheck="false">${escapeHtml(tag.name)}</span>
        </div>
        <div class="tag-swatches">
            ${TagUtils.PALETTE.map(hex =>
                `<button type="button" class="tag-swatch ${hex === tag.color ? "selected" : ""}" data-hex="${hex}" style="background:#${hex}"></button>`
            ).join("")}
        </div>
    `;

    const nameEl = card.querySelector(".tag-name");
    nameEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        nameEl.contentEditable = "true";
        nameEl.focus();
        document.execCommand("selectAll", false, null);
    });
    nameEl.addEventListener("blur", () => {
        nameEl.contentEditable = "false";
        tag.name = nameEl.textContent.trim() || "Sem nome";
        nameEl.textContent = tag.name;
        scheduleTagSave();
    });
    nameEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        nameEl.blur();
    });

    card.querySelectorAll(".tag-swatch").forEach(btn => {
        btn.addEventListener("click", () => {
            tag.color = btn.dataset.hex;
            card.querySelector(".tag-color-dot").style.background = `#${tag.color}`;
            card.querySelectorAll(".tag-swatch").forEach(b => b.classList.toggle("selected", b === btn));
            scheduleTagSave();
        });
    });

    card.querySelector(".card-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        armDeleteConfirm(e.currentTarget, () => {
            tags = tags.filter(t => t.id !== tag.id);
            scheduleTagSave();
            card.remove();
            if (tags.length === 0) renderTagBoard();
        });
    });

    return card;
}

function createTag() {
    const usedColors = tags.map(t => t.color);
    const color = TagUtils.PALETTE.find(hex => !usedColors.includes(hex)) || TagUtils.PALETTE[tags.length % TagUtils.PALETTE.length];
    const tag = { id: newId(), name: "Nova tag", color };
    tags.push(tag);
    scheduleTagSave();
    renderTagBoard();
    const card = tagBoard.querySelector(`.card[data-id="${tag.id}"]`);
    if (card) {
        const nameEl = card.querySelector(".tag-name");
        nameEl.contentEditable = "true";
        nameEl.focus();
        document.execCommand("selectAll", false, null);
    }
}

tagNewBtn.addEventListener("click", createTag);

/* ══════════════════════════════  SINCRONIZAÇÃO  ═══════════════════════════ */

window.api.on("apply-settings", (s) => { if (!recordingAction) applyToUI(s); });

window.api.invoke("get-data").then(loaded => {
    applyToUI(loaded.settings);
    birthdays = loaded.birthdays || [];
    renderBdayBoard();
    tags = loaded.tags || [];
    renderTagBoard();
});
