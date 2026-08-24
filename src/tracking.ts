/// <reference types="@workadventure/iframe-api-typings" />

/*
 * Presence logging to the CharterVerse Google Form. Replaces the TaskMagic
 * webhook ping, and writes the same five columns the sheet already has.
 *
 * A row is written when a session segment ends, not on a timer, so the sheet
 * holds sessions rather than raw pings. Segments end on leaving the map, on the
 * tab going hidden, and every MAX_SESSION_MINUTES so a browser crash costs at
 * most that much rather than the whole visit.
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

const MIN_MINUTES = 1;
const MAX_SESSION_MINUTES = 30;

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

function submit(room: string, start: Date, end: Date): void {
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
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

class Session {
    private active = false;
    private start: Date | undefined;
    private capTimer: number | undefined;

    constructor(private readonly room: string) {}

    open(): void {
        this.active = true;
        this.begin();
    }

    close(): void {
        this.cut();
        this.active = false;
    }

    suspend(): void {
        this.cut();
    }

    resume(): void {
        if (this.active) this.begin();
    }

    private begin(): void {
        if (this.start) return;
        this.start = new Date();
        this.capTimer = window.setInterval(() => {
            this.cut();
            this.begin();
        }, MAX_SESSION_MINUTES * 60_000);
    }

    private cut(): void {
        if (this.capTimer !== undefined) {
            window.clearInterval(this.capTimer);
            this.capTimer = undefined;
        }
        if (!this.start) return;
        submit(this.room, this.start, new Date());
        this.start = undefined;
    }
}

function bindLifecycle(session: Session): void {
    // visibilitychange is the only exit signal mobile browsers fire reliably;
    // pagehide covers desktop tab close and navigation.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            session.suspend();
        } else {
            session.resume();
        }
    });
    window.addEventListener("pagehide", () => session.close());
}

/** Logs time spent in the map as a whole. Call once, inside WA.onInit(). */
export function trackPresence(): void {
    if (WA.player.tags.includes("bot")) return;
    const session = new Session(roomLabel());
    session.open();
    bindLifecycle(session);
}

/** Logs time spent inside one tile layer, reported under `label`. */
export function trackZone(layerName: string, label: string): void {
    if (WA.player.tags.includes("bot")) return;
    const session = new Session(label);
    WA.room.onEnterLayer(layerName).subscribe(() => session.open());
    WA.room.onLeaveLayer(layerName).subscribe(() => session.close());
    bindLifecycle(session);
}
