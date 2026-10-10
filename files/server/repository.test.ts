import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from 'uuid';

import type { FileModel } from '@/files';
import { config } from '@/global';
import { BusinessError } from '@/interceptors';
import { arrUtils } from '@/utils';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertValues: vi.fn(),
  selectWhere: vi.fn(),
  selectFields: vi.fn(),
  findByHash: vi.fn(),
  get: vi.fn(),
  query: vi.fn(),
  remove: vi.fn(),
}));

/**
 * 只替换到 drizzle 的表达式构造这一层：
 * 表达式变成可读的标记对象，方便断言查询条件。
 */
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mark =
    (key: string) =>
    (...args: unknown[]) => ({ [key]: args });
  return {
    ...actual,
    eq: mark('eq'),
    and: mark('and'),
    or: mark('or'),
    like: mark('like'),
    asc: mark('asc'),
    desc: mark('desc'),
  };
});

/**
 * 仓库把数据目录拼成 `cwd + config.dataDir`，用例要让真实落盘落在 os.tmpdir()（另一个盘符），
 * 所以这里把 joinPath 换成 path.resolve（joinPath 本身在 tests/utils/array.test.ts 覆盖）。
 */
vi.mock('@/utils/array', async (importOriginal) => {
  const actual = await importOriginal<{ arrUtils: Record<string, any> }>();
  const { default: nodePath } = await import('node:path');
  return {
    ...actual,
    arrUtils: {
      ...actual.arrUtils,
      joinPath: (...args: string[]) => nodePath.resolve(...args),
    },
  };
});

// 避免真实打开 sqlite 文件
vi.mock('@/database/server/provider', () => ({
  dbProvider: {
    client: {},
    db: {},
    migrate: vi.fn(),
    url: 'file::memory:',
    migrationsFolder: '',
  },
}));

vi.mock('@/database/server', () => ({
  databases: {
    db: {
      // create 的查重链：select().from().where().get()
      select: () => {
        const chain = {
          from: () => chain,
          where: (condition: unknown) => {
            mocks.selectWhere(condition);
            return chain;
          },
          get: async (fields: unknown) => {
            mocks.selectFields(fields);
            return mocks.findByHash();
          },
        };
        return chain;
      },
      insert: (table: unknown) => {
        mocks.insert(table);
        return {
          values: async (payload: unknown) => {
            mocks.insertValues(payload);
          },
        };
      },
    },
    get: mocks.get,
    exists: vi.fn(),
    query: mocks.query,
    delete: mocks.remove,
  },
}));

/** 真实落盘目录：整个文件共用一个临时目录，跑完清掉 */
const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'files-repository-'));

// filesDir 在模块加载时由 config.dataDir 决定，所以要在 import 仓库之前改掉
const originDataDir = config.dataDir;
config.dataDir = root;

const { repository } = await import('@/files/server/repository');
const { fileSchema } = await import('@/files/server/schema');

/** 仓库认定的文件根目录（joinPath 已被替换为 path.resolve，因此就是临时目录） */
const filesDir = arrUtils.joinPath(process.cwd(), config.dataDir);

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./repository.cases.json')).default);
}

/** 文件在磁盘上的路径 = 根目录 + mime 主类型 + 无后缀 id */
const filePath = (entity: FileModel) =>
  path.resolve(filesDir, entity.type, entity.id);

/** 目录不存在时当作空目录 */
async function listDir(dir: string) {
  return await fs.promises
    .readdir(dir)
    .catch(() => [] as string[])
    .then((items) => items.sort());
}

/** get 的第二个参数在运行时可以省略（默认 false） */
const getMeta = (id: string) =>
  (repository.get as (id: string) => Promise<any>)(id);

let log: any;
let warn: any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findByHash.mockResolvedValue(undefined);
  mocks.get.mockResolvedValue(undefined);
  mocks.query.mockResolvedValue({ items: [], length: 0 });
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  warn.mockRestore();
});

