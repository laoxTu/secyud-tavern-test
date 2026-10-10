import { beforeEach, describe, expect, it, vi } from 'vitest';

// 绝不能真实发请求：把 SDK 整体换掉，new OpenAI(...) 只会记录构造参数
const mocks = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  construct: vi.fn(),
}));

vi.mock('openai', () => {
  class OpenAI {
    chat = { completions: { create: mocks.chatCreate } };
    constructor(options: any) {
      mocks.construct(options);
    }
  }
  return { OpenAI, default: OpenAI };
});

import { deepseeks } from '@/models/deepseek';
import { engine } from '@/models/deepseek/server/engine';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./engine.json')).default);
}

type Data = Awaited<ReturnType<typeof loadData>>;

/**
 * 用 fixture 的 model 复制一份，可选地覆盖 option，再走一次 generate，
 * 并把这次调用透传给 SDK 的参数、信号与返回值一起取出来
 */
async function call(data: Data, override?: Record<string, any>) {
  const model = structuredClone(data.model);
  if (override) {
    model.properties.option = { ...model.properties.option, ...override };
  }
  const controller = new AbortController();
  mocks.chatCreate.mockResolvedValue(data.createResult);

  const result = await engine.generate({
    model,
    apiKey: data.apiKey,
    signal: controller.signal,
    input: structuredClone(data.input),
  } as any);

  const [parameter, options] = mocks.chatCreate.mock.calls.at(-1)!;
  return { model, result, parameter, options, controller };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('models deepseek server engine / 构造 SDK', () => {
  it('应当用固定 baseURL 与传入的 apiKey 构造', async () => {
    const data = await loadData();

    await call(data);

    expect(mocks.construct).toHaveBeenCalledTimes(1);
    expect(mocks.construct).toHaveBeenCalledWith({
      baseURL: data.baseURL,
      apiKey: data.apiKey,
    });
  });

  it('应当把 { signal } 原样作为第二个参数透传给 SDK', async () => {
    const data = await loadData();

    const { parameter, options, controller } = await call(data);

    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    expect(mocks.chatCreate).toHaveBeenCalledWith(parameter, {
      signal: controller.signal,
    });
    expect(options.signal).toBe(controller.signal);
  });

  it('应当把 SDK 的返回原样交给调用方', async () => {
    const data = await loadData();

    const { result } = await call(data);

    expect(result).toEqual(data.createResult);
  });
});

describe('models deepseek server engine / 参数合并', () => {
  it('参数应当是 options → input → stream → stream_options 的顺序', async () => {
    const data = await loadData();

    const { parameter } = await call(data);

    expect(parameter).toEqual(data.expected);
  });

  it('input 里同名的键应当覆盖 options', async () => {
    const data = await loadData();

    const { parameter } = await call(data);

    expect(data.model.properties.option.temperature).not.toBe(
      data.input.temperature,
    );
    expect(parameter.temperature).toBe(data.input.temperature);
  });

  it('stream 取 model.stream，input 里的 stream 应当被覆盖', async () => {
    const data = await loadData();

    const { parameter } = await call(data);

    expect(data.input.stream).toBe(false);
    expect(parameter.stream).toBe(data.model.stream);
  });

  it('stream_options 应当始终带上 include_usage: true', async () => {
    const data = await loadData();

    const { parameter } = await call(data);

    expect(data.input.stream_options.include_usage).toBe(false);
    expect(parameter.stream_options).toEqual({ include_usage: true });
  });
});

describe('models deepseek server engine / 省略规则', () => {
  it('logprobs 为假时应当把 top_logprobs 置为 undefined', async () => {
    const data = await loadData();

    const { parameter } = await call(data, data.overrides.logprobsOff);

    expect(data.model.properties.option.logprobs).toBe(true);
    expect(parameter).toEqual({
      ...data.expected,
      ...data.overrides.logprobsOff,
      top_logprobs: undefined,
    });
    expect('top_logprobs' in parameter).toBe(true);
    expect(parameter.top_logprobs).toBeUndefined();
  });

  it('max_tokens 为 0 时应当把 max_tokens 置为 undefined', async () => {
    const data = await loadData();

    const { parameter } = await call(data, data.overrides.maxTokensZero);

    expect(data.model.properties.option.max_tokens).not.toBe(0);
    expect(parameter).toEqual({
      ...data.expected,
      ...data.overrides.maxTokensZero,
      max_tokens: undefined,
    });
    expect('max_tokens' in parameter).toBe(true);
    expect(parameter.max_tokens).toBeUndefined();
  });

  it('thinking 为 disabled 时应当把 reasoning_effort 置为 undefined', async () => {
    const data = await loadData();

    const { parameter } = await call(data, data.overrides.thinkingDisabled);

    expect(data.model.properties.option.thinking.type).toBe('enabled');
    expect(parameter).toEqual({
      ...data.expected,
      thinking: data.overrides.thinkingDisabled.thinking,
      reasoning_effort: undefined,
    });
    expect('reasoning_effort' in parameter).toBe(true);
    expect(parameter.reasoning_effort).toBeUndefined();
  });

  it('logprobs 为真、max_tokens 非 0、thinking 为 enabled 时三个字段应当保留', async () => {
    const data = await loadData();

    const { parameter } = await call(data);
    const option = data.model.properties.option;

    expect(option.logprobs).toBe(true);
    expect(option.max_tokens).not.toBe(0);
    expect(option.thinking.type).toBe('enabled');
    expect(parameter.top_logprobs).toBe(option.top_logprobs);
    expect(parameter.max_tokens).toBe(option.max_tokens);
    expect(parameter.reasoning_effort).toBe(option.reasoning_effort);
  });
});

describe('models deepseek server engine / 缺少配置时的兜底', () => {
  it('model 上没有 properties.options 时应当落到 deepseeks.default.options', async () => {
    const data = await loadData();
    const fallback = structuredClone(data.model);
    delete (fallback as any).properties;
    // 去掉 input 里会覆盖 option 的键，避免干扰兜底断言
    const input = { messages: data.input.messages };

    mocks.chatCreate.mockResolvedValue(data.createResult);
    await engine.generate({
      model: fallback,
      apiKey: data.apiKey,
      signal: undefined,
      input: structuredClone(input),
    } as any);

    const [parameter] = mocks.chatCreate.mock.calls.at(-1)!;
    expect(parameter).toMatchObject({
      model: deepseeks.default.options.model,
      thinking: deepseeks.default.options.thinking,
      reasoning_effort: deepseeks.default.options.reasoning_effort,
      top_p: deepseeks.default.options.top_p,
      logprobs: deepseeks.default.options.logprobs,
      stream: fallback.stream,
      stream_options: { include_usage: true },
    });
    // 兜底取值通过 utils.getProperty 惰性写回，且是同一个对象
    expect(fallback.properties!.option).toBe(deepseeks.default.options);
    // 默认 max_tokens 为 0、logprobs 为假，同样会被省略规则抹掉
    expect(parameter.max_tokens).toBeUndefined();
    expect(parameter.top_logprobs).toBeUndefined();
  });
});
