/* ────────────────────────────────  Widget.js  ───────────────────────────── */
// Renderer do widget. Roda em sandbox (sem Node) — toda comunicação com o
// processo principal passa por window.api (ver preload.js).

let data = {
    notes: [], lists: [], events: [], tags: [],
    tamagotchi: {
        level: 1, xp: 0, vida: 100, fome: 100, carencia: 100, higiene: 100,
        lastUpdate: Date.now(), lastInteraction: Date.now(), lastCarenciaUpdate: Date.now()
    },
    widget: { collapsed: true, activeTab: "notas" }
};
let activeTab = "notas";
const expanded = new Set();

const container   = document.getElementById("container");
const board       = document.getElementById("board");
const newBtn      = document.getElementById("new-btn");
const tabButtons  = document.querySelectorAll(".tab-btn");
const searchBtn   = document.getElementById("searchbtn");
const searchBar   = document.getElementById("search-bar");
const searchInput = document.getElementById("search-input");

const timerBtn         = document.getElementById("timerbtn");
const timerPanel       = document.getElementById("timer-panel");
const timerBadge       = document.getElementById("timer-badge");
const timerDisplay     = document.getElementById("timer-display");
const timerModeButtons = document.querySelectorAll(".timer-mode-btn");
const timerDurationRow = document.getElementById("timer-duration-row");
const timerMinutesEl   = document.getElementById("timer-minutes");
const timerSecondsEl   = document.getElementById("timer-seconds");
const timerStartBtn    = document.getElementById("timer-start-btn");
const timerResetBtn    = document.getElementById("timer-reset-btn");

const tamaFab        = document.getElementById("tama-fab");
const tamaFabSprite   = document.getElementById("tama-fab-sprite");
const tamaOverlay     = document.getElementById("tama-overlay");
const tamaBackBtn     = document.getElementById("tama-back-btn");
const tamaLevelEl     = document.getElementById("tama-level");
const tamaXpFill      = document.getElementById("tama-xp-fill");
const tamaStage       = document.getElementById("tama-stage");
const tamaSprite      = document.getElementById("tama-sprite");
const tamaTabButtons  = document.querySelectorAll(".tama-tab-btn");
const tamaActionsEl   = document.getElementById("tama-actions");
const tamaBarEls = {
    vida: document.getElementById("tama-bar-vida"),
    fome: document.getElementById("tama-bar-fome"),
    carencia: document.getElementById("tama-bar-carencia"),
    higiene: document.getElementById("tama-bar-higiene")
};

/* ══════════════════════════════  PERSISTÊNCIA  ══════════════════════════ */

// Enquanto o get-data do boot não voltar, `data` ainda são os arrays vazios
// do topo do arquivo. Um save disparado nesse intervalo mandaria listas
// vazias pro main, que trata item ausente como EXCLUÍDO (ver
// mergeMainOwnedList em Main.js) -- apagaria tudo e ainda enfileiraria a
// exclusão no Google. Nenhuma gravação sai antes do boot terminar.
let booted = false;

let saveTimer = null;
function scheduleSave() {
    if (!booted) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        window.api.send("save-data", {
            notes: data.notes,
            lists: data.lists,
            events: data.events,
            widget: { activeTab }
        });
    }, 400);
}

/* ═══════════════════════════════  UTILIDADES  ═══════════════════════════ */

// Compartilhadas com a janela de Configurações — ver UiUtils.js.
const { newId, escapeHtml, formatBR, armDeleteConfirm, clickStartedInside } = UiUtils;

function now() {
    return Date.now();
}

function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
}

/* ═══════════════════════════════════  TAGS  ══════════════════════════════ */
// Definições vivem em data.tags (dono: janela de Configurações); cada
// nota/lista/evento só guarda os ids em item.tagIds. Pills no canto oposto
// ao título (ver .card-tags no Style.css) + um seletor pra atribuir/tirar
// dentro do card expandido.

// Miolo do .card-tags (só os pills, sem o wrapper — o wrapper já vem fixo
// no template HTML de cada card pra dar pra atualizar via innerHTML depois).
function cardTagsInnerHtml(tagIds) {
    if (!tagIds || tagIds.length === 0) return "";
    return tagIds
        .map(id => TagUtils.findTag(data.tags, id))
        .filter(Boolean)
        .map(tag => `<span class="tag-pill" style="${TagUtils.pillStyle(tag.color)}">${escapeHtml(tag.name)}</span>`)
        .join("");
}

function refreshCardTagsHeader(card, item) {
    const slot = card?.querySelector(".card-tags");
    if (slot) slot.innerHTML = cardTagsInnerHtml(item.tagIds);
}

// pickerEl, não "container": o #container do widget é uma global deste
// arquivo e sombrear o nome aqui dentro é pedir confusão.
function renderTagPicker(pickerEl, item) {
    pickerEl.innerHTML = "";
    if (data.tags.length === 0) {
        pickerEl.innerHTML = `<span class="tag-picker-hint">Crie tags em Configurações → Tags</span>`;
        return;
    }
    item.tagIds = item.tagIds || [];
    data.tags.forEach(tag => {
        const active = item.tagIds.includes(tag.id);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tag-toggle" + (active ? " active" : "");
        btn.textContent = tag.name;
        if (active) btn.setAttribute("style", TagUtils.pillStyle(tag.color));
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            item.tagIds = item.tagIds.includes(tag.id)
                ? item.tagIds.filter(id => id !== tag.id)
                : [...item.tagIds, tag.id];
            item.updatedAt = now();
            scheduleSave();
            renderTagPicker(pickerEl, item);
            refreshCardTagsHeader(pickerEl.closest(".card"), item);
        });
        pickerEl.appendChild(btn);
    });
}

const RECURRENCE_ICON = Icons.svg("repeat", 11);
const RECURRENCE_LABELS = {
    none: "Não se repete",
    daily: `${RECURRENCE_ICON} Diário`,
    weekly: `${RECURRENCE_ICON} Semanal`,
    monthly: `${RECURRENCE_ICON} Mensal`,
    yearly: `${RECURRENCE_ICON} Anual`
};

// { text, cls } prontos pra virar um .event-badge
function occurrenceBadge(occDate) {
    if (!occDate) return { text: `${Icons.svg("check", 11)} Concluído`, cls: "done" };
    const today = EventUtils.todayISO();
    if (occDate === today) return { text: "Hoje", cls: "today" };
    if (occDate === EventUtils.addInterval(today, "daily")) return { text: "Amanhã", cls: "soon" };
    if (occDate < today) return { text: `Atrasado · ${formatBR(occDate)}`, cls: "overdue" };
    return { text: formatBR(occDate), cls: "" };
}

/* ═══════════════════════════════  ABAS  ══════════════════════════════════ */

const NEW_BTN_LABELS = { notas: "+ Nova nota", listas: "+ Nova lista", eventos: "+ Novo evento" };

function setActiveTab(tab) {
    activeTab = tab;
    tabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    newBtn.textContent = NEW_BTN_LABELS[tab] || NEW_BTN_LABELS.notas;
    scheduleSave();
    renderBoard();
}

tabButtons.forEach(btn => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
});

/* ═══════════════════════════════  BUSCA  ══════════════════════════════════ */
// Filtra os cards da aba ativa pelo título. Acento é ignorado (NFD + strip
// de diacríticos) pra "cafe" encontrar "café" sem o usuário precisar digitar
// o acento certo.

let searchQuery = "";

function normalizeSearch(str) {
    return (str ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function isSearchOpen() {
    return searchBar.classList.contains("open");
}

function openSearch() {
    closeTimerPanel();
    closeTama();
    searchBar.classList.add("open");
    searchInput.focus();
    searchInput.select();
}

function closeSearch() {
    searchBar.classList.remove("open");
    if (searchQuery) {
        searchInput.value = "";
        searchQuery = "";
        renderBoard();
    }
}

function toggleSearch() {
    if (isSearchOpen()) closeSearch();
    else openSearch();
}

searchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSearch();
});

searchInput.addEventListener("input", () => {
    searchQuery = normalizeSearch(searchInput.value);
    renderBoard();
});

searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeSearch();
    }
});

// Foco saiu do campo (clicou em outro lugar, trocou de aba, etc.) -> some
// sozinha, mesmo padrão de recolher usado nos cards (ver focusout em
// noteCardNode/listCardNode/eventCardNode).
searchInput.addEventListener("blur", () => {
    setTimeout(() => {
        if (document.activeElement === searchInput) return;
        closeSearch();
    }, 0);
});

/* ═══════════════════════  CRONÔMETRO / TEMPORIZADOR  ══════════════════════ */
// Cronômetro conta pra cima a partir de zero; temporizador conta pra baixo a
// partir da duração escolhida. Os dois compartilham o mesmo relógio interno
// (accumulatedMs + timestamp de início) pra não perder precisão em pausas
// longas -- nunca soma "1 tick" por segundo, sempre recalcula a partir de
// Date.now(). O tempo rodando aparece discreto na dragbar (#timer-badge),
// visível mesmo com o painel fechado ou o widget em modo bandeja.

