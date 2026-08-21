/* ───────────────────────────  DataManager.js  ───────────────────────────── */
const fs = require("fs");
const path = require("path");
const PATHS = require("./Paths");
const { log, warn } = require("./Logger");
const RichText = require("./RichText");

const MAX_DAILY_BACKUPS = 14;

const SCHEMA_VERSION = 2;

function migrarNotasParaHtml(notas) {
    if (!Array.isArray(notas)) return 0;
    let convertidas = 0;
    for (const nota of notas) {
        if (typeof nota.content !== "string") { nota.content = ""; continue; }
        nota.content = RichText.fromPlainText(nota.content);
        convertidas++;
    }
    return convertidas;
}

function defaultData() {
    return {
        schemaVersion: SCHEMA_VERSION,
        notes: [],
        lists: [],
        events: [],
        birthdays: [],
        tags: [],
        googleSync: {
            syncToken: null,       
            lastSyncAt: null,
            pendingDeletes: []   
        },
        tamagotchi: {
            level: 1,
            xp: 0,
            vida: 100,
            fome: 100,
            carencia: 100,
            higiene: 100,
            lastUpdate: Date.now(),        
            lastInteraction: Date.now(),    
            lastCarenciaUpdate: Date.now(), 
            lastLowNotified: {}            
        },
        widget: { collapsed: true, width: 320, height: 480, activeTab: "notas" },
        noteWindow: { width: 520, height: 460 },
        updateCheck: { lastCheckAt: null, notifiedVersion: null },
        settings: {
            theme: "gold",
            transparency: 60,
            shortcuts: {
                toggleWidget: "Control+Alt+N",
                quickCapture: "Control+Alt+Q",
                newNoteWindow: "Control+Alt+J"
            },
            editor: { fontSize: 15, indentSize: 4 },
            editorShortcuts: {
                negrito: "Control+B",
                italico: "Control+I",
                sublinhado: "Control+U",
                lista: "Control+Shift+L",
                listaNumerada: "Control+Shift+O"
            },
            alarm: { enabled: true, volume: 70, sound: "sininho" }
        }
    };
}

function summarize(data) {
    return `${data.notes?.length ?? 0} notas, ${data.lists?.length ?? 0} listas, `
        + `${data.events?.length ?? 0} eventos, ${data.birthdays?.length ?? 0} aniversariantes`;
}

function loadData() {
    const defaults = defaultData();
    try {
        const raw = fs.readFileSync(PATHS.data, "utf8");
        const parsed = JSON.parse(raw);
        const merged = {
            ...defaults,
            ...parsed,
            widget: { ...defaults.widget, ...parsed.widget },
            noteWindow: { ...defaults.noteWindow, ...parsed.noteWindow },
            updateCheck: { ...defaults.updateCheck, ...parsed.updateCheck },
            tamagotchi: {
                ...defaults.tamagotchi,
                ...parsed.tamagotchi,
                lastCarenciaUpdate: parsed.tamagotchi?.lastCarenciaUpdate
                    ?? parsed.tamagotchi?.lastInteraction
                    ?? defaults.tamagotchi.lastCarenciaUpdate
            },
            googleSync: { ...defaults.googleSync, ...parsed.googleSync },
            settings: {
                ...defaults.settings,
                ...parsed.settings,
                shortcuts: { ...defaults.settings.shortcuts, ...parsed.settings?.shortcuts },
                editor: { ...defaults.settings.editor, ...parsed.settings?.editor },
                editorShortcuts: { ...defaults.settings.editorShortcuts, ...parsed.settings?.editorShortcuts },
                alarm: {
                    ...defaults.settings.alarm,
                    ...(parsed.settings?.notificationsEnabled !== undefined
                        ? { enabled: parsed.settings.notificationsEnabled }
                        : {}),
                    ...parsed.settings?.alarm
                }
            }
        };
        delete merged.settings.notificationsEnabled;

        if ((parsed.schemaVersion || 1) < 2) {
            const n = migrarNotasParaHtml(merged.notes);
            if (n) log("[DATA] Migração de formato: " + n + " nota(s) de texto puro para HTML.");
        }
        merged.schemaVersion = SCHEMA_VERSION;

        log("[DATA] Carregado de", PATHS.data, "—", summarize(merged));
        return merged;
    } catch (e) {
        if (e.code === "ENOENT") {
            log("[DATA] Nenhum data.json encontrado em", PATHS.data, "— começando vazio (primeira execução).");
        } else {
            warn("[DATA] Falha ao ler data.json, usando padrão pra não perder a sessão:", e.message);
        }
        return defaults;
    }
}

function backupPrevious() {
    try {
        if (fs.existsSync(PATHS.data)) {
            fs.copyFileSync(PATHS.data, `${PATHS.data}.bak`);
        }
    } catch (e) {
        warn("[DATA] Falha ao criar backup antes de salvar:", e.message);
    }
}

function writeAtomic(payload) {
    const tmp = `${PATHS.data}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, PATHS.data);
}

function dailyBackupIfNeeded(data) {
    try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const todayPath = path.join(PATHS.backupsDir, `data-${today}.json`);
        if (fs.existsSync(todayPath)) return; // já tem snapshot de hoje

        fs.writeFileSync(todayPath, JSON.stringify(data, null, 2), "utf8");
        log("[BACKUP] Snapshot diário criado:", todayPath);

        const files = fs.readdirSync(PATHS.backupsDir)
            .filter(f => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
            .sort();
        while (files.length > MAX_DAILY_BACKUPS) {
            const oldest = files.shift();
            fs.unlinkSync(path.join(PATHS.backupsDir, oldest));
            log("[BACKUP] Snapshot antigo removido:", oldest);
        }
    } catch (e) {
        warn("[BACKUP] Falha ao criar snapshot diário:", e.message);
    }
}

async function writeAsync(data) {
    try {
        backupPrevious();
        await fs.promises.writeFile(`${PATHS.data}.tmp`, JSON.stringify(data, null, 2), "utf8");
        await fs.promises.rename(`${PATHS.data}.tmp`, PATHS.data);
        log("[DATA] Salvo —", summarize(data));
        dailyBackupIfNeeded(data);
    } catch (e) {
        warn("[DATA] Falha ao salvar data.json:", e.message);
    }
}

let writeQueue = Promise.resolve();

function saveData(data) {
    writeQueue = writeQueue.then(() => writeAsync(data));
    return writeQueue;
}

function saveDataSync(data) {
    try {
        backupPrevious();
        writeAtomic(data);
        log("[DATA] Salvo (sync, ao encerrar) —", summarize(data));
        dailyBackupIfNeeded(data);
    } catch (e) {
        warn("[DATA] Falha ao salvar data.json (sync):", e.message);
    }
}

module.exports = { defaultData, loadData, saveData, saveDataSync };
