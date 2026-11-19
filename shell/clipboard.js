import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {clear, clipboardSettings, ignoredApp, prune, readHistory, record, remove, setPinned, skipMimes, writeHistory} from './clipboard-model.js';

const SAVE_DELAY_MS = 300;
const SHORTCUT = 'toggle-clipboard-history';
const TEXT_MIMES = ['UTF8_STRING', 'STRING', 'TEXT', 'COMPOUND_TEXT'];

/** The app and window class of a window, for ignore lists and paste keys. */
export function describeWindow(window) {
    if (!window) return {};
    const app = Shell.WindowTracker.get_default().get_window_app(window);
    return {
        app: app?.get_id()?.replace(/\.desktop$/, '') ?? '',
        appName: app?.get_name() ?? '',
        wmClass: window.get_wm_class() ?? '',
    };
}

/**
 * Records text copies while Lumen's Clipboard History extension is on. Only the
 * Shell can watch the clipboard on Wayland, so this runs whether or not the
 * launcher is open, and it is the only writer of clipboard-history.json.
 */
export class ClipboardHistory {
    constructor(settings, toggle) {
        this._settings = settings;
        this._toggle = toggle;
        this._counter = 0;
        this._bound = false;
        const data = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-launcher']);
        this._file = Gio.File.new_for_path(GLib.build_filenamev([data, 'clipboard-history.json']));
        this._state = Gio.File.new_for_path(GLib.build_filenamev([data, 'state.json']));
        this._items = readHistory(this._read(this._file));
        // Lumen replaces state.json by renaming a temporary file over it.
        this._monitor = this._state.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitor.connect('changed', () => this._queueReload());
        this._shortcutChanged = settings.connect(`changed::${SHORTCUT}`, () => { this._unbind(); this._reload(); });
        this._selection = global.display.get_selection();
        this._ownerChanged = this._selection.connect('owner-changed', (_selection, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD) this._onCopy();
        });
        this._reload();
    }
    _read(file) {
        try {
            const [, bytes] = file.load_contents(null);
            return new TextDecoder().decode(bytes);
        } catch {
            return '';
        }
    }
    _queueReload() {
        if (this._pending) return;
        this._pending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._pending = 0;
            this._reload();
            return GLib.SOURCE_REMOVE;
        });
    }
    _reload() {
        this._config = clipboardSettings(this._read(this._state));
        if (this._config.enabled) this._bind();
        else this._unbind();
        // A smaller limit or a shorter age applies right away.
        const kept = prune(this._items, this._config, Date.now());
        if (kept.length !== this._items.length) this._replace(kept);
    }
    _bind() {
        if (this._bound) return;
        this._bound = true;
        Main.wm.addKeybinding(SHORTCUT, this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._toggle());
    }
    _unbind() {
        if (!this._bound) return;
        this._bound = false;
        Main.wm.removeKeybinding(SHORTCUT);
    }
    _onCopy() {
        if (!this._config?.enabled) return;
        const mimes = this._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
        if (skipMimes(mimes) || !mimes.some(m => m.startsWith('text/') || TEXT_MIMES.includes(m))) return;
        const source = describeWindow(global.display.focus_window);
        if (ignoredApp(source, this._config.ignored)) return;
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (!this._file || !this._config.enabled) return;
            const id = `${Date.now().toString(36)}${(this._counter++).toString(36)}`;
            const next = record(this._items, {...source, text, id, now: Date.now()}, this._config);
            if (next) this._replace(next);
        });
    }
    _replace(items) {
        this._items = items;
        if (this._saveId) return;
        this._saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            this._saveId = 0;
            this._save();
            return GLib.SOURCE_REMOVE;
        });
    }
    /** Writes now; resolves once the file holds the current items. */
    _save() {
        if (this._saveId) GLib.Source.remove(this._saveId);
        this._saveId = 0;
        const bytes = new GLib.Bytes(new TextEncoder().encode(writeHistory(this._items)));
        // Chain writes so an older one never lands after a newer one.
        this._writing = (this._writing ?? Promise.resolve()).then(() => new Promise(resolve => {
            try { this._file.get_parent().make_directory_with_parents(null); } catch {}
            // PRIVATE: only this user may read what was copied.
            this._file.replace_contents_bytes_async(bytes, null, false,
                Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null, (file, result) => {
                    try { file.replace_contents_finish(result); }
                    catch (error) { console.warn(`Lumen clipboard history: ${error.message}`); }
                    resolve();
                });
        }));
        return this._writing;
    }
    setPinned(id, pinned) {
        this._items = prune(setPinned(this._items, id, pinned), this._config, Date.now());
        return this._save();
    }
    remove(id) {
        this._items = remove(this._items, id);
        return this._save();
    }
    clear() {
        this._items = clear(this._items);
        return this._save();
    }
    destroy() {
        this._unbind();
        if (this._saveId) this._save();
        if (this._pending) GLib.Source.remove(this._pending);
        this._pending = 0;
        this._monitor?.cancel();
        this._monitor = null;
        this._selection.disconnect(this._ownerChanged);
        this._settings.disconnect(this._shortcutChanged);
        this._file = null;
    }
}