let timerMode = "stopwatch"; // "stopwatch" | "timer"
let timerRunning = false;
let timerAccumulatedMs = 0;      // tempo já contado antes da pausa atual
let timerRunStartTs = null;      // Date.now() de quando rodou/retomou -- null se pausado
let timerDurationMs = 5 * 60000; // só usado no modo "timer"
let timerTickHandle = null;
let stopTimerSound = null;

function formatTimerMs(ms) {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function timerElapsedMs() {
    return timerAccumulatedMs + (timerRunning ? Date.now() - timerRunStartTs : 0);
}

function isTimerOpen() {
    return timerPanel.classList.contains("open");
}

// currentMs: o que mostrar AGORA (cronômetro = decorrido; temporizador =
// restante). done: chegou a zero no modo temporizador.
function updateTimerDisplay() {
    const elapsed = timerElapsedMs();
    let currentMs = elapsed;
    let done = false;
    if (timerMode === "timer") {
        currentMs = timerDurationMs - elapsed;
        done = currentMs <= 0;
        if (done) currentMs = 0;
    }

    const text = formatTimerMs(currentMs);
    timerDisplay.textContent = text;
    timerDisplay.classList.toggle("timer-done", done);

    // Badge só aparece com algo rodando ou pausado no meio (elapsed > 0) --
    // discreto por padrão, some sozinho quando não há nada acontecendo.
    timerBadge.textContent = (timerRunning || elapsed > 0) ? text : "";
    timerBadge.classList.toggle("timer-done", done);

    return done;
}

function stopTimerTick() {
    if (timerTickHandle) { clearInterval(timerTickHandle); timerTickHandle = null; }
}

function playTimerDoneSound() {
    if (stopTimerSound) { stopTimerSound(); stopTimerSound = null; }
    const alarm = data.settings?.alarm || {};
    stopTimerSound = AlarmSounds.play(alarm.sound || "sininho", alarm.volume ?? 70);
    setTimeout(() => { if (stopTimerSound) { stopTimerSound(); stopTimerSound = null; } }, 2600);
}

function timerFinished() {
    timerRunning = false;
    timerRunStartTs = null;
    timerAccumulatedMs = timerDurationMs;
    stopTimerTick();
    updateTimerDisplay();
    playTimerDoneSound();
    timerStartBtn.textContent = "▶ Iniciar";
    // volta pra tela de "escolher duração" depois de um instante, já com o
    // fim visível (timer-done) por um momento antes de resetar sozinho.
    setTimeout(() => { if (!timerRunning) resetTimer(); }, 2600);
}

function startTimerTick() {
    stopTimerTick();
    timerTickHandle = setInterval(() => {
        const done = updateTimerDisplay();
        if (timerMode === "timer" && done) timerFinished();
    }, 250);
}

function isChoosingDuration() {
    return timerMode === "timer" && !timerRunning && timerAccumulatedMs === 0;
}

// Rodando OU pausado no meio -- nesses dois casos trocar de modo descartaria
// progresso, então os botões de modo ficam desabilitados.
function timerHasProgress() {
    return timerRunning || timerAccumulatedMs > 0;
}

function updateDurationRowVisibility() {
    timerDurationRow.classList.toggle("visible", isChoosingDuration());
}

// Enquanto o temporizador ainda não começou, o mostrador reflete o que tá
// nos campos de duração (preview) em vez do relógio -- senão ficaria parado
// em 00:00 até apertar Iniciar, parecendo que os campos não fazem nada.
function updateDurationPreview() {
    if (!isChoosingDuration()) return;
    const min = Math.max(0, Math.min(180, Number(timerMinutesEl.value) || 0));
    const sec = Math.max(0, Math.min(59, Number(timerSecondsEl.value) || 0));
    timerDisplay.textContent = formatTimerMs((min * 60 + sec) * 1000);
    timerDisplay.classList.remove("timer-done");
    // escolhendo duração = parado e zerado, então a badge discreta some.
    timerBadge.textContent = "";
    timerBadge.classList.remove("timer-done");
}

function refreshTimerDisplay() {
    if (isChoosingDuration()) updateDurationPreview();
    else updateTimerDisplay();
}

timerMinutesEl.addEventListener("input", updateDurationPreview);
timerSecondsEl.addEventListener("input", updateDurationPreview);

function setTimerMode(mode) {
    if (timerHasProgress() || mode === timerMode) return; // troca de modo só zerado
    // troca de modo sempre começa do zero -- um cronômetro pausado em 0:45
    // não devia "herdar" esse tempo pro temporizador (nem vice-versa).
    timerAccumulatedMs = 0;
    timerMode = mode;
    timerStartBtn.textContent = "▶ Iniciar";
    timerModeButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.mode === mode));
    updateDurationRowVisibility();
    refreshTimerDisplay();
}

timerModeButtons.forEach(btn => {
    btn.addEventListener("click", () => setTimerMode(btn.dataset.mode));
});

function startPauseTimer() {
    if (timerRunning) {
        // pausa
        timerAccumulatedMs = timerElapsedMs();
        timerRunning = false;
        timerRunStartTs = null;
        stopTimerTick();
        timerStartBtn.textContent = "▶ Continuar";
    } else {
        if (timerMode === "timer" && timerAccumulatedMs === 0) {
            const min = Math.max(0, Math.min(180, Number(timerMinutesEl.value) || 0));
            const sec = Math.max(0, Math.min(59, Number(timerSecondsEl.value) || 0));
            timerDurationMs = (min * 60 + sec) * 1000;
            if (timerDurationMs <= 0) return; // nada pra contar
        }
        timerRunning = true;
        timerRunStartTs = Date.now();
        startTimerTick();
        timerStartBtn.textContent = "⏸ Pausar";
    }
    timerModeButtons.forEach(btn => btn.disabled = timerHasProgress());
    updateDurationRowVisibility();
    refreshTimerDisplay();
}

function resetTimer() {
    timerRunning = false;
    timerRunStartTs = null;
    timerAccumulatedMs = 0;
    stopTimerTick();
    if (stopTimerSound) { stopTimerSound(); stopTimerSound = null; }
    timerStartBtn.textContent = "▶ Iniciar";
    timerModeButtons.forEach(btn => btn.disabled = false);
    updateDurationRowVisibility();
    refreshTimerDisplay();
}

timerStartBtn.addEventListener("click", startPauseTimer);
timerResetBtn.addEventListener("click", resetTimer);

function openTimerPanel() {
    closeSearch();
    closeTama();
    timerPanel.classList.add("open");
}

function closeTimerPanel() {
    timerPanel.classList.remove("open");
}

function toggleTimerPanel() {
    if (isTimerOpen()) closeTimerPanel();
    else openTimerPanel();
}

timerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTimerPanel();
});

// Clicar fora fecha o painel (não tem um único campo pra pendurar um
// blur/focusout como a busca -- é um painel com vários controles).
document.addEventListener("click", (e) => {
    if (!isTimerOpen()) return;
    if (timerPanel.contains(e.target) || timerBtn.contains(e.target)) return;
    closeTimerPanel();
});

updateDurationRowVisibility();
refreshTimerDisplay();

/* ═══════════════════════════  BICHINHO VIRTUAL  ═══════════════════════════ */
// Base simples pra evoluir depois: 4 status (vida/fome/carência/higiene) que
// decaem com o tempo real (recalculado a partir de lastUpdate, não por tick
// contínuo -- assim funciona certo mesmo se o widget ficar fechado/em
// segundo plano por horas), nível por XP acumulado, e 3 abas de interação
// que alimentam/brincam/limpam. O personagem é desenhado num grid de pixels
// (SVG gerado por fórmula, sem imagem nenhuma) que muda de carinha conforme
// o humor médio dos status.

const TAMA_XP_PER_LEVEL = 100;

// Cada status decai por um motivo diferente (ver applyTamaDecay):
// fome/higiene caem só com o tempo passando (higiene mais devagar); carência
// cai com a falta de INTERAÇÃO direta (abrir o app, brincar, cutucar o
// bichinho), não com o relógio puro; vida não decai sozinha, só sofre se as
// outras 3 ficarem ruins por muito tempo (ver applyTamaDecay), e se recupera
// sozinha quando elas voltam ao normal.
// Os três contam SÓ tempo de PC ligado com o app rodando (ver o salto grande
// tratado em applyTamaDecay), então são horas de uso real, não de calendário.
const TAMA_FOME_MIN_TO_ZERO = 24 * 60;     // 24h de uso sem comer
const TAMA_HIGIENE_MIN_TO_ZERO = 60 * 60;  // 60h -- sempre foi a mais lenta das três
const TAMA_CARENCIA_MIN_TO_ZERO = 30 * 60; // 30h sem interação nenhuma
const TAMA_NEGLECT_THRESHOLD = 25;         // abaixo disso conta como "negligenciado"
const TAMA_NORMAL_THRESHOLD = 50;          // acima disso conta como "normal" pra vida regenerar
const TAMA_PET_COOLDOWN_MS = 3000;         // evita fazer carinho em rajada pra inflar carência
const TAMA_LIVE_TICK_MS = 3 * 60 * 1000;   // recalcula decaimento periodicamente mesmo com o painel fechado

