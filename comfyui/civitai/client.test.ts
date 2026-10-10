import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ComfyUIModel } from '@/comfyui';
import { civitais } from '@/comfyui/civitai/client';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./client.cases.json')).default);
}

/** fetch 整体替换掉，用例只关心拼出来的 url 与解析结果 */
function mockFetch(response: any) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => structuredClone(response),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** configureObject 只认这两个表单字段 */
function createFormData(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.append(name, value);
  }
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('comfyui civitai 导入器', () => {
  describe('注册信息', () => {
    it('id 应当是 civitai 并带上配置组件', () => {
      expect(civitais.importer.id).toBe(civitais.name);
      expect(civitais.importer.id).toBe('civitai');
      expect(typeof civitais.importer.configComponent).toBe('function');
      expect(typeof civitais.importer.configureObject).toBe('function');
    });

    it('配置组件应当渲染 model_id 与 model_version_id 两个输入', () => {
      const Component = civitais.importer.configComponent;

      // 用例文件是 .ts，用 createElement 代替 JSX
      render(createElement(Component));

      expect(screen.getByLabelText('comfyui.civitai.model_id')).toHaveAttribute(
        'name',
        'model_id',
      );
      expect(
        screen.getByLabelText('comfyui.civitai.model_version_id'),
      ).toHaveAttribute('name', 'model_version_id');
    });
  });

  describe('extract', () => {
    it('应当把每个文件展开成一个模型并按 type 映射类型', async () => {
      const { extract } = await loadCases();

      for (const item of extract) {
        const items: ComfyUIModel[] = [];

        civitais.extract(
          item.meta,
          item.modelMeta,
          items,
          item.url,
        );

        expect(items, item.name).toEqual(item.expected);
        // id 由后续入库时补，提取阶段一律是 null
        for (const model of items) {
          expect(model.id, item.name).toBeNull();
        }
      }
    });

    it('第一个文件之外的 url 与 cover 来自各自的 meta', async () => {
      const { extract } = await loadCases();
      const item = extract.find((u) => u.expected.length > 1)!;
      const items: ComfyUIModel[] = [];

      civitais.extract(item.meta, item.modelMeta, items, item.url);

      expect(items).toHaveLength(2);
      // 字段来自同一个版本 meta，因此两个模型除了 code / path 外完全一致
      expect(items[0].type).toBe(items[1].type);
      expect(items[0].cover).toBe(item.meta.images[0].url);
      expect(items[1].cover).toBe(item.meta.images[0].url);
      expect(items[0].code).not.toBe(items[1].code);
    });

    it('多页结构应当按 modelVersions 逐个展开', async () => {
      const { modelResponse, modelExpected } = await loadCases();
      const items: ComfyUIModel[] = [];

      for (const modelVersionMeta of modelResponse.modelVersions) {
        civitais.extract(
          modelVersionMeta,
          modelResponse,
          items,
          `${civitais.url}/model/${modelResponse.id}`,
        );
      }

      expect(items).toEqual(modelExpected);
    });

    it('fileInfo.type 为 Model 时应当回落到 modelMeta.type', async () => {
      const { typeFallback } = await loadCases();
      const items: ComfyUIModel[] = [];

      civitais.extract(
        typeFallback.meta,
        typeFallback.modelMeta,
        items,
        typeFallback.url,
      );

      expect(items).toEqual(typeFallback.expected);
      expect(items[0].type).toBe('text_encoder');
    });

    it('回落后仍无映射的类型应当被跳过', async () => {
      const { typeFallbackNoMap } = await loadCases();
      const items: ComfyUIModel[] = [];

      civitais.extract(
        typeFallbackNoMap.meta,
        typeFallbackNoMap.modelMeta,
        items,
        typeFallbackNoMap.url,
      );

      expect(items).toEqual([]);
    });

    it('应当把结果追加到已有列表而不是替换', async () => {
      const { typeFallback } = await loadCases();
      const exist: ComfyUIModel = {
        id: 'exist' as any,
        code: 'exist.safetensors',
        name: 'Exist',
        type: 'lora',
        path: 'exist.safetensors',
      };
      const items: ComfyUIModel[] = [exist];

      civitais.extract(
        typeFallback.meta,
        typeFallback.modelMeta,
        items,
        typeFallback.url,
      );

      expect(items).toHaveLength(2);
      expect(items[0]).toBe(exist);
      expect(items[1].code).toBe('text_encoder.safetensors');
    });
  });

  describe('importer.configureObject / model_version_id', () => {
    it('应当请求模型版本接口并提取模型', async () => {
      const { modelVersionResponse, modelVersionExpected } = await loadCases();
      const fetchMock = mockFetch(modelVersionResponse);
      const items: ComfyUIModel[] = [];

      await civitais.importer.configureObject(
        createFormData({ model_version_id: '100' }),
        items,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `${civitais.url}/api/v1/model-versions/100`,
      );
      expect(items).toEqual(modelVersionExpected);
    });

    it('响应里没有 model 时 name 是 undefined，其余字段照旧填充', async () => {
      const { modelVersionResponseNoModel } = await loadCases();
      mockFetch(modelVersionResponseNoModel);
      const items: ComfyUIModel[] = [];

      await civitais.importer.configureObject(
        createFormData({ model_version_id: '101' }),
        items,
      );

      // name 取的是 modelMeta.name，兜底成 {} 之后就是 undefined（不是空串）
      expect(items).toHaveLength(1);
      expect(items[0].name).toBeUndefined();
      // 直接命中 type.map 的文件照常产出
      expect(items[0].type).toBe('lora');
      expect(items[0].code).toBe('orphan.safetensors');
      expect(items[0].model).toBe('');
      expect(items[0].url).toBe(`${civitais.url}/model-versions/101`);
    });

    it('model 缺失且文件 type 为 Model 时不产出任何条目', async () => {
      const { modelVersionResponseNoModelModelFile } = await loadCases();
      mockFetch(modelVersionResponseNoModelModelFile);
      const items: ComfyUIModel[] = [];

      await civitais.importer.configureObject(
        createFormData({ model_version_id: '102' }),
        items,
      );

      // type 为 Model 时改用 modelMeta.type，兜底成 {} 后是 undefined，
      // type.map[undefined] 取不到映射，于是 continue 掉
      expect(items).toEqual([]);
    });

    it('model_version_id 优先于 model_id', async () => {
      const { modelVersionResponse } = await loadCases();
      const fetchMock = mockFetch(modelVersionResponse);
      const items: ComfyUIModel[] = [];

      await civitais.importer.configureObject(
        createFormData({ model_id: '42', model_version_id: '100' }),
        items,
      );

      expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/model-versions/');
      expect(fetchMock.mock.calls[0][0]).not.toContain('/api/v1/models/');
    });

    it('请求失败时应当包成 default.fetch_failed 并保留原始错误', async () => {
      const inner = new Error('boom');
      const fetchMock = vi.fn().mockRejectedValue(inner);
      vi.stubGlobal('fetch', fetchMock);
      const items: ComfyUIModel[] = [];

      await expect(
        civitais.importer.configureObject(
          createFormData({ model_version_id: '100' }),
          items,
        ),
      ).rejects.toMatchObject({
        code: 'default.fetch_failed',
        innerError: inner,
      });
    });

    it('响应 json 解析失败时同样包成 default.fetch_failed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => {
            throw new SyntaxError('Unexpected token');
          },
        }),
      );
      const items: ComfyUIModel[] = [];

      await expect(
        civitais.importer.configureObject(
          createFormData({ model_version_id: '100' }),
          items,
        ),
      ).rejects.toMatchObject({ code: 'default.fetch_failed' });
    });
  });

  describe('importer.configureObject / model_id', () => {
    it('应当遍历 modelVersions 并按 model 链接提取', async () => {
      const { modelResponse, modelExpected } = await loadCases();
      const fetchMock = mockFetch(modelResponse);
      const items: ComfyUIModel[] = [];

      await civitais.importer.configureObject(
        createFormData({ model_id: '42' }),
        items,
      );

      expect(fetchMock.mock.calls[0][0]).toBe(
        `${civitais.url}/api/v1/models/42`,
      );
      expect(items).toEqual(modelExpected);
    });

    it('modelVersions 为空时不产出模型也不抛错', async () => {
      mockFetch({ id: 42, name: 'Empty', modelVersions: [] });
      const items: ComfyUIModel[] = [];

      await expect(
        civitais.importer.configureObject(
          createFormData({ model_id: '42' }),
          items,
        ),
      ).resolves.toBeUndefined();
      expect(items).toEqual([]);
    });
  });

  describe('importer.configureObject / 参数校验', () => {
    it('两个 id 都没有时应当抛错且不发请求', async () => {
      const fetchMock = mockFetch({});
      const items: ComfyUIModel[] = [];

      await expect(
        civitais.importer.configureObject(createFormData(), items),
      ).rejects.toThrow('model id or model version id needed');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('id 为空串时等同于没填', async () => {
      const fetchMock = mockFetch({});
      const items: ComfyUIModel[] = [];

      await expect(
        civitais.importer.configureObject(
          createFormData({ model_id: '', model_version_id: '' }),
          items,
        ),
      ).rejects.toThrow('model id or model version id needed');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
