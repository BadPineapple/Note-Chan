/* ────────────────────────────────  Main.js  ─────────────────────────────── */
const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage, screen, shell, globalShortcut } = require("electron");
const path = require("path");

// PATHS PRECISA SER O PRIMEIRO MÓDULO INTERNO — define app.setName() antes
// de qualquer getPath(), senão o Electron cacheia o diretório errado.
const PATHS = require("./Paths");

const { loadData, saveData, saveDataSync } = require("./DataManager");
const { log, warn } = require("./Logger");
const EventUtils = require("./EventUtils");

/* ═══════════════════════════  INSTÂNCIA ÚNICA  ═══════════════════════════ */
if (!app.requestSingleInstanceLock()) {
    log("[APP] Instância já em execução. Encerrando esta.");
    app.quit();
    return;
}

log("=== Note-Chan iniciado ===");
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
    if (data.widget.collapsed !== collapsed) log("[WIDGET] Modo:", collapsed ? "bandeja" : "expandido");
    data.widget.collapsed = collapsed;
    debouncedSaveData();

    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    widgetWindow.setBounds(computeBounds(collapsed), true);
    widgetWindow.webContents.send("set-mode", collapsed ? "collapsed" : "expanded");
}

/* ══════════════════════════════  IPC  ════════════════════════════════════ */

ipcMain.handle("get-data", () => data);

// Notas, listas e o conteúdo dos eventos são de propriedade do renderer;
// modo/tamanho da janela e o controle de notificações já disparadas
// (event.lastNotified) são de propriedade do main — cada lado só
// sobrescreve o que é seu. Eventos são mesclados por id preservando
// lastNotified, senão uma edição qualquer no renderer (que nunca viu
// atualizações de lastNotified feitas pelo main entre uma sync e outra)
// apagaria esse controle e duplicaria notificações.
ipcMain.on("save-data", (event, payload) => {
    if (!payload) return;
    data.notes = Array.isArray(payload.notes) ? payload.notes : data.notes;
    data.lists = Array.isArray(payload.lists) ? payload.lists : data.lists;
    data.birthdays = Array.isArray(payload.birthdays) ? payload.birthdays : data.birthdays;
    if (Array.isArray(payload.events)) {
        data.events = payload.events.map(incoming => {
            const existing = data.events.find(e => e.id === incoming.id);
            return existing ? { ...incoming, lastNotified: existing.lastNotified } : incoming;
        });
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
    debouncedSaveData();
});

// Configurações são de propriedade da janela de Configurações, mas
// widget/captura rápida também precisam refletir mudanças ao vivo.
ipcMain.on("save-settings", (event, settings) => {
    if (!settings) return;
    const shortcutsChanged =
        settings.shortcuts && (
            settings.shortcuts.toggleWidget !== data.settings.shortcuts.toggleWidget ||
            settings.shortcuts.quickCapture !== data.settings.shortcuts.quickCapture
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
        content: trimmed,
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

// O "✕"/Esc do widget agora recolhe pro modo bandeja em vez de sumir da tela
// por completo (só "Sair" na bandeja do sistema encerra de verdade) — e
// fecha a janela de Configurações junto, se estiver aberta.
ipcMain.on("close-widget", () => {
    setMode(true);
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
    [widgetWindow, settingsWindow, quickCaptureWindow, alarmWindow]
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

    const { toggleWidget, quickCapture } = data.settings.shortcuts;
    const bindings = [
        [toggleWidget, toggleWidgetVisibility],
        [quickCapture, showQuickCapture]
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
        sound: data.settings.alarm.sound
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

        evt.lastNotified = occ;
        changed = true;

        if (diff > NOTIFY_GRACE_MS) {
            log("[EVENTS] Ocorrência muito atrasada, alarme suprimido:", evt.title, occ);
        } else if (data.settings.alarm.enabled) {
            fireAlarm(evt);
        }
    }

    if (changed) debouncedSaveData();
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
        { label: "Abrir Note-Chan", click: showWidget },
        { label: "Captura rápida", click: showQuickCapture },
        { type: "separator" },
        { label: "Nova nota",  click: () => quickCreate("nota") },
        { label: "Nova lista", click: () => quickCreate("lista") },
        { label: "Novo evento", click: () => quickCreate("evento") },
        { label: "Novo aniversariante", click: () => quickCreate("aniversario") },
        { type: "separator" },
        { label: "Configurações", click: openSettingsWindow },
        { type: "separator" },
        { label: "Sair", click: () => app.quit() }
    ]));

    tray.on("double-click", showWidget);
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
    showWidget();
});

/* ════════════════════════════════  CICLO DE VIDA  ═══════════════════════ */

app.whenReady().then(() => {
    if (process.platform === "win32") {
        app.setAppUserModelId("com.renato.notechan");
    }

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

app.on("activate", showWidget);