// Salto maior que isso desde a última passada não é tempo de uso: é app
// fechado, máquina dormindo/hibernando ou processo congelado pelo sistema.
// Generoso de propósito (5x o tick) -- errar pra mais só faz contar alguns
// minutos de sono como uso, o que é irrisório perto de 24h; errar pra menos
// travaria o decaimento de vez, e aí o bichinho nunca sentiria fome.
const TAMA_MAX_GAP_MS = 5 * TAMA_LIVE_TICK_MS;

// Desenho do personagem (grid de pixels -> SVG) mora em TamaSprite.js,
// compartilhado com o popup de alarme -- ver esse arquivo.
const tamaSpriteSvg = TamaSprite.svg;
const tamaMood = TamaSprite.mood;
const tamaClamp = TamaSprite.clamp;

// Recalcula os status a partir do tempo real decorrido desde a última vez
// que foram tocados -- cobre tanto o app ter ficado fechado por horas quanto
// o widget só ter ficado parado numa aba diferente. fome/higiene usam
// lastUpdate (tempo puro); carência usa lastInteraction (só anda quando o
// usuário de fato interage -- ver tamaRegisterInteraction).
function applyTamaDecay() {
    const tama = data.tamagotchi;
    const now = Date.now();

    // Só conta o tempo em que o computador esteve de fato ligado com o app
    // rodando: um buraco grande desde a última passada significa app fechado,
    // PC dormindo ou processo congelado. Nesse caso reancora os relógios sem
    // descontar nada -- voltar de um fim de semana não encontra o bichinho
    // faminto, ele fica exatamente como foi deixado.
    const gapMs = Math.max(
        now - (tama.lastUpdate || now),
        now - (tama.lastCarenciaUpdate || tama.lastInteraction || now)
    );
    if (gapMs > TAMA_MAX_GAP_MS) {
        tama.lastUpdate = now;
        tama.lastCarenciaUpdate = now;
        return;
    }

    const elapsedMin = (now - (tama.lastUpdate || now)) / 60000;
    if (elapsedMin > 0) {
        tama.fome = tamaClamp(tama.fome - (elapsedMin / TAMA_FOME_MIN_TO_ZERO) * 100);
        tama.higiene = tamaClamp(tama.higiene - (elapsedMin / TAMA_HIGIENE_MIN_TO_ZERO) * 100);
        tama.lastUpdate = now;
    }

    // Carência precisa do próprio marcador de "última vez que o decaimento
    // foi aplicado", igual lastUpdate faz pra fome/higiene. Medir sempre a
    // partir de lastInteraction e SUBTRAIR o resultado do valor atual conta o
    // mesmo tempo de novo a cada chamada: com o tick de 3 min a carência
    // zerava em ~1h em vez das 10h projetadas. lastInteraction continua
    // existindo como registro de quando o usuário de fato interagiu.
    const carenciaElapsedMin = (now - (tama.lastCarenciaUpdate || tama.lastInteraction || now)) / 60000;
    if (carenciaElapsedMin > 0) {
        tama.carencia = tamaClamp(tama.carencia - (carenciaElapsedMin / TAMA_CARENCIA_MIN_TO_ZERO) * 100);
        tama.lastCarenciaUpdate = now;
    }

    // Vida não decai pelo relógio puro -- só sofre quando algum dos outros 3
    // fica abaixo do limiar POR TEMPO (o dano é proporcional a elapsedMin,
    // então um mergulho rápido quase não pesa; só a negligência sustentada
    // por horas de verdade acumula dano). Recupera sozinha quando os 3 estão
    // acima do "normal" -- nenhuma ação cuida da vida diretamente.
    const neglected = [tama.fome, tama.higiene, tama.carencia].filter(v => v < TAMA_NEGLECT_THRESHOLD).length;
    if (neglected > 0 && elapsedMin > 0) {
        tama.vida = tamaClamp(tama.vida - elapsedMin * 0.35 * neglected);
    } else if (tama.fome >= TAMA_NORMAL_THRESHOLD && tama.higiene >= TAMA_NORMAL_THRESHOLD && tama.carencia >= TAMA_NORMAL_THRESHOLD) {
        tama.vida = tamaClamp(tama.vida + elapsedMin * 0.15);
    }
    // nunca "morre" nessa versão base -- só fica bem mal cuidado visualmente.
    tama.vida = Math.max(5, tama.vida);
}

// Marca que o usuário interagiu de verdade com o app/bichinho agora --
// única coisa que "segura" o decaimento de carência (ver applyTamaDecay).
function tamaRegisterInteraction() {
    const now = Date.now();
    data.tamagotchi.lastInteraction = now;
    // zera também o relógio do decaimento, senão o tempo já "pago" antes da
    // interação voltaria a ser descontado na próxima passada.
    data.tamagotchi.lastCarenciaUpdate = now;
}

let tamaSaveTimer = null;
function scheduleTamaSave() {
    if (!booted) return; // mesmo motivo do scheduleSave
    clearTimeout(tamaSaveTimer);
    tamaSaveTimer = setTimeout(() => {
        window.api.send("save-data", { tamagotchi: data.tamagotchi });
    }, 400);
}

function updateTamaUI() {
    const tama = data.tamagotchi;
    const mood = tamaMood(tama);
    const svg = tamaSpriteSvg(mood);

    tamaSprite.innerHTML = svg;
    tamaFabSprite.innerHTML = svg;

    tamaLevelEl.textContent = `Nível ${tama.level}`;
    const xpInLevel = tama.xp % TAMA_XP_PER_LEVEL;
    tamaXpFill.style.width = `${(xpInLevel / TAMA_XP_PER_LEVEL) * 100}%`;

    Object.entries(tamaBarEls).forEach(([key, el]) => {
        const value = tama[key];
        el.style.width = `${value}%`;
        el.classList.toggle("tama-critical", value < 25);
    });
}

function tamaGainXp(amount) {
    const tama = data.tamagotchi;
    tama.xp += amount;
    tama.level = 1 + Math.floor(tama.xp / TAMA_XP_PER_LEVEL);
}

// Forma "de verdade" de matar a fome do bichinho: completar tarefas/eventos
// nas outras abas (chamado pelos hooks de checkbox de item e de "marcar
// evento como feito" mais abaixo). Comida na aba Comida é só bônus manual.
function tamaOnTaskCompleted(fomeGain, xpGain) {
    data.tamagotchi.fome = tamaClamp(data.tamagotchi.fome + fomeGain);
    tamaGainXp(xpGain);
    updateTamaUI();
    scheduleTamaSave();
}

// { icon, label, stat, gain, interaction: true marca lastInteraction (conta
// como "carência recuperada por atenção"), anim: classe de animação rápida
// no palco, extra: [[outroStat, valor], ...] pra efeitos colaterais }.
// Comida aqui é bônus manual/cosmético -- a forma "de verdade" de matar a
// fome é completar tarefas/eventos nas outras abas (ver hooks mais abaixo).
const TAMA_ACTIONS = {
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

const TAMA_TAB_HINTS = {
    comida: "A fome recupera sozinha quando você completa tarefas e eventos -- isso aqui é só um extra.",
    brinquedos: "Brincar (e abrir o app, e cutucar o bichinho) é o que mantém a carência em dia.",
    higiene: "Só o banho/escovação recupera a higiene."
};

let tamaActiveTab = "comida";
let tamaActionsHint = null;

function tamaPlayStageAnim(cls) {
    tamaStage.classList.remove(cls);
    // força reflow pra poder re-disparar a mesma animação em sequência
    void tamaStage.offsetWidth;
    tamaStage.classList.add(cls);
    setTimeout(() => tamaStage.classList.remove(cls), 700);
}

function renderTamaActions() {
    tamaActionsEl.innerHTML = "";

    if (!tamaActionsHint) {
        tamaActionsHint = document.createElement("div");
        tamaActionsHint.id = "tama-actions-hint";
    }
    tamaActionsHint.textContent = TAMA_TAB_HINTS[tamaActiveTab] || "";
    tamaActionsEl.appendChild(tamaActionsHint);

    TAMA_ACTIONS[tamaActiveTab].forEach(action => {
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
            tama[action.stat] = tamaClamp(tama[action.stat] + action.gain);
            (action.extra || []).forEach(([stat, delta]) => {
                tama[stat] = tamaClamp(tama[stat] + delta);
            });
            if (action.interaction) tamaRegisterInteraction();
            if (action.anim) tamaPlayStageAnim(action.anim);
            tamaGainXp(5);
            updateTamaUI();
            scheduleTamaSave();
        });
        tamaActionsEl.appendChild(btn);
    });
}

