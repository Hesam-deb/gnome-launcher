// Pure helpers for clipboard history, shared with Node tests. The Shell is the
// only writer of clipboard-history.json:
// {"version": 1, "items": [{id, text, app, appName, copiedAt, pinned}]}, newest first.

export const CLIPBOARD_ID = 'lumen.clipboard-history';
/**
 * Longer copies (in UTF-8 bytes, as Lumen's host limits them) are not kept,
 * so pasting an item always gives the whole text back.
 */
export const MAX_BYTES = 100_000;
export const LIMITS = [25, 50, 100, 200];
// Defaults must match the preferences in extensions/clipboard-history/extension.json.
export const DEFAULT_LIMIT = 100;
export const DEFAULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Password managers that do not mark their copies with x-kde-passwordManagerHint.
export const DEFAULT_IGNORED = 'org.keepassxc.KeePassXC, com.bitwarden.desktop, 1password';
// Copies marked secret by KeePassXC, Lumen's Password Generator and others.
export const SENSITIVE_MIME = 'x-kde-passwordManagerHint';
// Files copied in Files carry their paths as text; they are not text copies.
const FILE_MIMES = ['x-special/gnome-copied-files', 'application/x-gnome-saved-search'];

function parse(text) {
    try { return JSON.parse(text); } catch { return null; }
}

/** The extension's switch and preferences from Lumen's state.json, with defaults. */
export function clipboardSettings(stateText) {
    const state = parse(stateText);
    const prefs = state?.preferences?.[CLIPBOARD_ID] ?? {};
    const limit = Number(prefs.limit ?? DEFAULT_LIMIT);
    const days = Number(prefs.days ?? DEFAULT_DAYS);
    return {
        enabled: Array.isArray(state?.enabled_builtins) && state.enabled_builtins.includes(CLIPBOARD_ID),
        limit: LIMITS.includes(limit) ? limit : DEFAULT_LIMIT,
        // 0 keeps items until the size limit pushes them out.
        days: Number.isFinite(days) && days > 0 ? days : 0,
        ignored: String(prefs.ignored ?? DEFAULT_IGNORED).split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean),
    };
}

function validItem(item) {
    return item && typeof item.id === 'string' && typeof item.text === 'string' && item.text &&
        typeof item.copiedAt === 'number';
}

export function readHistory(text) {
    const items = parse(text)?.items;
    return Array.isArray(items) ? items.filter(validItem).map(item => ({
        id: item.id, text: item.text, app: String(item.app ?? ''), appName: String(item.appName ?? ''),
        copiedAt: item.copiedAt, pinned: item.pinned === true,
    })) : [];
}

export function writeHistory(items) {
    return JSON.stringify({version: 1, items});
}

/** Whether a copy with these MIME types should stay out of the history. */
export function skipMimes(mimes) {
    return mimes.includes(SENSITIVE_MIME) || mimes.some(m => FILE_MIMES.includes(m));
}

/** Whether the app the copy came from is on the ignore list (ID, window class or name). */
export function ignoredApp(source, ignored) {
    const fields = [source.app, source.wmClass, source.appName]
        .map(f => String(f ?? '').toLowerCase().replace(/\.desktop$/, '')).filter(Boolean);
    return ignored.some(pattern => fields.some(field => field === pattern || field.includes(pattern)));
}

/**
 * Adds a copy as the newest item. Copying text that is already kept moves it
 * to the top and keeps its pin and source. Returns null when nothing changes.
 */
export function record(items, copy, settings) {
    const text = copy.text;
    if (typeof text !== 'string' || !text.trim() || new TextEncoder().encode(text).length > MAX_BYTES) return null;
    const existing = items.find(item => item.text === text);
    const item = existing
        ? {...existing, copiedAt: copy.now}
        : {id: copy.id, text, app: copy.app ?? '', appName: copy.appName ?? '', copiedAt: copy.now, pinned: false};
    return prune([item, ...items.filter(other => other !== existing)], settings, copy.now);
}

/** Drops unpinned items beyond the size limit or older than the age limit. */
export function prune(items, settings, now) {
    const oldest = settings.days ? now - settings.days * DAY_MS : -Infinity;
    let kept = 0;
    return items.filter(item => {
        if (item.pinned) return true;
        if (item.copiedAt < oldest || kept >= settings.limit) return false;
        kept++;
        return true;
    });
}

export function setPinned(items, id, pinned) {
    return items.map(item => item.id === id ? {...item, pinned} : item);
}

export function remove(items, id) {
    return items.filter(item => item.id !== id);
}

/** Clears the history; pinned items stay. */
export function clear(items) {
    return items.filter(item => item.pinned);
}

const TERMINALS = ['terminal', 'ptyxis', 'console', 'kitty', 'alacritty', 'wezterm', 'foot', 'konsole',
    'tilix', 'terminator', 'xterm', 'ghostty', 'blackbox', 'contour'];

/** Terminals paste with Ctrl+Shift+V; everything else with Ctrl+V. */
export function pasteNeedsShift(window) {
    const fields = [window.app, window.wmClass].map(f => String(f ?? '').toLowerCase());
    return fields.some(field => TERMINALS.some(name => field.includes(name)));
}
