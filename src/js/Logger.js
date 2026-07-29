/* ─────────────────────────────  Logger.js  ──────────────────────────────── */
const fs  = require("fs");
const fsp = fs.promises;

const isMain = process.type === "browser";

// No renderer o logger degrada para console — renderers não escrevem em disco.
let logFile = null;
if (isMain) {
    const PATHS = require("./Paths");
    logFile = PATHS.logFile;
}

const MAX_LOG_BYTES = 2 * 1024 * 1024;   // 2 MB
const MAX_QUEUE     = 5000;              // trava de segurança contra loop de log

let queue = [];
let flushing = false;

function formatArgs(args) {
    return args.map(arg => {
        if (arg instanceof Error) return arg.stack;
        if (typeof arg === "object" && arg !== null) {
            try { return JSON.stringify(arg); } catch { return "[objeto circular]"; }
        }
        return String(arg);
    }).join(" ");
}

async function rotateIfNeeded() {
    try {
        const stat = await fsp.stat(logFile);
        if (stat.size < MAX_LOG_BYTES) return;

        const archive = `${logFile}.1`;
        try { await fsp.unlink(archive); } catch {}
        await fsp.rename(logFile, archive);
    } catch {
        // arquivo ainda não existe — nada a rotacionar
    }
}

async function flush() {
    flushing = true;
    while (queue.length) {
        const chunk = queue.splice(0, queue.length).join("");
        try {
            await rotateIfNeeded();
            await fsp.appendFile(logFile, chunk, "utf8");
        } catch (e) {
            console.error("[LOGGER] Falha ao gravar log:", e.message);
        }
    }
    flushing = false;
}

function append(level, ...args) {
    if (!isMain || !logFile) return;
    if (queue.length > MAX_QUEUE) return;

    const timestamp = new Date().toISOString();
    queue.push(`[${timestamp}] [${level}] ${formatArgs(args)}\n`);

    if (!flushing) flush();
}

function flushSync() {
    if (!isMain || !logFile || !queue.length) return;
    try {
        fs.appendFileSync(logFile, queue.splice(0, queue.length).join(""), "utf8");
    } catch {}
}

module.exports = {
    log:   (...args) => { console.log(...args);   append("INFO",  ...args); },
    warn:  (...args) => { console.warn(...args);  append("WARN",  ...args); },
    error: (...args) => { console.error(...args); append("ERROR", ...args); },
    flushSync
};
