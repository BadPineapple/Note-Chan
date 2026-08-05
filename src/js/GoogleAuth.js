/* ─────────────────────────────  GoogleAuth.js  ───────────────────────────
   Login OAuth com o Google (fluxo padrão de "app instalado" com PKCE):
   abre o navegador do sistema, sobe um servidorzinho HTTP local só pra
   capturar o "code" do redirect, troca por tokens. O refresh_token fica
   salvo criptografado (safeStorage) em vez de texto puro -- é a credencial
   de longa duração, o access_token (1h) nunca é persistido, só fica em
   memória e é renovado sob demanda.
*/
const { shell, safeStorage } = require("electron");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PATHS = require("./Paths");
const { log, warn } = require("./Logger");

let config = null;
try {
    config = require("./GoogleAuthConfig");
} catch {
    // GoogleAuthConfig.js não existe (gitignored, precisa ser criado a
    // partir do .example.js) -- funcionalidade fica desabilitada, não é erro.
}

const TOKEN_PATH = path.join(PATHS.userData, "google-auth.enc");
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

let refreshToken = null;
let accessToken = null;
let accessTokenExpiry = 0;
let userEmail = null;

function base64url(buf) {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isConfigured() {
    return !!config;
}

function isConnected() {
    return !!refreshToken;
}

function getEmail() {
    return userEmail;
}

function loadStoredToken() {
    try {
        if (!fs.existsSync(TOKEN_PATH)) return;
        const raw = fs.readFileSync(TOKEN_PATH);
        const decrypted = safeStorage.isEncryptionAvailable()
            ? safeStorage.decryptString(raw)
            : raw.toString("utf8");
        const parsed = JSON.parse(decrypted);
        refreshToken = parsed.refreshToken || null;
        userEmail = parsed.email || null;
        if (refreshToken) log("[GOOGLE] Sessão restaurada:", userEmail || "(sem e-mail salvo)");
    } catch (e) {
        warn("[GOOGLE] Falha ao carregar sessão salva:", e.message);
    }
}

function persistToken() {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            warn("[GOOGLE] Criptografia do SO indisponível -- token salvo sem criptografia adicional.");
        }
        const payload = JSON.stringify({ refreshToken, email: userEmail });
        const out = safeStorage.isEncryptionAvailable()
            ? safeStorage.encryptString(payload)
            : Buffer.from(payload, "utf8");
        fs.writeFileSync(TOKEN_PATH, out);
    } catch (e) {
        warn("[GOOGLE] Falha ao salvar sessão:", e.message);
    }
}

function clearToken() {
    refreshToken = null;
    accessToken = null;
    accessTokenExpiry = 0;
    userEmail = null;
    try { if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH); } catch (e) { warn("[GOOGLE] Falha ao remover token salvo:", e.message); }
}

