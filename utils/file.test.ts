import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileUtils } from '@/utils/server/file';

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./file.cases.json')).default);
}

let root: string;

/** 每个用例一个干净目录，避免相互影响 */
function tmpDir(name: string) {
  return path.join(root, name);
}

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'utils-file-'));
  fs.mkdirSync(root, { recursive: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.promises.rm(root, { recursive: true, force: true });
});

/** 把 ReadableStream 读干 */
async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 伪造 fetch 的响应：只需要用到 body.getReader 与 headers.get */
function fakeResponse(options: {
  ok?: boolean;
  chunks?: number[][];
  length?: number;
  failAt?: number;
}) {
  const { ok = true, chunks = [], length, failAt } = options;
  let index = 0;
  return {
    ok,
    status: ok ? 200 : 404,
    headers: {
      get: (name: string) =>
        name === 'content-length' && length !== undefined
          ? String(length)
          : null,
    },
    body: {
      getReader: () => ({
        async read() {
          if (failAt !== undefined && index === failAt) {
            throw new Error('stream failed');
          }
          if (index >= chunks.length) return { done: true, value: undefined };
          return {
            done: false,
            value: new Uint8Array(chunks[index++]),
          };
        },
      }),
    },
  };
}

describe('fileUtils / exists 与 mkdir', () => {
  it('目录存在与否应当如实返回', async () => {
    expect(await fileUtils.exists(root)).toBe(true);
    expect(await fileUtils.exists(tmpDir('nope'))).toBe(false);
  });

  it('mkdir 应当递归创建目录', async () => {
    const dir = tmpDir('a/b/c');

    await fileUtils.mkdir(dir);

    expect(await fileUtils.exists(dir)).toBe(true);
    // 重复创建不应抛错
    await expect(fileUtils.mkdir(dir)).resolves.toBeUndefined();
  });
});

describe('fileUtils / 写文件与复制', () => {
  it('writeFile 应当自动建父目录并写入文本', async () => {
    const data = await loadCases();
    const file = tmpDir(data.files.nested);

    await fileUtils.writeFile(file, data.files.text);

    expect(await fs.promises.readFile(file, 'utf8')).toBe(data.files.text);
  });

  it('copy 应当复制内容并建好目标目录', async () => {
    const data = await loadCases();
    const from = tmpDir(data.files.copySource);
    const to = tmpDir(data.files.copyTarget);
    await fileUtils.writeFile(from, data.files.copyText);

    await fileUtils.copy(from, to);

    expect(await fs.promises.readFile(to, 'utf8')).toBe(data.files.copyText);
  });
});

describe('fileUtils / 目录列举', () => {
  it('listDirs 只返回目录，listFiles 只返回文件', async () => {
    const data = await loadCases();
    const dir = tmpDir('listing');
    await fileUtils.mkdir(path.join(dir, data.dirs.first));
    await fileUtils.mkdir(path.join(dir, data.dirs.second));
    for (const name of data.dirs.files) {
      await fileUtils.writeFile(path.join(dir, name), 'x');
    }

    const dirs = await fileUtils.listDirs(dir);
    const files = await fileUtils.listFiles(dir);

    expect(dirs.map((u) => u.name).sort()).toEqual(
      [data.dirs.first, data.dirs.second].sort(),
    );
    expect(files.map((u) => u.name).sort()).toEqual(
      [...data.dirs.files].sort(),
    );
  });

  it('应当把 map 作用到每个目录项上', async () => {
    const data = await loadCases();
    const dir = tmpDir('mapped');
    await fileUtils.mkdir(path.join(dir, data.dirs.first));

    const names = await fileUtils.listDirs(dir, (u) => u.name.toUpperCase());

    expect(names).toEqual([data.dirs.first.toUpperCase()]);
  });
});

describe('fileUtils / 流', () => {
  it('createBufferStream 应当把 buffer 作为唯一分片', async () => {
    const data = await loadCases();

    const stream = fileUtils.createBufferStream(
      Buffer.from(data.streams.bufferText),
    );

    await expect(readStream(stream)).resolves.toBe(data.streams.bufferText);
  });

  it('createOnceStream 应当在动作完成后关闭', async () => {
    const data = await loadCases();
    const encoder = new TextEncoder();

    const stream = fileUtils.createOnceStream(async (controller) => {
      controller.enqueue(encoder.encode(data.streams.onceText));
      controller.enqueue(encoder.encode('!'));
    });

    await expect(readStream(stream)).resolves.toBe(
      `${data.streams.onceText}!`,
    );
  });
});

describe('fileUtils / download', () => {
  it('目标已存在时只回调 existAction，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const target = tmpDir('exists.bin');
    await fileUtils.writeFile(target, 'old');
    const existAction = vi.fn();

    await fileUtils.download('http://example.com/a', target, { existAction });

    expect(existAction).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('响应不 ok 时应当回调 failedAction 且不写文件', async () => {
    const data = await loadCases();
    const response = fakeResponse({ ok: false });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const failedAction = vi.fn();
    const target = tmpDir('failed.bin');

    await fileUtils.download('http://example.com/a', target, { failedAction });

    expect(failedAction).toHaveBeenCalledWith(response);
    expect(await fileUtils.exists(target)).toBe(false);
  });

  it('成功时应当按分片写入文件并回调进度与完成', async () => {
    const data = await loadCases();
    const response = fakeResponse({
      chunks: data.downloads.chunks,
      length: data.downloads.length,
    });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const progressAction = vi.fn();
    const finishAction = vi.fn();
    const startAction = vi.fn();
    const target = tmpDir('downloaded.bin');

    await fileUtils.download('http://example.com/a', target, {
      startAction,
      progressAction,
      finishAction,
    });

    const expected = Buffer.concat(
      data.downloads.chunks.map((u) => Buffer.from(u)),
    );
    expect(await fs.promises.readFile(target)).toEqual(expected);
    expect(startAction).toHaveBeenCalledTimes(1);
    expect(progressAction.mock.calls).toEqual([
      [3, data.downloads.length],
      [data.downloads.length, data.downloads.length],
    ]);
    expect(finishAction).toHaveBeenCalledTimes(1);
  });

  it('读取中途失败时应当回调 errorAction', async () => {
    const data = await loadCases();
    const response = fakeResponse(data.downloads.streamError);
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const errorAction = vi.fn();
    const finishAction = vi.fn();
    const target = tmpDir('broken.bin');

    await fileUtils.download('http://example.com/a', target, {
      errorAction,
      finishAction,
    });

    expect(errorAction).toHaveBeenCalledTimes(1);
    expect(finishAction).not.toHaveBeenCalled();
  });

  it('没有 content-length 时不应触发进度回调', async () => {
    const data = await loadCases();
    const response = fakeResponse({ chunks: data.downloads.chunks });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    const progressAction = vi.fn();
    const target = tmpDir('no-length.bin');

    await fileUtils.download('http://example.com/a', target, {
      progressAction,
    });

    expect(progressAction).not.toHaveBeenCalled();
    expect(await fileUtils.exists(target)).toBe(true);
  });
});

describe('fileUtils / execute', () => {
  it('命令成功时应当返回 stdout', async () => {
    const data = await loadCases();

    const result = await fileUtils.execute(
      `"${process.execPath}" -p "${data.execute.expression}"`,
    );

    expect(result.stdout?.trim()).toBe(data.execute.expected);
  });

  it('命令不存在时应当 reject', async () => {
    await expect(
      fileUtils.execute('secyud-not-a-command-xyz'),
    ).rejects.toBeTruthy();
  });
});