afterAll(async () => {
  config.dataDir = originDataDir;
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe('files repository / 数据目录', () => {
  it('文件应当落在 config.dataDir 下', () => {
    expect(filesDir).toBe(root);
  });
});

describe('files repository / create', () => {
  it('内容重复时应当直接复用已有 id，不再落盘', async () => {
    const data = await loadCases();
    mocks.findByHash.mockResolvedValue(data.entities.duplicate);
    const dir = path.resolve(filesDir, data.create.type);
    const before = await listDir(dir);

    const id = await repository.create({
      type: data.create.type,
      args: data.create.args,
      buffer: Buffer.from(data.create.bytes),
    });

    expect(id).toBe(data.entities.duplicate.id);
    expect(await listDir(dir)).toEqual(before);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('新内容应当按 sha256 查重、落盘并写入 mime', async () => {
    const data = await loadCases();
    const buffer = Buffer.from(data.create.bytes);

    const id = await repository.create({
      type: data.create.type,
      args: data.create.args,
      buffer,
    });

    // 查重条件用的是内容的 sha256，查询字段只取 id
    const condition = mocks.selectWhere.mock.calls[0][0];
    expect(condition.eq[0]).toBe(fileSchema.hash);
    expect(condition.eq[1]).toBe(data.create.hash);
    expect(mocks.selectFields).toHaveBeenCalledWith({ id: fileSchema.id });

    // 文件名是无后缀的 guid，真的写到了 <数据目录>/<mime 主类型>/<id>
    expect(validate(id)).toBe(true);
    await expect(
      fs.promises.readFile(path.resolve(filesDir, data.create.type, id)),
    ).resolves.toEqual(buffer);

    expect(mocks.insert).toHaveBeenCalledWith(fileSchema);
    expect(mocks.insertValues).toHaveBeenCalledWith({
      id,
      hash: data.create.hash,
      type: data.create.type,
      args: data.create.args,
    });
  });

  it('内容不同的两次新建应当生成两个 id 并各写一份文件', async () => {
    const data = await loadCases();
    const first = await repository.create({
      type: data.create.type,
      args: data.create.args,
      buffer: Buffer.from(data.create.bytes),
    });
    const second = await repository.create({
      type: data.create.type,
      args: data.create.args,
      buffer: Buffer.from(data.read.bytes),
    });

    expect(validate(first)).toBe(true);
    expect(validate(second)).toBe(true);
    expect(first).not.toBe(second);
    await expect(
      fs.promises.readFile(path.resolve(filesDir, data.create.type, first)),
    ).resolves.toEqual(Buffer.from(data.create.bytes));
    await expect(
      fs.promises.readFile(path.resolve(filesDir, data.create.type, second)),
    ).resolves.toEqual(Buffer.from(data.read.bytes));
  });
});

describe('files repository / get', () => {
  it('查不到时应当抛实体不存在', async () => {
    const data = await loadCases();

    const err = await getMeta(data.ids.missing).catch((e) => e);

    expect(err).toBeInstanceOf(BusinessError);
    expect(err.message).toBe('entity not found');
    expect(err.code).toBe('default.entity_not_found');
    expect(err.data).toEqual({
      id: data.ids.missing,
      target: 'default.file',
    });
  });

  it('默认只返回元数据，不去读文件内容', async () => {
    const data = await loadCases();
    // 故意不给这个实体准备磁盘文件：一旦去 readFile 就会抛 ENOENT
    mocks.get.mockResolvedValue(structuredClone(data.entities.image));

    const result = await getMeta(data.ids.image);

    expect(mocks.get).toHaveBeenCalledWith(fileSchema, data.ids.image);
    expect(result.id).toBe(data.ids.image);
    expect(result.type).toBe(data.entities.image.type);
    expect(result.args).toBeNull();
    expect('buffer' in result).toBe(true);
    expect(result.buffer).toBeUndefined();
  });

  it('要求 buffer 时应当按 type 目录读取内容', async () => {
    const data = await loadCases();
    const buffer = Buffer.from(data.read.bytes);

    // 先真的写一份，再按 id 读回来
    const id = await repository.create({
      type: data.entities.image.type,
      args: data.entities.image.args,
      buffer,
    });
    mocks.get.mockResolvedValue({
      id,
      hash: data.entities.image.hash,
      type: data.entities.image.type,
      args: data.entities.image.args,
    });

    const result = await repository.get(id, true);

    expect(result.buffer).toEqual(buffer);
    expect(result).toEqual({
      id,
      hash: data.entities.image.hash,
      type: data.entities.image.type,
      args: data.entities.image.args,
      buffer,
    });
  });
});

describe('files repository / delete', () => {
  it('应当先删文件再删库，并记录路径', async () => {
    const data = await loadCases();

    const id = await repository.create({
      type: data.entities.image.type,
      args: data.entities.image.args,
      buffer: Buffer.from(data.read.bytes),
    });
    // 用例要断言按 hash 派生的路径，fixture 里带上 hash（FileModel 未声明该字段）
    const entity: FileModel = {
      id,
      hash: data.entities.image.hash,
      type: data.entities.image.type,
      args: data.entities.image.args,
    } as unknown as FileModel;
    mocks.get.mockResolvedValue(entity);

    await expect(repository.delete(id)).resolves.toBeUndefined();

    // 磁盘上的文件确实没了
    await expect(fs.promises.access(filePath(entity))).rejects.toThrow();
    expect(mocks.remove).toHaveBeenCalledWith(fileSchema, id);
    expect(log).toHaveBeenCalledWith(`file deleted: ${filePath(entity)}`);
  });

  it('文件不存在时只记录警告，仍然删库', async () => {
    const data = await loadCases();
    const entity = structuredClone(data.entities.image);
    mocks.get.mockResolvedValue(entity);

    await expect(repository.delete(entity.id)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(`file not exist: ${filePath(entity)}`);
    expect(mocks.remove).toHaveBeenCalledWith(fileSchema, entity.id);
  });

  it('实体不存在时应当报错，且什么都不删', async () => {
    const data = await loadCases();

    await expect(repository.delete(data.ids.missing)).rejects.toThrow(
      'entity not found',
    );

    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe('files repository / list', () => {
  it('应当把请求原样交给查询层，并给出投影与排序', async () => {
    const data = await loadCases();
    mocks.query.mockResolvedValue(data.listResponse);

    const result = await repository.list(data.requests.paged);

    const [table, passed, filter, sorter, map] = mocks.query.mock.calls[0];
    expect(table).toBe(fileSchema);
    expect(passed).toBe(data.requests.paged);
    expect(filter(fileSchema)).toBeUndefined();
    expect(sorter(fileSchema)).toBe(fileSchema.id);
    expect(map(fileSchema)).toEqual({
      id: fileSchema.id,
      type: fileSchema.type,
      args: fileSchema.args,
    });
    expect(result).toEqual(data.listResponse);
  });

  it('search.type 应当作为等值条件', async () => {
    const data = await loadCases();

    await repository.list(data.requests.typed);

    const condition = mocks.query.mock.calls[0][2](fileSchema);
    expect(condition.and).toHaveLength(1);
    expect(condition.and[0].eq[0]).toBe(fileSchema.type);
    expect(condition.and[0].eq[1]).toBe(data.requests.typed.search.type);
  });

  it('没有 type 或 type 为空串时不应当加条件', async () => {
    const data = await loadCases();

    await repository.list(data.requests.blankSearch);
    await repository.list(data.requests.emptyType);

    expect(mocks.query.mock.calls[0][2](fileSchema)).toBeUndefined();
    expect(mocks.query.mock.calls[1][2](fileSchema)).toBeUndefined();
  });
});
