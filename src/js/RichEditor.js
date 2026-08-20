/* ───────────────────────────────  RichEditor.js  ──────────────────────────
   Comportamento de edição de texto rico em cima de um contenteditable. É o
   mesmo módulo nos dois lugares onde se escreve nota: o editor apertado
   dentro do card do widget e a janela do bloco de notas -- o que muda entre
   eles é só quais ferramentas a barra oferece, não como elas funcionam.

   Usa document.execCommand. Está marcado como obsoleto há anos, mas continua
   sendo a única forma de aplicar negrito/lista/alinhamento numa seleção sem
   escrever um editor inteiro na mão, e o Chromium (que é o que o Electron
   embarca) implementa tudo que é usado aqui. O app já dependia dele para o
   "selecionar tudo" ao renomear card.

   Mesmo padrão UMD dos outros módulos compartilhados.
*/
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.RichEditor = factory();
    }
})(function () {
    const INDENT_PADRAO = 4;

    // Digitou a seta, virou o caractere. Vale em qualquer lugar do texto.
    const SETAS = { "->": "→", "<-": "←" };
    const PADRAO_SETA = /->|<-/;

    /* ═════════════════════════════  SELEÇÃO  ═════════════════════════════ */

    function selecaoDentro(el) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        return el.contains(range.commonAncestorContainer) ? sel : null;
    }

    // Está dentro de um item de lista? É o que decide se o TAB cria sublista
    // ou apenas empurra o texto.
    function dentroDeLista(el) {
        const sel = selecaoDentro(el);
        if (!sel) return false;
        let no = sel.anchorNode;
        while (no && no !== el) {
            if (no.nodeType === 1 && no.tagName === "LI") return true;
            no = no.parentNode;
        }
        return false;
    }

    /* ══════════════════════════════  SETAS  ══════════════════════════════ */

    // Acha a sequência e troca pelo caractere. Procura no TEXTO em vez de
    // olhar os dois caracteres antes do cursor: durante o evento input o
    // offset da seleção ainda não acompanhou a inserção, então confiar nele
    // deixava a troca sem acontecer. Na prática dá no mesmo enquanto se
    // digita, já que a seta recém-digitada é a única que existe por converter.
    //
    // A troca sai por insertText (e não mexendo no nodeValue na mão) para o
    // Ctrl+Z continuar desfazendo passo a passo, como o usuário espera.
    function trocarSetas(el) {
        const sel = window.getSelection();
        if (!sel) return false;

        const candidatos = [];
        if (sel.anchorNode && sel.anchorNode.nodeType === 3 && el.contains(sel.anchorNode)) {
            candidatos.push(sel.anchorNode); // o nó onde o cursor está vem primeiro
        }
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let no;
        while ((no = walker.nextNode())) {
            if (!candidatos.includes(no)) candidatos.push(no);
        }

        for (const alvo of candidatos) {
            const achou = PADRAO_SETA.exec(alvo.nodeValue || "");
            if (!achou) continue;

            const range = document.createRange();
            range.setStart(alvo, achou.index);
            range.setEnd(alvo, achou.index + achou[0].length);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand("insertText", false, SETAS[achou[0]]);
            return true;
        }
        return false;
    }

    /* ═════════════════════════════  COMANDOS  ════════════════════════════ */

    // Nome interno -> comando do execCommand. Quem monta barra de ferramentas
    // usa estas chaves; o resto do app não precisa saber que existe
    // execCommand por baixo.
    const COMANDOS = {
        negrito:         { cmd: "bold" },
        italico:         { cmd: "italic" },
        sublinhado:      { cmd: "underline" },
        lista:           { cmd: "insertUnorderedList" },
        listaNumerada:   { cmd: "insertOrderedList" },
        alinharEsquerda: { cmd: "justifyLeft" },
        alinharCentro:   { cmd: "justifyCenter" },
        alinharDireita:  { cmd: "justifyRight" },
        justificar:      { cmd: "justifyFull" },
        indentar:        { cmd: "indent" },
        desindentar:     { cmd: "outdent" }
    };

    function executar(el, nome, valor) {
        const comando = COMANDOS[nome];
        if (!comando) return false;
        el.focus();
        document.execCommand(comando.cmd, false, valor);
        return true;
    }

    // Quais comandos estão ativos na seleção atual — a barra usa para
    // acender/apagar os botões.
    function estado(el) {
        if (!selecaoDentro(el)) return {};
        const fora = {};
        for (const [nome, comando] of Object.entries(COMANDOS)) {
            try { fora[nome] = document.queryCommandState(comando.cmd); }
            catch { fora[nome] = false; }
        }
        return fora;
    }

    /* ═════════════════════════════  ATTACH  ══════════════════════════════ */

    // opts: { onChange, onEscape, indentSize } — indentSize pode ser função,
    // para ler a configuração no momento do TAB em vez de congelar o valor
    // de quando o editor foi criado.
    function attach(el, opts = {}) {
        const onChange = opts.onChange || (() => {});
        let setaAgendada = null;

        // A troca sai do evento antes de acontecer. O Chromium recusa um
        // execCommand disparado de dentro do input de OUTRO execCommand
        // (colagem, e o próprio insertText), e a substituição simplesmente
        // não acontecia. Um timeout de 0 já tira a chamada de dentro do
        // comando em curso; para quem digita é instantâneo do mesmo jeito.
        function agendarTrocaDeSetas() {
            if (setaAgendada) return;
            setaAgendada = setTimeout(() => {
                setaAgendada = null;
                trocarSetas(el); // o input que isto gera é quem chama o onChange
            }, 0);
        }

        // O :empty do CSS não serve: um editor "vazio" no Chromium contém
        // <div><br></div>, que não é vazio para o seletor. A classe é quem
        // controla o placeholder (ver .note-editor.vazio no CSS).
        function marcarVazio() {
            el.classList.toggle("vazio", RichText.isEmpty(el.innerHTML));
        }

        function tamanhoIndent() {
            const bruto = typeof opts.indentSize === "function" ? opts.indentSize() : opts.indentSize;
            const n = Number(bruto);
            return Number.isFinite(n) && n > 0 && n <= 16 ? Math.round(n) : INDENT_PADRAO;
        }

        el.addEventListener("input", () => {
            agendarTrocaDeSetas();
            marcarVazio();
            onChange();
        });

        // Colar de outro app traz fonte, cor e classe do site de origem, que
        // ignorariam o tema e inchariam o data.json. Passa pelo sanitize;
        // sem HTML no clipboard, entra como texto puro.
        el.addEventListener("paste", (e) => {
            e.preventDefault();
            const html = e.clipboardData ? e.clipboardData.getData("text/html") : "";
            const texto = (e.clipboardData ? e.clipboardData.getData("text/plain") : "") || "";
            if (html) document.execCommand("insertHTML", false, RichText.sanitize(html));
            else document.execCommand("insertText", false, texto);
        });

        // Arrastar texto de fora tem o mesmo problema da colagem. O drop de
        // ARQUIVO continua sendo do widget (vira nota nova), então só o de
        // texto é interceptado aqui.
        el.addEventListener("drop", (e) => {
            const tipos = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
            if (tipos.includes("Files")) return;
            e.preventDefault();
            const texto = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
            if (texto) document.execCommand("insertText", false, texto);
        });

        el.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && opts.onEscape) {
                e.preventDefault();
                e.stopPropagation();
                opts.onEscape();
                return;
            }

            if (e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                // Dentro de lista o TAB é o que cria sublista (e Shift+TAB
                // volta um nível). Fora dela, é indentação de texto mesmo.
                if (dentroDeLista(el)) {
                    document.execCommand(e.shiftKey ? "outdent" : "indent");
                } else if (!e.shiftKey) {
                    document.execCommand("insertText", false, " ".repeat(tamanhoIndent()));
                }
                return;
            }

            // Enter quebra linha e continua a lista, que é o comportamento
            // natural de editor de texto -- e sem ele não existe lista de
            // vários itens. Quem termina a edição agora é o Esc.
            if (e.key === "Enter") e.stopPropagation();
        });

        // Conteúdo que veio do disco pode ter sido gravado por uma versão
        // com outra lista de tags permitidas.
        el.innerHTML = RichText.sanitize(el.innerHTML);
        marcarVazio();

        return {
            exec: (nome, valor) => { if (executar(el, nome, valor)) onChange(); },
            estado: () => estado(el),
            marcarVazio
        };
    }

    return { attach, executar, estado, COMANDOS, SETAS, INDENT_PADRAO };
});
