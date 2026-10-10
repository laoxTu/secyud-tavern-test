import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  presetCreate: vi.fn(),
  fileCreate: vi.fn(),
  post: vi.fn(),
}));

// 不碰数据库：预设写入、封面文件都在边界外
vi.mock('@/presets/server', () => ({
  presets: { repository: { create: mocks.presetCreate } },
}));
vi.mock('@/files/server', () => ({
  files: { repository: { create: mocks.fileCreate } },
}));
// route 只负责拦截器编排，这里直接暴露处理函数
vi.mock('@/interceptors/server', () => ({
  route: (handler: unknown) => handler,
}));
// 客户端代理这里只验证请求层参数，不真发请求
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: mocks.post,
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

// parsecard 只安装在插件自己的 node_modules 下（根 node_modules 没有这个包），
// 所以这里按 @plugins 别名进到插件的依赖目录里取类，跟源码解析到的是同一份实现。
import {
  CharacterCard,
  createMinimalPNG,
} from '@plugins/secyud-tavern-importer/node_modules/parsecard/dist/index.js';
import { proxy } from '@plugins/secyud-tavern-importer/client/proxy';
import api from '@plugins/secyud-tavern-importer/server/api';

import { BusinessError } from '@/interceptors';

const routes = api as any;
/** route 已被替换为直通，POST 处理函数就是 (request) => NextResponse */
const importHandler = routes['silly-tavern'].import.POST as (
  request: Request,
) => Promise<Response>;

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./api.cases.json')).default);
}

/** 角色卡与酒馆预设的样本数据跟 silly-tavern 用例共用一份，避免两处手写 */
async function loadSamples() {
  return structuredClone(
    (await import('./silly-tavern.cases.json')).default,
  );
}

/**
 * jsdom 的 File 塞不进 Node 的 Request（webidl.is.File 断言失败），
 * 这里只伪造 handler 用到的那一部分（与 presets/api 用例同一手法）
 */
function upload(file: File | null) {
  const formData = { get: (name: string) => (name === 'file' ? file : null) };
  return { formData: async () => formData } as unknown as Request;
}

function jsonFile(body: unknown, name = 'card.json') {
  return new File([JSON.stringify(body)], name, {
    type: 'application/json',
  });
}

function pngFile(bytes: Uint8Array, name = 'card.png') {
  // Uint8Array<ArrayBufferLike> 不在 BlobPart 的联合里，但运行时是合法的二进制分片
  return new File([bytes as BlobPart], name, { type: 'image/png' });
}

async function catchError(fn: () => unknown): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected to throw, but it did not.');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('silly-tavern-importer api / 路由契约', () => {
  it('应当挂在 silly-tavern/import 的 POST 上', () => {
    // 与 client/proxy.ts 里的 post('silly-tavern/import') 以及
    // src/generated/api-path.ts 中的路径一致
    expect(Object.keys(routes)).toEqual(['silly-tavern']);
    expect(Object.keys(routes['silly-tavern'])).toEqual(['import']);
    expect(routes['silly-tavern'].import.POST).toBeTypeOf('function');
  });
});

describe('silly-tavern-importer api / JSON 导入', () => {
  it('带 spec 的 json 应当走角色卡分支并写入预设仓库', async () => {
    const data = await loadCases();
    const { card } = await loadSamples();
    mocks.presetCreate.mockResolvedValue(data.createdId);

    const response = await importHandler(upload(jsonFile(card)));

    expect(mocks.presetCreate).toHaveBeenCalledTimes(1);
    const created = mocks.presetCreate.mock.calls[0][0];
    expect(created.name).toBe(card.data.name);
    expect(created.description).toBe(card.data.creator_notes);
    expect(created.version).toBe(card.data.character_version);
    expect(created.cover).toBeUndefined();
    expect(created.entries.lorebooks.map((u: any) => u.code)).toEqual([
      'sl7',
      'sl2',
      'sl5',
      'sl9',
      'sl11',
    ]);
    // 角色卡分支不碰文件仓库
    expect(mocks.fileCreate).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: data.createdId });
  });

  it('没有 spec 的 json 应当走 OpenAI 预设分支', async () => {
    const data = await loadCases();
    const { openaiPreset } = await loadSamples();
    mocks.presetCreate.mockResolvedValue(data.createdId);

    const response = await importHandler(
      upload(jsonFile(openaiPreset, 'preset.json')),
    );

    expect(mocks.presetCreate).toHaveBeenCalledTimes(1);
    const created = mocks.presetCreate.mock.calls[0][0];
    expect(created.name).toBe(openaiPreset.name);
    expect(created.version).toBe('1.0.0');
    expect(created.tags).toEqual(['preset', 'silly-tavern']);
    expect(created.requires).toEqual([]);
    expect(created.entries.lorebooks).toHaveLength(
      openaiPreset.prompts.length,
    );
    expect(created.entries.macros).toEqual([]);
    await expect(response.json()).resolves.toEqual({ id: data.createdId });
  });

  it('spec 存在但缺少 data 时应当按顶层字段兜底', async () => {
    const data = await loadCases();
    mocks.presetCreate.mockResolvedValue(data.createdId);

    await importHandler(upload(jsonFile(data.emptySpec)));

    const created = mocks.presetCreate.mock.calls[0][0];
    expect(created.name).toBe('');
    expect(created.description).toBe('');
    expect(created.tags).toEqual([]);
    // 空角色卡仍然产出 7 条基础宏
    expect(created.entries.macros).toHaveLength(7);
    expect(created.entries.lorebooks).toEqual([]);
  });
});

