/* ─────────────────────────────  QuickCapture.js  ─────────────────────────── */

const input = document.getElementById("qc-input");

function applySettings(settings) {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme || "gold";
}

function reset() {
    input.value = "";
    input.focus();
}

input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        window.api.send("quick-capture-submit", input.value);
    } else if (e.key === "Escape") {
        e.preventDefault();
        window.api.send("quick-capture-cancel");
    }
});

window.api.on("reset", reset);
window.api.on("apply-settings", applySettings);

window.api.invoke("get-data").then(loaded => applySettings(loaded.settings));

reset();
