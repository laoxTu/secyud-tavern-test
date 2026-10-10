import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const fakeClient = { kind: 'fake-client' };
  const fakeDb = { kind: 'fake-db' };
  return {
    fakeClient,
    fakeDb,
    /**
     * provider 在模块顶层就建 client/db，用普通数组记下这些导入期的调用参数，
     * 不依赖 vi.fn 的调用记录（导入期发生在用例收集阶段）
     */
    recorded: {
      createClient: [] as unknown[],
      drizzle: [] as unknown[],
    },
    // provider 顶层就读 config.dataDir，先留占位、导入前再按 fixture 覆盖
    config: { dataDir: 'placeholder' },
    createClient: vi.fn((param: unknown) => {
      mocks.recorded.createClient.push(param);
      return fakeClient;
    }),
    drizzle: vi.fn((client: unknown) => {
      mocks.recorded.drizzle.push(client);
      return fakeDb;
    }),
    migrate: vi.fn(async () => {}),
  };
});

// 不真的连 libsql：client、drizzle 与迁移器全部换掉
vi.mock('@libsql/client', () => ({ createClient: mocks.createClient }));
vi.mock('drizzle-orm/libsql', () => ({ drizzle: mocks.drizzle }));
vi.mock('drizzle-orm/libsql/migrator', () => ({ migrate: mocks.migrate }));
vi.mock('@/global', () => ({ config: mocks.config }));

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
const data = structuredClone((await import('./provider.cases.json')).default);
mocks.config.dataDir = data.dataDir;

// provider 在模块顶层就拼 url、建 client，所以要先把配置准备好再动态导入
const { dbProvider } = await import('@/database/server/provider');

describe('database server provider / url 与单例', () => {
  it('url 应当由 config.dataDir 拼出', () => {
    expect(dbProvider.url).toBe(data.url);
    expect(dbProvider.url).toContain(data.dataDir);
    expect(mocks.recorded.createClient).toEqual([{ url: data.url }]);
  });

  it('client 与 db 应当是模块级的同一份实例', () => {
    expect(dbProvider.client).toBe(mocks.fakeClient);
    expect(mocks.recorded.drizzle).toEqual([mocks.fakeClient]);
    expect(dbProvider.db).toBe(mocks.fakeDb);
    // 多次读取拿到的是同一引用
    expect(dbProvider.client).toBe(dbProvider.client);
    expect(dbProvider.db).toBe(dbProvider.db);
  });

  it('迁移目录应当是 scripts/migrations', () => {
    expect(dbProvider.migrationsFolder).toBe(data.migrationsFolder);
  });
});

describe('database server provider / migrate', () => {
  it('应当调用迁移器并打印成功日志', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    await dbProvider.migrate();

    expect(mocks.migrate).toHaveBeenCalledWith(mocks.fakeDb, {
      migrationsFolder: data.migrationsFolder,
    });
    expect(info).toHaveBeenCalledWith(data.messages.migrated);

    info.mockRestore();
  });

  it('迁移失败时应当把错误抛出去，且不打印成功日志', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    mocks.migrate.mockRejectedValueOnce(new Error('migrate failed'));

    await expect(dbProvider.migrate()).rejects.toThrow('migrate failed');

    expect(info).not.toHaveBeenCalledWith(data.messages.migrated);

    info.mockRestore();
  });
});
