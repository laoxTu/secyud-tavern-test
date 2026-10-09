import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Lorebook } from '@/lorebooks';
import { lorebooks, type MatchContext, type Matcher } from '@/lorebooks/client';
import type { PresetItem } from '@/presets';
import type { RealmHistory } from '@/stories';

// analyze 会往 message 上写属性，这里统一造一个最小上下文
function createContext(overrides: Record<string, any> = {}): MatchContext {
  return {
    properties: {},
    output: false,
    message: {},
    history: null,
    cache: { before: [], after: [], entries: {}, rag: null },
    ...overrides,
  } as unknown as MatchContext;
}

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./matcher.cases.json')).default);
}

const registered: string[] = [];

function registerMatcher(id: string, result: boolean) {
  const matcher: Matcher = { id, match: vi.fn(async () => result) };
  lorebooks.matchers.registry.register(matcher);
  registered.push(id);
  return matcher;
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const id of registered.splice(0)) {
    lorebooks.matchers.registry.unregister(id);
  }
});

describe('lorebooks matcher / content', () => {
  it('输出消息应当拼接正文与工具调用结果', async () => {
    const { content } = await loadCases();
    const data = content.outputWithCallings;

    expect(
      lorebooks.matchers.content(
        createContext({ output: true, message: data.message }),
      ),
    ).toBe(data.expected);
  });

  it('输出消息没有工具调用时只取正文', async () => {
    const { content } = await loadCases();

    for (const key of ['outputWithoutCallings', 'outputWithEmptyCallingResult']) {
      const data = content[key];
      const properties = structuredClone(data.properties);

      expect(
        lorebooks.matchers.content(
          createContext({ output: true, message: data.message, properties }),
        ),
      ).toBe(data.expected);
    }
  });

  it('提示词消息应当忽略工具调用结果', async () => {
    const { content } = await loadCases();
    const data = content.promptIgnoresCallings;

    expect(
      lorebooks.matchers.content(
        createContext({ output: false, message: data.message }),
      ),
    ).toBe(data.expected);
  });

  it('正文缺失时应当返回空串', async () => {
    const { content } = await loadCases();
    const data = content.promptWithoutContent;

    expect(
      lorebooks.matchers.content(
        createContext({ output: false, message: data.message }),
      ),
    ).toBe(data.expected);
  });

  it('已有缓存时直接返回缓存，不重新拼接', async () => {
    const { content } = await loadCases();
    const data = content.cached;

    expect(
      lorebooks.matchers.content(
        createContext({
          output: true,
          message: data.message,
          properties: structuredClone(data.properties),
        }),
      ),
    ).toBe(data.expected);
  });

  it('缓存为空串时视为已计算，不再回退到正文', async () => {
    const { content } = await loadCases();
    const data = content.cachedEmpty;

    expect(
      lorebooks.matchers.content(
        createContext({
          output: true,
          message: data.message,
          properties: structuredClone(data.properties),
        }),
      ),
    ).toBe(data.expected);
  });

  it('计算结果应当写回 properties 供后续复用', async () => {
    const { content } = await loadCases();
    const data = content.outputWithCallings;
    const context = createContext({ output: true, message: data.message });

    lorebooks.matchers.content(context);

    expect(context.properties['content']).toBe(data.expected);
  });
});

describe('lorebooks matcher / variables', () => {
  it('没有缓存时应当从历史推导变量', async () => {
    const { variables } = await loadCases();
    const history = variables.history as unknown as RealmHistory;

    expect(
      lorebooks.matchers.variables(
        createContext({ history, output: true, properties: {} }),
      ),
    ).toEqual(variables.withOutput);
  });

  it('提示词阶段不应用输出带来的变量变更', async () => {
    const { variables } = await loadCases();
    const history = variables.history as unknown as RealmHistory;

    expect(
      lorebooks.matchers.variables(
        createContext({ history, output: false, properties: {} }),
      ),
    ).toEqual(variables.withoutOutput);
  });

  it('已有缓存时直接返回缓存对象', async () => {
    const { variables } = await loadCases();
    const data = variables.cached;
    const properties = structuredClone(data.properties);
    const context = createContext({ properties });

    const result = lorebooks.matchers.variables(context);

    expect(result).toBe(properties['variables']);
    expect(result).toEqual(data.expected);
  });

  it('推导结果应当写回 properties', async () => {
    const { variables } = await loadCases();
    const context = createContext({
      history: variables.history,
      output: false,
      properties: {},
    });

    const result = lorebooks.matchers.variables(context);

    expect(context.properties['variables']).toBe(result);
  });
});

describe('lorebooks matcher / analyze', () => {
  it('只收集匹配成功的条目，并按条目顺序返回', async () => {
    const { analyze } = await loadCases();
    const items = analyze.items as Record<string, PresetItem<Lorebook>>;
    registerMatcher('yes', true);
    registerMatcher('no', false);

    const context = createContext();
    const active = await lorebooks.matchers.analyze(items, context);

    expect(active).toEqual(analyze.expected);
  });

  it('匹配结果应当写到 message 的 lorebooks 属性上', async () => {
    const { analyze } = await loadCases();
    const items = analyze.items as Record<string, PresetItem<Lorebook>>;
    registerMatcher('yes', true);
    registerMatcher('no', false);
    const message = { content: 'x', variables: [] };

    await lorebooks.matchers.analyze(items, createContext({ message }));

    expect(message).toHaveProperty('properties.lorebooks', analyze.expected);
  });

  it('未注册的 match 类型应当被跳过而不是抛错', async () => {
    const { analyze } = await loadCases();
    const items = analyze.items as Record<string, PresetItem<Lorebook>>;
    // 一个匹配器都不注册，所有条目都取不到 match 实现
    const active = await lorebooks.matchers.analyze(items, createContext());

    expect(active).toEqual([]);
    expect(lorebooks.matchers.registry.record('missing')).toBeNull();
  });

  it('匹配器应当收到当前上下文与对应条目', async () => {
    const { analyze } = await loadCases();
    const items = analyze.items as Record<string, PresetItem<Lorebook>>;
    const matcher = registerMatcher('yes', true);
    const context = createContext();

    await lorebooks.matchers.analyze({ first: items.first }, context);

    expect(matcher.match).toHaveBeenCalledTimes(1);
    expect(matcher.match).toHaveBeenCalledWith(context, items.first);
  });

  it('没有条目时应当返回空数组', async () => {
    const active = await lorebooks.matchers.analyze({}, createContext());

    expect(active).toEqual([]);
  });
});
