import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  make: vi.fn(),
}));

// storage 是 storages.create 出来的，只用到 archive 部分，数据库整体替换掉
vi.mock('@/presets/server/repository', () => ({
  repository: { entry: { list: mocks.list, make: mocks.make } },
}));

// provider 注册表换成可写对象，用来观察导出/导入回调拿到的上下文
const providersMock = vi.hoisted(() => ({
  records: {} as Record<string, any>,
}));

vi.mock('@/tools/server/providers', () => ({
  providers: { registry: { records: providersMock.records } },
}));

import type { Preset } from '@/presets';
import type { PresetArchiveContext } from '@/presets/server/storage';
import { storage } from '@/tools/server/storage';
import { archives, type Archive, type ArchiveFolder } from '@/utils/archive';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./storage.cases.json')).default);
}

async function createContext(entries?: unknown[], cur: Archive = {}) {
  const preset = structuredClone(
    (await import('../../presets/preset.json')).default,
  );

  return {
    cur,
    root: cur,
    item: {
      ...preset,
      id: 'p',
      entries: entries ? { tools: entries } : {},
    } as unknown as Preset,
    append: () => {},
  } as PresetArchiveContext;
}

/** 导入用的目标预设，entries 是空的 */
async function createTarget(): Promise<Preset> {
  const preset = structuredClone(
    (await import('../../presets/preset.json')).default,
  );

  return { ...preset, id: 'p', entries: {} } as unknown as Preset;
}

function nodesOf(context: PresetArchiveContext) {
  return (context.cur['tools'] as ArchiveFolder).nodes;
}

function createArchiveProvider(id: string) {
  return { id, loadArchive: vi.fn(), saveArchive: vi.fn() };
}

let alpha: ReturnType<typeof createArchiveProvider>;
let beta: ReturnType<typeof createArchiveProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  alpha = createArchiveProvider('alpha');
  beta = createArchiveProvider('beta');
  providersMock.records.alpha = alpha;
  providersMock.records.beta = beta;
});

afterEach(() => {
  delete providersMock.records.alpha;
  delete providersMock.records.beta;
});

describe('tools server storage / criteria', () => {
  it('排序键与过滤键应当由 type 与 name 拼成', async () => {
    const data = await loadCases();

    expect(storage.criteria(data.criteria.entry as any)).toEqual({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    });
  });

  it('条目没有 data 时应当返回空条件', () => {
    expect(storage.criteria({ name: '没有数据' } as any)).toEqual({});
  });
});

describe('tools server storage / loadArchive', () => {
  it('应当写出 <name>-<序号>.meta.json，并把条目与名字交给对应的 provider', async () => {
    const data = await loadCases();
    const context = await createContext(data.entries);

    await storage.loadArchive(context);

    const nodes = nodesOf(context);
    const names = data.expected.names;
    expect(Object.keys(nodes).sort()).toEqual(
      names.map((u: string) => `${u}.meta.json`).sort(),
    );
    await expect(
      archives.get.json(nodes, `${names[0]}.meta.json`),
    ).resolves.toEqual(data.entries[0]);
    await expect(
      archives.get.json(nodes, `${names[1]}.meta.json`),
    ).resolves.toEqual(data.entries[1]);

    expect(alpha.loadArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        name: names[0],
        entry: data.entries[0],
        cur: nodes,
        root: context.root,
        append: context.append,
        item: context.item,
      }),
    );
    expect(beta.loadArchive).toHaveBeenCalledWith(
      expect.objectContaining({ name: names[1], entry: data.entries[1] }),
    );
  });

  it('同名的多个条目应当用序号区分，避免互相覆盖', async () => {
    const data = await loadCases();
    const context = await createContext(data.sameName);

    await storage.loadArchive(context);

    const nodes = nodesOf(context);
    const names = data.expected.duplicatedNames;
    expect(Object.keys(nodes).sort()).toEqual(
      names.map((u: string) => `${u}.meta.json`).sort(),
    );
    for (let i = 0; i < names.length; i++) {
      await expect(
        archives.get.json(nodes, `${names[i]}.meta.json`),
      ).resolves.toEqual(data.sameName[i]);
    }
    expect(alpha.loadArchive).toHaveBeenCalledTimes(2);
  });

  it('没有条目时不应当创建 tools 目录', async () => {
    const empty = await createContext([]);
    const bare = await createContext();

    await storage.loadArchive(empty);
    await storage.loadArchive(bare);

    expect(empty.root['tools']).toBeUndefined();
    expect(bare.root['tools']).toBeUndefined();
  });

  it('provider 抛错时应当向上抛出，且不留下 meta', async () => {
    const data = await loadCases();
    const context = await createContext(data.entries);
    alpha.loadArchive.mockRejectedValue(new Error('boom'));

    await expect(storage.loadArchive(context)).rejects.toThrow('boom');

    // meta 写在 provider 之后，provider 失败时目录里应当还是空的
    expect(Object.keys(nodesOf(context))).toEqual([]);
  });
});

describe('tools server storage / saveArchive', () => {
  it('归档往返后应当还原出原始条目', async () => {
    const data = await loadCases();
    const context = await createContext(data.entries);
    await storage.loadArchive(context);
    const target = await createTarget();

    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.tools).toEqual(data.entries);
    expect(alpha.saveArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        name: data.expected.names[0],
        entry: data.entries[0],
      }),
    );
    expect(beta.saveArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        name: data.expected.names[1],
        entry: data.entries[1],
      }),
    );
  });

  it('文件名前缀相同的条目只还原一次', async () => {
    const data = await loadCases();
    const context = await createContext([]);
    const folder: ArchiveFolder = { type: 'folder', name: 'tools', nodes: {} };
    context.cur['tools'] = folder;
    archives.set.json(folder.nodes, 'x-0.meta.json', data.entries[0]);
    archives.set.json(folder.nodes, 'x-0.extra.json', { other: true });
    const target = await createTarget();

    await storage.saveArchive({ ...context, item: target });

    expect(alpha.saveArchive).toHaveBeenCalledTimes(1);
    expect(target.entries!.tools).toEqual([data.entries[0]]);
  });

  it('没有 meta 文件时应当还原出空条目列表', async () => {
    const context = await createContext([]);
    const folder: ArchiveFolder = { type: 'folder', name: 'tools', nodes: {} };
    context.cur['tools'] = folder;
    archives.set.json(folder.nodes, 'y-0.other.json', { other: true });
    const target = await createTarget();

    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.tools).toEqual([]);
    expect(alpha.saveArchive).not.toHaveBeenCalled();
  });
});
