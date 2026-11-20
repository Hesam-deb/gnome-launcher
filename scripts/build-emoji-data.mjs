#!/usr/bin/env node
// Builds extensions/emoji/emoji.json, the data behind the Emoji extension and
// the inline `:shortcode` results in Lumen's main search.
//
//   node scripts/build-emoji-data.mjs
//
// It downloads pinned packages with `npm pack` into a temporary folder:
// - emojibase-data (MIT): English names, tags, emoticons, skin tones,
//   GitHub and Slack (iamcal) shortcodes, groups and order.
// - cldr-annotations-full and cldr-annotations-derived-full (Unicode-3.0):
//   Persian keywords and names, so «قلب» finds ❤️.
// The output is committed, so building Lumen never needs the network.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const EMOJIBASE = '18.0.0';
const CLDR = '49.0.0';
// Ubuntu 26.04 ships Noto Color Emoji 2.051, which draws Emoji 17.0. Newer
// emoji would show as empty boxes.
const MAX_VERSION = 17;
const GROUPS = ['Smileys & Emotion', 'People & Body', null, 'Animals & Nature', 'Food & Drink',
  'Travel & Places', 'Activities', 'Objects', 'Symbols', 'Flags'];

// Emoticons and the emoji they suggest, best first. Emojibase knows a single
// emoji per emoticon; people typing :) usually want to pick among a few.
// Lookups also try the emoticon without a nose (:-) → :)) and ignoring case.
// Emojibase's own emoticons and the rest of the first emoji's subgroup follow.
const EMOTICONS = {
  ':)': ['🙂', '😊', '😀', '😃', '😄', '☺️', '🙃'],
  '(:': ['🙃', '🙂'],
  ':]': ['🙂', '😊'],
  '=)': ['🙂', '😊', '😀'],
  ':d': ['😀', '😃', '😄', '😁', '😆', '😂', '🤣'],
  '=d': ['😀', '😃', '😄'],
  'xd': ['😆', '🤣', '😂', '😝'],
  ':(': ['🙁', '☹️', '😞', '😟', '😔', '😢', '😕'],
  ':[': ['🙁', '😞'],
  '=(': ['🙁', '😞'],
  ";)": ['😉', '😜', '😏'],
  ':p': ['😛', '😜', '😝', '🤪', '😋'],
  ';p': ['😜', '😝', '🤪'],
  'xp': ['😝', '😜'],
  ':o': ['😮', '😯', '😲', '😱', '😳'],
  ':0': ['😮', '😯', '😲'],
  ':*': ['😘', '😗', '😚', '😙', '💋'],
  ":'(": ['😢', '😭', '😿', '🥲'],
  ":')": ['🥲', '😂', '🥹'],
  ":'d": ['😂', '🤣', '🥲'],
  ':/': ['😕', '🫤', '😐', '🤨'],
  ':\\': ['😕', '🫤'],
  ':|': ['😐', '😑', '😶'],
  ':s': ['😖', '😣', '😕', '🫤'],
  ':$': ['😳', '☺️', '🤭'],
  ':x': ['🤐', '😶', '🫢'],
  ':#': ['🤐', '😶'],
  ':@': ['😠', '😡', '🤬'],
  '>:(': ['😠', '😡', '🤬', '👿'],
  '>:)': ['😈', '😏', '👿'],
  'o:)': ['😇', '🙂'],
  '0:)': ['😇', '🙂'],
  'b)': ['😎', '🤓'],
  '8)': ['😎', '🤓'],
  '8-)': ['😎', '🤓'],
  ':3': ['😺', '😸', '😊', '🐱'],
  ':>': ['😏', '😊'],
  ':<': ['😟', '🙁'],
  'd:': ['😧', '😨', '😱', '😫'],
  '-_-': ['😑', '😒', '😐', '🙄'],
  '^_^': ['😊', '😄', '😁', '☺️'],
  '^^': ['😊', '😄', '😁'],
  'o_o': ['😳', '😮', '😯', '👀'],
  'o.o': ['😳', '😮', '😯', '👀'],
  't_t': ['😭', '😢'],
  ';_;': ['😭', '😢'],
  '<3': ['❤️', '😍', '🥰', '💕', '💖', '💗', '💘'],
  '</3': ['💔', '❤️‍🩹'],
  '\\o/': ['🙌', '🥳', '🎉'],
  '\\m/': ['🤘', '🎸'],
  ':+1': ['👍', '👌', '🙌'],
  ':-1': ['👎'],
  'zzz': ['😴', '💤', '🥱'],
  '¯\\_(ツ)_/¯': ['🤷', '🤷‍♂️', '🤷‍♀️'],
};

// The most used emoji, most used first, after Unicode's emoji frequency list
// (unicode.org/emoji/charts-14.0/emoji-frequency, 2021). Equal matches rank
// by this, so «قلب» and `love` lead with ❤️ rather than 💘.
const POPULAR = [...new Intl.Segmenter().segment(
  '😂❤️🤣👍😭🙏😘🥰😍😊🎉😁💕🥺😅🔥☺️🤦♥️🤷🙄😆🤗😉🎂🤔👏🙂😳🥳😎👌💜😔💪✨💖👀😋😏😢👉💗😩💯🌹💞🎈💙😃😡💐😜🙈🤞😄🤤🙌🤪❣️😀💋💀👇💔😌💓🤩🙃😬😱😴🤭😐🌞😒😇🌸😈🎶✌️🎊🥵😞💚☀️🖤💰😚👑🎁💥🙋☹️😑🥴👈💩✅👋🤮😤🤢🌟❗😥🌈💛😝😫😲🖕‼️🔴🌻🤯💃👊🤬🏃😕👁️⚡☕🍀💦⭐🦋🤨🌺😹🤘🌷💝💤🤝🐰😓💘🍻😟😣🧐😠🤠😻🌙😛🤙🙊',
)].map(s => s.segment);

