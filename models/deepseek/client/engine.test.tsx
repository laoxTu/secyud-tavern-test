import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actives: vi.fn(),
  summary: vi.fn(),
  calling: vi.fn(),
  warning: vi.fn(),
}));

// 通知与请求层都替换掉，用例只关心引擎拼出来的输入
vi.mock('sonner', () => ({ toast: { warning: mocks.warning } }));
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));
// 工具集合与工具调用结果与本次输入无关，这里整体替换
vi.mock('@/tools/client', () => ({
  tools: {
    actives: mocks.actives,
    summary: mocks.summary,
    calling: mocks.calling,
  },
}));

import type { Model } from '@/models';
import type {
  InjectHandler,
  ModelPromptContext,
  ModelResultContext,
} from '@/models/client';
import { deepseeks } from '@/models/deepseek/client';
import { openais } from '@/models/openai/client';
import type { Realm, RealmHistory, RealmOutput } from '@/stories';

const engine = deepseeks.engine;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./engine.json')).default);
}

type Data = Awaited<ReturnType<typeof loadData>>;

/** FormData 只能一项一项塞，数据先在 fixture 里排好序 */
function createFormData(entries: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

/** 把 fixture 的 realm 与本用例要用的 properties 拼成 prompt 需要的形状 */
function createRealm(realm: any, properties: any) {
  return { ...realm, properties } as unknown as Realm;
}

/** 驱动 prompt 需要的最小上下文 */
function createContext(
  realm: Realm,
  histories: RealmHistory[],
  injects: InjectHandler[] = [],
) {
  return {
    realm,
    properties: {},
    histories,
    history: histories.at(-1),
    current: false,
    converts: [],
    injects,
    controller: new AbortController(),
  } as unknown as ModelPromptContext;
}

/** 注入器只能是函数，内容仍旧从 fixture 取 */
function createInjectHandler(data: Data): InjectHandler {
  return async (ctx) => {
    ctx.assist(data.inject.assist, null);
    ctx.caller(data.inject.caller, null, data.inject.callings);
    return {};
  };
}

/** tool_calls 的结构由 callings 决定，从 fixture 派生 */
function expectedToolCalls(data: Data) {
  return data.inject.callings.map((u) => ({
    id: u.id,
    type: 'function',
    function: { name: u.name, arguments: u.arguments },
  }));
}

/** 每个调用后面都要跟一条 role 为 tool 的结果消息，没有结果时是 'error' */
function expectedToolMessages(data: Data) {
  return data.inject.callings.map((u) => ({
    role: 'tool',
    tool_call_id: u.id,
    content: u.result ?? 'error',
  }));
}

function toolMessages(messages: any[]) {
  return messages.filter((u) => u.role === 'tool');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('models deepseek client engine / 描述信息', () => {
  it('id 应当与 fixture 的 name 一致', async () => {
    const data = await loadData();

    expect(engine.id).toBe(data.name);
  });
});

describe('models deepseek client engine / configureObject', () => {
  it('勾选 thinking 与 logprobs 时应当按表单写入 option 与 config', async () => {
    const data = await loadData();
    const item: Partial<Model> = {};

    const result = engine.configureObject(
      createFormData(data.configure.checked.entries as [string, string][]),
      item,
    );

    // 返回的是传入的同一个 model 对象
    expect(result).toBe(item);
    expect(item.properties!.config).toEqual(data.configure.checked.config);
    expect(item.properties!.option).toEqual(data.configure.checked.option);
  });

  it('未勾选 thinking 与 logprobs 时应当写成 disabled 与 false', async () => {
    const data = await loadData();
    const item: Partial<Model> = {};

    engine.configureObject(
      createFormData(data.configure.unchecked.entries as [string, string][]),
      item,
    );

    expect(item.properties!.config).toEqual(data.configure.unchecked.config);
    expect(item.properties!.option).toEqual(data.configure.unchecked.option);
    expect(item.properties!.option.thinking.type).toBe('disabled');
    expect(item.properties!.option.logprobs).toBe(false);
  });

  it('只应当写入 config 与 option 两个键', async () => {
    const data = await loadData();
    const item: Partial<Model> = {};

    engine.configureObject(
      createFormData(data.configure.checked.entries as [string, string][]),
      item,
    );

    expect(Object.keys(item.properties!).sort()).toEqual(data.propertyKeys);
  });
});

describe('models deepseek client engine / prompt 消息', () => {
  it('应当按历史顺序把输入与输出整理成 messages 与 summaries', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue(data.tools);
    const realm = createRealm(data.realm, data.realmProperties.disabled);
    const ctx = createContext(realm, [
      data.histories.replied,
      data.histories.pending,
    ]);

    const result = await engine.prompt(ctx);

    expect(result.input.messages).toEqual(data.expected.conversation.disabled);
    expect(result.summaries).toEqual(data.expected.conversation.summaries);
    expect(mocks.actives).toHaveBeenCalledWith(realm);
  });

  it('可用工具应当整理成 function 类型的 tools', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue(data.tools);
    const realm = createRealm(data.realm, data.realmProperties.disabled);
    const ctx = createContext(realm, [data.histories.pending]);

    const result = await engine.prompt(ctx);

    expect(result.input.tools).toEqual(data.pools);
  });

  it('没有可用工具时 tools 应当为 undefined', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue([]);
    const realm = createRealm(data.realm, data.realmProperties.disabled);
    const ctx = createContext(realm, [data.histories.pending]);

    const result = await engine.prompt(ctx);

    expect(result.input.tools).toBeUndefined();
    // 只有一段历史且不是收尾轮次时，只应该有用户输入
    expect(result.input.messages).toEqual(
      data.histories.pending.prompts.map((u) => ({
        role: 'user',
        content: u.content,
      })),
    );
  });

  it('thinking 为 enabled 时 assistant 消息应当带上 reasoning_content', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue(data.tools);
    const realm = createRealm(data.realm, data.realmProperties.enabled);
    const ctx = createContext(realm, [
      data.histories.replied,
      data.histories.pending,
    ]);

    const result = await engine.prompt(ctx);

    expect(result.input.messages).toEqual(data.expected.conversation.enabled);
    expect(result.summaries).toEqual(data.expected.conversation.summaries);
    // reasoning_content 取的是输出里的 thought
    expect(result.input.messages[1]).toMatchObject({
      reasoning_content: data.histories.replied.outputs[0][0].thought,
    });
  });

  it('thinking 为 disabled 时 assistant 消息不应带 reasoning_content', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue(data.tools);
    const realm = createRealm(data.realm, data.realmProperties.disabled);
    const ctx = createContext(realm, [
      data.histories.replied,
      data.histories.pending,
    ]);

    const result = await engine.prompt(ctx);

    expect(result.input.messages[1]).not.toHaveProperty('reasoning_content');
  });
});

