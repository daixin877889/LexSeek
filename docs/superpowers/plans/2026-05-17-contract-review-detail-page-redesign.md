# 合同审查详情页重设计 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把合同审查详情页（`/dashboard/contract/[id]`）按 ui_kits 设计稿重做——抽屉式风险详情、审查总览独立标签、风险分速览条，配色对齐品牌。

**Architecture:** 原地改造 14 个现有组件 + 1 个配色工具文件，新建 1 个详情抽屉组件。所有 composable / 后端 / 数据结构零改动。核心交互变化：点风险卡由"卡片就地展开"改为"打开抽屉"——风险详情渲染从 `RiskCard` 迁入新建的 `RiskDetailPanel`，由 `focusedRiskId` 统一驱动抽屉显隐。

**Tech Stack:** Nuxt 4 + Vue 3 + Tailwind v4 + shadcn-vue；Vitest 组件测试（worker 级 DB 隔离）+ chrome-devtools E2E。

**关键参考：**
- 设计稿：`/Users/daixin/Downloads/ui_kits/dashboard/ContractReviewDetailPage.jsx`（下文标注行号）
- 设计文档：`docs/superpowers/specs/2026-05-17-contract-review-detail-page-redesign-design.md`（下文标注「区块 N」）
- 令牌权威：`/Users/daixin/Downloads/LexSeek UI 重构/colors_and_type.css`

**全局约束（每个任务都适用）：**
- 详情页处于 `.theme-brand` 作用域，`--primary` = 品牌天蓝。沿用语义类（`bg-card`/`border`/`text-primary`/`bg-primary/10`/`text-muted-foreground`），**不硬编码颜色**。
- 实心主按钮 / 分段控件选中态 → `bg-gradient-brand-button text-white`。
- 设计稿里的硬编码 rgba 一律换成带透明度的 Tailwind 语义类（如 `rgba(220,38,38,0.05)` → `bg-red-600/5`）。
- 图标一律 `lucide-vue-next` SVG 组件，**禁止 emoji**。
- 所有 `DialogContent` 至少含一行 `DialogDescription`（可 `sr-only`）。
- 卡片不写常驻阴影；抽屉 / 弹窗 / 横幅 / 渐变按钮保留阴影。
- 类型检查统一 `npx nuxi typecheck`（不要用 `tsc`）。
- 单文件测试 `npx vitest run <path> --reporter=verbose`。

---

## Task 1: 风险等级配色微调（`contractRiskLevelStyle.ts`）

**Files:**
- Modify: `app/utils/contractRiskLevelStyle.ts`

**设计依据：** 设计稿 `RISK_LV`（行 47-60）低风险徽章 `#94a3b8` = Tailwind `slate-400`；现有代码用 `gray-400`。其余取值已对齐。

- [ ] **Step 1: 改低风险徽章色**

`RISK_LEVEL_BADGE_CLASS.low` 由 `'bg-gray-400 text-white'` 改为 `'bg-slate-400 text-white'`。
`RISK_LEVEL_DOCX_BG_CLASS` / `RISK_LEVEL_DOCX_FOCUS_CLASS` / `RISK_LEVEL_DOCX_HOVER_BG` / `CLIENT_REDLINE_BADGE` **不动**（已对齐设计稿）。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 通过（无新增报错）。

- [ ] **Step 3: 跑受影响测试**

Run: `npx vitest run tests/app/components/assistant/contract/RiskListPanel.badge.test.ts tests/app/components/assistant/contract/RiskCard.test.ts --reporter=verbose`
Expected: 通过；若有断言写死 `bg-gray-400`，改成 `bg-slate-400`。

- [ ] **Step 4: 提交**

```bash
git add app/utils/contractRiskLevelStyle.ts tests/app/components/assistant/contract/RiskListPanel.badge.test.ts tests/app/components/assistant/contract/RiskCard.test.ts
git commit -m "refactor(contract): 风险等级低风险徽章色对齐设计稿 slate-400"
```

---

## Task 2: 批注气泡视觉重做（`AnnotationBubble.vue`）

**Files:**
- Modify: `app/components/assistant/contract/AnnotationBubble.vue`
- 设计稿：`ContractReviewDetailPage.jsx` 行 319-349（`AnnotationBubble`）
- 设计文档：区块 6

**当前结构：** 63 行，props `annotation` / `canDelete`，emit `delete`。

- [ ] **Step 1: 读参考**

读现有 `AnnotationBubble.vue` 与设计稿行 319-349，确认 props/emit 不变。

- [ ] **Step 2: 重做模板与样式**

按设计稿改：
- 22px 圆头像：`shrink-0`，AI 作者（`authorType === 'ai'`）用 `bg-primary/10 text-primary` + `Bot` 图标；其余用 `bg-muted text-muted-foreground` + `User` 图标。
- 头像右侧一行：作者名（AI 显示「AI」，否则 `authorName`，`font-semibold text-xs`）+ 时间（`text-[10.5px] text-muted-foreground`）+ 删除按钮（`canDelete` 时显示，`ml-auto`，`Trash2` 图标，`hover:bg-muted`）。
- 正文：`text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words`。
- props / emit / 删除逻辑保持不变。

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 通过。

