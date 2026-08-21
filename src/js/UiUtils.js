/* ──────────────────────────────  UiUtils.js  ─────────────────────────────
   Utilidades de interface que o widget e a janela de Configurações usavam
   duplicadas (as duas montam cards do mesmo jeito, com o mesmo escape e a
   mesma confirmação de exclusão). Mesmo padrão UMD do EventUtils.js /
   TagUtils.js, mas na prática só é carregado nos renderers.
*/
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.UiUtils = factory();
    }
})(function () {
    function newId() {
        return crypto.randomUUID();
    }

    // textContent -> innerHTML escapa & < >, mas NÃO aspas -- e o resultado é
    // interpolado dentro de atributos (value="${...}") em vários pontos, onde
    // uma aspa fecharia o atributo e injetaria markup. Não é hipotético: o
    // link de um evento pode vir da description de um convite recebido no
    // Google Agenda, ou seja, texto de terceiro.
    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str ?? "";
        return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // "2026-08-05" -> "05/08"
    function formatBR(iso) {
        const [, m, d] = iso.split("-");
        return `${d}/${m}`;
    }

    // window.confirm() é um diálogo NATIVO e bloqueante — na janela do widget
    // (alwaysOnTop no nível "screen-saver", o mais alto do Windows) ele abre
    // escondido atrás do próprio widget, mas ainda assim trava a thread de JS
    // esperando resposta. Resultado: tudo parece travado até o usuário mexer
    // em outra janela por acaso. Por isso exclusão é confirmada com dois
    // cliques no próprio botão, sem diálogo nenhum.
    function armDeleteConfirm(btn, onConfirm) {
        if (btn.classList.contains("confirm-armed")) {
            clearTimeout(btn._armTimer);
            onConfirm();
            return;
        }
        btn.classList.add("confirm-armed");
        btn.textContent = "?";
        btn._armTimer = setTimeout(() => {
            btn.classList.remove("confirm-armed");
            btn.innerHTML = Icons.svg("x", 12);
        }, 2500);
    }

    // Onde o último clique COMEÇOU. O focusout dispara no mousedown, antes do
    // evento de click, e nesse intervalo document.activeElement já é o <body>
    // -- ou seja, "o foco saiu do card" parece verdade mesmo com o usuário
    // clicando dentro do próprio card. Quem recolhe/descarta card no focusout
    // precisa dessa distinção, senão o card fecha no mousedown e o click
    // seguinte, vendo o card já fechado, reabre.
    //
    // A janela de 700 ms existe porque nada "limpa" esse registro: um clique
    // fora gera um pointerdown novo (o caso comum), mas sair do card só com
    // Tab não gera nenhum -- aí o registro velho não pode continuar valendo.
    const POINTER_RECENT_MS = 700;
    let lastPointerDown = { target: null, at: 0 };

    document.addEventListener("pointerdown", (e) => {
        lastPointerDown = { target: e.target, at: Date.now() };
    }, true);

    function clickStartedInside(el) {
        if (!lastPointerDown.target) return false;
        if (Date.now() - lastPointerDown.at > POINTER_RECENT_MS) return false;
        return el.contains(lastPointerDown.target);
    }

    return { newId, escapeHtml, formatBR, armDeleteConfirm, clickStartedInside };
});
