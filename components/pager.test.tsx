import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// pager 是从桶里取这些基础组件的；真实桶会加载 monaco，这里全部换成可断言的桩
vi.mock('@/components', () => {
  const pick = (props: any, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, props[key]]));
  const wrapper =
    (tag: string, extra: string[] = []) =>
    ({ children, ...props }: any) =>
      React.createElement(
        tag,
        { ...pick(props, extra), 'data-props': JSON.stringify(pick(props, extra)) },
        children,
      );

  return {
    Pagination: wrapper('div', ['className']),
    PaginationContent: wrapper('ul'),
    PaginationItem: wrapper('li'),
    PaginationLink: wrapper('button', ['isActive', 'onClick', 'className']),
    PaginationPrevious: wrapper('button', ['onClick', 'className', 'aria-disabled']),
    PaginationNext: wrapper('button', ['onClick', 'className', 'aria-disabled']),
    PaginationEllipsis: () => React.createElement('span', null, '…'),
    Item: ({ children, ...props }: any) =>
      React.createElement(
        'div',
        {
          'data-item': 'true',
          'data-props': JSON.stringify(
            pick(props, ['className', 'onClick', 'variant', 'role']),
          ),
          onClick: props.onClick,
        },
        children,
      ),
    EmptyEntries: ({ module }: any) =>
      React.createElement('div', { 'data-empty': 'true' }, module),
  };
});
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { PagedItemList, PaginationWrapper } from '@/components/pager';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./pager.cases.json')).default);
}

/** 造一个可控的 pager 状态 */
function createPager(state?: Record<string, any>) {
  const refresh = vi.fn(async () => {});
  const usePager = Object.assign(
    () => ({
      items: undefined,
      loading: false,
      max: 10,
      cur: 0,
      size: 5,
      refresh,
      ...state,
    }),
    {},
  );
  return { usePager, refresh };
}

/** 当前渲染出来的页码按钮文案（省略号是 …） */
function pageLabels() {
  return screen
    .getAllByRole('button')
    .map((u) => u.textContent)
    .filter((u) => u !== '');
}

