import { describe, expect, it } from 'vitest';

import { tools } from '@/tools';
import * as main from '@/tools/variables';
import { variables } from '@/tools/variables';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

describe('tools variables / 常量', () => {
  it('运行期只导出 variables 常量', async () => {
    const data = await loadCases();

    expect(Object.keys(main).sort()).toEqual(data.exports);
  });

  it('name 应当是变量工具的注册键', async () => {
    const data = await loadCases();

    expect(variables.name).toBe(data.name);
  });

  it('name 应当能被默认工具直接引用', async () => {
    const data = await loadCases();

    // 新建的工具条目默认是 type=variable，provider 找不到就会被跳过
    expect(tools.default.type).toBe(data.name);
    expect(variables.name).toBe(tools.default.type);
  });
});
