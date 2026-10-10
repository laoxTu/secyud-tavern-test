import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/presets';
import type { Script } from '@/presets/scripts';
import { scripts } from '@/presets/scripts/client';
import type { Realm, RealmHistory } from '@/stories';
import { realms } from '@/stories/client/realms';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./entries.json')).default);
}

const HISTORY = null! as RealmHistory;

async function createRealm(entries: unknown[]): Promise<Realm> {
  const preset = structuredClone((await import('../preset.json')).default);
  const realm = structuredClone(
    (await import('../../stories/realm.json')).default,
  );

  return {
    ...realm,
    properties: {},
    presets: [
      { ...preset, entries: { scripts: entries } } as unknown as Preset,
    ],
  } as unknown as Realm;
}

/** output 只用到 cache，这里给一个最小上下文 */
function createContext(realm: Realm) {
  return { realm, history: HISTORY, converts: [] };
}

/**
 * iframe 里的 script.src 在 jsdom 下不会触发 onload，
 * link 类型需要伪造一个同步触发 onload 的 document。
 */
function createFakeFrame() {
  const elements: any[] = [];
  const head: any[] = [];
  const body: any[] = [];
  const document = {
    createElement(tag: string) {
      const el: any = {
        tagName: tag.toUpperCase(),
        id: '',
        type: '',
        src: '',
        async: false,
        textContent: '',
        innerHTML: '',
      };
      elements.push(el);
      return el;
    },
    head: {
      appendChild(el: any) {
        head.push(el);
      },
    },
    body: {
      appendChild(el: any) {
        body.push(el);
        // 模拟资源加载完成，让 output 里 await 的 Promise 结束
        el.onload?.();
      },
    },
    getElementById(id: string) {
      return elements.find((u) => u.id === id) ?? null;
    },
  };
  const contentWindow: any = {};
  return {
    frame: {
      contentWindow,
      contentDocument: document,
    } as unknown as HTMLIFrameElement,
    elements,
    head,
    body,
    contentWindow,
  };
}

describe('scripts / init', () => {
  it('应当按 priority 升序排列', async () => {
    const data = await loadData();
    const realm = await createRealm(data.ordered);

    const cache = await scripts.renderer.init({ realm });

    expect(cache.entries.map((u: Script) => u.code)).toEqual([
      'first',
      'middle',
      'later',
    ]);
  });

  it('disabled 的脚本不应进入缓存', async () => {
    const data = await loadData();
    const realm = await createRealm(data.enabledOnly);

    const cache = await scripts.renderer.init({ realm });

    expect(cache.entries.map((u: Script) => u.code)).toEqual(['on']);
  });

  it('多个 importmap 应当合并，后者覆盖同名键', async () => {
    const data = await loadData();
    const realm = await createRealm(data.importmap);

    const cache = await scripts.renderer.init({ realm });

    expect(cache.entries).toHaveLength(0);
    expect(JSON.parse(cache.importMap)).toEqual({ a: '1', b: '3', c: '4' });
  });

  it('非法 JSON 的 importmap 应当被忽略且不影响其它脚本', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await loadData();
    const realm = await createRealm(data.badImportmap);

    const cache = await scripts.renderer.init({ realm });

    expect(error).toHaveBeenCalled();
    expect(cache.entries.map((u: Script) => u.code)).toEqual(['ok']);
    expect(cache.importMap).toBe('{}');
    error.mockRestore();
  });

  it('没有 importmap 时应当是空对象字面量', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);

    const cache = await scripts.renderer.init({ realm });

    expect(cache.importMap).toBe('{}');
  });
});

describe('scripts / output（内联与 importmap）', () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    iframe = document.createElement('iframe');
    realms.iframe = iframe;
    document.body.appendChild(iframe);
  });

  afterEach(() => {
    iframe.remove();
  });

  it('内联脚本应当以 id = sct-{code} 注入 iframe 的 body', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);
    const cache = await scripts.renderer.init({ realm });

    await scripts.renderer.output!(createContext(realm), cache);

    const document0 = iframe.contentDocument!;
    const el = document0.getElementById('sct-a') as HTMLScriptElement;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe(data.single[0].content);
    expect(el.type).toBe(data.single[0].type);
    expect(el.async).toBe(false);
  });

  it('重复 output 不应重复注入（初始化守卫）', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);
    const cache = await scripts.renderer.init({ realm });

    await scripts.renderer.output!(createContext(realm), cache);
    await scripts.renderer.output!(createContext(realm), cache);

    expect(iframe.contentDocument!.querySelectorAll('script')).toHaveLength(1);
  });

  it('有 importmap 时应当注入 importmap 脚本到 head', async () => {
    const data = await loadData();
    const realm = await createRealm(data.importmapOnly);
    const cache = await scripts.renderer.init({ realm });

    await scripts.renderer.output!(createContext(realm), cache);

    const el = iframe.contentDocument!.getElementById(
      'sct-import-map',
    ) as HTMLScriptElement;
    expect(el).not.toBeNull();
    expect(el.localName).toBe('script');
    expect(el.type).toBe('importmap');
    expect(el.innerHTML).toBe(data.importmapOnly[0].content);
  });

  it('没有 importmap 时不应注入 importmap 脚本', async () => {
    const data = await loadData();
    const realm = await createRealm(data.single);
    const cache = await scripts.renderer.init({ realm });

    await scripts.renderer.output!(createContext(realm), cache);

    expect(
      iframe.contentDocument!.getElementById('sct-import-map'),
    ).toBeNull();
  });
});

describe('scripts / output（link 类型）', () => {
  it('link 类型应当设置 trim 后的 src、async 为 true，并等待 onload', async () => {
    const fake = createFakeFrame();
    realms.iframe = fake.frame;
    const data = await loadData();
    const realm = await createRealm(data.link);
    const cache = await scripts.renderer.init({ realm });

    await scripts.renderer.output!(createContext(realm), cache);

    expect(fake.body).toHaveLength(1);
    expect(fake.body[0].id).toBe('sct-ext');
    expect(fake.body[0].src).toBe(data.link[0].content.trim());
    expect(fake.body[0].async).toBe(true);
  });
});
