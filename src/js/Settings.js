/* ──────────────────────────────  Settings.js  ────────────────────────────── */

Log.iniciar("configuracoes");

let settings = { theme: "gold", transparency: 60, shortcuts: {}, alarm: { enabled: true, volume: 70, sound: "sininho" } };
let recordingAction = null;
let booted = false;

const themeButtons   = document.querySelectorAll(".theme-swatch");
const slider         = document.getElementById("transparency-slider");
const sliderValue    = document.getElementById("transparency-value");
const hint           = document.getElementById("shortcut-hint");

const GRUPOS_ATALHO = {
    shortcuts: {
        toggleWidget: document.getElementById("rec-toggleWidget"),
        quickCapture: document.getElementById("rec-quickCapture"),
        newNoteWindow: document.getElementById("rec-newNoteWindow")
    },
    editorShortcuts: {
        negrito: document.getElementById("rec-negrito"),
        italico: document.getElementById("rec-italico"),
        sublinhado: document.getElementById("rec-sublinhado"),
        lista: document.getElementById("rec-lista"),
        listaNumerada: document.getElementById("rec-listaNumerada")
    }
};

const recorders = {};    
const grupoDaAcao = {}; 
for (const [grupo, mapa] of Object.entries(GRUPOS_ATALHO)) {
    for (const [acao, btn] of Object.entries(mapa)) {
        recorders[acao] = btn;
        grupoDaAcao[acao] = grupo;
    }
}

const editorFontSize = document.getElementById("editor-font-size");
const editorIndent   = document.getElementById("editor-indent");
const alarmEnabledToggle = document.getElementById("alarm-enabled-toggle");
const alarmVolumeSlider  = document.getElementById("alarm-volume-slider");
const alarmVolumeValue   = document.getElementById("alarm-volume-value");
const alarmSoundList     = document.getElementById("alarm-sound-list");

function saveSettings(partial) {
    settings = {
        ...settings,
        ...partial,
        shortcuts: { ...settings.shortcuts, ...partial.shortcuts },
        editor: { ...settings.editor, ...partial.editor },
        editorShortcuts: { ...settings.editorShortcuts, ...partial.editorShortcuts },
        alarm: { ...settings.alarm, ...partial.alarm }
    };
    window.api.send("save-settings", partial);
}

let renderedAlarmSound = null;