- [ ] **Step 4: 视觉自查**

`bun dev` 启动，浏览到含批注的风险（任一已完成审查），确认 AI / 律师两种气泡配色正确、深色模式不糊。无独立单测文件，靠视觉 + typecheck 验证。

- [ ] **Step 5: 提交**

```bash
git add app/components/assistant/contract/AnnotationBubble.vue
git commit -m "refactor(ui): 批注气泡按设计稿重做"
```

---

## Task 3: 条款差异视觉重做（`RiskClauseDiff.vue`）

**Files:**
- Modify: `app/components/assistant/contract/RiskClauseDiff.vue`
- Test: `tests/app/components/assistant/contract/RiskClauseDiff.test.ts`
- 设计稿：`ContractReviewDetailPage.jsx` 行 352-399（`RiskClauseDiff`）、行 315-316（`lvBox`/`fieldLabel`）
- 设计文档：区块 6

**当前结构：** 173 行，props 含 `mode`（`stacked`/`inline-diff`）、`clauseText`、`suggestedClauseText`、`problematicQuote`、`quoteCharStart/End`、`clauseParagraphIndex`。diff 算法逻辑不变。

- [ ] **Step 1: 读参考**

读现有 `RiskClauseDiff.vue` 与设计稿行 352-399。props / emit / diff 计算逻辑**不变**，只改视觉。

- [ ] **Step 2: 重做模板与样式**

- 字段标签：小图标（`FileText`/`Quote`/`TriangleAlert`/`PencilLine` 等 lucide）+ `text-[11px] font-medium text-muted-foreground`。
- `stacked` 模式：条款标题行 / 完整原文（问题片段用下划线高亮，`text-decoration` 等级色）/ 问题片段（`bg-amber-600/8` + `border border-amber-600/30` + 斜体）/ 建议改写（`bg-emerald-600/10` + `border border-emerald-600/25`；无建议时 `bg-muted text-muted-foreground` 斜体「无建议改写」）。
- `inline-diff` 模式：行内增删——删除 `bg-red-600/15 text-red-700 line-through`，新增 `bg-emerald-600/15 text-emerald-700 font-semibold`。
- 文本容器统一 `rounded-md px-3 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap`。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/RiskClauseDiff.test.ts --reporter=verbose`
Expected: 通过。若测试断言写死了被改掉的 class，按新 class 更新断言；diff 行为类断言应保持通过。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/RiskClauseDiff.vue tests/app/components/assistant/contract/RiskClauseDiff.test.ts
git commit -m "refactor(ui): 条款差异组件按设计稿重做"
```

---

## Task 4: 审查总览视觉重做（`OverviewPanel.vue`）

**Files:**
- Modify: `app/components/assistant/contract/OverviewPanel.vue`
- Test: `tests/app/components/assistant/contract/OverviewPanel.test.ts`
- 设计稿：`ContractReviewDetailPage.jsx` 行 636-736（`OverviewPanel` + `OVERVIEW_HL`）
- 设计文档：区块 7

**当前结构：** 208 行，props `risks`/`summary`/`playbookSnapshot`，emit `focusRisk`。`useContractOverview` / `useContractPlaybookMatch` 逻辑不变。

- [ ] **Step 1: 读参考**

读现有 `OverviewPanel.vue` 与设计稿行 636-736。props / emit / composable 调用**不变**。注意：本组件不再"常驻风险清单顶部"，会被 Task 9 改为「审查总览标签页」的内容——本任务只改它自身样式，挂载点改动留给 Task 9。

- [ ] **Step 2: 重做模板与样式**

- 环形仪表盘：`conic-gradient` 风险分弧（弧色 `#dc2626` 即 red-600，与设计稿一致）+ 中心 `bg-card` 圆 + 分值。
- 三色计数格：`grid grid-cols-3`，高=红微底、中=橙微底、低=灰蓝微底（用 `contractRiskLevelStyle.ts` 的 `cntBg/cntFg` 思路或语义类 `bg-red-600/10 text-red-700` 等）。纯展示不可点（保持 `div`）。
- 高/中/低要点分组：每条 `button`，可点 `emit('focusRisk', riskId)`，`hover:bg-primary/8`。
- 审查清单对照：`rounded-md border bg-background`，命中项可点跳转、未命中折叠。
- 总评：`border-l-4 border-primary` + `bg-primary/5` + 「总评：」`text-primary font-semibold`。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/OverviewPanel.test.ts --reporter=verbose`
Expected: 通过；断言写死被改 class 的按新 class 更新。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/OverviewPanel.vue tests/app/components/assistant/contract/OverviewPanel.test.ts
git commit -m "refactor(ui): 审查总览面板按设计稿重做"
```

