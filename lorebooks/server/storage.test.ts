import { describe, expect, it, vi } from 'vitest';

import type { Lorebook } from '@/lorebooks';
import { storage } from '@/lorebooks/server/storage';
import type { Preset } from '@/presets';
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
  const preset = structuredClone((await import('../../presets/preset.json')).default);

  return {
    cur,
    root: cur,
    item: {
      ...preset,
      id: 'p',
      entries: { lorebooks: entries },
    } as unknown as Preset,
    append: () => {},
  };
}

async function createTarget(): Promise<Preset> {
  const preset = structuredClone((await import('../../presets/preset.json')).default);

  return { ...preset, id: 'p', entries: {} } as unknown as Preset;
}

function nodesOf(context: { cur: Archive }) {
  return (context.cur.lorebooks as any).nodes as Archive;
}

describe('lorebooks server storage / criteria', () => {
  it('排序键与过滤键应当由 match、code、name 拼成', async () => {
    const data = await loadData();

    expect(storage.criteria(data.criteria.entry as any)).toEqual({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    });
  });
});

describe('lorebooks server storage / loadArchive', () => {
  it('应当把 content 拆到独立文件，meta 里不保留 content', async () => {
    const data = await loadData();
    const context = await createContext([data.plain]);

    await storage.loadArchive(context);

    const nodes = nodesOf(context);
    expect(Object.keys(nodes).sort()).toEqual([
      'w-0.content.txt',
      'w-0.meta.json',
    ]);
    expect(await archives.get.text(nodes, 'w-0.content.txt')).toBe(
      data.plain.content,
    );
    expect(await archives.get.json(nodes, 'w-0.meta.json')).toEqual({
      ...data.plain,
      content: undefined,
    });
  });

  it('content 的扩展名应当跟随 type', async () => {
    const data = await loadData();
    const cases = [
      [data.json, 'json'],
      [data.markdown, 'md'],
      [data.unknownType, 'txt'],
      [data.second, 'yaml'],
    ] as [typeof data.plain, string][];

    for (const [entry, ext] of cases) {
      const context = await createContext([entry]);
      await storage.loadArchive(context);

      expect(Object.keys(nodesOf(context)).sort()).toEqual([
        `${entry.code}-0.content.${ext}`,
        `${entry.code}-0.meta.json`,
      ]);
    }
  });

  it('序号应当作为文件名的一部分，避免同 code 覆盖', async () => {
    const data = await loadData();
    const context = await createContext([data.plain, data.second]);

    await storage.loadArchive(context);

    const keys = Object.keys(nodesOf(context));
    expect(keys).toContain('w-0.meta.json');
    expect(keys).toContain('k-1.meta.json');
  });

  it('没有条目时不应创建 lorebooks 目录', async () => {
    const context = await createContext([]);

    await storage.loadArchive(context);

    expect(context.cur['lorebooks']).toBeUndefined();
  });
});

describe('lorebooks server storage / saveArchive', () => {
  it('归档往返后应当还原出原始条目', async () => {
    const data = await loadData();
    const context = await createContext([data.plain]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.lorebooks).toEqual([data.plain]);
  });

  it('json 内容往返后应当保持原始字符串', async () => {
    const data = await loadData();
    const context = await createContext([data.json]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.lorebooks).toEqual([data.json]);
  });

  it('多条世界书应当按文件名前缀逐个还原并保持顺序', async () => {
    const data = await loadData();
    const context = await createContext([data.plain, data.second]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.lorebooks).toEqual([data.plain, data.second]);
  });

  it('content 缺失时应当还原出空内容', async () => {
    const data = await loadData();
    const entry: Lorebook = { ...structuredClone(data.plain), content: undefined };
    const context = await createContext([entry]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.lorebooks).toEqual([entry]);
  });
});
