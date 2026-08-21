/* ──────────────────────────────  EventUtils.js  ─────────────────────────── */
(function (factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        window.EventUtils = factory();
    }
})(function () {
    function pad(n) { return String(n).padStart(2, "0"); }

    function toISODate(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function todayISO() {
        return toISODate(new Date());
    }

    function addInterval(dateStr, recurrence) {
        const [y, m, d] = dateStr.split("-").map(Number);
        const dt = new Date(y, m - 1, d);

        if (recurrence === "daily") { dt.setDate(dt.getDate() + 1); return toISODate(dt); }
        if (recurrence === "weekly") { dt.setDate(dt.getDate() + 7); return toISODate(dt); }

        if (recurrence === "monthly") {
            dt.setDate(1);
            dt.setMonth(dt.getMonth() + 1);
        } else if (recurrence === "yearly") {
            dt.setDate(1);
            dt.setFullYear(dt.getFullYear() + 1);
        } else {
            return null;
        }

        const daysInTargetMonth = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
        dt.setDate(Math.min(d, daysInTargetMonth));
        return toISODate(dt);
    }

    function daysBetween(fromISO, toISO) {
        const [fy, fm, fd] = fromISO.split("-").map(Number);
        const [ty, tm, td] = toISO.split("-").map(Number);
        return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
    }

    function addDays(dateStr, days) {
        const [y, m, d] = dateStr.split("-").map(Number);
        return toISODate(new Date(y, m - 1, d + days));
    }

    function fastForwardToToday(occ, recurrence, today) {
        const behind = daysBetween(occ, today);
        if (behind <= 0) return occ;
        if (recurrence === "daily" || recurrence === "weekly") {
            const step = recurrence === "daily" ? 1 : 7;
            return addDays(occ, Math.ceil(behind / step) * step);
        }
        let guard = 0;
        while (occ && occ < today && guard++ < 2000) occ = addInterval(occ, recurrence);
        return occ;
    }

    function getNextOccurrence(event, today = todayISO()) {
        const completed = event.completedDates || [];
        if (!event.recurrence || event.recurrence === "none") {
            return completed.includes(event.date) ? null : event.date;
        }
        let occ = fastForwardToToday(event.date, event.recurrence, today);
        let guard = 0;
        while (occ && completed.includes(occ) && guard++ < 2000) {
            occ = addInterval(occ, event.recurrence);
        }
        return occ;
    }

    function occurrenceDateTime(occDate, startTime) {
        if (!occDate) return null;
        const [y, m, d] = occDate.split("-").map(Number);
        if (startTime) {
            const [hh, mm] = startTime.split(":").map(Number);
            return new Date(y, m - 1, d, hh, mm, 0, 0);
        }
        return new Date(y, m - 1, d, 0, 0, 0, 0);
    }

    function compareByOccurrence(a, b) {
        const occA = getNextOccurrence(a);
        const occB = getNextOccurrence(b);
        if (!occA && !occB) return 0;
        if (!occA) return 1;
        if (!occB) return -1;
        if (occA !== occB) return occA < occB ? -1 : 1;
        const ta = a.startTime || "";
        const tb = b.startTime || "";
        return ta < tb ? -1 : ta > tb ? 1 : 0;
    }

    function nextBirthdayOccurrence(dateStr, today = todayISO()) {
        const [, m, d] = dateStr.split("-").map(Number);
        const [ty] = today.split("-").map(Number);

        function occurrenceInYear(year) {
            const daysInMonth = new Date(year, m, 0).getDate();
            const dt = new Date(year, m - 1, Math.min(d, daysInMonth));
            return toISODate(dt);
        }

        const thisYear = occurrenceInYear(ty);
        return thisYear >= today ? thisYear : occurrenceInYear(ty + 1);
    }

    function ageAtOccurrence(dateStr, occDate) {
        const [by] = dateStr.split("-").map(Number);
        const [oy] = occDate.split("-").map(Number);
        const age = oy - by;
        return age > 0 && age < 150 ? age : null;
    }

    return {
        pad, toISODate, todayISO, addInterval, addDays, daysBetween,
        getNextOccurrence, occurrenceDateTime,
        compareByOccurrence, nextBirthdayOccurrence, ageAtOccurrence
    };
});