---

## Task 5: 版本时间线视觉重做（`ContractVersionTimeline.vue`）

**Files:**
- Modify: `app/components/assistant/contract/ContractVersionTimeline.vue`
- Test: `tests/app/components/assistant/contract/ContractVersionTimeline.test.ts`
- 设计稿：`ContractReviewDetailPage.jsx` 行 739-830（`VersionTimeline`）
- 设计文档：区块 2

**当前结构：** 176 行，props `versions`/`currentVersionId`/`previewVersionId`，emit `select-version`/`exit-preview`/`update-note`。折叠开关、备注编辑逻辑不变。

- [ ] **Step 1: 读参考**

读现有 `ContractVersionTimeline.vue` 与设计稿行 739-830。props / emit / 本地状态 / localStorage key `contract-timeline-collapsed` **不变**。

- [ ] **Step 2: 重做模板与样式**

- 收起态（48px 宽）：仅圆点 + `v{n}`，选中圆点 `bg-primary` + `ring-4 ring-primary/20`。
- 展开态（220px 宽）：节点左竖线、圆点、选中卡 `bg-primary/10 border border-primary/30`、标题 `text-primary`。
- 折叠开关按钮、律师备注查看/编辑态（`Textarea` + 保存/取消）按设计稿配色重做。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/ContractVersionTimeline.test.ts --reporter=verbose`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/ContractVersionTimeline.vue tests/app/components/assistant/contract/ContractVersionTimeline.test.ts
git commit -m "refactor(ui): 版本时间线按设计稿重做"
```

---

## Task 6: 合同预览段落高亮 + 浮动按钮重做（`ContractDocxPreview.vue`）

**Files:**
- Modify: `app/components/assistant/contract/ContractDocxPreview.vue`
- Test: `tests/app/components/assistant/contract/ContractDocxPreview.test.ts`、`ContractDocxPreview.highlight.test.ts`
- 设计稿：`ContractReviewDetailPage.jsx` 行 833-892（`DocxPreview`）
- 设计文档：区块 3

**当前结构：** 425 行。`docx-preview` 渲染、`runDecorateOnce`、`decorateRisks`、quote 高亮、`fetchSeq` 防护、watch —— **全部逻辑不动**。

- [ ] **Step 1: 读参考**

读现有 `ContractDocxPreview.vue` 与设计稿行 833-892。段落高亮 class 来自 `contractRiskLevelStyle.ts`（Task 1 已确认无需改 docx 类）。

- [ ] **Step 2: 重做浮动「＋」按钮与空态**

- hover 段落浮现的「＋新增风险」按钮：`bg-primary text-primary-foreground` 圆形、`shadow`、`hover:scale-110`（强调元素，保留阴影）——现有写法已接近，确认配色用 `bg-primary` 即可。
- 空态「等待合同上传…」：`text-sm text-muted-foreground`，居中，按新风格微调留白。
- 段落风险高亮配色：已在 `contractRiskLevelStyle.ts`，无需改本文件——仅确认渲染正确。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/ContractDocxPreview.test.ts tests/app/components/assistant/contract/ContractDocxPreview.highlight.test.ts --reporter=verbose`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/ContractDocxPreview.vue
git commit -m "refactor(ui): 合同预览浮动按钮与空态对齐设计稿"
```

---

## Task 7: 审查进度条视觉对齐（`ReviewProgress.vue`）

**Files:**
- Modify: `app/components/assistant/contract/ReviewProgress.vue`
- Test: `tests/app/components/assistant/contract/ReviewProgress.test.ts`
- 设计文档：区块 9（无设计稿，按新视觉风格调一致）

**当前结构：** 71 行，props `stages`/`totalClauses`/`analyzingIndex`。

- [ ] **Step 1: 读参考**

读现有 `ReviewProgress.vue`。设计稿未画此组件——按设计稿整体视觉语言（品牌色、圆角、间距、`Loader2`/`CheckCircle2` 图标）调一致。**逻辑不动**。

- [ ] **Step 2: 重做样式**

- 阶段项：完成态 `text-emerald-600` + `CheckCircle2`，进行中 `text-primary` + `Loader2` 旋转，待办 `text-muted-foreground` + 灰点。
- 整体配色、间距对齐其他重做后的组件。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/ReviewProgress.test.ts --reporter=verbose`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/ReviewProgress.vue tests/app/components/assistant/contract/ReviewProgress.test.ts
git commit -m "refactor(ui): 审查进度条视觉对齐新设计"
```

---

## Task 8: 新建风险详情抽屉（`RiskDetailPanel.vue`）

**Files:**
- Create: `app/components/assistant/contract/RiskDetailPanel.vue`
- Create: `tests/app/components/assistant/contract/RiskDetailPanel.test.ts`
- 设计稿：`ContractReviewDetailPage.jsx` 行 477-633（`iconBtnStyle` + `RiskDetailPanel`）
- 详情区块结构可参考现有 `RiskCard.vue` 行 262-345（`CardContent` 内联详情，迁移来源）
- 设计文档：区块 5

