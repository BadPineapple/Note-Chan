/* ────────────────────────────────  RichText.js  ─────────────────────────── */
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.RichText = factory();
    }
})(function () {
    const ALLOWED_TAGS = new Set([
        "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
        "BR", "DIV", "P", "SPAN",
        "UL", "OL", "LI",
        "CODE", "PRE", "BLOCKQUOTE"
    ]);

    const ALLOWED_STYLES = {
        "text-align": /^(left|center|right|justify)$/,
        "font-size": /^\d{1,2}(\.\d+)?px$/,
        "font-weight": /^(bold|bolder|normal|[1-9]00)$/,
        "font-style": /^(italic|normal)$/,
        "text-decoration": /^(underline|line-through|none)$/,
        "text-decoration-line": /^(underline|line-through|none)$/,
        "margin-left": /^\d{1,3}px$/
    };

    const DROP_TAGS = new Set([
        "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE",
        "IFRAME", "OBJECT", "EMBED", "APPLET",
        "HEAD", "TITLE", "META", "LINK"
    ]);

    const BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "PRE", "BLOCKQUOTE"]);

    const TEM_DOM = typeof DOMParser !== "undefined";

    function escapeText(str) {
        return String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

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

    function copiarFilhos(origem, destino, doc) {
        for (const filho of origem.childNodes) {
            if (filho.nodeType === 3) {
                destino.appendChild(doc.createTextNode(filho.nodeValue));
                continue;
            }
            if (filho.nodeType !== 1) continue;

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

    function fromPlainText(texto) {
        const linhas = String(texto ?? "").split("\n");
        return linhas.map(linha => `<div>${escapeText(linha) || "<br>"}</div>`).join("");
    }

    function isEmpty(html) {
        return toPlainText(html).trim() === "";
    }

    return { sanitize, toPlainText, fromPlainText, isEmpty, escapeText, ALLOWED_TAGS, ALLOWED_STYLES, DROP_TAGS };
});
