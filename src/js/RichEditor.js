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

    // Opções que mudam em Configurações depois que o editor já existe são
    // aceitas como função, para serem lidas no momento do uso em vez de
    // congeladas na criação.
    function resolver(valor) {
        return typeof valor === "function" ? valor() : valor;
    }

    // Tamanho padrão do texto da nota, em pixel. Vai numa variável de CSS em
      // vez de direto no elemento porque os dois editores têm regras próprias
    // de font-size (uma por classe, outra por id) -- a variável entra como
    // valor delas e vence sem depender de especificidade.
    function aplicarFonte(px) {
        const n = Number(px);
        const raiz = document.documentElement;
        if (Number.isFinite(n) && n >= 8 && n <= 40) {
            raiz.style.setProperty("--nc-fonte-nota", n + "px");
        } else {
            raiz.style.removeProperty("--nc-fonte-nota");
        }
    }

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

    // A seleção está dentro de uma tag dessas? Usado pelo TAB (LI decide se
    // cria sublista ou só empurra o texto) e pelo bloco de código (PRE, que
    // não tem queryCommandState -- é preciso olhar a árvore na mão).
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

    // Mesma troca, para <input> e <textarea>. Ali não existe nó de texto para
    // percorrer -- o conteúdo é a propriedade value, e a posição do cursor
    // vem de selectionStart.
    function trocarSetasEmCampo(el) {
        const texto = el.value || "";
        const achou = PADRAO_SETA.exec(texto);
        if (!achou) return false;

        const cursor = el.selectionStart;
        el.setSelectionRange(achou.index, achou.index + achou[0].length);

        // insertText preserva o desfazer do campo. Se o navegador recusar
        // (campo sem foco, por exemplo), escreve direto e recoloca o cursor:
        // a seta tem 1 caractere onde antes havia 2.
        if (!document.execCommand("insertText", false, SETAS[achou[0]])) {
            el.value = texto.slice(0, achou.index) + SETAS[achou[0]] + texto.slice(achou.index + achou[0].length);
            const novo = cursor > achou.index ? cursor - 1 : cursor;
            el.setSelectionRange(novo, novo);
        }
        return true;
    }

    // Liga SÓ a troca de setas num campo qualquer do app: item de tarefa,
    // checklist de evento, título de card, captura rápida. Não transforma o
    // campo em editor de texto rico -- negrito e companhia continuam
    // exclusivos da nota, que é onde o conteúdo é HTML. Serve para
    // <input>/<textarea> e para contenteditable.
    //
    // O adiamento é o mesmo do attach: o Chromium recusa execCommand
    // disparado de dentro do input de outro execCommand.
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

    // Nome interno -> comando do execCommand. Quem monta barra de ferramentas
    // usa estas chaves; o resto do app não precisa saber que existe
    // execCommand por baixo.
    const COMANDOS = {
        negrito:         { cmd: "bold" },
        italico:         { cmd: "italic" },
        sublinhado:      { cmd: "underline" },
        lista:           { cmd: "insertUnorderedList" },
        listaNumerada:   { cmd: "insertOrderedList" },
        // css: true faz o Chromium escrever estilo em vez de tag/atributo.
        // Para negrito e itálico a tag (<b>, <i>) é mais limpa; alinhamento e
        // tamanho SÓ existem como estilo, e sem isso vem o atributo align,
        // obsoleto e que o sanitize descarta.
        alinharEsquerda: { cmd: "justifyLeft", css: true },
        alinharCentro:   { cmd: "justifyCenter", css: true },
        alinharDireita:  { cmd: "justifyRight", css: true },
        justificar:      { cmd: "justifyFull", css: true },
        indentar:        { cmd: "indent" },
        desindentar:     { cmd: "outdent" }
    };

    // Metadados de apresentação: ícone e rótulo de cada ferramenta. Separado
    // de COMANDOS de propósito -- COMANDOS é o "como faz", isto aqui é o
    // "como aparece", e quem monta barra só precisa do segundo.
    const FERRAMENTAS = {
        negrito:       { icone: "bold",         titulo: "Negrito" },
        italico:       { icone: "italic",       titulo: "Itálico" },
        sublinhado:    { icone: "underline",    titulo: "Sublinhado" },
        lista:         { icone: "list",         titulo: "Lista" },
        listaNumerada: { icone: "list-ordered", titulo: "Lista numerada" },

        // Exclusivas do bloco de notas: num card de 320px não teriam onde
        // caber, e alinhamento/tamanho nem apareceriam na prévia.
        alinharEsquerda: { icone: "align-left",    titulo: "Alinhar à esquerda" },
        alinharCentro:   { icone: "align-center",  titulo: "Centralizar" },
        alinharDireita:  { icone: "align-right",   titulo: "Alinhar à direita" },
        justificar:      { icone: "align-justify", titulo: "Justificar" },
        codigo:          { icone: "code",          titulo: "Bloco de código" },
        tamanhoFonte:    { tipo: "select",         titulo: "Tamanho da fonte" }
    };

    // Ferramentas que valem nos dois editores -- o bloco de notas ganha as
    // exclusivas dele à parte.
    const BARRA_BASICA = ["negrito", "italico", "sublinhado", "|", "lista", "listaNumerada"];

    // Barra cheia da janela do bloco de notas.
    const BARRA_COMPLETA = [
        "negrito", "italico", "sublinhado",
        "|", "lista", "listaNumerada",
        "|", "alinharEsquerda", "alinharCentro", "alinharDireita", "justificar",
        "|", "codigo", "tamanhoFonte"
    ];

    // Atalhos DO EDITOR, não do sistema. Registrar Ctrl+B em globalShortcut
    // roubaria o negrito de todo outro programa aberto no Windows, então
    // estes são tratados no keydown do próprio contenteditable. O formato é o
    // mesmo dos atalhos globais ("Control+Shift+L") para Configurações poder
    // gravar os dois do mesmo jeito.
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

    // "Control+Shift+L" -> "Ctrl+Shift+L", só para caber melhor no tooltip.
    function atalhoLegivel(acelerador) {
        return acelerador ? acelerador.replace("Control", "Ctrl").replace("Super", "Win") : "";
    }

    // Tamanhos oferecidos no seletor. "Padrão" (valor vazio) tira o estilo e
    // devolve o texto ao tamanho do editor.
    const TAMANHOS_FONTE = [12, 14, 16, 18, 22, 28];

    // Não existe execCommand que aceite pixel: fontSize só vai de 1 a 7. O
    // caminho é pedir o 7 (que com styleWithCSS vira font-size: xxx-large)
    // só para o Chromium fazer a parte difícil -- envolver a seleção mesmo
    // quando ela cruza várias tags -- e depois trocar a marca pelo valor real.
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
            // "Padrão": tira o estilo e, se o span não guardava mais nada,
            // desmancha o próprio span em vez de deixar lixo na marcação.
            span.style.removeProperty("font-size");
            if (!span.getAttribute("style")) {
                span.replaceWith(...span.childNodes);
            }
        }
        return true;
    }

    // PRE não tem queryCommandState nem comando de alternar -- formatBlock só
    // sabe aplicar. Sair do bloco é voltar para <div>.
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
        // Foca SÓ quando a seleção não está no editor: focus() num
        // contenteditable já focado recoloca o cursor e descarta a seleção
        // que o comando ia usar -- o botão da barra viraria um comando sem
        // alvo, aplicando nada.
        if (!selecaoDentro(el)) el.focus();
        document.execCommand("styleWithCSS", false, !!comando.css);
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
        fora.codigo = dentroDeTag(el, "PRE");
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
            const n = Number(resolver(opts.indentSize));
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

        // O mapa é resolvido a cada combinação em vez de montado uma vez: os
        // atalhos são configuráveis (ver Configurações) e os cards ficam vivos
        // na tela, então congelar o mapa na criação deixaria o card velho
        // obedecendo o atalho antigo. acceleradorDoEvento devolve null para
        // tecla sem modificador, então digitar normal não paga esse custo.
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
                // preventDefault mesmo em Ctrl+B/I/U, que o contenteditable já
                // trataria sozinho: com os dois caminhos ativos o negrito
                // ligaria e desligaria no mesmo toque.
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
                // Dentro de lista o TAB é o que cria sublista (e Shift+TAB
                // volta um nível). Fora dela, é indentação de texto mesmo.
                if (dentroDeTag(el, "LI")) {
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
            el,
            exec: (nome, valor) => { if (executar(el, nome, valor)) onChange(); },
            estado: () => estado(el),
            marcarVazio
        };
    }

    /* ══════════════════════════  BARRA DE FERRAMENTAS  ═══════════════════ */

    // Um <select> rouba o foco ao abrir, e com o foco vai embora a seleção que
    // o comando precisava. Por isso o range é guardado no mousedown (antes de
    // o foco sair) e reposto na hora de aplicar. Botão não sofre disso porque
    // cancela o próprio mousedown.
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

    // Monta os botões em `container` para o editor de `api` (o retorno do
    // attach). `nomes` é a lista de ferramentas, com "|" onde entra separador.
    function montarBarra(container, api, nomes, opts = {}) {
        container.innerHTML = "";
        container.classList.add("nc-barra");

        // Aqui pode congelar: o tooltip é redesenhado junto com o card.
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

            // Sem isto o clique tira o foco do editor antes de chegar no
            // handler, a seleção se perde e o comando não tem onde ser
            // aplicado -- o botão simplesmente não faria nada.
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

        // Os ouvintes ficam no próprio editor (e não em document), então morrem
        // junto com o card quando o board é redesenhado -- selectionchange é
        // global e vazaria um ouvinte por card criado.
        for (const evento of ["keyup", "mouseup", "focus", "input"]) {
            api.el.addEventListener(evento, atualizar);
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
