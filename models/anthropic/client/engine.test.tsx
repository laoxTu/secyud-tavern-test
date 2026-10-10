import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '@/interceptors';
import type { Model } from '@/models';
import { engine } from '@/models/anthropic/client/engine';
import type {
  InjectHandler,
  ModelInjectContext,
  ModelPromptContext,
  ModelResultContext,
} from '@/models/client';
import { models } from '@/models/client';
import type { RealmHistory } from '@/stories';
import { jsonUtils } from '@/utils';

const mocks = vi.hoisted(() => ({
  actives: vi.fn(),
  summary: vi.fn(),
  calling: vi.fn(),
  outputs: vi.fn(),
}));

// 工具模块只用来提供启用中的工具、记录调用与摘要，整体替换掉
vi.mock('@/tools/client', () => ({
  tools: {
    actives: mocks.actives,
    summary: mocks.summary,
    calling: mocks.calling,
  },
}));

// 历史输出直接由 fixture 提供，不依赖真实的故事状态
vi.mock('@/stories/client/realms', () => ({
  realms: { outputs: mocks.outputs },
  useRealmState: { getState: () => ({ setRealmInfo: () => {} }) },
}));

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
  return structuredClone((await import('./engine.cases.json')).default);
}

/** 按真实的表单结构构造 FormData */
function createFormData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.append(key, value);
  }
  return data;
}

/** 拼出两段历史：前一段带 ai 输出，后一段是当前输入 */
function createHistories(
  data: any,
  prompts: any[],
  outputs: any[],
): RealmHistory[] {
  return [
    {
      ...structuredClone(data.history.leading),
      prompts: structuredClone(prompts),
      outputs: [structuredClone(outputs)],
    },
    structuredClone(data.history.trailing),
  ] as unknown as RealmHistory[];
}

function createPromptContext(
  data: any,
  histories: RealmHistory[],
  injects: InjectHandler[] = [],
): ModelPromptContext {
  return {
    realm: structuredClone(data.realm),
    properties: {},
    histories,
    history: histories.at(-1)!,
    current: false,
    converts: [],
    injects,
    controller: new AbortController(),
  } as unknown as ModelPromptContext;
}

function createResultContext(
  data: any,
  { stream = false, message = null }: { stream?: boolean; message?: any } = {},
): ModelResultContext {
  return {
    realm: structuredClone(data.realm),
    properties: {},
    output: structuredClone(data.result.output),
    message,
    stream,
    stopped: false,
  } as unknown as ModelResultContext;
}

