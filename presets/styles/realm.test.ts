import { beforeEach, describe, it } from 'vitest';

import { Preset } from '@/presets';
import { styles } from '@/presets/styles/client';
import { Realm } from '@/stories';
import { realms } from '@/stories/client/realms';

describe('style_realm', () => {
  let realm: Realm = null!;
  let preset: Preset = null!;
  let iframe: HTMLIFrameElement = null!;
  beforeEach(async () => {
    iframe = document.createElement('iframe');
    realms.iframe = iframe;
    document.body.appendChild(iframe);
    preset = (await import('../preset.json')).default;
    realm = (await import('../../stories/realm.json')).default;
    realm.presets.push(preset);
  });

  it('初始化返回缓存', async () => {
    const style = (await import('./test_01.json')).default;
    preset.entries!.styles = [style];
    const cache = await styles.renderer.init({ realm });
    expect(cache).toEqual({ entries: [style] });
  });

  it('CSS类型样式直接文本注入', async () => {
    const style = (await import('./test_01.json')).default;
    preset.entries!.styles = [style];
    const cache = await styles.renderer.init({ realm });
    await styles.renderer.output!(
      {
        history: null!,
        converts: [],
        realm,
      },
      cache,
    );
    const el = iframe.contentDocument?.getElementById('stl-test_css');
    console.debug(el);
    expect(el?.localName).toBe('style');
    expect(el).not.toBeNull();
  });

  it('Link类型以链接注入', async () => {
    const style = (await import('./test_02.json')).default;
    preset.entries!.styles = [style];
    const cache = await styles.renderer.init({ realm });
    await styles.renderer.output!(
      {
        history: null!,
        converts: [],
        realm,
      },
      cache,
    );
    const el = iframe.contentDocument?.getElementById('stl-test_link');
    console.debug(el);
    expect(el?.localName).toBe('link');
    expect(el).not.toBeNull();
  });
});
