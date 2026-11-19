import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
    CLIPBOARD_ID, DEFAULT_DAYS, DEFAULT_IGNORED, DEFAULT_LIMIT, MAX_BYTES, clear, clipboardSettings, ignoredApp,
    pasteNeedsShift, prune, readHistory, record, remove, setPinned, skipMimes, writeHistory,
} from '../shell/clipboard-model.js';

const DAY = 24 * 60 * 60 * 1000;
const settings = {limit: 3, days: 0, ignored: []};
const copy = (text, id, now = 1000) => ({text, id, now, app: 'org.gnome.TextEditor', appName: 'Text Editor'});

test('settings follow the manifest defaults and the enabled switch', () => {
    const manifest = JSON.parse(readFileSync(new URL('../extensions/clipboard-history/extension.json', import.meta.url)));
    const defaults = Object.fromEntries(manifest.preferences.map(p => [p.name, p.default]));
    assert.equal(manifest.id, CLIPBOARD_ID);
    assert.equal(Number(defaults.limit), DEFAULT_LIMIT);
    assert.equal(Number(defaults.days), DEFAULT_DAYS);
    assert.equal(defaults.ignored, DEFAULT_IGNORED);

    const off = clipboardSettings('');
    assert.equal(off.enabled, false);
    assert.equal(off.limit, 100);
    assert.equal(off.days, 30);
    assert.deepEqual(off.ignored, ['org.keepassxc.keepassxc', 'com.bitwarden.desktop', '1password']);
    const on = clipboardSettings(JSON.stringify({enabled_builtins: [CLIPBOARD_ID],
        preferences: {[CLIPBOARD_ID]: {limit: '25', days: '0', ignored: 'Signal, '}}}));
    assert.deepEqual(on, {enabled: true, limit: 25, days: 0, ignored: ['signal']});
    assert.equal(clipboardSettings(JSON.stringify({preferences: {[CLIPBOARD_ID]: {limit: '7'}}})).limit, 100);
});

test('records copies newest first and moves repeats to the top', () => {
    let items = record([], copy('one', 'a', 1), settings);
    items = record(items, copy('two', 'b', 2), settings);
    items = setPinned(items, 'a', true);
    items = record(items, copy('one', 'c', 3), settings);
    assert.deepEqual(items.map(i => [i.id, i.copiedAt, i.pinned]), [['a', 3, true], ['b', 2, false]]);
    assert.equal(items[0].appName, 'Text Editor');
    assert.equal(record(items, copy('   \n', 'd'), settings), null);
    assert.equal(record(items, copy(null, 'd'), settings), null);
});

test('measures the size limit in UTF-8 bytes', () => {
    assert.ok(record([], copy('x'.repeat(MAX_BYTES), 'a'), settings));
    // Persian letters take two bytes each.
    assert.equal(record([], copy('س'.repeat(MAX_BYTES / 2 + 1), 'a'), settings), null);
});

test('prunes by count and age but keeps pinned items', () => {
    const now = 100 * DAY;
    const items = [
        {id: 'p', text: 'p', copiedAt: 0, pinned: true},
        ...[1, 2, 3, 4].map(n => ({id: `i${n}`, text: `${n}`, copiedAt: now - n * DAY, pinned: false})),
    ];
    assert.deepEqual(prune(items, {limit: 2, days: 0}, now).map(i => i.id), ['p', 'i1', 'i2']);
    assert.deepEqual(prune(items, {limit: 10, days: 2}, now).map(i => i.id), ['p', 'i1', 'i2']);
    assert.deepEqual(clear(items).map(i => i.id), ['p']);
    assert.deepEqual(remove(items, 'i1').map(i => i.id), ['p', 'i2', 'i3', 'i4']);
});

test('reads its own file and ignores damaged entries', () => {
    const items = record([], copy('hello', 'a'), settings);
    assert.deepEqual(readHistory(writeHistory(items)), items);
    assert.deepEqual(readHistory('{"items":[{"id":"x"},null,{"id":"y","text":"t","copiedAt":1}]}'),
        [{id: 'y', text: 't', app: '', appName: '', copiedAt: 1, pinned: false}]);
    assert.deepEqual(readHistory('not json'), []);
});

test('skips secrets, copied files and ignored apps', () => {
    assert.equal(skipMimes(['text/plain;charset=utf-8', 'x-kde-passwordManagerHint']), true);
    assert.equal(skipMimes(['x-special/gnome-copied-files', 'text/plain']), true);
    assert.equal(skipMimes(['text/plain', 'text/html']), false);
    const ignored = clipboardSettings('').ignored;
    assert.equal(ignoredApp({app: 'org.keepassxc.KeePassXC'}, ignored), true);
    assert.equal(ignoredApp({app: '1password.desktop', appName: '1Password'}, ignored), true);
    assert.equal(ignoredApp({app: 'org.mozilla.firefox', wmClass: 'firefox'}, ignored), false);
    assert.equal(ignoredApp({}, ignored), false);
});

test('terminals paste with Ctrl+Shift+V', () => {
    assert.equal(pasteNeedsShift({app: 'org.gnome.Ptyxis'}), true);
    assert.equal(pasteNeedsShift({app: 'org.gnome.Console'}), true);
    assert.equal(pasteNeedsShift({wmClass: 'kitty'}), true);
    assert.equal(pasteNeedsShift({app: 'org.gnome.TextEditor', wmClass: 'gnome-text-editor'}), false);
    assert.equal(pasteNeedsShift({}), false);
});
