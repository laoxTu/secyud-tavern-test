import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportArchive: vi.fn(),
  importArchive: vi.fn(),
  append: vi.fn(),
}));

// 模型存储会拉起 sqlite / drizzle，这里只保留归档用到的两个入口
vi.mock('@/models/server', () => ({
  models: {
    storage: { export: mocks.exportArchive, import: mocks.importArchive },
  },
}));

import type { AgentConfig } from '@/tools/agents';
import { agents } from '@/tools/agents/server';
import { archives } from '@/utils/archive';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 造一个归档上下文；cur 用真实的 archives 容器，能顺带验证文件命名 */
function createContext(entry: any, name: string) {
  return {
    root: {},
    cur: {},
    item: {},
    append: mocks.append,
    properties: {},
    entry,
    name,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

describe('agents server / 注册契约', () => {
  it('应当注册成 agent 工具并暴露归档钩子', () => {
    expect(agents.name).toBe('agent');
    expect(agents.provider.id).toBe(agents.name);
    expect(Object.keys(agents).sort()).toEqual(['name', 'provider']);
    expect(typeof agents.provider.loadArchive).toBe('function');
    expect(typeof agents.provider.saveArchive).toBe('function');
  });
});

describe('agents server / loadArchive', () => {
  it('应当把 description / schema 落到归档文件并从配置里摘掉', async () => {
    const data = await loadCases();
    const { description, schema } = data.entry.config;
    const ctx = createContext(data.entry, data.name);

    await agents.provider.loadArchive(ctx);

    // 只写这两个文件，名字带固定后缀，读取时靠 fuzzy 前缀匹配
    expect(Object.keys(ctx.cur).sort()).toEqual([
      `${data.name}.desc.txt`,
      `${data.name}.schema.json`,
    ]);
    expect(await archives.get.text(ctx.cur, `${data.name}.desc.txt`)).toBe(
      description,
    );
    expect(await archives.get.text(ctx.cur, `${data.name}.schema.json`)).toBe(
      schema,
    );
    // 主 json 里不再保留这两个字段
    expect(data.entry.config.description).toBeUndefined();
    expect(data.entry.config.schema).toBeUndefined();
  });

  it('应当导出配置里的模型并追加预设依赖', async () => {
    const data = await loadCases();
    const ctx = createContext(data.entry, data.name);

    await agents.provider.loadArchive(ctx);

    expect(mocks.exportArchive).toHaveBeenCalledWith(
      ctx,
      data.entry.config.model.value,
    );
    expect(mocks.append.mock.calls.map((u) => u[0])).toEqual(
      data.entry.config.presets.map((u: any) => u.value),
    );
  });

  it('没有预设时不追加依赖', async () => {
    const data = await loadCases();
    data.entry.config.presets = [];
    const ctx = createContext(data.entry, data.name);

    await agents.provider.loadArchive(ctx);

    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.exportArchive).toHaveBeenCalledWith(ctx, 'model-a');
  });

  it('没有选模型时导出收到 undefined', async () => {
    const data = await loadCases();
    (data.entry.config as AgentConfig).model = null;
    const ctx = createContext(data.entry, data.name);

    await agents.provider.loadArchive(ctx);

    expect(mocks.exportArchive).toHaveBeenCalledWith(ctx, undefined);
  });
});

describe('agents server / saveArchive', () => {
  it('应当按前缀取回归档内容写回配置并导入模型', async () => {
    const data = await loadCases();
    const ctx = createContext(data.entry, data.name);
    archives.set.text(ctx.cur, `${data.name}.desc.txt`, '恢复的描述');
    archives.set.text(
      ctx.cur,
      `${data.name}.schema.json`,
      '{"type":"object","title":"恢复"}',
    );

    await agents.provider.saveArchive(ctx);

    expect(data.entry.config.description).toBe('恢复的描述');
    expect(data.entry.config.schema).toBe('{"type":"object","title":"恢复"}');
    expect(mocks.importArchive).toHaveBeenCalledWith(ctx, 'model-a');
  });

  it('归档里没有对应文件时字段为 undefined', async () => {
    const data = await loadCases();
    const ctx = createContext(data.entry, data.name);

    await agents.provider.saveArchive(ctx);

    expect(data.entry.config.description).toBeUndefined();
    expect(data.entry.config.schema).toBeUndefined();
    expect(mocks.importArchive).toHaveBeenCalledWith(ctx, 'model-a');
  });

  it('loadArchive 写出的内容应当能被 saveArchive 取回', async () => {
    const data = await loadCases();
    const { description, schema } = data.entry.config;
    const ctx = createContext(data.entry, data.name);

    await agents.provider.loadArchive(ctx);
    await agents.provider.saveArchive(ctx);

    expect(data.entry.config.description).toBe(description);
    expect(data.entry.config.schema).toBe(schema);
  });
});