function setTamaTab(tab) {
    tamaActiveTab = tab;
    tamaTabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    renderTamaActions();
}

tamaTabButtons.forEach(btn => {
    btn.addEventListener("click", () => setTamaTab(btn.dataset.tab));
});

function isTamaOpen() {
    return container.classList.contains("tama-open");
}

function openTama() {
    closeSearch();
    closeTimerPanel();
    applyTamaDecay();
    updateTamaUI();
    container.classList.add("tama-open");
}

function closeTama() {
    if (!isTamaOpen()) return;
    container.classList.remove("tama-open");
    scheduleTamaSave();
}

// "Clicar nela" (no FAB ou no personagem dentro do painel) é uma das formas
// de recuperar carência -- cooldown curto pra não dar pra inflar o status só
// clicando em rajada.
let tamaPetCooldownUntil = 0;
function tamaPet() {
    const now = Date.now();
    if (now < tamaPetCooldownUntil) return;
    tamaPetCooldownUntil = now + TAMA_PET_COOLDOWN_MS;
    data.tamagotchi.carencia = tamaClamp(data.tamagotchi.carencia + 2);
    tamaRegisterInteraction();
    tamaPlayStageAnim("tama-anim-pet");
    updateTamaUI();
    scheduleTamaSave();
}

tamaFab.addEventListener("click", (e) => {
    e.stopPropagation();
    openTama();
    tamaPet();
});
tamaSprite.addEventListener("click", (e) => {
    e.stopPropagation();
    tamaPet();
});
tamaBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTama();
});

renderTamaActions();

// Recalcula e salva o decaimento periodicamente mesmo com o painel fechado
// -- sem isso, o main só veria o status do bichinho tão fresco quanto a
// última vez que o painel foi aberto, e as notificações de status baixo
// (ver Main.js) ficariam paradas no tempo se o usuário nunca abrir a aba.
setInterval(() => {
    applyTamaDecay();
    if (isTamaOpen()) updateTamaUI();
    scheduleTamaSave();
}, TAMA_LIVE_TICK_MS);

// Abre o painel do bichinho quando o usuário clica numa notificação sobre
// ele (ver Main.js -> showPetNotification).
window.api.on("open-tama", () => {
    if (container.classList.contains("collapsed")) return; // main já expandiu antes de mandar isso
    openTama();
});

/* ═════════════════════════════  CRIAÇÃO  ═════════════════════════════════ */

function createNote() {
    const note = { id: newId(), title: "Nova nota", content: "", createdAt: now(), updatedAt: now() };
    data.notes.unshift(note);
    scheduleSave();
    renderBoard();
    expanded.add(note.id);
    const card = board.querySelector(`.card[data-id="${note.id}"]`);
    if (card) {
        card.classList.add("expanded");
        card.querySelector(".note-editor")?.focus();
    }
}

function createList() {
    const list = { id: newId(), title: "Nova lista", items: [], createdAt: now(), updatedAt: now() };
    data.lists.unshift(list);
    scheduleSave();
    renderBoard();
    expanded.add(list.id);
    const card = board.querySelector(`.card[data-id="${list.id}"]`);
    if (card) {
        card.classList.add("expanded");
        card.querySelector(".item-add")?.focus();
    }
}

function createEvent() {
    const event = {
        id: newId(),
        title: "Novo evento",
        date: EventUtils.todayISO(),
        recurrence: "none",
        startTime: null,
        endTime: null,
        link: null,
        completedDates: [],
        items: [],
        createdAt: now(),
        updatedAt: now()
    };
    data.events.push(event);
    scheduleSave();
    renderBoard();
    expanded.add(event.id);
    const card = board.querySelector(`.card[data-id="${event.id}"]`);
    if (card) {
        card.classList.add("expanded");
        const title = card.querySelector(".card-title");
        title.contentEditable = "true";
        title.focus();
        document.execCommand("selectAll", false, null);
    }
}

newBtn.addEventListener("click", () => {
    if (activeTab === "notas") createNote();
    else if (activeTab === "listas") createList();
    else createEvent();
});

/* ══════════════════════  ARRASTAR-E-SOLTAR DE CARDS  ══════════════════════ */
// Reordena os cards de Notas/Listas dentro do array de dados (a ordem de
// exibição É a ordem do array). Eventos fica de fora — lá a ordem é
// calculada pela próxima ocorrência, não faria sentido arrastar.

let dragCardId = null;

function attachCardDrag(card, id, itemsArray) {
    card.draggable = true;

    card.addEventListener("dragstart", (e) => {
        // não inicia o drag do card se o gesto começou dentro de um campo
        // editável (ex.: selecionando texto na nota) — senão a seleção de
        // texto vira drag do card inteiro.
        if (isEditingContext()) { e.preventDefault(); return; }
        dragCardId = id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        board.querySelectorAll(".card").forEach(el =>
            el.classList.remove("drag-over-top", "drag-over-bottom"));
        dragCardId = null;
    });
    card.addEventListener("dragover", (e) => {
        if (!dragCardId || dragCardId === id) return;
        e.preventDefault();
        const before = (e.clientY - card.getBoundingClientRect().top) < card.offsetHeight / 2;
        card.classList.toggle("drag-over-top", before);
        card.classList.toggle("drag-over-bottom", !before);
    });
    card.addEventListener("dragleave", () => {
        card.classList.remove("drag-over-top", "drag-over-bottom");
    });
    card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drag-over-top", "drag-over-bottom");
        if (!dragCardId || dragCardId === id) return;

        const fromIdx = itemsArray.findIndex(x => x.id === dragCardId);
        if (fromIdx === -1) return; // veio de outra aba — ignora

        const [moved] = itemsArray.splice(fromIdx, 1);
        const before = (e.clientY - card.getBoundingClientRect().top) < card.offsetHeight / 2;
        let toIdx = itemsArray.findIndex(x => x.id === id);
        if (!before) toIdx += 1;
        itemsArray.splice(toIdx, 0, moved);
        scheduleSave();
        renderBoard();
    });
}

/* ═════════════  CABEÇALHO DO CARD: ABRIR, FECHAR E RENOMEAR  ══════════════ */

// clickStartedInside (ver UiUtils.js) é o que distingue "o foco saiu do
// card" de "o usuário clicou dentro do próprio card": sem isso o card
// recolhia no mousedown e o click seguinte, vendo o card já fechado,
// reabria. Só notas e listas sofriam, porque só elas põem foco num campo ao
// expandir -- evento não foca nada, por isso passava ileso.
//
// Clique simples alterna expandido/recolhido; duplo clique no título
// renomeia. Os dois gestos disputam o mesmo alvo, então recolher A PARTIR DO
// TÍTULO espera a janela do duplo clique antes de valer. Sem essa espera o
// 1º clique fecha o card e o duplo clique nunca chega a entrar em edição --
// e numa nota/lista recém-criada ela ainda sumia no caminho, porque card sem
// conteúdo é descartado ao ser recolhido. Clique no resto do cabeçalho
// (espaço vazio, área das tags) continua recolhendo na hora.
const DBLCLICK_GRACE_MS = 220;

// expand(focusField): abre o card; focusField=false quando a abertura é só
// pra renomear, pra não roubar o foco do título. collapse(): fecha.
// Devolve { beginTitleEdit } pra quem precisa entrar em edição por outro
// caminho (o Enter que navega entre os campos do evento, por exemplo).
function attachHeaderToggle(card, title, expand, collapse) {
    let pendingCollapse = null;

    function cancelPendingCollapse() {
        if (pendingCollapse === null) return;
        clearTimeout(pendingCollapse);
        pendingCollapse = null;
    }

    function beginTitleEdit() {
        cancelPendingCollapse();
        if (!card.classList.contains("expanded")) expand(false);
        title.contentEditable = "true";
        title.focus();
        document.execCommand("selectAll", false, null);
    }

    card.querySelector(".card-header").addEventListener("click", (e) => {
        if (e.detail > 1) return; // 2º clique do duplo-clique — quem trata é o dblclick
        if (!card.classList.contains("expanded")) { expand(true); return; }
        if (title.contains(e.target)) {
            cancelPendingCollapse();
            pendingCollapse = setTimeout(() => {
                pendingCollapse = null;
                collapse();
            }, DBLCLICK_GRACE_MS);
        } else {
            collapse();
        }
    });

    // Foco saiu de todos os campos do card (clicou fora, deu Tab pra fora,
    // etc.) -> recolhe sozinho. O setTimeout espera o próximo tick porque
    // focusout dispara ANTES do novo elemento realmente ganhar o foco —
    // checar document.activeElement direto seria sempre o elemento antigo.
    card.addEventListener("focusout", () => {
        setTimeout(() => {
            if (card.contains(document.activeElement)) return;
            if (clickStartedInside(card)) return; // ver UiUtils.js
            cancelPendingCollapse();
            collapse();
        }, 0);
    });

    title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        beginTitleEdit();
    });

    // Já editando: o clique só posiciona o cursor, não alterna o card.
    title.addEventListener("click", (e) => { if (title.isContentEditable) e.stopPropagation(); });

    return { beginTitleEdit };
}

