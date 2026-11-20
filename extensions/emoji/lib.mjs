// Emoji search, shared in spirit with src/emoji.rs, which answers `:shortcode`
// and emoticon queries in Lumen's main search. Keep the two in step: the same
// query should find the same emoji in the picker and inline.

/**
 * Lowercases, folds Arabic-layout ي/ك to the Persian ی/ک CLDR uses, reads a
 * zero-width non-joiner as a space and drops diacritics such as the ٔ in گربهٔ.
 */
export function fold(text) {
  return text.toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ')
    .replace(/[\u064b-\u065f\u0670]/g, '');
}

const words = text => fold(text).split(/[^\p{L}\p{N}+]+/u).filter(Boolean);

/** Parses emoji.json and adds what searching needs to each entry. */
export function load(text) {
  const data = JSON.parse(text);
  data.emoji.forEach((e, i) => {
    e.i = i;
    e.name = fold(e.n);
    e.words = words(e.n);
    e.kw = [...new Set(e.k.flatMap(words))];
    e.persian = fold(e.fa ?? '');
  });
  data.byGlyph = new Map(data.emoji.map(e => [e.e, e]));
  return data;
}

const SMALL = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** `face with tears of joy` → `Face with Tears of Joy`. */
export function titleCase(name) {
  return name.replace(/(^|[\s(-])(\p{Ll}[\p{L}']*)/gu,
    (_, before, word, at) => before + (at > 0 && SMALL.has(word) ? word : word[0].toUpperCase() + word.slice(1)));
}

/** The emoji to insert, in the preferred skin tone (1–5) when it has tones. */
export function withTone(entry, tone) {
  return (tone >= 1 && tone <= 5 && entry.t?.[tone - 1]) || entry.e;
}

/**
 * Emoji for an emoticon such as `:)`, `:-D` or `<3`: the curated choices,
 * then emojibase's, then the rest of the first one's subgroup. Null when the
 * text is not a known emoticon.
 */
export function emoticon(data, query) {
  const raw = query.trim().toLowerCase();
  if (!raw) return null;
  // `:-)` → `:)`; `:-1` stays, it is an emoticon of its own.
  const keys = [raw, raw.replace(/^(>?[:;=8bo0x]'?)-(?=.)/, '$1')];
  for (const key of keys) {
    const curated = (data.emoticons[key] ?? []).map(e => data.byGlyph.get(e)).filter(Boolean);
    const known = data.emoji.filter(e => e.em?.some(x => x.toLowerCase() === key));
    const first = curated[0] ?? known[0];
    if (!first) continue;
    const family = data.emoji.filter(e => e.g === first.g && e.sg === first.sg);
    return [...new Set([...curated, ...known, ...family])];
  }
  return null;
}

/** How well `entry` matches the folded query; 0 when it does not. */
export function score(entry, query, tokens) {
  const shortcode = query.replace(/\s+/g, '_');
  if (entry.sc.includes(shortcode)) return 100;
  if (entry.name === query || entry.persian === query) return 95;
  if (entry.sc.some(c => c.startsWith(shortcode))) return 80;
  if (entry.persian.startsWith(query)) return 79;
  if (entry.k.includes(query)) return 78;
  if (entry.name.startsWith(query)) return 75;
  let worst = Infinity;
  for (const t of tokens) {
    let best = 0;
    if (entry.words.includes(t)) best = 70;
    else if (entry.words.some(w => w.startsWith(t))) best = 60;
    if (best < 55 && entry.kw.includes(t)) best = 55;
    if (best < 50 && entry.sc.some(c => c.split('_').some(p => p.startsWith(t)))) best = 50;
    if (best < 45 && entry.kw.some(w => w.startsWith(t))) best = 45;
    if (best < 30 && t.length >= 3 && entry.name.includes(t)) best = 30;
    if (!best) return 0;
    worst = Math.min(worst, best);
  }
  return worst === Infinity ? 0 : worst;
}

/** Emoji matching a name, keyword (English or Persian) or `:shortcode:`, best first. */
export function search(data, query) {
  const q = fold(query).trim().replace(/^:+/, '').replace(/:+$/, '').trim();
  if (!q) return [];
  const tokens = q.split(/[\s_]+/).filter(Boolean);
  return data.emoji
    .map(e => [score(e, q, tokens), e])
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0] || (a[1].p ?? 1e4) - (b[1].p ?? 1e4) || a[1].i - b[1].i)
    .map(([, e]) => e);
}

/** What the picker shows for a query: an emoticon's family, or search results. */
export function find(data, query) {
  return emoticon(data, query) ?? search(data, query);
}

export const RECENT_LIMIT = 24;

/** Moves `glyph` to the front of the recently used list. */
export function remember(recent, glyph) {
  return [glyph, ...(Array.isArray(recent) ? recent : []).filter(g => g !== glyph)].slice(0, RECENT_LIMIT);
}

const ACTIONS = [
  {id: 'primary', title: 'Paste'},
  {id: 'copy', title: 'Copy to Clipboard'},
];

function tile(entry, tone, id, section, extra = []) {
  const glyph = withTone(entry, tone);
  const code = entry.sc[0] ? `  :${entry.sc[0]}:` : '';
  return {
    id, title: '', section,
    content: {text: glyph},
    tooltip: `${glyph}  ${titleCase(entry.n)}${code}`,
    actions: [...ACTIONS, ...extra],
  };
}

/** The picker's grid: recently used and every group, or the matches. */
export function pickerView(data, query, {recent = [], tone = 0} = {}) {
  const options = {columns: 8, aspect: '1', placeholder: 'Search emoji, :shortcode: or :)'};
  if (query.trim()) {
    const found = find(data, query);
    const items = found.map(e => tile(e, tone, `e:${e.e}`, 'Results'));
    return {items, options: {...options, empty: {title: 'No Emoji Found', icon: 'face-uncertain-symbolic',
      description: 'Try another word, a :shortcode: or an emoticon such as :)'}}};
  }
  const items = [];
  for (const glyph of recent) {
    const entry = data.byGlyph.get(glyph);
    if (entry) items.push(tile(entry, tone, `r:${glyph}`, 'Recently Used', [{id: 'forget', title: 'Remove from Recently Used'}]));
  }
  for (const e of data.emoji) items.push(tile(e, tone, `e:${e.e}`, data.groups[e.g]));
  return {items, options};
}
