/* ───────────────────────────────  TagUtils.js  ───────────────────────────
   Paleta de cores e helpers de estilo pra tags. Compartilhado entre o
   widget e a janela de Configurações (mesmo padrão UMD do EventUtils.js).
*/
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.TagUtils = factory();
    }
})(function () {
    const PALETTE = ["e05252", "e08a3c", "d4b83c", "4caf6e", "3ca7c4", "4a90d9", "9b6bd4", "e0629c"];

    // color-mix() é suportado pelo Chromium recente (Electron 41) — evita
    // ter que converter hex pra rgba na mão só pra dar transparência.
    function pillStyle(hex) {
        return `color:#${hex};background:color-mix(in srgb, #${hex} 22%, transparent);`
            + `border:1px solid color-mix(in srgb, #${hex} 45%, transparent);`;
    }

    function findTag(tags, id) {
        return (tags || []).find(t => t.id === id);
    }

    return { PALETTE, pillStyle, findTag };
});
