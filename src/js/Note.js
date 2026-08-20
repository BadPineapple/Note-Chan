/* ─────────────────────────────────  Note.js  ──────────────────────────────
   Renderer da nota em janela própria ("modo bloco de notas"). Qual nota esta
   janela edita vem na query da URL (ver openNoteWindow em Main.js) -- o
   renderer roda em sandbox e não tem como descobrir isso sozinho.

   O dono do conteúdo aqui é esta janela enquanto ela está em uso: ela grava
   com atraso curto e o main repassa pro widget. No sentido contrário, uma
   edição feita no widget só é aplicada aqui se ninguém estiver digitando
   (ver "note-updated" no fim do arquivo).
*/

const noteId = new URLSearchParams(location.search).get("id");

const dragbarTitle = document.getElementById("note-dragbar-title");
const titleEl      = document.getElementById("note-title");
const contentEl    = document.getElementById("note-content");
const countsEl     = document.getElementById("note-counts");
const savedEl      = document.getElementById("note-saved");

const SAVE_DELAY_MS = 400;

let saveTimer = null;
let loaded = false;

/* ══════════════════════════════  APRESENTAÇÃO  ═══════════════════════════ */

// Guardado porque o editor lê a configuração ao vivo (indentação e atalhos
// de formatação), e ela pode mudar depois que esta janela já abriu.
let settingsAtuais = null;

function applySettings(settings) {
    if (!settings) return;
    settingsAtuais = settings;
    RichEditor.aplicarFonte(settings.editor?.fontSize);
    document.documentElement.dataset.theme = settings.theme || "gold";
}

function refreshCounts() {
    // Contagem sobre o texto legível: com marcação no meio, "<b>oi</b>"
    // contaria 11 caracteres em vez de 2.
    const text = RichText.toPlainText(contentEl.innerHTML);
    const palavras = text.trim() ? text.trim().split(/\s+/).length : 0;
    const linhas = text ? text.split("\n").length : 0;
    countsEl.textContent = `${palavras} ${palavras === 1 ? "palavra" : "palavras"}`
        + ` · ${text.length} ${text.length === 1 ? "caractere" : "caracteres"}`
        + ` · ${linhas} ${linhas === 1 ? "linha" : "linhas"}`;
}

function refreshTitleBar() {
    const nome = titleEl.value.trim() || "Sem título";
    dragbarTitle.textContent = nome;
    document.title = `${nome} — Note-Chan`;
}

function marcarSalvo(quando = Date.now()) {
    const hora = new Date(quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    savedEl.textContent = `Salvo às ${hora}`;
}

/* ═══════════════════════════════  GRAVAÇÃO  ══════════════════════════════ */

function scheduleSave() {
    if (!loaded) return;
    savedEl.textContent = "Salvando...";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!loaded) return;
    window.api.send("note-save", {
        id: noteId,
        title: titleEl.value,
        content: contentEl.innerHTML
    });
    marcarSalvo();
}

RichEditor.ligarSetas(titleEl);

titleEl.addEventListener("input", () => {
    refreshTitleBar();
    scheduleSave();
});

const editor = RichEditor.attach(contentEl, {
    onChange: () => {
        refreshCounts();
        scheduleSave();
    },
    indentSize: () => settingsAtuais?.editor?.indentSize,
    atalhos: () => settingsAtuais?.editorShortcuts
});

// Barra cheia: aqui cabem alinhamento, bloco de código e tamanho de fonte,
// que no card do widget não teriam espaço nem sentido (ver BARRA_COMPLETA).
RichEditor.montarBarra(document.getElementById("note-toolbar"), editor, RichEditor.BARRA_COMPLETA, {
    tamanhoIcone: 15,
    atalhos: () => settingsAtuais?.editorShortcuts
});

// Enter no título desce pro corpo, em vez de não fazer nada.
titleEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    contentEl.focus();
});

/* ═══════════════════════════════  JANELA  ════════════════════════════════ */

function fechar() {
    saveNow(); // não espera o atraso do debounce -- a janela vai sumir
    window.api.send("note-close");
}

document.getElementById("note-minbtn").addEventListener("click", () => window.api.send("note-minimize"));
document.getElementById("note-closebtn").addEventListener("click", fechar);

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); fechar(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") { e.preventDefault(); fechar(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); }
});

// Fechar pelo X da barra de tarefas / Alt+F4 não passa pelo botão daqui.
window.addEventListener("beforeunload", () => { if (saveTimer) saveNow(); });

/* ═════════════════════════════  SINCRONIZAÇÃO  ═══════════════════════════ */

function applyNote(note) {
    titleEl.value = note.title || "";
    contentEl.innerHTML = RichText.sanitize(note.content || "");
    editor.marcarVazio();
    refreshTitleBar();
    refreshCounts();
}

window.api.on("apply-settings", applySettings);

// A mesma nota foi editada no widget. Só aplica se ninguém estiver mexendo
// aqui: sobrescrever o campo no meio de uma frase perderia o que está sendo
// digitado, e esta janela é a que tem a versão mais nova nesse caso.
window.api.on("note-updated", (note) => {
    if (!note || note.id !== noteId) return;
    if (saveTimer || document.hasFocus()) return;
    applyNote(note);
});

window.api.invoke("get-data").then(dados => applySettings(dados.settings));

window.api.invoke("note-data", noteId).then(note => {
    if (!note) {
        // Nota apagada entre o pedido de abrir e o carregamento da janela.
        window.api.send("note-close");
        return;
    }
    applyNote(note);
    loaded = true;
    marcarSalvo(note.updatedAt);
    contentEl.focus();
});
