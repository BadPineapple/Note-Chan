/* ─────────────────────────────  Logger.js  ────────────────────────────────
   Um logger para os dois lados. No processo principal escreve em
   userData/logs/runtime.log; nos renderers manda a linha pro main pelo canal
   log-entry, porque janela em sandbox não tem acesso a disco.

   Até esta versão só o main registrava, e o resultado era que erro no widget,
   na janela de nota ou na barra de ferramentas não deixava rastro nenhum --
   justamente o código mais novo. Cada linha carrega a ORIGEM (main, widget,
   nota...) porque com cinco janelas "Nota criada" sozinho não diz de onde
   veio.

   Mesmo padrão UMD dos outros módulos compartilhados, mas aqui as duas metades
   fazem coisas bem diferentes: a de escrever em disco e a de mandar pra quem
   escreve.
*/
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(true);
    } else {
        window.Log = factory(false);
    }
})(function (noProcessoPrincipal) {

    // Alinhados em 5 caracteres pra as colunas do arquivo baterem.
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
            // Nunca pode estourar: isto roda de dentro do handler de erro, e
            // uma exceção aqui viraria laço de falha em cima de falha.
            try {
                window.api.send("log-entry", { nivel, origem, mensagem: formatArgs(args) });
            } catch {
                /* canal indisponível — resta o console, que já foi escrito */
            }
        }

        function log(...args)  { console.log(...args);   enviar("INFO", args); }
        function warn(...args) { console.warn(...args);  enviar("WARN", args); }
        function error(...args){ console.error(...args); enviar("ERROR", args); }

        function capturarFalhas() {
            window.addEventListener("error", (e) => {
                // e.error só existe em exceção de script; falha ao carregar um
                // recurso vem sem ele, e aí o que há é a mensagem e o arquivo.
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
            // Primeira linha de cada renderer: dá nome à janela e liga a
            // captura de falha. Sem isso as linhas saem como "renderer".
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

    const MAX_LOG_BYTES = 2 * 1024 * 1024;   // 2 MB
    const MAX_QUEUE     = 5000;              // trava de segurança contra loop de log

    let queue = [];
    let flushing = false;

    // Mensagem repetida vira contagem em vez de encher o arquivo. Um handler
    // de erro que falha sozinho repete a MESMA linha milhares de vezes, e é
    // exatamente quando o log precisa continuar legível.
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

    function flushSync() {
        despejarRepetidas();
        if (!queue.length) return;
        try {
            fs.appendFileSync(logFile, queue.splice(0, queue.length).join(""), "utf8");
        } catch {}
    }

    // Linha vinda de um renderer pelo canal log-entry. O conteúdo é de código
    // nosso, mas chega por IPC, então nível e origem passam por uma lista
    // fechada e a mensagem é limitada -- um renderer em laço de erro não pode
    // ditar o formato nem o tamanho do arquivo.
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

    // Exceção que escapou de todo mundo. O app NÃO é encerrado de propósito:
    // é um widget de bandeja com os dados já gravados continuamente, e derrubar
    // tudo por causa de um handler solto custa mais ao usuário do que seguir
    // num estado possivelmente degradado. O que não pode é sumir em silêncio,
    // que é o que acontecia antes.
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
