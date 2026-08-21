/* ────────────────────────────────  Main.js  ─────────────────────────────── */
const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage, screen, shell, globalShortcut, Notification } = require("electron");
const path = require("path");

const PATHS = require("./Paths");

const { loadData, saveData, saveDataSync } = require("./DataManager");
const { log, warn, registrarDeRenderer, capturarFalhasDoProcesso } = require("./Logger");
const EventUtils = require("./EventUtils");
const GoogleAuth = require("./GoogleAuth");
const GoogleCalendarSync = require("./GoogleCalendarSync");
const UpdateChecker = require("./UpdateChecker");
const RichText = require("./RichText");

/* ═══════════════════════════  INSTÂNCIA ÚNICA  ═══════════════════════════ */
if (!app.requestSingleInstanceLock()) {
    log("[APP] Instância já em execução. Encerrando esta.");
    app.quit();
    return;
}

capturarFalhasDoProcesso();

log("=== Note-Chan iniciado === versão", app.getVersion());
log("[PATHS] userData:", PATHS.userData);

/* ══════════════════════════════  ESTADO  ════════════════════════════════ */
let data = loadData();

let tray               = null;
let widgetWindow       = null;
let settingsWindow     = null;
let quickCaptureWindow = null;
let alarmWindow        = null;
let saveTimer          = null;

/* ════════════════════════  PREFERÊNCIAS DE JANELA  ══════════════════════ */
const SECURE_PREFS = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    preload: path.join(__dirname, "preload.js")
};

const DOCK_HEADER_HEIGHT = 32;
const DOCK_MARGIN = 2;
const DOCK_ANIM_MS = 190;
const DOCK_ANIM_FRAME_MS = 16;
let dockAnimTimer = null;
const NOTIFY_CHECK_INTERVAL_MS = 30 * 1000;
const NOTIFY_GRACE_MS = 15 * 60 * 1000;

const ALARM_SIZE = { width: 340, height: 300 };
const SNOOZE_MS = 5 * 60 * 1000;
const GOOGLE_SYNC_INTERVAL_MS = 15 * 60 * 1000;

/* ═════════════════════════════  UTILITÁRIOS  ════════════════════════════ */

function debouncedSaveData(delay = 500) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveData(data);
        saveTimer = null;
    }, delay);
}

