import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComfyUIModel } from '@/comfyui';
import type { ModelImporter } from '@/comfyui/server/importers';

const mocks = vi.hoisted(() => ({
  modelGet: vi.fn(),
  settingGet: vi.fn(),
  exists: vi.fn(),
  download: vi.fn(),
  toast: vi.fn(),
}));

// 不碰数据库：设置、模型仓库都在边界外
vi.mock('@/global/server', () => ({
  settings: {
    repository: {
      get: mocks.settingGet,
    },
  },
}));

vi.mock('@/comfyui/server', () => ({
  comfyuis: {
    repository: {
      model: {
        get: mocks.modelGet,
      },
    },
    model: {
      setting: 'comfyui-model-setting',
    },
    // 与 src/comfyui/index.ts 的 defaultSetting 保持一致
    setting: {
      default: {
        directory: '/home/user/comfyui/models',
      },
    },
  },
}));

// 不落盘、不发请求
vi.mock('@/utils/server', () => ({
  fileUtils: {
    exists: mocks.exists,
    download: mocks.download,
  },
}));

vi.mock('@/signal/server', () => ({
  signals: {
    toast: mocks.toast,
  },
}));

import {
  getDownloadParams,
  importers,
  type ModelDownloadArgs,
} from '@/comfyui/server/importers';
import { comfyuis as main } from '@/comfyui';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./importers.cases.json')).default);
}

const IMPORT_ARGS: ModelDownloadArgs = {
  provider: 'comfyui-model-download',
  id: '11111111-1111-4111-8111-111111111111',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exists.mockResolvedValue(false);
  mocks.download.mockResolvedValue(undefined);
  mocks.toast.mockResolvedValue(undefined);
});

afterEach(() => {
  importers.registry.unregister('fake-importer');
  importers.registry.unregister('fake-importer-2');
});

describe('comfyui importers / getDownloadParams', () => {
  it('应当按模型类型映射到对应子目录', async () => {
    const data = await loadCases();
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });

    for (const item of data.typePaths) {
      mocks.modelGet.mockResolvedValue({
        ...data.model,
        type: item.type,
        path: item.path,
      } as ComfyUIModel);

      const result = await getDownloadParams(data.model.id);

      expect(result.filename).toBe(
        `${data.setting.directory}/${item.folder}/${item.path}`,
      );
    }
  });

  it('未知类型应当回落到 loras 目录', async () => {
    const data = await loadCases();
    const unknown = data.typePaths.find((u) => u.type === 'unknown')!;
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });
    mocks.modelGet.mockResolvedValue({
      ...data.model,
      type: unknown.type,
      path: unknown.path,
    } as ComfyUIModel);

    const result = await getDownloadParams(data.model.id);

    expect(result.filename).toBe(
      `${data.setting.directory}/${unknown.folder}/${unknown.path}`,
    );
  });

  it('应当返回原始模型对象', async () => {
    const data = await loadCases();
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });
    mocks.modelGet.mockResolvedValue(structuredClone(data.model));

    const result = await getDownloadParams(data.model.id);

    expect(result.model).toEqual(data.model);
    expect(mocks.modelGet).toHaveBeenCalledWith(data.model.id);
  });

  it('应当读取设置里的目录，而不是内置默认值', async () => {
    const data = await loadCases();
    mocks.settingGet.mockResolvedValue({
      data: { state: data.settingStates.custom },
    });
    mocks.modelGet.mockResolvedValue(structuredClone(data.model));

    const result = await getDownloadParams(data.model.id);

    expect(result.filename.startsWith(`${data.settingStates.custom.directory}/`)).toBe(
      true,
    );
    expect(mocks.settingGet).toHaveBeenCalledWith('comfyui-model-setting');
  });

  it('设置不存在时应当回落到内置默认目录', async () => {
    const data = await loadCases();
    mocks.settingGet.mockResolvedValue(undefined);
    mocks.modelGet.mockResolvedValue(structuredClone(data.model));

    const result = await getDownloadParams(data.model.id);

    // 回落链：持久化设置 -> comfyuis.setting.default
    expect(
      result.filename.startsWith(`${main.setting.default.directory}/`),
    ).toBe(true);
    expect(mocks.settingGet).toHaveBeenCalledWith('comfyui-model-setting');
  });

  it('设置返回 null 或缺少 state 时同样回落到内置默认目录', async () => {
    const data = await loadCases();
    mocks.modelGet.mockResolvedValue(structuredClone(data.model));

    for (const empty of [null, { data: null }, { data: {} }, { data: { state: undefined } }]) {
      mocks.settingGet.mockResolvedValue(empty);

      const result = await getDownloadParams(data.model.id);

      expect(
        result.filename.startsWith(`${main.setting.default.directory}/`),
      ).toBe(true);
    }
  });

  it('缺少下载地址时应当报错', async () => {
    const data = await loadCases();
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });
    mocks.modelGet.mockResolvedValue(structuredClone(data.invalid.noDownload));

    await expect(
      getDownloadParams(data.invalid.noDownload.id),
    ).rejects.toThrow(/No model.download provided/);
  });

  it('缺少模型路径时应当报错', async () => {
    const data = await loadCases();
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });
    mocks.modelGet.mockResolvedValue(structuredClone(data.invalid.noPath));

    await expect(getDownloadParams(data.invalid.noPath.id)).rejects.toThrow(
      /No model.path provided/,
    );
  });

  it('设置里的目录为空时应当报错', async () => {
    const data = await loadCases();
    mocks.settingGet.mockResolvedValue({ data: { state: { directory: '  ' } } });
    mocks.modelGet.mockResolvedValue(structuredClone(data.model));

    await expect(getDownloadParams(data.model.id)).rejects.toThrow(
      /No directory provided/,
    );
  });
});

