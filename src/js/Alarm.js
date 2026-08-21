/* ────────────────────────────────  Alarm.js  ─────────────────────────────── */
// O bichinho virtual "empresta a cara" pro alarme -- mesmo desenho e humor
// do painel dele no widget (ver TamaSprite.js), com uma linha de intro
// variada em vez do "Evento" seco de antes.

Log.iniciar("alarme");

const spriteEl = document.getElementById("alarm-sprite");
const introEl  = document.getElementById("alarm-intro");
const titleEl  = document.getElementById("alarm-title");
const timeEl   = document.getElementById("alarm-time");

const INTROS = ["Ei, olha isso:", "Psiu, um lembrete:", "Toc toc! Não esquece:", "Oi! Isso aqui te espera:"];

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
    spriteEl.innerHTML = TamaSprite.svg(TamaSprite.mood(payload.tamagotchi));
    introEl.textContent = INTROS[Math.floor(Math.random() * INTROS.length)];
    titleEl.textContent = payload.title || "Evento";
    timeEl.textContent = payload.time || "";
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
