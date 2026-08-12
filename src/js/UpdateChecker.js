/* ────────────────────────────  UpdateChecker.js  ──────────────────────────
   Verificação de versão contra os releases do GitHub. Só CONSULTA e avisa --
   não baixa nem instala nada sozinho (decisão explícita: ver README). Por
   isso não usa electron-updater; é só um GET na API pública com o fetch
   nativo do Node/Electron, e o app continua sem nenhuma dependência de
   runtime.

   Falha de rede aqui nunca é erro do app: sem internet, atrás de proxy ou
   com o repositório ainda sem release publicado, a resposta é "não deu pra
   verificar" e a vida segue.
*/
const { app } = require("electron");
const { log, warn } = require("./Logger");

const REPO = "BadPineapple/Note-Chan";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const REQUEST_TIMEOUT_MS = 10000;

/* ══════════════════════════  COMPARAÇÃO DE VERSÃO  ═══════════════════════ */

// "v1.3.0" / "1.3" / "1.3.0-beta.2" -> [1, 3, 0]. Descarta o "v" que o
// GitHub costuma pôr na tag e o sufixo de pré-lançamento (tratado à parte
// em isNewer). null quando não parece uma versão.
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
    // Núcleo igual: pré-lançamento vale MENOS que a versão final, então
    // 1.3.0-beta não é atualização pra quem já está na 1.3.0 -- mas 1.3.0 é
    // atualização pra quem está na 1.3.0-beta.
    if (isPreRelease(remote) && !isPreRelease(local)) return false;
    if (!isPreRelease(remote) && isPreRelease(local)) return true;
    return false;
}

/* ═══════════════════════════════  CONSULTA  ══════════════════════════════ */

async function fetchLatestRelease() {
    const res = await fetch(RELEASES_API, {
        headers: {
            Accept: "application/vnd.github+json",
            // A API do GitHub rejeita requisição sem User-Agent.
            "User-Agent": `Note-Chan/${app.getVersion()}`
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    // 404 = repositório ainda sem nenhum release publicado. É um estado
    // normal (o primeiro lançamento ainda não saiu), não uma falha.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);

    const json = await res.json();
    const version = String(json.tag_name || json.name || "").trim();
    if (!version) return null;
    return { version, url: json.html_url || RELEASES_PAGE, publishedAt: json.published_at || null };
}

// { ok, updateAvailable, current, latest?, url?, publishedAt?, error? }
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
