# M6.1 合同审查 · 分档总览 + 双向跳转 + 过程可视化 设计文档

**版本**: v2（经 4 维度审查修订）
**日期**: 2026-04-21
**作者**: 产品（戴鑫）× Claude
**状态**: 设计已定稿，待 review 后进入 writing-plans

**v2 修订**（基于 R1-R9 审查）：
- 删除冗余字段 `counts` / `scoreLabel`，风险总分改为前端加权派生
- 定位兜底回到严格三级（精确 → 模糊 → 显式）
- 进度阶段从 6 段回到 5 段（rebuild 改为完成后隐形步骤）
- SSE 事件精简为 4 种（`stage/progress/risk/overview`），复用现有 `SSEMessageType`
- `clauseSegments` 改为内存对象不落库，去除字符偏移字段
- 子期 1 与子期 2 合并（让首个子期上线即有用户可感知价值）
- 明确 `ContractOverview` 类型放 `shared/types/contract.ts`

---

## 1. 目标

把合同审查从"审完才有东西看"的一次性工具，升级为"从提交到完成全程透明 + 审完有产品级总览"的协作体验。对应参考文章（Claude for Word）里打动人的两个点：**30 秒出分档摘要**、**每条风险可点击跳回原文**。

**可衡量的用户价值**（在 review 页上对比 M5）：

- 审查完成后 0.5 秒内用户能说出"高风险几条、最严重哪条、总评如何"
- 点任意一条风险 → 0.5 秒内文档定位到对应条款并保持高亮
- 审查过程中用户始终能看到"进行到哪一步了 / 已识别几条风险"，无黑盒等待

**非目标**（写在这里是为了防止范围蔓延）：

- 不做移动端适配（→ M6.2）
- 不做"所有条款都可悬停响应"（本期只有风险条款响应）
- 不改写风险生成的 prompt 策略（只升级输出结构和流式）
- 不做 Playbook（→ M7）

---

## 2. 范围 · 完整决策清单

| # | 决策项 | 选择 | 备注 |
|---|---|---|---|
| ① | 整体总览形态 | **方案 1C** | 风险总分仪表盘 0-100（前端加权派生）+ 三色计数（前端现算）+ 每档可点要点 + 总评 |
| ② | 跳转入口 | **1 + 2 + 4** | 点卡片 / 点要点 / 悬停文档段 |
| ③ | 反向触发方式 | **方式 B** | 有风险段落自带彩色底 + 徽章 + 悬停展开卡片 |
| ④ | 聚焦态视觉 | **方案 C** | 持续高亮 + 左侧红粗竖条 |
| ⑤ | 定位兜底 | **方案 D · 三级兜底** | 精确匹配 → 模糊匹配（关键词片段）→ 显式"未定位" |
| ⑥ | 浮动风险面板接线 | **纳入本期** | 补完已有的 `focusRisk` emit 链路 |
| ⑦ | PDF 导出同步 | **纳入本期** | 封面/摘要页用新结构 |
| ⑧ | 钉多条聚焦 | **方式 2AB** | 卡片右上📌 按钮 + Shift 点击快捷键 |
| ⑨ | 过程可视化 | **顶配 E** | 阶段进度 + 条款计数 + 风险卡片流式冒出 |
| ⑩ | 条款切分前置 | **本期附带** | 原 M7 计划，被 ⑨ 带动提前 |

推迟：移动端适配（M6.2）、所有条款可悬停（N+2）、Playbook（M7）。

---

## 3. 用户故事

### US-1：律师提交合同后能看到进度

作为律师，在我提交合同后，我希望能看到 AI 正在做什么、做到第几步，而不是盯一个转圈 60 秒。

**验收**：
- 提交完成 1 秒内右侧面板出现阶段进度条（5 个阶段：识别 → 等立场 → 切分 → 分析 → 汇总）
- 切分完成后显示"共 X 条条款"，分析过程显示"正在分析第 N / X 条"
- 每完成一条高/中/低风险，卡片立即出现在风险列表顶部（带"刚刚"角标 3 秒）
- 阶段切换有明显视觉差异（已完成绿点、进行中橙点 + 光晕、待进入灰点）
- 汇总完成后 Word 批注重建在后台进行，不占阶段槽位（下载按钮就绪时即视为全流程完成）

