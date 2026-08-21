/* ──────────────────────────────  UiUtils.js  ───────────────────────────── */
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
