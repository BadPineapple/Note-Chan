// src/js/Paths.js
// ATENÇÃO: este módulo NÃO deve importar Logger ou DataManager.
// Eles dependem dele — importar algo daqui pra lá cria ciclo.
const path = require("path");
const fs   = require("fs");

const APP_FOLDER = "NoteChan";

if (process.type !== "browser") {
    throw new Error("[PATHS] Módulo exclusivo do processo principal.");
}

const { app } = require("electron");

// setName ANTES de qualquer getPath(): o Electron cacheia o diretório.
app.setName(APP_FOLDER);

const userData = app.getPath("userData");

function ensureDirs() {
    [userData, path.join(userData, "logs"), path.join(userData, "backups")].forEach(dir => {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            console.error("[PATHS] Falha ao criar diretório:", dir, e.message);
        }
    });
}

const PATHS = {
    userData,
    data:       path.join(userData, "data.json"),
    logsDir:    path.join(userData, "logs"),
    logFile:    path.join(userData, "logs", "runtime.log"),
    backupsDir: path.join(userData, "backups"),
    ensureDirs
};

ensureDirs();

console.log("[PATHS] userData:", userData);

module.exports = PATHS;