### US-2：审查完成后能一眼看懂风险全貌

作为律师，审查刚完成时我希望 0.5 秒内知道：这合同有多严重、严重在哪、该不该谈。

**验收**：
- 顶部仪表盘显示风险总分 0-100（前端按加权公式现算）+ 一句话定性（前端按分段派生："极高/高/中/低风险"）
- 三色计数卡清晰显示高/中/低数量（前端 `risks.filter(...)` 现算）
- 每档列出 1-5 条可点击要点
- 最下方一行总评（≤ 120 字，后端 LLM 生成）

### US-3：点任意入口都能跳回合同原文

作为律师，审阅结果时我希望点"风险卡片 / 分档要点 / 浮动面板条目"里的任何一个，都能立刻跳到合同原文对应段落，并且能看出"就是这段"。

**验收**：
- 三个入口行为一致：平滑滚动 + 条款进入聚焦态（黄底 + 红粗竖条）
- 聚焦态持续到用户点下一条或主动取消
- 聚焦条款与其他风险条款的背景色（各自的级别色）不打架

### US-4：律师可以对比多条风险

作为律师，谈判时我可能需要同时关注两条关联条款（例如付款 + 违约金）。

**验收**：
- 每张卡片右上角有📌 按钮，可切换"钉住/未钉"
- 已钉住的卡片视觉上与普通卡片区分（黄底 + 左边框）
- 被钉住的所有条款在文档上都保持聚焦态（持续高亮）
- Shift + 点击等价于手动📌（进阶用户快捷）
- 取消钉住 → 恢复为普通态

### US-5：扫视文档时就能发现问题条款

作为律师，在文档预览区滚动时，我希望一眼就能看出哪几段有风险，不用来回对照右侧卡片。

**验收**：
- 高/中/低风险条款在文档预览上分别带淡红/淡橙/淡灰底色
- 每个风险条款右上角挂高/中/低小徽章
- 鼠标悬停风险条款 → 右侧对应卡片自动展开到可视区并短暂高亮

### US-6：AI 定位不准时用户不会"点了没反应"

作为律师，如果 AI 给的风险在文档里实际找不到，我希望得到明确提示而不是静默失败。

**验收**（三级兜底）：
- 第 1 级 — 精确匹配：按 `clauseText` 全文查找，命中即定位
- 第 2 级 — 模糊匹配：取 `clauseText` 前 20 字作为关键词，忽略标点与空白做子串匹配
- 第 3 级 — 显式未定位：前两级都失败 → 卡片显示"⚠ 未定位"标签，附关键词片段供用户自查；点击卡片只展开不跳转

### US-7：PDF 报告与页面视觉一致

作为律师，我导出的 PDF 报告在封面/摘要页也应当呈现"风险总分 + 分档要点 + 总评"，而不是只看到一段纯文字。

**验收**：
- PDF 封面/摘要页结构与页面总览区一致
- 历史审查（M4/M5 生成的旧 `summary` 字符串）不崩溃：仅降级为"一段纯文字"

---

## 4. 数据结构变更

### 4.1 `summary` 字段升级为结构化

**现状**：`contractReviews.summary: String?`，内容是 LLM 直接输出的 Markdown 段落。

**决策**：`summary` 字段类型从 `String` 升级为 `JSON`，**不新增字段**。

**类型定义位置**：新增 `ContractOverview` 类型到 `shared/types/contract.ts`（与 `Risk`、`ContractReviewStatus` 等合同审查类型同文件）。

**新结构**（`contractReviews.summary` 的 TS 类型）：

```ts
interface ContractOverview {
  /** 分档要点，每档 1-5 条，挂 riskId 用于可点跳转。历史数据此字段为 null */
  highlights: {
    high: Array<{ text: string; riskId: string }>
    medium: Array<{ text: string; riskId: string }>
    low: Array<{ text: string; riskId: string }>
  } | null
  /** 总评（后端 LLM 生成，≤ 120 字）。历史 M4/M5 的 string 迁移后填这个字段 */
  overall: string
}
```

**为什么删了 score / scoreLabel / counts**（v2 审查结论）：

- `counts` 从 `risks[]` 一行就能算，冗余落库只会带来一致性负担
- `score` 从 `counts` 加权派生即可（见下），后端存储等于重复数据源
- `scoreLabel` 可完全由 `score` 分段派生（≥70 极高、≥50 高、≥30 中、<30 低），没有独立数据价值

