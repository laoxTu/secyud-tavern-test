import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportWorkflow: vi.fn(),
  importWorkflow: vi.fn(),
}));

// 只替换 storage 这一层，归档工具（archives）用真实实现
vi.mock('@/comfyui/server/storage', () => ({
  storage: {
    folder: vi.fn(),
    export: mocks.exportWorkflow,
    import: mocks.importWorkflow,
  },
}));

import { provider } from '@/comfyui/server/tool';
import { archives, type Archive, type ArchiveFolder } from '@/utils/archive';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./tool.cases.json')).default);
}

/** 工具归档上下文：cur 是当前条目所在目录，root 是整份归档 */
function createContext(
  entry: any,
  name: string,
  root: Archive = {},
  cur: Archive = root,
) {
  return {
    item: {},
    cur,
    root,
    append: () => {},
    properties: {},
    entry,
    name,
  } as any;
}

/** 条目目录挂在名字下面，cur 指向该目录内容 */
function entryContext(entry: any, name: string, root: Archive = {}) {
  const folder: ArchiveFolder = { type: 'folder', name, nodes: root };
  return { ctx: createContext(entry, name, { [name]: folder }, root), folder };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('comfyui server tool / loadArchive', () => {
  it('应当把 description 拆到 <name>.desc.txt 并从配置里清掉', async () => {
    const data = await loadCases();
    const entry = structuredClone(data.entry);
    const { ctx, folder } = entryContext(entry, 'entry');

    await provider.loadArchive(ctx);

    expect(await archives.get.text(folder.nodes, 'entry.desc.txt')).toBe(
      data.entry.config.description,
    );
    expect(entry.config.description).toBeUndefined();
  });

  it('应当把工作流 id 交给 storage.export', async () => {
    const data = await loadCases();
    const entry = structuredClone(data.entry);
    const { ctx } = entryContext(entry, 'entry');

    await provider.loadArchive(ctx);

    expect(mocks.exportWorkflow).toHaveBeenCalledWith(
      ctx,
      data.entry.config.workflow.value,
    );
  });

  it('没有选择工作流时应当传 undefined', async () => {
    const data = await loadCases();
    const entry = structuredClone(data.entryWithoutWorkflow);
    const { ctx } = entryContext(entry, 'entry');

    await provider.loadArchive(ctx);

    expect(mocks.exportWorkflow).toHaveBeenCalledWith(ctx, undefined);
  });

  it('描述为空时读回是 undefined，但配置字段仍会被清掉', async () => {
    const data = await loadCases();
    const entry = structuredClone(data.entryWithoutWorkflow);
    const { ctx, folder } = entryContext(entry, 'entry');

    await provider.loadArchive(ctx);

    // set.text 对空内容同样建节点，只是 content() 返回 undefined
    expect(folder.nodes['entry.desc.txt']).toBeDefined();
    expect(await archives.get.text(folder.nodes, 'entry.desc.txt')).toBeUndefined();
    expect(entry.config.description).toBeUndefined();
  });
});

describe('comfyui server tool / saveArchive', () => {
  it('应当按前缀读回 <name>.desc.txt 写进配置', async () => {
    const data = await loadCases();
    const entry = structuredClone(data.entry);
    const { ctx, folder } = entryContext(entry, 'entry');
    archives.set.text(
      folder.nodes,
      'entry.desc.txt',
      data.entry.config.description,
    );

    await provider.saveArchive(ctx);

    expect(entry.config.description).toBe(data.entry.config.description);
  });

  it('应当把工作流 id 交给 storage.import', async () => {
    const data = await loadCases();
    const entry = structuredClone(data.entry);
    const { ctx } = entryContext(entry, 'entry');

    await provider.saveArchive(ctx);

    expect(mocks.importWorkflow).toHaveBeenCalledWith(
      ctx,
      data.entry.config.workflow.value,
    );
  });

  it('归档里没有描述文件时 description 会被置为 undefined', async () => {
    const data = await loadCases();
    const entry = structuredClone(data.entry);
    const { ctx } = entryContext(entry, 'entry');

    await provider.saveArchive(ctx);

    expect(entry.config.description).toBeUndefined();
  });

  it('没有选择工作流时应当传 undefined', async () => {
    const data = await loadCases();
    const entry = structuredClone(data.entryWithoutWorkflow);
    const { ctx } = entryContext(entry, 'entry');

    await provider.saveArchive(ctx);

    expect(mocks.importWorkflow).toHaveBeenCalledWith(ctx, undefined);
  });
});

describe('comfyui server tool / provider 元信息', () => {
  it('id 应当是 comfyui', () => {
    expect(provider.id).toBe('comfyui');
  });
});
