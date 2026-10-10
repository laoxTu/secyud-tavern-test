import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rags, useRagState } from '@/memories/client/rag';
import { transformers } from '@/memories/client/transformer';

const mocks = vi.hoisted(() => ({
  // 真的加载模型会去下载权重，这里整体替换掉
  pipeline: vi.fn(),
  extractor: vi.fn(),
  env: { allowLocalModels: false, localModelPath: '', allowRemoteModels: true },
  selectors: [] as any[],
}));

vi.mock('@huggingface/transformers', () => ({
  env: mocks.env,
  pipeline: mocks.pipeline,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// 编辑器只用到这三个展示组件，整体替换掉，避免拉起 @/components 桶
vi.mock('@/components', () => ({
  Field: (props: any) => React.createElement(React.Fragment, null, props.children),
  FieldLabel: (props: any) =>
    React.createElement(React.Fragment, null, props.children),
  Selector: (props: any) => {
    mocks.selectors.push(props);
    return null;
  },
}));

// 设置持久化会走请求层，这里整体替换掉，避免用例里出现真实请求
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

let data: any;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./transformer.cases.json')).default);
}

/** 用配置好的模型生成嵌入器 */
async function embedWith(config: Record<string, any> = {}) {
  useRagState.setState({ embedder: { type: 'transformers', config } });
  return await transformers.embedder.embed();
}

beforeEach(async () => {
  data = await loadCases();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  mocks.selectors.length = 0;
  mocks.env.allowLocalModels = false;
  mocks.env.localModelPath = '';
  mocks.env.allowRemoteModels = true;
  mocks.pipeline.mockResolvedValue(mocks.extractor);
  mocks.extractor.mockResolvedValue({ tolist: () => [data.vector] });
});

afterEach(() => {
  // 先卸载，避免恢复设置时触发挂在树上的 Editor 重渲染
  cleanup();
  vi.restoreAllMocks();
  useRagState.setState({ embedder: { type: 'transformers', config: {} } });
});

describe('transformers / 常量', () => {
  it('name 与 embedder.id 应当保持一致', async () => {
    expect(transformers.name).toBe(data.name);
    expect(transformers.embedder.id).toBe(transformers.name);
  });
});

describe('transformers / configure', () => {
  it('应当从 FormData 里取出模型名', async () => {
    const formData = new FormData();
    formData.set('model', 'bge-small-zh-v1.5');

    expect(transformers.embedder.configure(formData)).toEqual({
      model: 'bge-small-zh-v1.5',
    });
  });

  it('没有 model 字段时应当落成 null', () => {
    expect(transformers.embedder.configure(new FormData())).toEqual({
      model: null,
    });
  });
});

describe('transformers / embed', () => {
  it('应当指向本地模型目录并禁用远程下载', async () => {
    await embedWith();

    expect(mocks.env.allowLocalModels).toBe(data.env.allowLocalModels);
    expect(mocks.env.localModelPath).toBe(data.env.localModelPath);
    expect(mocks.env.allowRemoteModels).toBe(data.env.allowRemoteModels);
  });

  it('默认模型应当给出对应的维度', async () => {
    const info = data.models[data.editor.defaultModel];

    const embed = await embedWith();

    expect(embed.dimension).toBe(info.dimension);
    expect(mocks.pipeline).toHaveBeenCalledWith(
      'feature-extraction',
      info.model,
      {},
    );
  });

  it('配置里的模型应当覆盖默认模型', async () => {
    const info = data.models['bge-small-zh-v1.5'];

    const embed = await embedWith({ model: 'bge-small-zh-v1.5' });

    expect(embed.dimension).toBe(info.dimension);
    expect(mocks.pipeline).toHaveBeenCalledWith(
      'feature-extraction',
      info.model,
      {},
    );
  });

  it('未知模型应当回落到默认模型', async () => {
    const info = data.models[data.editor.defaultModel];

    const embed = await embedWith({ model: 'missing' });

    expect(embed.dimension).toBe(info.dimension);
    expect(mocks.pipeline).toHaveBeenCalledWith(
      'feature-extraction',
      info.model,
      {},
    );
  });
});

describe('transformers / generate', () => {
  it('应当按内容走 rag 缓存并返回普通数组', async () => {
    const cache = vi.spyOn(rags, 'cache').mockImplementation((async (
      _input: string,
      model: string,
      factory: any,
    ) => {
      const vector = await factory();
      return { vector: Float32Array.from(vector as number[]), model, time: 0 };
    }) as any);
    const embed = await embedWith();
    const info = data.models[data.editor.defaultModel];

    const vector = await embed.generate({ content: data.content });

    expect(cache).toHaveBeenCalledTimes(1);
    const [input, model, factory] = cache.mock.calls[0];
    expect(input).toBe(data.content);
    expect(model).toBe(info.model);
    expect(Array.isArray(vector)).toBe(true);
    expect(vector).toEqual(data.vector);
    expect(await factory()).toEqual(data.vector);
  });

  it('工厂函数应当用平均池化与归一化调用模型', async () => {
    const cache = vi.spyOn(rags, 'cache').mockImplementation((async (
      _input: string,
      model: string,
      factory: any,
    ) => {
      const vector = await factory();
      return { vector: Float32Array.from(vector as number[]), model, time: 0 };
    }) as any);
    const embed = await embedWith();

    await embed.generate({ content: data.content });

    expect(mocks.extractor).toHaveBeenCalledTimes(1);
    expect(mocks.extractor).toHaveBeenCalledWith(data.content, {
      pooling: 'mean',
      normalize: true,
    });
    expect(cache).toHaveBeenCalledTimes(1);
  });

  it('内容缺失时应当用空串调用模型', async () => {
    vi.spyOn(rags, 'cache').mockImplementation((async (
      _input: string,
      model: string,
      factory: any,
    ) => {
      const vector = await factory();
      return { vector: Float32Array.from(vector as number[]), model, time: 0 };
    }) as any);
    const embed = await embedWith();

    await embed.generate({} as any);

    expect(mocks.extractor).toHaveBeenCalledWith('', {
      pooling: 'mean',
      normalize: true,
    });
  });
});

describe('transformers / Editor', () => {
  it('配置里有模型时应当选中它', async () => {
    await act(async () => {
      useRagState.setState({
        embedder: {
          type: 'transformers',
          config: { model: 'bge-small-zh-v1.5' },
        },
      });
      render(React.createElement(transformers.embedder.component));
    });

    expect(mocks.selectors.at(-1)).toEqual(
      expect.objectContaining({
        name: data.editor.name,
        id: data.editor.id,
        value: 'bge-small-zh-v1.5',
        items: Object.keys(data.models),
      }),
    );
  });

  it('配置里没有模型时应当选中默认模型', async () => {
    await act(async () => {
      useRagState.setState({ embedder: { type: 'transformers', config: {} } });
      render(React.createElement(transformers.embedder.component));
    });

    expect(mocks.selectors.at(-1)).toEqual(
      expect.objectContaining({
        value: data.editor.defaultModel,
        items: Object.keys(data.models),
      }),
    );
  });
});