describe('comfyui importers / registry', () => {
  it('注册后应当能按 id 取回', async () => {
    const importer: ModelImporter = {
      id: 'fake-importer',
      download: vi.fn(),
    };

    importers.registry.register(importer);
    const found = importers.registry.record(importer.id);

    expect(found).toBe(importer);
    expect(importers.registry.record('missing')).toBeNull();
  });

  it('use 应当按注册顺序逐条执行，endFlag 为真时提前退出', async () => {
    const first: ModelImporter = { id: 'fake-importer', download: vi.fn() };
    const second: ModelImporter = {
      id: 'fake-importer-2',
      sequence: 1,
      download: vi.fn(),
    };
    importers.registry.register(first, second);
    const visited: string[] = [];

    await importers.registry.use(async (item) => {
      visited.push(item.id);
    });
    expect(visited).toEqual(['fake-importer', 'fake-importer-2']);

    visited.length = 0;
    await importers.registry.use(
      async (item) => {
        visited.push(item.id);
      },
      () => visited.length > 0,
    );
    expect(visited).toEqual(['fake-importer']);

    importers.registry.unregister('fake-importer-2');
  });
});

describe('comfyui importers / tasks.execute', () => {
  it('应当按下载参数落盘', async () => {
    const data = await loadCases();
    mocks.modelGet.mockResolvedValue(structuredClone(data.model));
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });
    mocks.exists.mockResolvedValue(false);

    await importers.tasks.execute(IMPORT_ARGS, new AbortController());

    expect(mocks.download).toHaveBeenCalledWith(
      data.model.download,
      `${data.setting.directory}/loras/${data.model.path}`,
    );
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('文件已存在时应当报错并不再下载', async () => {
    const data = await loadCases();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.modelGet.mockResolvedValue(structuredClone(data.model));
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });
    mocks.exists.mockResolvedValue(true);

    await expect(
      importers.tasks.execute(IMPORT_ARGS, new AbortController()),
    ).rejects.toThrow(/file is exists/);

    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
    error.mockRestore();
  });

  it('指定导入器时应当交给导入器下载', async () => {
    const data = await loadCases();
    const download = vi.fn().mockResolvedValue(undefined);
    importers.registry.register({ id: 'fake-importer', download });
    mocks.modelGet.mockResolvedValue({
      ...data.model,
      importer: 'fake-importer',
    } as ComfyUIModel);
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });

    await importers.tasks.execute(IMPORT_ARGS, new AbortController());

    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ id: data.model.id }),
      `${data.setting.directory}/loras/${data.model.path}`,
    );
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('下载失败时应当发错误提示并继续抛出', async () => {
    const data = await loadCases();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('network down');
    mocks.modelGet.mockResolvedValue(structuredClone(data.model));
    mocks.settingGet.mockResolvedValue({ data: { state: data.setting } });
    mocks.download.mockRejectedValue(boom);

    await expect(
      importers.tasks.execute(IMPORT_ARGS, new AbortController()),
    ).rejects.toThrow('network down');

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ message: 'network down' }),
      }),
    );
    error.mockRestore();
  });

  it('任务 id 应当是 comfyui-model-download', () => {
    expect(importers.tasks.id).toBe('comfyui-model-download');
  });
});
