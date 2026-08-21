/* ───────────────────────────────  RichEditor.js  ──────────────────────────*/
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.RichEditor = factory();
    }
})(function () {
    const INDENT_PADRAO = 4;

    const MAX_COLAGEM = 500000;

    function resolver(valor) {
        return typeof valor === "function" ? valor() : valor;
    }

    function aplicarFonte(px) {
        const n = Number(px);
        const raiz = document.documentElement;
        if (Number.isFinite(n) && n >= 8 && n <= 40) {
            raiz.style.setProperty("--nc-fonte-nota", n + "px");
        } else {
            raiz.style.removeProperty("--nc-fonte-nota");
        }
    }

    const SETAS = { "->": "→", "<-": "←" };
    const PADRAO_SETA = /->|<-/;
    const PADRAO_SETA_TODAS = /->|<-/g;

    function acharSeta(texto, cursor) {
        PADRAO_SETA_TODAS.lastIndex = 0;
        let primeira = null;
        let achado;
        while ((achado = PADRAO_SETA_TODAS.exec(texto))) {
            if (!primeira) primeira = achado;
            if (achado.index + achado[0].length === cursor) return achado;
        }
        return primeira;
    }

    /* ═════════════════════════════  SELEÇÃO  ═════════════════════════════ */

    function selecaoDentro(el) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        return el.contains(range.commonAncestorContainer) ? sel : null;
    }

    function dentroDeTag(el, ...tags) {
        const sel = selecaoDentro(el);
        if (!sel) return false;
        let no = sel.anchorNode;
        while (no && no !== el) {
            if (no.nodeType === 1 && tags.includes(no.tagName)) return true;
            no = no.parentNode;
        }
        return false;
    }

    /* ══════════════════════════════  SETAS  ══════════════════════════════ */

    function trocarSetas(el) {
        const sel = window.getSelection();
        if (!sel) return false;

        const no = sel.anchorNode;
        if (!no || no.nodeType !== 3 || !el.contains(no)) return false;

        const achou = acharSeta(no.nodeValue || "", sel.anchorOffset);
        if (!achou) return false;

        const range = document.createRange();
        range.setStart(no, achou.index);
        range.setEnd(no, achou.index + achou[0].length);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("insertText", false, SETAS[achou[0]]);
        return true;
    }

    function trocarSetasEmCampo(el) {
        const texto = el.value || "";
        const cursor = el.selectionStart;
        const achou = acharSeta(texto, cursor);
        if (!achou) return false;

        el.setSelectionRange(achou.index, achou.index + achou[0].length);

        if (!document.execCommand("insertText", false, SETAS[achou[0]])) {
            el.value = texto.slice(0, achou.index) + SETAS[achou[0]] + texto.slice(achou.index + achou[0].length);
            const novo = cursor > achou.index ? cursor - 1 : cursor;
            el.setSelectionRange(novo, novo);
        }
        return true;
    }

    function ligarSetas(el) {
        if (!el) return;
        const ehCampo = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
        let agendado = null;

        el.addEventListener("input", () => {
            if (agendado) return;
            agendado = setTimeout(() => {
                agendado = null;
                if (ehCampo) trocarSetasEmCampo(el);
                else trocarSetas(el);
            }, 0);
        });
    }

    /* ═════════════════════════════  COMANDOS  ════════════════════════════ */

    const COMANDOS = {
        negrito:         { cmd: "bold" },
        italico:         { cmd: "italic" },
        sublinhado:      { cmd: "underline" },
        lista:           { cmd: "insertUnorderedList" },
        listaNumerada:   { cmd: "insertOrderedList" },
        alinharEsquerda: { cmd: "justifyLeft", css: true },
        alinharCentro:   { cmd: "justifyCenter", css: true },
        alinharDireita:  { cmd: "justifyRight", css: true },
        justificar:      { cmd: "justifyFull", css: true },
        indentar:        { cmd: "indent" },
        desindentar:     { cmd: "outdent" }
    };

    const FERRAMENTAS = {
        negrito:       { icone: "bold",         titulo: "Negrito" },
        italico:       { icone: "italic",       titulo: "Itálico" },
        sublinhado:    { icone: "underline",    titulo: "Sublinhado" },
        lista:         { icone: "list",         titulo: "Lista" },
        listaNumerada: { icone: "list-ordered", titulo: "Lista numerada" },
        alinharEsquerda: { icone: "align-left",    titulo: "Alinhar à esquerda" },
        alinharCentro:   { icone: "align-center",  titulo: "Centralizar" },
        alinharDireita:  { icone: "align-right",   titulo: "Alinhar à direita" },
        justificar:      { icone: "align-justify", titulo: "Justificar" },
        codigo:          { icone: "code",          titulo: "Bloco de código" },
        tamanhoFonte:    { tipo: "select",         titulo: "Tamanho da fonte" }
    };

    const BARRA_BASICA = ["negrito", "italico", "sublinhado", "|", "lista", "listaNumerada"];

    const BARRA_COMPLETA = [
        "negrito", "italico", "sublinhado",
        "|", "lista", "listaNumerada",
        "|", "alinharEsquerda", "alinharCentro", "alinharDireita", "justificar",
        "|", "codigo", "tamanhoFonte"
    ];

    const ATALHOS_PADRAO = {
        negrito: "Control+B",
        italico: "Control+I",
        sublinhado: "Control+U",
        lista: "Control+Shift+L",
        listaNumerada: "Control+Shift+O"
    };

    function acceleradorDoEvento(e) {
        if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
        const partes = [];
        if (e.ctrlKey) partes.push("Control");
        if (e.altKey) partes.push("Alt");
        if (e.shiftKey) partes.push("Shift");
        if (e.metaKey) partes.push("Super");
        if (partes.length === 0) return null; // tecla solta não é atalho
        partes.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
        return partes.join("+");
    }

    function atalhoLegivel(acelerador) {
        return acelerador ? acelerador.replace("Control", "Ctrl").replace("Super", "Win") : "";
    }

    const TAMANHOS_FONTE = [12, 14, 16, 18, 22, 28];
    const MARCA_TAMANHO = "xxx-large";

    function aplicarTamanhoFonte(el, px) {
        if (!selecaoDentro(el)) el.focus();
        document.execCommand("styleWithCSS", false, true);
        document.execCommand("fontSize", false, "7");

        for (const span of el.querySelectorAll('span[style*="' + MARCA_TAMANHO + '"]')) {
            if (px) {
                span.style.fontSize = px + "px";
                continue;
            }
            span.style.removeProperty("font-size");
            if (!span.getAttribute("style")) {
                span.replaceWith(...span.childNodes);
            }
        }
        return true;
    }

    function alternarCodigo(el) {
        if (!selecaoDentro(el)) el.focus();
        const dentro = dentroDeTag(el, "PRE");
        document.execCommand("formatBlock", false, dentro ? "<div>" : "<pre>");
        return true;
    }

    function executar(el, nome, valor) {
        if (nome === "codigo") return alternarCodigo(el);
        if (nome === "tamanhoFonte") return aplicarTamanhoFonte(el, valor);

        const comando = COMANDOS[nome];
        if (!comando) return false;
        if (!selecaoDentro(el)) el.focus();
        document.execCommand("styleWithCSS", false, !!comando.css);
        document.execCommand(comando.cmd, false, valor);
        return true;
    }

    function estado(el) {
        if (!selecaoDentro(el)) return {};
        const fora = {};
        for (const [nome, comando] of Object.entries(COMANDOS)) {
            try { fora[nome] = document.queryCommandState(comando.cmd); }
            catch { fora[nome] = false; }
        }
        fora.codigo = dentroDeTag(el, "PRE");
        return fora;
    }

    /* ═════════════════════════════  ATTACH  ══════════════════════════════ */

    function attach(el, opts = {}) {
        const onChange = opts.onChange || (() => {});
        let setaAgendada = null;

        function agendarTrocaDeSetas() {
            if (setaAgendada) return;
            setaAgendada = setTimeout(() => {
                setaAgendada = null;
                trocarSetas(el); // o input que isto gera é quem chama o onChange
            }, 0);
        }

        function marcarVazio() {
            el.classList.toggle("vazio", el.textContent.trim() === "");
        }

        function tamanhoIndent() {
            const n = Number(resolver(opts.indentSize));
            return Number.isFinite(n) && n > 0 && n <= 16 ? Math.round(n) : INDENT_PADRAO;
        }

        el.addEventListener("input", () => {
            agendarTrocaDeSetas();
            marcarVazio();
            onChange();
        });

        el.addEventListener("paste", (e) => {
            e.preventDefault();
            const html = e.clipboardData ? e.clipboardData.getData("text/html") : "";
            const texto = (e.clipboardData ? e.clipboardData.getData("text/plain") : "") || "";

            const limpo = html ? RichText.sanitize(html) : "";
            if (limpo && limpo.length <= MAX_COLAGEM) {
                document.execCommand("insertHTML", false, limpo);
            } else {
                document.execCommand("insertText", false, texto.slice(0, MAX_COLAGEM));
            }
        });

        el.addEventListener("drop", (e) => {
            const tipos = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
            if (tipos.includes("Files")) return;
            e.preventDefault();
            const texto = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
            if (texto) document.execCommand("insertText", false, texto);
        });

        function comandoDoAtalho(e) {
            const acelerador = acceleradorDoEvento(e);
            if (!acelerador) return null;
            const atalhos = { ...ATALHOS_PADRAO, ...resolver(opts.atalhos) };
            for (const [nome, valor] of Object.entries(atalhos)) {
                if (valor === acelerador) return nome;
            }
            return null;
        }

        el.addEventListener("keydown", (e) => {
            const comando = comandoDoAtalho(e);
            if (comando) {
                e.preventDefault();
                e.stopPropagation();
                executar(el, comando);
                onChange();
                return;
            }

            if (e.key === "Escape" && opts.onEscape) {
                e.preventDefault();
                e.stopPropagation();
                opts.onEscape();
                return;
            }

            if (e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                
                if (dentroDeTag(el, "LI")) {
                    document.execCommand(e.shiftKey ? "outdent" : "indent");
                } else if (!e.shiftKey) {
                    document.execCommand("insertText", false, " ".repeat(tamanhoIndent()));
                }
                return;
            }

            if (e.key === "Enter") e.stopPropagation();
        });

        if (!opts.jaHigienizado && el.innerHTML) {
            el.innerHTML = RichText.sanitize(el.innerHTML);
        }
        marcarVazio();

        return {
            el,
            exec: (nome, valor) => { if (executar(el, nome, valor)) onChange(); },
            estado: () => estado(el),
            marcarVazio
        };
    }

    /* ══════════════════════════  BARRA DE FERRAMENTAS  ═══════════════════ */

    function montarSeletorDeTamanho(api, meta, opts) {
        const seletor = document.createElement("select");
        seletor.className = "nc-barra-select";
        seletor.title = meta.titulo;

        const padrao = document.createElement("option");
        padrao.value = "";
        padrao.textContent = "Padrão";
        seletor.appendChild(padrao);
        for (const px of (opts.tamanhos || TAMANHOS_FONTE)) {
            const op = document.createElement("option");
            op.value = String(px);
            op.textContent = px + " px";
            seletor.appendChild(op);
        }

        let rangeGuardado = null;
        seletor.addEventListener("mousedown", () => {
            const sel = window.getSelection();
            rangeGuardado = (sel && sel.rangeCount && api.el.contains(sel.getRangeAt(0).commonAncestorContainer))
                ? sel.getRangeAt(0).cloneRange()
                : null;
        });

        seletor.addEventListener("change", () => {
            if (rangeGuardado) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(rangeGuardado);
            }
            api.exec("tamanhoFonte", seletor.value ? Number(seletor.value) : null);
            seletor.selectedIndex = 0; // volta a "Padrão": é ação, não estado
        });

        return seletor;
    }

    function montarBarra(container, api, nomes, opts = {}) {
        container.innerHTML = "";
        container.classList.add("nc-barra");

        const atalhos = { ...ATALHOS_PADRAO, ...resolver(opts.atalhos) };
        const botoes = [];

        for (const nome of nomes) {
            if (nome === "|") {
                const sep = document.createElement("span");
                sep.className = "nc-barra-sep";
                container.appendChild(sep);
                continue;
            }
            const meta = FERRAMENTAS[nome];
            if (!meta) continue;

            if (meta.tipo === "select") {
                container.appendChild(montarSeletorDeTamanho(api, meta, opts));
                continue;
            }

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "nc-barra-btn";
            btn.dataset.ferramenta = nome;
            const atalho = atalhoLegivel(atalhos[nome]);
            btn.title = atalho ? meta.titulo + " (" + atalho + ")" : meta.titulo;
            btn.innerHTML = Icons.svg(meta.icone, opts.tamanhoIcone || 14);

            btn.addEventListener("mousedown", (e) => e.preventDefault());
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                api.exec(nome);
                atualizar();
            });

            container.appendChild(btn);
            botoes.push(btn);
        }

        function atualizar() {
            const ativo = api.estado();
            for (const btn of botoes) {
                btn.classList.toggle("ativo", !!ativo[btn.dataset.ferramenta]);
            }
        }

        let quadroPendente = null;
        function agendarAtualizar() {
            if (quadroPendente) return;

            const agendar = document.hidden
                ? (fn) => setTimeout(fn, 16)
                : (fn) => window.requestAnimationFrame(fn);
            quadroPendente = agendar(() => {
                quadroPendente = null;
                atualizar();
            });
        }

        for (const evento of ["keyup", "mouseup", "focus", "input"]) {
            api.el.addEventListener(evento, agendarAtualizar);
        }
        atualizar();

        return { atualizar, botoes };
    }

    return {
        attach, executar, estado, montarBarra, ligarSetas, aplicarFonte,
        COMANDOS, FERRAMENTAS, BARRA_BASICA, BARRA_COMPLETA, ATALHOS_PADRAO,
        TAMANHOS_FONTE, SETAS, INDENT_PADRAO,
        acceleradorDoEvento, atalhoLegivel
    };
});
