import { describe, expect, it, vi } from 'vitest';

import { models } from '@/models/client';
import type { ConvertContent } from '@/models/client';
import type { Realm } from '@/stories';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

/** 转换器只能是函数，用名字在代码里映射，数据仍旧从 fixture 取 */
const converters: Record<string, ConvertContent> = {
  upper: async (text) => text.toUpperCase(),
  bracket: async (text) => `[${text}]`,
  appendSpace: async (text) => `${text} `,
};

function toConverters(steps: string[]) {
  return steps.map((step) => converters[step]);
}

describe('models / convert', () => {
  it('应该按顺序应用转换器并只对最终结果去空白', async () => {
    const data = await loadCases();

    for (const item of data.convert) {
      expect(
        await models.convert(
          toConverters(item.steps),
          item.text,
          data.context as any,
        ),
        item.name,
      ).toBe(item.expected);
    }
  });

  it('应当把上下文原样交给每个转换器', async () => {
    const data = await loadCases();
    const first = vi.fn(async (text: string) => text);
    const second = vi.fn(async (text: string) => text);

    await models.convert([first, second], data.convert[0].text, data.context as any);

    expect(first).toHaveBeenCalledWith(data.convert[0].text, data.context);
    // 后一个转换器收到的是前一个的返回值
    expect(second).toHaveBeenCalledWith(data.convert[0].text, data.context);
  });

  it('前一个转换器的输出应当作为后一个的输入', async () => {
    const seen: string[] = [];
    const record =
      (tag: string): ConvertContent =>
      async (text) => {
        seen.push(`${tag}:${text}`);
        return `${text}${tag}`;
      };

    expect(await models.convert([record('a'), record('b')], 'x', {} as any)).toBe(
      'xab',
    );
    expect(seen).toEqual(['a:x', 'b:xa']);
  });
});

describe('models / key', () => {
  it('缓存键应当带模块前缀', async () => {
    const { keys } = await loadCases();

    for (const item of keys) {
      expect(models.key(item.input)).toBe(item.expected);
    }
  });
});

describe('models / cache', () => {
  it('应当从 realm.context 上按 key 取缓存', () => {
    const cache = { anything: true };
    const realm = { context: { 'model.test': cache } } as unknown as Realm;

    expect(models.cache(realm, 'test')).toBe(cache);
  });

  it('未初始化时应当抛出 realm 上下文错误', () => {
    const realm = { context: {} } as unknown as Realm;

    expect(() => models.cache(realm, 'test')).toThrow(/not initialized/);
  });
});
