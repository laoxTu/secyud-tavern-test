import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InterceptorHandler } from '@/interceptors/server';
import { manager } from '@/interceptors/server';
import { errorInterceptor } from '@/interceptors/server/error';
import registerServerInterceptors from '@/interceptors/server/register';
import { getRegistry } from '@/plugins';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./register.cases.json')).default);
}

async function loadManifest() {
  return structuredClone(
    (await import('@/interceptors/manifest.json')).default,
  );
}

function fakeInterceptor(seed: {
  id: string;
  sequence?: number;
  requires?: string[];
}): InterceptorHandler {
  return {
    id: seed.id,
    sequence: seed.sequence,
    requires: seed.requires,
    async handle(_request, _records, next) {
      return next();
    },
  } as InterceptorHandler;
}

function clearState() {
  for (const id of Object.keys(manager.records)) manager.unregister(id);
}

beforeEach(() => {
  // 注册表自己会 console.debug，用例里静音
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  clearState();
});

afterEach(() => {
  clearState();
  vi.restoreAllMocks();
});

describe('interceptors server / register 编排', () => {
  it('默认导出应当把 errorInterceptor 挂进 interceptor 注册表', async () => {
    const data = await loadCases();

    const returned = registerServerInterceptors();

    expect(registerServerInterceptors).toBeInstanceOf(Function);
    await expect(returned).resolves.toBeUndefined();
    expect(manager.record(data.errorInterceptorId)).toBe(errorInterceptor);
  });

  it('重复注册应当幂等，不会挂出第二条记录', async () => {
    const data = await loadCases();

    await registerServerInterceptors();
    await registerServerInterceptors();

    expect(Object.keys(manager.records)).toEqual([data.errorInterceptorId]);
    expect(manager.sorted()).toHaveLength(1);
  });

  it('注册应当让已缓存的排序失效', async () => {
    const data = await loadCases();

    // 先读一次，把空排序缓存下来
    expect(manager.sorted()).toEqual([]);

    await registerServerInterceptors();

    expect(manager.sorted().map((u) => u.id)).toEqual([
      data.errorInterceptorId,
    ]);
  });

  it('error 拦截器应当排在业务拦截器之前，才能兜住后面的错误', async () => {
    const data = await loadCases();
    manager.register(fakeInterceptor(data.own));

    await registerServerInterceptors();

    expect(manager.sorted().map((u) => u.id)).toEqual([
      data.errorInterceptorId,
      data.own.id,
    ]);
  });

  it('注册表应当挂在全局单例上', async () => {
    const data = await loadCases();

    await registerServerInterceptors();

    expect(getRegistry('interceptor')).toBe(manager);
    expect(getRegistry('interceptor').record(data.errorInterceptorId)).toBe(
      errorInterceptor,
    );
  });

  it('挂载的拦截器依赖不存在的 id 时排序会抛错', async () => {
    const data = await loadCases();
    manager.register(fakeInterceptor(data.missing));

    expect(() => manager.sorted()).toThrow(/Sort Error/);

    // 把坏记录摘掉后排序可以恢复
    manager.unregister(data.missing.id);
    await registerServerInterceptors();
    expect(manager.sorted().map((u) => u.id)).toEqual([
      data.errorInterceptorId,
    ]);
  });

  it('manifest 应当把 server 指到本文件，并用最小 sequence 保证最先注册', async () => {
    const data = await loadCases();
    const manifest = await loadManifest();

    expect(manifest.id).toBe(data.manifest.id);
    expect(manifest.server).toBe(data.manifest.server);
    expect(manifest.sequence).toBe(data.manifest.sequence);
    expect(manifest.sequence).toBeLessThan(data.own.sequence);
  });
});
