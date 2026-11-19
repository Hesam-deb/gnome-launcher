import Gio from 'gi://Gio';

const PATH = '/io/github/gnomelauncher/Shell';
const IFACE = `<node>
  <interface name="io.github.gnomelauncher.Shell">
    <method name="ShowHud">
      <arg type="s" direction="in" name="text"/>
      <arg type="s" direction="in" name="icon"/>
    </method>
    <method name="Paste">
      <arg type="s" direction="in" name="text"/>
    </method>
    <method name="SetClipboardItemPinned">
      <arg type="s" direction="in" name="id"/>
      <arg type="b" direction="in" name="pinned"/>
    </method>
    <method name="DeleteClipboardItem">
      <arg type="s" direction="in" name="id"/>
    </method>
    <method name="ClearClipboardHistory"/>
  </interface>
</node>`;
const MAX_TEXT = 100_000;

/**
 * Lumen's methods on the Shell's own bus name, so nothing else needs to run.
 * The launcher calls ShowHud and Paste after it closes; the Clipboard History
 * extension edits the history, which only the Shell writes. Clipboard methods
 * reply once the file is written, so a caller can read it straight back.
 */
export function exportService({hud, paster, history}) {
    const later = (promise, invocation) => promise.then(
        () => invocation.return_value(null),
        error => invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, String(error?.message ?? error)));
    const service = Gio.DBusExportedObject.wrapJSObject(IFACE, {
        ShowHud: (text, icon) => hud.show(text, icon),
        Paste: text => paster.paste(String(text).slice(0, MAX_TEXT)),
        SetClipboardItemPinnedAsync: ([id, pinned], invocation) => later(history.setPinned(id, pinned), invocation),
        DeleteClipboardItemAsync: ([id], invocation) => later(history.remove(id), invocation),
        ClearClipboardHistoryAsync: (_parameters, invocation) => later(history.clear(), invocation),
    });
    service.export(Gio.DBus.session, PATH);
    return service;
}
