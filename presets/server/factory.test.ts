import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Preset, PresetEntry } from '@/presets';
import { storages } from '@/presets/server/factory';
import type { Archive, ArchiveFile } from '@/utils/archive';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  make: vi.fn(),
}));

// factory 只通过 repository.entry 访问数据库，这里整体替换掉
vi.mock('@/presets/server/repository', () => ({
  repository: { entry: { list: mocks.list, make: mocks.make } },
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./factory.cases.json')).default);
}

interface FakeData {
  code: string;
  value?: string;
}

const loadArchive = vi.fn(async () => {});
const saveArchive = vi.fn(async () => undefined);

/** 用一个假的条目类型驱动 factory 的通用逻辑 */
function createStorage() {
  return storages.create<FakeData>(
    { name: 'fake', plural: 'fakes' },
    ({ name, data: { code } }: PresetEntry<FakeData>) => ({
      sorter: `${code}-${name}`,
      filter: `${code}${name}`,
    }),
    loadArchive,
    saveArchive,
  );
}

async function createPreset(overrides: Partial<Preset> = {}): Promise<Preset> {
  const data = await loadCases();

  // entries 必须是每个用例独立的对象，否则会写到 fixture 上影响其它用例
  return { ...data.preset, entries: {}, ...overrides } as unknown as Preset;
}

async function createContext(cur: Archive = {}) {
  return { cur, root: cur, item: await createPreset(), append: () => {} };
}

/** 按文件名造出归档里的文件节点（content 是原地生成的函数，不进 json） */
function createFiles(names: string[]): Archive {
  return Object.fromEntries(
    names.map((name) => [
      name,
      { type: 'file', name, content: async () => undefined } as ArchiveFile,
    ]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('storages.create / criteria', () => {
  it('应当把条目配置与名称一起交给条件构造器', async () => {
    const storage = createStorage();
    const data = await loadCases();

    expect(storage.criteria(data.entry as any)).toEqual({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    });
  });

  it('data 为空时应当返回空条件', async () => {
    const storage = createStorage();
    const data = await loadCases();

    expect(
      storage.criteria({ ...data.entry, data: undefined } as any),
    ).toEqual({});
  });
});

describe('storages.create / load', () => {
  it('应当把条目展开到 entries[plural]，并带上 disabled 与 name', async () => {
    const storage = createStorage();
    const data = await loadCases();
    mocks.list.mockResolvedValue({ items: [data.loadedEntry], length: 1 });
    const model = await createPreset();

    await storage.load(model);

    expect(mocks.list).toHaveBeenCalledWith('p', {
      search: { entryType: 'fake' },
    });
    expect(model.entries!.fakes).toEqual([
      {
        ...data.loadedEntry.data,
        disabled: data.loadedEntry.disabled,
        name: data.loadedEntry.name,
      },
    ]);
  });

  it('没有条目时不应写入 entries', async () => {
    const storage = createStorage();
    mocks.list.mockResolvedValue({ items: [], length: 0 });
    const model = await createPreset();

    await storage.load(model);

    expect(model.entries!.fakes).toBeUndefined();
  });
});

describe('storages.create / save', () => {
  it('没有 entries 时不应写库', async () => {
    const storage = createStorage();

    await storage.save(await createPreset());

    expect(mocks.make).not.toHaveBeenCalled();
  });

  it('应当补全主键列并清理 data 里的管理字段', async () => {
    const storage = createStorage();
    const data = await loadCases();
    const { disabled, name, masterId, ...rest } = data.savedEntry as any;
    const model = await createPreset({
      entries: { fakes: [data.savedEntry] },
    });

    await storage.save(model);

    expect(mocks.make).toHaveBeenCalledWith('p', 'fake', [
      {
        data: rest,
        disabled,
        name,
        masterId: 'p',
        entryType: 'fake',
        entryId: 0,
      },
    ]);
  });
});

describe('storages.create / loadArchive', () => {
  it('应当以 plural 建目录，并按序号逐条交给具体实现', async () => {
    const storage = createStorage();
    const data = await loadCases();
    const context = await createContext();
    context.item = await createPreset({
      entries: { fakes: data.archiveEntries },
    });

    await storage.loadArchive(context);

    const folder = context.cur.fakes as any;
    expect(folder.type).toBe('folder');
    expect(folder.name).toBe('fakes');
    expect(loadArchive).toHaveBeenCalledTimes(2);
    expect(loadArchive.mock.calls[0][0].cur).toBe(folder.nodes);
    expect(loadArchive.mock.calls[0][1]).toEqual(data.archiveEntries[0]);
    // sequence 用条目下标，作为文件名的一部分
    expect(loadArchive.mock.calls[0][2]).toBe(0);
    expect(loadArchive.mock.calls[1][2]).toBe(1);
  });

  it('没有该类型条目时不应建目录', async () => {
    const storage = createStorage();
    const context = await createContext();

    await storage.loadArchive(context);

    expect(context.cur.fakes).toBeUndefined();
    expect(loadArchive).not.toHaveBeenCalled();
  });
});

describe('storages.create / saveArchive', () => {
  it('应当按文件名前缀去重后逐个还原，并写回 entries[plural]', async () => {
    const storage = createStorage();
    const data = await loadCases();
    saveArchive.mockImplementation(
      async (_ctx: unknown, name: string) => ({ code: name }) as any,
    );
    const context = await createContext({
      fakes: {
        type: 'folder',
        name: 'fakes',
        nodes: createFiles(data.archiveFileNames),
      },
    });

    await storage.saveArchive(context);

    expect(saveArchive.mock.calls.map((u) => u[1])).toEqual(['a-0', 'b-0']);
    expect(context.item.entries!.fakes).toEqual([
      { code: 'a-0' },
      { code: 'b-0' },
    ]);
  });

  it('目录不存在或不是目录时应当跳过', async () => {
    const storage = createStorage();

    await storage.saveArchive(await createContext());
    await storage.saveArchive(
      await createContext({
        fakes: createFiles(['fakes']).fakes as any,
      }),
    );

    expect(saveArchive).not.toHaveBeenCalled();
  });

  it('具体实现返回空时不应写入条目', async () => {
    const storage = createStorage();
    const data = await loadCases();
    saveArchive.mockResolvedValue(undefined);
    const context = await createContext({
      fakes: {
        type: 'folder',
        name: 'fakes',
        nodes: createFiles(data.singleArchiveFileNames),
      },
    });

    await storage.saveArchive(context);

    expect(context.item.entries!.fakes).toEqual([]);
  });
});
