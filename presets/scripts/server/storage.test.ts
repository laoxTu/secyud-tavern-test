import { describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/presets';
import { storage } from '@/presets/scripts/server/storage';
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
      entries: { scripts: entries },
    } as unknown as Preset,
    append: () => {},
  };
}

async function createTarget(): Promise<Preset> {
  const preset = structuredClone((await import('../../preset.json')).default);

  return { ...preset, id: 'p', entries: {} } as unknown as Preset;
}

function nodesOf(context: { cur: Archive }) {
  return (context.cur.scripts as any).nodes as Archive;
}

describe('scripts server storage / criteria', () => {
  it('过滤键应当把 priority 补零后放在名称前', async () => {
    const data = await loadData();

    expect(storage.criteria(data.criteria.entry as any)).toEqual({
      sorter: data.criteria.sorter,
      filter: data.criteria.filter,
    });
  });
});

describe('scripts server storage / loadArchive', () => {
  it('内联脚本应当写入 .script.js', async () => {
    const data = await loadData();
    const context = await createContext([data.plain]);

    await storage.loadArchive(context);

    const nodes = nodesOf(context);
    expect(Object.keys(nodes).sort()).toEqual([
      's-0.meta.json',
      's-0.script.js',
    ]);
    expect(await archives.get.text(nodes, 's-0.script.js')).toBe(
      data.plain.content,
    );
    expect(await archives.get.json(nodes, 's-0.meta.json')).toEqual({
      ...data.plain,
      content: undefined,
    });
  });

  it('link 类型应当写入 .script.txt', async () => {
    const data = await loadData();
    const context = await createContext([data.link]);

    await storage.loadArchive(context);

    expect(Object.keys(nodesOf(context)).sort()).toEqual([
      's-0.meta.json',
      's-0.script.txt',
    ]);
  });

  it('importmap 类型应当写入 .script.json', async () => {
    const data = await loadData();
    const context = await createContext([data.importmap]);

    await storage.loadArchive(context);

    expect(Object.keys(nodesOf(context)).sort()).toEqual([
      's-0.meta.json',
      's-0.script.json',
    ]);
  });

  it('没有类型的脚本按 js 处理', async () => {
    const data = await loadData();
    const context = await createContext([data.untyped]);

    await storage.loadArchive(context);

    expect(Object.keys(nodesOf(context))).toContain('s-0.script.js');
  });
});

describe('scripts server storage / saveArchive', () => {
  it('归档往返后应当还原 content 与 type', async () => {
    const data = await loadData();
    const context = await createContext([data.module]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.scripts).toEqual([data.module]);
  });

  it('link 类型往返后 content 应当保持链接', async () => {
    const data = await loadData();
    const context = await createContext([data.link]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.scripts).toEqual([data.link]);
  });

  it('多条脚本应当按文件名前缀逐个还原', async () => {
    const data = await loadData();
    const context = await createContext([data.plain, data.second]);
    await storage.loadArchive(context);

    const target = await createTarget();
    await storage.saveArchive({ ...context, item: target });

    expect(target.entries!.scripts).toEqual([data.plain, data.second]);
  });
});
