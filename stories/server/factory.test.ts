import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Story, StoryEntry } from '@/stories';
import { storages } from '@/stories/server/factory';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  make: vi.fn(),
}));

// factory 只通过 repository.entry 访问数据库，这里整体替换掉
vi.mock('@/stories/server/repository', () => ({
  repository: { entry: { list: mocks.list, make: mocks.make } },
}));
// 避免真实打开 sqlite 文件（storage 只为类型引用，仍然挡一层）
vi.mock('@/database/server', () => ({
  databases: {
    db: {},
    get: vi.fn(),
    exists: vi.fn(),
    query: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/database/server/provider', () => ({
  dbProvider: {
    client: {},
    db: {},
    migrate: vi.fn(),
    url: 'file::memory:',
    migrationsFolder: '',
  },
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./factory.cases.json')).default);
}

interface FakeData {
  image?: string | null;
  updateAt: string;
  // 写库时会被置空的管理字段，fixture 里保留原始键
  name?: string;
  masterId?: string;
}

/** 用一个假的条目类型驱动 factory 的通用逻辑 */
async function createStorage() {
  const data = await loadCases();
  return storages.create<FakeData>(
    data.type,
    ({ name, data: { image } }: StoryEntry<FakeData>) => ({
      filter: `${image}${name}`,
      sorter: `${name}${image}`,
    }),
  );
}

/** entries 必须是每个用例独立的对象，否则会写到 fixture 上影响其它用例 */
async function createStory(overrides: Partial<Story> = {}): Promise<Story> {
  const story = structuredClone((await import('./story.json')).default) as Story;
  return { ...story, entries: {}, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stories storages.create / 形状', () => {
  it('应当以注册类型名作为 id', async () => {
    const data = await loadCases();
    const storage = await createStorage();

    expect(storage.id).toBe(data.type.name);
  });
});

describe('stories storages.create / criteria', () => {
  it('应当把条目配置与名称一起交给条件构造器', async () => {
    const data = await loadCases();
    const storage = await createStorage();

    expect(storage.criteria(data.entry as unknown as StoryEntry)).toEqual({
      filter: data.criteria.filter,
      sorter: data.criteria.sorter,
    });
  });

  it('data 为空时应当返回空条件', async () => {
    const data = await loadCases();
    const storage = await createStorage();

    expect(
      storage.criteria({ ...data.entry, data: undefined } as unknown as StoryEntry),
    ).toEqual({});
  });
});

describe('stories storages.create / load', () => {
  it('应当把条目展开到 entries[plural]，并带上 name 与 entryId', async () => {
    const data = await loadCases();
    const storage = await createStorage();
    const story = await createStory();
    mocks.list.mockResolvedValue({ items: [data.loadedEntry], length: 1 });

    await storage.load(story);

    expect(mocks.list).toHaveBeenCalledWith(story.id, {
      search: { entryType: data.type.name },
    });
    expect(story.entries![data.type.plural]).toEqual([
      {
        ...data.loadedEntry.data,
        name: data.loadedEntry.name,
        entryId: data.loadedEntry.entryId,
      },
    ]);
  });

  it('没有条目时不应写入 entries[plural]', async () => {
    const data = await loadCases();
    const storage = await createStorage();
    const story = await createStory();
    mocks.list.mockResolvedValue({ items: [], length: 0 });

    await storage.load(story);

    expect(story.entries![data.type.plural]).toBeUndefined();
  });

  it('story 没有 entries 时应当先补一个空对象', async () => {
    const data = await loadCases();
    const storage = await createStorage();
    const story = await createStory({ entries: undefined });
    mocks.list.mockResolvedValue({ items: [], length: 0 });

    await storage.load(story);

    expect(story.entries).toEqual({});
    // 加载出来的条目会覆盖同名键
    expect(story.entries![data.type.plural]).toBeUndefined();
  });
});

describe('stories storages.create / save', () => {
  it('没有 entries 时不应写库', async () => {
    const storage = await createStorage();

    await storage.save(await createStory({ entries: undefined }));

    expect(mocks.make).not.toHaveBeenCalled();
  });

  it('该类型的条目为空数组时不应写库', async () => {
    const data = await loadCases();
    const storage = await createStorage();
    const story = await createStory({ entries: { [data.type.plural]: [] } });

    await storage.save(story);

    expect(mocks.make).not.toHaveBeenCalled();
  });

  it('应当补全主键列，并把 data 里的管理字段清成 undefined', async () => {
    const data = await loadCases();
    const storage = await createStorage();
    const story = await createStory({
      entries: { [data.type.plural]: [data.savedEntry] },
    });

    await storage.save(story);

    expect(mocks.make).toHaveBeenCalledTimes(1);
    const [masterId, entryType, entries] = mocks.make.mock.calls[0];
    expect(masterId).toBe(story.id);
    expect(entryType).toBe(data.type.name);
    expect(entries).toHaveLength(1);

    const [target] = entries as StoryEntry<FakeData>[];
    expect(target.name).toBe(data.savedEntry.name);
    expect(target.masterId).toBe(story.id);
    expect(target.entryType).toBe(data.type.name);
    expect(target.entryId).toBe(0);
    // data 保留原始字段，只是把 name / masterId 置空
    expect(Object.keys(target.data)).toEqual(Object.keys(data.savedEntry));
    expect(target.data.name).toBeUndefined();
    expect(target.data.masterId).toBeUndefined();
    expect(target.data.image).toBe(data.savedEntry.image);
    expect(target.data.updateAt).toBe(data.savedEntry.updateAt);
  });

  it('多个条目应当一次交给 make', async () => {
    const data = await loadCases();
    const storage = await createStorage();
    const second = { ...data.savedEntry, name: '第二张', image: 'f4' };
    const story = await createStory({
      entries: { [data.type.plural]: [data.savedEntry, second] },
    });

    await storage.save(story);

    const entries = mocks.make.mock.calls[0][2] as StoryEntry<FakeData>[];
    expect(entries.map((u: StoryEntry<FakeData>) => u.name)).toEqual([
      data.savedEntry.name,
      second.name,
    ]);
  });
});
