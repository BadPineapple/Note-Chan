/* ──────────────────────────────  Settings.js  ────────────────────────────── */
// Renderer da janela de Configurações.

let settings = { theme: "gold", transparency: 60, shortcuts: {}, alarm: { enabled: true, volume: 70, sound: "sininho" } };
let recordingAction = null;

// Enquanto o get-data do boot não voltar, `birthdays` e `tags` ainda são
// arrays vazios. Um save disparado nesse intervalo mandaria a lista vazia
// pro main, que trata item ausente como EXCLUÍDO (ver mergeMainOwnedList em
// Main.js) -- caminho real: bandeja -> "Novo aniversariante" com esta janela
// fechada, que abre a janela e manda o quick-create logo depois do
// did-finish-load, sem garantia de que o get-data já respondeu.
let booted = false;

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

// Cada save volta como broadcast apply-settings (o main avisa todas as
// janelas), inclusive esta. Reaplicar um controle que o usuário está mexendo
// AGORA faz o slider pular pro valor de um instante atrás no meio do
// arrasto -- por isso o que está em foco fica de fora. A lista de sons, pelo
// mesmo motivo, só é redesenhada quando o som selecionado muda de verdade.
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

// AlarmSounds.js é compartilhado com o popup de alarme (que não carrega
// Icons.js), então o label lá fica em texto puro -- o ícone por som mora só
// aqui, que é quem efetivamente usa innerHTML pra desenhar a lista.
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

/* ═══════════  CARD RECÉM-CRIADO QUE NINGUÉM CHEGOU A PREENCHER  ═══════════ */
// "+ Novo aniversariante" e "+ Nova tag" já criam o card com um nome padrão.
// Clicar algumas vezes sem preencher deixava uma pilha de "Novo
// aniversariante"/"Nova tag" sem conteúdo real. O card que nasceu e ninguém
// tocou some sozinho em quatro momentos: quando o foco sai dele, quando
// outro é criado, ao trocar de aba e ao fechar a janela.
//
// "Tocou" é comparação com o estado de criação (nome padrão, categoria
// vazia, data/cor iguais às do nascimento) em vez de uma marcação de
// "sujo" -- assim não depende de lembrar de marcar em cada campo novo que
// venha a existir. Só um card por tipo pode estar nesse estado por vez:
// criar outro descarta o anterior.
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
    if (b.name !== NEW_BIRTHDAY_NAME || b.category || b.date !== date) return; // foi preenchido

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
    if (t.name !== NEW_TAG_NAME || t.color !== color) return; // foi preenchido

    tags = tags.filter(x => x.id !== id);
    scheduleTagSave();
    renderTagBoard();
}

function discardPristine() {
    discardPristineBirthday();
    discardPristineTag();
}

// Fechar a janela não espera o debounce de 400 ms dos saves — manda na hora.
function flushPendingSaves() {
    if (bdaySaveTimer) { clearTimeout(bdaySaveTimer); bdaySaveTimer = null; window.api.send("save-data", { birthdays }); }
    if (tagSaveTimer) { clearTimeout(tagSaveTimer); tagSaveTimer = null; window.api.send("save-data", { tags }); }
}

