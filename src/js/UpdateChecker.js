/* ────────────────────────────  UpdateChecker.js  ────────────────────────── */
const { app } = require("electron");
const { log, warn } = require("./Logger");

const REPO = "BadPineapple/Note-Chan";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const REQUEST_TIMEOUT_MS = 10000;

/* ══════════════════════════  COMPARAÇÃO DE VERSÃO  ═══════════════════════ */
function parseVersion(value) {
    const core = String(value || "").trim().replace(/^v/i, "").split(/[-+]/)[0];
    if (!core) return null;
    const parts = core.split(".").map(n => parseInt(n, 10));
    if (parts.length === 0 || parts.some(n => Number.isNaN(n))) return null;
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
}

function isPreRelease(value) {
    return String(value || "").trim().replace(/^v/i, "").includes("-");
}

function isNewer(remote, local) {
    const a = parseVersion(remote);
    const b = parseVersion(local);
    if (!a || !b) return false;

    for (let i = 0; i < 3; i++) {
        if (a[i] > b[i]) return true;
        if (a[i] < b[i]) return false;
    }
    if (isPreRelease(remote) && !isPreRelease(local)) return false;
    if (!isPreRelease(remote) && isPreRelease(local)) return true;
    return false;
}

/* ═══════════════════════════════  CONSULTA  ══════════════════════════════ */

async function fetchLatestRelease() {
    const res = await fetch(RELEASES_API, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `Note-Chan/${app.getVersion()}`
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);

    const json = await res.json();
    const version = String(json.tag_name || json.name || "").trim();
    if (!version) return null;
    return { version, url: json.html_url || RELEASES_PAGE, publishedAt: json.published_at || null };
}

async function check() {
    const current = app.getVersion();
    try {
        const latest = await fetchLatestRelease();
        if (!latest) {
            log("[UPDATE] Nenhum release publicado ainda — nada a comparar.");
            return { ok: true, updateAvailable: false, current, noReleases: true };
        }

        const updateAvailable = isNewer(latest.version, current);
        log("[UPDATE] Instalada:", current, "| última publicada:", latest.version,
            "|", updateAvailable ? "há atualização" : "já está em dia");

        return {
            ok: true,
            updateAvailable,
            current,
            latest: latest.version,
            url: latest.url,
            publishedAt: latest.publishedAt
        };
    } catch (e) {
        warn("[UPDATE] Não foi possível verificar atualização:", e.message);
        return { ok: false, updateAvailable: false, current, error: e.message };
    }
}

module.exports = { check, isNewer, parseVersion, RELEASES_PAGE };
