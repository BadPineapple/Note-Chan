/* ─────────────────────────────  Logger.js  ──────────────────────────────── */
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(true);
    } else {
        window.Log = factory(false);
    }
})(function (noProcessoPrincipal) {

    const NIVEIS = { INFO: "INFO ", WARN: "WARN ", ERROR: "ERROR" };

    function formatArgs(args) {
        return args.map(arg => {
            if (arg instanceof Error) return arg.stack || String(arg);
            if (typeof arg === "object" && arg !== null) {
                try { return JSON.stringify(arg); } catch { return "[objeto circular]"; }
            }
            return String(arg);
        }).join(" ");
    }

    /* ══════════════════════════════  RENDERER  ══════════════════════════════ */

    if (!noProcessoPrincipal) {
        let origem = "renderer";

        function enviar(nivel, args) {
            try {
                window.api.send("log-entry", { nivel, origem, mensagem: formatArgs(args) });
            } catch {
            }
        }

        function log(...args)  { console.log(...args);   enviar("INFO", args); }
        function warn(...args) { console.warn(...args);  enviar("WARN", args); }
        function error(...args){ console.error(...args); enviar("ERROR", args); }

        function capturarFalhas() {
            window.addEventListener("error", (e) => {
                const detalhe = e.error && e.error.stack
                    ? e.error.stack
                    : `${e.message} (${e.filename || "?"}:${e.lineno || 0})`;
                error("[FALHA] Exceção não tratada:", detalhe);
            });

            window.addEventListener("unhandledrejection", (e) => {
                const motivo = e.reason && e.reason.stack ? e.reason.stack : String(e.reason);
                error("[FALHA] Promessa rejeitada sem tratamento:", motivo);
            });
        }

        return {
            iniciar(nome) {
                origem = nome || "renderer";
                capturarFalhas();
                log("[JANELA] Iniciada.");
            },
            log, warn, error
        };
    }

    /* ════════════════════════════════  MAIN  ═══════════════════════════════ */

    const fs  = require("fs");
    const fsp = fs.promises;
    const PATHS = require("./Paths");
    const logFile = PATHS.logFile;

    const MAX_LOG_BYTES = 2 * 1024 * 1024;  
    const MAX_QUEUE     = 5000;              

    let queue = [];
    let flushing = false;
    let ultimoCorpo = null;
    let repetidas = 0;

    function agora() {
        return new Date().toISOString();
    }

    function enfileirar(linha) {
        if (queue.length > MAX_QUEUE) return;
        queue.push(linha + "\n");
        if (!flushing) flush();
    }

    function despejarRepetidas() {
        if (repetidas === 0) return;
        const n = repetidas;
        repetidas = 0;
        enfileirar(`[${agora()}] [${NIVEIS.INFO}] [logger] (mensagem anterior repetida ${n}x)`);
    }

    function append(nivel, origem, texto) {
        const corpo = `[${nivel}] [${origem}] ${texto}`;
        if (corpo === ultimoCorpo) { repetidas++; return; }
        despejarRepetidas();
        ultimoCorpo = corpo;
        enfileirar(`[${agora()}] ${corpo}`);
    }

    async function rotateIfNeeded() {
        try {
            const stat = await fsp.stat(logFile);
            if (stat.size < MAX_LOG_BYTES) return;

            const archive = `${logFile}.1`;
            try {
                await fsp.unlink(archive);
            } catch (e) {
                if (e.code !== "ENOENT") throw e;
            }
            await fsp.rename(logFile, archive);
        } catch (e) {
            // console.error, e não o error() daqui: relatar falha do logger pelo logger recursaria.
            if (e.code !== "ENOENT") console.error("[LOGGER] Falha ao rotacionar log:", e.message);
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

    function flushSync() {
        despejarRepetidas();
        if (!queue.length) return;
        try {
            fs.appendFileSync(logFile, queue.splice(0, queue.length).join(""), "utf8");
        } catch (e) {
            console.error("[LOGGER] Falha ao gravar log na saída:", e.message);
        }
    }

    const ORIGENS = new Set(["widget", "configuracoes", "nota", "captura", "alarme", "renderer"]);
    const MAX_MENSAGEM = 4000;

    function registrarDeRenderer(entrada) {
        if (!entrada || typeof entrada !== "object") return;
        const nivel = NIVEIS[entrada.nivel] || NIVEIS.INFO;
        const origem = ORIGENS.has(entrada.origem) ? entrada.origem : "renderer";
        const mensagem = String(entrada.mensagem ?? "").slice(0, MAX_MENSAGEM);
        append(nivel, origem, mensagem);
    }

    function log(...args)   { console.log(...args);   append(NIVEIS.INFO,  "main", formatArgs(args)); }
    function warn(...args)  { console.warn(...args);  append(NIVEIS.WARN,  "main", formatArgs(args)); }
    function error(...args) { console.error(...args); append(NIVEIS.ERROR, "main", formatArgs(args)); }

    function capturarFalhasDoProcesso() {
        process.on("uncaughtException", (e) => {
            error("[FALHA] Exceção não tratada no processo principal:", e);
            flushSync();
        });
        process.on("unhandledRejection", (motivo) => {
            error("[FALHA] Promessa rejeitada sem tratamento:", motivo);
        });
    }

    return { log, warn, error, flushSync, registrarDeRenderer, capturarFalhasDoProcesso };
});
