# 方案：新增「改书」承接模式（carryover mode = rewrite）

- 状态：待实施（本分支 `feature/carryover-rewrite-mode`）
- 日期：2026-11-02
- 关联：`creativeCarryoverContract`（创作承接合同）

## 1. 背景与目标

现状"照着一本书写"只有两种承接模式：

| mode | 语义 | 硬规则位置 |
|---|---|---|
| `continuation` 续写 | 接在原书**结局之后**写 | `creativeCarryoverContract.prompts.ts:75-80` |
| `adaptation` 参考创作新书 | 只继承钩子/冲突/爽点/结构，**全部换皮**成独立新书 | `creativeCarryoverContract.prompts.ts:81-87` + `framing.prompts.ts:79` |

作者的第三种真实需求没有被覆盖：**我已经有自己的设定与章纲，想把它写成正文；原书只借结构/节奏/写法，不换皮、不推翻我的设定。**

目标：新增 `rewrite`（改书）模式——**以用户提供的设定与章纲为正史**，原书仅作结构方法参考。

## 2. 非目标

- 不改 `conversionPlan` 文案来当开关：它全仓只有 3 处引用（prompt 要求 / UI 展示 / 类型定义），**没有任何下游 prompt 消费**，改文案不驱动行为。
- 不新增 contract 顶层字段或 DB 迁移：`mode` 存在 JSON 内，`rewrite` 复用 `adaptationFocus` 的四个字段，仅改语义。
- 不动 `continuation` / `adaptation` 的现有行为。

## 3. 方案（最小可行）

### 3.1 语义
- `rewrite` 的 `adaptationFocus` 四字段复用为：
  - `hooks` → 可复用的**钩子方法**（抽象写法，不绑定原书专名）
  - `conflictLoops` → 可复用的**冲突循环方法**
  - `payoffRhythm` → 可复用的**爽点节奏**
  - `conversionPlan` → **改书执行方案**：如何把上述方法套到用户的设定与章纲上（替代"如何转成独立新书"）
- `sourceTraits` / `bookRealization` / `openingChapters` / `basis` 含义不变，但 `bookRealization` 改为说明"如何按用户设定+章纲落地"，`openingChapters` 对应**用户章纲的第 1–3 章方向**。

### 3.2 必须遵守的规则（prompt 硬规则）
1. 新书正史 = 用户提供的设定与章纲；原书专名、角色、世界事实、具体剧情**不得覆盖**用户设定。
2. 原书只提供结构/节奏/写法方法，**不强制换皮**，也不得凭空造新世界观/新主角。
3. `conversionPlan` 必须写清：沿用哪些结构方法、如何映射到用户章纲、哪些原书元素明确丢弃。

### 3.3 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `shared/types/creativeCarryoverContract.ts:6` | `creativeCarryoverModeSchema` 增加 `"rewrite"` |
| 2 | 同文件 `:72-80` | `REQUIRED/OPTIONAL_SECTIONS_BY_CARRYOVER_MODE` 增加 `rewrite`（与 adaptation 同：必需 plot_structure/style_technique/market_highlights） |
| 3 | 同文件 `:82-107` | `assertCreativeCarryoverFocusForMode`：`rewrite` 与 `adaptation` 同支（需 `adaptationFocus`，禁 `continuationFocus`），错误文案区分 |
| 4 | 同文件 `:150-161` | `buildOpeningIdeaFromCarryoverContract`：`rewrite` 前缀「改书开篇：」 |
| 5 | `server/src/prompting/prompts/novel/creativeCarryoverContract.prompts.ts:38,55-62,63-104` | 增加 `rewrite` 分支（规则见 3.2）；`postValidate` 与 `render` 的 mode 映射；`structuredOutputHint.note` 补 rewrite |
| 6 | `server/src/prompting/prompts/novel/framing.prompts.ts:59,79` | `isRewrite` 分支：卖点以用户设定/章纲为准，允许沿用用户设定中的专名，不强制换皮 |
| 7 | `server/src/services/novel/NovelFramingSuggestionService.ts:17` | 同上分支（referenceIntent === "rewrite"） |
| 8 | `client/src/pages/novels/autoDirector/CreativeCarryoverContractPanel.tsx:165-200` | `rewrite` 展示块（复用 adaptation 列表，标题改「改书沿用」/「改书执行方案」） |
| 9 | `client/src/pages/novels/components/ReferenceNovelStartDialog.tsx` | 创作方式增加第三项「改书（采用我的设定+章纲）」 |
| 10 | `client/src/pages/novels/autoDirector/AutoDirectorCreatePage.tsx` | `referenceMode=rewrite` 的文案/导航参数处理 |
| 11 | `server/src/services/novel/director/reference/CreativeCarryoverContractService.ts` | 校验/持久化按 mode 泛化（确认无 adaptation 硬编码） |

### 3.4 兼容性
- `mode` 是 JSON 内字符串，旧合同不受影响；`parseCreativeCarryoverContract` 遇到未知 mode 会 parse 失败返回 null（旧数据安全）。
- 新增枚举值会让 `Record<CreativeCarryoverMode, ...>` 在编译期强制补齐，漏改会 typecheck 失败（这是好事）。
- 不改 DB schema，无需 `db push`。

### 3.5 验证
- `pnpm --filter @ai-novel/server typecheck` + `pnpm --filter @ai-novel/client typecheck`（如有）。
- 现有 `creativeCarryoverLifecycle.test.js` 回归（continuation/adaptation 行为不变）。
- 手工：`mode=rewrite` 生成合同 → 字段齐全、`conversionPlan` 为"改书执行方案"文案；`mode=adaptation` 输出与改造前一致。

## 4. 风险
- **产品语义**：新增模式会出现在所有用户的"照着一本书写"里，需要产品确认文案与入口。
- **合同质量**：`rewrite` 的合同仍只基于拆书材料生成，**不读取用户设定/章纲**；`conversionPlan` 只能给"方法映射"，具体设定/章纲仍要在导入阶段注入。不要让它假装知道用户设定。
- **下游 framing**：若只改合同不改 `framing`，卖点仍会被"禁止原作专名"拦住，所以第 6/7 项必须一起改。

## 5. 不做什么
- 不做"改书"专用的新字段/新页面/新 DB 表。
- 不把 `conversionPlan` 当行为开关。
- 不为单本书做特例判断。