**风险总分 / 定性的派生规则**（前端计算，单一来源）：

```
counts = { high, medium, low } = 前端按 risks.level 分组计数
score  = min(100, round(3 × high + 1.5 × medium + 0.5 × low))
scoreLabel = score ≥ 70 ? '极高风险'
           : score ≥ 50 ? '风险偏高，建议谈判'
           : score ≥ 30 ? '风险可控'
           : '低风险'
```

**兼容策略**（避免破坏性）：

- DB 迁移：`summary: String?` → `summary: Json?`。迁移脚本把历史 string 包成 `{ highlights: null, overall: <old_string> }`
- 前端层：统一读 `review.summary.overall` 渲染总评；`summary.highlights` 为 null（历史数据或 summarize 未完成）时要点区隐藏，仅展示仪表盘（score）+ 三色计数（counts）+ 风险卡片列表
- PDF 服务：同前端降级规则

### 4.2 `Risk` 结构补充

现有字段保持不变。**新增：**

- 无新字段。`riskId`、`clauseIndex`、`clauseText`、`level` 已足够

### 4.3 条款切分结果（⑩，不落库）

条款切分结果为**审查流程内的中间数据**，仅存在于 workflow 内存里，不写入 DB。

```ts
interface ClauseSegment {
  /** 顺序号，从 1 开始 */
  index: number
  /** 条款编号文本，如 "3.2"、"第五条"、null（无标号散段） */
  number: string | null
  /** 条款正文 */
  text: string
}
```

用途：

- `clauseAnalyzer` 的迭代对象（分析第 N / X 条的 N 和 X）
- 为 M7 Playbook 对照铺底时再考虑是否持久化

**为什么不落库**（v2 审查结论）：

- 三级兜底（精确 → 模糊 → 显式）不依赖字符偏移，删除 `offset` 字段
- 切分结果只在审查流程中使用一次，后续页面刷新不需要再回溯
- 落库会引入"切分与 risks 的一致性"额外负担，ROI 低

---

## 5. 后端改造

### 5.1 流式输出管线（⑨ + ⑩）

当前：`contractReviewMainAgent` 整篇合同一次性给 LLM，`toolStrategy(riskSchema)` 出一个 `{ risks, summary }` 结构化结果 → `reviewResultPersistenceMiddleware` 一次性落库。

**复用现有 SSE 基建**（v2 审查结论）：

- 新事件**全部**经 `publishCustomEvent()` 发出，前端通过 `useStreamChat` 的 `onCustomEvent` 回调消费
- **不**新增 `SSEMessageType` 枚举值；合同审查的阶段事件归属为"自定义 payload 中的 type 字段"
- 详见 `docs/tech-docs/patterns/sse-event-bridge.md`

**SSE 事件协议**（v2 精简为 4 种）：

```ts
type ContractReviewEvent =
  | { type: 'stage'; stage: 'detect' | 'stance' | 'segment' | 'analyze' | 'summarize'; status: 'running' | 'done'; warnings?: string[]; totalClauses?: number; partyA?: string; partyB?: string; contractType?: string }
  | { type: 'progress'; current: number; total: number }
  | { type: 'risk'; risk: Risk }
  | { type: 'overview'; overview: ContractOverview }
```

- `warn` 事件去除，失败统一合入 `stage` 事件的可选 `warnings: string[]` 字段（v2 R7）
- `clauseSegment` 事件去除，切分结果随 `stage:segment,status:done` 的 `totalClauses` 字段携带（v2 R7）

**新管线**（5 段进度 + rebuild 隐形）：

