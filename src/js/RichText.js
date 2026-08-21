/* ────────────────────────────────  RichText.js  ───────────────────────────
   Conteúdo de nota como HTML. Negrito, itálico, alinhamento e tamanho de
   fonte não existem em texto puro, então a nota deixou de ser uma string
   crua e passou a guardar marcação -- e todo lugar que antes tratava
   note.content como texto (prévia do card, contagem de palavras, "a nota
   está vazia?") precisa passar por aqui.

   sanitize() é a fronteira: tudo que entra no editor vindo de fora (nota
   salva em disco, texto colado de outro app) passa por uma lista fechada de
   tags e estilos. A CSP já impede script inline de rodar, mas colar de um
   navegador traz uma montanha de <span style="...">, fonte, cor e classe de
   outro site -- que incharia o data.json e ignoraria o tema do app.

   Mesmo padrão UMD do EventUtils.js/UiUtils.js.
*/
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.RichText = factory();
    }
})(function () {
    // O que o editor sabe produzir, e mais nada.
    const ALLOWED_TAGS = new Set([
        "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
        "BR", "DIV", "P", "SPAN",
        "UL", "OL", "LI",
        "CODE", "PRE", "BLOCKQUOTE"
    ]);

    // style é o único atributo que sobrevive, e só nestas propriedades --
    // cada uma com o formato de valor que ela aceita.
    const ALLOWED_STYLES = {
        "text-align": /^(left|center|right|justify)$/,
        "font-size": /^\d{1,2}(\.\d+)?px$/,
        "font-weight": /^(bold|bolder|normal|[1-9]00)$/,
        "font-style": /^(italic|normal)$/,
        "text-decoration": /^(underline|line-through|none)$/,
        "text-decoration-line": /^(underline|line-through|none)$/,
        "margin-left": /^\d{1,3}px$/
    };

    // Estas somem COM o conteúdo junto: o que está dentro é código ou
    // metadado, não é o texto que a pessoa quis copiar. Toda outra tag
    // desconhecida perde só a si mesma e mantém os filhos (ver copiarFilhos)
    // -- colar uma tabela deve render o texto das células, não o vazio.
    const DROP_TAGS = new Set([
        "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE",
        "IFRAME", "OBJECT", "EMBED", "APPLET",
        "HEAD", "TITLE", "META", "LINK"
    ]);

    // Tags que valem quebra de linha ao virar texto puro.
    const BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "PRE", "BLOCKQUOTE"]);

    // O processo principal não tem DOM. De lá só se pergunta "essa nota está
    // em branco?" (ver discardUntouchedNote em Main.js) e se converte texto
    // puro em HTML, que é só manipulação de string. Para o primeiro caso a
    // versão por expressão regular abaixo basta -- ela nunca monta o que vai
    // pra tela, quem faz isso é sempre o renderer, que tem DOM de verdade.
    const TEM_DOM = typeof DOMParser !== "undefined";

    function escapeText(str) {
        return String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    // DOMParser em vez de innerHTML num elemento vivo: o documento avulso
    // não executa nada nem baixa recurso enquanto a gente inspeciona.
    function parseAvulso(html) {
        return new DOMParser().parseFromString(`<body>${html ?? ""}</body>`, "text/html");
    }

    function copiarEstilosPermitidos(origem, destino) {
        const style = origem.getAttribute("style");
        if (!style) return;
        for (const parte of style.split(";")) {
            const [nomeCru, ...resto] = parte.split(":");
            if (!nomeCru || resto.length === 0) continue;
            const nome = nomeCru.trim().toLowerCase();
            const valor = resto.join(":").trim().toLowerCase();
            const formato = ALLOWED_STYLES[nome];
            if (formato && formato.test(valor)) destino.style.setProperty(nome, valor);
        }
    }

    // Tag fora da lista não some com o conteúdo junto: os filhos sobem pro
    // lugar dela. Colar uma tabela vira o texto das células, não o vazio.
    function copiarFilhos(origem, destino, doc) {
        for (const filho of origem.childNodes) {
            if (filho.nodeType === 3) {
                destino.appendChild(doc.createTextNode(filho.nodeValue));
                continue;
            }
            if (filho.nodeType !== 1) continue;

            // Maiúsculo à força: elemento HTML devolve tagName em maiúsculo,
            // mas dentro de SVG vem em minúsculo -- e aí "<svg><script>" não
            // batia com DROP_TAGS e o código de dentro sobrava como texto da
            // nota. As duas listas são maiúsculas, então a comparação também
            // tem que ser.
            const tag = filho.tagName.toUpperCase();

            if (DROP_TAGS.has(tag)) continue;
            if (!ALLOWED_TAGS.has(tag)) {
                copiarFilhos(filho, destino, doc);
                continue;
            }
            const novo = doc.createElement(tag.toLowerCase());
            copiarEstilosPermitidos(filho, novo);
            copiarFilhos(filho, novo, doc);
            destino.appendChild(novo);
        }
    }

    function sanitize(html) {
        if (!html) return "";
        // Sem DOM não há o que inspecionar. Nesse caminho o HTML já veio
        // higienizado pelo renderer que o produziu, então segue intacto em
        // vez de ser destruído por precaução.
        if (!TEM_DOM) return html;

        const doc = parseAvulso(html);
        const limpo = doc.createElement("div");
        copiarFilhos(doc.body, limpo, doc);
        return limpo.innerHTML;
    }

    function toPlainTextSemDom(html) {
        return String(html ?? "")
            .replace(/<script[^>]*>[^]*?<[/]script>/gi, "")
            .replace(/<style[^>]*>[^]*?<[/]style>/gi, "")
            .replace(/<\s*br\s*\/?>/gi, "\n")
            .replace(/<\/(div|p|li|ul|ol|pre|blockquote)\s*>/gi, "\n")
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/gi, " ")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&amp;/gi, "&")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    // Texto legível de dentro do HTML — prévia do card, contagem de palavras,
    // checagem de "está vazia?". Não usa innerText porque num elemento fora
    // da tela ele não calcula layout e ignora as quebras de linha.
    function toPlainText(html) {
        if (!html) return "";
        if (!TEM_DOM) return toPlainTextSemDom(html);

        const doc = parseAvulso(html);
        let saida = "";

        function quebrar() {
            if (saida && !saida.endsWith("\n")) saida += "\n";
        }
        function percorrer(no) {
            for (const filho of no.childNodes) {
                if (filho.nodeType === 3) { saida += filho.nodeValue; continue; }
                if (filho.nodeType !== 1) continue;
                if (filho.tagName === "BR") { saida += "\n"; continue; }

                const bloco = BLOCK_TAGS.has(filho.tagName);
                if (bloco) quebrar();
                percorrer(filho);
                if (bloco) quebrar();
            }
        }
        percorrer(doc.body);

        return saida
            .replace(/ /g, " ")   // &nbsp; conta como espaço comum
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    // Texto puro virando HTML: nota de versão anterior, captura rápida,
    // arquivo solto no widget e colagem sem formatação passam por aqui. Uma
    // <div> por linha é o que o próprio contenteditable do Chromium produz ao
    // digitar, então o resultado se comporta igual ao que o usuário criaria
    // na mão.
    function fromPlainText(texto) {
        const linhas = String(texto ?? "").split("\n");
        return linhas.map(linha => `<div>${escapeText(linha) || "<br>"}</div>`).join("");
    }

    // "<div><br></div>" é o que sobra num editor esvaziado -- para o usuário
    // isso é vazio, e é isso que decide se a nota recém-criada é descartada.
    function isEmpty(html) {
        return toPlainText(html).trim() === "";
    }

    return { sanitize, toPlainText, fromPlainText, isEmpty, escapeText, ALLOWED_TAGS, ALLOWED_STYLES, DROP_TAGS };
});