function applyToUI(s) {
    settings = s;
    document.documentElement.dataset.theme = s.theme;
    themeButtons.forEach(btn => btn.classList.toggle("selected", btn.dataset.theme === s.theme));

    if (document.activeElement !== slider) {
        slider.value = s.transparency;
        sliderValue.textContent = `${s.transparency}%`;
    }

    alarmEnabledToggle.checked = !!s.alarm?.enabled;
    if (document.activeElement !== alarmVolumeSlider) {
        alarmVolumeSlider.value = s.alarm?.volume ?? 70;
        alarmVolumeValue.textContent = `${alarmVolumeSlider.value}%`;
    }
    if (renderedAlarmSound !== (s.alarm?.sound ?? null)) renderAlarmSoundList();

    Object.entries(recorders).forEach(([action, btn]) => {
        btn.textContent = (s[grupoDaAcao[action]] || {})[action] || "(nenhum)";
    });

    if (document.activeElement !== editorFontSize) editorFontSize.value = String(s.editor?.fontSize ?? 15);
    if (document.activeElement !== editorIndent) editorIndent.value = String(s.editor?.indentSize ?? 4);
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

const ALARM_SOUND_ICONS = { sininho: "bell", caixinha: "music", passarinho: "bird", classico: "alarm-clock" };

function renderAlarmSoundList() {
    renderedAlarmSound = settings.alarm?.sound ?? null;
    alarmSoundList.innerHTML = "";
    Object.entries(AlarmSounds.SOUNDS).forEach(([key, sound]) => {
        const row = document.createElement("div");
        row.className = "alarm-sound-row" + (settings.alarm?.sound === key ? " selected" : "");
        row.innerHTML = `
            <span class="alarm-sound-label">${Icons.svg(ALARM_SOUND_ICONS[key], 13)} ${sound.label}</span>
            <button type="button" class="alarm-sound-preview" title="Testar">${Icons.svg("play", 10)}</button>
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

/* ─────────────────────────────  Editor de texto  ─────────────────────────── */

const TAMANHOS_EDITOR = [12, 13, 14, 15, 16, 18, 20, 22];
const INDENTS_EDITOR = [2, 4, 8];

function preencherSelect(el, valores, rotulo) {
    el.innerHTML = "";
    for (const valor of valores) {
        const op = document.createElement("option");
        op.value = String(valor);
        op.textContent = rotulo(valor);
        el.appendChild(op);
    }
}

preencherSelect(editorFontSize, TAMANHOS_EDITOR, v => v + " px");
preencherSelect(editorIndent, INDENTS_EDITOR, v => v + (v === 1 ? " espaço" : " espaços"));

editorFontSize.addEventListener("change", () => {
    saveSettings({ editor: { fontSize: Number(editorFontSize.value) } });
});

editorIndent.addEventListener("change", () => {
    saveSettings({ editor: { indentSize: Number(editorIndent.value) } });
});

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
    if (restoreLabel) btn.textContent = (settings[grupoDaAcao[recordingAction]] || {})[recordingAction] || "(nenhum)";
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
    if (!parts) return; 

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
    saveSettings({ [grupoDaAcao[action]]: { [action]: accelerator } });
});

/* ═══════════  CARD RECÉM-CRIADO QUE NINGUÉM CHEGOU A PREENCHER  ═══════════ */

const NEW_BIRTHDAY_NAME = "Novo aniversariante";
const NEW_TAG_NAME = "Nova tag";

let pristine = { birthdayId: null, birthdayDate: null, tagId: null, tagColor: null };

function discardPristineBirthday() {
    const id = pristine.birthdayId;
    const date = pristine.birthdayDate;
    if (!id) return;
    pristine.birthdayId = null;
    pristine.birthdayDate = null;

    const b = birthdays.find(x => x.id === id);
    if (!b) return;
    if (b.name !== NEW_BIRTHDAY_NAME || b.category || b.date !== date) return; 

    birthdays = birthdays.filter(x => x.id !== id);
    bdayExpanded.delete(id);
    scheduleBdaySave();
    renderBdayBoard();
}

function discardPristineTag() {
    const id = pristine.tagId;
    const color = pristine.tagColor;
    if (!id) return;
    pristine.tagId = null;
    pristine.tagColor = null;

    const t = tags.find(x => x.id === id);
    if (!t) return;
    if (t.name !== NEW_TAG_NAME || t.color !== color) return; 

    tags = tags.filter(x => x.id !== id);
    scheduleTagSave();
    renderTagBoard();
}

function discardPristine() {
    discardPristineBirthday();
    discardPristineTag();
}

function flushPendingSaves() {
    if (bdaySaveTimer) { clearTimeout(bdaySaveTimer); bdaySaveTimer = null; window.api.send("save-data", { birthdays }); }
    if (tagSaveTimer) { clearTimeout(tagSaveTimer); tagSaveTimer = null; window.api.send("save-data", { tags }); }
}

window.addEventListener("beforeunload", () => {
    discardPristine();
    flushPendingSaves();
});

/* ═════════════════════════════  BARRA DE TÍTULO  ══════════════════════════ */

document.getElementById("settings-minbtn").addEventListener("click", () => {
    window.api.send("settings-minimize");
});
document.getElementById("settings-closebtn").addEventListener("click", () => {
    window.api.send("close-settings");
});

/* ══════════════════════════════  ABAS DO SETTINGS  ════════════════════════ */

const stabButtons = document.querySelectorAll(".stab-btn");

function setSettingsTab(tab) {
    discardPristine();
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

const BIRTHDAY_CATEGORY_LABELS = { "": "Sem categoria", familia: "Família", amigo: "Amigo", trabalho: "Trabalho" };
const BIRTHDAY_CATEGORY_ICONS = { familia: "users", amigo: "user", trabalho: "briefcase" };

const { newId, escapeHtml, formatBR, armDeleteConfirm, clickStartedInside } = UiUtils;

function now() { return Date.now(); }

function birthdayBadge(dateStr) {
    const occ = EventUtils.nextBirthdayOccurrence(dateStr);
    const today = EventUtils.todayISO();
    const cakeIcon = Icons.svg("cake", 11);
    if (occ === today) return { text: `${cakeIcon} Hoje!`, cls: "today" };
    if (occ === EventUtils.addInterval(today, "daily")) return { text: `${cakeIcon} Amanhã`, cls: "soon" };
    const diffDays = Math.round((new Date(occ) - new Date(today)) / 86400000);
    return { text: `${formatBR(occ)} · faltam ${diffDays}d`, cls: "" };
}

let bdaySaveTimer = null;
function scheduleBdaySave() {
    if (!booted) return; 
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
        <div class="card-delete" title="Excluir aniversariante">${Icons.svg("x", 12)}</div>
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
        const catLabel = birthday.category
            ? `${Icons.svg(BIRTHDAY_CATEGORY_ICONS[birthday.category], 11)} ${BIRTHDAY_CATEGORY_LABELS[birthday.category]}`
            : "";
        preview.innerHTML =
            `<span class="birthday-badge ${badge.cls}">${badge.text}</span>` +
            (age ? ` faz ${age} anos` : "") +
            (catLabel ? ` <span class="birthday-category">${catLabel}</span>` : "");
    }
    refreshPreview();

    card.addEventListener("focusout", () => {
        setTimeout(() => {
            if (pristine.birthdayId !== birthday.id) return;
            if (card.contains(document.activeElement)) return;
            if (clickStartedInside(card)) return;
            discardPristineBirthday();
        }, 0);
    });

    card.querySelector(".card-header").addEventListener("click", (e) => {
        if (e.detail > 1) return; 
        card.classList.toggle("expanded");
        if (card.classList.contains("expanded")) bdayExpanded.add(birthday.id);
        else bdayExpanded.delete(birthday.id);
    });

    const title = card.querySelector(".card-title");
    RichEditor.ligarSetas(title);
    title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (!card.classList.contains("expanded")) {
            card.classList.add("expanded");
            bdayExpanded.add(birthday.id);
        }
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
    discardPristine(); // o "+ Novo" anterior que ficou em branco não fica pra trás
    const birthday = {
        id: newId(), name: NEW_BIRTHDAY_NAME, date: EventUtils.todayISO(), category: "",
        createdAt: now(), updatedAt: now()
    };
    birthdays.push(birthday);
    pristine.birthdayId = birthday.id;
    pristine.birthdayDate = birthday.date;
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

let pendingQuickCreate = false;

window.api.on("quick-create", (type) => {
    if (type !== "aniversario") return;
    if (!booted) { pendingQuickCreate = true; return; }
    setSettingsTab("aniversarios");
    createBirthday();
});

/* ══════════════════════════════════  TAGS  ════════════════════════════════ */

let tags = [];
const tagBoard = document.getElementById("tag-board");
const tagNewBtn = document.getElementById("tag-new-btn");

let tagSaveTimer = null;
function scheduleTagSave() {
    if (!booted) return; // ver comentário de `booted` no topo do arquivo
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
        <div class="card-delete" title="Excluir tag">${Icons.svg("x", 12)}</div>
        <div class="tag-name-row">
            <span class="tag-color-dot" style="background:#${TagUtils.corSegura(tag.color)}"></span>
            <span class="tag-name" contenteditable="false" spellcheck="false">${escapeHtml(tag.name)}</span>
        </div>
        <div class="tag-swatches">
            ${TagUtils.PALETTE.map(hex =>
                `<button type="button" class="tag-swatch ${hex === tag.color ? "selected" : ""}" data-hex="${hex}" style="background:#${hex}"></button>`
            ).join("")}
        </div>
    `;

    card.addEventListener("focusout", () => {
        setTimeout(() => {
            if (pristine.tagId !== tag.id) return;
            if (card.contains(document.activeElement)) return;
            if (clickStartedInside(card)) return;
            discardPristineTag();
        }, 0);
    });

    const nameEl = card.querySelector(".tag-name");
    RichEditor.ligarSetas(nameEl);
    nameEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (nameEl.isContentEditable) return; // já editando -- deixa o clique só posicionar o cursor
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
            tag.color = TagUtils.corSegura(btn.dataset.hex);
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
    discardPristine(); // o "+ Nova" anterior que ficou em branco não fica pra trás
    const usedColors = tags.map(t => t.color);
    const color = TagUtils.PALETTE.find(hex => !usedColors.includes(hex)) || TagUtils.PALETTE[tags.length % TagUtils.PALETTE.length];
    const tag = { id: newId(), name: NEW_TAG_NAME, color };
    tags.push(tag);
    pristine.tagId = tag.id;
    pristine.tagColor = tag.color;
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

/* ══════════════════════════════  GOOGLE AGENDA  ═══════════════════════════ */

const googleStatusText   = document.getElementById("google-status-text");
const googleConnectBtn   = document.getElementById("google-connect-btn");
const googleConnectedBox = document.getElementById("google-connected-box");
const googleSyncBtn      = document.getElementById("google-sync-btn");
const googleSyncHint     = document.getElementById("google-sync-hint");
const googleDisconnectBtn = document.getElementById("google-disconnect-btn");

function formatSyncTime(ts) {
    if (!ts) return "Nunca sincronizado.";
    return "Última sincronização: " + new Date(ts).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
}

function applyGoogleStatus(status) {
    if (!status.configured) {
        googleStatusText.textContent = "Não configurado (falta GoogleAuthConfig.js).";
        googleConnectBtn.classList.add("hidden");
        googleConnectedBox.classList.add("hidden");
        return;
    }
    if (status.connected) {
        googleStatusText.textContent = "Conectado" + (status.email ? ` como ${status.email}` : "");
        googleConnectBtn.classList.add("hidden");
        googleConnectedBox.classList.remove("hidden");
        googleSyncHint.textContent = formatSyncTime(status.lastSyncAt);
    } else {
        googleStatusText.textContent = "Não conectado.";
        googleConnectBtn.classList.remove("hidden");
        googleConnectedBox.classList.add("hidden");
    }
}

googleConnectBtn.addEventListener("click", async () => {
    googleConnectBtn.disabled = true;
    googleConnectBtn.textContent = "Abrindo navegador...";
    try {
        const status = await window.api.invoke("google-auth-start");
        applyGoogleStatus({ configured: true, ...status, lastSyncAt: null });
    } catch (e) {
        googleStatusText.textContent = "Falha ao conectar: " + e.message;
    } finally {
        googleConnectBtn.disabled = false;
        googleConnectBtn.textContent = "Conectar";
    }
});

googleDisconnectBtn.addEventListener("click", async () => {
    googleDisconnectBtn.disabled = true;
    try {
        const status = await window.api.invoke("google-disconnect");
        applyGoogleStatus({ configured: true, ...status });
    } catch (e) {
        googleStatusText.textContent = "Falha ao desconectar: " + e.message;
        Log.error("[GOOGLE] Desconectar falhou:", e.message);
    } finally {
        googleDisconnectBtn.disabled = false;
    }
});

googleSyncBtn.addEventListener("click", async () => {
    googleSyncBtn.disabled = true;
    googleSyncBtn.textContent = "Sincronizando...";
    try {
        const result = await window.api.invoke("google-sync-now");
        googleSyncHint.textContent = result.ok
            ? formatSyncTime(Date.now())
            : "Falha na sincronização: " + (result.error || "erro desconhecido");
    } catch (e) {
        googleSyncHint.textContent = "Falha na sincronização: " + e.message;
        Log.error("[GOOGLE] Sincronizar agora falhou:", e.message);
    } finally {
        googleSyncBtn.disabled = false;
        googleSyncBtn.innerHTML = `${Icons.svg("refresh-cw", 14)} Sincronizar agora`;
    }
});

window.api.invoke("google-auth-status")
    .then(applyGoogleStatus)
    .catch(e => {
        googleStatusText.textContent = "Não foi possível ler o estado da conexão.";
        Log.error("[GOOGLE] google-auth-status falhou:", e.message);
    });

/* ══════════════════════════════  SINCRONIZAÇÃO  ═══════════════════════════ */

window.api.on("apply-settings", (s) => { if (!recordingAction) applyToUI(s); });

let pendingBdayUpdate = null;

function isEditingBdayBoard() {
    const el = document.activeElement;
    if (!el || !bdayBoard.contains(el)) return false;
    return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "SELECT";
}

function applyBdayUpdate(fn) {
    if (isEditingBdayBoard()) { pendingBdayUpdate = fn; return; }
    fn();
    renderBdayBoard();
}

document.addEventListener("focusout", () => setTimeout(() => {
    if (!pendingBdayUpdate || isEditingBdayBoard()) return;
    const fn = pendingBdayUpdate;
    pendingBdayUpdate = null;
    fn();
    renderBdayBoard();
}, 0));

window.api.on("birthdays-updated", (updated) => {
    applyBdayUpdate(() => {
        const localById = new Map(birthdays.map(b => [b.id, b]));
        birthdays = updated.map(inc => {
            const local = localById.get(inc.id);
            return local && (local.updatedAt || 0) > (inc.updatedAt || 0) ? local : inc;
        });
    });
});

window.api.invoke("get-data").then(loaded => {
    booted = true;
    applyToUI(loaded.settings);
    birthdays = loaded.birthdays || [];
    renderBdayBoard();
    tags = loaded.tags || [];
    renderTagBoard();

    if (pendingQuickCreate) {
        pendingQuickCreate = false;
        setSettingsTab("aniversarios");
        createBirthday();
    }
}).catch(e => Log.error("[BOOT] get-data falhou, configurações não carregaram:", e.message));

window.api.invoke("get-app-version").then(version => {
    document.getElementById("app-version").textContent = `v${version}`;
    document.getElementById("app-version-inline").textContent = `v${version}`;
}).catch(e => Log.error("[BOOT] get-app-version falhou:", e.message));

/* ══════════════════════════════  ATUALIZAÇÕES  ════════════════════════════ */

const updateStatus   = document.getElementById("update-status");
const updateHint     = document.getElementById("update-hint");
const updateCheckBtn = document.getElementById("update-check-btn");
const updateDownloadBtn = document.getElementById("update-download-btn");

let updateUrl = null;

function applyUpdateResult(result) {
    if (!result.ok) {
        updateHint.textContent = "Não foi possível verificar agora: " + (result.error || "erro desconhecido")
            + ". Sem internet ou atrás de um proxy, isso é esperado.";
        updateDownloadBtn.classList.add("hidden");
        return;
    }
    if (result.noReleases) {
        updateHint.textContent = "Nenhuma versão publicada ainda no GitHub para comparar.";
        updateDownloadBtn.classList.add("hidden");
        return;
    }
    if (result.updateAvailable) {
        updateStatus.innerHTML = `Versão <b>${escapeHtml(result.latest)}</b> disponível — você está na v${escapeHtml(result.current)}`;
        updateHint.textContent = "O download é manual: o botão abaixo abre a página do release no navegador.";
        updateUrl = result.url;
        updateDownloadBtn.classList.remove("hidden");
        return;
    }
    updateStatus.textContent = `Versão instalada: v${result.current}`;
    updateHint.textContent = `Você já está na versão mais recente (${result.latest}).`;
    updateDownloadBtn.classList.add("hidden");
}

updateCheckBtn.addEventListener("click", async () => {
    updateCheckBtn.disabled = true;
    updateCheckBtn.textContent = "Verificando...";
    updateHint.textContent = "Consultando os releases no GitHub...";
    try {
        applyUpdateResult(await window.api.invoke("check-update"));
    } catch (e) {
        applyUpdateResult({ ok: false, error: e.message, current: "" });
        Log.error("[UPDATE] Verificação falhou:", e.message);
    } finally {
        updateCheckBtn.disabled = false;
        updateCheckBtn.textContent = "Verificar";
    }
});

updateDownloadBtn.addEventListener("click", () => {
    if (updateUrl) window.api.send("open-link", updateUrl);
});
