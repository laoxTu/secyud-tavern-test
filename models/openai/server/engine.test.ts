import { beforeEach, describe, expect, it, vi } from 'vitest';

// 绝不能真实发请求：把 SDK 整体换掉，new OpenAI(...) 只会记录构造参数
const mocks = vi.hoisted(() => ({
  chatCreate: vi.fn(),
  responsesCreate: vi.fn(),
  construct: vi.fn(),
}));

vi.mock('openai', () => {
  class OpenAI {
    chat = { completions: { create: mocks.chatCreate } };
    responses = { create: mocks.responsesCreate };
    constructor(options: any) {
      mocks.construct(options);
    }
  }
  return { OpenAI, default: OpenAI };
});

import { openais } from '@/models/openai';
import { engine } from '@/models/openai/server/engine';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./engine.json')).default);
}

/** 取这次调用透传给 SDK 的第一个参数 */
function parameterOf(mock: ReturnType<typeof vi.fn>, call = 0) {
  return mock.mock.calls[call][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('models openai server engine / 构造与透传', () => {
  it('应当用 config.url 作 baseURL、传入的 apiKey 作 apiKey 构造 SDK', async () => {
    const data = await loadData();
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(mocks.construct).toHaveBeenCalledTimes(1);
    expect(mocks.construct).toHaveBeenCalledWith({
      baseURL: data.model.properties.config.url,
      apiKey: data.apiKey,
    });
  });

  it('应当把 { signal } 原样作为第二个参数透传给 SDK', async () => {
    const data = await loadData();
    const controller = new AbortController();
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: controller.signal,
      input: data.input,
    } as any);

    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    expect(mocks.chatCreate.mock.calls[0][1]).toEqual({
      signal: controller.signal,
    });
    expect(mocks.chatCreate.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('应当把 SDK 的返回原样交给调用方', async () => {
    const data = await loadData();
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    const result = await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(result).toEqual(data.chat.createResult);
  });
});

describe('models openai server engine / format 分支', () => {
  it('config.format 为 chat 时应当调用 chat.completions.create', async () => {
    const data = await loadData();
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(data.model.properties.config.format).toBe('chat');
    expect(mocks.chatCreate).toHaveBeenCalledTimes(1);
    expect(mocks.responsesCreate).not.toHaveBeenCalled();
  });

  it('config.format 为 responses 时应当调用 responses.create', async () => {
    const data = await loadData();
    data.model.properties.config.format = 'responses';
    mocks.responsesCreate.mockResolvedValue(data.responses.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.responses.input,
    } as any);

    expect(mocks.responsesCreate).toHaveBeenCalledTimes(1);
    expect(mocks.chatCreate).not.toHaveBeenCalled();
    expect(mocks.responsesCreate.mock.calls[0][0]).toEqual(
      data.responses.expected,
    );
  });
});

describe('models openai server engine / 参数合并顺序', () => {
  it('chat 格式的参数应当是 options → input → stream → stream_options → extras 的顺序', async () => {
    const data = await loadData();
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(parameterOf(mocks.chatCreate)).toEqual(data.chat.expected);
  });

  it('input 里同名的键应当覆盖 model.properties.option', async () => {
    const data = await loadData();
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    const parameter = parameterOf(mocks.chatCreate);
    // options.model 为 fp-model，input.model 为 input-model
    expect(data.model.properties.option.model).not.toBe(data.input.model);
    expect(parameter.model).toBe(data.input.model);
  });

  it('responses 格式的参数应当是 options → input → stream → stream_options → extras 的顺序', async () => {
    const data = await loadData();
    data.model.properties.config.format = 'responses';
    mocks.responsesCreate.mockResolvedValue(data.responses.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.responses.input,
    } as any);

    expect(parameterOf(mocks.responsesCreate)).toEqual(data.responses.expected);
  });

  it('extras 应当能覆盖 model / stream / stream_options 这些更靠前的键', async () => {
    const data = await loadData();
    data.model.properties.config.extras = data.extrasConflict.extras;
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(parameterOf(mocks.chatCreate)).toMatchObject(
      data.extrasConflict.expected,
    );
  });

  it('stream 应当取 model.stream（这里 fixture 为 true）', async () => {
    const data = await loadData();
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(data.model.stream).toBe(true);
    expect(parameterOf(mocks.chatCreate).stream).toBe(data.model.stream);
  });

  it('stream_options 应当始终带上 include_usage: true', async () => {
    const data = await loadData();
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(parameterOf(mocks.chatCreate).stream_options).toEqual({
      include_usage: true,
    });
  });

  it('extras 不是合法 json 时应当退化成空对象，只保留前面的键', async () => {
    const data = await loadData();
    data.model.properties.config.extras = data.extrasInvalid;
    // 去掉 input 里同名的 user，确保断言的是 extras 这一层
    delete (data.input as Record<string, any>).user;
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model: data.model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    const parameter = parameterOf(mocks.chatCreate);
    // extras 里的 user 键来自合法 extras，非法时应消失
    expect(parameter.user).toBeUndefined();
    expect(parameter).toMatchObject({
      model: data.input.model,
      stream: data.model.stream,
      stream_options: { include_usage: true },
    });
  });
});

describe('models openai server engine / 缺少配置时的兜底', () => {
  it('model 没有 properties.config/option 时应当回落到 openais.default', async () => {
    const data = await loadData();
    const model = structuredClone(data.model);
    delete (model as any).properties;
    // 去掉 input 里同名的 model，避免 input 覆盖 options 干扰断言
    delete (data.input as Record<string, any>).model;
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    const parameter = parameterOf(mocks.chatCreate);
    expect(parameter).toMatchObject({
      model: openais.default.options.model,
      temperature: openais.default.options.temperature,
      top_p: openais.default.options.top_p,
      presence_penalty: openais.default.options.presence_penalty,
      frequency_penalty: openais.default.options.frequency_penalty,
      stream: model.stream,
    });
  });

  it('兜底取值应当通过 utils.getProperty 惰性写回 model.properties', async () => {
    const data = await loadData();
    const model = structuredClone(data.model);
    delete (model as any).properties;
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(model.properties).toBeDefined();
    expect(model.properties!.config).toBe(openais.default.config);
    expect(model.properties!.option).toBe(openais.default.options);
    // 用 baseURL 断言兜底确实用的是 default.config.url
    expect(mocks.construct).toHaveBeenCalledWith({
      baseURL: openais.default.config.url,
      apiKey: data.apiKey,
    });
  });

  it('兜底的 config.url 应当用于 SDK 的 baseURL', async () => {
    const data = await loadData();
    const model = structuredClone(data.model);
    delete (model as any).properties!.config;
    mocks.chatCreate.mockResolvedValue(data.chat.createResult);

    await engine.generate({
      model,
      apiKey: data.apiKey,
      signal: undefined,
      input: data.input,
    } as any);

    expect(mocks.construct).toHaveBeenCalledWith({
      baseURL: openais.default.config.url,
      apiKey: data.apiKey,
    });
  });
});