function paginationProps(tag: string, index = 0) {
  const nodes = document.querySelectorAll(tag);
  return JSON.parse(nodes[index].getAttribute('data-props') ?? '{}');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('components pager / 页码范围', () => {
  it('页码数量与可见数有关，且首尾页一定在列表里', async () => {
    const data = await loadCases();

    for (const item of data.ranges) {
      document.body.innerHTML = '';
      const { usePager } = createPager({ cur: item.cur, max: item.max });

      render(
        <PaginationWrapper
          usePager={usePager as any}
          pageVisibleCount={item.cnt}
        />,
      );

      const labels = pageLabels().filter((u) => u !== '…');
      const numbers = labels.map((u) => Number(u));

      if (item.max === 0) {
        expect(numbers, item.name).toEqual([]);
        continue;
      }

      // 首尾页始终可见
      expect(numbers, item.name).toContain(1);
      expect(numbers, item.name).toContain(item.max);
      // 不越界
      for (const value of numbers) {
        expect(value, item.name).toBeGreaterThanOrEqual(1);
        expect(value, item.name).toBeLessThanOrEqual(item.max);
      }
      // 最多 cnt + 两个省略号
      expect(labels.length, item.name).toBeLessThanOrEqual(item.cnt + 2);
    }
  });

  it('页数不超过可见数时应当把每一页都列出来', async () => {
    const data = await loadCases();
    const { usePager } = createPager({ cur: 1, max: 5 });

    render(
      <PaginationWrapper
        usePager={usePager as any}
        pageVisibleCount={data.pageVisibleCount}
      />,
    );

    expect(pageLabels()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('没有数据时只渲染空壳', async () => {
    const { usePager } = createPager({ max: 0, cur: 0 });

    render(<PaginationWrapper usePager={usePager as any} />);

    expect(pageLabels()).toEqual([]);
    expect(screen.queryByText('…')).toBeNull();
  });
});

describe('components pager / 交互', () => {
  it('点击页码应当请求对应页', async () => {
    const data = await loadCases();
    const { usePager, refresh } = createPager({ cur: 1, max: 5 });

    render(
      <PaginationWrapper
        usePager={usePager as any}
        pageVisibleCount={data.pageVisibleCount}
      />,
    );
    fireEvent.click(screen.getByText('4'));

    expect(refresh).toHaveBeenCalledWith({ page: 3 });
  });

  it('点击当前页不应该重复请求', async () => {
    const { usePager, refresh } = createPager({ cur: 2, max: 5 });

    render(<PaginationWrapper usePager={usePager as any} />);
    fireEvent.click(screen.getByText('3'));

    expect(refresh).not.toHaveBeenCalled();
  });

  it('上一页 / 下一页应当请求相邻页', async () => {
    const { usePager, refresh } = createPager({ cur: 2, max: 5 });

    render(<PaginationWrapper usePager={usePager as any} />);

    // 第一个按钮是上一页，最后一个是下一页（中间是 1..5 的页码）
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(refresh).toHaveBeenLastCalledWith({ page: 1 });

    fireEvent.click(buttons[buttons.length - 1]);
    expect(refresh).toHaveBeenLastCalledWith({ page: 3 });
  });

  it('第一页的上一页被禁用且点击无效', async () => {
    const { usePager, refresh } = createPager({ cur: 0, max: 3 });

    render(<PaginationWrapper usePager={usePager as any} />);

    expect(paginationProps('button', 0)['aria-disabled']).toBe(true);
    expect(paginationProps('button', 0).className).toContain(
      'pointer-events-none',
    );

    fireEvent.click(screen.getAllByRole('button')[0]);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('最后一页的下一页被禁用且点击无效', async () => {
    const { usePager, refresh } = createPager({ cur: 2, max: 3 });

    render(<PaginationWrapper usePager={usePager as any} />);

    const buttons = screen.getAllByRole('button');
    const last = paginationProps('button', buttons.length - 1);

    expect(last['aria-disabled']).toBe(true);
    expect(last.className).toContain('pointer-events-none');

    fireEvent.click(buttons[buttons.length - 1]);

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('components pager / PagedItemList', () => {
  it('挂载时应当刷新并调用 initialized', async () => {
    const data = await loadCases();
    const { usePager, refresh } = createPager({ items: data.items });
    const initialized = vi.fn(async () => {});

    render(
      <PagedItemList
        usePager={usePager as any}
        initialized={initialized}
        id="a"
      >
        {(item: any) => <span key={item.entryId}>{item.name}</span>}
      </PagedItemList>,
    );

    await waitFor(() => expect(initialized).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('id 变化时会重新刷新', async () => {
    const data = await loadCases();
    const { usePager, refresh } = createPager({ items: data.items });

    const { rerender } = render(
      <PagedItemList usePager={usePager as any} id="a">
        {(item: any) => <span>{item.name}</span>}
      </PagedItemList>,
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    rerender(
      <PagedItemList usePager={usePager as any} id="b">
        {(item: any) => <span>{item.name}</span>}
      </PagedItemList>,
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it('应当为每个条目渲染 children', async () => {
    const data = await loadCases();
    const { usePager } = createPager({ items: data.items });

    render(
      <PagedItemList usePager={usePager as any}>
        {(item: any) => <span key={item.entryId}>{item.name}</span>}
      </PagedItemList>,
    );

    for (const item of data.items) {
      expect(screen.getByText(item.name)).toBeTruthy();
    }
  });

  it('custom 为真时不用 Item 包裹，否则每个条目都走 Item', async () => {
    const data = await loadCases();
    const custom = createPager({ items: data.items });

    const { unmount } = render(
      <PagedItemList usePager={custom.usePager as any} custom>
        {(item: any) => <span>{item.name}</span>}
      </PagedItemList>,
    );
    expect(document.querySelectorAll('[data-item="true"]')).toHaveLength(0);
    unmount();

    const normal = createPager({ items: data.items });
    render(
      <PagedItemList usePager={normal.usePager as any}>
        {(item: any) => <span>{item.name}</span>}
      </PagedItemList>,
    );
    expect(document.querySelectorAll('[data-item="true"]')).toHaveLength(
      data.items.length,
    );
  });

  it('onClick 应当把条目回传出去', async () => {
    const data = await loadCases();
    const { usePager } = createPager({ items: data.items });
    const onClick = vi.fn();

    render(
      <PagedItemList usePager={usePager as any} onClick={onClick}>
        {(item: any) => <span>{item.name}</span>}
      </PagedItemList>,
    );
    fireEvent.click(screen.getByText(data.items[1].name));

    expect(onClick).toHaveBeenCalledWith(data.items[1]);
  });

  it('没有条目时渲染空状态而不是列表', async () => {
    const { usePager } = createPager({ items: [] });

    render(
      <PagedItemList usePager={usePager as any} entryName="default.story">
        {() => <span>never</span>}
      </PagedItemList>,
    );

    expect(document.querySelector('[data-empty="true"]')?.textContent).toBe(
      'default.story',
    );
  });
});
