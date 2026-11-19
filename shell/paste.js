import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {describeWindow} from './clipboard.js';
import {pasteNeedsShift} from './clipboard-model.js';

// How long to wait for Lumen to close and the previous window to take focus.
const WAIT_MS = 1500;
// Lets the focused app receive keyboard focus before the keys arrive.
const KEY_DELAY_MS = 60;
// evdev keycodes. Keyvals would fail when a non-Latin layout such as Persian
// is active, because that layout has no key that types "v".
const KEY_LEFTCTRL = 29;
const KEY_LEFTSHIFT = 42;
const KEY_V = 47;

/**
 * Raycast's "Paste to active app": puts text on the clipboard, waits until
 * Lumen has closed and the previous window has focus, then presses Ctrl+V
 * there (Ctrl+Shift+V in terminals).
 */
export class Paster {
    constructor(isLauncher, copied) {
        this._isLauncher = isLauncher;
        this._copied = copied;
    }
    paste(text) {
        this._cancel();
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        if (this._attempt()) return;
        this._focus = global.display.connect('notify::focus-window', () => this._attempt());
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WAIT_MS, () => {
            this._timeout = 0;
            // Nothing took focus (for example the desktop); the text is still copied.
            this._cancel();
            this._copied();
            return GLib.SOURCE_REMOVE;
        });
    }
    _attempt() {
        const window = global.display.focus_window;
        if (!window || this._isLauncher(window)) return false;
        this._cancel();
        const shift = pasteNeedsShift(describeWindow(window));
        this._delay = GLib.timeout_add(GLib.PRIORITY_DEFAULT, KEY_DELAY_MS, () => {
            this._delay = 0;
            this._press(shift ? [KEY_LEFTCTRL, KEY_LEFTSHIFT, KEY_V] : [KEY_LEFTCTRL, KEY_V]);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }
    _press(keys) {
        this._keyboard ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        let time = GLib.get_monotonic_time();
        for (const key of keys) this._keyboard.notify_key(time++, key, Clutter.KeyState.PRESSED);
        for (const key of keys.reverse()) this._keyboard.notify_key(time++, key, Clutter.KeyState.RELEASED);
    }
    _cancel() {
        if (this._focus) global.display.disconnect(this._focus);
        this._focus = 0;
        if (this._timeout) GLib.Source.remove(this._timeout);
        this._timeout = 0;
        if (this._delay) GLib.Source.remove(this._delay);
        this._delay = 0;
    }
    destroy() {
        this._cancel();
        this._keyboard = null;
    }
}
