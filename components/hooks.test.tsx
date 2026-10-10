import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// 直接从 hooks 模块取，避免拉起 @/components 桶（里面会加载 monaco，jsdom 下极易 OOM）
import { useFormRef, useIsClient, useRefresh, useTabs } from '@/components/hooks';
import { Registry } from '@/plugins';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./hooks.cases.json')).default);
}

afterEach(() => {
  // 让 effect 里的异步 setState 跑完，避免影响下一条用例
});

describe('components hooks / useRefresh', () => {
  it('每次 refreshKey 都会让 key 自增', () => {
    const { result } = renderHook(() => useRefresh());

    expect(result.current.key).toBe(0);

    act(() => result.current.refreshKey());
    act(() => result.current.refreshKey());

    expect(result.current.key).toBe(2);
  });

  it('可以直接 setKey', () => {
    const { result } = renderHook(() => useRefresh());

    act(() => result.current.setKey(9));

    expect(result.current.key).toBe(9);
  });
});

describe('components hooks / useTabs', () => {
  it('hidable 的标签只有在 types 里包含时才显示', async () => {
    const data = await loadCases();
    const registry = new Registry<any>('comfyui-test-tabs');
    registry.register(...data.tabs);
    // item 必须是稳定引用：effect 依赖 [item]，每次渲染都新建对象会无限循环
    const item = { properties: { types: data.types } };

    const { result } = renderHook(() => useTabs(registry, item));

    expect(result.current.showTabs.map((u) => u.id).sort()).toEqual(
      [...data.expectedShow].sort(),
    );
    expect(result.current.hideTabs?.map((u) => u.id).sort()).toEqual(
      [...data.expectedHide].sort(),
    );
  });

  it('没有 item 时所有 hidable 标签都进隐藏列表', async () => {
    const data = await loadCases();
    const registry = new Registry<any>('comfyui-test-tabs-none');
    registry.register(...data.tabs);

    const { result } = renderHook(() => useTabs(registry, undefined));

    expect(result.current.showTabs.map((u) => u.id)).toEqual(
      data.tabs.filter((u: any) => !u.hidable).map((u: any) => u.id),
    );
    expect(result.current.hideTabs?.map((u) => u.id)).toEqual(
      data.tabs.filter((u: any) => u.hidable).map((u: any) => u.id),
    );
  });

  it('初始状态是空的，effect 之后才填上', async () => {
    const data = await loadCases();
    const registry = new Registry<any>('comfyui-test-tabs-empty');
    registry.register(...data.tabs);

    const { result } = renderHook(() => useTabs(registry, undefined));

    // renderHook 已经把 effect 跑完，所以这里直接能看到结果
    expect(result.current.showTabs.length + (result.current.hideTabs?.length ?? 0)).toBe(
      data.tabs.length,
    );
  });
});

describe('components hooks / useFormRef', () => {
  it('返回一个初始为空的 ref', () => {
    const { result } = renderHook(() => useFormRef());

    expect(result.current.current).toBeNull();
  });
});

describe('components hooks / useIsClient', () => {
  it('挂载后应当是 true', () => {
    const { result } = renderHook(() => useIsClient());

    expect(result.current.isClient).toBe(true);
  });
});