/** 逐个喂流式事件 */
async function feed(ctx: ModelResultContext, events: any[]) {
  for (const event of events) {
    ctx.message = event;
    await engine.result(ctx);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actives.mockReturnValue([]);
  // history.output 指向当前要注入的输出组，和 realms.outputs 的取法保持一致
  mocks.outputs.mockImplementation((history: any) => {
    if (!history?.outputs?.length) return null;
    const index = Math.min(history.outputs.length - 1, history.output ?? 0);
    return history.outputs[index];
  });
  // 注入流程本身会打不少 debug 日志，用例里不需要这层噪音
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('models anthropic client / configureObject', () => {
  it('应当把模型参数写进 option、连接参数写进 config，并返回同一个对象', async () => {
    const data = await loadCases();
    const model = { id: 'model-1', name: 'claude' } as Partial<Model>;

    const returned = engine.configureObject(createFormData(data.configure.form), model);

    expect(returned).toBe(model);
    expect(model.properties?.[models.names.options]).toEqual(
      data.configure.expectedOption,
    );
    expect(model.properties?.[models.names.config]).toEqual(
      data.configure.expectedConfig,
    );
  });

  it('数字字段应当从表单字符串解析成 number', async () => {
    const data = await loadCases();
    const model = {} as Partial<Model>;

    engine.configureObject(createFormData(data.configure.form), model);

    const options = model.properties?.[models.names.options] as any;
    expect(options.temperature).toBe(data.configure.expectedOption.temperature);
    expect(options.top_p).toBe(data.configure.expectedOption.top_p);
    expect(options.max_tokens).toBe(data.configure.expectedOption.max_tokens);
    expect(typeof options.temperature).toBe('number');
  });

  it('extras 不是合法 json 时应当抛 BusinessError，且不写入 properties', async () => {
    const data = await loadCases();
    const model = {} as Partial<Model>;
    const form = createFormData({
      ...data.configure.form,
      extras: data.configure.invalidExtras.extras,
    });

    let error: any;
    try {
      engine.configureObject(form, model);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.code).toBe(data.configure.invalidExtras.code);
    expect(error.data.target).toBe(data.configure.invalidExtras.target);
    expect(model.properties).toBeUndefined();
  });
});

describe('models anthropic client / prompt 消息形状', () => {
  it('没有工具时应当产出 input.system / input.messages / summaries，且 tools 为 undefined', async () => {
    const data = await loadCases();
    const histories = createHistories(
      data,
      data.history.prompts.firstQuestion,
      data.history.outputs.plainReply,
    );
    const ctx = createPromptContext(data, histories);

    const result = await engine.prompt(ctx);

    expect(Object.keys(result).sort()).toEqual(['input', 'summaries']);
    expect(Object.keys(result.input).sort()).toEqual([
      'messages',
      'system',
      'tools',
    ]);
    expect(result.input.system).toBe(data.expected.plainSystem);
    expect(result.input.messages).toEqual(data.expected.plainMessages);
    expect(result.input.tools).toBeUndefined();
    expect(result.summaries).toEqual(data.expected.plainSummaries);
    expect(mocks.actives).toHaveBeenCalledWith(ctx.realm);
  });

  it('assist 在没有 signature 时 assistant 内容应当是纯字符串', async () => {
    const data = await loadCases();
    const histories = createHistories(
      data,
      data.history.prompts.firstQuestion,
      data.history.outputs.plainReply,
    );

    const result = await engine.prompt(createPromptContext(data, histories));
    const assistant = result.input.messages.find(
      (u: any) => u.role === 'assistant',
    );

    expect(typeof assistant.content).toBe('string');
    expect(assistant.content).toBe(data.history.outputs.plainReply[0].content);
  });

  it('应当把 system 注入汇总成字符串、unshift 进 summaries 并放进 input.system', async () => {
    const data = await loadCases();
    const histories = createHistories(
      data,
      data.history.prompts.firstQuestion,
      data.history.outputs.plainReply,
    );
    const injects: InjectHandler[] = data.expected.systemContents.map(
      (content: string) => async (injectCtx: ModelInjectContext) => {
        injectCtx.system(content);
        return {};
      },
    );

    const result = await engine.prompt(
      createPromptContext(data, histories, injects),
    );

    expect(result.input.system).toBe(data.expected.joinedSystem);
    expect(result.summaries[0]).toEqual({
      role: 'system',
      content: data.expected.joinedSystem,
    });
    expect(result.summaries.slice(1)).toEqual(
      data.expected.plainSummaries.slice(1),
    );
  });

  it('有工具时应当整理成 name / input_schema / description', async () => {
    const data = await loadCases();
    mocks.actives.mockReturnValue(data.tools);
    const histories = createHistories(
      data,
      data.history.prompts.firstQuestion,
      data.history.outputs.plainReply,
    );
    const ctx = createPromptContext(data, histories);

    const result = await engine.prompt(ctx);

    expect(mocks.actives).toHaveBeenCalledWith(ctx.realm);
    expect(result.input.tools).toEqual(
      data.tools.map((u: any) => ({
        name: u.name,
        input_schema: u.parameters,
        description: u.description,
      })),
    );
  });

  it('assist 在 output 带 signature 时应当注入 text + thinking 块', async () => {
    const data = await loadCases();
    const histories = createHistories(
      data,
      data.history.prompts.signedQuestion,
      data.history.outputs.signedReply,
    );

    const result = await engine.prompt(createPromptContext(data, histories));

    expect(result.input.messages).toEqual(data.expected.signedMessages);
    expect(result.summaries).toEqual(data.expected.signedSummaries);
  });
});

describe('models anthropic client / prompt 工具调用', () => {
  it('caller 应当先 push 含 tool_use 的 assistant 消息，再 push tool_result 的 user 消息', async () => {
    const data = await loadCases();
    const histories = createHistories(
      data,
      data.history.prompts.callingQuestion,
      data.history.outputs.callingReply,
    );
    const ctx = createPromptContext(data, histories);
    const callings = data.history.outputs.callingReply[0].callings;

    const result = await engine.prompt(ctx);

    expect(mocks.calling).toHaveBeenCalledWith(ctx.realm, ctx.controller, callings);
    expect(mocks.summary).toHaveBeenCalledWith(callings, result.summaries);
    expect(result.input.messages).toEqual(data.expected.callerMessages);
  });

  it('caller 在没有 callings 时只 push assistant 消息，不 push user 消息', async () => {
    const data = await loadCases();
    // 不改变实现，只为了拿到引擎交给注入流程的上下文
    const spy = vi.spyOn(models.engines, 'prompt');
    const histories = createHistories(
      data,
      data.history.prompts.firstQuestion,
      data.history.outputs.plainReply,
    );

    const result = await engine.prompt(createPromptContext(data, histories));
    const injectCtx = spy.mock.calls[0][1];
    const before = result.input.messages.length;

    injectCtx.caller(data.expected.extraCallerContent, null, []);

    expect(result.input.messages).toHaveLength(before + 1);
    expect(result.input.messages.at(-1)).toEqual(
      data.expected.extraCallerMessage,
    );
  });
});

describe('models anthropic client / result 流式', () => {
  it('content_block_start(tool_use) 应当新增一个 calling 起点', async () => {
    const data = await loadCases();
    const item = data.result.stream.toolStart;
    const ctx = createResultContext(data, { stream: true });

    await feed(ctx, item.events);

    expect(ctx.output.callings).toEqual(item.expectedCallings);
  });

  it('input_json_delta 应当拼到最后一个 calling 的 arguments 上', async () => {
    const data = await loadCases();
    const item = data.result.stream.arguments;
    const ctx = createResultContext(data, { stream: true });

    await feed(ctx, item.events);

    const calling = ctx.output.callings?.at(-1);
    expect(calling?.arguments).toBe(item.expectedArguments);
    expect(jsonUtils.parse(calling?.arguments)).toEqual(item.expectedInput);
  });

  it('text_delta 应当累积到 output.content 与 ctx.properties.content', async () => {
    const data = await loadCases();
    const item = data.result.stream.text;
    const ctx = createResultContext(data, { stream: true });

    await feed(ctx, item.events);

    expect(ctx.output.content).toBe(item.expectedContent);
    expect(ctx.properties.content).toBe(item.expectedContent);
  });

  it('thinking_delta 应当拼到 output.thought', async () => {
    const data = await loadCases();
    const item = data.result.stream.thinking;
    const ctx = createResultContext(data, { stream: true });

    await feed(ctx, item.events);

    expect(ctx.output.thought).toBe(item.expectedThought);
  });

  it('signature_delta 应当从空值开始拼接到 output.properties.signature', async () => {
    const data = await loadCases();
    const item = data.result.stream.signature;
    // output.properties 的初值就是生产里的 {}，首个分片不能带上 "undefined" 前缀
    const ctx = createResultContext(data, { stream: true });

    await feed(ctx, item.events);

    expect(ctx.output.properties?.signature).toBe(item.expectedSignature);
  });

  it('message_delta 的 stop_reason 为 end_turn 时置 stopped，其它原因不置', async () => {
    const data = await loadCases();
    const item = data.result.stream.stop;
    const ctx = createResultContext(data, { stream: true });

    ctx.message = item.toolUse;
    await engine.result(ctx);
    expect(ctx.stopped).toBe(false);

    ctx.message = item.endTurn;
    await engine.result(ctx);
    expect(ctx.stopped).toBe(true);
  });
});

describe('models anthropic client / result 非流式', () => {
  it('text / thinking 应当分别写入 content / thought / signature', async () => {
    const data = await loadCases();
    const item = data.result.message.content;
    const ctx = createResultContext(data, {
      stream: false,
      message: item.message,
    });

    await engine.result(ctx);

    expect(ctx.output.content).toBe(item.expected.content);
    expect(ctx.output.thought).toBe(item.expected.thought);
    expect(ctx.output.properties?.signature).toBe(item.expected.signature);
    expect(ctx.output.callings).toBeUndefined();
    expect(ctx.stopped).toBe(item.expected.stopped);
  });

  it('tool_use 应当生成 calling，arguments 为 input 的 json 字符串', async () => {
    const data = await loadCases();
    const item = data.result.message.toolUse;
    const ctx = createResultContext(data, {
      stream: false,
      message: item.message,
    });

    await engine.result(ctx);

    expect(ctx.output.callings).toEqual(item.expected.callings);
    expect(ctx.output.content).toBe(item.expected.content);
    expect(ctx.output.thought).toBe(item.expected.thought);
    expect(ctx.stopped).toBe(item.expected.stopped);
  });
});

describe('models anthropic client / result 空消息', () => {
  it('message 为空时应当直接返回，不改动 output / properties / stopped', async () => {
    const data = await loadCases();

    for (const stream of [true, false]) {
      const ctx = createResultContext(data, {
        stream,
        message: data.result.message.empty.message,
      });

      await expect(engine.result(ctx)).resolves.toBeUndefined();

      expect(ctx.output, `stream=${stream}`).toEqual(data.result.output);
      expect(ctx.properties, `stream=${stream}`).toEqual({});
      expect(ctx.stopped, `stream=${stream}`).toBe(false);
    }
  });
});
