/* ────────────────────────────────  Widget.js  ───────────────────────────── */
// Renderer do widget. Roda em sandbox (sem Node) — toda comunicação com o
// processo principal passa por window.api (ver preload.js).

let data = { notes: [], lists: [], events: [], tags: [], widget: { collapsed: true, activeTab: "notas" } };
let activeTab = "notas";
const expanded = new Set();

const container   = document.getElementById("container");
const board       = document.getElementById("board");
const newBtn      = document.getElementById("new-btn");
const tabButtons  = document.querySelectorAll(".tab-btn");
const searchBtn   = document.getElementById("searchbtn");
const searchBar   = document.getElementById("search-bar");
const searchInput = document.getElementById("search-input");

/* ══════════════════════════════  PERSISTÊNCIA  ══════════════════════════ */

let saveTimer = null;
function scheduleSave() {
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

function newId() {
    return crypto.randomUUID();
}

function now() {
    return Date.now();
}

function formatDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

// window.confirm() é um diálogo NATIVO e bloqueante — nesta janela
// (alwaysOnTop no nível "screen-saver", o mais alto do Windows) ele abre
// escondido atrás do próprio widget, mas ainda assim trava a thread de JS
// esperando resposta. Resultado: tudo parece travado até o usuário mexer
// em outra janela por acaso. Por isso exclusão é confirmada com dois
// cliques no próprio botão, sem diálogo nenhum.
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
        btn.textContent = "✕";
    }, 2500);
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

function renderTagPicker(container, item) {
    container.innerHTML = "";
    if (data.tags.length === 0) {
        container.innerHTML = `<span class="tag-picker-hint">Crie tags em Configurações → Tags</span>`;
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
            renderTagPicker(container, item);
            refreshCardTagsHeader(container.closest(".card"), item);
        });
        container.appendChild(btn);
    });
}

const RECURRENCE_LABELS = {
    none: "Não se repete",
    daily: "🔁 Diário",
    weekly: "🔁 Semanal",
    monthly: "🔁 Mensal",
    yearly: "🔁 Anual"
};

function formatBR(iso) {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
}

