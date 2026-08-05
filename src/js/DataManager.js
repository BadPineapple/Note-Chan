/* ───────────────────────────  DataManager.js  ───────────────────────────── */
// Persistência local das notas e listas. Nenhuma chamada de rede — tudo em
// userData/data.json.
const fs = require("fs");
const path = require("path");
const PATHS = require("./Paths");
const { log, warn } = require("./Logger");

const MAX_DAILY_BACKUPS = 14;

function defaultData() {
    return {
        notes: [],
        lists: [],
        events: [],
        birthdays: [],
        tags: [],
        googleSync: {
            syncToken: null,       // syncToken incremental da Calendar API (null = próxima sync é completa)
            lastSyncAt: null,
            pendingDeletes: []     // ids de evento do Google a excluir na próxima sync (ver Main.js)
        },
        tamagotchi: {
            level: 1,
            xp: 0,
            vida: 100,
            fome: 100,
            carencia: 100,
            higiene: 100,
            lastUpdate: Date.now(),      // referência do decaimento de fome/higiene (tempo puro)
            lastInteraction: Date.now(), // referência do decaimento de carência (uso do app)
            lastLowNotified: {}          // { fome, higiene, carencia, vida } -> timestamp do último aviso (main)
        },
        widget: { collapsed: true, width: 320, height: 480, activeTab: "notas" },
        settings: {
            theme: "gold",
            transparency: 60,
            shortcuts: {
                toggleWidget: "Control+Alt+N",
                quickCapture: "Control+Alt+Q"
            },
            alarm: { enabled: true, volume: 70, sound: "sininho" }
        }
    };
}

function summarize(data) {
    return `${data.notes?.length ?? 0} notas, ${data.lists?.length ?? 0} listas, `
        + `${data.events?.length ?? 0} eventos, ${data.birthdays?.length ?? 0} aniversariantes`;
}

// Merge raso quebraria se um data.json antigo não tiver um campo novo
// dentro de widget/settings/settings.shortcuts (ex.: depois de uma
// atualização) — por isso esses três níveis são mesclados à parte.
function loadData() {
    const defaults = defaultData();
    try {
        const raw = fs.readFileSync(PATHS.data, "utf8");
        const parsed = JSON.parse(raw);
        const merged = {
            ...defaults,
            ...parsed,
            widget: { ...defaults.widget, ...parsed.widget },
            tamagotchi: { ...defaults.tamagotchi, ...parsed.tamagotchi },
            googleSync: { ...defaults.googleSync, ...parsed.googleSync },
            settings: {
                ...defaults.settings,
                ...parsed.settings,
                shortcuts: { ...defaults.settings.shortcuts, ...parsed.settings?.shortcuts },
                alarm: {
                    ...defaults.settings.alarm,
                    // migra o antigo notificationsEnabled se essa versão ainda
                    // não tinha o bloco "alarm" — preserva a preferência do
                    // usuário em vez de resetar pro padrão.
                    ...(parsed.settings?.notificationsEnabled !== undefined
                        ? { enabled: parsed.settings.notificationsEnabled }
                        : {}),
                    ...parsed.settings?.alarm
                }
            }
        };
        delete merged.settings.notificationsEnabled;
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

// Mantém uma cópia do data.json anterior antes de sobrescrever — rede de
// segurança mínima caso uma gravação saia corrompida ou incompleta por
// qualquer motivo. Só guarda 1 nível (o penúltimo estado), não é
// versionamento completo, mas cobre o caso mais comum de perda de dados.
function backupPrevious() {
    try {
        if (fs.existsSync(PATHS.data)) {
            fs.copyFileSync(PATHS.data, `${PATHS.data}.bak`);
        }
    } catch (e) {
        warn("[DATA] Falha ao criar backup antes de salvar:", e.message);
    }
}

// Grava em arquivo temporário e renomeia — evita corromper data.json se o
// processo morrer no meio da escrita.
function writeAtomic(payload) {
    const tmp = `${PATHS.data}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, PATHS.data);
}

// Snapshot datado (um por dia, o primeiro salvamento do dia grava e os
// seguintes só sobrescrevem o .bak de cima) — histórico de verdade além do
// "1 passo atrás" do backupPrevious(), pra recuperar de uma perda notada só
// dias depois. Rotaciona mantendo só os MAX_DAILY_BACKUPS mais recentes.
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

async function saveData(data) {
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
