/* ──────────────────────────────  AlarmSounds.js  ──────────────────────────
   Melodias do alarme sintetizadas na hora via Web Audio API — sem nenhum
   arquivo de áudio externo (o app não depende de internet nem de assets
   binários pra isso). Cada som é só uma sequência de notas [frequência,
   duração_ms, pausa_ms] tocadas em onda senoidal suave, em loop até algo
   chamar a função de parar que play() devolve.

   Só funciona em renderer (usa AudioContext do navegador) — por isso não
   segue o padrão require()-friendly do EventUtils/TagUtils; é só
   window.AlarmSounds mesmo.
*/
(function () {
    const SOUNDS = {
        sininho: {
            label: "Sininho",
            notes: [[880, 140, 60], [988, 140, 60], [1175, 320, 500]]
        },
        caixinha: {
            label: "Caixinha de música",
            notes: [
                [523, 180, 20], [659, 180, 20], [784, 180, 20],
                [659, 180, 20], [523, 180, 20], [784, 360, 500]
            ]
        },
        passarinho: {
            label: "Passarinho",
            notes: [
                [1568, 70, 30], [1760, 70, 30], [1976, 90, 120],
                [1760, 70, 30], [1568, 70, 400]
            ]
        },
        classico: {
            label: "Clássico suave",
            notes: [[700, 160, 120], [700, 160, 500]]
        }
    };

    // Toca soundKey em loop até o valor de retorno ser chamado. volume: 0-100.
    function play(soundKey, volume) {
        const sound = SOUNDS[soundKey] || SOUNDS.sininho;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();

        const master = ctx.createGain();
        master.gain.value = Math.max(0, Math.min(1, (volume ?? 70) / 100));
        master.connect(ctx.destination);

        let stopped = false;
        let timeoutId = null;

        function scheduleOnce() {
            if (stopped) return;
            let t = ctx.currentTime;
            sound.notes.forEach(([freq, durationMs, gapMs]) => {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = "sine";
                osc.frequency.value = freq;
                const dur = durationMs / 1000;
                // envelope curtinho pra não estalar no começo/fim da nota
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(1, t + Math.min(0.02, dur / 4));
                g.gain.linearRampToValueAtTime(0, t + dur);
                osc.connect(g);
                g.connect(master);
                osc.start(t);
                osc.stop(t + dur + 0.02);
                t += (durationMs + gapMs) / 1000;
            });
            const totalMs = sound.notes.reduce((sum, [, dur, gap]) => sum + dur + gap, 0);
            timeoutId = setTimeout(scheduleOnce, totalMs + 350);
        }
        scheduleOnce();

        return function stop() {
            if (stopped) return;
            stopped = true;
            clearTimeout(timeoutId);
            master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
            setTimeout(() => ctx.close().catch(() => {}), 150);
        };
    }

    window.AlarmSounds = { SOUNDS, play };
})();
