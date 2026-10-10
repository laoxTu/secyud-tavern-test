import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComfyUIModel } from '@/comfyui';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  mkdir: vi.fn(),
}));

// 不真的跑 curl（node 内建模块需要同时给出 default 以兼容转换后的取用方式）
vi.mock('node:child_process', () => ({
  default: { execFileSync: mocks.execFileSync },
  execFileSync: mocks.execFileSync,
}));
// 不落盘
vi.mock('@/utils/server', () => ({
  fileUtils: { mkdir: mocks.mkdir },
}));

import { civitais, importer } from '@/comfyui/civitai/server';
import { BusinessError } from '@/interceptors';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./server.cases.json')).default);
}

/** curl 实际收到的 URL（execFileSync 的第 4 个参数） */
function curlUrl(call = 0) {
  return new URL(mocks.execFileSync.mock.calls[call][1][3]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mkdir.mockResolvedValue(undefined);
  // 让 token 分支不受运行环境里的真实变量影响
  vi.stubEnv('CIVITAI_TOKEN', '');
  // 下载命令的日志不进入用例输出
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('comfyui civitai server / 暴露的信息', () => {
  it('应当保留主模块信息并挂上 importer', async () => {
    const data = await loadCases();

    expect(civitais.name).toBe(data.name);
    expect(civitais.url).toBe(data.url);
    expect(civitais.type.map).toEqual(data.typeMap);
    expect(civitais.importer).toBe(importer);
    expect(importer.id).toBe(data.name);
    expect(typeof importer.download).toBe('function');
  });
});

describe('comfyui civitai server / download', () => {
  it('应当先建目录再用 curl 下载', async () => {
    const data = await loadCases();

    await importer.download(data.model as ComfyUIModel, data.filename);

    expect(mocks.mkdir).toHaveBeenCalledWith(data.directory);
    expect(mocks.execFileSync).toHaveBeenCalledWith('curl', [
      '-L',
      '-o',
      data.filename,
      data.model.download,
    ]);
    // 目录先于下载创建
    expect(mocks.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.execFileSync.mock.invocationCallOrder[0],
    );
    // 会把整条命令打到日志里
    expect(vi.mocked(console.info)).toHaveBeenCalledWith(
      expect.stringContaining(data.filename),
    );
  });

  it('官方域名且配置了 token 时应当附上 token', async () => {
    const data = await loadCases();
    vi.stubEnv('CIVITAI_TOKEN', data.token);

    await importer.download(
      { ...data.model, download: data.model.download } as ComfyUIModel,
      data.filename,
    );
    await importer.download(
      { ...data.model, download: data.subdomainDownload } as ComfyUIModel,
      data.filename,
    );

    expect(mocks.execFileSync).toHaveBeenCalledTimes(2);
    expect(curlUrl(0).searchParams.get('token')).toBe(data.token);
    expect(curlUrl(1).searchParams.get('token')).toBe(data.token);
  });

  it('非官方域名时不应当附加 token', async () => {
    const data = await loadCases();
    vi.stubEnv('CIVITAI_TOKEN', data.token);

    await importer.download(
      { ...data.model, download: data.foreignDownload } as ComfyUIModel,
      data.filename,
    );

    expect(curlUrl().searchParams.has('token')).toBe(false);
    expect(curlUrl().toString()).toBe(data.foreignDownload);
  });

  it('download 为空时应当报错且不执行 curl', async () => {
    const data = await loadCases();
    const model = { ...data.model, download: undefined } as ComfyUIModel;

    const error = await importer
      .download(model, data.filename)
      .catch((err) => err);

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.message).toBe('No download provided');
    expect(error.code).toBe('error.empty_field');
    expect(error.data).toEqual({ field: data.expectedField });
    // 目录在建之前就已经创建了
    expect(mocks.mkdir).toHaveBeenCalledWith(data.directory);
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it('download 只有空白字符时同样应当报错', async () => {
    const data = await loadCases();
    const model = {
      ...data.model,
      download: data.whitespaceDownload,
    } as ComfyUIModel;

    const error = await importer
      .download(model, data.filename)
      .catch((err) => err);

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.data).toEqual({ field: data.expectedField });
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it('curl 失败时应当包成 BusinessError 并带上域名', async () => {
    const data = await loadCases();
    const curlError = new Error(data.curlError);
    mocks.execFileSync.mockImplementation(() => {
      throw curlError;
    });
    const errorLog = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const error = await importer
      .download(data.model as ComfyUIModel, data.filename)
      .catch((err) => err);

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.message).toBe('download failed');
    expect(error.code).toBe('message.civitai.download.failed');
    expect(error.innerError).toBe(curlError);
    expect(error.data).toEqual({ url: new URL(data.model.download).hostname });
    expect(errorLog).toHaveBeenCalledWith(curlError);
  });
});
