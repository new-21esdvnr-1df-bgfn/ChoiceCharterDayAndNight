/// <reference types="@workadventure/iframe-api-typings" />

/*
 * Presence logging to the CharterVerse Google Form. Replaces the TaskMagic
 * webhook ping, and writes the same five columns the sheet already has.
 *
 * A visit is the whole time the tab is open on the map — switching to another
 * tab does NOT pause the clock. One row is written per visit, when it ends:
 * the tab is closed or navigated away (the nightly closing kick counts, which
 * is what keeps closed hours out of the numbers).
 *
 * Two things interrupt the simple picture:
 *  - A machine that goes to sleep (or a tab the browser freezes) stops running
 *    entirely. A heartbeat timestamp detects the gap on wake: the old visit is
 *    closed at the moment the page stopped running — sleep is not presence —
 *    and a new visit starts at wake.
 *  - A crashed/killed browser never fires pagehide. The visit-in-progress is
 *    saved to localStorage every heartbeat and submitted retroactively the
 *    next time the map loads on that machine (attributed to whoever is logged
 *    in then — on per-student devices that is the same student).
 *
 * Visits under MIN_MINUTES are not attendance and write no row.
 */

const FORM_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLSc9lHYhZy-AjWNShTl-pN97_E4weWEvOgLJevo3yDMbKBNwrg/formResponse";

const ENTRY = {
    room: "entry.890293588",
    minutes: "entry.292129118",
    name: "entry.1655038687",
    start: "entry.1855601666",
    end: "entry.519259110",
};

// The sheet is read in Iowa time, so rows are stamped in Iowa time regardless
// of where the player's browser is.
const TIMEZONE = "America/Chicago";

// Below this the visit doesn't count as attending class, so no row is written.
const MIN_MINUTES = 5;
const HEARTBEAT_MS = 60_000;
// A heartbeat gap larger than this means the page wasn't running (machine
// asleep, tab frozen by the browser): the gap is not presence. Generous enough
// to survive background-tab timer throttling, which still ticks about 1/min.
const GAP_TOLERANCE_MS = 5 * 60_000;

const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});

// Matches the existing sheet exactly: M/D/YYYY HH:MM:SS
function formatDateTime(date: Date): string {
    const p: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) {
        p[part.type] = part.value;
    }
    return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

// WA.room.id is a full URL; the last path segment is the deployed room slug.
//   /@/choice-charter-school/charterverse/middle-school -> "Middle School"
//   /_/<hash>/localhost:5173/kotic-map.tmj              -> "Dev: Kotic Map"
function roomLabel(): string {
    let path: string[];
    try {
        path = new URL(WA.room.id).pathname.split("/").filter(Boolean);
    } catch {
        return "Unknown";
    }

    const slug = (path[path.length - 1] ?? "").replace(/\.tmj$/, "");
    if (!slug) return "Unknown";

    const pretty = slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    // "_" marks an anonymous/dev room — keep those rows out of the real numbers.
    return path[0] === "_" ? `Dev: ${pretty}` : pretty;
}

function minutesBetween(start: Date, end: Date): number {
    return Math.round((end.getTime() - start.getTime()) / 60_000);
}

function submit(room: string, start: Date, end: Date): void {
    const minutes = minutesBetween(start, end);
    if (minutes < MIN_MINUTES) return;

    // A row with no username is unattributable noise in the sheet.
    const name = WA.player.name;
    if (!name) return;

    const payload = new URLSearchParams();
    payload.append(ENTRY.room, room);
    payload.append(ENTRY.minutes, String(minutes));
    payload.append(ENTRY.name, name);
    payload.append(ENTRY.start, formatDateTime(start));
    payload.append(ENTRY.end, formatDateTime(end));

    // sendBeacon, not fetch: the browser cancels in-flight fetches on unload,
    // which is exactly when a closing session needs to be written. The content
    // type is CORS-safelisted, so no preflight — which Google Forms would reject.
    const body = new Blob([payload.toString()], { type: "application/x-www-form-urlencoded" });

    let queued = false;
    try {
        queued = navigator.sendBeacon(FORM_URL, body);
    } catch {
        queued = false;
    }

    if (!queued) {
        // sendBeacon refuses if the queue is full or the frame's policy blocks
        // it. keepalive gives fetch the same survives-unload guarantee.
        void fetch(FORM_URL, { method: "POST", body, mode: "no-cors", keepalive: true })
            .catch((error) => console.error("[tracking] send failed", error));
    }

    console.log(`[tracking] ${room} ${minutes}min beacon=${queued}`);
}

