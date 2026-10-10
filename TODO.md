# 测试待办（Tree）

> 目录与 `src/` 一一对应，文件名对应同名源码模块。
> `[x]` = 已有用例（可补强），`[ ]` = 待写。
> 写用例前先看 `GUIDELINES.md`（数据一律 json 动态 import、mock 边界、jsdom 限制、未确认行为先不加断言）。
> 用例数据统一放 json、用 `(await import('./xxx.json')).default` 动态加载；需要改动时先 `structuredClone` 克隆一份。
> 当前：81 文件 / 890 用例通过 + 3 expected fail（`models` 的待修缺陷，有意保留，见下）。另有既有 flaky 用例 `comfyui/editor/generator.test.ts`（约 50% 假失败，详见 comfyui 一节的遗留说明）。

```text
tests/
├── [ ] client.test.ts                      # src/client.ts
├── [x] template.test.ts                    # 占位，待删或替换
│
├── utils/                                  # client / server 段按约定省略，行尾标出源码路径
│   ├── [x] archive.test.ts                 # src/utils/archive.ts（原来漏列）
│   ├── [x] array.test.ts                   # src/utils/array.ts
│   ├── [x] cache.test.ts                   # src/utils/server/cache.ts
│   ├── [x] cn.test.ts                      # src/utils/lib/utils.ts
│   ├── [x] file.test.ts                    # src/utils/server/file.ts
│   ├── [x] hasher.test.ts                  # src/utils/server/hasher.ts
│   ├── [x] json-utils.test.ts              # src/utils/json.ts
│   ├── [x] json-patch.test.ts              # src/utils/json-patch.ts
│   ├── [x] mutex.test.ts                   # src/utils/mutex.ts（原来漏列）
│   ├── [x] response.test.ts                # src/utils/server/response.ts
│   ├── [x] str.test.ts                     # src/utils/str.ts
│   └── [x] use-mobile.test.ts              # src/utils/client/hooks/use-mobile.ts
│
├── plugins/
│   ├── [x] registry.test.ts
│   └── secyud-tavern-importer/
│       ├── [ ] silly-tavern.test.ts
│       └── [ ] api.test.ts
│
├── database/
│   ├── [ ] index.test.ts                   # utils 助手
│   ├── client/
│   │   ├── [ ] factory.test.ts
│   │   └── [ ] storage.test.ts
│   └── server/
│       ├── [ ] index.test.ts               # databases.get/query/exists
│       ├── [ ] factory.test.ts
│       └── [ ] provider.test.ts
│
├── interceptors/
│   ├── [ ] index.test.ts                   # BusinessError / checker / errors
│   ├── client/
│   │   └── [ ] index.test.ts
│   └── server/
│       ├── [ ] index.test.ts               # route / 拦截器链
│       ├── [ ] error.test.ts
│       └── [ ] register.test.ts
│
├── signal/
│   ├── [ ] index.test.ts                   # sseUtils / signals
│   ├── client/
│   │   ├── [ ] index.test.ts
│   │   └── [ ] proxy.test.ts
│   └── server/
│       ├── [ ] index.test.ts
│       └── [ ] api.test.ts
│
├── files/
│   ├── [ ] index.test.ts                   # url / mime
│   ├── client/
│   │   ├── [ ] proxy.test.ts
│   │   └── [ ] content.test.tsx
│   └── server/
│       ├── [ ] repository.test.ts
│       └── [ ] api.test.ts
│
├── global/
│   ├── [ ] index.test.ts                   # forms / config
│   ├── client/
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] proxy.test.ts
│   │   └── [ ] menu.test.tsx
│   └── server/
│       ├── [ ] api.test.ts
│       └── [ ] repository.test.ts
│
├── generated/
│   ├── [ ] resources.test.ts
│   ├── [ ] api-path.test.ts
│   └── [ ] registerer.test.ts              # client + server
│
├── localization/
│   ├── [ ] config.test.ts
│   └── [ ] request.test.ts
│
├── components/
│   ├── [ ] index.test.ts                   # element / submitTargetFormOnKey
│   ├── [ ] hooks.test.tsx
│   └── [ ] pager.test.tsx
│
├── presets/
│   ├── [x] index.test.ts
│   ├── client/
│   │   ├── [x] factory.test.ts
│   │   ├── [x] state.test.ts
│   │   ├── [x] proxy.test.ts
│   │   └── [ ] content.test.tsx
│   ├── server/
│   │   ├── [x] factory.test.ts
│   │   ├── [x] storage.test.ts
│   │   ├── [x] repository.test.ts
│   │   └── [x] api.test.ts
│   ├── macros/
│   │   ├── [x] index.test.ts               # 只测 Eta 库
│   │   ├── [x] realm.test.ts
│   │   ├── [x] property.test.ts
│   │   ├── [ ] feature.test.tsx
│   │   └── server/
│   │       └── [x] storage.test.ts
│   ├── regexes/
│   │   ├── [x] realm.test.ts
│   │   └── server/
│   │       └── [x] storage.test.ts
│   ├── scripts/
│   │   ├── [x] realm.test.ts
│   │   └── server/
│   │       └── [x] storage.test.ts
│   └── styles/
│       ├── [x] realm.test.ts
│       └── server/
│           └── [x] storage.test.ts
│
├── lorebooks/
│   ├── [x] index.test.ts
│   ├── [x] matcher.test.ts
│   ├── [x] realm.test.ts
│   ├── [x] tool.test.ts
│   ├── [ ] content.test.tsx
│   ├── matchers/
│   │   ├── [x] always.test.ts
│   │   ├── [x] date-editor.test.ts
│   │   ├── [x] event.test.ts
│   │   ├── [x] normal.test.ts
│   │   ├── [x] variable.test.ts
│   │   └── [x] vector.test.ts
│   └── server/
│       └── [x] storage.test.ts
│
├── memories/
│   ├── [ ] index.test.ts
│   ├── [ ] rag.test.ts
│   ├── [ ] realm.test.ts
│   ├── [ ] tool.test.ts
│   ├── [ ] transformer.test.ts
│   ├── [ ] setting.test.tsx
│   ├── [ ] content.test.tsx
│   └── server/
│       └── [ ] storage.test.ts
│
├── stories/
│   ├── [ ] realms.test.ts                  # client/realms/index.ts
│   ├── [ ] renderer.test.ts
│   ├── client/
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] factory.test.ts
│   │   ├── [ ] proxy.test.ts
│   │   ├── [ ] content.test.tsx
│   │   ├── [ ] component.test.tsx
│   │   └── realms/
│   │       ├── [ ] state.test.ts
│   │       ├── [ ] feature.test.tsx
│   │       └── [ ] page.test.tsx
│   ├── server/
│   │   ├── [ ] repository.test.ts
│   │   ├── [ ] factory.test.ts
│   │   └── [ ] api.test.ts
│   └── images/
│       ├── [ ] api.test.ts
│       └── [ ] client.test.tsx
│
├── comfyui/
│   ├── [x] civitai.test.ts                 # 既有：只覆盖 civitai/client 的 1 个 extract 用例（与下面的 civitai/client.test.ts 目标重合）
│   ├── [x] select.test.ts                  # 既有：只覆盖 select/client 的 powerLoraSelect（与下面的 select/client.test.ts 目标重合）
│   ├── client/
│   │   ├── [x] proxy.test.ts
│   │   ├── [x] state.test.ts
│   │   ├── [x] feature.test.tsx
│   │   └── [x] tool.test.tsx
│   ├── callback/
│   │   └── [x] client.test.ts
│   ├── editor/
│   │   ├── [x] generator.test.ts
│   │   └── [x] configurators.test.ts
│   ├── select/
│   │   └── [x] client.test.ts
│   ├── civitai/
│   │   ├── [x] client.test.ts
│   │   └── [x] server.test.ts
│   └── server/
│       ├── [x] importers.test.ts
│       ├── [x] api-workflows.test.ts
│       ├── [x] api-models.test.ts
│       ├── [x] repository-workflow.test.ts
│       ├── [x] repository-model.test.ts
│       ├── [x] storage.test.ts
│       └── [x] tool.test.ts
│
├── models/
│   ├── [x] index.test.ts
│   ├── client/
│   │   ├── [x] processer.test.ts
│   │   ├── [x] engine.test.ts
│   │   ├── [x] index.test.ts               # convert / key / cache
│   │   ├── [x] state.test.ts
│   │   ├── [x] proxy.test.ts
│   │   └── [ ] setting.test.tsx            # 展示层，按确认暂缓
│   ├── server/
│   │   ├── [x] engine.test.ts
│   │   ├── [x] repository.test.ts
│   │   ├── [x] api.test.ts
│   │   └── [x] storage.test.ts
│   ├── openai/
│   │   ├── [x] index.test.ts
│   │   ├── client/
│   │   │   └── [x] engine.test.tsx
│   │   └── server/
│   │       └── [x] engine.test.ts
│   ├── anthropic/
│   │   ├── [x] index.test.ts
│   │   ├── client/
│   │   │   └── [x] engine.test.tsx
│   │   └── server/
│   │       └── [x] engine.test.ts
│   └── deepseek/
│       ├── [x] index.test.ts
│       ├── client/
│       │   └── [x] engine.test.tsx
│       └── server/
│           └── [x] engine.test.ts
│
├── tasks/
│   ├── [ ] index.test.ts                   # TaskRunner
│   ├── client/
│   │   ├── [ ] state.test.ts
│   │   ├── [ ] proxy.test.ts
│   │   └── [ ] content.test.tsx
│   └── server/
│       ├── [ ] manager.test.ts
│       ├── [ ] repository.test.ts
│       └── [ ] api.test.ts
│
└── tools/
    ├── client/
    │   ├── [ ] task.test.ts
    │   ├── [ ] realm.test.ts
    │   └── [ ] index.test.tsx
    ├── server/
    │   └── [ ] storage.test.ts
    ├── agents/
    │   ├── client/
    │   │   └── [ ] index.test.tsx
    │   └── server/
    │       └── [ ] index.test.ts
    ├── elicits/
    │   └── client/
    │       ├── [ ] states.test.ts
    │       ├── [ ] tool.test.tsx
    │       └── [ ] feature.test.tsx
    ├── fetchers/
    │   └── client/
    │       └── [ ] index.test.tsx
    ├── scripts/
    │   ├── client/
    │   │   └── [ ] index.test.tsx
    │   └── server/
    │       └── [ ] index.test.ts
    └── variables/
        ├── [ ] index.test.ts
        └── client/
            └── [ ] index.test.tsx
```

