/* ────────────────────────────────  Main.js  ─────────────────────────────── */
const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage, screen, shell, globalShortcut, Notification } = require("electron");
const path = require("path");

// PATHS PRECISA SER O PRIMEIRO MÓDULO INTERNO — define app.setName() antes
// de qualquer getPath(), senão o Electron cacheia o diretório errado.
const PATHS = require("./Paths");

const { loadData, saveData, saveDataSync } = require("./DataManager");
const { log, warn } = require("./Logger");
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

// Widget "de dock": duas medidas fixas, sempre ancorado no canto inferior
// esquerdo da área útil da tela (workArea já exclui a barra de tarefas,
// não importa a borda em que ela esteja — se não houver barra de tarefas
// embaixo, workArea vai até a borda física da tela).
// No modo bandeja só a barra de título fica visível (mesma largura do
// painel expandido) — ver #container.collapsed em Style.css. Precisa bater
// EXATAMENTE com a altura do #dragbar (32px, sem padding do #panel ao
// redor — ver comentário em Style.css), senão sobra uma faixa da cor de
// fundo do painel acima/abaixo do cabeçalho no modo bandeja.
const DOCK_HEADER_HEIGHT = 32;
const DOCK_MARGIN = 2;

// Checagem periódica de notificações de eventos, e a "janela de tolerância":
// além dela um horário perdido (app fechado/dormindo) não dispara mais,
// só fica marcado como já visto pra não notificar tarde demais.
const NOTIFY_CHECK_INTERVAL_MS = 30 * 1000;
const NOTIFY_GRACE_MS = 15 * 60 * 1000;

const ALARM_SIZE = { width: 340, height: 300 };
const SNOOZE_MS = 5 * 60 * 1000;

// Sincronização de fundo com o Google. Sem ela, quem deixa o widget aberto o
// dia inteiro nunca sincroniza -- as outras duas portas de entrada são a
// transição bandeja -> expandido e o botão em Configurações.
const GOOGLE_SYNC_INTERVAL_MS = 15 * 60 * 1000;

/* ═════════════════════════════  UTILITÁRIOS  ════════════════════════════ */

// Coalesce gravações disparadas por eventos de alta frequência
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

function setMode(collapsed) {
    const wasCollapsed = data.widget.collapsed;
    if (wasCollapsed !== collapsed) log("[WIDGET] Modo:", collapsed ? "bandeja" : "expandido");
    data.widget.collapsed = collapsed;
    debouncedSaveData();

    // "Abrir o app" (sair da bandeja) é o gatilho dos eventos sem horário do
    // dia (ver checkNoTimeEventsToday) e da sincronização com o Google -- só
    // na transição de verdade, não em toda chamada (ex.: reaplicar o mesmo
    // modo). Sync roda em segundo plano, sem travar a expansão da janela.
    if (wasCollapsed && !collapsed) {
        checkNoTimeEventsToday();
        if (GoogleAuth.isConnected()) runGoogleSync();
    }

    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    widgetWindow.setBounds(computeBounds(collapsed), true);
    widgetWindow.webContents.send("set-mode", collapsed ? "collapsed" : "expanded");
}

/* ══════════════════════════════  IPC  ════════════════════════════════════ */

ipcMain.handle("get-data", () => data);
ipcMain.handle("get-app-version", () => app.getVersion());

// Notas e listas são de propriedade do renderer. Eventos e aniversariantes
// têm campos de propriedade do MAIN (lastNotified/lastNoTimeNotified,
// googleEventId) que o renderer nunca vê -- por isso são mesclados por id
// preservando esses campos, senão qualquer edição no renderer apagaria o
// vínculo com o Google e duplicaria notificações. Itens que existiam antes
// e sumiram do payload foram excluídos no renderer -- se tinham
// googleEventId, entram na fila pra excluir no Google na próxima sync (ver
// GoogleCalendarSync.js).
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
        // A mesma nota pode estar aberta em janela própria — leva a edição
        // do widget pra lá (e fecha a janela se a nota foi excluída aqui).
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
        // Tag removida em Configurações — tira o id de todo item que ainda
        // apontava pra ela, senão fica referência órfã espalhada pelos dados.
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
        // lastLowNotified é controlado só pelo main (ver checkTamaNotifications)
        // -- o renderer nunca sabe desse campo, então preservar evita que
        // cada save do widget reset o cooldown dos avisos de status baixo.
        data.tamagotchi = {
            ...data.tamagotchi,
            ...payload.tamagotchi,
            lastLowNotified: data.tamagotchi.lastLowNotified
        };
    }
    debouncedSaveData();
});