function computeBounds(collapsed) {
    const { workArea } = screen.getPrimaryDisplay();
    const width = data.widget.width || 320;
    const size = collapsed
        ? { width, height: DOCK_HEADER_HEIGHT }
        : { width, height: data.widget.height || 480 };

    return {
        x: Math.round(workArea.x + DOCK_MARGIN),
        y: Math.round(workArea.y + workArea.height - size.height - DOCK_MARGIN),
        width: size.width,
        height: size.height
    };
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function animateWidgetBounds(target, onDone) {
    clearInterval(dockAnimTimer);
    dockAnimTimer = null;

    if (!widgetWindow || widgetWindow.isDestroyed()) { onDone?.(); return; }

    const from = widgetWindow.getBounds();
    const base = target.y + target.height;   

    if (from.height === target.height || !widgetWindow.isVisible()) {
        widgetWindow.setBounds(target, false);
        onDone?.();
        return;
    }

    const inicio = Date.now();
    dockAnimTimer = setInterval(() => {
        const fim = () => {
            clearInterval(dockAnimTimer);
            dockAnimTimer = null;
        };

        if (!widgetWindow || widgetWindow.isDestroyed()) { fim(); return; }

        if (!widgetWindow.isVisible()) {
            fim();
            widgetWindow.setBounds(target, false);
            onDone?.();
            return;
        }

        const t = Math.min(1, (Date.now() - inicio) / DOCK_ANIM_MS);
        const height = Math.round(from.height + (target.height - from.height) * easeOutCubic(t));
        widgetWindow.setBounds({ x: target.x, y: base - height, width: target.width, height }, false);

        if (t >= 1) {
            fim();
            widgetWindow.setBounds(target, false);  
            onDone?.();
        }
    }, DOCK_ANIM_FRAME_MS);
}

function setMode(collapsed) {
    const wasCollapsed = data.widget.collapsed;
    if (wasCollapsed !== collapsed) log("[WIDGET] Modo:", collapsed ? "bandeja" : "expandido");
    data.widget.collapsed = collapsed;
    debouncedSaveData();

    if (wasCollapsed && !collapsed) {
        checkNoTimeEventsToday();
        if (GoogleAuth.isConnected()) runGoogleSync();
    }

    if (!widgetWindow || widgetWindow.isDestroyed()) return;

    const alvo = computeBounds(collapsed);
    const avisar = (modo) => {
        if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.webContents.send("set-mode", modo);
    };

    if (collapsed) animateWidgetBounds(alvo, () => avisar("collapsed"));
    else { avisar("expanded"); animateWidgetBounds(alvo); }
}

/* ══════════════════════════════  IPC  ════════════════════════════════════ */

ipcMain.on("log-entry", (event, entrada) => registrarDeRenderer(entrada));

ipcMain.handle("get-data", () => data);
ipcMain.handle("get-app-version", () => app.getVersion());

function queueGoogleDeletes(removed) {
    const ids = removed.filter(item => item.googleEventId).map(item => item.googleEventId);
    if (ids.length) data.googleSync.pendingDeletes.push(...ids);
}

function mergeMainOwnedList(existingList, incoming, ownedFields) {
    const incomingIds = new Set(incoming.map(item => item.id));
    queueGoogleDeletes(existingList.filter(item => !incomingIds.has(item.id)));
    return incoming.map(item => {
        const existing = existingList.find(e => e.id === item.id);
        if (!existing) return item;
        const preserved = {};
        for (const field of ownedFields) preserved[field] = existing[field];
        return { ...item, ...preserved };
    });
}

ipcMain.on("save-data", (event, payload) => {
    if (!payload) return;
    if (Array.isArray(payload.notes)) {
        data.notes = payload.notes;
        syncNoteWindows();
    }
    data.lists = Array.isArray(payload.lists) ? payload.lists : data.lists;
    if (Array.isArray(payload.birthdays)) {
        data.birthdays = mergeMainOwnedList(data.birthdays, payload.birthdays, ["googleEventId", "googleSyncedAt"]);
    }
    if (Array.isArray(payload.events)) {
        data.events = mergeMainOwnedList(data.events, payload.events, ["lastNotified", "lastNoTimeNotified", "googleEventId", "googleSyncedAt", "foreign"]);
    }
    if (Array.isArray(payload.tags)) {
        const removedIds = data.tags
            .filter(t => !payload.tags.some(nt => nt.id === t.id))
            .map(t => t.id);
        data.tags = payload.tags;
        if (removedIds.length) {
            const strip = arr => arr.forEach(item => {
                if (Array.isArray(item.tagIds)) item.tagIds = item.tagIds.filter(id => !removedIds.includes(id));
            });
            strip(data.notes);
            strip(data.lists);
            strip(data.events);
            log("[TAGS] Removida(s) de todos os itens:", removedIds.join(", "));
        }
        widgetWindow?.webContents.send("tags-updated", data.tags);
    }
    if (payload.widget && payload.widget.activeTab) {
        data.widget.activeTab = payload.widget.activeTab;
    }
    if (payload.tamagotchi) {
        data.tamagotchi = {
            ...data.tamagotchi,
            ...payload.tamagotchi,
            lastLowNotified: data.tamagotchi.lastLowNotified
        };
    }
    debouncedSaveData();
});

ipcMain.on("save-settings", (event, settings) => {
    if (!settings) return;
    const shortcutsChanged =
        settings.shortcuts && Object.keys(settings.shortcuts).some(
            key => settings.shortcuts[key] !== data.settings.shortcuts[key]
        );

    data.settings = {
        ...data.settings,
        ...settings,
        shortcuts: { ...data.settings.shortcuts, ...settings.shortcuts },
        editor: { ...data.settings.editor, ...settings.editor },
        editorShortcuts: { ...data.settings.editorShortcuts, ...settings.editorShortcuts },
        alarm: { ...data.settings.alarm, ...settings.alarm }
    };
    log("[SETTINGS] Atualizado:", JSON.stringify(settings));
    debouncedSaveData();
    broadcastSettings();
    if (shortcutsChanged) registerShortcuts();
});

ipcMain.on("open-settings", () => openSettingsWindow());
ipcMain.on("close-settings", () => settingsWindow?.close());
ipcMain.on("settings-minimize", () => settingsWindow?.minimize());

ipcMain.on("quick-capture-submit", (event, text) => {
    const trimmed = (text || "").trim();
    hideQuickCapture();
    if (!trimmed) return;

    const lines = trimmed.split("\n");
    const note = {
        id: require("crypto").randomUUID(),
        title: lines[0].slice(0, 60) || "Captura rápida",
        content: RichText.fromPlainText(trimmed),
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    data.notes.unshift(note);
    log("[QUICK-CAPTURE] Nota criada:", note.title);
    debouncedSaveData();
    widgetWindow?.webContents.send("notes-updated", data.notes);
});

ipcMain.on("quick-capture-cancel", () => hideQuickCapture());

ipcMain.on("quit-app", () => { log("[APP] Saída solicitada pelo usuário."); app.quit(); });

ipcMain.on("close-widget", () => {
    if (data.widget.collapsed) {
        widgetWindow?.hide();
    } else {
        setMode(true);
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

ipcMain.on("collapse-widget", () => setMode(true));
ipcMain.on("expand-widget", () => setMode(false));

function urlExternaSegura(url) {
    if (typeof url !== "string" || !url.trim()) return null;
    const bruto = url.trim();

    let comEsquema = null;
    try { comEsquema = new URL(bruto); } catch { /* sem esquema: completa abaixo */ }

    const ehWeb = (u) => u.protocol === "http:" || u.protocol === "https:";

    if (comEsquema) {
        return ehWeb(comEsquema) ? comEsquema.href : null;
    }

    try {
        const parsed = new URL(`https://${bruto}`);
        return ehWeb(parsed) ? parsed.href : null;
    } catch {
        return null;
    }
}

function abrirNoNavegador(url, contexto) {
    const alvo = urlExternaSegura(url);
    if (!alvo) { warn("[SECURITY] Endereço externo recusado", contexto, url); return false; }
    shell.openExternal(alvo);
    return true;
}

ipcMain.on("open-link", (event, url) => abrirNoNavegador(url, "(link de evento)"));

/* ═══════════════════════  SINCRONIZAÇÃO COM O GOOGLE  ═════════════════════ */

function pushSyncedDataToRenderers() {
    widgetWindow?.webContents.send("events-updated", data.events);
    settingsWindow?.webContents.send("birthdays-updated", data.birthdays);
}

let syncInFlight = null;

async function doGoogleSync() {
    const result = await GoogleCalendarSync.runSync(data);
    if (result.ok) {
        log("[GOOGLE] Sincronização concluída —", result.count, "eventos processados");
        debouncedSaveData();
        pushSyncedDataToRenderers();
    } else if (result.error !== "not-connected") {
        warn("[GOOGLE] Sincronização falhou:", result.error);
    }
    return result;
}

function runGoogleSync() {
    if (syncInFlight) {
        log("[GOOGLE] Sincronização já em andamento — reaproveitando a atual.");
        return syncInFlight;
    }
    syncInFlight = doGoogleSync().finally(() => { syncInFlight = null; });
    return syncInFlight;
}

ipcMain.handle("google-auth-status", () => ({
    configured: GoogleAuth.isConfigured(),
    connected: GoogleAuth.isConnected(),
    email: GoogleAuth.getEmail(),
    lastSyncAt: data.googleSync.lastSyncAt
}));

ipcMain.handle("google-auth-start", async () => {
    const result = await GoogleAuth.startOAuthFlow(); // rejeita a promise no invoke se falhar/cancelar
    runGoogleSync(); // primeira sincronização logo após conectar, sem esperar o usuário abrir/fechar o widget
    return { connected: true, email: result.email };
});

ipcMain.handle("google-disconnect", async () => {
    await GoogleAuth.disconnect();
    return { connected: false };
});

ipcMain.handle("google-sync-now", () => runGoogleSync());

/* ══════════════════════════  ATUALIZAÇÃO DE VERSÃO  ══════════════════════ */

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_BOOT_DELAY_MS = 20 * 1000; // não disputa com a abertura do app

function showUpdateNotification(result) {
    if (!Notification.isSupported()) return;
    const n = new Notification({
        title: "Note-Chan",
        body: `A versão ${result.latest} saiu (você está na ${result.current}). Clique para abrir a página de download.`,
        icon: path.join(__dirname, "../../assets/img/icon.png")
    });
    n.on("click", () => abrirNoNavegador(result.url, "(release)"));
    n.show();
}

async function checkForUpdatesInBackground() {
    const state = data.updateCheck;
    if (Date.now() - (state.lastCheckAt || 0) < UPDATE_CHECK_INTERVAL_MS) return;

    const result = await UpdateChecker.check();
    state.lastCheckAt = Date.now();
    debouncedSaveData();

    if (!result.ok || !result.updateAvailable) return;
    if (state.notifiedVersion === result.latest) return;
    state.notifiedVersion = result.latest;
    debouncedSaveData();
    showUpdateNotification(result);
}

ipcMain.handle("check-update", async () => {
    const result = await UpdateChecker.check();
    data.updateCheck.lastCheckAt = Date.now();
    if (result.updateAvailable) data.updateCheck.notifiedVersion = result.latest;
    debouncedSaveData();
    return result;
});

/* ═════════════════════════════  ÍCONE DA BANDEJA  ════════════════════════ */

function buildTrayIcon() {
    const iconPath = path.join(__dirname, "../../assets/img/icon.png");
    const img = nativeImage.createFromPath(iconPath);
    return img.isEmpty() ? nativeImage.createEmpty() : img;
}

/* ═════════════════════════  CRIAÇÃO DE JANELA  ══════════════════════════ */

function createWidgetWindow() {
    const bounds = computeBounds(data.widget.collapsed);

    widgetWindow = new BrowserWindow({
        ...bounds,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        webPreferences: SECURE_PREFS
    });

    widgetWindow.setAlwaysOnTop(true, "screen-saver");
    widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    widgetWindow.loadFile(path.join(__dirname, "../html/widget.html"));

    if (!app.isPackaged) {
        widgetWindow.webContents.openDevTools({ mode: "detach" });
    }

    widgetWindow.on("closed", () => { log("[WINDOW] widget fechado"); widgetWindow = null; });
    log("[WINDOW] widget criado —", data.widget.collapsed ? "bandeja" : "expandido", "@", JSON.stringify(bounds));
}

function repositionWidget() {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    widgetWindow.setBounds(computeBounds(data.widget.collapsed), false);
}

function showWidget() {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
        repositionWidget();
        widgetWindow.show();
        widgetWindow.focus();
    } else {
        createWidgetWindow();
    }
}

function openWidgetExpanded() {
    showWidget();
    setMode(false);
}

function quickCreate(type) {
    log("[TRAY] Criação rápida:", type);
    if (type === "aniversario") {
        openSettingsWindow(() => settingsWindow.webContents.send("quick-create", type));
        return;
    }
    setMode(false);
    showWidget();
    widgetWindow.webContents.send("quick-create", type);
}

/* ═════════════════════════════  CONFIGURAÇÕES  ═══════════════════════════ */

function broadcastSettings() {
    [widgetWindow, settingsWindow, quickCaptureWindow, alarmWindow, ...noteWindows.values()]
        .filter(w => w && !w.isDestroyed())
        .forEach(w => w.webContents.send("apply-settings", data.settings));
}

function createSettingsWindow() {
    settingsWindow = new BrowserWindow({
        width: 380,
        height: 620,
        resizable: false,
        title: "Configurações — Note-Chan",
        frame: false,
        show: false,      
        webPreferences: SECURE_PREFS
    });

    settingsWindow.loadFile(path.join(__dirname, "../html/settings.html"));

    settingsWindow.once("ready-to-show", () => {
        if (settingsWindow && !settingsWindow.isDestroyed()) {
            settingsWindow.show();
            settingsWindow.focus();
        }
    });
    settingsWindow.on("closed", () => { log("[WINDOW] configurações fechada"); settingsWindow = null; });
    log("[WINDOW] configurações criada");
}

function openSettingsWindow(onReady) {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.show();
        settingsWindow.focus();
        if (onReady) onReady();
    } else {
        createSettingsWindow();
        if (onReady) settingsWindow.webContents.once("did-finish-load", onReady);
    }
}

/* ═══════════════════  NOTA EM JANELA (BLOCO DE NOTAS)  ════════════════════ */

const noteWindows = new Map();
const NOTE_WINDOW_MIN = { width: 380, height: 240 };
const NOTE_WINDOW_DEFAULT = { width: 520, height: 460 };

function noteWindowBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const width = data.noteWindow?.width || NOTE_WINDOW_DEFAULT.width;
    const height = data.noteWindow?.height || NOTE_WINDOW_DEFAULT.height;
    const offset = (noteWindows.size % 6) * 26;
    return {
        width,
        height,
        x: Math.round(workArea.x + (workArea.width - width) / 2 + offset),
        y: Math.round(workArea.y + (workArea.height - height) / 2 + offset)
    };
}

function discardUntouchedNote(noteId) {
    const note = data.notes.find(n => n.id === noteId);
    if (!note || note.title !== "Nova nota" || !RichText.isEmpty(note.content)) return;
    data.notes = data.notes.filter(n => n.id !== noteId);
    log("[NOTA] Nota em branco descartada ao fechar a janela:", noteId);
    debouncedSaveData();
    widgetWindow?.webContents.send("notes-updated", data.notes);
}

function openNoteWindow(noteId) {
    const existing = noteWindows.get(noteId);
    if (existing && !existing.isDestroyed()) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
        return;
    }
    if (!data.notes.some(n => n.id === noteId)) {
        warn("[NOTA] Janela pedida para uma nota que não existe:", noteId);
        return;
    }

    const win = new BrowserWindow({
        ...noteWindowBounds(),
        minWidth: NOTE_WINDOW_MIN.width,
        minHeight: NOTE_WINDOW_MIN.height,
        frame: false,
        resizable: true,
        movable: true,
        skipTaskbar: false,   // ao contrário do widget, esta é uma janela "de verdade"
        show: false,          // só aparece pronta, sem lampejo de fundo branco
        webPreferences: SECURE_PREFS
    });

    noteWindows.set(noteId, win);
    win.loadFile(path.join(__dirname, "../html/note.html"), { query: { id: noteId } });
    win.once("ready-to-show", () => win.show());

    win.on("resized", () => {
        if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
        const [width, height] = win.getSize();
        data.noteWindow = { width, height };
        debouncedSaveData(1000);
    });

    win.on("closed", () => {
        noteWindows.delete(noteId);
        discardUntouchedNote(noteId);
        log("[NOTA] Janela fechada:", noteId);
    });

    log("[NOTA] Janela aberta:", noteId);
}

function syncNoteWindows() {
    for (const [id, win] of noteWindows) {
        if (win.isDestroyed()) { noteWindows.delete(id); continue; }
        const note = data.notes.find(n => n.id === id);
        if (!note) { win.close(); continue; }
        win.webContents.send("note-updated", note);
    }
}

function createNoteInWindow() {
    const note = {
        id: require("crypto").randomUUID(),
        title: "Nova nota",
        content: "",
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    data.notes.unshift(note);
    log("[NOTA] Nota criada já em janela.");
    debouncedSaveData();
    widgetWindow?.webContents.send("notes-updated", data.notes);
    openNoteWindow(note.id);
}

ipcMain.on("open-note-window", (event, noteId) => {
    if (typeof noteId === "string" && noteId) openNoteWindow(noteId);
});

ipcMain.handle("note-data", (event, noteId) => data.notes.find(n => n.id === noteId) || null);

ipcMain.on("note-save", (event, payload) => {
    if (!payload || typeof payload.id !== "string") return;
    const note = data.notes.find(n => n.id === payload.id);
    if (!note) return;
    note.title = (payload.title || "").trim() || "Sem título";
    if (typeof payload.content === "string") note.content = payload.content;
    note.updatedAt = Date.now();
    debouncedSaveData();
    widgetWindow?.webContents.send("notes-updated", data.notes);
});

function janelaDeNota(event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    for (const aberta of noteWindows.values()) {
        if (aberta === win) return win;
    }
    warn("[NOTA] Comando de janela recusado: quem enviou não é uma janela de nota.");
    return null;
}

ipcMain.on("note-close", (event) => janelaDeNota(event)?.close());
ipcMain.on("note-minimize", (event) => janelaDeNota(event)?.minimize());

/* ═════════════════════════════  CAPTURA RÁPIDA  ══════════════════════════ */

const QUICK_CAPTURE_SIZE = { width: 440, height: 56 };

function createQuickCaptureWindow() {
    quickCaptureWindow = new BrowserWindow({
        ...QUICK_CAPTURE_SIZE,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: SECURE_PREFS
    });

    quickCaptureWindow.setAlwaysOnTop(true, "screen-saver");
    quickCaptureWindow.loadFile(path.join(__dirname, "../html/quickcapture.html"));
    quickCaptureWindow.on("blur", hideQuickCapture);
    quickCaptureWindow.on("closed", () => (quickCaptureWindow = null));
    log("[WINDOW] captura rápida criada");
}

function showQuickCapture() {
    if (!quickCaptureWindow || quickCaptureWindow.isDestroyed()) {
        createQuickCaptureWindow();
    }

    const { workArea } = screen.getPrimaryDisplay();
    const x = Math.round(workArea.x + (workArea.width - QUICK_CAPTURE_SIZE.width) / 2);
    const y = Math.round(workArea.y + workArea.height * 0.3);
    quickCaptureWindow.setBounds({ x, y, ...QUICK_CAPTURE_SIZE });

    quickCaptureWindow.webContents.send("reset");
    quickCaptureWindow.show();
    quickCaptureWindow.focus();
}

function hideQuickCapture() {
    if (quickCaptureWindow && !quickCaptureWindow.isDestroyed()) {
        quickCaptureWindow.hide();
    }
}

/* ═════════════════════════════  ATALHOS GLOBAIS  ═════════════════════════ */

function toggleWidgetVisibility() {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
        createWidgetWindow();
        return;
    }
    if (!widgetWindow.isVisible()) {
        showWidget();
        setMode(false);
        return;
    }
    setMode(!data.widget.collapsed);
}

function registerShortcuts() {
    globalShortcut.unregisterAll();

    const { toggleWidget, quickCapture, newNoteWindow } = data.settings.shortcuts;
    const bindings = [
        [toggleWidget, toggleWidgetVisibility],
        [quickCapture, showQuickCapture],
        [newNoteWindow, createNoteInWindow]
    ];

    for (const [accelerator, handler] of bindings) {
        if (!accelerator) continue;
        try {
            const ok = globalShortcut.register(accelerator, handler);
            if (ok) log("[SHORTCUTS] Registrado:", accelerator);
            else warn("[SHORTCUTS] Não foi possível registrar (em uso por outro app):", accelerator);
        } catch (err) {
            warn("[SHORTCUTS] Atalho inválido:", accelerator, err.message);
        }
    }
}

/* ═══════════════════════════════  ALARME  ════════════════════════════════ */

let alarmQueue = [];
let alarmShowing = false;

function createAlarmWindow() {
    alarmWindow = new BrowserWindow({
        ...ALARM_SIZE,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: SECURE_PREFS
    });

    alarmWindow.setAlwaysOnTop(true, "screen-saver");
    alarmWindow.loadFile(path.join(__dirname, "../html/alarm.html"));
    alarmWindow.on("closed", () => (alarmWindow = null));
    log("[WINDOW] alarme criado");
}

function showNextAlarm() {
    if (alarmQueue.length === 0) { alarmShowing = false; return; }
    alarmShowing = true;

    const next = alarmQueue[0];
    if (!alarmWindow || alarmWindow.isDestroyed()) createAlarmWindow();

    const { workArea } = screen.getPrimaryDisplay();
    alarmWindow.setBounds({
        x: Math.round(workArea.x + (workArea.width - ALARM_SIZE.width) / 2),
        y: Math.round(workArea.y + (workArea.height - ALARM_SIZE.height) / 2),
        ...ALARM_SIZE
    });

    const payload = {
        title: next.title,
        time: next.startTime,
        volume: data.settings.alarm.volume,
        sound: data.settings.alarm.sound,
        tamagotchi: data.tamagotchi
    };
    const send = () => alarmWindow.webContents.send("alarm-ring", payload);
    if (alarmWindow.webContents.isLoading()) alarmWindow.webContents.once("did-finish-load", send);
    else send();

    alarmWindow.show();
    alarmWindow.focus();
}

function fireAlarm(evt) {
    log("[ALARM] Tocando:", evt.title, "às", evt.startTime);
    alarmQueue.push({ id: evt.id, title: evt.title, startTime: evt.startTime });
    if (!alarmShowing) showNextAlarm();
}

ipcMain.on("alarm-stop", () => {
    const evt = alarmQueue.shift();
    if (evt) log("[ALARM] Parado:", evt.title);
    alarmWindow?.hide();
    showNextAlarm();
});

ipcMain.on("alarm-snooze", () => {
    const evt = alarmQueue.shift();
    alarmWindow?.hide();
    if (evt) {
        log("[ALARM] Soneca:", evt.title, `— toca de novo em ${SNOOZE_MS / 60000} min`);
        setTimeout(() => fireAlarm(evt), SNOOZE_MS);
    }
    showNextAlarm();
});

/* ═══════════════════════  NOTIFICAÇÕES DE EVENTOS  ═══════════════════════ */

function checkEventNotifications() {
    if (!Array.isArray(data.events) || data.events.length === 0) return;

    const now = Date.now();
    let changed = false;

    for (const evt of data.events) {
        if (!evt.startTime) continue;

        const occ = EventUtils.getNextOccurrence(evt);
        if (!occ || evt.lastNotified === occ) continue;

        const target = EventUtils.occurrenceDateTime(occ, evt.startTime).getTime();
        const diff = now - target;
        if (diff < 0) continue; // ainda não chegou a hora

        if (diff > NOTIFY_GRACE_MS) {
            evt.lastNotified = occ;
            changed = true;
            log("[EVENTS] Ocorrência muito atrasada, alarme suprimido:", evt.title, occ);
        } else if (data.settings.alarm.enabled) {
            evt.lastNotified = occ;
            changed = true;
            fireAlarm(evt);
        }
    }

    if (changed) debouncedSaveData();
}

/* ═════════════════════  NOTIFICAÇÕES DO BICHINHO  ═════════════════════════ */

function showPetNotification(body) {
    if (!Notification.isSupported()) return;
    const n = new Notification({
        title: "Note-Chan",
        body,
        icon: path.join(__dirname, "../../assets/img/icon.png")
    });
    n.on("click", () => {
        openWidgetExpanded();
        widgetWindow?.webContents.send("open-tama");
    });
    n.show();
}

const TAMA_LOW_THRESHOLD = 25;
const TAMA_NOTIFY_COOLDOWN_MS = 3 * 60 * 60 * 1000; 

const TAMA_LOW_MESSAGES = {
    fome: [
        "Tô com uma fominha aqui... que tal completar uma tarefa? Isso me alimenta!",
        "Meu estômago tá roncando um pouco. Uma tarefinha concluída ajudaria bastante."
    ],
    higiene: [
        "Já faz um tempinho que eu não tomo um banho...",
        "Acho que eu podia dar uma arrumada em mim. Bora na aba Higiene?"
    ],
    carencia: [
        "Senti sua falta! Dá uma passadinha aqui quando puder?",
        "Que tal um carinho rapidinho? Prometo que só isso já me alegra."
    ],
    vida: [
        "Tô meio pra baixo... um pouco de atenção nos meus outros status já ajuda a melhorar."
    ]
};

function pickTamaMessage(stat) {
    const options = TAMA_LOW_MESSAGES[stat];
    return options[Math.floor(Math.random() * options.length)];
}

function checkTamaNotifications() {
    const tama = data.tamagotchi;
    if (!tama) return;

    tama.lastLowNotified = tama.lastLowNotified || {};
    const now = Date.now();
    let changed = false;

    for (const stat of ["fome", "higiene", "carencia", "vida"]) {
        if (tama[stat] >= TAMA_LOW_THRESHOLD) continue;
        const last = tama.lastLowNotified[stat] || 0;
        if (now - last < TAMA_NOTIFY_COOLDOWN_MS) continue;

        tama.lastLowNotified[stat] = now;
        changed = true;
        log("[TAMA] Status baixo, notificando:", stat, tama[stat]);
        showPetNotification(pickTamaMessage(stat));
    }

    if (changed) debouncedSaveData();
}

/* ═══════════════════  EVENTOS SEM HORÁRIO (AO ABRIR O APP)  ═══════════════ */

function checkNoTimeEventsToday() {
    if (!Array.isArray(data.events) || data.events.length === 0) return;

    const today = EventUtils.todayISO();
    const todays = [];
    let changed = false;

    for (const evt of data.events) {
        if (evt.startTime) continue; // esses já têm o alarme
        const occ = EventUtils.getNextOccurrence(evt);
        if (occ !== today) continue;
        if (evt.lastNoTimeNotified === today) continue;

        evt.lastNoTimeNotified = today;
        changed = true;
        todays.push(evt.title);
    }

    if (!changed) return;
    debouncedSaveData();

    if (todays.length === 1) {
        showPetNotification(`Hoje tem "${todays[0]}" na agenda! Não esquece.`);
    } else if (todays.length <= 3) {
        showPetNotification(`Hoje tem: ${todays.join(", ")}.`);
    } else {
        showPetNotification(`Você tem ${todays.length} eventos sem horário marcado hoje.`);
    }
}

function createTray() {
    try {
        tray = new Tray(buildTrayIcon());
    } catch (err) {
        warn("[TRAY] Falha ao criar ícone da bandeja:", err.message);
        return;
    }

    tray.setToolTip("Note-Chan");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Abrir Note-Chan", click: openWidgetExpanded },
        { label: "Captura rápida", click: showQuickCapture },
        { type: "separator" },
        { label: "Nova nota",  click: () => quickCreate("nota") },
        { label: "Nova nota em janela", click: createNoteInWindow },
        { label: "Nova lista", click: () => quickCreate("lista") },
        { label: "Novo evento", click: () => quickCreate("evento") },
        { label: "Novo aniversariante", click: () => quickCreate("aniversario") },
        { type: "separator" },
        { label: "Configurações", click: openSettingsWindow },
        { type: "separator" },
        { label: "Sair", click: () => app.quit() }
    ]));

    tray.on("double-click", openWidgetExpanded);
}