## 跳过（不建用例）

```text
* 桶文件 / 纯类型：**/index.ts、utils/json-schema.ts、**/server/storage.ts(接口)
* DDL：**/server/schema.ts
* 空实现：tools/{variables,fetchers,elicits}/server/index.ts、{lorebooks,memories}/server/provider.ts
* 纯展示 / 无逻辑包装：components/ui/**、components/{dialog,empty,field,input,media,resizeable,tooltip,collapsible}.tsx、models/client/component.tsx、tools/client/{content,feature}.tsx、**/loading.tsx
* 注册 / 编排：各模块 client/index.tsx 的注册函数、comfyui/{index.ts,tool.ts,select/index.ts}
* 生成物：app/api/**/route.ts
```

## 进度

### presets：已完成

- 用例：`presets/**` 共 18 个文件（`macros/index.test.ts` 与 `styles/realm.test.ts` 为原有，其余新增），数据落在 13 个 fixture json。
- 剩余展示层未做：`presets/client/content.test.tsx`、`presets/macros/feature.test.tsx`。

### lorebooks：已完成

- 用例：`lorebooks/**` 共 11 个文件 / 87 用例，数据落在 11 个 fixture json（`index.cases.json`、`matcher.cases.json`、`matchers/*.cases.json`、`realm.cases.json`、`tool.cases.json`、`server/entries.json`）。
- 覆盖：`index` 的序号与排序、`matcher` 的 content/variables/analyze、五个匹配器（含事件日期区间、向量 id 收集与缓存）、`realm` 的 init 分桶 / json 压缩 / RAG 嵌入 / 默认与 layered 构造器注入、`tool` 的 get_lorebook 检索与编码回写、`server/storage` 归档往返。
- 剩余展示层未做：`lorebooks/client/content.test.tsx`（与 `presets/client/content.test.tsx` 保持一致，暂缓；`content.tsx` 里真正的逻辑只有表单提交）。

