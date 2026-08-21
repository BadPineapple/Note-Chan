// src/js/preload.js
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Eventos que o main pode enviar ao renderer
const RECEIVE = new Set([
    "quick-create", "set-mode", "apply-settings", "notes-updated", "reset", "tags-updated",
    "alarm-ring", "open-tama", "events-updated", "birthdays-updated", "note-updated"
]);

// Mensagens fire-and-forget do renderer para o main
const SEND = new Set([
    "quit-app", "close-widget", "collapse-widget", "expand-widget", "save-data", "open-link",
    "save-settings", "open-settings", "close-settings",
    "quick-capture-submit", "quick-capture-cancel",
    "alarm-stop", "alarm-snooze",
    "open-note-window", "note-save", "note-close", "note-minimize",
    "log-entry"
]);

// Rotas com resposta
const INVOKE = new Set([
    "get-data", "get-app-version", "note-data", "check-update",
    "google-auth-status", "google-auth-start", "google-disconnect", "google-sync-now"
]);

contextBridge.exposeInMainWorld("api", {
    send: (channel, payload) => {
        if (!SEND.has(channel)) throw new Error(`Canal bloqueado: ${channel}`);
        ipcRenderer.send(channel, payload);
    },

    invoke: (channel, payload) => {
        if (!INVOKE.has(channel)) throw new Error(`Canal bloqueado: ${channel}`);
        return ipcRenderer.invoke(channel, payload);
    },

    on: (channel, callback) => {
        if (!RECEIVE.has(channel)) throw new Error(`Canal bloqueado: ${channel}`);
        // Descarta o objeto `event` — expor sender/ports ao renderer anula o isolamento
        const wrapped = (_event, ...args) => callback(...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
    },

    // Electron 32+ removeu File.path; esta é a substituição oficial — usada
    // pelo drag-and-drop de arquivo pra virar nota (arquivos não-texto).
    getFilePath: (file) => {
        try { return webUtils.getPathForFile(file); }
        catch { return null; }
    }
});
