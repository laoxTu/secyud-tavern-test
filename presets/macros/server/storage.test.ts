import { describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/presets';
import { storage } from '@/presets/macros/server/storage';
import { archives, type Archive } from '@/utils/archive';

// 只用到 archive 部分，数据库整体替换掉
vi.mock('@/presets/server/repository', () => ({
  repository: { entry: { list: vi.fn(), make: vi.fn() } },
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./entries.json')).default);
}

async function createContext(entries: unknown[], cur: Archive = {}) {
  const preset = structuredClone((await import('../../preset.json')).default);

  return {
    cur,
    root: cur,
    item: {
      ...preset,
      id: 'p',
      entries: { macros: entries },
    } as unknown as Preset,
    append: () => {},
  };
}

async function createTarget(): Promise<Preset> {
  const preset = structuredClone((await import('../../preset.json')).default);

  return { ...preset, id: 'p', entries: {} } as unknown as Preset;
}

function nodesOf(context: { cur: Archive }) {
  return (context.cur.macros as any).nodes as Archive;
}

describe('macros server storage / criteria', () => {
  it('排序键应当带上 multiple 与 hidden 的位', async () => {
    const data = await loadData();

    expect(storage.criteria(data.criteria.entry as any)).toEqual({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    });
  });
});

describe('macros server storage / loadArchive', () => {
  it('应当把 value 拆到单独文件，meta 里不保留 value', async () => {
    const data = await loadData();
    const context = await createContext([data.plain]);

    await storage.loadArchive(context);

    const nodes = nodesOf(context);
    expect(Object.keys(nodes).sort()).toEqual([
      'greet-greet-0.meta.json',
      'greet-greet-0.value.txt',
    ]);
    expect(
      await archives.get.json(nodes, 'greet-greet-0.meta.json'),
    ).toEqual({ ...data.plain, value: undefined });
    expect(await archives.get.text(nodes, 'greet-greet-0.value.txt')).toBe(
      data.plain.value,
    );
  });

  it('JSON 宏的值应当写入 .value.json', async () => {
    const data = await loadData();
    const context = await createContext([data.json]);

    await storage.loadArchive(context);

    const nodes = nodesOf(context);
    expect(Object.keys(nodes).sort()).toEqual([
      'greet-greet-0.meta.json',
      'greet-greet-0.value.json',
    ]);
    expect(await archives.get.text(nodes, 'greet-greet-0.value.json')).toBe(
      data.json.value,
    );
  });

  it('序号应当作为文件名的一部分，避免同 code 覆盖', async () => {
    const data = await loadData();
    const context = await createContext([data.plain, data.second]);

    await storage.loadArchive(context);

    const nodes = nodesOf(context);
    expect(Object.keys(nodes)).toContain('greet-greet-0.meta.json');
    expect(Object.keys(nodes)).toContain('k2-k2-1.meta.json');
  });
});

describe('macros server storage / saveArchive', () => {
  it('归档往返后应当还原出原始条目', async () => {
    const data = await loadData();
    const context = await createContext([data.plain]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.macros).toEqual([data.plain]);
  });

  it('JSON 宏往返后 value 应当保持原始 JSON 字符串', async () => {
    const data = await loadData();
    const context = await createContext([data.json]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.macros).toEqual([data.json]);
  });

  it('多条宏应当按文件名前缀逐个还原', async () => {
    const data = await loadData();
    const context = await createContext([data.plain, data.second]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.macros).toEqual([data.plain, data.second]);
  });
});