```
[partyDetector]           → SSE: { type:'stage', stage:'detect', status:'running' }
                            → SSE: { type:'stage', stage:'detect', status:'done', partyA, partyB, contractType }
    ↓
[awaitingStance]          → SSE: { type:'stage', stage:'stance', status:'running' }
    ↓  (interrupt + resume)
                            → SSE: { type:'stage', stage:'stance', status:'done' }
    ↓
[clauseSegmenter] (新)    → SSE: { type:'stage', stage:'segment', status:'running' }
                            → SSE: { type:'stage', stage:'segment', status:'done', totalClauses: 24 }
    ↓
[clauseAnalyzer] (新)     → SSE: { type:'stage', stage:'analyze', status:'running' }
                            → 遍历 24 条，每条：
                              · SSE: { type:'progress', current:14, total:24 }
                              · 若产出 risk：SSE: { type:'risk', risk:{...Risk} }
                            → 单条失败累积到 stage-done 的 warnings[]
                            → SSE: { type:'stage', stage:'analyze', status:'done', warnings:[...] }
    ↓
[summarize] (新/改造)     → SSE: { type:'stage', stage:'summarize', status:'running' }
                            → SSE: { type:'overview', overview:{...ContractOverview} }
                            → SSE: { type:'stage', stage:'summarize', status:'done' }
    ↓
[rebuild]（隐形，不占阶段槽位）→ 不再 emit stage 事件；完成后走现有 reviewedFileId 写 DB
    ↓
[persistence]             → DB 分阶段写：每 risk 出立即增量追加 risks[]；overview 拿到后更新 summary；rebuild 完成后更新 reviewedFileId
```

**要点：**

- `clauseSegmenter`：优先正则（识别"第X条"/"1.1"/"一、"等），兜底用轻量 LLM
- `clauseAnalyzer`：按条款循环，每条独立 LLM 调用，允许某些条款跳过；risk 字段生成仍用 `buildRiskSchema` 校验
- 失败容忍：单条条款分析失败不阻塞后续，累积到 `stage:analyze,status:done` 的 `warnings[]`
- 事件序号：每个 SSE 事件带 `seq` 递增，前端可去重
- 取消：用户中途放弃 → 停止循环 + 保留已分析的 risks（最佳努力）
- rebuild 作为"用户不必等待"的后台步骤；"下载批注 Word"按钮在 `reviewedFileId` 就绪后自动启用

### 5.2 持久化中间件改造

- 从"一次性写 risks + summary"改成"增量写"：
  - 每 risk 出 → `risks = [...risks, newRisk]`（用 `contractReviews.updatedAt` 作为乐观锁基线，避免 SSE 乱序时覆盖）
  - summarize 完成 → 写 `summary`（新 JSON 结构 `ContractOverview`）
  - rebuild 完成 → 写 `reviewedFileId`
- 切分结果（`clauseSegments`）不落库，仅在 workflow 内存中流转

### 5.3 PDF 导出（⑦）

`contractReviewPdf.service.ts` 渲染封面/摘要页时：
- 优先读 `summary.overview` 结构化数据渲染仪表盘 + 三色计数 + 分档要点 + 总评
- 读不到（旧数据） → 降级渲染为单段文字
- 风险清单页保持不变（已经按 level 分组）

---

## 6. 前端改造

### 6.1 新组件 / 改造组件

**A. 右侧面板顶部总览区**（新组件，替换现 `RiskListPanel` 里的 `<div v-if="summary">`）
- 风险总分仪表盘（SVG 或 conic-gradient 实现）
- 三色计数卡（点击跳到右侧列表对应分组，不跳文档）
- 分档要点列表（每条可点，点击 → 触发跳转入口 ②）
- 总评

**B. 风险卡片（改造 `RiskListPanel` 中现有卡片）**
- 右上角新增📌 按钮
- 新增 "pinned" 视觉态
- 新增 "active"（聚焦）视觉态

**C. 文档预览区（改造 `ContractDocxPreview`）**
- 挂载后遍历渲染结果，为每个风险段落注入：
  - 背景色（按 level）
  - 右上小徽章
  - `data-risk-id` 属性供反向定位
- 支持外部调用 `focusClause(riskId)` → 滚动 + 切换 active 样式
- 支持悬停事件 → emit `hoverClause(riskId)`

**D. 浮动风险面板（完成现有半拉子）**
- `focusRisk` emit 连到 `ContractReviewPanel` 统一调度器
- 点条目 → 同样跳文档并激活卡片

**E. 进度组件（新）**
- 5 段阶段进度条（含"分析中 X / Y"计数和进度条）
- 在审查中时悬浮在面板顶部
- 所有完成后自动收起

### 6.2 状态管理（`useContractReview` 扩展）

**新增状态：**

