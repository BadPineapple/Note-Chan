/* ────────────────────────────────  Alarm.js  ─────────────────────────────── */

const titleEl = document.getElementById("alarm-title");
const timeEl  = document.getElementById("alarm-time");

let stopSound = null;

function applyTheme(settings) {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme || "gold";
}

function silence() {
    if (stopSound) { stopSound(); stopSound = null; }
}

window.api.on("alarm-ring", (payload) => {
    silence();
    titleEl.textContent = payload.title || "Evento";
    timeEl.textContent = payload.time ? `⏰ ${payload.time}` : "";
    stopSound = AlarmSounds.play(payload.sound, payload.volume);
});

document.getElementById("alarm-stop-btn").addEventListener("click", () => {
    silence();
    window.api.send("alarm-stop");
});

document.getElementById("alarm-snooze-btn").addEventListener("click", () => {
    silence();
    window.api.send("alarm-snooze");
});

window.api.on("apply-settings", applyTheme);
window.api.invoke("get-data").then(loaded => applyTheme(loaded.settings));
