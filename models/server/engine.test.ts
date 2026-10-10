import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Model } from '@/models';
import {
  ModelGenerateContext,
  ModelEngine,
  engines,
} from '@/models/server/engine';
import { hasher } from '@/utils/server';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./engine.cases.json')).default);
}

async function loadModel(): Promise<Model> {
  return structuredClone(
    (await import('../model.json')).default,
  ) as unknown as Model;
}

function registerEngine(id = 'fake') {
  const engine = {
    id,
    generate: vi.fn<(context: ModelGenerateContext) => Promise<any>>(
      async () => ({ kind: 'response' }),
    ),
  };
  engines.registry.register(engine as unknown as ModelEngine);
  return engine;
}

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  engines.registry.unregister('fake');
  engines.registry.unregister('fake-2');
});

describe('models server engine / 校验', () => {
  it('没有配置 engine 时应当报字段缺失', async () => {
    const model = await loadModel();
    model.engine = undefined;
    const signal = new AbortController().signal;

    await expect(engines.generate(model, {}, signal)).rejects.toThrow(
      /No engine provided/,
    );
  });

  it('engine 是空白字符串时同样报字段缺失', async () => {
    const model = await loadModel();
    model.engine = '   ';
    const signal = new AbortController().signal;

    await expect(engines.generate(model, {}, signal)).rejects.toThrow(
      /No engine provided/,
    );
  });

  it('engine 未注册时应当报实体不存在', async () => {
    const model = await loadModel();
    model.engine = 'not-registered';
    const signal = new AbortController().signal;

    await expect(engines.generate(model, {}, signal)).rejects.toThrow(
      'entity not found',
    );
  });
});

describe('models server engine / 委派', () => {
  it('应当把模型、输入与信号交给注册的引擎', async () => {
    const data = await loadCases();
    const model = (await loadModel()) as Model;
    model.engine = 'fake';
    const engine = registerEngine();
    const signal = new AbortController().signal;

    const result = await engines.generate(model, data.input, signal);

    expect(engine.generate).toHaveBeenCalledWith({
      model,
      apiKey: '',
      signal,
      input: data.input,
    });
    expect(result).toEqual({ kind: 'response' });
  });

  it('没有 key 与 iv 时 apiKey 应当是空串', async () => {
    const model = (await loadModel()) as Model;
    model.engine = 'fake';
    model.key = undefined;
    model.iv = undefined;
    const engine = registerEngine();

    await engines.generate(model, {}, new AbortController().signal);

    expect(engine.generate.mock.calls[0][0].apiKey).toBe('');
  });

  it('只有 key 没有 iv 时也应当是空串', async () => {
    const data = await loadCases();
    const model = (await loadModel()) as Model;
    model.engine = 'fake';
    model.key = hasher.encrypt(data.secrets.plain, Buffer.alloc(16, 1));
    model.iv = undefined;
    const engine = registerEngine();

    await engines.generate(model, {}, new AbortController().signal);

    expect(engine.generate.mock.calls[0][0].apiKey).toBe('');
  });

  it('key 与 iv 齐备时应当解密出明文', async () => {
    const data = await loadCases();
    const model = (await loadModel()) as Model;
    model.engine = 'fake';
    const iv = Buffer.alloc(16, data.secrets.ivByte);
    model.key = hasher.encrypt(data.secrets.plain, iv);
    model.iv = iv;
    const engine = registerEngine();

    await engines.generate(model, {}, new AbortController().signal);

    expect(engine.generate.mock.calls[0][0].apiKey).toBe(data.secrets.plain);
  });

  it('异步迭代器结果应当原样透传', async () => {
    const data = await loadCases();
    const model = (await loadModel()) as Model;
    model.engine = 'fake-2';
    const iterable = (async function* () {
      yield* data.chunks;
    })();
    engines.registry.register({
      id: 'fake-2',
      generate: vi.fn(async () => iterable),
    } as any);

    const result = (await engines.generate(
      model,
      {},
      new AbortController().signal,
    )) as AsyncIterable<any>;

    const collected: unknown[] = [];
    for await (const chunk of result) collected.push(chunk);
    expect(collected).toEqual(data.chunks);
  });
});