**说明：** 全新组件，本任务结束时它还没被任何组件挂载（Task 9 才接线），因此 typecheck 只要求它自身能编译。

- [ ] **Step 1: 读参考**

读设计稿行 477-633、现有 `RiskCard.vue` 行 108-347（详情渲染来源）、`RiskClauseDiff.vue`、`AnnotationBubble.vue`（Task 2/3 已重做）。

- [ ] **Step 2: 写组件 `<script setup>`（完整代码）**

```vue
<script setup lang="ts">
import {
    XIcon, ChevronLeftIcon, ChevronRightIcon, PinIcon, PencilIcon, Trash2Icon,
    CheckCircle2Icon, XCircleIcon, SendIcon, MessageCircleIcon, SparklesIcon,
    ClipboardListIcon, TriangleAlertIcon,
} from 'lucide-vue-next'
import type {
    Risk, RiskDisplayPhaseB, RiskArchivedStatus, PlaybookSnapshot, ContractAnnotationEntity,
} from '#shared/types/contract'
import { RISK_LEVEL_LABEL } from '#shared/types/contract'
import { RISK_LEVEL_BADGE_CLASS as LEVEL_CLASS, CLIENT_REDLINE_BADGE } from '~/utils/contractRiskLevelStyle'
import AssistantContractAnnotationBubble from '~/components/assistant/contract/AnnotationBubble.vue'
import AssistantContractRiskClauseDiff from '~/components/assistant/contract/RiskClauseDiff.vue'

const props = defineProps<{
    risk: RiskDisplayPhaseB
    annotations: ContractAnnotationEntity[]
    /** 在当前风险清单展示顺序中的下标，用于上一条/下一条 */
    index: number
    total: number
    readOnly: boolean
    isCompleted: boolean
    /** 工作区可编辑：!isRebuilding && isCompleted（父组件算好透传） */
    editable: boolean
    currentUserId?: number | null
    isPinned: boolean
    isOrphaned?: boolean
    playbookSnapshot?: PlaybookSnapshot | null
    /** 分段/对照布局，受控（父组件持久化） */
    layout: 'stacked' | 'inline-diff'
}>()

const emit = defineEmits<{
    close: []
    prev: []
    next: []
    'toggle-pin': [riskId: string]
    'edit-risk': [risk: Risk]
    'delete-risk': [risk: Risk]
    archive: [riskId: string, status: RiskArchivedStatus | null]
    'add-annotation': [riskId: string, content: string, parentAnnotationId?: number]
    'delete-annotation': [annotationId: number]
    'jump-to-original': [riskId: string]
    'update:layout': [layout: 'stacked' | 'inline-diff']
}>()

const reply = ref('')
const archived = computed(() => !!props.risk.archivedStatus)

function pointByCode(code: string) {
    return props.playbookSnapshot?.points.find(p => p.code === code) ?? null
}
const matchedPoint = computed(() =>
    props.risk.matchedPointCode ? pointByCode(props.risk.matchedPointCode) : null,
)

function handleSendReply() {
    const content = reply.value.trim()
    if (!content) return
    emit('add-annotation', props.risk.id, content)
    reply.value = ''
}
function handleArchive(status: RiskArchivedStatus | null) {
    if (props.readOnly) return
    emit('archive', props.risk.id, status)
}

// Esc 关闭 + ← → 上一条/下一条（输入框内不触发）
function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null
    const inInput = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    if (e.key === 'Escape') { emit('close'); return }
    if (inInput) return
    if (e.key === 'ArrowLeft' && props.index > 0) { e.preventDefault(); emit('prev') }
    else if (e.key === 'ArrowRight' && props.index < props.total - 1) { e.preventDefault(); emit('next') }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
```

- [ ] **Step 3: 写组件 `<template>`**

抽屉根：`absolute inset-0 z-[6] flex flex-col bg-card rounded-lg`，左向投影（`shadow-[-8px_0_24px_-14px_rgba(0,0,0,0.22)]` 或等效 `shadow-lg`）。三段结构：

