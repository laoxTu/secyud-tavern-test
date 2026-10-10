import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Model } from '@/models';
import { anthropics } from '@/models/anthropic';
import { engine } from '@/models/anthropic/server/engine';

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  create: vi.fn(),
}));

// 真实 SDK 会发网络请求，这里整体换成只记录参数的假实现
vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: class {
    messages = { create: mocks.create };
    constructor(options: unknown) {
      mocks.constructor(options);
    }
  },
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./engine.cases.json')).default);
}

/** 只填模型上的 properties，其余字段沿用 fixture 里的模型 */
function createModel(data: any, properties?: Record<string, any>): Model {
  return { ...structuredClone(data.model), properties } as unknown as Model;
}

function createConfig(data: any, extras: string) {
  return { url: data.create.url, extras };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: 'msg-1' });
  // jsonUtils.parse 解析失败时会 warn，用例里不需要这层噪音
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('models anthropic server / 客户端构造', () => {
  it('应当用 config.url 作为 baseURL，并透传传入的 apiKey', async () => {
    const data = await loadCases();
    const model = createModel(data, {
      config: createConfig(data, data.create.extras),
      option: data.parameters.option,
    });

    await engine.generate({
      model,
      apiKey: data.apiKey,
      input: data.create.input,
      signal: new AbortController().signal,
    });

    expect(mocks.constructor).toHaveBeenCalledTimes(1);
    expect(mocks.constructor).toHaveBeenCalledWith({
      baseURL: data.create.url,
      apiKey: data.apiKey,
    });
  });
});

describe('models anthropic server / 参数合并', () => {
  it('应当按 options → input → stream → extras 的顺序合并，后写的覆盖先写的', async () => {
    const data = await loadCases();
    const { invalidExtras: _invalidExtras, ...cases } = data.parameters.cases;

    for (const [name, item] of Object.entries<any>(cases)) {
      mocks.create.mockClear();
      const model = createModel(data, {
        config: createConfig(data, item.extras),
        option: data.parameters.option,
      });

      await engine.generate({
        model,
        apiKey: data.apiKey,
        input: item.input,
        signal: new AbortController().signal,
      });

      expect(mocks.create.mock.calls[0][0], name).toEqual(item.expected);
    }
  });

  it('extras 不是合法 json 时应当退化成空对象', async () => {
    const data = await loadCases();
    const item = data.parameters.cases.invalidExtras;
    const model = createModel(data, {
      config: createConfig(data, item.extras),
      option: data.parameters.option,
    });

    await engine.generate({
      model,
      apiKey: data.apiKey,
      input: item.input,
      signal: new AbortController().signal,
    });

    expect(mocks.create.mock.calls[0][0]).toEqual(item.expected);
  });
});

describe('models anthropic server / 信号与返回', () => {
  it('应当把 signal 作为第二个参数透传，并原样返回 SDK 的结果', async () => {
    const data = await loadCases();
    const response = { id: 'msg-raw', content: [] };
    mocks.create.mockResolvedValue(response);
    const model = createModel(data, {
      config: createConfig(data, data.create.extras),
      option: data.parameters.option,
    });
    const controller = new AbortController();

    const result = await engine.generate({
      model,
      apiKey: data.apiKey,
      input: data.create.input,
      signal: controller.signal,
    });

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][1]).toEqual({ signal: controller.signal });
    expect(mocks.create.mock.calls[0][1].signal).toBe(controller.signal);
    expect(result).toBe(response);
  });
});

describe('models anthropic server / 默认值回退', () => {
  it('模型上没有 config / option 时应当落到 anthropics.default 并回填到 properties', async () => {
    const data = await loadCases();
    const model = createModel(data);
    expect(model.properties).toBeUndefined();

    await engine.generate({
      model,
      apiKey: data.apiKey,
      input: data.fallback.input,
      signal: new AbortController().signal,
    });

    expect(mocks.constructor).toHaveBeenCalledWith({
      baseURL: anthropics.default.config.url,
      apiKey: data.apiKey,
    });
    expect(mocks.create.mock.calls[0][0]).toEqual({
      ...anthropics.default.options,
      ...data.fallback.input,
      stream: data.model.stream,
    });
    expect(model.properties?.option).toEqual(anthropics.default.options);
    expect(model.properties?.config).toEqual(anthropics.default.config);
  });
});
