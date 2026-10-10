import { beforeEach, describe, expect, it, vi } from 'vitest';

// 这里不渲染 React 组件，只驱动 configureObject / result / prompt 三个纯逻辑入口。
// models/client 是循环依赖的中转（models/client → deepseek → 再回到 openai/client），
// 直接换成最小桩，避免在用例里触发未完成的模块初始化；
// engines.prompt 用「真的按 role 回调注入器」的桩，才能驱动被测代码里的 messages/summaries 组装。
const mocks = vi.hoisted(() => ({
  prompt: vi.fn(),
  actives: vi.fn(() => []),
  summary: vi.fn(),
  calling: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { warning: mocks.warn } }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@/tools/client', () => ({
  tools: {
    actives: mocks.actives,
    summary: mocks.summary,
    calling: mocks.calling,
  },
}));
vi.mock('@/models/client', () => ({
  models: {
    names: { config: 'config', options: 'option' },
    engines: { prompt: mocks.prompt },
  },
  useModelState: () => ({ item: undefined }),
}));

import { openais } from '@/models/openai';
import type { ModelPromptContext, ModelResultContext } from '@/models/client';
import { engine } from '@/models/openai/client/engine';
import type { Realm, RealmHistory } from '@/stories';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./configure.json')).default);
}

async function loadChat() {
  return structuredClone((await import('./chat.json')).default);
}

async function loadResponses() {
  return structuredClone((await import('./responses.json')).default);
}

async function loadPrompt() {
  return structuredClone((await import('./prompt.json')).default);
}

/** 把 fixture 里的普通对象拼成 FormData */
function toFormData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }
  return data;
}

/**
 * 造一个 result 上下文。fixture 里的 format 决定走 chat 还是 responses 分支：
 * engine.result 是从 realm.properties.config 上读 format 的。
 */
function createResultContext(
  item: any,
  overrides: Record<string, any> = {},
): ModelResultContext {
  return {
    realm: {
      model: { builder: 'default' },
      properties: { config: { format: item.format ?? 'chat' } },
    },
    properties: {},
    output: item.output,
    message: item.message,
    stream: item.stream,
    stopped: false,
    ...overrides,
  } as unknown as ModelResultContext;
}

/** 造一个 realm，prompt / result 只会读 realm 上的 config */
function createRealm(config?: Record<string, any>): Realm {
  return {
    properties: config ? { config } : {},
    model: { builder: 'default' },
  } as unknown as Realm;
}

/** 被测代码按 realm.properties.config.format 分流，responses 用例要显式带上 */
function responsesConfig(data: any) {
  return { ...data.config, format: 'responses' };
}

/** 造一个 prompt 上下文，histories 由用例给出 */
function createPromptContext(
  realm: Realm,
  histories: RealmHistory[],
): ModelPromptContext {
  return {
    realm,
    properties: {},
    histories,
    history: histories.at(-1),
    current: false,
    converts: [],
    injects: [],
    controller: new AbortController(),
  } as unknown as ModelPromptContext;
}

/**
 * 逐分片驱动流式结果，properties 与 output 跨分片复用（与 models/client/processer 一致）
 */
async function driveStream(item: any, state: Record<string, any>) {
  const contexts: ModelResultContext[] = [];
  for (const message of item.deltas ?? [item.message]) {
    const ctx = createResultContext(item, {
      message,
      output: state.output,
      properties: state.properties,
    });
    contexts.push(ctx);
    await engine.result(ctx);
  }
  return contexts;
}

/**
 * models.engines.prompt 的桩：按 role 回调注入器，行为与 src/models/client/engine.ts 一致；
 * tools.summary 也照 src/tools/client/index.tsx 的真实实现补上，
 * 否则被测代码组装出的 summaries 会缺掉工具结果那一条。
 */
