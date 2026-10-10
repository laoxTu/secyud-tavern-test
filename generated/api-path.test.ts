import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * api-path.ts 只导出类型，运行期没有导出，所以这里的被测对象是「生成产物本身」：
 * 从源码里取出四个白名单数组，再和各个 client/proxy.ts 真实调用的路径对照。
 */
const SOURCE = path.join(process.cwd(), 'src', 'generated', 'api-path.ts');

/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadCases() {
  return structuredClone((await import('./generated.cases.json')).default);
}

function readAllowList() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const result: Record<string, string[]> = {};
  for (const name of ['get', 'post', 'put', 'del']) {
    const matched = new RegExp(
      `const ${name} = \\[([\\s\\S]*?)\\] as const`,
    ).exec(source);
    if (!matched) throw new Error(`api-path.ts 里找不到 ${name} 白名单`);
    result[name] = [...matched[1].matchAll(/'([^']*)'/g)].map((u) => u[1]);
  }
  return result;
}

/** 收集 src 下所有 client/proxy.ts */
function proxyFiles() {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'proxy.ts') found.push(full);
    }
  };
  walk(path.join(process.cwd(), 'src'));
  return found.sort();
}

/** proxy 里用字面量调用的 (方法, 路径) 对 */
function proxyCalls() {
  const calls: { file: string; method: string; url: string }[] = [];
  for (const file of proxyFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const matched of source.matchAll(
      /\b(get|post|put|del|open)\(\s*'([^']+)'/g,
    )) {
      calls.push({
        file: path.relative(process.cwd(), file),
        // open 复用 GetPath
        method: matched[1] === 'open' ? 'get' : matched[1],
        url: matched[2],
      });
    }
  }
  return calls;
}

describe('generated api-path / 白名单本身', () => {
  it('四个白名单都应当非空且各自不重复', () => {
    const allow = readAllowList();

    for (const [method, list] of Object.entries(allow)) {
      expect(list.length, method).toBeGreaterThan(0);
      expect(new Set(list).size, method).toBe(list.length);
    }
  });

  it('路径不应当带前导斜杠（客户端会自己拼 /api/）', () => {
    for (const list of Object.values(readAllowList())) {
      for (const url of list) {
        expect(url.startsWith('/')).toBe(false);
        expect(url.startsWith('api/')).toBe(false);
      }
    }
  });

  it('占位符只允许使用约定的参数名', async () => {
    const data = await loadCases();
    const allow = readAllowList();

    for (const list of Object.values(allow)) {
      for (const url of list) {
        for (const matched of url.matchAll(/\{([^}]+)\}/g)) {
          expect(data.allowedPlaceholders, url).toContain(matched[1]);
        }
      }
    }
  });
});

describe('generated api-path / 与 proxy 实际调用对照', () => {
  it('每个 proxy 里写死的路径都要在白名单里', async () => {
    const allow = readAllowList();
    const calls = proxyCalls();

    expect(calls.length).toBeGreaterThan(0);

    const unknown = calls.filter(
      (call) => !allow[call.method]?.includes(call.url),
    );

    expect(
      unknown.map((u) => `${u.file}: ${u.method}('${u.url}')`),
    ).toEqual([]);
  });

  it('proxy 覆盖了主要业务域', () => {
    const calls = proxyCalls();
    const urls = calls.map((u) => u.url);

    for (const prefix of [
      'models',
      'presets',
      'stories',
      'files',
      'comfyuis',
      'tasks',
      'sse',
    ]) {
      expect(
        urls.some((u) => u === prefix || u.startsWith(`${prefix}/`)),
        prefix,
      ).toBe(true);
    }
  });
});
