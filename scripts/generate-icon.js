// Script utilitário de build (não faz parte do app) — renderiza
// scripts/icon-source.html num BrowserWindow e salva o PNG resultante em
// assets/img/icon.png. Rodar com: npx electron scripts/generate-icon.js
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const SIZE = 1024;
const OUTPUT = path.join(__dirname, "..", "assets", "img", "icon.png");

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: SIZE,
        height: SIZE,
        show: false,
        useContentSize: true,
        webPreferences: { offscreen: false }
    });

    win.webContents.setZoomFactor(1);
    await win.loadFile(path.join(__dirname, "icon-source.html"));
    await new Promise(r => setTimeout(r, 100));

    const image = await win.webContents.capturePage();
    const resized = image.resize({ width: SIZE, height: SIZE, quality: "best" });
    fs.writeFileSync(OUTPUT, resized.toPNG());
    console.log("Ícone salvo em", OUTPUT, "-", resized.getSize());

    app.quit();
});