/* ═══════════════════════════════  NOTAS  ═════════════════════════════════ */

function noteCardNode(note) {
    const card = document.createElement("div");
    card.className = "card" + (expanded.has(note.id) ? " expanded" : "");
    card.dataset.id = note.id;

    card.innerHTML = `
        <div class="card-delete" draggable="false" title="Excluir nota">${Icons.svg("x", 12)}</div>
        <div class="card-header">
            <span class="card-title" spellcheck="false" draggable="false">${escapeHtml(note.title)}</span>
            <div class="card-tags">${cardTagsInnerHtml(note.tagIds)}</div>
        </div>
        <div class="card-preview">${escapeHtml(note.content.slice(0, 80)) || "(vazia)"}</div>
        <div class="card-body">
            <textarea class="note-editor" placeholder="Escreva aqui..." draggable="false">${escapeHtml(note.content)}</textarea>
            <div class="card-meta">Atualizado em ${formatDate(note.updatedAt)}</div>
            <div class="tag-picker"></div>
        </div>
    `;

    renderTagPicker(card.querySelector(".tag-picker"), note);

    const title = card.querySelector(".card-title");

    function expandNote(focusEditor) {
        card.classList.add("expanded");
        expanded.add(note.id);
        if (focusEditor) card.querySelector(".note-editor")?.focus();
    }

    function collapseNote() {
        if (!card.classList.contains("expanded")) return;
        card.classList.remove("expanded");
        expanded.delete(note.id);
        // Recolher com o título ainda em edição (ex.: nota criada — o
        // título já nasce editável — fechada antes de terminar de digitar
        // o nome) commita direto em vez de confiar no evento blur -- o
        // título pode estar contentEditable=true sem ter foco de verdade
        // (ex.: janela sem foco do SO quando o card foi criado), e nesse
        // caso title.blur() não dispararia o handler de blur nenhuma vez,
        // deixando o título "preso" editável escondido atrás do card.
        if (title.isContentEditable) commitTitle();
        // nota nunca editada (título e conteúdo ainda no padrão) — some
        // sozinha em vez de acumular cards vazios.
        if (note.title === "Nova nota" && !note.content.trim()) {
            data.notes = data.notes.filter(n => n.id !== note.id);
            card.remove();
            scheduleSave();
            if (data.notes.length === 0) renderBoard();
        }
    }

    attachHeaderToggle(card, title, expandNote, collapseNote);

    // Sai do modo de edição do título e salva o nome -- chamado pelo blur
    // real (usuário clicou fora) OU direto pelo collapseNote() (ver acima),
    // já que blur() só dispara o evento se o elemento REALMENTE tinha foco.
    function commitTitle() {
        title.contentEditable = "false";
        note.title = title.textContent.trim() || "Sem título";
        title.textContent = note.title;
        note.updatedAt = now();
        scheduleSave();
    }

    title.addEventListener("blur", commitTitle);
    title.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        title.blur();
    });

    const editor = card.querySelector(".note-editor");
    editor.addEventListener("input", () => {
        note.content = editor.value;
        note.updatedAt = now();
        card.querySelector(".card-preview").textContent = note.content.slice(0, 80) || "(vazia)";
        scheduleSave();
    });
    // Enter finaliza a edição; Shift+Enter quebra linha normalmente.
    editor.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        editor.blur();
    });

    card.querySelector(".card-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        armDeleteConfirm(e.currentTarget, () => {
            data.notes = data.notes.filter(n => n.id !== note.id);
            expanded.delete(note.id);
            scheduleSave();
            card.remove();
            if (data.notes.length === 0) renderBoard();
        });
    });

    attachCardDrag(card, note.id, data.notes);
    return card;
}

/* ═══════════════════════════════  LISTAS  ════════════════════════════════ */

// Estado do arrastar-e-soltar de itens (compartilhado entre todos os
// item-list abertos — o próprio drop só reordena se o item de origem
// pertencer à lista alvo, então arrastar entre listas diferentes não faz
// nada em vez de corromper o array).
let dragItemId = null;

function listItemNode(list, item, refreshPreview, insertItemAfter) {
    const li = document.createElement("div");
    li.className = "list-item" + (item.done ? " done" : "");
    li.dataset.id = item.id;
    li.draggable = true;

    li.innerHTML = `
        <input type="checkbox" draggable="false" ${item.done ? "checked" : ""} />
        <span class="item-text" contenteditable="true" spellcheck="false" draggable="false">${escapeHtml(item.text)}</span>
        <div class="item-delete" draggable="false" title="Excluir item">${Icons.svg("x", 10)}</div>
    `;

    li.addEventListener("dragstart", (e) => {
        dragItemId = item.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
        li.classList.remove("dragging");
        li.parentElement?.querySelectorAll(".list-item").forEach(el =>
            el.classList.remove("drag-over-top", "drag-over-bottom"));
        dragItemId = null;
    });
    li.addEventListener("dragover", (e) => {
        if (!dragItemId || dragItemId === item.id) return;
        e.preventDefault();
        const before = (e.clientY - li.getBoundingClientRect().top) < li.offsetHeight / 2;
        li.classList.toggle("drag-over-top", before);
        li.classList.toggle("drag-over-bottom", !before);
    });
    li.addEventListener("dragleave", () => {
        li.classList.remove("drag-over-top", "drag-over-bottom");
    });
    li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("drag-over-top", "drag-over-bottom");
        if (!dragItemId || dragItemId === item.id) return;

        const fromIdx = list.items.findIndex(i => i.id === dragItemId);
        if (fromIdx === -1) return; // veio de outra lista — ignora

        const [moved] = list.items.splice(fromIdx, 1);
        const before = (e.clientY - li.getBoundingClientRect().top) < li.offsetHeight / 2;
        let toIdx = list.items.findIndex(i => i.id === item.id);
        if (!before) toIdx += 1;
        list.items.splice(toIdx, 0, moved);
        list.updatedAt = now();
        scheduleSave();

        const listEl = li.parentElement;
        listEl.innerHTML = "";
        list.items.forEach(it => listEl.appendChild(listItemNode(list, it, refreshPreview, insertItemAfter)));
    });

    li.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
        item.done = e.target.checked;
        li.classList.toggle("done", item.done);
        list.updatedAt = now();
        refreshPreview();
        scheduleSave();
        // Completar uma tarefa alimenta o bichinho automaticamente (ver
        // BICHINHO VIRTUAL acima) -- só ao MARCAR como feito, não ao
        // desmarcar. Esse checkbox é compartilhado entre itens de lista e
        // checklist de evento, então cobre os dois.
        if (item.done) tamaOnTaskCompleted(6, 3);
    });

    const text = li.querySelector(".item-text");
    text.addEventListener("blur", () => {
        item.text = text.textContent.trim();
        if (!item.text) {
            list.items = list.items.filter(i => i.id !== item.id);
            li.remove();
        }
        list.updatedAt = now();
        refreshPreview();
        scheduleSave();
    });
    text.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        if (!text.textContent.trim()) {
            // vazio -> finaliza removendo o item. Faz isso direto aqui (não
            // só via text.blur()) porque o evento blur nem sempre dispara
            // de forma síncrona e confiável — melhor não depender dele
            // pra uma ação visível como remover o item.
            list.items = list.items.filter(i => i.id !== item.id);
            list.updatedAt = now();
            refreshPreview();
            scheduleSave();
            li.remove();
        } else {
            insertItemAfter(item.id); // continua a lista com um item novo logo abaixo
        }
    });

    li.querySelector(".item-delete").addEventListener("click", () => {
        list.items = list.items.filter(i => i.id !== item.id);
        list.updatedAt = now();
        refreshPreview();
        scheduleSave();
        li.remove();
    });

    return li;
}

