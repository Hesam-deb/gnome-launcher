// Pure helpers for the Clipboard History command. Lumen's GNOME Shell part
// records copies into clipboard-history.json; this extension only reads it and
// asks the Shell to pin, delete or clear items (see shell/clipboard-model.js).

/** Lists show at most this many items; search still covers all of them. */
export const MAX_ITEMS = 100;
// Keeps a list of 100 items well under the 1 MiB frame limit.
const PREVIEW_CHARS = 1500;
const TITLE_CHARS = 120;

export function historyPath(env, home) {
  const data = env.XDG_DATA_HOME?.startsWith('/') ? env.XDG_DATA_HOME : `${home}/.local/share`;
  return `${data}/gnome-launcher/clipboard-history.json`;
}

export function readHistory(text) {
  let items;
  try { items = JSON.parse(text)?.items; } catch { return []; }
  return Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string' &&
    /^[a-z0-9]+$/.test(item.id) && typeof item.text === 'string' && item.text && typeof item.copiedAt === 'number') : [];
}

/** Pinned items first, then the newest. Every word of the query must appear. */
export function search(items, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = items.filter(item => {
    const text = item.text.toLowerCase();
    return terms.every(term => text.includes(term));
  });
  return [...found.filter(i => i.pinned), ...found.filter(i => !i.pinned)];
}

/** The first non-empty line, with whitespace collapsed. */
export function title(text) {
  const line = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1)}…` : line;
}

export function kind(text) {
  const trimmed = text.trim();
  if (/^(https?|ftp):\/\/\S+$/i.test(trimmed) || /^mailto:\S+$/i.test(trimmed)) return 'link';
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) || /^(rgb|hsl)a?\(.+\)$/i.test(trimmed)) return 'color';
  if (/^-?[\d.,\s]+$/.test(trimmed) && /\d/.test(trimmed)) return 'number';
  return text.includes('\n') ? 'lines' : 'text';
}
const ICONS = {link: 'insert-link-symbolic', color: 'color-select-symbolic', number: 'accessories-calculator-symbolic',
  lines: 'format-justify-left-symbolic', text: 'text-x-generic-symbolic'};

/** "now", "5m", "3h", "2d", or the date for anything older than a week. */
export function ago(then, now) {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / 1440)}d`;
  return new Date(then).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export function stats(text) {
  return {
    characters: [...text].length,
    words: text.split(/\s+/).filter(Boolean).length,
    lines: text.split('\n').length,
  };
}

function preview(text) {
  if (text.length <= PREVIEW_CHARS) return text;
  return `${text.slice(0, PREVIEW_CHARS)}…\n\n(${(text.length - PREVIEW_CHARS).toLocaleString()} more characters)`;
}

export function listItem(item, now) {
  const {characters, words, lines} = stats(item.text);
  const type = kind(item.text);
  return {
    id: item.id,
    title: title(item.text),
    icon: ICONS[type],
    section: item.pinned ? 'Pinned' : 'Recent',
    accessories: [...(item.pinned ? [{icon: 'view-pin-symbolic', tooltip: 'Pinned'}] : []),
      {text: ago(item.copiedAt, now), tooltip: new Date(item.copiedAt).toLocaleString()}],
    detail: {
      text: preview(item.text),
      metadata: [
        {label: 'Source', text: item.appName || item.app || 'Unknown'},
        {label: 'Copied', text: new Date(item.copiedAt).toLocaleString()},
        {separator: true},
        {label: 'Characters', text: characters.toLocaleString()},
        {label: 'Words', text: words.toLocaleString()},
        {label: 'Lines', text: lines.toLocaleString()},
      ],
    },
    actions: [
      {id: 'primary', title: 'Paste'},
      {id: 'copy', title: 'Copy to Clipboard'},
      {id: 'pin', title: item.pinned ? 'Unpin' : 'Pin'},
      {id: 'delete', title: 'Delete'},
    ],
  };
}

export function historyView(items, query, now) {
  return {
    items: search(items, query).slice(0, MAX_ITEMS).map(item => listItem(item, now)),
    options: {
      placeholder: 'Search clipboard history',
      detail: true,
      empty: query.trim()
        ? {title: 'No matching clips', description: 'Try other words.', icon: 'edit-find-symbolic'}
        : {title: 'Nothing copied yet', icon: 'edit-paste-symbolic',
          description: 'Text you copy appears here. If it stays empty, log out and back in once so GNOME loads Lumen.'},
    },
  };
}
