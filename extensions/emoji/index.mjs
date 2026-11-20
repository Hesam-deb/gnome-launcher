import {readFileSync} from 'node:fs';
import {serve, grid, host} from '../../sdk/index.mjs';
import {load, pickerView, remember, withTone} from './lib.mjs';

const data = load(readFileSync(new URL('./emoji.json', import.meta.url), 'utf8'));

/** Lumen's main search records inline picks under the same key (src/emoji.rs). */
async function recent() {
  const list = await host.storage.get('recent');
  return Array.isArray(list) ? list : [];
}

async function view(query, preferences) {
  const {items, options} = pickerView(data, query ?? '', {recent: await recent(), tone: Number(preferences?.skinTone) || 0});
  return grid(items, options);
}

serve({'search-emoji': {
  run: ({query, preferences}) => view(query, preferences),
  action: async ({item, action, query, preferences}) => {
    const entry = data.byGlyph.get(item.slice(2));
    if (!entry) return null;
    const glyph = withTone(entry, Number(preferences?.skinTone) || 0);
    switch (action) {
      case 'primary':
        await host.storage.set('recent', remember(await recent(), entry.e));
        await host.paste(glyph);
        return null;
      case 'copy':
        await host.storage.set('recent', remember(await recent(), entry.e));
        await host.copy(glyph);
        await host.hud(`Copied ${glyph}`);
        return null;
      case 'forget':
        await host.storage.set('recent', (await recent()).filter(g => g !== entry.e));
        return view(query, preferences);
      default:
        return null;
    }
  },
}});
