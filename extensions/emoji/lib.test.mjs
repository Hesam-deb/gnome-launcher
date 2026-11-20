import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {emoticon, find, load, pickerView, remember, search, titleCase, withTone} from './lib.mjs';

const data = load(readFileSync(new URL('./emoji.json', import.meta.url), 'utf8'));
const glyphs = list => list.map(e => e.e);

test('the data covers every group without duplicates or empty names', () => {
  assert.ok(data.emoji.length > 1800);
  assert.equal(new Set(glyphs(data.emoji)).size, data.emoji.length);
  assert.ok(data.emoji.every(e => e.n && data.groups[e.g]));
  assert.deepEqual(new Set(data.emoji.map(e => e.g)).size, data.groups.length);
});

test('emoticons suggest related emoji, best first', () => {
  assert.deepEqual(glyphs(emoticon(data, ':)')).slice(0, 3), ['🙂', '😊', '😀']);
  assert.equal(emoticon(data, ':-)')[0].e, '🙂');
  assert.equal(emoticon(data, ':D')[0].e, '😀');
  assert.equal(emoticon(data, ' <3 ')[0].e, '❤️');
  assert.equal(emoticon(data, 'XD')[0].e, '😆');
  assert.equal(emoticon(data, ':-1')[0].e, '👎');
  // The rest of 🙂's subgroup follows the curated picks.
  assert.ok(glyphs(emoticon(data, ':)')).includes('😇'));
  assert.equal(emoticon(data, 'fire'), null);
  assert.equal(emoticon(data, ''), null);
});

test('search ranks shortcodes, names and keywords', () => {
  assert.equal(search(data, ':fire:')[0].e, '🔥');
  assert.equal(search(data, ':fire')[0].e, '🔥');
  assert.equal(search(data, 'thumbs up')[0].e, '👍');
  assert.equal(search(data, ':+1')[0].e, '👍');
  assert.equal(search(data, 'heart')[0].e, '❤️');
  assert.ok(glyphs(search(data, 'love')).includes('❤️'));
  assert.ok(glyphs(search(data, 'smile')).slice(0, 5).includes('😄'));
  assert.deepEqual(search(data, ':'), []);
  assert.deepEqual(search(data, 'zzzqqq'), []);
});

test('Persian keywords find emoji, also when typed with ي or ك', () => {
  assert.ok(glyphs(search(data, 'قلب')).slice(0, 3).includes('❤️'));
  assert.ok(glyphs(search(data, 'لبخند')).includes('🙂'));
  assert.ok(glyphs(search(data, 'آتش')).includes('🔥'));
  assert.deepEqual(glyphs(search(data, 'كيك')).slice(0, 3), glyphs(search(data, 'کیک')).slice(0, 3));
});

test('find prefers an emoticon family over a text search', () => {
  assert.equal(find(data, ':(')[0].e, '🙁');
  assert.equal(find(data, 'rocket')[0].e, '🚀');
});

test('skin tones apply to emoji that have them', () => {
  const wave = data.byGlyph.get('👋');
  assert.equal(withTone(wave, 0), '👋');
  assert.equal(withTone(wave, 3), '👋🏽');
  assert.equal(withTone(data.byGlyph.get('🔥'), 3), '🔥');
});

test('recently used keeps the newest first without repeats', () => {
  assert.deepEqual(remember(['🔥', '👍'], '👍'), ['👍', '🔥']);
  assert.deepEqual(remember(null, '🔥'), ['🔥']);
  assert.equal(remember(Array.from({length: 40}, (_, i) => String(i)), 'x').length, 24);
});

test('the picker lists recent emoji, then every group, with unique ids', () => {
  const {items, options} = pickerView(data, '', {recent: ['🔥', 'not an emoji'], tone: 2});
  assert.equal(options.columns, 8);
  assert.equal(items[0].section, 'Recently Used');
  assert.equal(items[0].content.text, '🔥');
  assert.equal(items[1].section, 'Smileys & Emotion');
  assert.equal(new Set(items.map(i => i.id)).size, items.length);
  assert.equal(items.length, data.emoji.length + 1);
  assert.ok(items.find(i => i.id === 'e:👋').content.text === '👋🏼');
  assert.match(items.find(i => i.id === 'e:🔥').tooltip, /^🔥 {2}Fire {2}:fire:$/);
  const found = pickerView(data, 'rocket').items;
  assert.equal(found[0].content.text, '🚀');
  assert.equal(pickerView(data, 'zzzqqq').items.length, 0);
});

test('names are shown in title case', () => {
  assert.equal(titleCase('slightly smiling face'), 'Slightly Smiling Face');
  assert.equal(titleCase('flag: Iran'), 'Flag: Iran');
  assert.equal(titleCase('face with tears of joy'), 'Face with Tears of Joy');
  assert.equal(titleCase('a button (blood type)'), 'A Button (Blood Type)');
});
