/* ─────────────────────────────  TamaPet.js  ────────────────────────────── */
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.TamaPet = factory();
    }
})(function () {

    const TAMA_XP_PER_LEVEL = 100;

    const FOME_MIN_TO_ZERO = 24 * 60;
    const HIGIENE_MIN_TO_ZERO = 60 * 60;
    const CARENCIA_MIN_TO_ZERO = 30 * 60;
    const NEGLECT_THRESHOLD = 25;
    const NORMAL_THRESHOLD = 50;
    const PET_COOLDOWN_MS = 3000;
    const LIVE_TICK_MS = 3 * 60 * 1000;

    const MAX_GAP_MS = 5 * LIVE_TICK_MS;

    const ACOES = {
        comida: [
            { icon: "apple", label: "Maçã", stat: "fome", gain: 5 },
            { icon: "drumstick", label: "Ração", stat: "fome", gain: 10 },
            { icon: "cake", label: "Bolo", stat: "fome", gain: 8, extra: [["carencia", 3]] }
        ],
        brinquedos: [
            { icon: "circle", label: "Bola", stat: "carencia", gain: 15, interaction: true },
            { icon: "wind", label: "Pipa", stat: "carencia", gain: 12, interaction: true, extra: [["fome", -3]] },
            { icon: "gamepad-2", label: "Videogame", stat: "carencia", gain: 20, interaction: true, extra: [["higiene", -5]] }
        ],
        higiene: [
            { icon: "shower-head", label: "Banho", stat: "higiene", gain: 30, anim: "tama-anim-clean" },
            { icon: "sparkles", label: "Escovar dentes", stat: "higiene", gain: 12, anim: "tama-anim-clean" },
            { icon: "scissors", label: "Cortar unhas", stat: "higiene", gain: 10, anim: "tama-anim-clean" }
        ]
    };

    const DICAS_DE_ABA = {
        comida: "A fome recupera sozinha quando você completa tarefas e eventos -- isso aqui é só um extra.",
        brinquedos: "Brincar (e abrir o app, e cutucar o bichinho) é o que mantém a carência em dia.",
        higiene: "Só o banho/escovação recupera a higiene."
    };

    function criar({ data, container, estaPronto, aoAbrir }) {
        const spriteSvg = TamaSprite.svg;
        const mood = TamaSprite.mood;
        const clamp = TamaSprite.clamp;

        const fab       = document.getElementById("tama-fab");
        const fabSprite = document.getElementById("tama-fab-sprite");
        const backBtn   = document.getElementById("tama-back-btn");
        const levelEl   = document.getElementById("tama-level");
        const xpFill    = document.getElementById("tama-xp-fill");
        const stage     = document.getElementById("tama-stage");
        const sprite    = document.getElementById("tama-sprite");
        const tabButtons = document.querySelectorAll(".tama-tab-btn");
        const actionsEl = document.getElementById("tama-actions");
        const barEls = {
            vida: document.getElementById("tama-bar-vida"),
            fome: document.getElementById("tama-bar-fome"),
            carencia: document.getElementById("tama-bar-carencia"),
            higiene: document.getElementById("tama-bar-higiene")
        };

        let abaAtiva = "comida";
        let dicaEl = null;
        let petCooldownUntil = 0;
        let saveTimer = null;

        /* ─────────────────────────  Estado  ───────────────────────────── */

        function aplicarDecaimento() {
            const tama = data.tamagotchi;
            const agora = Date.now();
            const antes = tama.vida + tama.fome + tama.carencia + tama.higiene;

            const gapMs = Math.max(
                agora - (tama.lastUpdate || agora),
                agora - (tama.lastCarenciaUpdate || tama.lastInteraction || agora)
            );
            if (gapMs > MAX_GAP_MS) {
                tama.lastUpdate = agora;
                tama.lastCarenciaUpdate = agora;
                return;
            }

            const elapsedMin = (agora - (tama.lastUpdate || agora)) / 60000;
            if (elapsedMin > 0) {
                tama.fome = clamp(tama.fome - (elapsedMin / FOME_MIN_TO_ZERO) * 100);
                tama.higiene = clamp(tama.higiene - (elapsedMin / HIGIENE_MIN_TO_ZERO) * 100);
                tama.lastUpdate = agora;
            }

            const carenciaElapsedMin = (agora - (tama.lastCarenciaUpdate || tama.lastInteraction || agora)) / 60000;
            if (carenciaElapsedMin > 0) {
                tama.carencia = clamp(tama.carencia - (carenciaElapsedMin / CARENCIA_MIN_TO_ZERO) * 100);
                tama.lastCarenciaUpdate = agora;
            }

            const neglected = [tama.fome, tama.higiene, tama.carencia].filter(v => v < NEGLECT_THRESHOLD).length;
            if (neglected > 0 && elapsedMin > 0) {
                tama.vida = clamp(tama.vida - elapsedMin * 0.35 * neglected);
            } else if (tama.fome >= NORMAL_THRESHOLD && tama.higiene >= NORMAL_THRESHOLD && tama.carencia >= NORMAL_THRESHOLD) {
                tama.vida = clamp(tama.vida + elapsedMin * 0.15);
            }
            tama.vida = Math.max(5, tama.vida);

            return (tama.vida + tama.fome + tama.carencia + tama.higiene) !== antes;
        }

        function registrarInteracao() {
            const agora = Date.now();
            data.tamagotchi.lastInteraction = agora;
            data.tamagotchi.lastCarenciaUpdate = agora;
        }

        function agendarGravacao() {
            if (!estaPronto()) return; 
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                window.api.send("save-data", { tamagotchi: data.tamagotchi });
            }, 400);
        }

        function ganharXp(amount) {
            const tama = data.tamagotchi;
            tama.xp += amount;
            tama.level = 1 + Math.floor(tama.xp / TAMA_XP_PER_LEVEL);
        }

        /* ─────────────────────────  Tela  ─────────────────────────────── */

        function atualizarUI() {
            const tama = data.tamagotchi;
            const svg = spriteSvg(mood(tama));

            sprite.innerHTML = svg;
            fabSprite.innerHTML = svg;

            levelEl.textContent = `Nível ${tama.level}`;
            const xpInLevel = tama.xp % TAMA_XP_PER_LEVEL;
            xpFill.style.width = `${(xpInLevel / TAMA_XP_PER_LEVEL) * 100}%`;

            Object.entries(barEls).forEach(([key, el]) => {
                const value = tama[key];
                el.style.width = `${value}%`;
                el.classList.toggle("tama-critical", value < 25);
            });
        }

        function tocarAnimacaoNoPalco(cls) {
            stage.classList.remove(cls);
            void stage.offsetWidth;
            stage.classList.add(cls);
            setTimeout(() => stage.classList.remove(cls), 700);
        }

        function renderAcoes() {
            actionsEl.innerHTML = "";

            if (!dicaEl) {
                dicaEl = document.createElement("div");
                dicaEl.id = "tama-actions-hint";
            }
            dicaEl.textContent = DICAS_DE_ABA[abaAtiva] || "";
            actionsEl.appendChild(dicaEl);

            ACOES[abaAtiva].forEach(action => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "tama-action-btn";
                btn.innerHTML = `
                    <span class="tama-action-icon">${Icons.svg(action.icon, 18)}</span>
                    <span class="tama-action-label">${action.label}</span>
                    <span class="tama-action-gain">+${action.gain}</span>
                `;
                btn.addEventListener("click", () => {
                    const tama = data.tamagotchi;
                    tama[action.stat] = clamp(tama[action.stat] + action.gain);
                    (action.extra || []).forEach(([stat, delta]) => {
                        tama[stat] = clamp(tama[stat] + delta);
                    });
                    if (action.interaction) registrarInteracao();
                    if (action.anim) tocarAnimacaoNoPalco(action.anim);
                    ganharXp(5);
                    atualizarUI();
                    agendarGravacao();
                });
                actionsEl.appendChild(btn);
            });
        }

        function trocarAba(tab) {
            abaAtiva = tab;
            tabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
            renderAcoes();
        }

        /* ────────────────────────  Abrir e fechar  ────────────────────── */

        function estaAberto() {
            return container.classList.contains("tama-open");
        }

        function abrir() {
            if (aoAbrir) aoAbrir();
            aplicarDecaimento();
            atualizarUI();
            container.classList.add("tama-open");
        }

        function fechar() {
            if (!estaAberto()) return;
            container.classList.remove("tama-open");
            agendarGravacao();
        }

        function fazerCarinho() {
            const agora = Date.now();
            if (agora < petCooldownUntil) return;
            petCooldownUntil = agora + PET_COOLDOWN_MS;
            data.tamagotchi.carencia = clamp(data.tamagotchi.carencia + 2);
            registrarInteracao();
            tocarAnimacaoNoPalco("tama-anim-pet");
            atualizarUI();
            agendarGravacao();
        }

        /* ─────────────────  Ganchos do resto do widget  ───────────────── */

        function aoCompletarTarefa(fomeGain, xpGain) {
            data.tamagotchi.fome = clamp(data.tamagotchi.fome + fomeGain);
            ganharXp(xpGain);
            atualizarUI();
            agendarGravacao();
        }

        function aoAbrirApp() {
            data.tamagotchi.carencia = clamp(data.tamagotchi.carencia + 3);
            registrarInteracao();
            agendarGravacao();
        }

        function iniciar() {
            aplicarDecaimento();
            atualizarUI();
            agendarGravacao();
        }

        /* ────────────────────────────  Ligação  ──────────────────────── */

        tabButtons.forEach(btn => {
            btn.addEventListener("click", () => trocarAba(btn.dataset.tab));
        });

        fab.addEventListener("click", (e) => {
            e.stopPropagation();
            abrir();
            fazerCarinho();
        });
        sprite.addEventListener("click", (e) => {
            e.stopPropagation();
            fazerCarinho();
        });
        backBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            fechar();
        });

        renderAcoes();

        setInterval(() => {
            const mudou = aplicarDecaimento();
            if (estaAberto()) atualizarUI();
            if (mudou) agendarGravacao();
        }, LIVE_TICK_MS);

        window.api.on("open-tama", () => {
            if (container.classList.contains("collapsed")) return; 
            abrir();
        });

        return { iniciar, abrir, fechar, estaAberto, aoCompletarTarefa, aoAbrirApp };
    }

    return { criar };
});