function pack(dir, name, version) {
  execFileSync('npm', ['pack', `${name}@${version}`, '--silent'], {cwd: dir, stdio: ['ignore', 'ignore', 'inherit']});
  const out = join(dir, name);
  execFileSync('mkdir', ['-p', out]);
  execFileSync('tar', ['xzf', join(dir, `${name}-${version}.tgz`), '-C', out]);
  return join(out, 'package');
}

const json = path => JSON.parse(readFileSync(path, 'utf8'));
/** Persian text typed with an Arabic layout uses ي and ك; CLDR uses ی and ک. */
const fold = text => text.toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ')
  .replace(/[\u064b-\u065f\u0670]/g, '');
const strip = emoji => emoji.replace(/\ufe0f/g, '');

function build(base, cldr, derived) {
  const data = json(join(base, 'en/data.json'));
  const github = json(join(base, 'en/shortcodes/github.json'));
  const iamcal = json(join(base, 'en/shortcodes/iamcal.json'));
  const emojibase = json(join(base, 'en/shortcodes/emojibase.json'));
  const fa = {...json(join(derived, 'annotationsDerived/fa/annotations.json')).annotationsDerived.annotations,
    ...json(join(cldr, 'annotations/fa/annotations.json')).annotations.annotations};
  const persian = emoji => fa[emoji] ?? fa[strip(emoji)];
  const list = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const emoji = [];
  for (const e of data) {
    if (e.group === undefined || GROUPS[e.group] === null || e.version > MAX_VERSION) continue;
    const shortcodes = [...new Set([...list(github[e.hexcode]), ...list(iamcal[e.hexcode])])];
    if (!shortcodes.length) shortcodes.push(...list(emojibase[e.hexcode]));
    const p = persian(e.emoji);
    // Whole phrases: an exact phrase («قلب» for ❤️) outranks a word inside one
    // («قلب زرد» for 💛). Searching splits them into words as well.
    const keywords = new Set([...(e.tags ?? []), ...(p?.default ?? []), ...(p?.tts ?? [])]
      .map(k => fold(k).trim()).filter(Boolean));
    keywords.delete(fold(e.label));
    const entry = {
      e: e.emoji,
      n: e.label,
      g: GROUPS.filter(Boolean).indexOf(GROUPS[e.group]),
      sg: e.subgroup,
      sc: shortcodes.map(fold),
      k: [...keywords],
    };
    if (p?.tts?.[0]) entry.fa = p.tts[0];
    const rank = POPULAR.indexOf(e.emoji);
    if (rank >= 0) entry.p = rank + 1;
    const emoticons = list(e.emoticon);
    if (emoticons.length) entry.em = emoticons;
    // One variant per tone (1–5). Two-person emoji also come in mixed tones;
    // only the ones where both people share a tone are kept.
    const skins = (e.skins ?? []).filter(s => s.version <= MAX_VERSION)
      .filter(s => !Array.isArray(s.tone) || s.tone.every(t => t === s.tone[0]));
    if (skins.length) {
      const tones = [1, 2, 3, 4, 5].map(t => skins.find(s => [s.tone].flat()[0] === t)?.emoji ?? null);
      if (tones.every(Boolean)) entry.t = tones;
    }
    emoji.push(entry);
  }
  const known = new Set(emoji.map(e => e.e));
  for (const e of POPULAR) if (!known.has(e)) throw new Error(`Popular ${e} is not in the data`);
  for (const [face, list] of Object.entries(EMOTICONS)) {
    for (const e of list) if (!known.has(e)) throw new Error(`Emoticon ${face}: ${e} is not in the data`);
  }
  return {
    source: `emojibase-data ${EMOJIBASE} (MIT), CLDR annotations ${CLDR} (Unicode-3.0)`,
    groups: GROUPS.filter(Boolean),
    emoticons: EMOTICONS,
    emoji,
  };
}

const temp = mkdtempSync(join(tmpdir(), 'lumen-emoji-'));
try {
  const result = build(pack(temp, 'emojibase-data', EMOJIBASE), pack(temp, 'cldr-annotations-full', CLDR),
    pack(temp, 'cldr-annotations-derived-full', CLDR));
  const out = new URL('../extensions/emoji/emoji.json', import.meta.url);
  // One emoji per line keeps diffs readable when the data is updated.
  const lines = result.emoji.map(e => JSON.stringify(e));
  const {emoji: _, ...head} = result;
  const text = JSON.stringify(head).slice(0, -1) + `,"emoji":[\n${lines.join(',\n')}\n]}\n`;
  writeFileSync(out, text);
  console.log(`Wrote ${result.emoji.length} emoji to ${out.pathname} (${(text.length / 1024).toFixed(0)} KB)`);
} finally {
  rmSync(temp, {recursive: true, force: true});
}