### utils：已完成
- 用例：`utils/**` 共 12 个文件 / 142 用例，数据落在 7 个 fixture json（`archive.cases.json`、`array.cases.json`、`str.cases.json`、`cn.cases.json`、`cache.cases.json`、`file.cases.json`、`response.cases.json`）。
- 新增（本轮）：`array`（intersperse/join/groupSerial/joinPath）、`str`（random/wrap/fnv1a64Bytes/buffer，FNV 用 FNV-1a 64 参考值校验）、`cn`（clsx + tailwind-merge 冲突消解）、`mutex`（串行执行/失败不阻塞）、`cache`（命中/未命中/factory/滑动过期/容量淘汰，用假时钟）、`file`（exists/mkdir/writeFile/copy/listDirs/listFiles/两种流/download 的四种回调/execute）、`response`（json/null/create/download/resource）、`use-mobile`（伪造 matchMedia + renderHook）、`archive`（set/get/fuzzy 与 zip 往返、root 前缀、空内容不落盘）。
- 两个补的：TODO 树原本漏列 `src/utils/mutex.ts`（`src/tasks/index.ts` 在用）与 `src/utils/archive.ts`（此前只在 presets 测试里被 mock 掉 / 当作助手用，`archiveToZip`/`zipToArchive` 从未被直接测过）。
- fixture 位置按 GUIDELINES §2「client / server 段通常省略」放在 `tests/utils/` 平铺（与原有 `hasher.test.ts` 一致），树里行尾标出源码路径。
- 未覆盖：`src/utils/index.ts`（桶文件）、`src/utils/json-schema.ts`（纯类型），均在「跳过」清单内。

