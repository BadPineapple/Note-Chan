// Script utilitário de build (não faz parte do app) — renderiza as artes do
// instalador NSIS num BrowserWindow e salva os BMPs em build/.
// Rodar com: npx electron scripts/generate-installer-art.js
//
// O NSIS só aceita BMP nessas duas imagens (nada de PNG), e não existe
// conversor no projeto — nem faria sentido puxar uma dependência só pra
// isso. BMP de 24 bits sem compressão é um cabeçalho de 54 bytes seguido
// dos pixels crus, então o encoder abaixo dá conta em poucas linhas.
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

// A captura de tela fora do compositor de GPU falha de forma intermitente
// (UnknownVizError) em janela invisível; renderizar por software é lento e
// irrelevante aqui, e sai sempre igual.
app.disableHardwareAcceleration();

const BUILD_DIR = path.join(__dirname, "..", "build");

// width/height são as medidas que o NSIS espera; sair delas faz a imagem ser
// esticada ou cortada. A renderização é feita em ESCALA (zoom) e reduzida
// depois: além de sair mais nítida, uma janela de 150x57 esbarra no tamanho
// mínimo de janela do Windows e a carga falha com ERR_FAILED.
const ESCALA = 2;

const ARTES = [
    { origem: "installer-sidebar.html", saidas: ["installerSidebar.bmp", "uninstallerSidebar.bmp"], width: 164, height: 314 },
    { origem: "installer-header.html", saidas: ["installerHeader.bmp"], width: 150, height: 57 }
];

// nativeImage.toBitmap() devolve BGRA, linhas de cima pra baixo. O BMP quer
// BGR (sem alfa), linhas de baixo pra cima e cada linha completada com zeros
// até um múltiplo de 4 bytes.
function toBmp24(image) {
    const { width, height } = image.getSize();
    const bgra = image.toBitmap();
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const pixelsSize = rowSize * height;
    const buf = Buffer.alloc(54 + pixelsSize);

    buf.write("BM", 0, "ascii");
    buf.writeUInt32LE(buf.length, 2);
    buf.writeUInt32LE(54, 10);          // onde começam os pixels
    buf.writeUInt32LE(40, 14);          // tamanho do BITMAPINFOHEADER
    buf.writeInt32LE(width, 18);
    buf.writeInt32LE(height, 22);
    buf.writeUInt16LE(1, 26);           // planos de cor
    buf.writeUInt16LE(24, 28);          // bits por pixel
    buf.writeUInt32LE(pixelsSize, 34);
    buf.writeInt32LE(2835, 38);         // ~72 dpi, em pixels por metro
    buf.writeInt32LE(2835, 42);

    for (let y = 0; y < height; y++) {
        const origem = (height - 1 - y) * width * 4;
        let destino = 54 + y * rowSize;
        for (let x = 0; x < width; x++) {
            buf[destino++] = bgra[origem + x * 4];     // B
            buf[destino++] = bgra[origem + x * 4 + 1]; // G
            buf[destino++] = bgra[origem + x * 4 + 2]; // R
        }
    }
    return buf;
}

// Fechar a janela de uma arte antes de abrir a próxima dispara
// window-all-closed, e o Electron começa a encerrar o app por conta própria
// -- a carga seguinte então falha com ERR_FAILED. Este handler vazio segura o
// encerramento até o app.quit() explícito no fim.
app.on("window-all-closed", () => { /* intencionalmente vazio */ });

app.whenReady().then(async () => {
    fs.mkdirSync(BUILD_DIR, { recursive: true });

    for (const arte of ARTES) {
        const win = new BrowserWindow({
            width: arte.width * ESCALA,
            height: arte.height * ESCALA,
            show: false,
            useContentSize: true,
            webPreferences: { offscreen: false }
        });

        await win.loadFile(path.join(__dirname, arte.origem));
        win.webContents.setZoomFactor(ESCALA);
        await new Promise(r => setTimeout(r, 200)); // deixa fonte e zoom assentarem

        let image = await win.webContents.capturePage();
        const capturada = image.getSize();
        if (capturada.width !== arte.width || capturada.height !== arte.height) {
            // Reduz da escala de renderização (e de telas em 125%/150%) pra
            // medida exata que o NSIS espera.
            image = image.resize({ width: arte.width, height: arte.height, quality: "best" });
        }

        const bmp = toBmp24(image);
        for (const saida of arte.saidas) {
            const destino = path.join(BUILD_DIR, saida);
            fs.writeFileSync(destino, bmp);
            console.log("Arte salva:", destino, `- ${arte.width}x${arte.height}, ${bmp.length} bytes`);
        }
        win.destroy();
    }

    app.quit();
});
