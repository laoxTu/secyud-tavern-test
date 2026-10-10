import { afterEach, describe, expect, it, vi } from 'vitest';

import { strUtils } from '@/utils';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./str.cases.json')).default);
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((u) => u.toString(16).padStart(2, '0'))
    .join('');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('strUtils / random', () => {
  it('应当按长度与字符集生成随机串（用 mock 固定随机数）', async () => {
    const data = await loadCases();

    for (const item of data.random) {
      vi.spyOn(Math, 'random').mockReturnValue(item.random);

      expect(
        strUtils.random(item.length, item.charset ?? data.defaultCharset),
        item.name,
      ).toBe(item.expected);
      vi.restoreAllMocks();
    }
  });

  it('默认字符集是小写字母加数字', async () => {
    const data = await loadCases();
    const chars = new Set(data.defaultCharset);

    const value = strUtils.random(64);

    expect(value).toHaveLength(64);
    for (const char of value) {
      expect(chars.has(char)).toBe(true);
    }
  });

  it('连续两次调用不应得到同一个串', async () => {
    const first = strUtils.random(32);
    const second = strUtils.random(32);

    expect(first).not.toBe(second);
  });
});

describe('strUtils / fnv1a64Bytes', () => {
  it('应当与 FNV-1a 64 位参考值一致', async () => {
    const { fnv } = await loadCases();

    for (const item of fnv) {
      expect(hex(strUtils.fnv1a64Bytes(item.text)), item.name).toBe(item.hex);
    }
  });

  it('结果应当是 8 字节且可重复', async () => {
    const { fnv } = await loadCases();
    const [, single] = fnv;

    const first = strUtils.fnv1a64Bytes(single.text);

    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toHaveLength(8);
    expect(hex(strUtils.fnv1a64Bytes(single.text))).toBe(hex(first));
  });

  it('不同输入应当得到不同结果', async () => {
    const { fnv } = await loadCases();

    const values = new Set(fnv.map((u) => hex(strUtils.fnv1a64Bytes(u.text))));

    expect(values.size).toBe(fnv.length);
  });
});

describe('strUtils / wrap', () => {
  // pad 只加在文本上，模板接到的还是「pad + 文本」本身；换行后的**每一行**都要补 pad
  it('应当把 pad 交给模板，并给换行后的每一行都补上 pad', async () => {
    const { wrap } = await loadCases();

    for (const item of wrap) {
      expect(
        strUtils.wrap((text) => `<${text}>`, item.text, item.pad),
        item.name,
      ).toBe(item.expected);
    }
  });

  it('三行文本时第三行也要带上 pad', () => {
    // 修复前 replace('\n') 只替换第一个换行，第三行起没有前缀
    expect(strUtils.wrap((t) => `<${t}>`, 'a\nb\nc', '> ')).toBe(
      '<> a\n> b\n> c>',
    );
  });
});

describe('strUtils / buffer', () => {
  it('字符串原样返回，二进制解码为 utf8 文本', async () => {
    const { buffer } = await loadCases();

    for (const item of buffer) {
      expect(strUtils.buffer(item.text), item.name).toBe(item.expected);
    }
  });

  it('ArrayBuffer 与 Buffer 都应当按 utf8 解码', async () => {
    const { buffer } = await loadCases();
    const [first] = buffer;
    const encoded = strUtils.toBuffer(first.text);

    expect(strUtils.buffer(encoded)).toBe(first.expected);
    expect(
      strUtils.buffer(
        encoded.buffer.slice(
          encoded.byteOffset,
          encoded.byteOffset + encoded.byteLength,
        ) as ArrayBuffer,
      ),
    ).toBe(first.expected);
  });

  it('没有入参时得到空串', () => {
    expect(strUtils.buffer(undefined)).toBe('');
  });

  it('toBuffer 与 buffer 应当互为反向', async () => {
    const { buffer } = await loadCases();

    for (const item of buffer) {
      const encoded = strUtils.toBuffer(item.text);

      expect(Buffer.isBuffer(encoded)).toBe(true);
      expect(strUtils.buffer(encoded)).toBe(item.expected);
    }
  });

  it('没有文本时 toBuffer 应当是空 buffer', () => {
    expect(strUtils.toBuffer(undefined)).toHaveLength(0);
  });
});
