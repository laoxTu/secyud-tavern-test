import { describe, expect, it, vi } from 'vitest';

import { memories as main } from '@/memories';
import { memories } from '@/memories/client';
import type { RealmOutput } from '@/stories';

// 设置持久化会走请求层，这里整体替换掉，避免用例里出现真实请求
vi.mock('@/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 只关心 properties 的输出消息 */
function createOutput(properties?: Record<string, any>) {
  return {
    content: '',
    thought: '',
    variables: [],
    ...(properties ? { properties } : {}),
  } as unknown as RealmOutput;
}

describe('memories / 模块常量', () => {
  it('注册表用的 name 与条目的复数键应当保持不变', async () => {
    const data = await loadCases();

    expect(main.name).toBe(data.moduleInfo.name);
    expect(main.plural).toBe(data.moduleInfo.plural);
  });

  it('可选的内容类型应当与约定列表一致', async () => {
    const data = await loadCases();

    expect(main.types).toEqual(data.types);
  });

  it('默认条目应当是不可变的基础值', async () => {
    const data = await loadCases();

    expect(main.default).toEqual(data.defaultEntry);
  });

  it('client 侧应当继承主模块的常量', () => {
    expect(memories.name).toBe(main.name);
    expect(memories.plural).toBe(main.plural);
    expect(memories.types).toEqual(main.types);
    expect(memories.default).toBe(main.default);
  });
});

describe('memories / codes', () => {
  it('create 默认开启，未设置时应当写入空数组', () => {
    const output = createOutput();

    expect(memories.codes(output)).toEqual([]);
    expect(output.properties!.memory).toEqual([]);
  });

  it('create 开启后应当复用同一个数组', () => {
    const output = createOutput();

    const first = memories.codes(output, true);
    const second = memories.codes(output, true);

    expect(first).toBe(second);
    expect(first).toBe(output.properties!.memory);
  });

  it('create 关闭时未设置应当返回 undefined 且不写入数组', () => {
    const output = createOutput();

    expect(memories.codes(output, false)).toBeUndefined();
    expect(output.properties!.memory).toBeUndefined();
  });

  it('已有编码时两种模式都应当返回原数组', async () => {
    const data = await loadCases();
    const output = createOutput({
      memory: structuredClone(data.codes.existing),
    });

    expect(memories.codes(output, false)).toBe(output.properties!.memory);
    expect(memories.codes(output, true)).toBe(output.properties!.memory);
    expect(output.properties!.memory).toEqual(data.codes.existing);
  });

  it('没有 properties 时应当补一个空对象再写入', () => {
    const output = createOutput();

    expect(memories.codes(output, true)).toEqual([]);
    expect(output.properties).toEqual({ memory: [] });
  });

  it('message 缺失时应当返回 undefined', () => {
    expect(memories.codes(undefined as any, true)).toBeUndefined();
    expect(memories.codes(undefined as any, false)).toBeUndefined();
  });

  it('写入的编码可以被后续追加', async () => {
    const data = await loadCases();
    const output = createOutput({ memory: structuredClone(data.codes.existing) });

    memories.codes(output)!.push(data.codes.appended);

    expect(output.properties!.memory).toEqual([
      ...data.codes.existing,
      data.codes.appended,
    ]);
  });
});
