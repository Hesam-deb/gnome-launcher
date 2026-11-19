import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_ITEMS, ago, historyPath, historyView, kind, readHistory, search, stats, title} from './lib.mjs';

const MINUTE = 60_000;
const item = (id, text, extra = {}) => ({id, text, app: '', appName: '', copiedAt: 0, pinned: false, ...extra});

test('finds the history file like the Shell does', () => {
  assert.equal(historyPath({}, '/home/u'), '/home/u/.local/share/gnome-launcher/clipboard-history.json');
  assert.equal(historyPath({XDG_DATA_HOME: '/data'}, '/home/u'), '/data/gnome-launcher/clipboard-history.json');
  assert.equal(historyPath({XDG_DATA_HOME: 'relative'}, '/home/u'), '/home/u/.local/share/gnome-launcher/clipboard-history.json');
});

test('rejects IDs that are unsafe to pass to gdbus', () => {
  const text = JSON.stringify({items: [item('ok1', 'a'), item("x' ; rm", 'b'), item('', 'c')]});
  assert.deepEqual(readHistory(text).map(i => i.id), ['ok1']);
});

test('search matches every word and puts pinned items first', () => {
  const items = [item('a', 'Hello world'), item('b', 'world peace', {pinned: true}), item('c', 'سلام دنیا')];
  assert.deepEqual(search(items, '').map(i => i.id), ['b', 'a', 'c']);
  assert.deepEqual(search(items, 'WORLD hello').map(i => i.id), ['a']);
  assert.deepEqual(search(items, 'دنیا').map(i => i.id), ['c']);
});

test('titles, kinds and stats', () => {
  assert.equal(title('\n\n   first   line  \nsecond'), 'first line');
  assert.equal(title('x'.repeat(300)).length, 120);
  assert.equal(kind('https://gnome.org/a?b=1'), 'link');
  assert.equal(kind('#3584e4'), 'color');
  assert.equal(kind('1,234.5'), 'number');
  assert.equal(kind('a\nb'), 'lines');
  assert.equal(kind('see https://gnome.org'), 'text');
  assert.deepEqual(stats('one two\nthree 🎉'), {characters: 15, words: 4, lines: 2});
});

test('relative times', () => {
  assert.equal(ago(0, 30_000), 'now');
  assert.equal(ago(0, 5 * MINUTE), '5m');
  assert.equal(ago(0, 3 * 60 * MINUTE), '3h');
  assert.equal(ago(0, 2 * 24 * 60 * MINUTE), '2d');
});

test('the view caps items, previews long text and labels actions', () => {
  const many = Array.from({length: 150}, (_, n) => item(`i${n}`, `clip ${n}`));
  const {items, options} = historyView(many, '', 0);
  assert.equal(items.length, MAX_ITEMS);
  assert.equal(options.detail, true);
  assert.equal(items[0].actions[0].id, 'primary');
  assert.equal(items[0].section, 'Recent');

  const pinned = historyView([item('p', 'y'.repeat(5000), {pinned: true, appName: 'Firefox'})], '', 0).items[0];
  assert.equal(pinned.section, 'Pinned');
  assert.equal(pinned.actions.find(a => a.id === 'pin').title, 'Unpin');
  assert.ok(pinned.detail.text.length < 1600);
  assert.match(pinned.detail.text, /3,500 more characters/);
  assert.equal(pinned.detail.metadata[0].text, 'Firefox');
  // The whole list stays far below the 1 MiB frame limit.
  const big = Array.from({length: 100}, (_, n) => item(`b${n}`, 'ž'.repeat(100_000)));
  assert.ok(JSON.stringify(historyView(big, '', 0).items).length < 400_000);

  assert.equal(historyView([], 'zzz', 0).options.empty.title, 'No matching clips');
  assert.equal(historyView([], '', 0).options.empty.title, 'Nothing copied yet');
});