// { text, cls } prontos pra virar um .event-badge
function occurrenceBadge(occDate) {
    if (!occDate) return { text: "✓ Concluído", cls: "done" };
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

/* ═══════════════════════════════  NOTAS  ═════════════════════════════════ */

function noteCardNode(note) {
    const card = document.createElement("div");
    card.className = "card" + (expanded.has(note.id) ? " expanded" : "");
    card.dataset.id = note.id;

    card.innerHTML = `
        <div class="card-delete" draggable="false" title="Excluir nota">✕</div>
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

    function collapseNote() {
        if (!card.classList.contains("expanded")) return;
        card.classList.remove("expanded");
        expanded.delete(note.id);
        // nota nunca editada (título e conteúdo ainda no padrão) — some
        // sozinha em vez de acumular cards vazios.
        if (note.title === "Nova nota" && !note.content.trim()) {
            data.notes = data.notes.filter(n => n.id !== note.id);
            card.remove();
            scheduleSave();
            if (data.notes.length === 0) renderBoard();
        }
    }

    card.querySelector(".card-header").addEventListener("click", (e) => {
        // 2º clique de um duplo-clique no título (que edita o título, ver
        // abaixo) não deve alternar expandido/recolhido de novo -- senão o
        // 1º clique fecha, o 2º reabre, e o dblclick some no meio do caminho.
        if (e.detail > 1) return;
        if (card.classList.contains("expanded")) {
            collapseNote();
        } else {
            card.classList.add("expanded");
            expanded.add(note.id);
            card.querySelector(".note-editor")?.focus();
        }
    });

    // Sai o foco de todos os campos do card (clicou fora, deu Tab pra fora,
    // etc.) -> recolhe sozinho. O setTimeout espera o próximo tick porque
    // focusout dispara ANTES do novo elemento realmente ganhar o foco —
    // checar document.activeElement direto seria sempre o elemento antigo.
    card.addEventListener("focusout", () => {
        setTimeout(() => {
            if (card.contains(document.activeElement)) return;
            collapseNote();
        }, 0);
    });

    const title = card.querySelector(".card-title");
    title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        title.contentEditable = "true";
        title.focus();
        document.execCommand("selectAll", false, null);
    });
    title.addEventListener("click", (e) => { if (title.isContentEditable) e.stopPropagation(); });
    title.addEventListener("blur", () => {
        title.contentEditable = "false";
        note.title = title.textContent.trim() || "Sem título";
        title.textContent = note.title;
        note.updatedAt = now();
        scheduleSave();
    });
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
        <div class="item-delete" draggable="false" title="Excluir item">✕</div>
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

        const container = li.parentElement;
        container.innerHTML = "";
        list.items.forEach(it => container.appendChild(listItemNode(list, it, refreshPreview, insertItemAfter)));
    });

    li.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
        item.done = e.target.checked;
        li.classList.toggle("done", item.done);
        list.updatedAt = now();
        refreshPreview();
        scheduleSave();
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
        <div class="card-delete" draggable="false" title="Excluir lista">✕</div>
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

    function collapseList() {
        if (!card.classList.contains("expanded")) return;
        card.classList.remove("expanded");
        expanded.delete(list.id);
        // lista nunca editada (título padrão e sem itens) — some sozinha.
        if (list.title === "Nova lista" && list.items.length === 0) {
            data.lists = data.lists.filter(l => l.id !== list.id);
            card.remove();
            scheduleSave();
            if (data.lists.length === 0) renderBoard();
        }
    }

    card.querySelector(".card-header").addEventListener("click", (e) => {
        if (e.detail > 1) return;
        if (card.classList.contains("expanded")) {
            collapseList();
        } else {
            card.classList.add("expanded");
            expanded.add(list.id);
            card.querySelector(".item-add")?.focus();
        }
    });

    card.addEventListener("focusout", () => {
        setTimeout(() => {
            if (card.contains(document.activeElement)) return;
            collapseList();
        }, 0);
    });

    const title = card.querySelector(".card-title");
    title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        title.contentEditable = "true";
        title.focus();
        document.execCommand("selectAll", false, null);
    });
    title.addEventListener("click", (e) => { if (title.isContentEditable) e.stopPropagation(); });
    title.addEventListener("blur", () => {
        title.contentEditable = "false";
        list.title = title.textContent.trim() || "Sem título";
        title.textContent = list.title;
        list.updatedAt = now();
        scheduleSave();
    });
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
        <div class="card-delete" title="Excluir evento">✕</div>
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
                    <button class="event-open-link" title="Abrir link" ${event.link ? "" : "disabled"}>🔗 Abrir</button>
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
        doneBtn.textContent = isDone ? "↺ Desfazer" : "✓ Marcar como feito";
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

    function collapseEvent() {
        if (!card.classList.contains("expanded")) return;
        card.classList.remove("expanded");
        expanded.delete(event.id);
    }

    card.querySelector(".card-header").addEventListener("click", (e) => {
        if (e.detail > 1) return;
        if (card.classList.contains("expanded")) collapseEvent();
        else { card.classList.add("expanded"); expanded.add(event.id); }
    });

    card.addEventListener("focusout", () => {
        setTimeout(() => {
            if (card.contains(document.activeElement)) return;
            collapseEvent();
        }, 0);
    });

    const title = card.querySelector(".card-title");
    title.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        title.contentEditable = "true";
        title.focus();
        document.execCommand("selectAll", false, null);
    });
    title.addEventListener("click", (e) => { if (title.isContentEditable) e.stopPropagation(); });
    title.addEventListener("blur", () => {
        title.contentEditable = "false";
        event.title = title.textContent.trim() || "Sem título";
        title.textContent = event.title;
        event.updatedAt = now();
        scheduleSave();
    });
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
    // acontece aqui, ao entrar nele via Enter/Tab.
    function focusField(field) {
        if (field === title) {
            title.contentEditable = "true";
            title.focus();
            document.execCommand("selectAll", false, null);
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
    container.classList.toggle("collapsed", collapsed);
    container.classList.toggle("expanded", !collapsed);
    dragbarIcon.textContent = collapsed ? "⌃" : "⌄";
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
        // Busca aberta -> Escape só fecha ela, não o widget inteiro (mesmo
        // padrão de Escape em campos de busca por aí).
        if (isSearchOpen()) { closeSearch(); return; }
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
    data.tags = tags;
    renderBoard();
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
panel.addEventListener("dragleave", () => {
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
            content = `📎 Arquivo: ${filePath || file.name}`;
        }
        const title = (file.name.replace(/\.[^.]+$/, "") || file.name).slice(0, 60);
        data.notes.unshift({ id: newId(), title, content, createdAt: now(), updatedAt: now() });
    }

    setActiveTab("notas");
    scheduleSave();
});

/* ══════════════════════════════  TRAY: CRIAÇÃO RÁPIDA  ═══════════════════ */

window.api.on("quick-create", (type) => {
    if (type === "lista") { setActiveTab("listas"); createList(); }
    else if (type === "evento") { setActiveTab("eventos"); createEvent(); }
    else { setActiveTab("notas"); createNote(); }
});

window.api.on("focus-tab", (tab) => setActiveTab(tab));

// Captura rápida cria a nota direto no main (não tem acesso ao estado do
// widget) — quando o widget está aberto, sincroniza a lista local com a
// que o main já persistiu, sem precisar de outro round-trip get-data.
window.api.on("notes-updated", (notes) => {
    data.notes = notes;
    if (activeTab === "notas") renderBoard();
});

/* ═══════════════════════════════  BOOT  ══════════════════════════════════ */

const VALID_TABS = new Set(["notas", "listas", "eventos"]);

window.api.invoke("get-data").then(loaded => {
    data = { notes: [], lists: [], events: [], tags: [], ...loaded };
    applySettings(data.settings);
    setContainerMode(data.widget?.collapsed !== false);
    const savedTab = data.widget?.activeTab;
    setActiveTab(VALID_TABS.has(savedTab) ? savedTab : "notas");
});
