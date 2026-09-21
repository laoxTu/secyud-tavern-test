import { afterEach, describe, expect, it, vi } from 'vitest';

import { generatePrompt } from '@/comfyui/editor/client/generator';

import poolsJson from './prompt.pools.json';

type GenerateItem = [string, number] | [string];

/**
 * TypeScript 读 JSON 时会把数组推断成 string[][] 或 (string | number)[][],
 * 不保留 generator 需要的元组结构，所以这里断言成源文件的 Record 格式；
 * JSON 文件本身保持纯数据，方便和素材互相对照。
 */
const pools = poolsJson as unknown as Record<string, GenerateItem[]>;

/**
 * 依次返回给定的随机数，用尽后返回最后一个。
 * 每次抽取恰好消耗一个随机数（概率门槛也只有一个），
 * 因此可以精确控制每一步：选哪一个池、每一个池里选哪一项。
 */
function mockRandom(...values: number[]): void {
  let index = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    return values[Math.min(index++, values.length - 1)];
  });
}

/** 总和为 total 且只有第一项有权重，因此恒选中第一项。 */
function pickFirst(total = 1): void {
  mockRandom(0, ...Array.from({ length: total }, () => 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('comfyui generatePrompt', () => {
  describe('替换', () => {
    it('应当用池里的内容替换占位符', () => {
      pickFirst();

      expect(generatePrompt('{color}', { color: [['red']] })).toBe('red');
    });

    it('同一段文本里的占位符应当各自替换', () => {
      mockRandom(0.99);

      expect(generatePrompt('{a}-{b}', { a: [['1']], b: [['2']] })).toBe('1-2');
    });

    it('没有占位符时应当原样返回', () => {
      expect(generatePrompt('plain text', {})).toBe('plain text');
    });

    it('池里不存在 key 时应当保留占位符', () => {
      expect(generatePrompt('{unknown}', { a: [['1']] })).toBe('{unknown}');
    });

    it('池为空数组时应当保留占位符', () => {
      expect(generatePrompt('{empty}', { empty: [] })).toBe('{empty}');
    });

    it('递归无限时应当在深度上限处停下', () => {
      // 池里只有引用自己的内容，Math.random 为 0 时必然选中它
      pickFirst();
      const result = generatePrompt('{loop}', { loop: [['{loop}']] });

      // 深度超过 100 后不再展开，返回该层的原文
      expect(result).toContain('{loop}');
    });
  });

  describe('权重', () => {
    it('随机数为 0 时应当选中第一项', () => {
      pickFirst();

      expect(generatePrompt('{x}', { x: [['first'], ['second']] })).toBe(
        'first',
      );
    });

    it('随机数接近 1 时应当选中最后一项', () => {
      mockRandom(0.99);

      expect(generatePrompt('{x}', { x: [['first'], ['second']] })).toBe(
        'second',
      );
    });

    it('不写权重时默认为 1', () => {
      const json: Record<string, GenerateItem[]> = {
        x: [['a'], ['b']],
      };
      // 两项各占一半：0.5 落在第二项，0.49 落在第一项
      mockRandom(0.5);
      expect(generatePrompt('{x}', json)).toBe('b');
      mockRandom(0.49);
      expect(generatePrompt('{x}', json)).toBe('a');
    });

    it('应当按权重切分随机区间', () => {
      const json: Record<string, GenerateItem[]> = {
        x: [
          ['light', 1],
          ['heavy', 9],
        ],
      };
      // 总分 10：0.09 -> light，0.1 -> heavy
      mockRandom(0.09);
      expect(generatePrompt('{x}', json)).toBe('light');
      mockRandom(0.1);
      expect(generatePrompt('{x}', json)).toBe('heavy');
    });
  });

  describe('概率门槛', () => {
    it('{key:0.7} 在随机数小于 0.7 时保留内容', () => {
      // 第一个随机数过门槛，第二个随机数从池里选中第一项
      mockRandom(0.69, 0);

      expect(generatePrompt('a{blush:0.7}b', { blush: [['blush']] })).toBe(
        'ablushb',
      );
    });

    it('{key:0.7} 在随机数不小于 0.7 时整体删除', () => {
      mockRandom(0.7);

      expect(generatePrompt('a{blush:0.7}b', { blush: [['blush']] })).toBe(
        'ab',
      );
    });

    it('门槛不过时不应当继续解析后面的内容', () => {
      mockRandom(0.99);
      const json: Record<string, GenerateItem[]> = { inner: [['inner']] };

      expect(generatePrompt('{out:0.5}{inner}', json)).toBe('inner');
    });

    it('{key:1} 恒成立', () => {
      mockRandom(0.999, 0);

      expect(generatePrompt('{x:1}', { x: [['ok']] })).toBe('ok');
    });
  });

  describe('真实素材', () => {
    const template = pools._template[0][0];

    /** 三个可选池的标记文本，抽得到就说明门槛放行。 */
    const optional = ['gold necklace', 'blushing cheeks', 'wide sleeves'];

    it('素材应当覆盖模板引用的所有 key', () => {
      const keys = new Set(Object.keys(pools));
      const referenced = new Set<string>();

      for (const value of Object.values(pools)) {
        for (const [content] of value) {
          for (const match of content.matchAll(/\{([^{}]*)\}/g)) {
            referenced.add(match[1].split(':')[0]);
          }
        }
      }

      expect(referenced.size).toBeGreaterThan(20);
      for (const key of referenced) {
        expect(keys, `缺少 key：${key}`).toContain(key);
      }
    });

    it('每个池都应当有非空的字符串内容和正权重', () => {
      const entries = Object.entries(pools);
      expect(entries).toHaveLength(30);

      for (const [key, value] of entries) {
        expect(value.length, key).toBeGreaterThan(0);
        for (const [content, weight] of value) {
          expect(typeof content, key).toBe('string');
          expect(content.length, key).toBeGreaterThan(0);
          if (weight !== undefined) expect(weight, key).toBeGreaterThan(0);
        }
      }
    });

    it('生成的提示词应当被完全展开', () => {
      for (let i = 0; i < 50; i++) {
        const result = generatePrompt(template, pools);

        // 还有花括号说明某个占位符没被解析掉
        expect(result, `第 ${i} 次：${result}`).not.toMatch(/[{}]/);
        expect(result).toContain(',');
      }
    });

    it('概率门槛会让可选内容时有时无', () => {
      const results = Array.from({ length: 50 }, () =>
        generatePrompt(template, pools),
      );
      const text = results.join('\n');

      // 全有或全无都说明门槛没生效
      for (const marker of optional) {
        expect(text).toContain(marker);
      }
      expect(results.some((result) => !result.includes(optional[0]))).toBe(
        true,
      );
    });
  });
});
