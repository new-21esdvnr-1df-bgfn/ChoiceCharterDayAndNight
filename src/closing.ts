/// <reference types="@workadventure/iframe-api-typings" />

// Version of the map SCRIPT only (not the map/tileset content), logged to the
// console to tell which code is live — WorkAdventure can take a while to serve
// a fresh deployment. All CharterVerse repos should carry the same script
// version, but they can drift temporarily while a change rolls out repo by repo.
export const SCRIPT_VERSION = "1.0";

console.log(`Script started successfully (version ${SCRIPT_VERSION})`);

// ===== Iowa (Central Time) opening hours =====
// This campus only closes overnight: 11:50pm - 4:00am Iowa time.
const OPEN_TIME = 4 * 60;        // 04:00 Iowa time
const CLOSE_TIME = 23 * 60 + 50; // 23:50 Iowa time

// Staff can enter and stay after hours; everyone else is sent to closed.html
// (hosted in public/, so it deploys next to the maps on GitHub Pages).
const CLOSED_PAGE_FALLBACK = "https://new-21esdvnr-1df-bgfn.github.io/ChoiceCharterDayAndNight/closed.html";

function getIowaMinutes(): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(new Date());
    const hours = Number(parts.find(p => p.type === "hour")?.value) % 24;
    const minutes = Number(parts.find(p => p.type === "minute")?.value);
    return hours * 60 + minutes;
}

function isMapOpenInIowa(): boolean {
    const currentMinutes = getIowaMinutes();
    return currentMinutes >= OPEN_TIME && currentMinutes < CLOSE_TIME;
}

function isStaff(): boolean {
    return WA.player.tags.includes("admin") || WA.player.tags.includes("editor");
}

function redirectToClosedPage(): void {
    let base = CLOSED_PAGE_FALLBACK;
    try {
        if (WA.room.mapURL) {
            base = new URL("closed.html", WA.room.mapURL).toString();
        }
    } catch (e) {
        console.error("Could not derive closed page from map URL, using fallback", e);
    }
    // WA.room.id is the full room URL; closed.html sends the player back to it
    // once the campus reopens.
    const url = `${base}?back=${encodeURIComponent(WA.room.id)}`;
    console.log(`[Iowa Time Check] Campus closed - redirecting to ${url}`);
    WA.nav.goToPage(url);
}

/**
 * Call first inside WA.onInit(). Redirects the player to the closed page when
 * the campus is closed (staff with the admin/editor tag are exempt) and starts
 * the periodic check that kicks players out at closing time.
 *
 * Returns false when the player was redirected — the caller should stop
 * initializing the map script.
 */
export function enforceOpeningHours(): boolean {
    if (!isMapOpenInIowa() && !isStaff()) {
        redirectToClosedPage();
        return false;
    }
    setInterval(() => {
        if (!isMapOpenInIowa() && !isStaff()) {
            redirectToClosedPage();
        }
    }, 60 * 1000);
    return true;
}