describe('models deepseek client engine / prompt 工具调用', () => {
  it('有 callings 时应当生成 tool_calls 与 role 为 tool 的结果消息', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue([]);
    const realm = createRealm(data.realm, data.realmProperties.enabled);
    const output = data.histories.calling.outputs[0][0];
    const ctx = createContext(realm, [
      data.histories.calling,
      data.histories.pending,
    ]);

    const result = await engine.prompt(ctx);

    expect(result.input.messages).toEqual(data.expected.calling.messages);
    // 工具调用的摘要交给 tools.summary 展示
    expect(mocks.summary).toHaveBeenCalledWith(
      output.callings,
      result.summaries,
    );
    // 没有 result 的调用回落到 'error'
    const [, noResult] = output.callings;
    expect(result.input.messages.at(-2)).toEqual({
      role: 'tool',
      tool_call_id: noResult.id,
      content: 'error',
    });
  });

  it('assist 与 caller 没有 output 时 reasoning_content 应当是 user generated calling', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue([]);
    const realm = createRealm(data.realm, data.realmProperties.enabled);
    const ctx = createContext(realm, [], [createInjectHandler(data)]);

    const result = await engine.prompt(ctx);

    expect(result.input.messages).toContainEqual({
      role: 'assistant',
      content: data.inject.assist,
      reasoning_content: data.expected.inject.reasoningContent,
    });
    expect(result.input.messages).toContainEqual({
      role: 'assistant',
      content: data.inject.caller,
      tool_calls: expectedToolCalls(data),
      reasoning_content: data.expected.inject.reasoningContent,
    });
    expect(toolMessages(result.input.messages)).toEqual(
      expectedToolMessages(data),
    );
    expect(result.summaries).toEqual(data.expected.inject.summaries);
    expect(result.input.tools).toBeUndefined();
  });

  it('thinking 为 disabled 时没有 output 也不应带 reasoning_content', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue([]);
    const realm = createRealm(data.realm, data.realmProperties.disabled);
    const ctx = createContext(realm, [], [createInjectHandler(data)]);

    const result = await engine.prompt(ctx);

    expect(result.input.messages.length).toBeGreaterThan(0);
    for (const message of result.input.messages) {
      expect(message).not.toHaveProperty('reasoning_content');
    }
    expect(toolMessages(result.input.messages)).toEqual(
      expectedToolMessages(data),
    );
  });
});