### comfyui：已完成
- 用例：`comfyui/**` 共 19 个文件 / 263 用例（本轮新增 16 个文件 / 236 用例），数据落在 16 个 fixture json（每个目录就近，另有原有的 `model-version.json`、`editor/prompt.pools.json`）。
- 覆盖：`client` 的 proxy（含 `model.cache` 复用与回落）、5 个 store、feature 的提交流程、auto paint 工具（configureObject / schema 组装 / invoke / 模型查询工具）、`callback` 的四个入口、`editor` 的四个配置器（text/prompt/agentText/number）、`select` 的三个配置器、`civitai` 的 `extract` 递归解析与导入器；`server` 的 model/workflow 仓库（含 `param` 子仓库的 sequence 分配）、归档导入导出、importers（下载路径映射与设置回落链）、两个 api 路由、civitai server 的 curl 下载。
- 16/16 全部完成，无剩余文件。
- 遗留待确认：
  - 根目录既有的 `civitai.test.ts`（1 用例）与 `select.test.ts`（8 用例）测的其实就是 `civitai/client` 与 `select/client`，与本轮新写的嵌套用例目标重合；是否合并/删除需要用户确认（删除文件要先问）。
  - **既有用例 `editor/generator.test.ts:196`「概率门槛会让可选内容时有时无」是已知 flaky（约 50% 假失败）**：它不 mock `Math.random`，跑 50 次后断言「每个可选标记都出现过」+「至少一次缺 `optional[0]`」，两条都是概率断言（实测 4 次里 2 次失败）。用户确认**只记录、不改这条既有用例**；跑全量时若看到仅它失败，属于该 flake 而非回归。