1. **抽屉头**（`shrink-0`，下边框）：等级徽章（`LEVEL_CLASS[risk.level]`）+ 风险类别（截断）+ `‹` 按钮（`emit('prev')`，`index<=0` 禁用）+ `index+1 / total` + `›` 按钮（`emit('next')`，`index>=total-1` 禁用）+ 竖分隔 + `XIcon` 关闭按钮（`emit('close')`）。
2. **抽屉体**（`flex-1 overflow-y-auto`）：按设计稿行 514-607 与现有 `RiskCard.vue` 行 262-345 迁移——状态徽章行（钉在原文按钮 / 已处置 / AI 已重审 / 客户修订 / 匹配检查项 Tooltip）→ 问题概述 → 分段/对照段控（`emit('update:layout', ...)`，非孤立才显示）→ 条款差异（`RiskClauseDiff`，孤立态改显「原锚点引文」）→ 法律依据 → 条款分析 → 法律风险 → 修改建议 → 批注对话线（`AnnotationBubble` 列表 + 回复 `Textarea`+发送按钮，`⌘/Ctrl+Enter` 发送；`readOnly` 时显示「只读模式，无法添加批注」）。
3. **抽屉底**（`shrink-0`，上边框）：非孤立 → 编辑 / 删除 / 标记已处理 / 标记忽略（已处置时显示「撤销处置」）；孤立 → 「查看原始语境」（`emit('jump-to-original', risk.id)`）。`readOnly` 时编辑/处置禁用。
- 发送按钮、`bg-gradient-brand-button`；配色全部语义类。

- [ ] **Step 4: 写测试 `RiskDetailPanel.test.ts`**

mount 样板参照同目录 `RiskCard.test.ts`。至少覆盖：

```ts
// 用例（断言逻辑，mount/stub 样板照抄 RiskCard.test.ts）：
// 1. 渲染风险字段：传入一条 risk，断言 risk.category、risk.problem、risk.analysis 文本出现。
// 2. 上一条禁用：index=0 时，‹ 按钮 disabled。
// 3. 下一条禁用：index=total-1 时，› 按钮 disabled。
// 4. 关闭：点 X 按钮，断言 emit('close') 触发一次。
// 5. 上下条：index 居中时点 ‹ / › 分别 emit('prev') / emit('next')。
// 6. 只读禁用：readOnly=true 时，编辑/删除/标记按钮 disabled、回复 Textarea disabled。
// 7. 处置：点「标记已处理」断言 emit('archive', risk.id, 'handled')。
// 8. 孤立态：isOrphaned=true 时不显示分段/对照段控，底部显示「查看原始语境」。
```

- [ ] **Step 5: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/RiskDetailPanel.test.ts --reporter=verbose`
Expected: typecheck 通过；测试全绿。

- [ ] **Step 6: 提交**

```bash
git add app/components/assistant/contract/RiskDetailPanel.vue tests/app/components/assistant/contract/RiskDetailPanel.test.ts
git commit -m "feat(ui): 新增风险详情抽屉组件 RiskDetailPanel"
```

---

## Task 9: 风险卡改纯卡片 + 风险清单接入抽屉（`RiskCard.vue` + `RiskListPanel.vue`）

**Files:**
- Modify: `app/components/assistant/contract/RiskCard.vue`
- Modify: `app/components/assistant/contract/RiskListPanel.vue`
- Modify: `tests/app/components/assistant/contract/RiskCard.test.ts`
- Modify: `tests/app/components/assistant/contract/RiskListPanel.test.ts`、`RiskListPanel.badge.test.ts`
- Modify: `tests/e2e/contract-review-risk-card-layout.spec.ts`
- 设计稿：`RiskCard` 行 412-474、`RiskListPanel` 行 895-1047、`MiniBadge` 行 402-410
- 设计文档：区块 4、区块 6、区块 10

**说明：** 这是核心交互改造，`RiskCard` 接口变更与 `RiskListPanel` 重写必须在**同一提交**完成，否则 typecheck 中间态破裂。

**`RiskCard.vue` 重做后接口（锁定）：**

```ts
defineProps<{
    risk: RiskDisplayPhaseB
    isFocused?: boolean
    isPinned?: boolean
    isHovered?: boolean
    isJustAdded?: boolean
    isOrphaned?: boolean
    archivedStatus?: RiskArchivedStatus | null
    notLocated?: boolean
    playbookSnapshot?: PlaybookSnapshot | null
}>()
defineEmits<{
    focus: [riskId: string]
    'toggle-pin': [riskId: string]
}>()
```

去掉的 props：`expanded`、`annotations`、`readOnly`、`isCompleted`、`editable`、`currentUserId`、`layout`。
去掉的 emit：`toggle`、`archive`、`addAnnotation`、`deleteAnnotation`、`jump-to-original`、`editRisk`、`deleteRisk`（均迁至 `RiskDetailPanel`）。

- [ ] **Step 1: 读参考**

读设计稿 `RiskCard`（行 412-474）、`RiskListPanel`（行 895-1047）、现有两个 `.vue` 与三个测试文件、`useContractRiskHighlight.ts`（`focusRisk` 已支持 `null` 入参）。

- [ ] **Step 2: 重写 `RiskCard.vue` 为纯卡片**

- 删除整个 `CardContent`（内联详情）；只保留卡片头。
- 第一行：等级徽章 + 类别（截断）+ 钉按钮（非孤立，`emit('toggle-pin')`）+ 右向箭头 `ChevronRightIcon`（取代原 `ChevronDownIcon`）。
- 第二行：自动换行徽章（已处置 / AI 已重审 / 客户修订 / 匹配检查项 / 未定位），用设计稿 `MiniBadge`（行 402-410）样式。
- 下方：2 行截断问题概述。
- 卡片底色按 `isFocused`/`isPinned`/`isHovered`/`isJustAdded` + 孤立/外部新增变体分态着色（设计稿 `RISK_LV` focus/hover 思路，用语义类）。
- 点击整卡 `emit('focus', risk.id)`（不再 `toggle`）。

- [ ] **Step 3: 重写 `RiskListPanel.vue`**

- 顶部新增 2 段标签 `[风险清单 N] [审查总览]`（本地 `ref` `riskTab`，默认 `'list'`，不持久化）。
- `riskTab==='list'`：风险分速览条（风险分 + 高/中/低三色点计数，数据来自 `useContractOverview`）+ 风险卡滚动区。
- `riskTab==='overview'`：整屏渲染 `OverviewPanel`（从原「常驻顶部」移到此）。
- 外部新增分组改用 `RiskCard`（`is-orphaned=false`，变体样式由 RiskCard 内部按 `risk.source` 判定或新增 `variant` prop——按设计稿 `RiskCard` 行 416-419 的 external 变体），**删除原内联展开模板**（行 414-564）。
- 删除 `expandedId` 本地状态、`toggle` 函数。
- `cardLayout`（`useLocalStorage('contract-review-risk-card-layout')`）保留在本组件，作为 `layout` 透传给抽屉。
- 挂载抽屉：`<AssistantContractRiskDetailPanel v-if="focusedRiskId 对应的 risk 存在" ... />`，外层容器 `relative`，抽屉 `absolute inset-0`。抽屉的 `index`/`total` 由当前展示顺序的风险数组算出；`@close` → `emit('focusRisk', null)`；`@prev`/`@next` → `emit('focusRisk', 相邻 risk.id)`；`@update:layout` → 写 `cardLayout`；详情操作 emit（`edit-risk`/`delete-risk`/`archive`/`add-annotation`/`delete-annotation`/`jump-to-original`/`toggle-pin`）转发到本组件原有上抛逻辑。
- `focusRisk` emit 签名改为 `[riskId: string | null]`。
- 底部操作栏：导出=描边按钮、下载=`bg-gradient-brand-button` + 下拉箭头（shadcn `DropdownMenu` 保留）。
- 顶部原 `cardLayout` 的 `Tabs` 段控**移除**（移进抽屉）。
- 对父组件（`ContractReviewPanel`）的 emit 出口集合保持不变（除 `focusRisk` 放宽为可空），`ContractReviewPanel` 无需改动。

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck`
Expected: 通过。若 `ContractReviewPanel.vue` 因 `focusRisk` 签名报错——确认其 `@focus-risk` 绑定的是 `useContractRiskHighlight` 的 `focusRisk`（已支持 `null`），不应报错。

