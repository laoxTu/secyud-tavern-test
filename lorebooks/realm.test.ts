import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Lorebook } from '@/lorebooks';
import { lorebooks } from '@/lorebooks/client';
import { normalMatcher } from '@/lorebooks/client/matchers/normal';
import { rags, useRagState } from '@/memories/client/rag';
import type {
  ModelInjectContext,
  ModelPromptContext,
} from '@/models/client';
import type { Preset, PresetItem } from '@/presets';
import type { Realm, RealmHistory } from '@/stories';
import { tools } from '@/tools';

// 持久化会走设置接口，这里整体替换掉，避免用例里出现真实请求
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./realm.cases.json')).default);
}

async function createRealm(entries: unknown[]): Promise<Realm> {
  const preset = structuredClone(
    (await import('../presets/preset.json')).default,
  );

  return {
    ...structuredClone((await import('../stories/realm.json')).default),
    properties: {},
    presets: [
      { ...preset, entries: { lorebooks: entries } } as unknown as Preset,
    ],
  } as unknown as Realm;
}

/** 造一个只记录调用的注入上下文 */
function createInjectContext(builder = 'default') {
  const spies = {
    prompt: vi.fn(),
    assist: vi.fn(),
    system: vi.fn(),
    caller: vi.fn(),
  };
  const context = {
    builder,
    name: (index: number) => `t${index}`,
    ...spies,
  } as unknown as ModelInjectContext;
  return { context, ...spies };
}

/** 走一遍 prompt → 取出注入器 → 展开为可驱动的 InjectMessage */
async function injectWith(
  realm: Realm,
  cache: any,
  histories: RealmHistory[],
  builder = 'default',
) {
  const ctx = {
    realm,
    properties: {},
    histories,
    history: histories.at(-1),
    current: false,
    converts: [],
    injects: [],
    controller: new AbortController(),
  } as unknown as ModelPromptContext;

  await lorebooks.processer.prompt!(ctx, cache);
  const spies = createInjectContext(builder);
  const message = await ctx.injects[0](spies.context);
  return { message, spies };
}

/** 条目 id 的约定是「预设 id-条目 code」，用例里从 realm 派生，避免两处手写 */
function entryIds(realm: Realm, codes: string[]) {
  return codes.map((code) => `${realm.presets[0].id}-${code}`);
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rags.registry.unregister('fake');
  useRagState.setState({ embedder: { type: 'transformers', config: {} } });
});

describe('lorebooks / processer 常量', () => {
  it('id 应当与模块名一致，并声明依赖工具模块', () => {
    expect(lorebooks.processer.id).toBe(lorebooks.name);
    expect(lorebooks.processer.requires).toContain(tools.name);
  });
});

describe('lorebooks processer / init', () => {
  it('应当按 match 把条目分到 before / after / entries', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);

    const cache = await lorebooks.processer.init({ properties: {}, realm });

    expect(
      cache.before.map((u: PresetItem<Lorebook>) => u.code),
    ).toEqual(data.expected.before);
    expect(
      cache.after.map((u: PresetItem<Lorebook>) => u.code),
    ).toEqual(data.expected.after);
    expect(
      Object.values(cache.entries as Record<string, PresetItem<Lorebook>>)
        .map((u) => u.code)
        .sort(),
    ).toEqual(data.expected.entryCodes);
  });

  it('条目 id 应当带上预设 id 前缀', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);

    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const entries = Object.values(cache.entries) as any[];

    expect(entries).toHaveLength(data.expected.entryCodes.length);
    for (const entry of entries) {
      expect(entry.id).toBe(entryIds(realm, [entry.code])[0]);
      expect(Object.keys(cache.entries)).toContain(entry.id);
    }
  });

  it('disabled 的条目不应进入任何桶', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);

    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const codes = [
      ...cache.before.map((u: PresetItem<Lorebook>) => u.code),
      ...cache.after.map((u: PresetItem<Lorebook>) => u.code),
      ...Object.values(
        cache.entries as Record<string, PresetItem<Lorebook>>,
      ).map((u) => u.code),
    ];

    expect(codes).not.toContain('off');
    expect(codes).not.toContain('offnorm');
  });

  it('json 类型的 content 应当被压缩', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);

    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const entry = cache.before.find(
      (u: PresetItem<Lorebook>) => u.code === 'json',
    )!;

    expect(entry.content).toBe(data.expected.jsonContent);
  });

  it('未注册 embedder 时 rag 应当为 null 且不建立向量', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);

    const cache = await lorebooks.processer.init({ properties: {}, realm });

    expect(cache.rag).toBeNull();
  });

  it('启用 RAG 时应当为向量类型的条目生成嵌入', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);
    const generate = vi.fn(async () => [1, 0, 0]);
    rags.registry.register({
      id: 'fake',
      component: (() => null) as any,
      configure: () => ({}),
      embed: async () => ({ dimension: 3, generate }),
    } as any);
    useRagState.setState({ embedder: { type: 'fake', config: {} } });

    const cache = await lorebooks.processer.init({ properties: {}, realm });

    expect(cache.rag).not.toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({ content: '向量内容' });
  });
});