window.addEventListener("beforeunload", () => {
    discardPristine();
    flushPendingSaves();
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

// Texto puro (usado no <select>, que não renderiza HTML/ícone dentro de
// <option>) -- BIRTHDAY_CATEGORY_ICONS é só pro badge, que aceita innerHTML.
const BIRTHDAY_CATEGORY_LABELS = { "": "Sem categoria", familia: "Família", amigo: "Amigo", trabalho: "Trabalho" };
const BIRTHDAY_CATEGORY_ICONS = { familia: "users", amigo: "user", trabalho: "briefcase" };

// Compartilhadas com o widget — ver UiUtils.js.
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
    if (!booted) return; // ver comentário de `booted` no topo do arquivo
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

    // Foco saiu do card inteiro e ele continua exatamente como nasceu -> some
    // sozinho (ver "CARD RECÉM-CRIADO" acima). clickStartedInside evita
    // descartar no mousedown de um clique que é dentro do próprio card.
    card.addEventListener("focusout", () => {
        setTimeout(() => {
            if (pristine.birthdayId !== birthday.id) return;
            if (card.contains(document.activeElement)) return;
            if (clickStartedInside(card)) return;
            discardPristineBirthday();
        }, 0);
    });

    card.querySelector(".card-header").addEventListener("click", (e) => {
        if (e.detail > 1) return; // 2º clique do duplo-clique — quem trata é o dblclick
        card.classList.toggle("expanded");
        if (card.classList.contains("expanded")) bdayExpanded.add(birthday.id);
        else bdayExpanded.delete(birthday.id);
    });

    const title = card.querySelector(".card-title");
    title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        // O 1º clique do duplo-clique pode ter recolhido o card. Reabre antes
        // de editar: quem dá dois cliques no nome quer renomear, não fechar.
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

// Criar antes do boot terminar montaria o aniversariante sobre o array vazio
// e ele sumiria quando o get-data chegasse -- guarda e executa depois.
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
            <span class="tag-color-dot" style="background:#${tag.color}"></span>
            <span class="tag-name" contenteditable="false" spellcheck="false">${escapeHtml(tag.name)}</span>
        </div>
        <div class="tag-swatches">
            ${TagUtils.PALETTE.map(hex =>
                `<button type="button" class="tag-swatch ${hex === tag.color ? "selected" : ""}" data-hex="${hex}" style="background:#${hex}"></button>`
            ).join("")}
        </div>
    `;

    // Mesma regra dos aniversariantes: tag que nasceu e ninguém preencheu
    // some quando o foco sai dela (ver "CARD RECÉM-CRIADO" acima).
    card.addEventListener("focusout", () => {
        setTimeout(() => {
            if (pristine.tagId !== tag.id) return;
            if (card.contains(document.activeElement)) return;
            if (clickStartedInside(card)) return;
            discardPristineTag();
        }, 0);
    });

    const nameEl = card.querySelector(".tag-name");
    // Um clique só (não dois) -- diferente do título de nota/lista/evento, a
    // tag não tem nada mais reagindo ao clique aqui (não expande/recolhe
    // nada), então dblclick só criava uma pegadinha: o cursor já diz "text"
    // mas só entrava em edição no segundo clique.
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
    const status = await window.api.invoke("google-disconnect");
    applyGoogleStatus({ configured: true, ...status });
});

googleSyncBtn.addEventListener("click", async () => {
    googleSyncBtn.disabled = true;
    googleSyncBtn.textContent = "Sincronizando...";
    try {
        const result = await window.api.invoke("google-sync-now");
        googleSyncHint.textContent = result.ok
            ? formatSyncTime(Date.now())
            : "Falha na sincronização: " + (result.error || "erro desconhecido");
    } finally {
        googleSyncBtn.disabled = false;
        googleSyncBtn.innerHTML = `${Icons.svg("refresh-cw", 14)} Sincronizar agora`;
    }
});

window.api.invoke("google-auth-status").then(applyGoogleStatus);

/* ══════════════════════════════  SINCRONIZAÇÃO  ═══════════════════════════ */

window.api.on("apply-settings", (s) => { if (!recordingAction) applyToUI(s); });

// Sincronização com o Google Agenda alterou os aniversariantes (criou o
// vínculo googleEventId ou removeu um cancelado do lado de lá) -- ver Main.js.
// Igual ao widget: mescla por id preferindo o que foi editado aqui mais
// recentemente, e espera o foco sair antes de redesenhar, senão o card em
// edição é destruído no meio da digitação. Os campos de propriedade do main
// (googleEventId etc.) não se perdem ao manter o objeto local -- o próprio
// main os repõe no save (ver mergeMainOwnedList em Main.js).
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
});

window.api.invoke("get-app-version").then(version => {
    document.getElementById("app-version").textContent = `v${version}`;
});