- [ ] **Step 5: 更新测试**

- `RiskCard.test.ts`：删除内联展开 / `toggle` / 详情 emit（archive/edit/delete/annotation）相关用例；保留并补充——`focus` emit、`toggle-pin` emit、各徽章渲染、分态着色。
- `RiskListPanel.test.ts`（1124 行）：删除"卡片内联展开后操作"相关用例（这些行为已迁至 `RiskDetailPanel`，由 `RiskDetailPanel.test.ts` 覆盖）；保留/新增——分组渲染、隐藏已处置开关、`riskTab` 标签切换、速览条计数、点卡片打开抽屉、抽屉 `close`→`focusRisk(null)`。
- `RiskListPanel.badge.test.ts`：按新卡片结构更新徽章断言。
- `tests/e2e/contract-review-risk-card-layout.spec.ts`：分段/对照切换已移入抽屉——改成「点风险卡打开抽屉 → 在抽屉内切分段/对照」。

Run: `npx vitest run tests/app/components/assistant/contract/RiskCard.test.ts tests/app/components/assistant/contract/RiskListPanel.test.ts tests/app/components/assistant/contract/RiskListPanel.badge.test.ts --reporter=verbose`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add app/components/assistant/contract/RiskCard.vue app/components/assistant/contract/RiskListPanel.vue tests/app/components/assistant/contract/RiskCard.test.ts tests/app/components/assistant/contract/RiskListPanel.test.ts tests/app/components/assistant/contract/RiskListPanel.badge.test.ts tests/e2e/contract-review-risk-card-layout.spec.ts
git commit -m "feat(ui): 风险卡改纯卡片、风险清单接入详情抽屉与总览标签"
```

---

## Task 10: 风险编辑弹窗内容重做（`RiskEditDialog.vue`）

**Files:**
- Modify: `app/components/assistant/contract/RiskEditDialog.vue`
- Test: `tests/app/components/assistant/contract/RiskEditDialog.test.ts`
- 设计稿：`ContractReviewDetailPage.jsx` 行 1087-1158（`RiskEditField` + `RiskEditDialog`）
- 设计文档：区块 8

- [ ] **Step 1: 读参考**

读现有 `RiskEditDialog.vue` 与设计稿行 1087-1158。**外壳保留 shadcn `Dialog`**，只重做内容布局。校验 / 提交 / emit 逻辑不变。

- [ ] **Step 2: 重做内容**

- 表单字段：风险级别单选、原文条款、问题概述、法律依据（可空）、条款分析、修改建议、风险类别、建议改写（高/中风险必填）——按设计稿字段顺序与标签样式。
- 必填星号 `text-destructive`；主按钮「确认」`bg-gradient-brand-button`、取消描边。
- 确认 `DialogContent` 含 `DialogDescription`（可 `sr-only`）。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/RiskEditDialog.test.ts --reporter=verbose`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/RiskEditDialog.vue tests/app/components/assistant/contract/RiskEditDialog.test.ts
git commit -m "refactor(ui): 风险编辑弹窗内容按设计稿重做"
```

---

## Task 11: 导出 PDF + 保存版本弹窗重做（`ExportPdfDialog.vue` + `ContractSaveVersionDialog.vue`）

**Files:**
- Modify: `app/components/assistant/contract/ExportPdfDialog.vue`
- Modify: `app/components/assistant/contract/ContractSaveVersionDialog.vue`
- Test: `tests/app/components/assistant/contract/ContractSaveVersionDialog.test.ts`（`ExportPdfDialog` 无独立测试）
- 设计稿：`ExportPdfDialog` 行 1161-1181、`SaveVersionDialog` 行 1184-1203
- 设计文档：区块 8

- [ ] **Step 1: 读参考**

读两个现有 `.vue` 与设计稿对应段。外壳保留 shadcn `Dialog`，重做内容。

- [ ] **Step 2: 重做内容**

- `ExportPdfDialog`：单选项「仅摘要」/「含风险批注（完整版）」——单选 + 标题 + 副说明，按设计稿行 1163-1178。
- `ContractSaveVersionDialog`：说明文字 + 版本备注 `Textarea` + 字数计数。
- 两者主按钮 `bg-gradient-brand-button`，确认含 `DialogDescription`。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/ContractSaveVersionDialog.test.ts --reporter=verbose`
Expected: 通过；`ExportPdfDialog` 靠 typecheck + 视觉自查。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/ExportPdfDialog.vue app/components/assistant/contract/ContractSaveVersionDialog.vue tests/app/components/assistant/contract/ContractSaveVersionDialog.test.ts
git commit -m "refactor(ui): 导出 PDF 与保存版本弹窗按设计稿重做"
```

---

## Task 12: 上传新版本弹窗重做（`ContractUploadNewVersionDialog.vue`）

**Files:**
- Modify: `app/components/assistant/contract/ContractUploadNewVersionDialog.vue`
- Test: `tests/app/components/assistant/contract/ContractUploadNewVersionDialog.test.ts`
- 设计稿：`ContractReviewDetailPage.jsx` 行 1206-1289（`UploadNewVersionDialog` + `UPLOAD_STEPS`）
- 设计文档：区块 8

**当前结构：** 340 行，含拖拽上传 + 分步进度。逻辑不变。

- [ ] **Step 1: 读参考**

读现有 `ContractUploadNewVersionDialog.vue` 与设计稿行 1206-1289。外壳保留 shadcn `Dialog`，重做内容。

- [ ] **Step 2: 重做内容**

- 拖拽区：虚线描边、品牌微光底纹（复用 `tailwind.css` 的 `dropzone-wash` 工具类）、拖入高亮品牌色描边、已选文件态（文件卡）。
- 分步进度：备份 / 解析 / 比对 / AI 重审 / 合并五步——完成 `CheckCircle2` 绿、进行中 `Loader2` 旋转品牌色、待办灰点。
- 完成态结果提示框 `bg-primary/8`。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/ContractUploadNewVersionDialog.test.ts --reporter=verbose`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/ContractUploadNewVersionDialog.vue tests/app/components/assistant/contract/ContractUploadNewVersionDialog.test.ts
git commit -m "refactor(ui): 上传新版本弹窗按设计稿重做"
```

---

## Task 13: 立场选择弹窗视觉对齐（`StanceSelectionDialog.vue`）

**Files:**
- Modify: `app/components/assistant/contract/StanceSelectionDialog.vue`
- Test: `tests/app/components/assistant/contract/StanceSelectionDialog.test.ts`
- 设计文档：区块 9（无设计稿，按新视觉风格调一致）

- [ ] **Step 1: 读参考**

读现有 `StanceSelectionDialog.vue`。设计稿未画——按新视觉语言（品牌色、圆角、间距、主按钮渐变）调一致。逻辑不动。

- [ ] **Step 2: 重做样式**

内容配色、单选项、主按钮 `bg-gradient-brand-button`；确认含 `DialogDescription`。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/StanceSelectionDialog.test.ts --reporter=verbose`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/StanceSelectionDialog.vue tests/app/components/assistant/contract/StanceSelectionDialog.test.ts
git commit -m "refactor(ui): 立场选择弹窗视觉对齐新设计"
```

---

## Task 14: 主容器头部与横幅重做（`ContractReviewPanel.vue`）

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`
- Test: `tests/app/components/assistant/contract/ContractReviewPanel.test.ts`、`ContractReviewPanel.phaseB.test.ts`
- 设计稿：`CrdHeader` 行 1292-1338、`ChangeBanner` 行 1339-1354、三栏主体 行 1505-1553
- 设计文档：区块 1、区块 9

