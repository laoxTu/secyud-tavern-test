import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  exist: vi.fn(),
  paramList: vi.fn(),
  paramMake: vi.fn(),
}));

vi.mock('@/comfyui/server/repository-workflow', () => ({
  workflowRepository: {
    get: mocks.get,
    create: mocks.create,
    delete: mocks.remove,
    exist: mocks.exist,
    param: {
      list: mocks.paramList,
      make: mocks.paramMake,
    },
  },
}));

import { storage } from '@/comfyui/server/storage';
import type { PresetArchiveContext } from '@/presets/server/storage';
import { archives, type Archive, type ArchiveFolder } from '@/utils/archive';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./storage.cases.json')).default);
}

/** storage 通过 ctx.properties 去重，这里每个用例都拿一份干净的上下文 */
function createContext(root: Archive = {}) {
  return {
    item: {},
    cur: root,
    root,
    append: () => {},
    properties: {},
  } as unknown as PresetArchiveContext;
}

function nodesOf(ctx: PresetArchiveContext) {
  return (ctx.root['comfyui'] as ArchiveFolder).nodes;
}

// 只 mock 仓库边界，归档工具用真实实现
beforeEach(() => {
  vi.clearAllMocks();
  mocks.paramList.mockResolvedValue({ items: [], length: 0 });
});

describe('comfyui server storage / folder', () => {
  it('第一次调用应当建目录并挂到根上', async () => {
    const ctx = createContext();

    const node = storage.folder(ctx.root);

    expect(node).toEqual({ type: 'folder', name: 'comfyui', nodes: {} });
    expect(ctx.root['comfyui']).toBe(node);
  });

  it('已有目录时应当返回同一个节点', async () => {
    const ctx = createContext();

    const first = storage.folder(ctx.root);
    archives.set.text(first.nodes, 'keep.txt', '内容');
    const second = storage.folder(ctx.root);

    expect(second).toBe(first);
    expect(Object.keys(second.nodes)).toEqual(['keep.txt']);
  });
});

describe('comfyui server storage / export', () => {
  it('没有 id 时不做任何事', async () => {
    const ctx = createContext();

    await storage.export(ctx, null);
    await storage.export(ctx, undefined);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(ctx.root['comfyui']).toBeUndefined();
  });

  it('应当写出 <id>.workflow.json 与 <id>.comfyui.json', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(structuredClone(data.workflow));
    mocks.paramList.mockResolvedValue({
      items: structuredClone(data.params),
      length: data.paramList.length,
    });
    const ctx = createContext();

    await storage.export(ctx, data.workflow.id);

    const nodes = nodesOf(ctx);
    expect(Object.keys(nodes).sort()).toEqual(
      [`${data.workflow.id}.workflow.json`, `${data.workflow.id}.comfyui.json`].sort(),
    );
    await expect(
      archives.get.text(nodes, `${data.workflow.id}.workflow.json`),
    ).resolves.toBe(data.workflow.content);
    // 内容单独成文件，json 里只剩参数与去掉 content 的工作流
    await expect(
      archives.get.json(nodes, `${data.workflow.id}.comfyui.json`),
    ).resolves.toEqual({
      params: data.params,
      workflow: { ...data.workflow, content: undefined },
    });
  });

  it('导出的 workflow 对象上应当不再保留 content', async () => {
    const data = await loadCases();
    const workflow = structuredClone(data.workflow);
    mocks.get.mockResolvedValue(workflow);
    const ctx = createContext();

    await storage.export(ctx, workflow.id);

    expect(workflow.content).toBeUndefined();
  });

  it('同一个上下文里重复导出应当只查一次库', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(structuredClone(data.workflow));
    const ctx = createContext();

    await storage.export(ctx, data.workflow.id);
    await storage.export(ctx, data.workflow.id);

    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.paramList).toHaveBeenCalledTimes(1);
  });

  it('参数子仓库没有结果时应当写出空参数数组', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue(structuredClone(data.workflow));
    const ctx = createContext();

    await storage.export(ctx, data.workflow.id);

    await expect(
      archives.get.json(nodesOf(ctx), `${data.workflow.id}.comfyui.json`),
    ).resolves.toEqual(
      expect.objectContaining({ params: [] }),
    );
  });
});

describe('comfyui server storage / import', () => {
  it('没有 id 时不做任何事', async () => {
    const ctx = createContext();

    await storage.import(ctx, null);
    await storage.import(ctx, undefined);

    expect(mocks.exist).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('归档里没有对应文件时应当跳过', async () => {
    const data = await loadCases();
    const ctx = createContext();

    await storage.import(ctx, data.workflow.id);

    expect(mocks.exist).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.paramMake).not.toHaveBeenCalled();
  });

  it('已存在同 id 的工作流时应当先删后建', async () => {
    const data = await loadCases();
    const ctx = createContext();
    mocks.get.mockResolvedValue(structuredClone(data.archivedWorkflow));
    mocks.exist.mockResolvedValue(true);
    await storage.export(ctx, data.archivedWorkflow.id);

    // 导入用新的上下文，避免与导出共用去重集合
    const target = createContext(ctx.root);
    await storage.import(target, data.archivedWorkflow.id);

    expect(mocks.exist).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(data.archivedWorkflow.id);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: data.archivedWorkflow.id }),
    );
  });

  it('不存在时应当直接创建，并把参数交给 param.make', async () => {
    const data = await loadCases();
    const ctx = createContext();
    mocks.get.mockResolvedValue(structuredClone(data.archivedWorkflow));
    mocks.paramList.mockResolvedValue({
      items: structuredClone(data.importedParams),
      length: data.importedParams.length,
    });
    mocks.exist.mockResolvedValue(false);
    await storage.export(ctx, data.archivedWorkflow.id);

    const target = createContext(ctx.root);
    await storage.import(target, data.archivedWorkflow.id);

    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.paramMake).toHaveBeenCalledWith(
      data.archivedWorkflow.id,
      data.importedParams,
    );
  });

  it('应当从归档里的 workflow 文件重建 content', async () => {
    const data = await loadCases();
    const ctx = createContext();
    mocks.get.mockResolvedValue(structuredClone(data.archivedWorkflow));
    await storage.export(ctx, data.archivedWorkflow.id);

    const target = createContext(ctx.root);
    await storage.import(target, data.archivedWorkflow.id);

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: data.archivedWorkflow.id,
        content: data.archivedWorkflow.content,
      }),
    );
  });
});
