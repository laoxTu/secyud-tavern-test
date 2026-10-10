import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '@/interceptors';
import type { Preset } from '@/presets';
import type { Realm } from '@/stories';
import { tools } from '@/tools/client';
import type { ToolItem, ToolProvider } from '@/tools/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./realm.cases.json')).default);
}

async function createRealm(entries?: unknown[]): Promise<Realm> {
  const preset = structuredClone(
    (await import('../../presets/preset.json')).default,
  );

  return {
    ...structuredClone((await import('../../stories/realm.json')).default),
    properties: {},
    presets: [
      {
        ...preset,
        id: 'p',
        entries: entries ? { tools: entries } : {},
      } as unknown as Preset,
    ],
  } as unknown as Realm;
}

/** 造一个只关心编排的假 provider，工具方法在 init 里不会被调用 */
function createProvider(
  id: string,
  items: { name: string; description: string }[] = [],
  create?: (entry: unknown, realm: Realm) => Promise<ToolItem[]>,
) {
  const provider = {
    id,
    create:
      create ??
      vi.fn(async () =>
        items.map((u) => ({
          ...u,
          parameters: { type: 'object' },
          invoke: vi.fn(async () => ''),
        })),
      ),
  } as unknown as ToolProvider;

  tools.providers.registry.register(provider);
  registered.push(id);
  return provider;
}

const registered: string[] = [];

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  // 先退注册再还原 console，避免 debug 噪声
  for (const id of registered.splice(0)) {
    tools.providers.registry.unregister(id);
  }
  vi.restoreAllMocks();
});

describe('tools client realm / init', () => {
  it('processer 的 id 应当与模块名一致，缓存键才对得上', () => {
    // processers.initialize 按 id 写 realm.context['model.<id>']，tools.cache 按 name 读
    expect(tools.processer.id).toBe(tools.name);
  });

  it('应当按条目的 type 找 provider，并把工具按名字放进缓存', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.two);
    const alpha = createProvider('alpha', data.tools.alpha);
    const beta = createProvider('beta', data.tools.beta);

    const cache = await tools.processer.init({ properties: {}, realm });

    expect(alpha.create).toHaveBeenCalledTimes(1);
    expect(alpha.create).toHaveBeenCalledWith(data.entries.two[0], realm);
    expect(beta.create).toHaveBeenCalledWith(data.entries.two[1], realm);
    expect(Object.keys(cache.tools).sort()).toEqual(data.expected.twoNames);
    expect(cache.tools[data.tools.alpha[0].name]).toMatchObject({
      name: data.tools.alpha[0].name,
      description: data.tools.alpha[0].description,
    });
    expect(typeof cache.tools[data.tools.alpha[0].name].invoke).toBe('function');
  });

  it('预设没有工具条目时应当返回空缓存', async () => {
    const realm = await createRealm();

    const cache = await tools.processer.init({ properties: {}, realm });

    expect(cache).toEqual({ tools: {} });
  });

  it('条目没有 type 时应当跳过，不调用任何 provider', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.noType);
    const alpha = createProvider('alpha', data.tools.alpha);

    const cache = await tools.processer.init({ properties: {}, realm });

    expect(alpha.create).not.toHaveBeenCalled();
    expect(cache.tools).toEqual({});
  });

  it('provider 未注册时应当 warn 并跳过该条目', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.unknownType);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const type = data.entries.unknownType[0].type;

    const cache = await tools.processer.init({ properties: {}, realm });

    expect(warn).toHaveBeenCalledWith(`[tool]: provider missing(${type})`);
    expect(cache.tools).toEqual({});
  });

  it('provider.create 抛错时应当包成带条目名的 BusinessError', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.single);
    const inner = new Error('boom');
    createProvider('alpha', [], async () => {
      throw inner;
    });

    const err = await tools.processer
      .init({ properties: {}, realm })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BusinessError);
    expect(err.code).toBe('tool.create_failed');
    expect(err.data.entry).toBe(data.entries.single[0].name);
    expect(err.innerError).toBe(inner);
  });
});

describe('tools client realm / disabled 与宏绑定', () => {
  it('未选择时 disabled 应当取条目上的默认值', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.disabled);
    createProvider('alpha', data.tools.alpha);

    const cache = await tools.processer.init({ properties: {}, realm });
    const name = data.tools.alpha[0].name;

    expect(Object.keys(cache.tools)).toEqual(data.expected.singleNames);
    expect(cache.tools[name].disabled).toBe(true);
  });

  it('items 里的选择应当覆盖条目默认值，并且可以写回', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.disabled);
    createProvider('alpha', data.tools.alpha);
    const cache = await tools.processer.init({ properties: {}, realm });
    const name = data.tools.alpha[0].name;

    realm.properties!.tool.items[name] = false;
    expect(cache.tools[name].disabled).toBe(false);

    cache.tools[name].disabled = true;
    expect(realm.properties!.tool.items[name]).toBe(true);
  });

  it('绑定宏的条目应当读写 checkItems 而不动 items', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.macro);
    createProvider('alpha', data.tools.alpha);
    const cache = await tools.processer.init({ properties: {}, realm });
    const name = data.tools.alpha[0].name;
    const macro = data.entries.macro[0].macro;

    // 宏还没被消费，回落到条目默认值
    expect(cache.tools[name].disabled).toBe(false);

    cache.tools[name].disabled = true;

    expect(realm.properties!.macro.checkItems[macro]).toBe(true);
    expect(cache.tools[name].disabled).toBe(true);
    expect(realm.properties!.tool.items).not.toHaveProperty(name);
  });
});
