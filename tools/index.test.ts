import { describe, expect, it } from 'vitest';

import { presets } from '@/presets';
import * as main from '@/tools';
import { tools } from '@/tools';
import { variables } from '@/tools/variables';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./index.cases.json')).default);
}

describe('tools / 常量', () => {
  it('运行期只导出 tools 常量（Tool / ToolCall 是纯类型）', async () => {
    const data = await loadCases();

    expect(Object.keys(main).sort()).toEqual(data.exports);
  });

  it('name 与 plural 应当保持单复数对应', async () => {
    const data = await loadCases();

    expect(tools.name).toBe(data.name);
    expect(tools.plural).toBe(data.plural);
    expect(tools.plural).toBe(`${tools.name}s`);
  });

  it('预设的 tag 列表应当包含工具名，工具条目才挂得上', () => {
    expect(presets.tags).toContain(tools.name);
  });

  it('默认工具应当指向 variable 类型并带空配置', async () => {
    const data = await loadCases();

    expect(tools.default).toEqual(data.default);
  });

  it('默认工具的 type 应当能对应上变量工具的注册 id', () => {
    // 默认工具类型和 client provider 的 id 是同一个注册键，改一边就会找不到提供者
    expect(tools.default.type).toBe(variables.name);
  });
});