**当前结构：** 903 行。所有 composable 编排、SSE、版本管理、立场流程逻辑**不动**——只改 template 里头部 / 横幅 / 三栏容器的样式。

- [ ] **Step 1: 读参考**

读现有 `ContractReviewPanel.vue` template（行 615-903）与设计稿 `CrdHeader`/`ChangeBanner`。**不实现设计稿的「返回」箭头**（区块 1 已确认）。

- [ ] **Step 2: 重做头部与横幅**

- 工作区操作栏（现行 676-710）：重做成约 36px 紧凑栏，`bg-card` + 下边框；左侧「未保存」胶囊 `bg-primary/10 text-primary` + 小圆点；右侧「上传新版本」「保存新版本」描边小按钮（`h-7 text-xs`）。
- 本轮变化横幅（现行 712-728）：`bg-primary/5` + `border-primary/20`、`TrendingUp` 图标、加粗标题 + 摘要截断 + 关闭按钮。
- 只读横幅（现行 661-674）：`History` 图标 + 「查看历史版本」、返回工作区链接。
- 进行中状态横幅（现行 779-785 / 842-848）：`bg-primary/10` + `Loader2` 旋转，对齐横幅风格。
- 三栏容器圆角 / 边框 / 留白对齐设计稿（区块 1）。
- `<Loader2Icon>` 等图标、`v-if` 条件、子组件 props/emit 绑定**全部不动**。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npx nuxi typecheck && npx vitest run tests/app/components/assistant/contract/ContractReviewPanel.test.ts tests/app/components/assistant/contract/ContractReviewPanel.phaseB.test.ts --reporter=verbose`
Expected: 通过；断言写死被改 class / 文案的按新值更新。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue tests/app/components/assistant/contract/ContractReviewPanel.test.ts tests/app/components/assistant/contract/ContractReviewPanel.phaseB.test.ts
git commit -m "refactor(ui): 合同审查主容器头部与横幅按设计稿重做"
```

