import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {serve, list, host} from '../../sdk/index.mjs';
import {historyPath, historyView, readHistory} from './lib.mjs';

const PATH = historyPath(process.env, homedir());

function load() {
  try { return readHistory(readFileSync(PATH, 'utf8')); } catch { return []; }
}

function view(query) {
  const {items, options} = historyView(load(), query, Date.now());
  return list(items, options);
}

/**
 * The Shell owns the history file, so edits go through its D-Bus service. It
 * replies once the file is written, so the next load sees the change.
 * IDs are lowercase letters and digits (checked by readHistory), so quoting is safe.
 */
function shell(method, ...args) {
  return new Promise((resolve, reject) => {
    execFile('gdbus', ['call', '--session', '--dest', 'org.gnome.Shell',
      '--object-path', '/io/github/gnomelauncher/Shell',
      '--method', `io.github.gnomelauncher.Shell.${method}`, ...args], {timeout: 5000}, error => {
      if (error) reject(new Error('GNOME Shell did not answer. Log out and back in once so it loads Lumen.'));
      else resolve();
    });
  });
}

serve({history: {
  run: ({query}) => view(query),
  action: async ({item, action, query}) => {
    const entry = load().find(e => e.id === item);
    if (!entry) return view(query);
    switch (action) {
      case 'primary':
        await host.paste(entry.text);
        return null;
      case 'copy':
        await host.copy(entry.text);
        await host.hud('Copied to Clipboard');
        return null;
      case 'pin':
        await shell('SetClipboardItemPinned', `'${entry.id}'`, String(!entry.pinned));
        await host.toast({style: 'success', title: entry.pinned ? 'Unpinned' : 'Pinned'});
        return view(query);
      case 'delete':
        await shell('DeleteClipboardItem', `'${entry.id}'`);
        await host.toast({style: 'success', title: 'Deleted'});
        return view(query);
      default:
        return null;
    }
  },
}});
