/* ─────────────────────────────  GoogleCalendarSync.js  ──────────────────── */
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

function eventPatchPayload(evt) {
    const full = eventToGooglePayload(evt);
    if (evt.foreign === false) return full;
    return { summary: full.summary, start: full.start, end: full.end };
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

function localDateAndTime(isoWithOffset) {
    const dt = new Date(isoWithOffset);
    if (Number.isNaN(dt.getTime())) return { date: null, time: null };
    const p = n => String(n).padStart(2, "0");
    return {
        date: `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`,
        time: `${p(dt.getHours())}:${p(dt.getMinutes())}`
    };
}

function googleToEventFields(gEvt) {
    const isAllDay = !!gEvt.start?.date;
    if (!isAllDay && !gEvt.start?.dateTime) return null;

    const start = isAllDay ? { date: gEvt.start.date, time: null } : localDateAndTime(gEvt.start.dateTime);
    if (!start.date) return null;

    const date = start.date;
    const startTime = start.time;
    const endTime = isAllDay || !gEvt.end?.dateTime ? null : localDateAndTime(gEvt.end.dateTime).time;
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
    const ids = [...data.googleSync.pendingDeletes];
    if (ids.length === 0) return;

    const done = new Set();
    for (const id of ids) {
        try {
            const res = await apiFetch(`/calendars/${CALENDAR_ID}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (res.ok || res.status === 404 || res.status === 410) done.add(id);
            else warn("[GOOGLE] Falha ao excluir evento remoto (fica na fila)", id, res.status);
        } catch (e) {
            warn("[GOOGLE] Erro ao excluir evento remoto (fica na fila)", id, e.message);
        }
    }
    data.googleSync.pendingDeletes = data.googleSync.pendingDeletes.filter(id => !done.has(id));
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
            data.googleSync.syncToken = null; 
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
            if (!local) continue; 
            if (gEvt.status === "cancelled") {
                data.birthdays = data.birthdays.filter(b => b.id !== birthdayId);
            } else {
                local.googleEventId = gEvt.id;
                local.googleSyncedAt = Date.now();
            }
            continue;
        }

        if (noteChanId) {
            const local = data.events.find(e => e.id === noteChanId);
            if (!local) continue;
            if (gEvt.status === "cancelled") {
                data.events = data.events.filter(e => e.id !== noteChanId);
            } else {
                const fields = googleToEventFields(gEvt);
                if (!fields) { warn("[GOOGLE] Evento sem início utilizável, ignorado:", gEvt.id); continue; }
                Object.assign(local, fields);
                local.googleEventId = gEvt.id;
                local.foreign = false; 
                local.updatedAt = Date.now();
                local.googleSyncedAt = local.updatedAt;
            }
            continue;
        }

        // Evento "estrangeiro" (criado direto no Google, sem nossa tag).
        const existing = data.events.find(e => e.googleEventId === gEvt.id);
        if (gEvt.status === "cancelled") {
            if (existing) data.events = data.events.filter(e => e.id !== existing.id);
            continue;
        }
        const fields = googleToEventFields(gEvt);
        if (!fields) { warn("[GOOGLE] Evento sem início utilizável, ignorado:", gEvt.id); continue; }
        if (existing) {
            Object.assign(existing, fields);
            existing.updatedAt = Date.now();
            existing.googleSyncedAt = existing.updatedAt;
            existing.foreign = true;
        } else {
            const stamp = Date.now();
            data.events.push({
                id: crypto.randomUUID(),
                ...fields,
                completedDates: [],
                items: [],
                googleEventId: gEvt.id,
                foreign: true,
                createdAt: stamp,
                updatedAt: stamp,
                googleSyncedAt: stamp
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
            evt.googleSyncedAt = Date.now();
            evt.foreign = false; 
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
            b.googleSyncedAt = Date.now();
        } catch (e) {
            warn("[GOOGLE] Erro ao criar aniversário", b.name, e.message);
        }
    }
}

async function patchItem(googleEventId, payload, label) {
    const res = await apiFetch(`/calendars/${CALENDAR_ID}/events/${encodeURIComponent(googleEventId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
    });
    if (res.ok) return true;
    if (res.status === 404 || res.status === 410) return null;
    warn("[GOOGLE] Falha ao atualizar", label, res.status);
    return false;
}

function adoptLegacyItems(data) {
    const stamp = Date.now();
    for (const item of [...data.events, ...data.birthdays]) {
        if (item.googleEventId && item.googleSyncedAt === undefined) {
            item.googleSyncedAt = Math.max(item.updatedAt || 0, stamp);
        }
    }
}

async function pushLocalChanges(data) {
    const changed = item => item.googleEventId && (item.updatedAt || 0) > (item.googleSyncedAt || 0);

    for (const evt of data.events.filter(changed)) {
        try {
            const result = await patchItem(evt.googleEventId, eventPatchPayload(evt), evt.title);
            if (result === null) { evt.googleEventId = null; evt.googleSyncedAt = 0; }
            else if (result) evt.googleSyncedAt = Date.now();
        } catch (e) {
            warn("[GOOGLE] Erro ao atualizar evento", evt.title, e.message);
        }
    }

    for (const b of data.birthdays.filter(changed)) {
        try {
            const result = await patchItem(b.googleEventId, birthdayToGooglePayload(b), b.name);
            if (result === null) { b.googleEventId = null; b.googleSyncedAt = 0; }
            else if (result) b.googleSyncedAt = Date.now();
        } catch (e) {
            warn("[GOOGLE] Erro ao atualizar aniversário", b.name, e.message);
        }
    }
}

async function runSync(data) {
    if (!GoogleAuth.isConnected()) return { ok: false, error: "not-connected" };
    data.googleSync = data.googleSync || { syncToken: null, lastSyncAt: null, pendingDeletes: [] };

    try {
        adoptLegacyItems(data);
        await processPendingDeletes(data);
        await pushLocalChanges(data);   // sobe edições ANTES de ler (ver pushLocalChanges)
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
