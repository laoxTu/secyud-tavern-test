import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Preset } from '@/presets';
import type { Style } from '@/presets/styles';
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

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./entries.json')).default);
}

async function createRealm(entries: unknown[]): Promise<Realm> {
  const preset = structuredClone((await import('../preset.json')).default);
  const realm = structuredClone(
    (await import('../../stories/realm.json')).default,
  );

  return {
    ...realm,
    properties: {},
    presets: [
      { ...preset, entries: { styles: entries } } as unknown as Preset,
    ],
  } as unknown as Realm;
}

/** 已注入到 iframe head 的元素 id（按注入顺序） */
function injectedIds(iframe: HTMLIFrameElement) {
  return Array.from(iframe.contentDocument!.head.children).map((u) => u.id);
}

describe('style_realm / 过滤、排序与去重', () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    iframe = document.createElement('iframe');
    realms.iframe = iframe;
    document.body.appendChild(iframe);
  });

  afterEach(() => {
    iframe.remove();
  });

  it('disabled 的样式不应被注入', async () => {
    const data = await loadData();
    const realm = await createRealm(data.enabledOnly);
    const cache = await styles.renderer.init({ realm });

    await styles.renderer.output!(
      { history: null!, converts: [], realm },
      cache,
    );

    expect(injectedIds(iframe)).toEqual(['stl-on']);
  });

  it('应当按 priority 升序注入', async () => {
    const data = await loadData();
    const realm = await createRealm(data.ordered);
    const cache = await styles.renderer.init({ realm });

    expect(cache.entries.map((u: Style) => u.code)).toEqual([
      'first',
      'middle',
      'later',
    ]);

    await styles.renderer.output!(
      { history: null!, converts: [], realm },
      cache,
    );

    expect(injectedIds(iframe)).toEqual([
      'stl-first',
      'stl-middle',
      'stl-later',
    ]);
  });

  it('重复 output 不应重复注入（初始化守卫）', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);
    const cache = await styles.renderer.init({ realm });

    await styles.renderer.output!(
      { history: null!, converts: [], realm },
      cache,
    );
    await styles.renderer.output!(
      { history: null!, converts: [], realm },
      cache,
    );

    expect(injectedIds(iframe)).toEqual(['stl-a']);
  });

  it('link 类型应当把 content 去空白后写入 href', async () => {
    const data = await loadData();
    const realm = await createRealm(data.link);
    const cache = await styles.renderer.init({ realm });

    await styles.renderer.output!(
      { history: null!, converts: [], realm },
      cache,
    );

    const el = iframe.contentDocument!.getElementById(
      'stl-ext',
    ) as HTMLLinkElement;
    expect(el.localName).toBe('link');
    expect(el.rel).toBe('stylesheet');
    expect(el.href).toBe(data.link[0].content.trim());
  });

  it('CSS 类型应当以内联 style 注入内容', async () => {
    const data = await loadData();
    const realm = await createRealm(data.css);
    const cache = await styles.renderer.init({ realm });

    await styles.renderer.output!(
      { history: null!, converts: [], realm },
      cache,
    );

    const el = iframe.contentDocument!.getElementById(
      'stl-css',
    ) as HTMLStyleElement;
    expect(el.localName).toBe('style');
    expect(el.innerHTML).toBe(data.css[0].content);
  });
});
