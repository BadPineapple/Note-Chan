/* ─────────────────────────────  TamaPet.js  ──────────────────────────────
   O bichinho virtual: status que decaem com o tempo, nível por XP, painel
   de interação e as notificações que o alimentam. Saiu do Widget.js, onde
   dividia um escopo só com abas, cards, busca e cronômetro -- qualquer um
   deles alcançava o estado do bichinho sem querer.

   O desenho do personagem NÃO mora aqui: fica em TamaSprite.js, que também
   é usado pelo popup de alarme. Este arquivo cuida do comportamento.

   Recebe o que precisa em vez de pescar de variável global (ver criar):

     data        objeto de estado do widget, por referência -- as mutações
                 em data.tamagotchi precisam ser vistas por quem salva.
     container   raiz do widget, onde entra/sai a classe tama-open.
     estaPronto  função, não valor: o boot do widget só termina depois que
                 o get-data volta, e gravar antes disso mandaria estado
                 vazio pro main (ver scheduleSave em Widget.js). Como o
                 módulo é criado antes desse momento, precisa consultar na
                 hora, não receber uma cópia de "false".
     aoAbrir     chamado ao abrir o painel. Busca, cronômetro e bichinho
                 ocupam o mesmo espaço e se excluem, mas quem sabe disso é
                 o Widget.js -- daqui de dentro é só um aviso de "abri".

   Mesmo padrão UMD dos outros módulos compartilhados; na prática só o
   widget carrega este.
*/
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.TamaPet = factory();
    }
})(function () {

    const TAMA_XP_PER_LEVEL = 100;

    // Cada status decai por um motivo diferente (ver aplicarDecaimento):
    // fome/higiene caem só com o tempo passando (higiene mais devagar);
    // carência cai com a falta de INTERAÇÃO direta (abrir o app, brincar,
    // cutucar o bichinho), não com o relógio puro; vida não decai sozinha,
    // só sofre se as outras 3 ficarem ruins por muito tempo, e se recupera
    // sozinha quando elas voltam ao normal.
    // Os três contam SÓ tempo de PC ligado com o app rodando (ver o salto
    // grande tratado em aplicarDecaimento), então são horas de uso real,
    // não de calendário.
    const FOME_MIN_TO_ZERO = 24 * 60;     // 24h de uso sem comer
    const HIGIENE_MIN_TO_ZERO = 60 * 60;  // 60h -- sempre foi a mais lenta das três
    const CARENCIA_MIN_TO_ZERO = 30 * 60; // 30h sem interação nenhuma
    const NEGLECT_THRESHOLD = 25;         // abaixo disso conta como "negligenciado"
    const NORMAL_THRESHOLD = 50;          // acima disso conta como "normal" pra vida regenerar
    const PET_COOLDOWN_MS = 3000;         // evita fazer carinho em rajada pra inflar carência
    const LIVE_TICK_MS = 3 * 60 * 1000;   // recalcula decaimento periodicamente mesmo com o painel fechado

    // Salto maior que isso desde a última passada não é tempo de uso: é app
    // fechado, máquina dormindo/hibernando ou processo congelado pelo
    // sistema. Generoso de propósito (5x o tick) -- errar pra mais só faz
    // contar alguns minutos de sono como uso, o que é irrisório perto de
    // 24h; errar pra menos travaria o decaimento de vez, e aí o bichinho
    // nunca sentiria fome.
    const MAX_GAP_MS = 5 * LIVE_TICK_MS;

    // { icon, label, stat, gain, interaction: true marca lastInteraction
    // (conta como "carência recuperada por atenção"), anim: classe de
    // animação rápida no palco, extra: [[outroStat, valor], ...] pra
    // efeitos colaterais }.
    // Comida aqui é bônus manual/cosmético -- a forma "de verdade" de matar
    // a fome é completar tarefas/eventos nas outras abas (ver
    // aoCompletarTarefa).
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

        // Recalcula os status a partir do tempo real decorrido desde a
        // última vez que foram tocados -- cobre tanto o app ter ficado
        // fechado por horas quanto o widget só ter ficado parado numa aba
        // diferente. fome/higiene usam lastUpdate (tempo puro); carência usa
        // lastInteraction (só anda quando o usuário de fato interage -- ver
        // registrarInteracao).
        // Devolve se algum status mudou de verdade -- o tick periódico usa
        // isso para não gravar em disco a cada 3 minutos sem ter o que
        // salvar.
        function aplicarDecaimento() {
            const tama = data.tamagotchi;
            const agora = Date.now();
            const antes = tama.vida + tama.fome + tama.carencia + tama.higiene;

            // Só conta o tempo em que o computador esteve de fato ligado com
            // o app rodando: um buraco grande desde a última passada
            // significa app fechado, PC dormindo ou processo congelado. Nesse
            // caso reancora os relógios sem descontar nada -- voltar de um
            // fim de semana não encontra o bichinho faminto, ele fica
            // exatamente como foi deixado.
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

            // Carência precisa do próprio marcador de "última vez que o
            // decaimento foi aplicado", igual lastUpdate faz pra
            // fome/higiene. Medir sempre a partir de lastInteraction e
            // SUBTRAIR o resultado do valor atual conta o mesmo tempo de novo
            // a cada chamada: com o tick de 3 min a carência zerava em ~1h em
            // vez das 10h projetadas. lastInteraction continua existindo como
            // registro de quando o usuário de fato interagiu.
            const carenciaElapsedMin = (agora - (tama.lastCarenciaUpdate || tama.lastInteraction || agora)) / 60000;
            if (carenciaElapsedMin > 0) {
                tama.carencia = clamp(tama.carencia - (carenciaElapsedMin / CARENCIA_MIN_TO_ZERO) * 100);
                tama.lastCarenciaUpdate = agora;
            }

            // Vida não decai pelo relógio puro -- só sofre quando algum dos
            // outros 3 fica abaixo do limiar POR TEMPO (o dano é proporcional
            // a elapsedMin, então um mergulho rápido quase não pesa; só a
            // negligência sustentada por horas de verdade acumula dano).
            // Recupera sozinha quando os 3 estão acima do "normal" -- nenhuma
            // ação cuida da vida diretamente.
            const neglected = [tama.fome, tama.higiene, tama.carencia].filter(v => v < NEGLECT_THRESHOLD).length;
            if (neglected > 0 && elapsedMin > 0) {
                tama.vida = clamp(tama.vida - elapsedMin * 0.35 * neglected);
            } else if (tama.fome >= NORMAL_THRESHOLD && tama.higiene >= NORMAL_THRESHOLD && tama.carencia >= NORMAL_THRESHOLD) {
                tama.vida = clamp(tama.vida + elapsedMin * 0.15);
            }
            // nunca "morre" nessa versão base -- só fica bem mal cuidado
            // visualmente.
            tama.vida = Math.max(5, tama.vida);

            return (tama.vida + tama.fome + tama.carencia + tama.higiene) !== antes;
        }

        // Marca que o usuário interagiu de verdade com o app/bichinho agora
        // -- única coisa que "segura" o decaimento de carência (ver
        // aplicarDecaimento).
        function registrarInteracao() {
            const agora = Date.now();
            data.tamagotchi.lastInteraction = agora;
            // zera também o relógio do decaimento, senão o tempo já "pago"
            // antes da interação voltaria a ser descontado na próxima passada.
            data.tamagotchi.lastCarenciaUpdate = agora;
        }

        function agendarGravacao() {
            if (!estaPronto()) return; // mesmo motivo do scheduleSave do Widget.js
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
            // força reflow pra poder re-disparar a mesma animação em sequência
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

        // "Clicar nela" (no FAB ou no personagem dentro do painel) é uma das
        // formas de recuperar carência -- cooldown curto pra não dar pra
        // inflar o status só clicando em rajada.
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

        // Forma "de verdade" de matar a fome do bichinho: completar
        // tarefas/eventos nas outras abas. Comida na aba Comida é só bônus
        // manual.
        function aoCompletarTarefa(fomeGain, xpGain) {
            data.tamagotchi.fome = clamp(data.tamagotchi.fome + fomeGain);
            ganharXp(xpGain);
            atualizarUI();
            agendarGravacao();
        }

        // Sair da bandeja conta como atenção: é uma das formas de recuperar
        // carência, junto com brincar e cutucar.
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

        // Recalcula e salva o decaimento periodicamente mesmo com o painel
        // fechado -- sem isso, o main só veria o status do bichinho tão
        // fresco quanto a última vez que o painel foi aberto, e as
        // notificações de status baixo (ver Main.js) ficariam paradas no
        // tempo se o usuário nunca abrir a aba.
        setInterval(() => {
            const mudou = aplicarDecaimento();
            if (estaAberto()) atualizarUI();
            if (mudou) agendarGravacao();
        }, LIVE_TICK_MS);

        // Abre o painel quando o usuário clica numa notificação sobre o
        // bichinho (ver Main.js -> showPetNotification).
        window.api.on("open-tama", () => {
            if (container.classList.contains("collapsed")) return; // main já expandiu antes de mandar isso
            abrir();
        });

        return { iniciar, abrir, fechar, estaAberto, aoCompletarTarefa, aoAbrirApp };
    }

    return { criar };
});