function listCardNode(list) {
    const card = document.createElement("div");
    card.className = "card" + (expanded.has(list.id) ? " expanded" : "");
    card.dataset.id = list.id;

    const done = list.items.filter(i => i.done).length;

    card.innerHTML = `
        <div class="card-delete" draggable="false" title="Excluir lista">${Icons.svg("x", 12)}</div>
        <div class="card-header">
            <span class="card-title" spellcheck="false" draggable="false">${escapeHtml(list.title)}</span>
            <div class="card-tags">${cardTagsInnerHtml(list.tagIds)}</div>
        </div>
        <div class="card-preview">${done}/${list.items.length} concluídos</div>
        <div class="card-body">
            <div class="item-list"></div>
            <input class="item-add" type="text" placeholder="+ Adicionar item e pressionar Enter" draggable="false" />
            <div class="tag-picker"></div>
        </div>
    `;

    renderTagPicker(card.querySelector(".tag-picker"), list);

    function refreshPreview() {
        card.querySelector(".card-preview").textContent =
            `${list.items.filter(i => i.done).length}/${list.items.length} concluídos`;
    }

    // Enter num item não vazio continua a lista: cria um item novo logo
    // abaixo do de origem e move o foco pra lá (estilo Notion/Todoist).
    function insertItemAfter(afterId) {
        const idx = list.items.findIndex(i => i.id === afterId);
        const newItem = { id: newId(), text: "", done: false };
        list.items.splice(idx === -1 ? list.items.length : idx + 1, 0, newItem);
        list.updatedAt = now();
        refreshPreview();
        scheduleSave();

        const afterLi = itemList.querySelector(`.list-item[data-id="${afterId}"]`);
        const newLi = listItemNode(list, newItem, refreshPreview, insertItemAfter);
        if (afterLi && afterLi.nextSibling) itemList.insertBefore(newLi, afterLi.nextSibling);
        else itemList.appendChild(newLi);
        newLi.querySelector(".item-text").focus();
    }

    const itemList = card.querySelector(".item-list");
    list.items.forEach(item => itemList.appendChild(listItemNode(list, item, refreshPreview, insertItemAfter)));

    const title = card.querySelector(".card-title");

    function expandList(focusAddInput) {
        card.classList.add("expanded");
        expanded.add(list.id);
        if (focusAddInput) card.querySelector(".item-add")?.focus();
    }

    function collapseList() {
        if (!card.classList.contains("expanded")) return;
        card.classList.remove("expanded");
        expanded.delete(list.id);
        if (title.isContentEditable) commitTitle();
        // lista nunca editada (título padrão e sem itens) — some sozinha.
        if (list.title === "Nova lista" && list.items.length === 0) {
            data.lists = data.lists.filter(l => l.id !== list.id);
            card.remove();
            scheduleSave();
            if (data.lists.length === 0) renderBoard();
        }
    }

    attachHeaderToggle(card, title, expandList, collapseList);

    function commitTitle() {
        title.contentEditable = "false";
        list.title = title.textContent.trim() || "Sem título";
        title.textContent = list.title;
        list.updatedAt = now();
        scheduleSave();
    }

    title.addEventListener("blur", commitTitle);
    title.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        title.blur();
    });

    const addInput = card.querySelector(".item-add");
    addInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.stopPropagation();
        const text = addInput.value.trim();
        if (!text) return;
        const item = { id: newId(), text, done: false };
        list.items.push(item);
        list.updatedAt = now();
        itemList.appendChild(listItemNode(list, item, refreshPreview, insertItemAfter));
        refreshPreview();
        addInput.value = "";
        scheduleSave();
    });

    card.querySelector(".card-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        armDeleteConfirm(e.currentTarget, () => {
            data.lists = data.lists.filter(l => l.id !== list.id);
            expanded.delete(list.id);
            scheduleSave();
            card.remove();
            if (data.lists.length === 0) renderBoard();
        });
    });

    attachCardDrag(card, list.id, data.lists);
    return card;
}

/* ═══════════════════════════════  EVENTOS  ═══════════════════════════════ */

function eventCardNode(event) {
    const card = document.createElement("div");
    card.className = "card" + (expanded.has(event.id) ? " expanded" : "");
    card.dataset.id = event.id;

    card.innerHTML = `
        <div class="card-delete" title="Excluir evento">${Icons.svg("x", 12)}</div>
        <div class="card-header">
            <span class="card-title" spellcheck="false">${escapeHtml(event.title)}</span>
            <div class="card-tags">${cardTagsInnerHtml(event.tagIds)}</div>
        </div>
        <div class="card-preview"></div>
        <div class="card-body">
            <div class="event-fields">
                <div class="event-row">
                    <label>Data
                        <input type="date" class="ev-date" value="${event.date}" />
                    </label>
                    <label>Recorrência
                        <select class="ev-recurrence">
                            <option value="none"    ${event.recurrence === "none" ? "selected" : ""}>Não se repete</option>
                            <option value="daily"   ${event.recurrence === "daily" ? "selected" : ""}>Diariamente</option>
                            <option value="weekly"  ${event.recurrence === "weekly" ? "selected" : ""}>Semanalmente</option>
                            <option value="monthly" ${event.recurrence === "monthly" ? "selected" : ""}>Mensalmente</option>
                            <option value="yearly"  ${event.recurrence === "yearly" ? "selected" : ""}>Anualmente</option>
                        </select>
                    </label>
                </div>
                <div class="event-row">
                    <label>Início (opcional)
                        <input type="time" class="ev-start" value="${event.startTime || ""}" />
                    </label>
                    <label>Fim (opcional)
                        <input type="time" class="ev-end" value="${event.endTime || ""}" />
                    </label>
                </div>
                <div class="event-link-row">
                    <label>Link (opcional)
                        <input type="text" class="ev-link" placeholder="https://..." value="${escapeHtml(event.link || "")}" />
                    </label>
                    <button class="event-open-link" title="Abrir link" ${event.link ? "" : "disabled"}>${Icons.svg("external-link", 12)} Abrir</button>
                </div>
            </div>
            <div class="event-checklist-label">Checklist</div>
            <div class="item-list"></div>
            <input class="item-add" type="text" placeholder="+ Adicionar tarefa e pressionar Enter" draggable="false" />
            <div class="tag-picker"></div>
            <button class="event-done-btn"></button>
        </div>
    `;

    const preview   = card.querySelector(".card-preview");
    const doneBtn   = card.querySelector(".event-done-btn");
    const openLink  = card.querySelector(".event-open-link");
    if (!Array.isArray(event.items)) event.items = []; // eventos criados antes dessa versão não têm items
    renderTagPicker(card.querySelector(".tag-picker"), event);

    function refreshPreview() {
        const occ = EventUtils.getNextOccurrence(event);
        const badge = occurrenceBadge(occ);
        const timeLabel = event.startTime
            ? ` · ${event.startTime}${event.endTime ? "–" + event.endTime : ""}`
            : "";
        const checklistLabel = event.items.length
            ? ` · ${event.items.filter(i => i.done).length}/${event.items.length} tarefas`
            : "";
        preview.innerHTML =
            `<span class="event-badge ${badge.cls}">${badge.text}</span>${RECURRENCE_LABELS[event.recurrence] || ""}${timeLabel}${checklistLabel}`;

        const isDone = !occ;
        doneBtn.innerHTML = isDone
            ? `${Icons.svg("rotate-ccw", 13)} Desfazer`
            : `${Icons.svg("check", 13)} Marcar como feito`;
        doneBtn.classList.toggle("is-done", isDone);
        doneBtn.dataset.occ = occ || "";
    }
    refreshPreview();

    // Checklist do evento — mesmo componente e mesmo Enter-continua-a-lista
    // dos itens de Listas (list.items/insertItemAfter genéricos o bastante
    // pra tratar o próprio evento como se fosse a "lista").
    function insertEventItemAfter(afterId) {
        const idx = event.items.findIndex(i => i.id === afterId);
        const newItem = { id: newId(), text: "", done: false };
        event.items.splice(idx === -1 ? event.items.length : idx + 1, 0, newItem);
        event.updatedAt = now();
        refreshPreview();
        scheduleSave();

        const afterLi = checklistEl.querySelector(`.list-item[data-id="${afterId}"]`);
        const newLi = listItemNode(event, newItem, refreshPreview, insertEventItemAfter);
        if (afterLi && afterLi.nextSibling) checklistEl.insertBefore(newLi, afterLi.nextSibling);
        else checklistEl.appendChild(newLi);
        newLi.querySelector(".item-text").focus();
    }

    const checklistEl = card.querySelector(".item-list");
    event.items.forEach(item => checklistEl.appendChild(listItemNode(event, item, refreshPreview, insertEventItemAfter)));

    const eventItemAdd = card.querySelector(".item-add");
    eventItemAdd.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.stopPropagation();
        const text = eventItemAdd.value.trim();
        if (!text) return;
        const item = { id: newId(), text, done: false };
        event.items.push(item);
        event.updatedAt = now();
        checklistEl.appendChild(listItemNode(event, item, refreshPreview, insertEventItemAfter));
        refreshPreview();
        eventItemAdd.value = "";
        scheduleSave();
    });

    const title = card.querySelector(".card-title");

    // Evento não põe foco em campo nenhum ao expandir (diferente de nota e
    // lista) — os campos ficam todos visíveis, não faz sentido roubar o foco.
    function expandEvent() {
        card.classList.add("expanded");
        expanded.add(event.id);
    }

    function collapseEvent() {
        if (!card.classList.contains("expanded")) return;
        card.classList.remove("expanded");
        expanded.delete(event.id);
        // Evento recém-criado nasce com o título já em edição (ver
        // createEvent) -- fechar o card antes de confirmar o nome (Enter/
        // clicar fora) commita direto em vez de confiar no blur, que só
        // dispara se o título REALMENTE tinha foco (ver commitTitle acima).
        if (title.isContentEditable) commitTitle();
    }

    const cardHeader = attachHeaderToggle(card, title, expandEvent, collapseEvent);

    function commitTitle() {
        title.contentEditable = "false";
        event.title = title.textContent.trim() || "Sem título";
        title.textContent = event.title;
        event.updatedAt = now();
        scheduleSave();
    }

    title.addEventListener("blur", commitTitle);
    const dateEl       = card.querySelector(".ev-date");
    const recurrenceEl = card.querySelector(".ev-recurrence");
    const startEl      = card.querySelector(".ev-start");
    const endEl        = card.querySelector(".ev-end");
    const linkEl       = card.querySelector(".ev-link");

    // Enter avança pro próximo campo (título→data→recorrência→início→fim→
    // link); no último campo, finaliza (tira o foco).
    const fieldOrder = [title, dateEl, recurrenceEl, startEl, endEl, linkEl];

    // O título só é focável de verdade quando contentEditable="true" (span
    // comum não recebe foco por padrão) — fora do duplo clique, isso só
    // acontece aqui, ao entrar nele via Enter/Tab. Reaproveita o mesmo
    // caminho do duplo clique (ver attachHeaderToggle) pra não duplicar a
    // entrada em modo de edição.
    function focusField(field) {
        if (field === title) {
            cardHeader.beginTitleEdit();
        } else {
            field.focus();
            if (typeof field.select === "function") field.select();
        }
    }

    function focusNextField(current) {
        const idx = fieldOrder.indexOf(current);
        const next = idx === -1 ? null : fieldOrder[idx + 1];
        if (!next) { current.blur(); return; }
        focusField(next);
    }

    title.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        focusNextField(title);
    });

    [dateEl, recurrenceEl, startEl, endEl, linkEl].forEach(field => {
        field.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            e.stopPropagation();
            focusNextField(field);
        });
    });

    // Tab no último campo volta pro primeiro (e Shift+Tab no primeiro volta
    // pro último) — sem isso o Tab sai dos campos do card e o foco "some"
    // (não tem pra onde ir depois do link, já que a janela não tem mais
    // nada focável abaixo).
    fieldOrder.forEach((field, idx) => {
        field.addEventListener("keydown", (e) => {
            if (e.key !== "Tab") return;
            if (!e.shiftKey && idx === fieldOrder.length - 1) {
                e.preventDefault();
                focusField(fieldOrder[0]);
            } else if (e.shiftKey && idx === 0) {
                e.preventDefault();
                focusField(fieldOrder[fieldOrder.length - 1]);
            }
        });
    });

    dateEl.addEventListener("change", (e) => {
        event.date = e.target.value || EventUtils.todayISO();
        e.target.value = event.date;
        event.updatedAt = now();
        refreshPreview();
        scheduleSave();
    });

    recurrenceEl.addEventListener("change", (e) => {
        event.recurrence = e.target.value;
        event.updatedAt = now();
        refreshPreview();
        scheduleSave();
    });

    startEl.addEventListener("change", (e) => {
        event.startTime = e.target.value || null;
        event.updatedAt = now();
        refreshPreview();
        scheduleSave();
    });

    endEl.addEventListener("change", (e) => {
        event.endTime = e.target.value || null;
        event.updatedAt = now();
        refreshPreview();
        scheduleSave();
    });

    linkEl.addEventListener("blur", (e) => {
        event.link = e.target.value.trim() || null;
        openLink.disabled = !event.link;
        event.updatedAt = now();
        scheduleSave();
    });

    openLink.addEventListener("click", (e) => {
        e.stopPropagation();
        if (event.link) window.api.send("open-link", event.link);
    });

    doneBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const occ = doneBtn.dataset.occ;
        if (occ) {
            if (!event.completedDates.includes(occ)) event.completedDates.push(occ);
            // Concluir um evento inteiro alimenta mais que um item de
            // checklist (ver BICHINHO VIRTUAL) -- só ao marcar, não ao desfazer.
            tamaOnTaskCompleted(15, 8);
        } else {
            // já concluído (evento único) — desfaz a última ocorrência confirmada
            event.completedDates = event.completedDates.filter(d => d !== event.date);
        }
        event.updatedAt = now();
        scheduleSave();
        renderBoard();
    });

    card.querySelector(".card-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        armDeleteConfirm(e.currentTarget, () => {
            data.events = data.events.filter(ev => ev.id !== event.id);
            expanded.delete(event.id);
            scheduleSave();
            card.remove();
            if (data.events.length === 0) renderBoard();
        });
    });

    return card;
}

