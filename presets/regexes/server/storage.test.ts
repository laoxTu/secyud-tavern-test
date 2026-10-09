import { describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/presets';
import { storage } from '@/presets/regexes/server/storage';
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
      entries: { regexes: entries },
    } as unknown as Preset,
    append: () => {},
  };
}

async function createTarget(): Promise<Preset> {
  const preset = structuredClone((await import('../../preset.json')).default);

  return { ...preset, id: 'p', entries: {} } as unknown as Preset;
}

function nodesOf(context: { cur: Archive }) {
  return (context.cur.regexes as any).nodes as Archive;
}

describe('regexes server storage / criteria', () => {
  it('排序键取名称，过滤键带上 target', async () => {
    const data = await loadData();

    expect(storage.criteria(data.criteria.entry as any)).toEqual({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    });
  });
});

describe('regexes server storage / loadArchive', () => {
  it('应当以 名称-序号 作为 meta 文件名', async () => {
    const data = await loadData();
    const context = await createContext([data.plain, data.second]);

    await storage.loadArchive(context);

    expect(Object.keys(nodesOf(context)).sort()).toEqual([
      '规则-0.meta.json',
      '规则二-1.meta.json',
    ]);
  });

  it('应当把条目完整写进 meta.json', async () => {
    const data = await loadData();
    const context = await createContext([data.plain]);

    await storage.loadArchive(context);

    expect(
      await archives.get.json(nodesOf(context), '规则-0.meta.json'),
    ).toEqual(data.plain);
  });
});

describe('regexes server storage / saveArchive', () => {
  it('归档往返后应当还原出原始条目', async () => {
    const data = await loadData();
    const context = await createContext([data.plain]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.regexes).toEqual([data.plain]);
  });

  it('多条规则应当按文件名前缀逐个还原', async () => {
    const data = await loadData();
    const context = await createContext([data.plain, data.second]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.regexes).toEqual([data.plain, data.second]);
  });
});
