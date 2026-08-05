/* ─────────────────────────────  GoogleCalendarSync.js  ────────────────────
   Sincronização de mão dupla com o Google Agenda (calendário PRINCIPAL do
   usuário, por escolha dele -- ver conversa). Regras combinadas:
     - Eventos/aniversários criados pelo Note-Chan são marcados com uma tag
       invisível (extendedProperties.private) pra saber quais são "nossos"
       sem mexer nos outros compromissos da agenda.
     - Recorrência (diário/semanal/mensal/anual) vira RRULE de verdade no
       Google; "concluído" (completedDates) é conceito que só existe aqui,
       nunca é mandado pro Google.
     - Em divergência, o Google sempre vence (sobrescreve o lado local).
     - Exclusão no Note-Chan não apaga na hora -- entra numa fila
       (data.googleSync.pendingDeletes, alimentada em Main.js no diff do
       save-data) processada no início da próxima sincronização.
     - Aniversário só sincroniza NO SENTIDO Note-Chan -> Google de forma
       confiável. Evento anual recorrente criado direto no Google não vira
       aniversariante aqui (arriscado demais adivinhar) -- entra como
       evento comum.
*/
const crypto = require("crypto");
const GoogleAuth = require("./GoogleAuth");
const EventUtils = require("./EventUtils");
const { warn } = require("./Logger");

const CALENDAR_ID = "primary";
const API_BASE = "https://www.googleapis.com/calendar/v3";
const SYNC_PAST_DAYS = 30;
const SYNC_FUTURE_DAYS = 365;

function localTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

async function apiFetch(pathAndQuery, options = {}) {
    const token = await GoogleAuth.getValidAccessToken();
    return fetch(`${API_BASE}${pathAndQuery}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
}

/* ═══════════════════════  MAPEAMENTO DE RECORRÊNCIA  ══════════════════════ */

const RECURRENCE_TO_FREQ = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };
const FREQ_TO_RECURRENCE = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };

function extractFreq(recurrenceArr) {
    if (!Array.isArray(recurrenceArr)) return null;
    for (const rule of recurrenceArr) {
        const m = /FREQ=([A-Z]+)/.exec(rule);
        if (m) return m[1];
    }
    return null;
}

function addHour(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const total = (h * 60 + m + 60) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* ═════════════════════  NOTE-CHAN  ->  GOOGLE (payload)  ══════════════════ */

function eventToGooglePayload(evt) {
    const timeZone = localTimeZone();
    const body = {
        summary: evt.title || "(sem título)",
        extendedProperties: { private: { noteChanId: evt.id } }
    };
    if (evt.link) body.description = evt.link;

    if (evt.startTime) {
        body.start = { dateTime: `${evt.date}T${evt.startTime}:00`, timeZone };
        body.end = { dateTime: `${evt.date}T${evt.endTime || addHour(evt.startTime)}:00`, timeZone };
    } else {
        body.start = { date: evt.date };
        body.end = { date: EventUtils.addInterval(evt.date, "daily") };
    }

    if (evt.recurrence && RECURRENCE_TO_FREQ[evt.recurrence]) {
        body.recurrence = [`RRULE:FREQ=${RECURRENCE_TO_FREQ[evt.recurrence]}`];
    }
    return body;
}

function birthdayToGooglePayload(b) {
    const [, mm, dd] = b.date.split("-");
    const y = b.date.split("-")[0];
    const start = `${y}-${mm}-${dd}`;
    return {
        summary: `Aniversário de ${b.name}`,
        start: { date: start },
        end: { date: EventUtils.addInterval(start, "daily") },
        recurrence: ["RRULE:FREQ=YEARLY"],
        extendedProperties: { private: { noteChanBirthdayId: b.id } }
    };
}

/* ═════════════════════  GOOGLE  ->  NOTE-CHAN (campos)  ═══════════════════ */

function googleToEventFields(gEvt) {
    const isAllDay = !!gEvt.start?.date;
    const date = isAllDay ? gEvt.start.date : gEvt.start.dateTime.slice(0, 10);
    const startTime = isAllDay ? null : gEvt.start.dateTime.slice(11, 16);
    const endTime = isAllDay || !gEvt.end?.dateTime ? null : gEvt.end.dateTime.slice(11, 16);
    const freq = extractFreq(gEvt.recurrence);
    const recurrence = (freq && FREQ_TO_RECURRENCE[freq]) || "none";
    const desc = (gEvt.description || "").trim();
    return {
        title: gEvt.summary || "(sem título)",
        date,
        startTime,
        endTime,
        recurrence,
        link: /^https?:\/\//i.test(desc) ? desc : null
    };
}

/* ═══════════════════════════════  SYNC  ════════════════════════════════ */

async function processPendingDeletes(data) {
    const ids = data.googleSync.pendingDeletes.splice(0, data.googleSync.pendingDeletes.length);
    for (const id of ids) {
        try {
            const res = await apiFetch(`/calendars/${CALENDAR_ID}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (!res.ok && res.status !== 404 && res.status !== 410) {
                warn("[GOOGLE] Falha ao excluir evento remoto", id, res.status);
            }
        } catch (e) {
            warn("[GOOGLE] Erro ao excluir evento remoto", id, e.message);
        }
    }
}

