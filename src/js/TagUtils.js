/* ───────────────────────────────  TagUtils.js  ─────────────────────────── */
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.TagUtils = factory();
    }
})(function () {
    const PALETTE = ["e05252", "e08a3c", "d4b83c", "4caf6e", "3ca7c4", "4a90d9", "9b6bd4", "e0629c"];

    const HEX = /^[0-9a-f]{6}$/i;

    function corSegura(hex) {
        return HEX.test(String(hex ?? "")) ? String(hex) : PALETTE[0];
    }

    function pillStyle(corBruta) {
        const hex = corSegura(corBruta);
        return `color:#${hex};background:color-mix(in srgb, #${hex} 22%, transparent);`
            + `border:1px solid color-mix(in srgb, #${hex} 45%, transparent);`;
    }

    function findTag(tags, id) {
        return (tags || []).find(t => t.id === id);
    }

    return { PALETTE, pillStyle, findTag, corSegura };
});
