import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ cache: vi.fn() }));

vi.mock('@/models/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return { ...actual, models: { ...actual.models, cache: mocks.cache } };
});

import { tools } from '@/tools/client';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

function createRealm() {
  return { id: 'realm-1' } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tools client barrel / 组成', () => {
  it('应当在主模块之上补上各类入口', () => {
    expect(tools.name).toBe('tool');
    expect(tools.plural).toBe('tools');
    expect(tools.default).toEqual({ type: 'variable', config: {} });

    for (const key of ['summary', 'cache', 'property', 'actives']) {
      expect(typeof (tools as any)[key], key).toBe('function');
    }
    expect(typeof tools.processer).toBe('object');
    expect(typeof tools.calling).toBe('function');
    expect(tools.providers).toBeTruthy();
    expect(typeof tools.tab.preset).toBe('object');
    expect(tools.feature).toBeTruthy();
  });

  it('cache 应当按主模块的名字取 realm 缓存', () => {
    const realm = createRealm();
    mocks.cache.mockReturnValue({ tools: {} });

    tools.cache(realm);

    expect(mocks.cache).toHaveBeenCalledWith(realm, 'tool');
  });
});

describe('tools client barrel / summary', () => {
  it('应当把每次调用压成一条 tool 摘要', async () => {
    const data = await loadCases();
    const items: any[] = [];

    tools.summary(data.callings as any, items);

    expect(items).toEqual([
      {
        role: `tool: ${data.callings[0].name}`,
        content: `${data.callings[0].id}\narguments: \n${data.callings[0].arguments}\nresponse: \n${data.callings[0].result}`,
      },
      {
        role: `tool: ${data.callings[1].name}`,
        content: `${data.callings[1].id}\narguments: \n${data.callings[1].arguments}\nresponse: \nerror`,
      },
    ]);
  });

  it('没有 result 时用 error 占位（现状）', async () => {
    const data = await loadCases();
    const items: any[] = [];

    tools.summary([{ ...data.callings[0], result: undefined } as any], items);

    expect(items[0].content.endsWith('response: \nerror')).toBe(true);
  });

  it('空调用不写入任何摘要', () => {
    const items: any[] = [{ role: 'user', content: 'hi' }];

    tools.summary([], items);

    expect(items).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('应当追加而不是替换已有摘要', async () => {
    const data = await loadCases();
    const items: any[] = [{ role: 'user', content: 'hi' }];

    tools.summary(data.callings as any, items);

    expect(items).toHaveLength(1 + data.callings.length);
    expect(items[0]).toEqual({ role: 'user', content: 'hi' });
  });
});

describe('tools client barrel / property 与 actives', () => {
  it('property 应当惰性建出 items 容器并复用同一份', () => {
    const realm = createRealm();

    const first = tools.property(realm);
    first.items['a'] = true;
    const second = tools.property(realm);

    expect(first).toEqual({ items: { a: true } });
    expect(second).toBe(first);
  });

  it('actives 应当过滤掉 disabled 的工具', async () => {
    const data = await loadCases();
    const realm = createRealm();
    mocks.cache.mockReturnValue({ tools: data.cache.tools });

    const actives = tools.actives(realm);

    expect(actives.map((u: any) => u.config?.name ?? u.id)).toEqual(
      data.expectedActive,
    );
  });

  it('actives 在没有缓存工具时返回空数组', () => {
    mocks.cache.mockReturnValue({ tools: {} });

    expect(tools.actives(createRealm())).toEqual([]);
  });
});