/* ═══════════════════════════════  RENDER  ════════════════════════════════ */

const EMPTY_MESSAGES = {
    notas: "Nenhuma nota ainda. Crie a primeira acima.",
    listas: "Nenhuma lista ainda. Crie a primeira acima.",
    eventos: "Nenhum evento ainda. Crie o primeiro acima."
};

function renderBoard() {
    board.innerHTML = "";
    let items;
    if (activeTab === "notas") items = data.notes;
    else if (activeTab === "listas") items = data.lists;
    else items = [...data.events].sort(EventUtils.compareByOccurrence);

    if (searchQuery) {
        items = items.filter(item => normalizeSearch(item.title).includes(searchQuery));
    }

    if (items.length === 0) {
        const msg = document.createElement("div");
        msg.className = "empty-msg";
        msg.textContent = searchQuery ? "Nenhum card encontrado." : (EMPTY_MESSAGES[activeTab] || EMPTY_MESSAGES.notas);
        board.appendChild(msg);
        return;
    }

    const frag = document.createDocumentFragment();
    items.forEach(item => {
        let node;
        if (activeTab === "notas") node = noteCardNode(item);
        else if (activeTab === "listas") node = listCardNode(item);
        else node = eventCardNode(item);
        frag.appendChild(node);
    });
    board.appendChild(frag);
}

/* ══════════════════════════════  DOCK / PAINEL  ═══════════════════════════ */

const dragbarIcon = document.getElementById("dragbar-icon");

function setContainerMode(collapsed) {
    // "Abrir o app" (sair da bandeja) é uma das formas de recuperar carência
    // -- só conta na transição de verdade bandeja->expandido, não toda vez
    // que essa função roda (ex.: reaplicar o mesmo modo no boot).
    const wasCollapsed = container.classList.contains("collapsed");
    if (wasCollapsed && !collapsed) {
        data.tamagotchi.carencia = tamaClamp(data.tamagotchi.carencia + 3);
        tamaRegisterInteraction();
        scheduleTamaSave();
    }
    container.classList.toggle("collapsed", collapsed);
    container.classList.toggle("expanded", !collapsed);
    dragbarIcon.innerHTML = Icons.svg(collapsed ? "chevron-up" : "chevron-down", 13);
}

// Bandeja: clicar na barra de título expande. Expandido: clicar recolhe de volta.
document.getElementById("dragbar").addEventListener("click", () => {
    window.api.send(container.classList.contains("collapsed") ? "expand-widget" : "collapse-widget");
});

document.getElementById("minbtn").addEventListener("click", (e) => {
    e.stopPropagation();
    window.api.send("collapse-widget");
});
document.getElementById("closebtn").addEventListener("click", (e) => {
    e.stopPropagation();
    window.api.send("close-widget");
});
document.getElementById("settingsbtn").addEventListener("click", (e) => {
    e.stopPropagation();
    window.api.send("open-settings");
});

window.api.on("set-mode", (mode) => setContainerMode(mode === "collapsed"));

/* ══════════════════════════════  NAVEGAÇÃO POR TECLADO  ══════════════════ */
// Só ativa com o painel expandido. Setas/Enter ficam de fora enquanto o
// foco está num campo editável (input/textarea/select/contenteditable),
// senão atropelariam mover o cursor de texto ou quebrar linha. Esc é a
// exceção — funciona mesmo editando, igual clicar no "✕".

let selectedIndex = -1; // -1 = nada selecionado; 0 = botão "+ Novo..."; 1+ = cartões

function isEditingContext() {
    const el = document.activeElement;
    if (!el) return false;
    const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
    if (!isField) return false;
    // Um campo que ficou com foco "fantasma" dentro de um card recolhido
    // (display:none) não deve travar a navegação por teclado — offsetParent
    // é null pra qualquer elemento que não está sendo renderizado.
    return el.offsetParent !== null;
}

function getNavItems() {
    return [newBtn, ...board.querySelectorAll(".card")];
}

function clearKeyboardSelection() {
    document.querySelectorAll(".kb-selected").forEach(el => el.classList.remove("kb-selected"));
}