/* ═══════════════════════  ENDURECIMENTO DE SEGURANÇA  ═══════════════════ */

app.on("web-contents-created", (event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));

    contents.on("will-navigate", (e, url) => {
        if (!url.startsWith("file://")) {
            e.preventDefault();
            warn("[SECURITY] Navegação externa bloqueada:", url);
        }
    });

    contents.on("will-attach-webview", (e) => e.preventDefault());

    contents.on("render-process-gone", (e, detalhes) => {
        warn("[FALHA] Renderer encerrado:", detalhes.reason, "— código", detalhes.exitCode);
    });
    contents.on("preload-error", (e, caminho, erro) => {
        warn("[FALHA] preload falhou em", caminho, "—", erro.message);
    });
    contents.on("did-fail-load", (e, codigo, descricao, url) => {
        if (codigo === -3) return;
        warn("[FALHA] Carregamento falhou:", url, "—", descricao, codigo);
    });
});

app.on("second-instance", () => {
    log("[APP] Segunda instância tentou abrir — focando a existente.");
    openWidgetExpanded();
});

/* ════════════════════════════════  CICLO DE VIDA  ═══════════════════════ */

app.whenReady().then(() => {
    if (process.platform === "win32") {
        app.setAppUserModelId("com.renato.notechan");
    }

    GoogleAuth.loadStoredToken();
    createTray();
    createWidgetWindow();
    createQuickCaptureWindow();
    createAlarmWindow();
    registerShortcuts();

    screen.on("display-metrics-changed", repositionWidget);
    screen.on("display-added", repositionWidget);
    screen.on("display-removed", repositionWidget);

    checkEventNotifications();
    setInterval(checkEventNotifications, NOTIFY_CHECK_INTERVAL_MS);
    checkTamaNotifications();
    setInterval(checkTamaNotifications, NOTIFY_CHECK_INTERVAL_MS);

    setInterval(() => {
        if (GoogleAuth.isConnected()) runGoogleSync();
    }, GOOGLE_SYNC_INTERVAL_MS);

    if (app.isPackaged) {
        setTimeout(checkForUpdatesInBackground, UPDATE_CHECK_BOOT_DELAY_MS);
        setInterval(checkForUpdatesInBackground, UPDATE_CHECK_INTERVAL_MS);
    }
});

app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (saveTimer) clearTimeout(saveTimer);
    saveDataSync(data);
    const { flushSync } = require("./Logger");
    flushSync();
    log("=== Note-Chan encerrado ===");
});

app.on("window-all-closed", () => { /* intencionalmente vazio */ });

app.on("activate", openWidgetExpanded);