function stubInject() {
  mocks.summary.mockImplementation((callings: any[], items: any[]) => {
    for (const calling of callings) {
      items.push({
        role: `tool: ${calling.name}`,
        content: `${calling.id}\narguments: \n${calling.arguments}\nresponse: \n${calling.result ?? 'error'}`,
      });
    }
  });
  mocks.prompt.mockImplementation(
    async (ctx: any, inject: any): Promise<void> => {
      inject.system('你是助手');
      for (const history of ctx.histories) {
        for (const prompt of history.prompts) {
          inject.prompt(prompt.content);
        }
        const outputs = history.outputs[history.output] ?? [];
        for (const output of outputs) {
          if (output.callings?.length) {
            inject.caller(output.content, output, output.callings);
          } else if (output.content) {
            inject.assist(output.content, output);
          }
        }
      }
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actives.mockReturnValue([]);
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('models openai client engine / configureObject', () => {
  it('应当按表单写出 config 与 option，并返回同一个 model 对象', async () => {
    const data = await loadData();
    const model = structuredClone(data.modelWithProperties);

    const result = engine.configureObject(toFormData(data.form), model as any);

    expect(result).toBe(model);
    expect(model.properties!.config).toEqual(data.expected.config);
    expect(model.properties!.option).toEqual(data.expected.options);
  });

  it('应当把 token_limit 解析成整数写进 config.token', async () => {
    const data = await loadData();
    const model = structuredClone(data.modelWithProperties);

    engine.configureObject(toFormData(data.form), model as any);

    expect(model.properties!.config.token).toBe(
      parseInt(data.form.token_limit),
    );
    expect(typeof model.properties!.config.token).toBe('number');
  });

  it('应当把数值字段解析成浮点数写进 option', async () => {
    const data = await loadData();
    const model = structuredClone(data.modelWithProperties);

    engine.configureObject(toFormData(data.form), model as any);

    const options = model.properties!.option as any;
    expect(options.temperature).toBe(parseFloat(data.form.temperature));
    expect(options.top_p).toBe(parseFloat(data.form.top_p));
    expect(options.presence_penalty).toBe(
      parseFloat(data.form.presence_penalty),
    );
    expect(options.frequency_penalty).toBe(
      parseFloat(data.form.frequency_penalty),
    );
    expect(options.max_output_tokens).toBe(
      parseFloat(data.form.max_output_tokens),
    );
  });

  it('model 上没有 properties 时应当新建一份再写入', async () => {
    const data = await loadData();
    const model = structuredClone(data.modelWithoutProperties);

    expect(model.properties).toBeUndefined();
    engine.configureObject(toFormData(data.form), model as any);

    expect(model.properties!.config).toEqual(data.expected.config);
    expect(model.properties!.option).toEqual(data.expected.options);
  });

  it('表单缺少 max_output_tokens 时写不出可用数值', async () => {
    const data = await loadData();
    const model = structuredClone(data.modelWithoutProperties);

    engine.configureObject(toFormData(data.formWithoutMaxTokens), model as any);

    const options = model.properties!.option as any;
    expect(options.model).toBe(data.formWithoutMaxTokens.model);
    expect(Number.isNaN(options.max_output_tokens)).toBe(true);
  });

  it('extras 不是合法 json 时应当抛出 checker.validJson 的错误', async () => {
    const data = await loadData();
    const model = structuredClone(data.modelWithProperties);

    expect(() =>
      engine.configureObject(toFormData(data.invalidExtras), model as any),
    ).toThrow(/Json is invalid/);
    // 抛错时不应写入任何配置
    expect(model.properties!.config).toEqual(
      data.modelWithProperties.properties.config,
    );
  });

  it('extras 合法时应当原样保留字符串（不做压缩）', async () => {
    const data = await loadData();
    const model = structuredClone(data.modelWithProperties);

    engine.configureObject(toFormData(data.form), model as any);

    expect(model.properties!.config.extras).toBe(data.form.extras);
  });
});

describe('models openai client engine / result chat 非流式', () => {
  it('应当把 message.content / reasoning_content / usage 写进输出', async () => {
    const data = await loadChat();
    const item = data.chatComplete;

    const ctx = createResultContext(item);
    await engine.result(ctx);

    expect(item.output.content).toBe(item.expected.content);
    expect(item.output.thought).toBe(item.expected.thought);
    expect(item.output.properties.usage).toEqual(item.expected.usage);
  });

  it('finish_reason 为 stop 时应当把 ctx.stopped 置为 true', async () => {
    const data = await loadChat();
    const item = data.chatComplete;

    const ctx = createResultContext(item);
    await engine.result(ctx);

    expect(item.message.choices[0].finish_reason).toBe('stop');
    expect(ctx.stopped).toBe(true);
  });

  it('应当把 type 为 function 的 tool_calls 解析成 callings，其它类型跳过', async () => {
    const data = await loadChat();
    const item = data.chatComplete;

    await engine.result(createResultContext(item));

    expect(item.message.choices[0].message.tool_calls[1].type).not.toBe(
      'function',
    );
    expect(item.output.callings).toEqual(item.expected.callings);
  });

  // 待修缺陷（用户已知悉，处置权在用户）：
  // src/models/openai/client/engine.tsx 第 463 行非流式分支是 output.callings?.push(...)，
  // 缺少流式分支（第 425 行 output.callings ??= []）那样的惰性初始化；
  // 而 output 的初值（src/models/client/processer.ts 第 278-283 行的
  // { content, thought, variables, properties }）没有 callings 字段，
  // 于是 `?.push` 变成空操作，非流式（stream:false）的工具调用被静默丢弃。
  it.fails(
    '应当把非流式的 tool_calls 解析成 callings（当前实现会丢弃，见注释）',
    async () => {
      const data = await loadChat();
      const item = data.chatCompleteWithoutCallings;

      expect(item.output.callings).toBeUndefined();
      await engine.result(createResultContext(item));

      expect(item.message.choices[0].message.tool_calls).toHaveLength(1);
      expect(item.output.callings).toEqual(item.expected.callings);
    },
  );

  it('应当把 usage 写到 output.properties 上而不是 output 顶层', async () => {
    const data = await loadChat();
    const item = data.chatComplete;

    await engine.result(createResultContext(item));

    expect(item.output.usage).toBeUndefined();
    expect(item.output.properties.usage).toEqual(item.expected.usage);
  });
});

describe('models openai client engine / result chat 流式', () => {
  it('choices 为空时不应当改动任何输出字段', async () => {
    const data = await loadChat();
    const item = data.chatStreamEmpty;
    const before = structuredClone(item.output);

    const ctx = createResultContext(item);
    await engine.result(ctx);

    expect(item.output).toEqual(before);
    expect(ctx.stopped).toBe(false);
  });

  it('应当把 delta.content 与 reasoning_content 累积到输出', async () => {
    const data = await loadChat();
    const item = data.chatStreamText;

    await engine.result(createResultContext(item));

    expect(item.output.content).toBe(item.expected.content);
    expect(item.output.thought).toBe(item.expected.thought);
  });

  it('finish_reason 为 stop 的流式分片应当把 ctx.stopped 置为 true', async () => {
    const data = await loadChat();
    const item = data.chatStreamStop;

    const ctx = createResultContext(item);
    await engine.result(ctx);

    expect(item.message.choices[0].finish_reason).toBe('stop');
    expect(ctx.stopped).toBe(true);
  });

  // 流式 tool_calls 的分片契约：首片建条目，后续同 index 的分片只追加 arguments 增量。
  // 新建分支的 arguments 必须为空串，否则首片会被「赋值 + 追加」写两遍，
  // 复现数据（chat.json 的 chatStreamTools）：首片 '{"city":"'、次片 '上海"}' → '{"city":"上海"}'。
  it('应当按 index 归并 tool_calls、拼接 arguments 并补齐 id/name', async () => {
    const data = await loadChat();
    const item = data.chatStreamTools;
    // 只用 deltas 驱动：fixture 里的 message 就是第一片，重复喂会自我追加
    const state = { output: item.output, properties: {} };
    const lengths: number[] = [];

    for (const message of item.deltas) {
      lengths.push(state.output.callings.length);
      await engine.result(
        createResultContext(item, {
          message,
          output: state.output,
          properties: state.properties,
        }),
      );
    }

    expect(state.output.callings).toEqual(item.expected.callings);
    // 首片建条目、后续片命中同 index（index 0）复用，index 1 新建
    expect(lengths).toEqual([0, 1, 1]);
    expect(item.deltas[1].choices[0].delta.tool_calls[0].index).toBe(0);
    // arguments 应当只追加增量：'{"city":"' + '上海"}'
    expect(state.output.callings[0].arguments).toBe(
      item.deltas[0].choices[0].delta.tool_calls[0].function.arguments +
        item.deltas[1].choices[0].delta.tool_calls[0].function.arguments,
    );
  });
});

describe('models openai client engine / result responses 流式', () => {
  it('应当累积 output_text 与 reasoning_summary_text 分片', async () => {
    const data = await loadResponses();
    const item = data.responsesStreamText;
    const state = { output: item.output, properties: {} };

    await driveStream(item, state);

    expect(state.output.content).toBe(item.expected.content);
    expect(state.output.thought).toBe(item.expected.thought);
  });

  it('应当按 output_item.added + function_call_arguments.delta 归并 callings', async () => {
    const data = await loadResponses();
    const item = data.responsesStreamTools;
    const state = { output: item.output, properties: {} };

    await driveStream(item, state);

    expect(state.output.callings).toEqual(item.expected.callings);
  });

  it('非 function_call 的 output_item 不应当产生新的 calling', async () => {
    const data = await loadResponses();
    const item = data.responsesStreamTools;
    const state = { output: item.output, properties: {} };

    await driveStream(item, state);

    expect(item.deltas[3].item.type).toBe('message');
    expect(state.output.callings).toHaveLength(item.expected.callings.length);
  });

  it('response.completed 应当写 usage，且有 callings 时不置 stopped', async () => {
    const data = await loadResponses();
    const item = data.responsesStreamTools;
    const state = { output: item.output, properties: {} };

    const contexts = await driveStream(item, state);

    expect(state.output.properties.usage).toEqual(item.expected.usage);
    expect(item.expected.callings.length).toBeGreaterThan(0);
    expect(contexts.at(-1)!.stopped).toBe(false);
  });

  it('response.completed 没有 callings 时应当把 ctx.stopped 置为 true', async () => {
    const data = await loadResponses();
    const item = data.responsesStreamStop;
    const state = { output: item.output, properties: {} };

    const contexts = await driveStream(item, state);

    expect(contexts.at(-1)!.stopped).toBe(true);
  });
});

describe('models openai client engine / result responses 非流式', () => {
  it('应当写入 usage、拼接 message 正文与 reasoning', async () => {
    const data = await loadResponses();
    const item = data.responsesComplete;

    await engine.result(createResultContext(item));

    expect(item.output.content).toBe(item.expected.content);
    expect(item.output.thought).toBe(item.expected.thought);
    expect(item.output.properties.usage).toEqual(item.expected.usage);
  });

  // 同一处缺陷的 responses 分支：src/models/openai/client/engine.tsx 第 365 行
  // 在 case 'function_call' 里写 output.callings?.push(...)，同样缺少 `output.callings ??= []`。
  it.fails(
    '应当把非流式的 function_call 解析成 callings（当前实现会丢弃，见注释）',
    async () => {
      const data = await loadResponses();
      const item = data.responsesCompleteWithCalling;

      expect(item.output.callings).toBeUndefined();
      await engine.result(createResultContext(item));

      expect(item.output.callings).toEqual(item.expected.callings);
    },
  );

  it('output 里没有 function_call 时应当把 ctx.stopped 置为 true', async () => {
    const data = await loadResponses();
    const item = data.responsesComplete;

    const ctx = createResultContext(item);
    await engine.result(ctx);

    expect(
      item.message.output.every((u: any) => u.type !== 'function_call'),
    ).toBe(true);
    expect(ctx.stopped).toBe(true);
  });

  it('reasoning 没有 content 时不应当改动 thought', async () => {
    const data = await loadResponses();
    const item = data.responsesComplete;
    item.message.output[1].content = undefined;

    await engine.result(createResultContext(item));

    expect(item.output.thought).toBe('');
  });
});

describe('models openai client engine / prompt chat 格式', () => {
  it('应当产出 messages 与 tools，system 进 messages 首位', async () => {
    const data = await loadPrompt();
    const realm = createRealm({ ...data.config, format: 'chat' });
    mocks.actives.mockReturnValue(structuredClone(data.tools));
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(result.input.messages).toEqual(data.expected.chat.messages);
    expect(result.summaries).toEqual(data.expected.chat.summaries);
  });

  it('tools 的 schema 应当是 {type, function:{name, parameters, description}}', async () => {
    const data = await loadPrompt();
    const realm = createRealm({ ...data.config, format: 'chat' });
    mocks.actives.mockReturnValue(structuredClone(data.tools));
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(result.input.tools).toEqual(data.expected.chat.tools);
  });

  it('没有可用工具时 tools 应当是 undefined', async () => {
    const data = await loadPrompt();
    const realm = createRealm({ ...data.config, format: 'chat' });
    mocks.actives.mockReturnValue([]);
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(result.input.tools).toBeUndefined();
  });

  it('应当把注入器交给 models.engines.prompt，并把 builder 透传下去', async () => {
    const data = await loadPrompt();
    const realm = createRealm({ ...data.config, format: 'chat' });
    stubInject();

    await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(mocks.prompt).toHaveBeenCalledTimes(1);
    expect(mocks.prompt.mock.calls[0][1].builder).toBe('default');
    expect(typeof mocks.prompt.mock.calls[0][1].caller).toBe('function');
  });

  it('工具调用轮次应当把 summary 写进 summaries，并生成 tool 消息', async () => {
    const data = await loadPrompt();
    const realm = createRealm({ ...data.config, format: 'chat' });
    mocks.actives.mockReturnValue(structuredClone(data.tools));
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(mocks.summary).toHaveBeenCalledWith(
      data.histories[0].outputs[0][0].callings,
      result.summaries,
    );
    expect(result.input.messages).toContainEqual({
      role: 'tool',
      tool_call_id: data.histories[0].outputs[0][0].callings[0].id,
      content: data.histories[0].outputs[0][0].callings[0].result,
    });
  });
});

describe('models openai client engine / prompt responses 格式', () => {
  it('应当产出 input / instructions / tools 三段', async () => {
    const data = await loadPrompt();
    const realm = createRealm(responsesConfig(data));
    mocks.actives.mockReturnValue(structuredClone(data.tools));
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(result.input.input).toEqual(data.expected.responses.input);
    expect(result.input.instructions).toBe(
      data.expected.responses.instructions,
    );
    expect(result.input.tools).toEqual(data.expected.responses.tools);
  });

  it('应当把 system 汇总进 instructions，并 unshift 进 summaries 首位', async () => {
    const data = await loadPrompt();
    const realm = createRealm(responsesConfig(data));
    mocks.actives.mockReturnValue(structuredClone(data.tools));
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(result.input.instructions).toBe(
      data.expected.responses.instructions,
    );
    expect(result.summaries[0]).toEqual(data.expected.responses.systemSummary);
    // system 不进 input 数组，只走 instructions
    expect(result.input.input).not.toContainEqual(
      expect.objectContaining({ role: 'system' }),
    );
  });

  it('tools 的 schema 应当是 {type, name, parameters, description, strict:false}', async () => {
    const data = await loadPrompt();
    const realm = createRealm(responsesConfig(data));
    mocks.actives.mockReturnValue(structuredClone(data.tools));
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(result.input.tools).toEqual(data.expected.responses.tools);
  });

  it('没有可用工具时 tools 应当是 undefined', async () => {
    const data = await loadPrompt();
    const realm = createRealm(responsesConfig(data));
    mocks.actives.mockReturnValue([]);
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(result.input.tools).toBeUndefined();
  });

  it('工具调用应当拆成 function_call 与 function_call_output 两条消息', async () => {
    const data = await loadPrompt();
    const realm = createRealm(responsesConfig(data));
    mocks.actives.mockReturnValue(structuredClone(data.tools));
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(result.input.input).toContainEqual({
      type: 'function_call',
      call_id: data.histories[0].outputs[0][0].callings[0].id,
      arguments: data.histories[0].outputs[0][0].callings[0].arguments,
      name: data.histories[0].outputs[0][0].callings[0].name,
    });
    expect(result.input.input).toContainEqual({
      type: 'function_call_output',
      call_id: data.histories[0].outputs[0][0].callings[0].id,
      output: data.histories[0].outputs[0][0].callings[0].result,
    });
  });
});

describe('models openai client engine / prompt 的 config 惰性初始化', () => {
  it('realm 上已有 config 时应当保留已有的 format，不被默认值覆盖', async () => {
    const data = await loadPrompt();
    const realm = createRealm(responsesConfig(data));
    stubInject();

    await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    // utils.getProperty 只在键缺失时写入默认值，已有 config 对象不会被整体替换
    expect(realm.properties!.config.format).toBe('responses');
    expect(realm.properties!.config.token).toBe(data.config.token);
    expect(realm.properties!.config).not.toBe(openais.default.config);
  });

  it('realm 上没有 config 时会先写入 openais.default.config，之后沿用该对象', async () => {
    const data = await loadPrompt();
    const realm = createRealm();
    stubInject();

    const result = await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    // 首次读取即把默认配置写进 realm，format 固定为默认的 chat
    expect(realm.properties!.config).toBe(openais.default.config);
    expect(realm.properties!.config.format).toBe('chat');
    expect(result.input.messages).toBeDefined();
    expect(result.input.input).toBeUndefined();
  });
});

describe('models openai client engine / prompt token 超限', () => {
  it('token 小于历史用量之和时应当 toast.warning', async () => {
    const data = await loadPrompt();
    const history = data.tokenOver.history as unknown as RealmHistory;
    const realm = createRealm({ ...data.config, format: 'chat' });
    stubInject();

    await engine.prompt(createPromptContext(realm, [history, history]));

    expect(data.config.token).toBeLessThan(
      data.tokenOver.usage.prompt + data.tokenOver.usage.output,
    );
    expect(mocks.warn).toHaveBeenCalledWith(
      'token is over limit. use summary to compress',
      { richColors: true },
    );
  });

  it('token 等于用量之和（边界）时也应当 toast.warning', async () => {
    const data = await loadPrompt();
    const history = data.tokenEqual.history as unknown as RealmHistory;
    const realm = createRealm({ ...data.config, format: 'chat' });
    stubInject();

    await engine.prompt(createPromptContext(realm, [history, history]));

    expect(data.config.token).toBe(
      data.tokenEqual.usage.prompt + data.tokenEqual.usage.output,
    );
    expect(mocks.warn).toHaveBeenCalledTimes(1);
  });

  it('token 大于历史用量之和时不应当 toast.warning', async () => {
    const data = await loadPrompt();
    const history = data.tokenOver.history as unknown as RealmHistory;
    const realm = createRealm({
      ...data.config,
      format: 'chat',
      token: 1000000,
    });
    stubInject();

    await engine.prompt(createPromptContext(realm, [history, history]));

    expect(1000000).toBeGreaterThan(
      data.tokenOver.usage.prompt + data.tokenOver.usage.output,
    );
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('倒数第二段历史没有 usage 时不应当 toast.warning', async () => {
    const data = await loadPrompt();
    const realm = createRealm({ ...data.config, format: 'chat' });
    stubInject();

    await engine.prompt(
      createPromptContext(realm, data.histories as unknown as RealmHistory[]),
    );

    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('usage 不在最后一条输出上时不应当 toast.warning', async () => {
    const data = await loadPrompt();
    const history = structuredClone(
      data.tokenOver.history,
    ) as unknown as RealmHistory;
    history.outputs[0].push({
      content: '后来的输出',
      thought: '',
      variables: [],
      properties: {},
    } as any);
    const realm = createRealm({ ...data.config, format: 'chat' });
    stubInject();

    await engine.prompt(createPromptContext(realm, [history, history]));

    expect(history.outputs[0]).toHaveLength(2);
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});
