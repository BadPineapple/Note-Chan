/* ─────────────────────────────  TamaSprite.js  ───────────────────────────
   Desenho do bichinho virtual (grid de pixels -> SVG por fórmula, sem
   imagem nenhuma). Compartilhado entre o widget (painel do bichinho) e o
   popup de alarme (pra "ser o próprio bichinho" avisando também) — mesmo
   padrão UMD do EventUtils.js/TagUtils.js.
*/
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.TamaSprite = factory();
    }
})(function () {
    const GRID = 16;
    const NEGLECT_THRESHOLD = 25;

    const PALETTE = {
        B: "rgb(var(--accent-rgb, 255 215 0))",
        O: "rgb(0 0 0 / 0.4)",
        P: "rgb(30 20 0 / 0.85)",
        K: "rgb(255 130 160 / 0.55)",
        M: "rgb(30 20 0 / 0.7)",
        X: "rgb(30 20 0 / 0.7)",
        G: "rgb(90 190 120 / 0.85)"
    };

    // Corpo redondo por equação de elipse -- garante simetria sem desenhar
    // pixel a pixel na mão.
    function baseGrid() {
        const cx = 7.5, cy = 7.5, rx = 6.6, ry = 6.3;
        const grid = [];
        for (let y = 0; y < GRID; y++) {
            const row = [];
            for (let x = 0; x < GRID; x++) {
                const dx = (x - cx) / rx, dy = (y - cy) / ry;
                const d = dx * dx + dy * dy;
                row.push(d <= 0.78 ? "B" : d <= 1.0 ? "O" : ".");
            }
            grid.push(row);
        }
        return grid;
    }

    function faceGrid(mood) {
        const g = baseGrid();
        const eyeY = 6, lx = 5, rx = 10;
        if (mood === "triste") {
            g[eyeY - 1][lx] = "P"; g[eyeY][lx + 1] = "P";
            g[eyeY - 1][rx + 1] = "P"; g[eyeY][rx] = "P";
        } else if (mood === "sujo") {
            g[eyeY][lx] = "X"; g[eyeY][rx + 1] = "X";
        } else {
            g[eyeY][lx] = "P"; g[eyeY][lx + 1] = "P";
            g[eyeY][rx] = "P"; g[eyeY][rx + 1] = "P";
        }
        g[8][3] = "K"; g[8][12] = "K";
        if (mood === "feliz") {
            g[9][6] = "M"; g[10][7] = "M"; g[10][8] = "M"; g[9][9] = "M";
        } else if (mood === "triste") {
            g[10][6] = "M"; g[9][7] = "M"; g[9][8] = "M"; g[10][9] = "M";
        } else {
            g[9][6] = "M"; g[9][7] = "M"; g[9][8] = "M"; g[9][9] = "M";
            if (mood === "sujo") g[8][8] = "G";
        }
        return g;
    }

    function svg(mood) {
        const grid = faceGrid(mood);
        let rects = "";
        for (let y = 0; y < GRID; y++) {
            for (let x = 0; x < GRID; x++) {
                const c = grid[y][x];
                if (c === ".") continue;
                rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[c]}"/>`;
            }
        }
        return `<svg viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges">${rects}</svg>`;
    }

    function mood(tama) {
        if (!tama) return "feliz";
        if (tama.higiene < NEGLECT_THRESHOLD) return "sujo";
        const avg = (tama.fome + tama.carencia + tama.higiene) / 3;
        if (avg < 30) return "triste";
        if (avg < 65) return "neutro";
        return "feliz";
    }

    function clamp(v) {
        return Math.max(0, Math.min(100, v));
    }

    return { GRID, NEGLECT_THRESHOLD, baseGrid, faceGrid, svg, mood, clamp };
});