async function listGoogleEvents(data) {
    const baseParams = { singleEvents: "false", maxResults: "2500", showDeleted: "true" };
    let usingSyncToken = !!data.googleSync.syncToken;

    async function fetchAll(params) {
        let items = [];
        let pageToken = null;
        let nextSyncToken = null;
        do {
            const query = new URLSearchParams(params);
            if (pageToken) query.set("pageToken", pageToken);
            const res = await apiFetch(`/calendars/${CALENDAR_ID}/events?${query.toString()}`);
            if (res.status === 410) {
                const err = new Error("SYNC_TOKEN_INVALID");
                err.code = "SYNC_TOKEN_INVALID";
                throw err;
            }
            if (!res.ok) throw new Error(`Falha ao listar eventos do Google (${res.status}): ${await res.text()}`);
            const json = await res.json();
            items = items.concat(json.items || []);
            pageToken = json.nextPageToken || null;
            nextSyncToken = json.nextSyncToken || nextSyncToken;
        } while (pageToken);
        return { items, nextSyncToken };
    }

    if (usingSyncToken) {
        try {
            return await fetchAll({ ...baseParams, syncToken: data.googleSync.syncToken });
        } catch (e) {
            if (e.code !== "SYNC_TOKEN_INVALID") throw e;
            data.googleSync.syncToken = null; // cai pro fetch completo abaixo
        }
    }

    const now = Date.now();
    const timeMin = new Date(now - SYNC_PAST_DAYS * 86400000).toISOString();
    const timeMax = new Date(now + SYNC_FUTURE_DAYS * 86400000).toISOString();
    return fetchAll({ ...baseParams, timeMin, timeMax });
}

function applyGoogleEventsToLocal(data, googleItems) {
    for (const gEvt of googleItems) {
        const noteChanId = gEvt.extendedProperties?.private?.noteChanId;
        const birthdayId = gEvt.extendedProperties?.private?.noteChanBirthdayId;

        if (birthdayId) {
            const local = data.birthdays.find(b => b.id === birthdayId);
            if (!local) continue; // excluído localmente -- pendingDeletes já cuidou do lado do Google
            if (gEvt.status === "cancelled") {
                data.birthdays = data.birthdays.filter(b => b.id !== birthdayId);
            } else {
                local.googleEventId = gEvt.id;
            }
            continue;
        }

        if (noteChanId) {
            const local = data.events.find(e => e.id === noteChanId);
            if (!local) continue;
            if (gEvt.status === "cancelled") {
                data.events = data.events.filter(e => e.id !== noteChanId);
            } else {
                Object.assign(local, googleToEventFields(gEvt));
                local.googleEventId = gEvt.id;
                local.updatedAt = Date.now();
            }
            continue;
        }

        // Evento "estrangeiro" (criado direto no Google, sem nossa tag).
        const existing = data.events.find(e => e.googleEventId === gEvt.id);
        if (gEvt.status === "cancelled") {
            if (existing) data.events = data.events.filter(e => e.id !== existing.id);
            continue;
        }
        if (existing) {
            Object.assign(existing, googleToEventFields(gEvt));
            existing.updatedAt = Date.now();
        } else {
            const fields = googleToEventFields(gEvt);
            data.events.push({
                id: crypto.randomUUID(),
                ...fields,
                completedDates: [],
                items: [],
                googleEventId: gEvt.id,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }
    }
}

async function pushNewLocalItems(data) {
    for (const evt of data.events) {
        if (evt.googleEventId) continue;
        try {
            const res = await apiFetch(`/calendars/${CALENDAR_ID}/events`, {
                method: "POST",
                body: JSON.stringify(eventToGooglePayload(evt))
            });
            if (!res.ok) { warn("[GOOGLE] Falha ao criar evento", evt.title, res.status); continue; }
            evt.googleEventId = (await res.json()).id;
        } catch (e) {
            warn("[GOOGLE] Erro ao criar evento", evt.title, e.message);
        }
    }

    for (const b of data.birthdays) {
        if (b.googleEventId) continue;
        try {
            const res = await apiFetch(`/calendars/${CALENDAR_ID}/events`, {
                method: "POST",
                body: JSON.stringify(birthdayToGooglePayload(b))
            });
            if (!res.ok) { warn("[GOOGLE] Falha ao criar aniversário", b.name, res.status); continue; }
            b.googleEventId = (await res.json()).id;
        } catch (e) {
            warn("[GOOGLE] Erro ao criar aniversário", b.name, e.message);
        }
    }
}

async function runSync(data) {
    if (!GoogleAuth.isConnected()) return { ok: false, error: "not-connected" };
    data.googleSync = data.googleSync || { syncToken: null, lastSyncAt: null, pendingDeletes: [] };

    try {
        await processPendingDeletes(data);
        const { items, nextSyncToken } = await listGoogleEvents(data);
        applyGoogleEventsToLocal(data, items);
        await pushNewLocalItems(data);

        if (nextSyncToken) data.googleSync.syncToken = nextSyncToken;
        data.googleSync.lastSyncAt = Date.now();
        return { ok: true, count: items.length };
    } catch (e) {
        warn("[GOOGLE] Falha na sincronização:", e.message);
        return { ok: false, error: e.message };
    }
}

module.exports = { runSync };