```ts
const stageStatus = ref<{
  detect: 'wait' | 'running' | 'done' | 'error'
  stance: 'wait' | 'running' | 'done'
  segment: 'wait' | 'running' | 'done'
  analyze: 'wait' | 'running' | 'done'
  summarize: 'wait' | 'running' | 'done'
  rebuild: 'wait' | 'running' | 'done' | 'skipped'
}>

const totalClauses = ref<number | null>(null)
const analyzingClauseIndex = ref<number | null>(null)

/** 当前聚焦的 riskId。null = 无聚焦 */
const focusedRiskId = ref<string | null>(null)

/** 被钉住的 riskIds（Set），支持多选 */
const pinnedRiskIds = ref<Set<string>>(new Set())

/** 派生：所有高亮态的 riskIds（focused + pinned 合集） */
const highlightedRiskIds = computed(() => {
  const s = new Set(pinnedRiskIds.value)
  if (focusedRiskId.value) s.add(focusedRiskId.value)
  return s
})

function focusRisk(riskId: string | null)
function togglePin(riskId: string)
function clearAllPins()
```

**统一调度器**（`ContractReviewPanel` 提供）：

任何一个入口（卡片点击、要点点击、浮动面板点击、文档悬停）→ 调同一个 `focusRisk(riskId)` → 下游三件事：
1. 文档预览滚动 + 切换 active 样式
2. 风险卡片列表滚动到对应卡片 + active 样式
3. 浮动面板对应条目高亮

悬停文档段落 → `hoverClause(riskId)` → 仅让对应卡片"短暂高亮 + 滚到可视区"，不入 focused 态（避免鼠标一过就把 active 态刷掉）。

### 6.3 SSE 消费

现有 `useStreamChat` 已支持 custom event 透传。在本期扩展：
- 识别新的事件类型：`stage` / `progress` / `risk` / `overview` / `warn`
- 逐事件更新 `stageStatus` / `totalClauses` / `risks`（追加）/ `overview`
- `risk` 事件用"刚刚"角标 3 秒，便于用户察觉新增

---

## 7. 交互规范

### 7.1 视觉基线

| 元素 | 正常态 | 悬停/hover | 聚焦 / active | 钉住 |
|---|---|---|---|---|
| 文档条款 | 按 level 淡色底 + 3px 左边框 + 右上徽章 | 底色加深一档 | 底色 `#fde68a`，左边框 `5px #b91c1c`，外加 1px 光晕 | 同 active |
| 风险卡片 | 白底 / 1px 灰框 | 1px 蓝框 | 黄底 + 5px 左红边框 | 黄底 + 3px 左橙边框 + "📌 已钉"标签 |
| 分档要点 | 黑字 | 蓝字下划线 | — | — |
| 浮动面板条目 | 灰字 | 蓝字底浅色 | 蓝字 + 粗 | — |

颜色对比度必须过 WCAG AA（正文 4.5:1）。浅底绝不配浅字。

### 7.2 跳转行为

- 入口触发 → `scrollIntoView({ behavior: 'smooth', block: 'center' })`
- 滚动完成 + 200ms 延迟后标记 active
- 切换另一条 active → 旧 active 立刻变回正常态；除非该条也被钉住
- ESC 键 → 清除 focused（保留 pinned）
- 大尺寸合同（> 100 段）滚动时关闭 smooth 改 auto 避免卡顿

### 7.3 过程透明

- 阶段条目：done 绿点、running 橙点光晕（呼吸动画）、wait 灰点
- 分析中：`正在分析第 14 / 24 条…` 文案 + 细进度条
- 每新增一条 risk：卡片从顶部滑入 + 淡黄色过渡 3 秒 + "刚刚" 角标
- 总分仪表盘：在 summarize 完成前显示骨架屏（shimmer）
- 全部完成：阶段条自动折叠为 2 行摘要"✓ 审查完成 · 10 条风险 · 总分 55/100"

---

## 8. 错误处理 & 降级

