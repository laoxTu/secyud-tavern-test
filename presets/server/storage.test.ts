import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/presets';
import { storage } from '@/presets/server/storage';
import { archives, type Archive, type ArchiveFolder } from '@/utils/archive';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
}));

// 封面走文件仓库，这里整体替换掉，避免真实落盘
vi.mock('@/files/server', () => ({
  files: { repository: { get: mocks.get, create: mocks.create } },
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./storage.cases.json')).default);
}

async function createPreset(overrides: Record<string, unknown> = {}) {
  const data = await loadCases();

  return { ...data.preset, entries: {}, ...overrides } as unknown as Preset;
}

/** 注册一个只关心编排的假存储实现 */
function createProvider(criteria = vi.fn()) {
  return {
    id: 'fake',
    load: vi.fn(),
    save: vi.fn(),
    criteria,
    loadArchive: vi.fn(),
    saveArchive: vi.fn(),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  storage.registry.unregister('fake');
});

describe('preset storage / load', () => {
  it('应当以预设 id 建目录，并写入 meta/variables/opening', async () => {
    const root: Archive = {};
    const data = await loadCases();
    const item = await createPreset();

    const node = (await storage.load(root, item, () => {})) as ArchiveFolder;

    expect(root['p']).toBe(node);
    expect(node.type).toBe('folder');
    expect(Object.keys(node.nodes).sort()).toEqual(data.nodeKeys);
    expect(await archives.get.text(node.nodes, 'variables.json')).toBe(
      data.preset.variables,
    );
    expect(await archives.get.text(node.nodes, 'opening.txt')).toBe(
      data.preset.opening,
    );
    // meta 里不带 entries/variables/opening，避免和独立文件重复
    expect(await archives.get.json(node.nodes, 'meta.json')).toEqual({
      ...item,
      entries: undefined,
      variables: undefined,
      opening: undefined,
    });
  });

  it('同一个 id 重复 load 应当直接返回 null，不覆盖已有节点', async () => {
    const root: Archive = {};
    const item = await createPreset();

    const first = await storage.load(root, item, () => {});
    const second = await storage.load(root, item, () => {});

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(root['p']).toBe(first);
  });

  it('封面为合法 uuid 时应当写出 cover.<ext> 且不压缩', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue({
      type: data.cover.mime,
      buffer: Buffer.from(data.cover.buffer),
    });
    const root: Archive = {};
    const item = await createPreset(data.withCover);

    const node = (await storage.load(root, item, () => {})) as ArchiveFolder;

    expect(mocks.get).toHaveBeenCalledWith(data.cover.id, true);
    expect(Object.keys(node.nodes)).toContain(`cover.${data.cover.ext}`);
    expect(node.nodes[`cover.${data.cover.ext}`].level).toBe(0);
    expect((item as any).coverType).toBe(data.cover.mime);
  });

  it('封面不是 uuid 时应当跳过', async () => {
    const data = await loadCases();
    const root: Archive = {};
    const item = await createPreset(data.invalidCover);

    const node = (await storage.load(root, item, () => {})) as ArchiveFolder;

    expect(mocks.get).not.toHaveBeenCalled();
    expect(Object.keys(node.nodes)).not.toContain(
      `cover.${data.cover.invalidId}`,
    );
  });

  it('封面读取失败时不应影响其它文件的导出', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await loadCases();
    mocks.get.mockRejectedValue(new Error('boom'));
    const root: Archive = {};
    const item = await createPreset(data.withCover);

    const node = (await storage.load(root, item, () => {})) as ArchiveFolder;

    expect(error).toHaveBeenCalled();
    expect(await archives.get.text(node.nodes, 'opening.txt')).toBe(
      data.preset.opening,
    );
    error.mockRestore();
  });

  it('应当把 append 回调透传给具体存储实现', async () => {
    const append = vi.fn();
    const provider = createProvider();
    storage.registry.register(provider);
    const root: Archive = {};

    await storage.load(root, await createPreset(), append);

    expect(provider.loadArchive).toHaveBeenCalledTimes(1);
    expect(provider.loadArchive.mock.calls[0][0].append).toBe(append);
  });
});

describe('preset storage / save', () => {
  it('应当从 meta 还原，并读回 variables 与 opening', async () => {
    const data = await loadCases();
    const root: Archive = {};
    const node = (await storage.load(
      root,
      await createPreset(),
      () => {},
    )) as ArchiveFolder;

    const restored = await storage.save(root, node, () => {});

    expect(restored!.id).toBe('p');
    expect(restored!.name).toBe(data.preset.name);
    expect(restored!.variables).toBe(data.preset.variables);
    expect(restored!.opening).toBe(data.preset.opening);
  });

  it('cover 存在时应当重建文件并写回新的 cover id', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue({
      type: data.cover.mime,
      buffer: Buffer.from(data.cover.buffer),
    });
    mocks.create.mockResolvedValue(data.cover.newId);
    const root: Archive = {};
    const node = (await storage.load(
      root,
      await createPreset(data.withCover),
      () => {},
    )) as ArchiveFolder;

    const restored = await storage.save(root, node, () => {});

    expect(restored!.cover).toBe(data.cover.newId);
  });

  it('重建封面时应当沿用 meta 里的原始 MIME', async () => {
    const data = await loadCases();
    mocks.get.mockResolvedValue({
      type: data.cover.mime,
      buffer: Buffer.from(data.cover.buffer),
    });
    mocks.create.mockResolvedValue(data.cover.newId);
    const root: Archive = {};
    const node = (await storage.load(
      root,
      await createPreset(data.withCover),
      () => {},
    )) as ArchiveFolder;

    await storage.save(root, node, () => {});

    // coverType 存的已经是完整 MIME，不应该再拼一次 image/ 前缀
    expect(mocks.create).toHaveBeenCalledWith({
      type: data.cover.mime,
      args: null,
      buffer: expect.any(Buffer),
    });
  });

  it('node 不是目录或没有 meta.json 时应当返回 null', async () => {
    const data = await loadCases();
    const root: Archive = {};
    const fileNode = {
      type: 'file' as const,
      name: 'p',
      content: async () => undefined,
    };

    expect(await storage.save(root, fileNode, () => {})).toBeNull();
    expect(
      await storage.save(
        root,
        { type: 'folder', name: data.preset.id, nodes: {} } as ArchiveFolder,
        () => {},
      ),
    ).toBeNull();
  });

  it('应当把归档内容交给注册的存储实现', async () => {
    const provider = createProvider();
    storage.registry.register(provider);
    const root: Archive = {};
    const node = (await storage.load(
      root,
      await createPreset(),
      () => {},
    )) as ArchiveFolder;

    await storage.save(root, node, () => {});

    expect(provider.saveArchive).toHaveBeenCalledTimes(1);
  });
});

describe('preset storage / manager', () => {
  it('criteria 应当委派给同 id 的存储实现', async () => {
    const data = await loadCases();
    const criteria = vi.fn(() => ({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    }));
    storage.registry.register(createProvider(criteria));

    expect(storage.manager.criteria('fake', data.criteria.data)).toEqual({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    });
    expect(criteria).toHaveBeenCalledWith(data.criteria.data);
  });
});