### 已按确认的预期改动源码
- `src/comfyui/editor/client/index.tsx`：`prompt` 配置器的 id 由 `main.text.name` 改为 `main.prompt.name`。原来与 `text` 配置器撞 id，而注册顺序是 text → prompt、`Registry.register` 按 id 覆盖 ⇒ `text` 被顶掉（它的 `configureObject` 会去读 text 表单里根本没有的 `pools`，保存时抛 `Json is invalid`），`prompt` 则永远 `record()` 不到、相关参数被静默跳过。用例改成断言「四个 id 一一对应」与「text/prompt 各自可寻址」。
- `src/lorebooks/client/matchers/variable.tsx`：`String(current)` 改为 `String(current.item)`。`extract` 返回的是 `{item, key, pos}` 节点，原写法恒为 `'[object Object]'`，变量匹配器实际不可能命中（同文件 `patchOne` 的 test 分支、`tools/variables/client/index.tsx` 都是取 `current.item`）。
- `src/presets/regexes/server/storage.ts`：meta 写 `item`（原来传的是函数，序列化后内容丢失），正则条目现在可以正常归档往返。
- `src/presets/server/storage.ts`：重建封面沿用 meta 里的原始 MIME（原来又拼了一次 `image/`）。
- `src/presets/macros/client/realm.ts`：单选条件改 `&&`（没有选择时取第一个，已有选择时保留）；残留的已删除 code 跳过而不是抛错。
- `src/presets/macros/client/feature.tsx`：删掉被 setter 立即覆盖的死赋值。

### 已确认为设计、不加断言

- 同 code 的样式/脚本条目重复注入属既定软处理，重复 id 由页面报错暴露。
- `lorebooks/client/matchers/vector.ts` 只有 `output` 阶段才读向量；`lorebooks/client/matchers/normal.tsx` 的 `keywordsLength` 为 0 时直接不匹配。
- `comfyui/client/tool.tsx` 的 `painter.invoke` **不检查 `paintParam.disabled`**：禁用只表示「不让 ai 提供该参数」（建 schema 时会跳过它），提交时仍会按默认流程调用一次 `generateCalling`、用配置里的默认值构造（用户确认）。用例同时断言了这两面。
- `comfyui/client/tool.tsx` 提交失败时用 `JSON.stringify(err)`：`Error` 的 `message` 不可枚举，因此返回 `{}`、错误信息丢失（用户确认为现状）。
- `comfyui/select/client/index.tsx` 的 `modelSelect.configureInput` 写的是 `forms.str(data, 'model_<sequence>')` **原始表单字符串**，不经 `combobox.get`（与 `configureObject`/`generateCalling` 的取值方式不同；用户确认为现状）。

### models：已完成

- 用例：`models/**` 共 19 个文件 / 219 用例，数据落在 21 个 fixture json（每个目录就近，另有公共的 `tests/models/model.json`）。`client/setting.test.tsx` 按确认暂缓（展示层，见下）。
- 覆盖：`index` 的 toNameValue 与常量；`client` 的 convert/key/cache、请求代理、zustand 状态、`engines.prompt` 的注入生命周期与内容收集、`processers` 的 initialize/output/prompt/generate（含 retry 与非 retry 错误）；`server` 的引擎查找与 key 解密、repository 的缓存/加密/查询条件、api 的 CRUD+clone+SSE 分流、归档导入导出；三套 provider 的默认值、server 参数合并与省略规则、client 的 configureObject / prompt 组装 / result 解析（流式分片与非流式整包、tool_calls 归并、usage、stopped）。
- 剩余展示层未做：`models/client/setting.test.tsx`（与 presets/lorebooks 的展示层处理一致，按确认暂缓）。

