import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Preset } from '@/presets';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@/client', () => ({
  get: mocks.get,
  post: mocks.post,
  put: mocks.put,
  del: mocks.del,
  open: mocks.open,
}));

import { createPresetEntryState } from '@/presets/client/factory';
import { usePresetState } from '@/presets/client/state';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./fixtures.json')).default);
}

beforeEach(async () => {
  const data = await loadData();
  vi.clearAllMocks();
  usePresetState.setState({ item: data.preset as Preset });
});

describe('presets client factory / 初始状态', () => {
  it('应当带上名称、默认数据与分页参数', async () => {
    const data = await loadData();
    const store = createPresetEntryState('macros', data.defaultData);
    const state = store.getState();

    expect(state.name).toBe('macros');
    expect(state.defaultData).toEqual(data.defaultData);
    expect(state.size).toBe(data.entryPageSize);
    expect(state.cur).toBe(0);
    expect(state.max).toBe(0);
    expect(state.loading).toBe(false);
  });
});

describe('presets client factory / fetch', () => {
  it('应当按当前预设请求条目，并固定带上 entryType', async () => {
    const data = await loadData();
    const store = createPresetEntryState('macros', data.defaultData);
    mocks.get.mockResolvedValue(data.entryResponse);

    await store.getState().refresh({ size: 2, page: 2 });

    const [url, options] = mocks.get.mock.calls[0];
    expect(url).toBe('presets/{id}/entries');
    expect(options.params).toEqual({
      id: data.preset.id,
      size: 2,
      skip: 4,
      search: { entryType: 'macros' },
    });
    expect(store.getState().items).toEqual(data.entryResponse.items);
    expect(store.getState().max).toBe(1);
  });

  it('entryType 应当覆盖外部传入的同名字段', async () => {
    const data = await loadData();
    const store = createPresetEntryState('macros', data.defaultData);
    mocks.get.mockResolvedValue(data.emptyResponse);

    // refresh 运行时会转发给 fetch，search 在这里是「按旧值求新值」的函数，
    // 但 PagedItemsState.refresh 的签名只声明了分页字段，这里按真实行为收窄
    await (
      store.getState().refresh as (options: {
        search: (search: any) => any;
      }) => Promise<void>
    )({
      search: () => data.overrideSearch,
    });

    expect(mocks.get.mock.calls[0][1].params.search).toEqual({
      entryType: 'macros',
      filter: data.overrideSearch.filter,
    });
  });

  it('不同条目类型应当各自请求自己的 entryType', async () => {
    const data = await loadData();
    const store = createPresetEntryState('styles', data.defaultData);
    mocks.get.mockResolvedValue(data.emptyResponse);

    await store.getState().refresh();

    expect(mocks.get.mock.calls[0][1].params.search).toEqual({
      entryType: 'styles',
    });
  });

  it('请求失败时应当抛出且结束 loading', async () => {
    const data = await loadData();
    const store = createPresetEntryState('macros', data.defaultData);
    mocks.get.mockRejectedValue(new Error('boom'));

    await expect(store.getState().refresh()).rejects.toThrow('boom');

    expect(store.getState().loading).toBe(false);
  });
});