// Configurações são de propriedade da janela de Configurações, mas
// widget/captura rápida também precisam refletir mudanças ao vivo.
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
        alarm: { ...data.settings.alarm, ...settings.alarm }
    };
    log("[SETTINGS] Atualizado:", JSON.stringify(settings));
    debouncedSaveData();
    broadcastSettings();
    if (shortcutsChanged) registerShortcuts();
});

ipcMain.on("open-settings", () => openSettingsWindow());
ipcMain.on("close-settings", () => settingsWindow?.close());

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

// O "✕"/Esc do widget recolhe pro modo bandeja primeiro (não some da tela
// direto). Se já estiver em modo bandeja, esse mesmo "✕"/Esc agora esconde
// a janela de vez (continua rodando na bandeja do sistema — só "Sair" no
// menu da bandeja encerra o processo de verdade) — e fecha a janela de
// Configurações junto, se estiver aberta.
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

ipcMain.on("open-link", (event, url) => {
    if (typeof url !== "string" || !url.trim()) return;
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    try {
        const parsed = new URL(target);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            shell.openExternal(target);
        }
    } catch {
        warn("[EVENTS] Link inválido ignorado:", url);
    }
});

/* ═══════════════════════  SINCRONIZAÇÃO COM O GOOGLE  ═════════════════════ */

function pushSyncedDataToRenderers() {
    widgetWindow?.webContents.send("events-updated", data.events);
    settingsWindow?.webContents.send("birthdays-updated", data.birthdays);
}

// Uma sincronização por vez. Sem essa trava, abrir o widget e clicar
// "Sincronizar agora" (ou recolher/expandir em sequência) dispara dois
// pushNewLocalItems em paralelo -- os dois veem o mesmo evento ainda sem
// googleEventId e criam o MESMO compromisso duas vezes na agenda.
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
// Só verifica e avisa -- baixar e instalar continua sendo decisão do
// usuário (ver UpdateChecker.js e o README). A checagem automática roda no
// máximo uma vez por dia e só no app instalado: em desenvolvimento a versão
// é a do package.json e bater no GitHub a cada `npm start` não ajuda ninguém.

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_BOOT_DELAY_MS = 20 * 1000; // não disputa com a abertura do app

function showUpdateNotification(result) {
    if (!Notification.isSupported()) return;
    const n = new Notification({
        title: "Note-Chan",
        body: `A versão ${result.latest} saiu (você está na ${result.current}). Clique para abrir a página de download.`,
        icon: path.join(__dirname, "../../assets/img/icon.png")
    });
    n.on("click", () => shell.openExternal(result.url));
    n.show();
}

async function checkForUpdatesInBackground() {
    const state = data.updateCheck;
    if (Date.now() - (state.lastCheckAt || 0) < UPDATE_CHECK_INTERVAL_MS) return;

    const result = await UpdateChecker.check();
    state.lastCheckAt = Date.now();
    debouncedSaveData();

    if (!result.ok || !result.updateAvailable) return;
    // Avisa uma vez por versão nova: quem viu e decidiu não atualizar agora
    // não precisa ser lembrado todo dia.
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

// Reancora a janela quando a resolução, escala ou área útil da tela mudam
// (ex.: usuário conecta um monitor, ou a barra de tarefas é escondida/movida)
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

// "Abrir o Note-Chan" precisa abrir de verdade: só mostrar a janela deixaria
// a barrinha do modo bandeja na tela, e nem a sincronização com o Google nem
// o aviso de eventos do dia rodariam -- os dois estão presos à transição
// bandeja -> expandido (ver setMode).
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
        autoHideMenuBar: true,
        webPreferences: SECURE_PREFS
    });

    settingsWindow.setMenuBarVisibility(false);
    settingsWindow.loadFile(path.join(__dirname, "../html/settings.html"));
    settingsWindow.on("closed", () => { log("[WINDOW] configurações fechada"); settingsWindow = null; });
    log("[WINDOW] configurações criada");
}

// onReady roda depois que a janela existe E terminou de carregar — abrir
// direto na aba de aniversariantes (via tray) precisa disso, senão o
// quick-create pode chegar antes do Settings.js registrar o listener.
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
// Uma nota aberta em janela própria: redimensionável, com entrada na barra
// de tarefas e fundo opaco -- pra escrever texto longo sem o aperto do
// widget ancorado no canto. Uma janela por nota (Map por id): pedir de novo
// a mesma nota foca a janela existente em vez de abrir uma segunda.