function storageKey(room: string): string {
    return `charterverse-tracking:${room}`;
}

/**
 * Submit a visit a crashed/killed browser left behind in localStorage.
 * Best effort: storage may be unavailable, and on shared devices the row is
 * attributed to the player who is logged in now.
 */
function recoverAbandonedVisit(room: string): void {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(storageKey(room));
        if (raw !== null) localStorage.removeItem(storageKey(room));
    } catch {
        return;
    }
    if (raw === null) return;

    try {
        const saved = JSON.parse(raw) as { start: number; lastAlive: number };
        if (typeof saved.start === "number" && typeof saved.lastAlive === "number") {
            submit(room, new Date(saved.start), new Date(saved.lastAlive));
        }
    } catch {
        // Corrupt entry: already removed, nothing to recover.
    }
}

class Session {
    private start: Date | undefined;
    private lastAlive: Date | undefined;
    private heartbeat: number | undefined;

    constructor(private readonly room: string) {}

    open(): void {
        if (this.start) return;
        this.start = new Date();
        this.lastAlive = this.start;
        this.persist();
        this.heartbeat = window.setInterval(() => this.tick(), HEARTBEAT_MS);
    }

    close(): void {
        if (this.heartbeat !== undefined) {
            window.clearInterval(this.heartbeat);
            this.heartbeat = undefined;
        }
        if (!this.start || !this.lastAlive) return;
        // Normally end = now; the clamp only bites when close() fires right
        // after a long suspension (closing a tab that had been frozen).
        const end = new Date(Math.min(Date.now(), this.lastAlive.getTime() + GAP_TOLERANCE_MS));
        submit(this.room, this.start, end);
        this.start = undefined;
        this.lastAlive = undefined;
        try {
            localStorage.removeItem(storageKey(this.room));
        } catch {
            /* nothing to clean up */
        }
    }

    private tick(): void {
        if (!this.start || !this.lastAlive) return;
        const now = new Date();
        if (now.getTime() - this.lastAlive.getTime() > GAP_TOLERANCE_MS) {
            // The page just woke from a sleep/freeze: end the old visit where
            // the heartbeats stopped and start a fresh one now.
            submit(this.room, this.start, this.lastAlive);
            this.start = now;
        }
        this.lastAlive = now;
        this.persist();
    }

    private persist(): void {
        if (!this.start || !this.lastAlive) return;
        try {
            localStorage.setItem(
                storageKey(this.room),
                JSON.stringify({ start: this.start.getTime(), lastAlive: this.lastAlive.getTime() }),
            );
        } catch {
            /* storage unavailable: crash recovery just won't cover this visit */
        }
    }
}

/** Logs time spent in the map as a whole. Call once, inside WA.onInit(). */
export function trackPresence(): void {
    if (WA.player.tags.includes("bot")) return;
    const room = roomLabel();
    recoverAbandonedVisit(room);
    const session = new Session(room);
    session.open();
    // pagehide covers tab close and navigation — including the closing-time
    // kick, which is what keeps after-hours time out of the sheet.
    window.addEventListener("pagehide", () => session.close());
}

/** Logs time spent inside one tile layer, reported under `label`. */
export function trackZone(layerName: string, label: string): void {
    if (WA.player.tags.includes("bot")) return;
    recoverAbandonedVisit(label);
    const session = new Session(label);
    WA.room.onEnterLayer(layerName).subscribe(() => session.open());
    WA.room.onLeaveLayer(layerName).subscribe(() => session.close());
    window.addEventListener("pagehide", () => session.close());
}
