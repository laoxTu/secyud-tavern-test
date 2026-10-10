import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIsMobile } from '@/hooks/use-mobile';

const BREAKPOINT = 768;

/** jsdom 没有 matchMedia，这里按用例需要伪造一个可控的 MediaQueryList */
function stubMatchMedia() {
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  const mql = {
    matches: false,
    media: '',
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
  const matchMedia = vi.fn((query: string) => {
    queries.push(query);
    mql.media = query;
    return mql;
  });
  (window as any).matchMedia = matchMedia;
  return { matchMedia, mql, listeners, queries };
}

/** jsdom 的 innerWidth 是只读访问器，这里直接重定义 */
function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

beforeEach(() => {
  setWidth(1024);
});

afterEach(() => {
  delete (window as any).matchMedia;
  vi.restoreAllMocks();
});

describe('useIsMobile', () => {
  it('应当用断点减一的宽度作为媒体查询', () => {
    const { queries } = stubMatchMedia();

    renderHook(() => useIsMobile());

    expect(queries).toEqual([`(max-width: ${BREAKPOINT - 1}px)`]);
  });

  it('宽屏时返回 false，窄屏时返回 true', () => {
    stubMatchMedia();
    setWidth(1024);

    const desktop = renderHook(() => useIsMobile());
    expect(desktop.result.current).toBe(false);

    setWidth(BREAKPOINT - 1);
    const mobile = renderHook(() => useIsMobile());
    expect(mobile.result.current).toBe(true);
  });

  it('窗口变化事件触发后应当重新计算', () => {
    const { listeners } = stubMatchMedia();
    setWidth(1024);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setWidth(375);
      listeners.forEach((listener) => listener());
    });

    expect(result.current).toBe(true);
  });

  it('返回值始终是布尔值', () => {
    stubMatchMedia();

    const { result } = renderHook(() => useIsMobile());

    expect(typeof result.current).toBe('boolean');
  });

  it('卸载时应当移除事件监听', () => {
    const { listeners } = stubMatchMedia();

    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.size).toBe(1);

    unmount();

    expect(listeners.size).toBe(0);
  });
});