| 场景 | 行为 |
|---|---|
| SSE 中断 | `useStreamChat` 已有重连；重连后状态由后端快照补齐（读 review GET 拉一次） |
| 某条条款分析失败 | SSE `warn` 事件，前端 `stageStatus.analyze = done` 时统计失败数并 toast "N 条条款分析失败，已跳过" |
| `summary.highlights`/`counts`/`score` 缺失（历史数据） | 前端渲染 `summary.overall` 一段文字 + 客户端从 `risks[]` 现算 counts；要点区隐藏 |
| 定位失败 | 三级兜底（§5 - 4.2）；最终仍失败 → 卡片显示"⚠ 未定位"标签 |
| 合同极短（< 3 条条款） | 跳过切分，直接整篇分析；仍出 overview |
| 合同极长（> 200 条条款） | 给一个硬上限（比如 150 条），超过后分批 + 告知用户可能不完整 |
| 用户中途取消 | 停止分析循环；已出的 risks 保留；review 状态置为 `failed` 但保留数据 |
| 钉住数量 | 不限制数量；但全高亮时文档观感会乱 → UI 给一个"清除所有钉"按钮 |

---

## 9. 测试覆盖

### 9.1 后端

- **clauseSegmenter**：准备 5 份样本合同（不同编号风格：第X条 / 1.1 / 一、/ 混合 / 无编号），正则命中率 ≥ 90%，LLM 兜底覆盖剩余
- **clauseAnalyzer**：单条条款分析失败不影响整体；LLM 返回非法 risk 时用 zod 拒绝并 warn
- **流式事件顺序**：stage → progress → risk → overview → rebuild 的严格顺序用 property 测试验证
- **持久化**：增量写时的并发一致性（模拟 SSE 乱序到达）
- **PDF**：新老 summary 各渲染一份样本

### 9.2 前端

- **useContractReview**：`focusRisk` / `togglePin` / `clearAllPins` 状态机
- **ContractDocxPreview**：挂载后能正确注入 data-risk-id；外部 focusClause 能滚到正确位置；悬停 emit 节流 200ms
- **RiskListPanel**（新总览区）：overview 缺失时降级渲染；要点点击 emit 正确 riskId
- **ContractReviewPanel**：三入口统一调度；pinned + focused 组合视觉
- **进度组件**：5 阶段切换；阶段切换动画；完成后自动折叠

### 9.3 E2E（可选）

用 chrome-devtools MCP 跑 1 条完整路径：提交 → 看进度条 → 选立场 → 看卡片逐条冒出 → 点要点跳转 → 钉两条 → 导出 PDF → 验证 PDF 内容。

---

## 10. 里程碑拆分（供 writing-plans 参考）

工期预估 **10-12 天**。建议按独立可上线的子期拆：

**子期 1（基础 · 4 天）**：数据结构升级 + 流式骨架 + 阶段进度组件
- DB migration（summary → JSON / 新增 clauseSegments）
- 后端 stage 事件透传（不改分析逻辑）
- 前端阶段进度条
- **交付物**：用户提交合同能看到 5 阶段状态，审查结果和现在一样

**子期 2（切分 + 计数 · 2 天）**：clauseSegmenter + progress 事件
- 条款切分节点
- progress SSE
- 前端 X / Y 计数
- **交付物**：切分完成能看到总条款数，分析过程能看到进度

**子期 3（逐条流式 · 2 天）**：clauseAnalyzer 改造
- 按条款循环 LLM 调用
- risk 事件增量推送
- 前端卡片流式冒出 + "刚刚"角标
- **交付物**：风险卡片不再一次性出现，边审边看

**子期 4（总览页面 · 2 天）**：overview 结构 + 新总览区
- overview schema 生成
- 前端仪表盘 / 三色计数 / 可点要点 / 总评 4 件套
- PDF 同步
- **交付物**：审查结果顶部是新总览

**子期 5（跳转联动 · 2 天）**：三入口 + 反向悬停 + 钉多条
- 文档预览注入 + 统一调度器
- 卡片📌 按钮 + Shift 快捷键
- 浮动面板接线
- 三级定位兜底
- **交付物**：完整交互达到 mockup 最终形态

各子期之间后向兼容：即便只上到子期 3，产品仍然完整可用。

---

## 11. 开放问题（写在这里等 writing-plans 再查）

- `clauseSegmenter` 的正则具体规则：是否覆盖"附件X"/"补充条款"等非标准编号？
- 风险总分 0-100 的计算口径是 LLM 自评还是前端按 count 加权（3×high + 1.5×medium + 0.5×low）？ — 推荐后者（更稳定）
- 钉住数量是否设软上限（比如超过 10 条提示"钉太多了"）？
- 切分失败（LLM 兜底也败）时该置失败态还是降级整篇分析？ — 默认降级整篇

这几个留到实施计划阶段再敲细。