---

## Task 15: 收尾——全量验证 + 简化优化

**Files:**
- 视情况修正前序遗留问题

- [ ] **Step 1: 全量类型检查**

Run: `npx nuxi typecheck`
Expected: 0 报错。有报错则定位修复。

- [ ] **Step 2: 全量测试**

Run: `bun run test`
Expected: 全绿（除 `tests/KNOWN_FAILS.md` 已登记的既有失败）。新失败必须修复。

- [ ] **Step 3: E2E 验证（chrome-devtools）**

`bun dev` 启动，用 chrome-devtools 在已完成审查的合同详情页验证：
- 三栏布局（时间线 / 预览 / 风险清单）渲染正常。
- 点风险卡 → 抽屉覆盖风险栏；抽屉上一条 / 下一条按钮 + ← → 方向键 + Esc 关闭。
- 「风险清单 ↔ 审查总览」标签切换；速览条计数正确。
- 4 个弹窗（风险编辑 / 导出 PDF / 保存版本 / 上传新版本）打开正常。
- 深色模式切换无糊；按 `ui_kits/DESIGN-MANIFEST.json` 视口（360/390/430/820/1024/1366/1440/1920）抽查无横向滚动。

- [ ] **Step 4: 简化优化**

对本次新增 / 改动的组件调用 `simplify` 技能优化代码。

- [ ] **Step 5: 提交（如有修正）**

```bash
git add <修正涉及的文件>
git commit -m "refactor(contract): 合同审查详情页重做收尾修正与简化"
```

---

## 自检记录（写计划时已核对）

- **Spec 覆盖**：设计文档 16 个改动文件 → Task 1（配色工具）、Task 2-7 + 10-14（13 个组件）、Task 8（新建抽屉）、Task 9（RiskCard + RiskListPanel）。区块 1-11 均有对应任务。
- **接口一致性**：`RiskCard` 重做后接口（Task 9 Step 2）与 `RiskDetailPanel` 接口（Task 8 Step 2）已锁定；`RiskListPanel` 的 `focusRisk` emit 放宽为 `string | null`，`useContractRiskHighlight.focusRisk` 原生支持 `null`，`ContractReviewPanel` 无需改动。
- **无占位符**：新组件 `<script setup>` 给出完整代码；移植类改动给出设计稿行号 + 现有文件行号 + 具体改动清单。
