import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./cn.cases.json')).default);
}

describe('cn / 类名合并', () => {
  it('应当按 clsx 规则拼接、按 tailwind-merge 规则消解冲突', async () => {
    const { cases } = await loadCases();

    for (const item of cases) {
      expect(cn(...(item.inputs as any[])), item.name).toBe(item.expected);
    }
  });

  it('返回值应当是字符串而不是数组', async () => {
    const { cases } = await loadCases();

    for (const item of cases) {
      expect(typeof cn(...(item.inputs as any[])), item.name).toBe('string');
    }
  });
});