### models：待修缺陷（有意保留的 expected fail，共 3 条）

非流式模型的工具调用会被静默丢弃，同一个根因：

- `src/models/openai/client/engine.tsx:463`（chat 非流式）与 `:365`（responses 非流式）只写了 `output.callings?.push(...)`，缺少流式分支（`:425` / `:316`）那样的 `output.callings ??= []`。
- `output` 的初值来自 `src/models/client/processer.ts:278-283`，只有 `{content, thought, variables, properties}`，**没有 `callings` 字段**，于是 `?.push` 直接空操作。
- 后果：`output.callings` 恒为 `undefined` → `tools.calling(realm, controller, output.callings)` 因 `!toolCalls?.length` 早退，工具永远不执行；`client/engine.ts:122-126` 的 `output.callings?.length ? caller(...) : (content ? assist(...) : 跳过)` 会走 `assist`，而工具轮的 content 通常是空串，等于这段历史什么都没注入；`finish_reason` 又是 `tool_calls` 而非 `stop`，`ctx.stopped` 不置真，循环继续空转。
- `src/models/deepseek/client/engine.tsx:294` 的 `result` 直接复用 `openais.engine.result`，同样受影响（anthropic 自己写了 `??=`，不受影响）。
- 用例：`tests/models/openai/client/engine.test.tsx` 两条 + `tests/models/deepseek/client/engine.test.tsx` 一条，名字写期望行为、断言按正常预期、注释含行号与成因；src 修好后把 `it.fails` 改回 `it`。

### models：已按确认的预期改动源码

- `src/models/openai/client/engine.tsx`：流式 chat 新建 calling 时 `arguments` 初值由首片参数改为 `''`。原来「赋值首片 + 紧接 `arguments +=` 首片」会把首片写两遍（首片 `{"city":"` + 次片 `上海"}` 实得 `{"city":"{"city":"上海"}`），`jsonUtils.parse(calling.arguments)` 直接失败，影响所有走流式的工具调用。
- `src/models/anthropic/client/engine.tsx`：流式 `signature_delta` 由 `output.properties['signature'] += delta.signature` 改为 `(output.properties['signature'] ?? '') + delta.signature`。原来首个分片会拼出 `"undefinedsig-a"`，而这个签名会随 thinking 块回传 API，Anthropic 会校验签名完整性。
- `src/models/deepseek/client/engine.tsx`：`caller` 在有正文且带 callings 时不再重复发一条正文相同的 assistant 消息（正文并进带 `tool_calls` 的那条）。用例补了「正文只出现一次」的回归断言。

### 可疑但未确认（未写断言）