const noteWindows = new Map();
const NOTE_WINDOW_MIN = { width: 320, height: 220 };
const NOTE_WINDOW_DEFAULT = { width: 520, height: 460 };

function noteWindowBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    const width = data.noteWindow?.width || NOTE_WINDOW_DEFAULT.width;
    const height = data.noteWindow?.height || NOTE_WINDOW_DEFAULT.height;
    // Cascata curta pra segunda janela não nascer exatamente em cima da
    // primeira e dar a impressão de que nada abriu.
    const offset = (noteWindows.size % 6) * 26;
    return {
        width,
        height,
        x: Math.round(workArea.x + (workArea.width - width) / 2 + offset),
        y: Math.round(workArea.y + (workArea.height - height) / 2 + offset)
    };
}

// Nota que nasceu e ninguém escreveu nada não fica pra trás — mesma regra
// que o widget já aplica ao recolher um card intocado.
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

    // O tamanho é uma preferência só, compartilhada por todas as janelas de
    // nota — guardar por nota encheria o data.json de bounds sem necessidade.
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

// Nota editada (ou excluída) em outro lugar enquanto a janela dela está
// aberta. Excluída -> a janela fecha junto; editada -> o conteúdo desce, e
// quem decide se aplica é o próprio renderer (ver Note.js: não sobrescreve
// no meio de uma digitação).
function syncNoteWindows() {
    for (const [id, win] of noteWindows) {
        if (win.isDestroyed()) { noteWindows.delete(id); continue; }
        const note = data.notes.find(n => n.id === id);
        if (!note) { win.close(); continue; }
        win.webContents.send("note-updated", note);
    }
}

// Atalho global: cria a nota já abrindo direto no modo janela, sem passar
// pelo widget.
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

ipcMain.on("note-close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.on("note-minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());

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
// Toca quando o horário de um evento chega — janela dedicada com som (Web
// Audio, sintetizado, sem arquivo externo — ver AlarmSounds.js) e os botões
// Parar/Remarcar. Fila simples porque dois eventos podem vencer juntos e só
// tem uma janela de alarme.

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

// Só dispara alarme pra ocorrências com horário definido. Roda em intervalo
// fixo (em vez de setTimeout por evento) porque setTimeout com atraso maior
// que ~24 dias estoura (evento anual, por exemplo) e porque isso sobrevive
// naturalmente ao computador dormir/acordar.
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
            // Perdeu a janela de tolerância (app fechado/dormindo): marca só
            // pra não tocar tarde demais.
            evt.lastNotified = occ;
            changed = true;
            log("[EVENTS] Ocorrência muito atrasada, alarme suprimido:", evt.title, occ);
        } else if (data.settings.alarm.enabled) {
            evt.lastNotified = occ;
            changed = true;
            fireAlarm(evt);
        }
        // Alarme desligado e ainda dentro da janela: NÃO marca como notificado
        // -- reativar o alarme nos próximos minutos ainda pega essa ocorrência.
    }

    if (changed) debouncedSaveData();
}

/* ═════════════════════  NOTIFICAÇÕES DO BICHINHO  ═════════════════════════ */
// Notificação nativa do SO (leve, sem som/popup bloqueante — diferente do
// alarme de evento) "na voz" do bichinho: pedidos simpáticos, nunca cobrança
// ou culpa. Clicar nela abre o widget direto na aba dele.

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
const TAMA_NOTIFY_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3h entre avisos do MESMO status

// Frases em primeira pessoa, pedindo em vez de cobrar — nada de "vou morrer"
// ou culpa, só um pedido gentil (ver conversa: notificação "de forma
// saudável"). Mais de uma opção por status pra não repetir sempre a mesma.
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

// Roda no mesmo intervalo de checkEventNotifications. Cada status baixo só
// avisa de novo depois do cooldown — sem isso viraria notificação a cada 30s
// enquanto o status continuar baixo, o oposto de "saudável".
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
// Eventos sem hora marcada não entram no alarme (checkEventNotifications
// exige startTime) -- em vez disso, avisa quando o usuário abre o widget no
// dia do evento. lastNoTimeNotified guarda a DATA (não timestamp) já
// avisada, então só notifica uma vez por dia por evento.

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

// App de bandeja: fechar a janela não encerra o processo
app.on("window-all-closed", () => { /* intencionalmente vazio */ });

app.on("activate", openWidgetExpanded);