describe('lorebooks processer / prompt', () => {
  it('应当把注入器挂到 ctx.injects 上', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const ctx = {
      realm,
      properties: {},
      histories: [structuredClone(data.history)],
      history: structuredClone(data.history),
      current: false,
      converts: [],
      injects: [],
      controller: new AbortController(),
    } as unknown as ModelPromptContext;

    await lorebooks.processer.prompt!(ctx, cache);

    expect(ctx.injects).toHaveLength(1);
    expect(typeof ctx.injects[0]).toBe('function');
  });
});

describe('lorebooks processer / output', () => {
  it('应当给每条输出消息分析出命中的条目', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const history = structuredClone(data.outputHistory) as RealmHistory;
    lorebooks.matchers.registry.register(normalMatcher);
    try {
      await lorebooks.processer.output!({ properties: {}, realm, history }, cache);
    } finally {
      lorebooks.matchers.registry.unregister(normalMatcher.id);
    }

    const messages = history.outputs[0];

    expect(messages.map((u) => u.properties?.lorebooks)).toEqual(
      data.outputExpected.map((codes: string[]) => entryIds(realm, codes)),
    );
  });
});

describe('lorebooks processer / 默认构造器的注入', () => {
  it('常驻条目应当按 role 注入到对应通道', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const { message, spies } = await injectWith(realm, cache, [
      structuredClone(data.history),
    ]);

    await message.before!(0);
    await message.middle!(0);

    expect(spies.system).toHaveBeenCalledWith(data.expected.systemContent);
    expect(spies.prompt).toHaveBeenCalledWith(data.expected.promptContent);
    expect(spies.assist).not.toHaveBeenCalled();
  });

  it('knowledge 条目应当走工具调用通道', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const { message, spies } = await injectWith(realm, cache, [
      structuredClone(data.history),
    ]);

    await message.before!(0);
    await message.middle!(0);

    expect(spies.caller).toHaveBeenCalledTimes(1);
    const [content, output, callings] = spies.caller.mock.calls[0];
    expect(content).toBe('');
    expect(output).toBeNull();
    expect(callings).toEqual([
      {
        index: 0,
        id: 't1l',
        name: 'get_knowledge',
        arguments: data.expected.knowledgeArgs,
        result: data.expected.knowledgeResult,
      },
    ]);
  });

  it('layer 小于 100 的条目在 user 之前注入，其余在 user 之后', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const { message, spies } = await injectWith(realm, cache, [
      structuredClone(data.history),
    ]);

    await message.before!(0);
    expect(spies.system).toHaveBeenCalledWith(data.expected.systemContent);
    expect(spies.prompt).not.toHaveBeenCalled();

    await message.middle!(0);
    expect(spies.prompt).toHaveBeenCalledWith(data.expected.promptContent);
  });

  it('绑定宏已被消费时该条目不再注入', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.macro);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    realm.properties!.macro = { checkItems: { gear: true }, selections: {} };

    const { message, spies } = await injectWith(realm, cache, [
      structuredClone(data.history),
    ]);
    await message.before!(0);
    await message.middle!(0);

    expect(spies.assist).toHaveBeenCalledTimes(1);
    expect(spies.assist).toHaveBeenCalledWith(
      data.expected.otherMacroContent,
      null,
    );
  });

  it('同角色相邻条目应当合并成一次注入', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.macro);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const { message, spies } = await injectWith(realm, cache, [
      structuredClone(data.history),
    ]);

    await message.before!(0);
    await message.middle!(0);

    expect(spies.assist).toHaveBeenCalledTimes(1);
    expect(spies.assist).toHaveBeenCalledWith(data.expected.assistJoined, null);
  });

  it('非最后一段历史的 behind 应当收集输出中的条目', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.outputHistory) as RealmHistory,
      structuredClone(data.history) as RealmHistory,
    ];
    lorebooks.matchers.registry.register(normalMatcher);
    try {
      const { message } = await injectWith(realm, cache, histories);

      await message.behind!(0);
    } finally {
      lorebooks.matchers.registry.unregister(normalMatcher.id);
    }

    expect(histories[0].outputs[0][0].properties?.lorebooks).toEqual(
      entryIds(realm, data.outputExpected[0]),
    );
  });

  it('最后一段历史的 behind 不应当做事', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.all);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const { message } = await injectWith(realm, cache, [
      structuredClone(data.history),
    ]);

    await expect(message.behind!(0)).resolves.toBeUndefined();
  });
});

describe('lorebooks processer / layered 构造器', () => {
  it('只提供 middle 注入点', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.layered);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.history),
      structuredClone(data.history),
      structuredClone(data.history),
    ] as RealmHistory[];
    const { message } = await injectWith(realm, cache, histories, 'layered');

    expect(message.before).toBeUndefined();
    expect(message.behind).toBeUndefined();
    expect(typeof message.middle).toBe('function');
  });

  it('第一段历史应当只注入层号靠前的条目', async () => {
    const data = await loadCases();
    const realm = await createRealm(data.entries.layered);
    const cache = await lorebooks.processer.init({ properties: {}, realm });
    const histories = [
      structuredClone(data.history),
      structuredClone(data.history),
      structuredClone(data.history),
    ] as RealmHistory[];
    const { message, spies } = await injectWith(
      realm,
      cache,
      histories,
      'layered',
    );

    await message.middle!(0);

    expect(spies.system).toHaveBeenCalledWith(data.expected.layeredInjected);
  });
});