function callbackPageHtml(error) {
    const msg = error
        ? "Algo deu errado na autorização. Pode fechar esta aba e tentar de novo no Note-Chan."
        : "Pronto! Pode fechar esta aba e voltar pro Note-Chan.";
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Note-Chan</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#1e1e1e;color:#ffd700;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px;
font-size:1.1em}</style></head><body><div>${msg}</div></body></html>`;
}

async function exchangeCode(code, codeVerifier, redirectUri) {
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: config.CLIENT_ID,
            client_secret: config.CLIENT_SECRET,
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
            grant_type: "authorization_code"
        })
    });
    if (!res.ok) throw new Error(`Falha ao trocar código por token (${res.status}): ${await res.text()}`);
    return res.json();
}

async function fetchUserEmail(token) {
    try {
        const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return null;
        const info = await res.json();
        return info.email || null;
    } catch {
        return null;
    }
}

// Sobe o servidor local, abre o navegador, espera o redirect com o "code" e
// troca por tokens. Resolve com { email } ou rejeita com uma mensagem legível.
function startOAuthFlow() {
    return new Promise((resolve, reject) => {
        if (!config) { reject(new Error("Google não configurado (GoogleAuthConfig.js ausente).")); return; }

        const codeVerifier = base64url(crypto.randomBytes(32));
        const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
        const state = base64url(crypto.randomBytes(16));

        let settled = false;
        const timeoutHandle = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { server.close(); } catch (e) { /* já fechado */ }
            reject(new Error("Tempo esgotado esperando a autorização no navegador."));
        }, OAUTH_TIMEOUT_MS);

        const server = http.createServer((req, res) => {
            (async () => {
                const url = new URL(req.url, "http://127.0.0.1");
                if (url.pathname !== "/") { res.writeHead(404); res.end(); return; }

                const returnedState = url.searchParams.get("state");
                const code = url.searchParams.get("code");
                const error = url.searchParams.get("error");

                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(callbackPageHtml(error));
                server.close();

                if (settled) return;

                if (error) { settled = true; clearTimeout(timeoutHandle); reject(new Error(`Google negou a autorização: ${error}`)); return; }
                if (returnedState !== state || !code) { settled = true; clearTimeout(timeoutHandle); reject(new Error("Resposta OAuth inválida (state não confere).")); return; }

                try {
                    const port = server.address().port;
                    const redirectUri = `http://127.0.0.1:${port}`;
                    const tokens = await exchangeCode(code, codeVerifier, redirectUri);
                    refreshToken = tokens.refresh_token || refreshToken;
                    accessToken = tokens.access_token;
                    accessTokenExpiry = Date.now() + tokens.expires_in * 1000;
                    userEmail = await fetchUserEmail(accessToken);
                    persistToken();
                    settled = true;
                    clearTimeout(timeoutHandle);
                    log("[GOOGLE] Conectado:", userEmail || "(e-mail não obtido)");
                    resolve({ email: userEmail });
                } catch (e) {
                    settled = true;
                    clearTimeout(timeoutHandle);
                    reject(e);
                }
            })();
        });

        server.on("error", (e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutHandle);
            reject(e);
        });

        server.listen(0, "127.0.0.1", () => {
            const port = server.address().port;
            const redirectUri = `http://127.0.0.1:${port}`;
            const params = new URLSearchParams({
                client_id: config.CLIENT_ID,
                redirect_uri: redirectUri,
                response_type: "code",
                scope: SCOPES,
                access_type: "offline",
                prompt: "consent",
                code_challenge: codeChallenge,
                code_challenge_method: "S256",
                state
            });
            shell.openExternal(`${AUTH_URL}?${params.toString()}`);
        });
    });
}

async function refreshAccessToken() {
    if (!refreshToken) throw new Error("Não conectado ao Google.");
    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: config.CLIENT_ID,
            client_secret: config.CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: "refresh_token"
        })
    });
    if (!res.ok) {
        const text = await res.text();
        if (res.status === 400 || res.status === 401) {
            // refresh_token revogado/inválido (ex.: usuário removeu o acesso
            // pela conta Google) -- não adianta insistir, desconecta de vez.
            warn("[GOOGLE] Token de renovação inválido, desconectando:", text);
            clearToken();
        }
        throw new Error(`Falha ao renovar token (${res.status}): ${text}`);
    }
    const tokens = await res.json();
    accessToken = tokens.access_token;
    accessTokenExpiry = Date.now() + tokens.expires_in * 1000;
    return accessToken;
}

async function getValidAccessToken() {
    if (!refreshToken) throw new Error("Não conectado ao Google.");
    if (accessToken && Date.now() < accessTokenExpiry - 60000) return accessToken;
    return refreshAccessToken();
}

async function disconnect() {
    const tokenToRevoke = refreshToken || accessToken;
    clearToken();
    if (tokenToRevoke) {
        try {
            await fetch(`${REVOKE_URL}?token=${encodeURIComponent(tokenToRevoke)}`, { method: "POST" });
        } catch (e) {
            warn("[GOOGLE] Falha ao revogar token no Google (ignorado):", e.message);
        }
    }
    log("[GOOGLE] Desconectado.");
}

module.exports = {
    isConfigured, isConnected, getEmail, startOAuthFlow, disconnect, getValidAccessToken,
    // safeStorage só pode ser usado depois de app.whenReady() -- Main.js chama
    // isto explicitamente no boot, em vez de carregar direto ao importar o módulo.
    loadStoredToken
};
