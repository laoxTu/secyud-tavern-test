# 测试注意事项

写用例前先扫一遍，能省掉大部分返工。

## 0. 给 AI 的约定：不确定就问

用户是最终判断者。凡是「预期行为」和「应对方式」需要人来定的地方，先问，不要自己拍板。

**必须先问的情况**

- 某个行为算不算缺陷、要不要改：不要把自己的推断写成 `it.fails` 或断言，先描述现象再问。
- 期望的应对方式：硬修复 / 软处理（跳过、`console.warn`、留给页面报错）/ 现状即设计，三者结论完全不同。
- 要动 `src/**` 生产代码：确认预期后再改，改完同步用例并跑全量。
- 要删改已有用例、改公共配置（`vitest.config.ts`、`vitest.setup.ts`）、新增依赖（例如 `fake-indexeddb`）。
- 任何 git 操作（提交、重置、切分支）与删除/移动文件。
- 需要放宽运行权限、访问工作区外的路径。

**怎么问**

- 一次把相关的点一起问，每个问题给 2~4 个可选项并写清取舍，让用户一句话能拍板。
- 例：「宏选择指向已删除的 code 时：软处理跳过 / 跳过并 warn / 回落到第一个可用项 / 保持抛错」。
- 问之前先把观察到的事实列出来（代码位置、执行序列、实际输出），不要只给结论。

**不要做**

- 不要把推测写成断言去「固化」未确认的预期，也不要顺手按自己的理解重构无关代码。
- 报告发现时区分「已确认的缺陷」与「可疑但未确认的行为」，不要把两者混在一起下结论。
- 改动后必须给出可复现的验证：跑了什么命令、多少用例通过，以及哪些点仍未确认。
- 用户的确认只对当次范围有效；同样的判断换到别的模块，需要重新确认。

## 1. 运行

```bash
pnpm test        # watch
pnpm test run    # 跑一次（提交前用这个）
```

- 配置在 `vitest.config.ts`：`environment: jsdom`、`globals: true`、`pool: forks`、`include: tests/**/*.{test,spec}.{ts,tsx}`，setup 为 `vitest.setup.ts`。
- setup 里已经 mock 了 `@teispace/next-themes` 与 `next/navigation`，不用每个用例重复处理。
- 别名（tsconfig 与 vitest 都配好了）：`@` → `src/`、`@/lib` → `src/utils/lib`、`@/hooks` → `src/utils/client/hooks`、`@plugins` → `plugins/`。
- 只有 `tests/**` 下匹配 `*.test.ts(x)` / `*.spec.ts(x)` 的文件会被收集，所以说明文档放 `tests/*.md` 不会被当成用例。
- 如果启动阶段报 `Error: spawn EPERM`（vite 加载配置时会 spawn 子进程），那是沙箱/权限拦截了子进程，不是用例的问题，需要放宽运行权限。

## 2. 目录与命名

- 位置：`tests/<模块>/<名称>.test.ts`，与 `src/` 镜像；`tests/presets/styles/client/realm.ts` → `tests/presets/styles/realm.test.ts`。
- `client` / `server` 段通常省略，但 `models`、`tools` 下有同名文件（如两边的 `engine.ts`、`providers.ts`），这两个域**保留段名**避免冲突。
- 用例名用中文 `describe('模块 / 主题')` + `it('应当…')`，一眼能看懂断言的是什么行为。

## 3. 用例数据一律走 json 动态 import

```ts
/** 用例数据都在 json 里，动态 import 后克隆一份，避免用例之间互相污染 */
async function loadData() {
  return structuredClone((await import('./entries.json')).default);
}
```

- fixture 就近放在用例目录（`tests/presets/macros/entries.json`），可复用的公共夹具放上层：`tests/presets/preset.json`、`tests/stories/realm.json`。
- **必须 `structuredClone`**：json 模块有缓存，`import` 拿到的是同一个对象；直接改（比如往 `realm.properties`、`preset.entries` 写值）会把状态串到后续用例。
- 只有无法用 json 表达的东西才写在代码里：函数（provider / 桩实现）、`content: async () => Buffer` 这类惰性节点、iframe / document 伪造对象。
- 断言里的期望值尽量从 fixture 派生（`data.link[0].content.trim()`），同一份数据不要在两处手写。

## 4. mock 边界

`vi.mock` 是文件级的，需要引用外部 mock 变量时用 `vi.hoisted`：

```ts
const mocks = vi.hoisted(() => ({ list: vi.fn(), make: vi.fn() }));
vi.mock('@/presets/server/repository', () => ({
  repository: { entry: { list: mocks.list, make: mocks.make } },
}));
```

