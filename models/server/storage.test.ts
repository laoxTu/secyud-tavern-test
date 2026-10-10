import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  exist: vi.fn(),
}));

vi.mock('@/models/server/repository', () => ({
  repository: {
    get: mocks.get,
    create: mocks.create,
    delete: mocks.remove,
    exist: mocks.exist,
  },
}));

import { storage } from '@/models/server/storage';
import { archives, type Archive, type ArchiveFolder } from '@/utils/archive';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadModel() {
  return structuredClone((await import('../model.json')).default);
}

/** storage 通过 ctx.properties 去重，这里每个用例都拿一份干净的上下文 */
function createContext(root: Archive = {}) {
  return {
    item: {},
    cur: root,
    root,
    append: () => {},
    properties: {},
  } as any;
}

function nodesOf(root: Archive) {
  return (root['model'] as ArchiveFolder).nodes;
}

/** 同一份归档换一个上下文（去重集合是挂在 properties 上的，不能共用） */
function forkContext(ctx: { root: Archive }) {
  return createContext(ctx.root);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('models server storage / export', () => {
  it('没有 id 时不做任何事', async () => {
    const ctx = createContext();

    await storage.export(ctx, null);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(ctx.root['model']).toBeUndefined();
  });

  it('应当写出 <id>.model.json', async () => {
    const model = await loadModel();
    mocks.get.mockResolvedValue(model);
    const ctx = createContext();

    await storage.export(ctx, model.id);

    const folder = ctx.root['model'] as ArchiveFolder;
    expect(folder.type).toBe('folder');
    expect(folder.name).toBe('model');
    await expect(
      archives.get.json(nodesOf(ctx.root), `${model.id}.model.json`),
    ).resolves.toEqual(model);
  });

  it('同一个上下文里重复导出同一个模型应当只写一次', async () => {
    const model = await loadModel();
    mocks.get.mockResolvedValue(model);
    const ctx = createContext();

    await storage.export(ctx, model.id);
    await storage.export(ctx, model.id);

    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('不同模型应当各自写出一个文件', async () => {
    const model = await loadModel();
    mocks.get.mockResolvedValue(model);
    const ctx = createContext();
    const other = '22222222-2222-4222-8222-222222222222';

    await storage.export(ctx, model.id);
    await storage.export(ctx, other);

    expect(Object.keys(nodesOf(ctx.root)).sort()).toEqual(
      [`${model.id}.model.json`, `${other}.model.json`].sort(),
    );
  });
});

describe('models server storage / import', () => {
  it('没有 id 时不做任何事', async () => {
    const ctx = createContext();

    await storage.import(ctx, null);

    expect(mocks.exist).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('归档里没有该模型时应当跳过', async () => {
    const model = await loadModel();
    const ctx = createContext();

    await storage.import(ctx, model.id);

    expect(mocks.exist).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('已存在同 id 模型时应当先删后建', async () => {
    const model = await loadModel();
    mocks.exist.mockResolvedValue(true);
    const ctx = createContext();
    mocks.get.mockResolvedValue(model);
    await storage.export(ctx, model.id);

    // 导入用一个新的上下文，避免和导出共用去重集合
    const target = forkContext(ctx);
    await storage.import(target, model.id);

    expect(mocks.exist).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(model.id);
    expect(mocks.create).toHaveBeenCalledWith(model);
  });

  it('不存在时应当直接创建', async () => {
    const model = await loadModel();
    mocks.exist.mockResolvedValue(false);
    const ctx = createContext();
    mocks.get.mockResolvedValue(model);
    await storage.export(ctx, model.id);

    const target = forkContext(ctx);
    await storage.import(target, model.id);

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(model);
  });

  it('应当从归档文件重建模型内容', async () => {
    const model = await loadModel();
    const ctx = createContext();
    const folder: ArchiveFolder = {
      type: 'folder',
      name: 'model',
      nodes: {},
    };
    ctx.root['model'] = folder;
    archives.set.json(folder.nodes, `${model.id}.model.json`, {
      ...model,
      name: '归档里的名字',
    });
    mocks.exist.mockResolvedValue(false);

    await storage.import(ctx, model.id);

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: model.id, name: '归档里的名字' }),
    );
  });
});