function applyKeyboardSelection() {
    clearKeyboardSelection();
    const items = getNavItems();
    if (items.length === 0) { selectedIndex = -1; return; }
    selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex));
    const el = items[selectedIndex];
    el.classList.add("kb-selected");
    el.scrollIntoView({ block: "nearest" });
}

function moveSelection(delta) {
    const items = getNavItems();
    if (items.length === 0) return;
    selectedIndex = selectedIndex === -1 ? 0 : Math.max(0, Math.min(items.length - 1, selectedIndex + delta));
    applyKeyboardSelection();
}

function openSelected() {
    const items = getNavItems();
    if (selectedIndex < 0 || selectedIndex >= items.length) return;
    const el = items[selectedIndex];
    if (el === newBtn) { newBtn.click(); return; }
    (el.querySelector(".card-header") || el).click();
}

// Delete no card selecionado usa o mesmo botão "✕" (e a mesma confirmação
// em dois toques) que o clique do mouse já usa — primeiro Delete arma,
// segundo confirma.
function deleteSelected() {
    const items = getNavItems();
    if (selectedIndex < 0 || selectedIndex >= items.length) return;
    const el = items[selectedIndex];
    if (el === newBtn) return;
    el.querySelector(".card-delete")?.click();
}

function cycleTab(delta) {
    const tabs = Array.from(tabButtons);
    const currentIndex = tabs.findIndex(btn => btn.dataset.tab === activeTab);
    const nextIndex = (currentIndex + delta + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIndex].dataset.tab);
    selectedIndex = -1;
    clearKeyboardSelection();
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        e.preventDefault();
        // Busca ou painel do cronômetro aberto -> Escape só fecha ele, não o
        // widget inteiro (mesmo padrão de Escape em campos de busca por aí).
        if (isSearchOpen()) { closeSearch(); return; }
        if (isTimerOpen()) { closeTimerPanel(); return; }
        if (isTamaOpen()) { closeTama(); return; }
        window.api.send("close-widget");
        return;
    }

    if (container.classList.contains("collapsed")) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
        return;
    }

    if (isEditingContext()) return;

    switch (e.key) {
        case "ArrowLeft":  e.preventDefault(); cycleTab(-1); break;
        case "ArrowRight": e.preventDefault(); cycleTab(1); break;
        case "ArrowUp":    e.preventDefault(); moveSelection(-1); break;
        case "ArrowDown":  e.preventDefault(); moveSelection(1); break;
        case "Enter":      e.preventDefault(); openSelected(); break;
        case "Delete":     e.preventDefault(); deleteSelected(); break;
    }
});

/* ══════════════════════════════  TEMA / TRANSPARÊNCIA  ═══════════════════ */

function applySettings(settings) {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme || "gold";
    const alpha = Math.min(100, Math.max(20, settings.transparency ?? 60)) / 100;
    document.documentElement.style.setProperty("--bg-alpha", alpha);
}

window.api.on("apply-settings", applySettings);

// Tags foram criadas/renomeadas/removidas em Configurações enquanto o
// widget está aberto — atualiza a lista local e redesenha (pills e o
// seletor dependem de data.tags).
window.api.on("tags-updated", (tags) => {
    applyRemoteUpdate(() => { data.tags = tags; });
});

/* ══════════════════════════  ARQUIVO SOLTO VIRA NOTA  ═════════════════════ */

const panel = document.getElementById("panel");
const TEXT_FILE_RE = /\.(txt|md|markdown|csv|json|log|ini|cfg|conf|yaml|yml|xml|js|ts|py|java|c|cpp|h|css|html)$/i;
const MAX_TEXT_READ_BYTES = 2_000_000;

let dragEnterDepth = 0;

function hasFiles(e) {
    return Array.from(e.dataTransfer?.types || []).includes("Files");
}

panel.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    dragEnterDepth++;
    container.classList.add("file-drop-active");
});
panel.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
});
// Só conta saída de arraste de ARQUIVO: arrastar um card ou item de lista
// dentro do painel também dispara dragleave, e sem essa checagem o contador
// da moldura de "solte aqui" mexeria por causa de um gesto que não tem nada
// a ver com arquivo.
panel.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragEnterDepth = Math.max(0, dragEnterDepth - 1);
    if (dragEnterDepth === 0) container.classList.remove("file-drop-active");
});

panel.addEventListener("drop", async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragEnterDepth = 0;
    container.classList.remove("file-drop-active");

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
        const looksLikeText = file.type.startsWith("text/") || file.type === "application/json" || TEXT_FILE_RE.test(file.name);
        let content;
        if (looksLikeText && file.size <= MAX_TEXT_READ_BYTES) {
            try { content = await file.text(); } catch { content = ""; }
        } else {
            const filePath = window.api.getFilePath(file);
            content = `Arquivo: ${filePath || file.name}`;
        }
        const title = (file.name.replace(/\.[^.]+$/, "") || file.name).slice(0, 60);
        data.notes.unshift({ id: newId(), title, content, createdAt: now(), updatedAt: now() });
    }

    setActiveTab("notas");
    scheduleSave();
});

/* ══════════════════════════════  TRAY: CRIAÇÃO RÁPIDA  ═══════════════════ */

function runQuickCreate(type) {
    if (type === "lista") { setActiveTab("listas"); createList(); }
    else if (type === "evento") { setActiveTab("eventos"); createEvent(); }
    else { setActiveTab("notas"); createNote(); }
}

// Criar antes do boot terminar montaria o item sobre os arrays vazios e ele
// sumiria quando o get-data chegasse -- guarda e executa depois.
let pendingQuickCreate = null;

window.api.on("quick-create", (type) => {
    if (!booted) { pendingQuickCreate = type; return; }
    runQuickCreate(type);
});

/* ═══════════  ATUALIZAÇÕES DO MAIN SEM ATROPELAR A EDIÇÃO  ════════════════ */
// Redesenhar o board no meio de uma digitação destrói o campo em foco e
// perde o que ainda não foi salvo (o save daqui tem 400 ms de atraso).
// Enquanto houver edição em andamento dentro do board, a atualização espera
// e é aplicada assim que o foco sair.

let pendingRemoteUpdates = [];

function isEditingInBoard() {
    return board.contains(document.activeElement) && isEditingContext();
}

function applyRemoteUpdate(fn) {
    if (isEditingInBoard()) { pendingRemoteUpdates.push(fn); return; }
    fn();
    renderBoard();
}

function flushRemoteUpdates() {
    if (pendingRemoteUpdates.length === 0 || isEditingInBoard()) return;
    const updates = pendingRemoteUpdates;
    pendingRemoteUpdates = [];
    updates.forEach(fn => fn());
    renderBoard();
}

document.addEventListener("focusout", () => setTimeout(flushRemoteUpdates, 0));

// Captura rápida cria a nota direto no main (não tem acesso ao estado do
// widget). Só ACRESCENTA o que ainda não existe aqui em vez de substituir a
// lista: a cópia do main pode estar até ~900 ms atrás (400 de atraso no save
// daqui + 500 no dele) e desfaria a edição em andamento.
window.api.on("notes-updated", (notes) => {
    const known = new Set(data.notes.map(n => n.id));
    const added = notes.filter(n => !known.has(n.id));
    if (added.length === 0) return;
    applyRemoteUpdate(() => { data.notes = [...added, ...data.notes]; });
});

// Sincronização com o Google Agenda alterou os eventos (criou, atualizou ou
// removeu um evento cancelado do lado de lá) — ver Main.js. Mescla por id: o
// que foi editado aqui mais recentemente (updatedAt mais novo) permanece,
// pelo mesmo motivo do notes-updated acima.
function mergeEventsFromMain(incoming) {
    const localById = new Map(data.events.map(e => [e.id, e]));
    data.events = incoming.map(inc => {
        const local = localById.get(inc.id);
        return local && (local.updatedAt || 0) > (inc.updatedAt || 0) ? local : inc;
    });
}

window.api.on("events-updated", (events) => {
    applyRemoteUpdate(() => mergeEventsFromMain(events));
});

/* ═══════════════════════════════  BOOT  ══════════════════════════════════ */

const VALID_TABS = new Set(["notas", "listas", "eventos"]);

window.api.invoke("get-data").then(loaded => {
    data = {
        notes: [], lists: [], events: [], tags: [],
        tamagotchi: {
        level: 1, xp: 0, vida: 100, fome: 100, carencia: 100, higiene: 100,
        lastUpdate: Date.now(), lastInteraction: Date.now(), lastCarenciaUpdate: Date.now()
    },
        ...loaded
    };
    booted = true;
    applySettings(data.settings);
    setContainerMode(data.widget?.collapsed !== false);
    const savedTab = data.widget?.activeTab;
    setActiveTab(VALID_TABS.has(savedTab) ? savedTab : "notas");
    applyTamaDecay();
    updateTamaUI();
    scheduleTamaSave();

    if (pendingQuickCreate) {
        const type = pendingQuickCreate;
        pendingQuickCreate = null;
        runQuickCreate(type);
    }
});