describe('models deepseek client engine / prompt 用量提示', () => {
  it('token 小于等于倒数第二段历史的用量时应当提示超限', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue([]);
    const realm = createRealm(data.realm, data.realmProperties.tinyToken);
    const usage = data.histories.used.outputs[0][0].properties.usage;
    const ctx = createContext(realm, [
      data.histories.used,
      data.histories.pending,
    ]);

    await engine.prompt(ctx);

    // 判定用的是 prompt + output 之和
    expect(data.realmProperties.tinyToken.config.token).toBeLessThanOrEqual(
      usage.prompt + usage.output,
    );
    expect(mocks.warning).toHaveBeenCalledTimes(1);
    expect(mocks.warning).toHaveBeenCalledWith(
      data.toast.message,
      data.toast.options,
    );
  });

  it('用量未超限时不应当提示', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue([]);
    const realm = createRealm(data.realm, data.realmProperties.enabled);
    const usage = data.histories.used.outputs[0][0].properties.usage;
    const ctx = createContext(realm, [
      data.histories.used,
      data.histories.pending,
    ]);

    await engine.prompt(ctx);

    expect(data.realmProperties.enabled.config.token).toBeGreaterThan(
      usage.prompt + usage.output,
    );
    expect(mocks.warning).not.toHaveBeenCalled();
  });

  it('用量取自倒数第二段历史，最后一段的用量不参与判定', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue([]);
    const realm = createRealm(data.realm, data.realmProperties.tinyToken);
    // used 放在最后一段，它的用量足以超限，但判定只看倒数第二段
    const ctx = createContext(realm, [
      data.histories.replied,
      data.histories.used,
    ]);

    await engine.prompt(ctx);

    expect(data.histories.used.outputs[0][0].properties.usage).toBeDefined();
    expect(mocks.warning).not.toHaveBeenCalled();
  });
  it('正文与 tool_calls 应当并进同一条 assistant 消息，不重复发正文', async () => {
    const data = await loadData();
    mocks.actives.mockReturnValue([]);
    const realm = createRealm(data.realm, data.realmProperties.enabled);
    // caller 自带正文且带 callings 时，正文只能出现一次
    const calling = structuredClone(data.histories.calling) as RealmHistory;
    calling.outputs[0][0].content = data.inject.caller;
    const ctx = createContext(realm, [calling, data.histories.pending]);

    const result = await engine.prompt(ctx);

    const assistants = result.input.messages.filter(
      (u: any) => u.role === 'assistant' && u.content === data.inject.caller,
    );
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toHaveProperty('tool_calls');
    expect(toolMessages(result.input.messages)).toEqual(
      toolMessages(
        data.expected.calling.messages.filter((u) => u.role === 'tool'),
      ),
    );
    expect(mocks.summary).toHaveBeenCalledWith(
      calling.outputs[0][0].callings,
      result.summaries,
    );
  });
});

describe('models deepseek client engine / result', () => {
  it('result 应当直接复用 openais.engine.result', () => {
    // 不是同名包装，而是同一个函数引用
    expect(engine.result).toBe(openais.engine.result);
  });

  /**
   * 已知缺陷，用户确认按缺陷保留：
   * openai 的非流式分支只有 output.callings?.push(...)（src/models/openai/client/engine.tsx:463），
   * 没有先 output.callings ??= []；而 output 由 src/models/client/processer.ts:278 创建时并不带 callings，
   * 所以非流式（stream: false）chat 的 tool_calls 会被静默丢弃（流式分支 :425 有 ??= []，正常）。
   * deepseek 的 result 复用了同一实现，同样受影响。
   * src 修好后把 it.fails 改回 it。
   */
  it.fails('非流式 chat 的 tool_calls 应当记录到 output.callings', async () => {
    const data = await loadData();
    const realm = createRealm(data.realm, data.realmProperties.enabled);
    const output: RealmOutput = {
      content: '',
      thought: '',
      variables: [],
      properties: {},
    };
    const ctx = {
      realm,
      properties: {},
      output,
      stream: false,
      message: structuredClone(data.result.message),
      stopped: false,
    } as unknown as ModelResultContext;

    await engine.result(ctx);

    const delta = data.result.message.choices[0].message;
    expect(output.callings).toEqual(
      delta.tool_calls.map((u, i) => ({
        index: i,
        id: u.id,
        name: u.function.name,
        arguments: u.function.arguments,
      })),
    );
  });
});