describe('silly-tavern-importer api / PNG 导入', () => {
  it('PNG 里的角色卡应当解析出来，并把原图写进文件仓库当封面', async () => {
    const data = await loadCases();
    const { card } = await loadSamples();
    const bytes = CharacterCard.fromJSON(card).toPNG();
    const file = pngFile(bytes);
    mocks.fileCreate.mockResolvedValue(data.coverId);
    mocks.presetCreate.mockResolvedValue(data.createdId);

    const response = await importHandler(upload(file));

    expect(mocks.fileCreate).toHaveBeenCalledTimes(1);
    const coverArgs = mocks.fileCreate.mock.calls[0][0];
    expect(coverArgs.type).toBe('image/png');
    expect(coverArgs.args).toBeNull();
    expect(Buffer.isBuffer(coverArgs.buffer)).toBe(true);
    // 写入的字节就是上传上来的那份
    expect(coverArgs.buffer.equals(Buffer.from(await file.arrayBuffer()))).toBe(
      true,
    );

    // 编排顺序：先把原图落盘拿到 file id，再写引用它的预设
    expect(mocks.fileCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.presetCreate.mock.invocationCallOrder[0],
    );
    const created = mocks.presetCreate.mock.calls[0][0];
    expect(created.cover).toBe(data.coverId);
    expect(created.name).toBe(card.data.name);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: data.createdId });
  });

  it('合法 PNG 里没有角色卡数据时应当报 file_invalid', async () => {
    const image = pngFile(createMinimalPNG());

    const error = await catchError(() => importHandler(upload(image)));

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.message).toBe('file is invalid');
    expect(error.code).toBe('error.silly_tavern.file_invalid');
    expect(error.status).toBe(500);
    // 解析失败时既不入库也不落盘
    expect(mocks.presetCreate).not.toHaveBeenCalled();
    expect(mocks.fileCreate).not.toHaveBeenCalled();
  });
});

describe('silly-tavern-importer api / 参数与错误', () => {
  it('没有上传文件时应当报 No file uploaded', async () => {
    const error = await catchError(() => importHandler(upload(null)));

    expect(error).toBeInstanceOf(BusinessError);
    expect(error.message).toBe('No file uploaded');
    expect(error.code).toBe('error.file_invalid');
    expect(error.data).toEqual({});
    expect(mocks.presetCreate).not.toHaveBeenCalled();
    expect(mocks.fileCreate).not.toHaveBeenCalled();
  });

  it('写库失败时不应当吞异常', async () => {
    const { card } = await loadSamples();
    const boom = new Error('insert failed');
    mocks.presetCreate.mockRejectedValue(boom);

    await expect(importHandler(upload(jsonFile(card)))).rejects.toBe(boom);
  });
});

describe('silly-tavern-importer api / 客户端代理', () => {
  it('应当把文件放进 FormData 并发到 silly-tavern/import', async () => {
    const file = new File(['{}'], 'card.json', {
      type: 'application/json',
    });

    await proxy.import(file);

    expect(mocks.post).toHaveBeenCalledTimes(1);
    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe('silly-tavern/import');
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
  });
});