按被测目标选层，尽量只替换必要的一层：

| 被测目标 | 需要 mock |
| --- | --- |
| factory / feature storage | `@/presets/server/repository`（绕开 sqlite） |
| repository / api | `@/database/server`（整体）+ `@/database/server/provider`（避免真实 libsql）+ `@/presets/server/repository` |
| schema 构造（`json`/`schemas`） | `@/database/server/factory` 要**部分 mock**：`{...await importOriginal(), repositories: ..., storages: ...}`；整体 mock 会让 `presets/server/schema.ts` 报 `No "json" export is defined` |
| 路由 handler | `@/interceptors/server` 的 `route` mock 成直通（`route: (handler) => handler`），然后按 `(request, records)` 直接调用；`records.params` 是 Promise，`records.searchParams` 已经是对象（真实链路由 `route` 反序列化） |
| 请求层 | `@/client`（`get/post/put/del/open`），不要真发请求 |
| 归档 | `@/utils/archive` 导出的是 `archives` **容器对象**，mock 要覆盖容器内部字段：`archives: { ...actual.archives, zipToArchive: mock }`，只加顶层键无效 |
| 文件仓库 | `@/files/server` 的 `files.repository.get/create` |

其它注意：

- 全局单例存在 `globalThis` 上：`__singleton`（所有注册表）、`__cache`（`utils/server/cache`）、`__initialized`（`route` 首次注册）。同一文件内注册表要随用随清（`registry.unregister(id)`），跨文件由 fork 隔离。
- `vi.clearAllMocks()` 只清调用记录，不移除 `mockResolvedValue` 等实现；`mockReset` 才会。
- 断言调用参数时对象键顺序无关，但 `undefined` 键会被 `toEqual` 忽略；不确定就用 `mock.calls[0][1].params` 取具体字段断言。

## 5. jsdom 的能力边界

**可用**：`DOMParser`、`Readability`、`ReadableStream`、`AbortController`、`structuredClone`、jsdom 的 `FormData`/`File`、Node 内建（`Buffer`、`fs`、`path`、`process.cwd()`）。

**不可用 / 要绕**：

- 没有 `EventSource`、`IntersectionObserver`；`window.matchMedia` 需要自己 stub。
- iframe 不加载外部资源：`script.src` 的 `onload` 永远不触发 → 测 `type: 'link'` 这类分支要伪造 `contentDocument`，在 `body.appendChild` 里同步调 `el.onload?.()`，否则用例会挂到超时。
- iframe 里的内联 `<script>` 会真的执行 → 脚本内容用不会报错的（`window.x = 1`），别用裸标识符，否则 stderr 一堆 `ReferenceError` 噪音。
- jsdom 的 `File` 塞不进 Node 的 `Request`（`webidl.is.File` 断言失败）→ 上传类用例伪造 handler 用到的最小 `formData()`，不要拼真实 multipart。
- 没有 `indexedDB`（`memories/client/rag.ts` 依赖）→ 需要手写 stub 或引入 `fake-indexeddb`。

## 6. 未确认的行为不要写成断言

这条踩过坑，单独强调（流程要求见第 0 节）：

- **先问用户预期，再写断言**。不要把自己的推测写成 `it.fails`——`it.fails` 的语义是「这是缺陷，应当修」，容易被误读成结论。
- 软处理的场景（跳过、warn、留给页面报错）不要写「不应抛错 / 应当返回空」这类收紧断言。
- 用户确认是缺陷后，二选一：`it.fails('应当…')` 标明待修；或普通用例断言现状并在注释里写清「当前实现…」。源码修好后必须同步把 `it.fails` 改回 `it`、或删掉「当前实现」那条。
- 本仓库当前约定：**对未确认的行为先不加断言**。

## 7. 容易踩的坑

- fixture 共享引用：`realm.properties`、`preset.entries` 这类对象直接改会污染后续用例（见第 3 节）。
- 断言别写两遍同一份数据：期望值从 fixture 取，改数据时只改 json。
- 静态 `import` json 也可以，但要意识到它同样有缓存；重点在克隆而不是 import 方式。
- 别把 `it.fails` 当成忽略手段——它会计入结果（`5 expected fail`），提交前确认这是有意为之。
- 现有用例优先级参考：`tests/plugins/registry.test.ts`（纯逻辑 + 子类暴露 protected）、`tests/comfyui/select.test.ts`（FormData 驱动）、`tests/presets/**`（json 夹具 + 分层 mock）。