- comfyui（本轮 8 处，用户已确认「先都只记录」，未改 src、未写 `it.fails`）：
  - `src/comfyui/server/repository-model.ts:23`：`create` 只判 `!model.id`、**不校验 uuid**，非法 id 会原样入库；同目录 `repository-workflow.ts:152` 用的是 `validate()`。
  - `src/comfyui/server/repository-workflow.ts:89`：`param.make(id, [])` 会对空数组执行 `values([])`，语义未定义（唯一调用点 `storage.ts:70` 的参数来自归档 json，可能是空数组）。
  - `src/comfyui/server/api-workflows.ts:23`：`exportProcess` 抹 `content`/`id` 抹的是 `repository.workflow.get()` 返回的**同一引用**，导出会污染调用方拿到的那份对象。
  - `src/comfyui/server/api-workflows.ts:144`：`nodeValue._meta.title.toLocaleLowerCase()` 无判空，节点缺 `_meta` 时抛 `TypeError`；且此时前面几个参数**已经 add 落库**，generate 非原子。
  - `src/comfyui/server/api-workflows.ts:30`：import 时 zip 内 meta 缺 `workflow` 会抛 `TypeError: Cannot set properties of undefined`，而不是同文件 `:35` 的 `BusinessError('import failed. invalid file')`。
  - `src/comfyui/civitai/server/index.ts:14`：`mkdir` 在参数校验之前（缺 `download` 也会先把目录建出来）；`:20` 的 `new URL(urlStr)` 在 `try` 之外，非法 URL 抛裸 `TypeError`（ERR_INVALID_URL）而不是包装后的 BusinessError。
  - `src/comfyui/civitai/client/index.tsx:45`：`meta.images.length` 未判空，`images` 缺失时抛 `TypeError`。
  - `src/comfyui/editor/client/index.tsx:394-402`：`agentText.configureObject` 用 `{...param}` 浅拷贝出 agent/texts 两份，**两者的 `config` 仍指向同一对象**；当前两个上游 `configureObject` 都是整体替换 `config` 所以无害（用例已用「默认值不被污染」把该前提固化成回归保护），但任一处改成就地改字段就会互相串。
  - `src/comfyui/select/client/index.tsx:165`、`:276`：`args` 与 `config` 里的值都缺时会赋值 `undefined`，**把节点已有的输入覆盖成 undefined**（`generateCalling` 无返回值、只改 `input`）。
- `src/utils/str.ts` 的 `wrap`：`text.replace('\n', ...)` 只替换**第一个**换行，pad 只补到第二行，第三行及以后没有前缀（实测 `wrap((t) => \`<${t}>\`, 'a\nb\nc', '> ')` → `'<> a\n> b\nc>'`）。用例只断言了单行与两行（两种读法下都成立），多行现象未写断言，疑似漏了 `/g`。
- `src/models/openai/client/engine.tsx:262-288` 的 chat `caller` 与 deepseek 修前同形：`content` 非空且有 callings 时会先发一条 `assistant(content)`，再发一条 `assistant(content, tool_calls)`，正文重复。deepseek 已按确认修掉，openai 这条是否也要一并对齐未确认。
- `src/models/anthropic/client/engine.tsx:201-208`：没有任何 system 注入时 `system` 就是 `''`，summaries 仍必定 unshift `{role:'system',content:''}`，`input.system=''` 也照发给 API。
- `src/models/anthropic/client/engine.tsx:112`：`max_tokens` 用 `forms.float`，字段为空时 `parseFloat('')=NaN` 会进请求体（JSON 化后为 `null`），非整数也照发，而 Anthropic 要求整数。openai/deepseek 同样用 forms.float/int，更像统一约定。
- `src/models/deepseek/client/engine.tsx:104-125`：`logprobs` 复选框与 `top_logprobs` 输入都带 `disabled`，disabled 控件不进 FormData ⇒ `configureObject` 实际总会写 `logprobs: false`、`top_logprobs: NaN`，覆盖默认的 10。
- `src/models/openai/client/engine.tsx` 的 `prompt`/`result` 都用 `utils.getProperty(ctx.realm, config, () => openais.default.config)`：realm 上没有 config 时会把这个**共享默认对象**写进 `realm.properties`，之后一直沿用（若先被初始化为默认 chat，之后切 responses 会被固定住）。
- `src/models/server/repository.ts` 的 `update` 先清 `model.id` 再写库，因此返回值恒为 `undefined`（调用方忽略，API 返回 `null`）。
- `src/lorebooks/client/realm.ts` 的 `layered` 构造器：只有 `middle(i)` 一个注入点，循环条件 `i === histories.length - 1 || u.layer + histories.length >= i + 100` 会提前 break。实测 3 段历史 + 两条常驻条目（layer 90 / 100）跑完 `middle(0..2)`，只注入了 layer 90 那条，layer 100（`lorebooks.default.layer`）始终没注入。用例目前只做「只提供 middle」「低层先注入」的正向断言，等确认层级语义后再补。
