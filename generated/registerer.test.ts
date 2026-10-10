import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const order: string[] = [];
  const make = (name: string) =>
    vi.fn(async () => {
      order.push(name);
    });
  return {
    order,
    client: {
      database: make('database'),
      comfyui: make('comfyui'),
      files: make('files'),
      global: make('global'),
      lorebooks: make('lorebooks'),
      memories: make('memories'),
      models: make('models'),
      presets: make('presets'),
      signal: make('signal'),
      stories: make('stories'),
      tools: make('tools'),
      importer: make('importer'),
      tasks: make('tasks'),
    },
    server: {
      interceptors: make('server:interceptors'),
      comfyui: make('server:comfyui'),
      lorebooks: make('server:lorebooks'),
      memories: make('server:memories'),
      models: make('server:models'),
      presets: make('server:presets'),
      stories: make('server:stories'),
      tools: make('server:tools'),
      tasks: make('server:tasks'),
    },
  };
});

// 注册器只负责编排，这里把每个插件入口换成记录器
vi.mock('@/database/client', () => ({ default: mocks.client.database }));
vi.mock('@/comfyui/client', () => ({ default: mocks.client.comfyui }));
vi.mock('@/files/client', () => ({ default: mocks.client.files }));
vi.mock('@/global/client', () => ({ default: mocks.client.global }));
vi.mock('@/lorebooks/client', () => ({ default: mocks.client.lorebooks }));
vi.mock('@/memories/client', () => ({ default: mocks.client.memories }));
vi.mock('@/models/client', () => ({ default: mocks.client.models }));
vi.mock('@/presets/client', () => ({ default: mocks.client.presets }));
vi.mock('@/signal/client', () => ({ default: mocks.client.signal }));
vi.mock('@/stories/client', () => ({ default: mocks.client.stories }));
vi.mock('@/tools/client', () => ({ default: mocks.client.tools }));
vi.mock('@plugins/secyud-tavern-importer/client', () => ({
  default: mocks.client.importer,
}));
vi.mock('@/tasks/client', () => ({ default: mocks.client.tasks }));

vi.mock('@/interceptors/server/register', () => ({
  default: mocks.server.interceptors,
}));
vi.mock('@/comfyui/server', () => ({ default: mocks.server.comfyui }));
vi.mock('@/lorebooks/server', () => ({ default: mocks.server.lorebooks }));
vi.mock('@/memories/server', () => ({ default: mocks.server.memories }));
vi.mock('@/models/server', () => ({ default: mocks.server.models }));
vi.mock('@/presets/server', () => ({ default: mocks.server.presets }));
vi.mock('@/stories/server', () => ({ default: mocks.server.stories }));
vi.mock('@/tools/server', () => ({ default: mocks.server.tools }));
vi.mock('@/tasks/server', () => ({ default: mocks.server.tasks }));

import { registerClientPlugin } from '@/generated/client-registerer';
import { registerServerPlugin } from '@/generated/server-registerer';

/** 注册顺序就是契约：插件之间有依赖，顺序错了会在运行期炸 */
const CLIENT_ORDER = [
  'database',
  'comfyui',
  'files',
  'global',
  'lorebooks',
  'memories',
  'models',
  'presets',
  'signal',
  'stories',
  'tools',
  'importer',
  'tasks',
];

const SERVER_ORDER = [
  'server:interceptors',
  'server:comfyui',
  'server:lorebooks',
  'server:memories',
  'server:models',
  'server:presets',
  'server:stories',
  'server:tools',
  'server:tasks',
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
});

describe('generated registerer / client', () => {
  it('应当按固定顺序串行注册全部 13 个插件', async () => {
    await registerClientPlugin();

    expect(mocks.order).toEqual(CLIENT_ORDER);
  });

  it('每个插件入口都只调用一次', async () => {
    await registerClientPlugin();

    for (const item of Object.values(mocks.client)) {
      expect(item).toHaveBeenCalledTimes(1);
    }
  });

  it('前一个插件抛错时应当中断后续注册', async () => {
    mocks.client.models.mockRejectedValueOnce(new Error('boom'));

    await expect(registerClientPlugin()).rejects.toThrow('boom');

    expect(mocks.client.presets).not.toHaveBeenCalled();
    expect(mocks.client.tasks).not.toHaveBeenCalled();
  });
});

describe('generated registerer / server', () => {
  it('应当按固定顺序串行注册全部 9 个插件', async () => {
    await registerServerPlugin();

    expect(mocks.order).toEqual(SERVER_ORDER);
  });

  it('拦截器注册应当排在第一个', async () => {
    await registerServerPlugin();

    expect(mocks.order[0]).toBe('server:interceptors');
    expect(mocks.server.interceptors).toHaveBeenCalledTimes(1);
  });

  it('注册失败时应当把错误抛出去并停住', async () => {
    mocks.server.stories.mockRejectedValueOnce(new Error('server boom'));

    await expect(registerServerPlugin()).rejects.toThrow('server boom');

    expect(mocks.server.tools).not.toHaveBeenCalled();
    expect(mocks.server.tasks).not.toHaveBeenCalled();
  });
});
