import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRegistry } from '@/plugins/registry';
import { archives, type Archive } from '@/utils/archive';

// ToolProvider 在源码里只是类型导入（运行期会被抹掉），
// 挡一层避免把 tools/server 的注册链（presets / database）拉进来。
vi.mock('@/tools/server', () => ({}));

import { scripts } from '@/tools/scripts/server';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

function createEntry(config: unknown) {
  return {
    id: 'e-1',
    type: 'script',
    config: structuredClone(config),
  } as any;
}

/** 归档上下文只用到 cur / entry / name 三个字段 */
function createContext(cur: Archive, entry: any, name: string) {
  return { cur, root: cur, entry, name, append: () => {} } as any;
}

type Cases = Awaited<ReturnType<typeof loadCases>>;

/** 归档文件名与前缀都由 fixture 里的后缀派生 */
function archiveNames(data: Cases) {
  return data.archiveParts.map((u) => `${data.name}${u.file}`);
}

function fuzzyPrefixes(data: Cases) {
  return data.archiveParts.map((u) => `${data.name}${u.fuzzy}`);
}

beforeEach(() => {
  // Registry 注册 / 注销都会 console.debug，这里静音
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tools scripts server / 注册契约', () => {
  it('provider 应当与被测工具同名，并暴露两个归档钩子', () => {
    expect(scripts.name).toBe('script');
    expect(scripts.provider.id).toBe(scripts.name);
    expect(typeof scripts.provider.loadArchive).toBe('function');
    expect(typeof scripts.provider.saveArchive).toBe('function');
  });

  it('应当能注册进共享的 tool-provider 注册表，键就是工具名', () => {
    const registry = getRegistry<{ id: string }>('tool-provider');

    try {
      registry.register(scripts.provider as any);

      expect(registry.record(scripts.name)).toBe(scripts.provider);
      expect(registry.firstId()).toBe(scripts.name);
    } finally {
      // 注册表挂在 globalThis 上，用完必须摘掉
      registry.unregister(scripts.name);
    }
  });
});

describe('tools scripts server / loadArchive', () => {
  it('应当把 description / schema / script 落成三个文件并从 config 上抹掉', async () => {
    const data = await loadCases();
    const entry = createEntry(data.entry.config);
    const cur: Archive = {};

    await scripts.provider.loadArchive(createContext(cur, entry, data.name));

    const names = archiveNames(data);
    expect(Object.keys(cur).sort()).toEqual([...names].sort());
    for (const [index, part] of data.archiveParts.entries()) {
      expect(await archives.get.text(cur, names[index]), part.key).toBe(
        data.entry.config[part.key as keyof typeof data.entry.config],
      );
    }

    // 三个字段的内容已经进归档，避免重复写进 json
    for (const part of data.archiveParts) {
      expect(entry.config[part.key], part.key).toBeUndefined();
    }
    // 其余字段原样保留
    for (const key of data.keptKeys) {
      expect(entry.config[key], key).toEqual(
        data.entry.config[key as keyof typeof data.entry.config],
      );
    }
  });

  it('空字符串字段仍会建出归档节点，但没有内容', async () => {
    const data = await loadCases();
    const entry = createEntry(data.emptyEntry.config);
    const cur: Archive = {};

    await scripts.provider.loadArchive(createContext(cur, entry, data.name));

    const names = archiveNames(data);
    expect(Object.keys(cur).sort()).toEqual([...names].sort());
    for (const [index, part] of data.archiveParts.entries()) {
      expect(
        await archives.get.text(cur, names[index]),
        part.key,
      ).toBeUndefined();
    }
    for (const key of data.emptyKeptKeys) {
      expect(entry.config[key], key).toBe(
        data.emptyEntry.config[key as keyof typeof data.emptyEntry.config],
      );
    }
  });
});

describe('tools scripts server / saveArchive', () => {
  it('应当按前缀把三个文件读回 config，往返后内容一致', async () => {
    const data = await loadCases();
    const entry = createEntry(data.entry.config);
    const cur: Archive = {};
    await scripts.provider.loadArchive(createContext(cur, entry, data.name));

    const fuzzy = vi.spyOn(archives.get, 'fuzzy');
    const target = { id: 'e-2', type: 'script', config: {} } as any;

    await scripts.provider.saveArchive(createContext(cur, target, data.name));

    expect(fuzzy.mock.calls.map((u) => u[1])).toEqual(fuzzyPrefixes(data));
    expect(target.config).toEqual({
      description: data.entry.config.description,
      schema: data.entry.config.schema,
      script: data.entry.config.script,
    });
  });

  it('归档里没有内容时读回 undefined', async () => {
    const data = await loadCases();
    const entry = createEntry(data.emptyEntry.config);
    const cur: Archive = {};
    await scripts.provider.loadArchive(createContext(cur, entry, data.name));

    const target = { id: 'e-2', type: 'script', config: {} } as any;
    await scripts.provider.saveArchive(createContext(cur, target, data.name));

    for (const part of data.archiveParts) {
      expect(target.config[part.key], part.key).toBeUndefined();
    }
  });
});
