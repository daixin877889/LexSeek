# 合同审查 · PR 5 · DocxPreview 字符级高亮（CSS Custom Highlight API）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ContractDocxPreview.vue` 升级为「段落级 + 字符级」双层高亮：保留现有的段落底色（按风险级别 high/medium/low 配色），新增风险卡里 `problematicQuote` 字符段的统一深黄高亮（focus / pin / default 三态深浅变体，含 focused 1 秒衰减）；用 CSS Custom Highlight API（baseline 2025/06）做主路径——不修改 docx-preview 渲染产物的 DOM，跨 `<p>` / `<span>` / text node 任意区间通过 `Range` 表达，浏览器内核渲染高亮；浏览器不支持时直接降级到只有段落级高亮（与现状视觉一致），不写 DOM-mutate fallback；支持 docx-preview 重渲染（`target.innerHTML = ''`）后 stale Range 失效的清理生命周期；对接 PR 4 已合后的 `RiskDisplayPhaseB.problematicQuote` / `quoteCharStart` / `quoteCharEnd` 字段，spec § 6.4 quote=null 降级路径自动生效；同时支持深色模式（与 `RISK_LEVEL_DOCX_BG_CLASS` 已有 dark 变体对齐）。

**Architecture:** 算法层新建 `app/utils/quoteHighlight.ts`（独立工具文件，便于单测覆盖）：① `computeQuoteRange(risk, container)` —— 把 risk.clauseText 按 `\r?\n` 拆行、复用 `clauseLocator.findByParagraphIndex` 找起始非空 `<p>` 段落（共享口径，无重复），在起止段落内用 `TreeWalker` 走 text node 累加字符 offset 找到对应节点 + innerOffset，构建跨节点 `Range`；② `decorateQuoteRanges(risks, container, state)` 遍历 risks 调 computeQuoteRange + 按视觉态分流到三个命名 Highlight；③ `clearAllQuoteHighlights()` 在每次重渲染前用 `CSS.highlights.clear()` 清空；④ `pickHighlightState(riskId, focused, pinned, flashWindowActive)` 派生视觉态（与 spec § 7.6 矩阵一致，`flashWindowActive=false` 时 focused 退回 default 实现 1 秒衰减）。CSS 层在 `app/assets/css/tailwind.css` 末尾追加 `::highlight(quote-default)` / `::highlight(quote-focused)` / `::highlight(quote-pinned)` 三条全局规则 + 三条对应的 `prefers-color-scheme: dark` 暗色变体（**不放 scoped style**——Vue scoped 的 `data-v-xxx` 属性会让 `::highlight()` 命中失效）。组件层 `ContractDocxPreview.vue`：把 `props.risks` 类型从 `Risk[]` 升到 `RiskDisplayPhaseB[]`（PR 4 已扩出 quote 字段）；新增 `pinnedRiskIds?: Set<string>` prop（替代原 `highlightedRiskIds` 的"内部减 focused 反推 pinned"逻辑）；在 `loadDocx` 内 `target.innerHTML = ''` **之前**先调 `clearAllQuoteHighlights()`；`decorateRisks()` 完成后追加调 `decorateQuoteRanges`；现有视觉态切换 `watch([focusedRiskId, pinnedRiskIds, hoveredRiskId, risks])` 内部段落级 forEach 之后追加 quote 高亮三态切换调用，并对 `focusedRiskId` 变化启动 1 秒 `setTimeout` 关闭 `flashWindowActive` ref 触发重画衰减。

**Tech Stack:** Vue 3 + TypeScript + Tailwind v4（全局 CSS）+ docx-preview（不动）+ CSS Custom Highlight API（`CSS.highlights.clear()` / `new Highlight()` / `::highlight()`）+ DOM Range / TreeWalker + Vitest + happy-dom 20（CSS.highlights API 需 mock，vi.mock 工厂用 `vi.hoisted()`）+ chrome-devtools MCP（视觉抽样）

**Spec 参考：** `docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md` § 7（7.1 ~ 7.6）+ § 6.4（quote=null 降级）+ § 10.1（`docxPreview.highlight.test.ts` 覆盖矩阵）+ § 11（PR 5 范围）

**前置条件：**
- PR 1（partyDetector 短路修复）已合并
- PR 2（数据模型重构 · 双锚点）已合并 —— 提供 `contract_risks.problematic_quote` / `quote_char_start` / `quote_char_end` / `quote_match_source` 列与对应 Prisma model
- **PR 3（路线 2 锚点解析）强烈建议先行**——若 PR 3 未合，`problematicQuote` 等字段在 DB 里全是 null，§ 6.4 降级路径自动生效（CSS.highlights 不创建 Range，仅段落级配色），技术上**不阻塞 PR 5 上线**但用户感知不到字符级高亮升级（视觉=现状）；与 spec § 11.1 字面"PR 3 必须先于 PR 4-6"对齐，仅作容错说明
- PR 4（风险卡 Layout A/C）已合并 —— `RiskDisplayPhaseB` 已含 `problematicQuote` / `quoteCharStart` / `quoteCharEnd` 三字段；`ContractReviewPanel.mapEntityToDisplay` 已透传；`effectiveRisks: RiskDisplayPhaseB[]` 类型已对齐
- 工作区基于 `dev`（PR 4 已合）起独立 worktree（superpowers:using-git-worktrees）

**PR 4 真实落地状态（PR 5 plan 已对齐）**：
- `shared/types/contract.ts:178-194` 的 `RiskDisplayPhaseB` 已含三个 quote 字段（**只读不写**——PATCH risks 接口拒绝 quote 字段）
- `app/components/assistant/contract/ContractDocxPreview.vue:20-33` 当前 `props.risks: Risk[]`，**未升级**到 `RiskDisplayPhaseB[]` —— 本 PR 升级
- `ContractReviewPanel.vue` 第 679 / 744 两处给 DocxPreview 传的就是 `effectiveRisks: RiskDisplayPhaseB[]`，TypeScript 结构子类型让现状没报错（PR 5 升级类型后调用方零改动）
- `useContractRiskHighlight` 已直接 export `pinnedRiskIds: Ref<Set<string>>`（无需通过 highlightedRiskIds 间接派生）

---

## 改动文件总图

### 算法新建
- 创建：`app/utils/quoteHighlight.ts`（`computeQuoteRange` / `decorateQuoteRanges` / `clearAllQuoteHighlights` / `pickHighlightState` 四个 export，~150 行）

### 基建 export 收口（复用现有算法）
- 修改：`shared/utils/clauseLocator.ts` —— 把 `PARA_BLOCK_SELECTOR` 与 `findByParagraphIndex` 从 module-private 改为 export（**仅加 export 关键字、不动行为**）

### 全局 CSS 扩展
- 修改：`app/assets/css/tailwind.css`（末尾追加六条 `::highlight()` 规则：三态浅色 + 三态深色 prefers-color-scheme，~22 行）

### 组件升级
- 修改：`app/components/assistant/contract/ContractDocxPreview.vue`
  - props 类型：`Risk[]` → `RiskDisplayPhaseB[]`
  - props 接口：删 `highlightedRiskIds?: Set<string>`，加 `pinnedRiskIds?: Set<string>`
  - 新增 import：`decorateQuoteRanges` / `clearAllQuoteHighlights` from `~/utils/quoteHighlight`
  - `loadDocx`：`target.innerHTML = ''` **之前**调 `clearAllQuoteHighlights()`
  - `decorateRisks` 末尾追加 `paintQuoteHighlights()` 调用（首屏渲染）
  - 现有 `watch(...)` 入参从 `[focusedRiskId, highlightedRiskIds, ...]` 改为 `[focusedRiskId, pinnedRiskIds, ...]`，段落级 isPinned 直接用 `props.pinnedRiskIds.has(id) && !isActive`；末尾追加 `paintQuoteHighlights()` + focused 变化启动 1 秒 setTimeout 关闭 `flashWindowActive` ref 触发重画衰减

### 调用方同步
- 修改：`app/components/assistant/contract/ContractReviewPanel.vue` —— 第 682 行 / 第 747 行两处给 DocxPreview 传 `:highlighted-risk-ids="highlightedRiskIds"` 改为 `:pinned-risk-ids="pinnedRiskIds"`（DocxPreview 不再接受 highlightedRiskIds prop）

### 测试新建
- 创建：`tests/app/utils/quoteHighlight.test.ts`（算法纯单测 6 个场景：单段命中 / 跨多 `<p>` / 跨多 `<span>` / quote=null 降级 / clearAllQuoteHighlights / 不可用早出 + pickHighlightState 矩阵）
- 创建：`tests/app/components/assistant/contract/ContractDocxPreview.highlight.test.ts`（组件集成 4 场景，vi.mock 用 `vi.hoisted()`）

### 不动文件
- `server/**`（PR 5 完全不改服务端）
- `prisma/**`（PR 5 完全不改 schema）
- `shared/types/contract.ts`（PR 4 已扩 quote 字段，PR 5 不动）
- `app/components/assistant/contract/RiskCard.vue` / `RiskListPanel.vue` / `RiskClauseDiff.vue`（PR 5 不动）
- `app/utils/contractRiskLevelStyle.ts`（PR 5 不动 —— 段落级配色保留现状）
- `app/composables/useContractRiskHighlight.ts`（PR 5 不动 —— 三态状态机保留，pinnedRiskIds 直接 export 已可用）

---

## 关键决策速查

| 维度 | 决策 |
|---|---|
| 高亮 API | CSS Custom Highlight API（baseline 2025/06，Chrome 105+ / Safari 17.2+ / Firefox 140） |
| 不支持 fallback | 直接 `return` 不渲染字符级 —— 不写 DOM-mutate fallback（spec § 7.3.3） |
| CSS 放置 | 全局 `tailwind.css` 末尾 —— Vue scoped `data-v-xxx` 让 `::highlight()` 命中失效 |
| 深色模式 | 三态各加 `@media (prefers-color-scheme: dark)` 变体 —— 与 `RISK_LEVEL_DOCX_BG_CLASS` dark 变体一致 |
| 工具文件 | `app/utils/quoteHighlight.ts` 独立文件 —— 算法纯函数单测覆盖 |
| 段落定位 | 复用 `clauseLocator.findByParagraphIndex`（改 export，不重复实现） |
| 拆行 | `clauseText.split(/\r?\n/)` —— Windows-export docx CRLF 安全 |
| 字符等价性 | `walkToTextNode` 直接累加 `node.data.length`，不做 tab/br 映射（spec § 7.3.2） |
| 防御兜底 | `walkToTextNode` 内缓存 `lastTextNode`，不依赖 walker.previousNode 实现细节 |
| 三态视觉 | quote-default / quote-focused / quote-pinned 三个命名 Highlight |
| 焦点 1 秒衰减 | `flashWindowActive` ref + pickHighlightState 接受该 flag + setTimeout 1 秒后置 false 重画 |
| Pinned 来源 | DocxPreview 直接接受 `pinnedRiskIds` prop（不再从 highlightedRiskIds 反推） |
| 重渲染保护 | `target.innerHTML = ''` **之前**调 `CSS.highlights.clear()` |
| 测试 mock | vi.mock 工厂用 `vi.hoisted()` 包裹 mock fn，避免 ReferenceError |

---

## Task 0：worktree 准备 + 基线校验

**Files:**
- 不修改文件，仅做环境准备

- [ ] **Step 0.1：创建 worktree（superpowers:using-git-worktrees）**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
git fetch origin
git checkout dev && git pull --ff-only origin dev
git worktree add ../LexSeek-pr5-docx-preview-highlight -b pr5-docx-preview-highlight dev
cd ../LexSeek-pr5-docx-preview-highlight
bun install
bun run prisma:generate
```

Expected: worktree 创建成功；`bun install` 完成；Prisma client 生成。

- [ ] **Step 0.2：验证 typecheck 基线干净**

```bash
bun run typecheck 2>&1 | tee /tmp/pr5-typecheck-baseline.log | tail -10
```

Expected: 0 错误。

- [ ] **Step 0.3：验证前端合同测试基线 PASS**

```bash
npx vitest run tests/app/components/assistant/contract/ tests/app/composables/useContractRiskHighlight.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 所有测试 PASS。

- [ ] **Step 0.4：确认 PR 4 已落 RiskDisplayPhaseB quote 字段**

```bash
grep -n "problematicQuote\|quoteCharStart\|quoteCharEnd" /Users/daixin/work/dev/LexSeek/LexSeek/shared/types/contract.ts | head
grep -n "problematicQuote\|quoteCharStart\|quoteCharEnd" /Users/daixin/work/dev/LexSeek/LexSeek/app/components/assistant/contract/ContractReviewPanel.vue | head
```

Expected：第一条命令至少看到 3 行字段在 `RiskDisplayPhaseB` 类型块；第二条命令至少看到 mapEntityToDisplay 内三行透传。如果 grep 不到，停下来检查 worktree base。

- [ ] **Step 0.5：confirm 不要 commit 0 步**

Step 0.x 不创建任何 commit，纯环境准备。

---

## Task 1：clauseLocator export 收口（复用基础）

**Files:**
- Modify: `shared/utils/clauseLocator.ts`

把 `PARA_BLOCK_SELECTOR` 常量与 `findByParagraphIndex` 函数从 module-private 改为 export，让 PR 5 新建的 `app/utils/quoteHighlight.ts` 复用同一段算法（同口径"非空段落序号"，与后端 `clauseToParagraph.ts` 一致），**不重复造轮子**。

- [ ] **Step 1.1：编辑 clauseLocator.ts 加 export 关键字**

打开 `shared/utils/clauseLocator.ts`，定位第 62-63 行：

```typescript
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td'
const PARA_BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6'
```

改为（仅给 `PARA_BLOCK_SELECTOR` 加 `export`；`BLOCK_SELECTOR` 保持私有，因为只有 locator 内部 fuzzy / text 匹配用）：

```typescript
const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, td'
/** 与后端 `clauseToParagraph.ts` 同口径的"非空段落"块级元素选择器（PR 5 复用） */
export const PARA_BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6'
```

接着定位第 70-80 行 `findByParagraphIndex` 函数：

```typescript
function findByParagraphIndex(container: Element, paragraphIndex: number): Element | null {
```

改为：

```typescript
/**
 * 取容器内第 N 个非空块级元素（PARA_BLOCK_SELECTOR 范围）。
 * 与后端 `server/agents/contract/utils/clauseToParagraph.ts` 的"非空段落序号"同算法。
 *
 * PR 5 `app/utils/quoteHighlight.ts` 复用本函数。
 */
export function findByParagraphIndex(container: Element, paragraphIndex: number): Element | null {
```

- [ ] **Step 1.2：跑 typecheck + clauseLocator 既有测试**

```bash
bun run typecheck 2>&1 | tail -10
npx vitest run tests/shared/utils/clauseLocator --reporter=verbose 2>&1 | tail -20
```

Expected: 0 错误；所有 clauseLocator 既有测试 PASS（仅加 export 不改行为）。

- [ ] **Step 1.3：commit**

```bash
git add shared/utils/clauseLocator.ts
git commit -m "refactor(contract): clauseLocator 暴露 findByParagraphIndex 供前端复用"
```

---

## Task 2：新建 `app/utils/quoteHighlight.ts` + TDD 单测

**Files:**
- Create: `app/utils/quoteHighlight.ts`
- Create: `tests/app/utils/quoteHighlight.test.ts`

把字符级高亮的所有算法收口到独立文件。所有 export 都是 deterministic 函数。

> **happy-dom 不实现 `CSS.highlights` API + `Highlight` 类**（核对 happy-dom 20 源码无 Highlight）—— 测试里必须用 `vi.stubGlobal` 注入 polyfill。

### 2.1 写测试（RED 阶段）

- [ ] **Step 2.1.1：创建测试文件**

新建 `tests/app/utils/quoteHighlight.test.ts`：

```typescript
/**
 * quoteHighlight 工具函数单测
 *
 * **Feature: contract-review-precise-anchoring (PR 5)**
 * **Validates: spec § 7.3.1 / 7.3.3 / 7.6 / 6.4 + § 10.1 测试矩阵 ① ② ③ ④ ⑤**
 *
 * 6 个核心场景 + pickHighlightState 矩阵：
 *  1. computeQuoteRange · 单段 quote 命中（spec § 10.1 ②基础态）
 *  2. computeQuoteRange · 跨多 <p> 的 quote（含 \n 多行 clauseText，spec § 10.1 ①）
 *  3. computeQuoteRange · 跨多 <span> 的 quote（quote 起止落在 run 内部，spec § 10.1 ②跨 run）
 *  4. computeQuoteRange · quoteCharStart=null 降级返回 null（spec § 6.4 / § 10.1 ③）
 *  5. clearAllQuoteHighlights · 清空全部 3 个命名 Highlight（spec § 10.1 ④）
 *  6. decorateQuoteRanges · CSS.highlights 不可用时早出（spec § 10.1 ⑤）
 *  + pickHighlightState · 三态优先级 + flashWindowActive 衰减
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    computeQuoteRange,
    decorateQuoteRanges,
    clearAllQuoteHighlights,
    pickHighlightState,
} from '~/utils/quoteHighlight'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

function makeRisk(over: Partial<RiskDisplayPhaseB> = {}): RiskDisplayPhaseB {
    return {
        id: 'risk-1',
        clauseIndex: 0,
        clauseText: '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。',
        clauseParagraphIndex: 0,
        level: 'medium',
        category: '违约金',
        problem: '违约金过低',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
        problematicQuote: '每日按 0.05% 加收滞纳金',
        quoteCharStart: 13,
        quoteCharEnd: 26,
        ...over,
    } as RiskDisplayPhaseB
}

function buildContainer(html: string): HTMLElement {
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    return container
}

class MockHighlight {
    private ranges: Range[] = []
    add(r: Range) { this.ranges.push(r) }
    clear() { this.ranges = [] }
    get size() { return this.ranges.length }
    values(): IterableIterator<Range> { return this.ranges[Symbol.iterator]() }
}

const mockHighlightRegistry = new Map<string, MockHighlight>()

function installCssHighlightMock() {
    mockHighlightRegistry.clear()
    vi.stubGlobal('CSS', {
        highlights: {
            set(name: string, h: MockHighlight) { mockHighlightRegistry.set(name, h) },
            get(name: string) { return mockHighlightRegistry.get(name) ?? null },
            delete(name: string) { return mockHighlightRegistry.delete(name) },
            has(name: string) { return mockHighlightRegistry.has(name) },
            clear() { mockHighlightRegistry.clear() },
        },
    })
    // @ts-expect-error 全局 Highlight 在 happy-dom 不存在；测试注入
    globalThis.Highlight = MockHighlight
}

function uninstallCssHighlightMock() {
    vi.unstubAllGlobals()
    // @ts-expect-error 清理
    delete globalThis.Highlight
    mockHighlightRegistry.clear()
}

describe('quoteHighlight 工具函数', () => {
    afterEach(() => {
        document.body.innerHTML = ''
        uninstallCssHighlightMock()
    })

    it('computeQuoteRange · 单段 quote 命中（最常见路径）', () => {
        const container = buildContainer(
            '<p>工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。</p>',
        )
        const range = computeQuoteRange(makeRisk(), container)
        expect(range).not.toBeNull()
        expect(range!.toString()).toBe('每日按 0.05% 加收滞纳金')
    })

    it('computeQuoteRange · 跨多 <p> 的 quote（spec § 10.1 ①）', () => {
        // clauseText 含 \n 拆 2 行 → 对应 docx 渲染 2 个 <p>
        // 行 1 "工资按月支付。" 长度 7；加 \n = 8。行 2 起点 = 8
        const container = buildContainer(
            '<p>工资按月支付。</p><p>逾期支付的，每日按 0.05% 加收滞纳金。</p>',
        )
        const risk = makeRisk({
            clauseText: '工资按月支付。\n逾期支付的，每日按 0.05% 加收滞纳金。',
            problematicQuote: '工资按月支付。\n逾期支付的',
            quoteCharStart: 0,
            quoteCharEnd: 8 + 5, // 行 1 全部 + \n + 行 2 前 5 字"逾期支付的"
        })
        const range = computeQuoteRange(risk, container)
        expect(range).not.toBeNull()
        expect(range!.startContainer).not.toBe(range!.endContainer)
        const text = range!.toString()
        expect(text.includes('工资按月支付')).toBe(true)
        expect(text.includes('逾期支付的')).toBe(true)
    })

    it('computeQuoteRange · 跨多 <span> 的 quote（spec § 10.1 ②跨 run）', () => {
        // 同一 <p> 内 4 个 <span>，quote 跨 span 2-3
        const container = buildContainer(
            '<p>'
            + '<span>工资按月支付。</span>'
            + '<span>逾期支付的，</span>'
            + '<span>每日按 0.05% 加收滞纳金</span>'
            + '<span>。</span>'
            + '</p>',
        )
        const range = computeQuoteRange(makeRisk(), container)
        expect(range).not.toBeNull()
        // 起止应落在不同 text node（跨 span）
        expect(range!.startContainer).not.toBe(range!.endContainer)
        expect(range!.toString()).toBe('每日按 0.05% 加收滞纳金')
    })

    it('computeQuoteRange · quoteCharStart=null 降级返回 null（spec § 6.4）', () => {
        const container = buildContainer('<p>任意段落文本</p>')
        const range = computeQuoteRange(
            makeRisk({ quoteCharStart: null, quoteCharEnd: null, problematicQuote: null }),
            container,
        )
        expect(range).toBeNull()
    })

    it('clearAllQuoteHighlights · 清空全部 3 个命名 Highlight', () => {
        installCssHighlightMock()
        const cssAny = (globalThis.CSS as any)
        cssAny.highlights.set('quote-default', new MockHighlight())
        cssAny.highlights.set('quote-focused', new MockHighlight())
        cssAny.highlights.set('quote-pinned', new MockHighlight())
        expect(cssAny.highlights.has('quote-default')).toBe(true)

        clearAllQuoteHighlights()

        expect(cssAny.highlights.has('quote-default')).toBe(false)
        expect(cssAny.highlights.has('quote-focused')).toBe(false)
        expect(cssAny.highlights.has('quote-pinned')).toBe(false)
    })

    it('decorateQuoteRanges · CSS.highlights 不可用时早出（spec § 7.3.3）', () => {
        // 不安装 mock；CSS.highlights / Highlight 全局不存在 → 不应抛错
        const container = buildContainer(
            '<p>工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。</p>',
        )
        expect(() => decorateQuoteRanges([makeRisk()], container, {
            focusedRiskId: null,
            pinnedRiskIds: new Set(),
            flashWindowActive: false,
        })).not.toThrow()
    })

    it('pickHighlightState · 三态优先级 + flashWindowActive 衰减（§ 7.5 / § 7.6）', () => {
        const id = 'r1'
        // focused + flash 窗口活跃 → quote-focused
        expect(pickHighlightState(id, id, new Set(), true)).toBe('quote-focused')
        // focused + flash 窗口已关闭 → 衰减为 quote-default（spec § 7.5 1 秒后切回）
        expect(pickHighlightState(id, id, new Set(), false)).toBe('quote-default')
        // 非 focused 但 pinned → quote-pinned
        expect(pickHighlightState(id, 'other', new Set([id]), true)).toBe('quote-pinned')
        // 非 focused 非 pinned → quote-default
        expect(pickHighlightState(id, null, new Set(), true)).toBe('quote-default')
        // focused 优先于 pinned（同时为 focused 且 pinned，flash 活跃 → focused）
        expect(pickHighlightState(id, id, new Set([id]), true)).toBe('quote-focused')
        // focused 优先于 pinned，但 flash 已衰减 → pinned 接管
        expect(pickHighlightState(id, id, new Set([id]), false)).toBe('quote-pinned')
    })
})
```

- [ ] **Step 2.1.2：跑测试，确认 RED**

```bash
npx vitest run tests/app/utils/quoteHighlight.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: 全部 fail，错误是 `Cannot find module '~/utils/quoteHighlight'`。

### 2.2 写实现（GREEN 阶段）

- [ ] **Step 2.2.1：创建 `app/utils/quoteHighlight.ts`**

```typescript
/**
 * 风险卡 problematicQuote 字符级高亮工具（PR 5 / spec § 7）
 *
 * 主路径：CSS Custom Highlight API（baseline 2025/06，Chrome 105+ / Safari 17.2+ / Firefox 140）
 * 降级：浏览器不支持 CSS.highlights → 直接 return，不渲染字符级高亮
 *      （段落级浅色底由 ContractDocxPreview 段落级流程负责，仍生效）
 *
 * 三态命名 Highlight（spec § 7.6 矩阵）：
 *  - quote-default：idle / hovered / focused 衰减后（默认深黄 60%）
 *  - quote-focused：focusedRiskId 且 flash 窗口活跃（深橙 85%，1 秒后由调用方关闭 flashWindowActive 触发衰减）
 *  - quote-pinned：在 pinnedRiskIds 集合（棕黄 70%）
 */

import { findByParagraphIndex } from '#shared/utils/clauseLocator'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

const HIGHLIGHT_NAMES = ['quote-default', 'quote-focused', 'quote-pinned'] as const
export type QuoteHighlightState = typeof HIGHLIGHT_NAMES[number]

function supportsCssHighlight(): boolean {
    return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof globalThis.Highlight === 'function'
}

/**
 * 在 paragraph 元素内 walk text node，按字符 offset 找到对应 (textNode, innerOffset)。
 *
 * 字符等价性：直接累加 `node.data.length`，不做 tab/<br> 映射；spec § 7.3.2 简化策略。
 * 防御兜底：缓存 lastTextNode，避免依赖 walker.previousNode 在 happy-dom 实现细节。
 */
function walkToTextNode(p: HTMLElement, charOffset: number): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
    let consumed = 0
    let lastTextNode: Text | null = null
    let node = walker.nextNode() as Text | null
    while (node) {
        const len = node.data.length
        if (consumed + len >= charOffset) {
            return { node, offset: charOffset - consumed }
        }
        consumed += len
        lastTextNode = node
        node = walker.nextNode() as Text | null
    }
    // charOffset 大于段落总字符数：返回最后一个 text node 的末尾（边角防御）
    if (lastTextNode) return { node: lastTextNode, offset: lastTextNode.data.length }
    return null
}

/**
 * 从 risk 的双锚点字段构建一个跨 <p> / 跨 text node 的 DOM Range。
 *
 * 算法：
 *  1. 缺 quoteCharStart/End → null（§ 6.4 quote=null 降级路径）
 *  2. risk.clauseText 按 `\r?\n` 拆行（CRLF 安全），过滤空行得 `nonEmptyLines`
 *  3. 累加每行长度（含换行 1 字符）得 line 在 clauseText 内的 [start, end)
 *  4. quoteCharStart / End 落在哪个非空 line → startLineIdx + lineOffset
 *  5. 用 clauseLocator.findByParagraphIndex 找连续 N 个非空 <p>
 *  6. startLine 段落内 walkToTextNode → startAnchor；endLine 同理 → endAnchor
 *  7. document.createRange + setStart/setEnd 构建跨节点 Range
 *
 * 任一步 null/越界 → 返回 null（调用方跳过该 risk 的字符级渲染）
 */
export function computeQuoteRange(risk: RiskDisplayPhaseB, container: HTMLElement): Range | null {
    if (risk.quoteCharStart == null || risk.quoteCharEnd == null) return null
    if (risk.quoteCharStart >= risk.quoteCharEnd) return null
    if (risk.clauseParagraphIndex == null || risk.clauseParagraphIndex < 0) return null

    const allLines = risk.clauseText.split(/\r?\n/)
    type LinePos = { idx: number; start: number; end: number; text: string }
    const linePositions: LinePos[] = []
    let cursor = 0
    for (let i = 0; i < allLines.length; i++) {
        const text = allLines[i] ?? ''
        const start = cursor
        const end = cursor + text.length
        linePositions.push({ idx: i, start, end, text })
        cursor = end + 1
    }
    const nonEmptyLines = linePositions.filter(l => l.text.trim().length > 0)
    if (nonEmptyLines.length === 0) return null

    function locate(offset: number): { lineNo: number; lineOffset: number } | null {
        for (let i = 0; i < nonEmptyLines.length; i++) {
            const l = nonEmptyLines[i]!
            if (offset >= l.start && offset <= l.end) {
                return { lineNo: i, lineOffset: offset - l.start }
            }
        }
        return null
    }
    const startHit = locate(risk.quoteCharStart)
    const endHit = locate(risk.quoteCharEnd)
    if (!startHit || !endHit) return null

    const paragraphs: HTMLElement[] = []
    for (let i = 0; i < nonEmptyLines.length; i++) {
        const p = findByParagraphIndex(container, risk.clauseParagraphIndex + i)
        if (!p || !(p instanceof HTMLElement)) return null
        paragraphs.push(p)
    }

    const startAnchor = walkToTextNode(paragraphs[startHit.lineNo]!, startHit.lineOffset)
    const endAnchor = walkToTextNode(paragraphs[endHit.lineNo]!, endHit.lineOffset)
    if (!startAnchor || !endAnchor) return null

    try {
        const range = document.createRange()
        range.setStart(startAnchor.node, startAnchor.offset)
        range.setEnd(endAnchor.node, endAnchor.offset)
        return range
    } catch {
        return null
    }
}

/**
 * 派生一条 risk 当前应该归到哪个命名 Highlight。
 *
 * 优先级（spec § 7.6 矩阵 + § 7.5 1 秒衰减）：
 *   focused + flashWindowActive → quote-focused（"闪一下"窗口内深橙 85%）
 *   focused + flash 已关闭 → quote-default（衰减为深黄 60%；段落级红边框继续亮维持焦点锚）
 *   pinned → quote-pinned（棕黄 70%）
 *   其他 → quote-default
 *
 * @internal 主要供组件 watcher 派系调用；export 是为了独立测试三态矩阵。
 */
export function pickHighlightState(
    riskId: string,
    focusedRiskId: string | null,
    pinnedRiskIds: Set<string>,
    flashWindowActive: boolean,
): QuoteHighlightState {
    if (focusedRiskId === riskId) {
        return flashWindowActive ? 'quote-focused' : (pinnedRiskIds.has(riskId) ? 'quote-pinned' : 'quote-default')
    }
    if (pinnedRiskIds.has(riskId)) return 'quote-pinned'
    return 'quote-default'
}

/**
 * 把所有 risks 的 quote Range 注册到三个命名 Highlight。
 *
 * 调用时机：renderAsync 完成 + 段落级 decorateRisks 完成之后；
 * 以及 focusedRiskId / pinnedRiskIds / flashWindowActive 任一变化后由 watch 重画。
 *
 * 浏览器不支持 CSS.highlights → 静默早出（与 spec § 6.4 quote=null 降级视觉一致）。
 */
export function decorateQuoteRanges(
    risks: RiskDisplayPhaseB[],
    container: HTMLElement,
    state: {
        focusedRiskId: string | null
        pinnedRiskIds: Set<string>
        flashWindowActive: boolean
    },
): void {
    if (!supportsCssHighlight()) return

    clearAllQuoteHighlights()

    const buckets: Record<QuoteHighlightState, Highlight> = {
        'quote-default': new Highlight(),
        'quote-focused': new Highlight(),
        'quote-pinned': new Highlight(),
    }

    for (const risk of risks) {
        const range = computeQuoteRange(risk, container)
        if (!range) continue
        const stateName = pickHighlightState(risk.id, state.focusedRiskId, state.pinnedRiskIds, state.flashWindowActive)
        buckets[stateName].add(range)
    }

    for (const name of HIGHLIGHT_NAMES) {
        CSS.highlights.set(name, buckets[name])
    }
}

/**
 * 清空全部三个命名 Highlight。
 *
 * 调用时机：每次 docx-preview `target.innerHTML = ''` 之前 —— 浏览器替换容器 DOM 后，
 * Highlight 内部持有的 Range 引用旧 text node 失效（spec § 7.4 重渲染保护）。
 */
export function clearAllQuoteHighlights(): void {
    if (!supportsCssHighlight()) return
    CSS.highlights.clear()
}
```

- [ ] **Step 2.2.2：跑测试，确认 GREEN**

```bash
npx vitest run tests/app/utils/quoteHighlight.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: 7 个 it 全部 PASS（6 核心场景 + 1 个 pickHighlightState 矩阵）。

- [ ] **Step 2.2.3：commit**

```bash
git add app/utils/quoteHighlight.ts tests/app/utils/quoteHighlight.test.ts
git commit -m "feat(contract): quote 字符级高亮算法工具 + TDD 单测"
```

---

## Task 3：全局 CSS 加三态 `::highlight()` 浅色 + 深色变体

**Files:**
- Modify: `app/assets/css/tailwind.css`（末尾追加 ~22 行）

`::highlight()` 必须放全局 CSS（Vue scoped 让命中失效）。三态色调对齐 spec § 7.6 + 与 `RISK_LEVEL_DOCX_BG_CLASS` 已有的 dark 变体并存。

> 深色模式色：浅色态 alpha 60% / 85% / 70% 在深色背景下与默认前景文字对比度低；深色变体 alpha 降到 35% / 55% / 45%，让高亮可感知但不抢前景文字。

- [ ] **Step 3.1：在 `app/assets/css/tailwind.css` 末尾追加规则**

打开 `app/assets/css/tailwind.css`（共 286 行），在文件**最末尾**追加：

```css

/* ===== 合同审查 · quote 字符级高亮（spec § 7.6 三态矩阵 + § 7.5 1 秒衰减） =====
 * 用 CSS Custom Highlight API（baseline 2025/06）；不支持的浏览器静默退化为段落级。
 * 注册侧见 app/utils/quoteHighlight.ts 的 decorateQuoteRanges。
 * 必须放全局 CSS——Vue scoped [data-v-xxx] 让 ::highlight() 命中失效。
 * 与 RISK_LEVEL_DOCX_BG_CLASS 的 dark 变体并存：浅色态 60/85/70%；深色态降到 35/55/45%。
 */
::highlight(quote-default) {
    background-color: rgb(252 211 77 / 0.6);
}
::highlight(quote-focused) {
    background-color: rgb(245 158 11 / 0.85);
}
::highlight(quote-pinned) {
    background-color: rgb(217 119 6 / 0.7);
}

@media (prefers-color-scheme: dark) {
    ::highlight(quote-default) {
        background-color: rgb(252 211 77 / 0.35);
    }
    ::highlight(quote-focused) {
        background-color: rgb(245 158 11 / 0.55);
    }
    ::highlight(quote-pinned) {
        background-color: rgb(217 119 6 / 0.45);
    }
}
```

- [ ] **Step 3.2：跑 dev server smoke 看 CSS 是否加载**

```bash
bun dev > /tmp/pr5-dev.log 2>&1 &
sleep 12
curl -sI http://localhost:3000 | head -3
grep -iE "css parse|unknown pseudo|::highlight" /tmp/pr5-dev.log | head
kill %1 2>/dev/null || true
```

Expected: 无 `css parse error` / `Unknown pseudo-element` 等警告。

- [ ] **Step 3.3：commit**

```bash
git add app/assets/css/tailwind.css
git commit -m "feat(contract): 全局 CSS 加 quote 高亮三态规则（含深色模式）"
```

---

## Task 4：DocxPreview 接入 quote 高亮 + props 重构

**Files:**
- Modify: `app/components/assistant/contract/ContractDocxPreview.vue`
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

把 Task 2 的工具函数挂到组件生命周期，同步把 `highlightedRiskIds` prop 重构为 `pinnedRiskIds`（接口直观、避免内部"减 focused 反推 pinned"的派生）。调用方 ContractReviewPanel 同步两处 prop 名。

### 4.1 ContractDocxPreview.vue 改动

- [ ] **Step 4.1.1：编辑 import 块加类型 + 工具函数**

定位第 14 行 `import type` 块（搜索 `import type { Risk, RiskLevel }`），替换为：

```typescript
import type { Risk, RiskDisplayPhaseB, RiskLevel } from '#shared/types/contract'
```

紧接其后追加（在 `import { useApiFetch } from '~/composables/useApiFetch'` 之后）：

```typescript
import {
    decorateQuoteRanges,
    clearAllQuoteHighlights,
} from '~/utils/quoteHighlight'
```

> `Risk` 不删 —— `runDecorateOnce` / `emit('locateResult', Set<string>)` 使用 Risk 基础字段。

- [ ] **Step 4.1.2：改 props 接口（类型升级 + pinnedRiskIds 替换 highlightedRiskIds）**

定位第 20-33 行 `defineProps`，替换为：

```typescript
const props = withDefaults(defineProps<{
    reviewedFileId: number | null
    originalFileId: number | null
    /**
     * PR 5：升级到 RiskDisplayPhaseB[]，新增 problematicQuote / quoteCharStart /
     * quoteCharEnd 用于 quote 字符级高亮（CSS Custom Highlight API）。
     */
    risks?: RiskDisplayPhaseB[]
    focusedRiskId?: string | null
    hoveredRiskId?: string | null
    /**
     * PR 5：从 useContractRiskHighlight.pinnedRiskIds 直接传入（不含 focused）。
     * 替代旧 highlightedRiskIds（pinned ∪ focused 合集）的内部反推。
     */
    pinnedRiskIds?: Set<string>
}>(), {
    risks: () => [],
    focusedRiskId: null,
    hoveredRiskId: null,
    pinnedRiskIds: () => new Set<string>(),
})
```

- [ ] **Step 4.1.3：在 loadDocx 内 `target.innerHTML = ''` 之前调 clearAllQuoteHighlights**

定位第 142 行 `target.innerHTML = ''`，替换为：

```typescript
        const target = containerRef.value
        // PR 5：renderAsync 替换 target.innerHTML 后，CSS.highlights 持有的 Range
        // 引用旧 text node 失效；必须先清空全部命名 Highlight（spec § 7.4 重渲染保护）
        clearAllQuoteHighlights()
        target.innerHTML = ''
        await renderAsync(buffer, target, undefined, { inWrapper: true })
```

- [ ] **Step 4.1.4：在 decorateRisks 末尾追加 paintQuoteHighlights + 加 flashWindowActive ref + 1 秒衰减**

定位第 104-122 行 `decorateRisks` 函数，替换为：

```typescript
async function decorateRisks(): Promise<void> {
    if (!containerRef.value || props.risks.length === 0) {
        paintQuoteHighlights()
        emit('locateResult', runDecorateOnce())
        return
    }
    let notLocated = runDecorateOnce()
    if (notLocated.size < props.risks.length) {
        paintQuoteHighlights()
        emit('locateResult', notLocated)
        return
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
        await nextFrame(attempt * 80)
        notLocated = runDecorateOnce()
        if (notLocated.size < props.risks.length) break
    }
    paintQuoteHighlights()
    emit('locateResult', notLocated)
}

/**
 * PR 5 · § 7.5 焦点 1 秒衰减窗口。
 * focusedRiskId 变化时由 watch 置 true + 启动 1 秒 setTimeout 关闭；
 * pickHighlightState 在窗口关闭后把 quote-focused 衰减为 quote-default。
 */
const flashWindowActive = ref(false)
let flashWindowTimer: ReturnType<typeof setTimeout> | null = null

function paintQuoteHighlights(): void {
    if (!containerRef.value) return
    decorateQuoteRanges(props.risks, containerRef.value, {
        focusedRiskId: props.focusedRiskId ?? null,
        pinnedRiskIds: props.pinnedRiskIds,
        flashWindowActive: flashWindowActive.value,
    })
}

function startFlashWindow(): void {
    flashWindowActive.value = true
    if (flashWindowTimer) clearTimeout(flashWindowTimer)
    flashWindowTimer = setTimeout(() => {
        flashWindowActive.value = false
        flashWindowTimer = null
        paintQuoteHighlights()
    }, 1000)
}

onBeforeUnmount(() => {
    if (flashWindowTimer) {
        clearTimeout(flashWindowTimer)
        flashWindowTimer = null
    }
})
```

- [ ] **Step 4.1.5：改视觉态切换 watch（pinnedRiskIds 替换 highlightedRiskIds + 末尾追加 quote 派系 + focused 1 秒衰减）**

定位第 174-210 行 watch（搜索 `// 聚焦/钉/悬停态样式切换`），整段替换为：

```typescript
// 聚焦/钉/悬停态样式切换（spec §7.1 段落视觉基线 + § 7.5 1 秒衰减 + § 7.6 quote 三态矩阵）
watch(
    [() => props.focusedRiskId, () => props.pinnedRiskIds, () => props.hoveredRiskId, () => props.risks],
    (newVals, oldVals) => {
        if (!containerRef.value) return
        containerRef.value.querySelectorAll('[data-risk-id]').forEach(el => {
            const id = (el as HTMLElement).dataset.riskId
            if (!id) return
            const isActive = id === props.focusedRiskId
            const isPinned = props.pinnedRiskIds.has(id) && !isActive
            const isHovered = id === props.hoveredRiskId && !isActive && !isPinned

            el.classList.remove(
                'bg-yellow-200', 'border-l-[5px]', 'border-red-700',
                '[box-shadow:0_0_0_1px_#b91c1c]',
                'bg-yellow-50',
            )
            if (isActive || isPinned) {
                el.classList.add(
                    'bg-yellow-200', 'border-l-[5px]', 'border-red-700',
                    '[box-shadow:0_0_0_1px_#b91c1c]',
                )
            }
            if (isHovered) {
                el.classList.add('bg-yellow-50')
            }
        })
        if (props.focusedRiskId) {
            const el = containerRef.value.querySelector(`[data-risk-id="${props.focusedRiskId}"]`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }

        // PR 5：focused 切到新 risk → 启动 1 秒衰减窗口（spec § 7.5）
        const prevFocused = (oldVals?.[0] ?? null) as string | null
        const newFocused = (newVals[0] ?? null) as string | null
        if (newFocused && newFocused !== prevFocused) {
            startFlashWindow()
        }

        // PR 5：派系字符级 quote 高亮三态（spec § 7.6 矩阵）
        paintQuoteHighlights()
    },
)
```

### 4.2 ContractReviewPanel.vue 调用方同步

- [ ] **Step 4.2.1：把两处给 DocxPreview 传的 highlighted-risk-ids 改为 pinned-risk-ids**

定位 `app/components/assistant/contract/ContractReviewPanel.vue` 第 682 行：

```vue
                                    :highlighted-risk-ids="highlightedRiskIds"
```

改为：

```vue
                                    :pinned-risk-ids="pinnedRiskIds"
```

定位第 747 行（同样的属性，窄屏分支）：

```vue
                                :highlighted-risk-ids="highlightedRiskIds"
```

改为：

```vue
                                :pinned-risk-ids="pinnedRiskIds"
```

> useContractRiskHighlight 已 export `pinnedRiskIds`（第 165 行 destructure 里已包含），无需新增解构。`highlightedRiskIds` 仍然解构在用（RiskListPanel 不变），不删。

### 4.3 验证

- [ ] **Step 4.3.1：跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 错误。

- [ ] **Step 4.3.2：跑 ContractReviewPanel 既有测试验证调用方不破**

```bash
npx vitest run tests/app/components/assistant/contract/ --reporter=verbose 2>&1 | tail -30
```

Expected: 全部 PASS。

- [ ] **Step 4.3.3：commit**

```bash
git add app/components/assistant/contract/ContractDocxPreview.vue app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "feat(contract): DocxPreview 接入 quote 字符级高亮（CSS Highlight API + 1 秒衰减）"
```

---

## Task 5：DocxPreview 集成单元测试

**Files:**
- Create: `tests/app/components/assistant/contract/ContractDocxPreview.highlight.test.ts`

补组件层的 4 个集成场景：CSS.highlights 不可用时不抛错 / quote=null 透传 / 切换 reviewedFileId 触发 clear / focusedRiskId 变化触发重画。

> **vi.mock 工厂引用模块外变量必须用 `vi.hoisted()`**（Vitest 文档：factory 被 hoist 到文件顶端，无法引用模块外 const，否则 ReferenceError）。

- [ ] **Step 5.1：创建测试文件**

新建 `tests/app/components/assistant/contract/ContractDocxPreview.highlight.test.ts`：

```typescript
/**
 * ContractDocxPreview · quote 字符级高亮集成测试
 *
 * **Feature: contract-review-precise-anchoring (PR 5)**
 * **Validates: spec § 7.3.3 / 7.4 / 6.4 在组件层的接入**
 *
 * 4 个场景：
 *  1. CSS.highlights 不可用时 mount 不抛错（spec § 7.3.3 早出降级）
 *  2. quote=null 的 risk 透传到工具（由工具内部按 § 6.4 跳过）
 *  3. 切换 reviewedFileId 触发 clearAllQuoteHighlights（spec § 7.4 重渲染保护）
 *  4. focusedRiskId 变化触发 decorateQuoteRanges 重画
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { RiskDisplayPhaseB } from '#shared/types/contract'

// vi.hoisted 把 mock fn 提到 vi.mock factory 之前可用
const hoisted = vi.hoisted(() => ({
    mockRenderAsync: vi.fn(async (_buf: ArrayBuffer, target: HTMLElement) => {
        target.innerHTML = `
            <div class="docx-wrapper">
                <section class="docx">
                    <p>第三条 工资支付</p>
                    <p>工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。</p>
                </section>
            </div>
        `
    }),
    mockUseApiFetch: vi.fn(async () => ([{ ossFileId: 1, downloadUrl: 'http://mock-oss/file.docx' }])),
    mockDecorateQuoteRanges: vi.fn(),
    mockClearAllQuoteHighlights: vi.fn(),
}))

vi.mock('docx-preview', () => ({ renderAsync: hoisted.mockRenderAsync }))
vi.mock('~/composables/useApiFetch', () => ({ useApiFetch: hoisted.mockUseApiFetch }))
vi.mock('~/utils/quoteHighlight', () => ({
    decorateQuoteRanges: hoisted.mockDecorateQuoteRanges,
    clearAllQuoteHighlights: hoisted.mockClearAllQuoteHighlights,
}))

vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })))

import ContractDocxPreview from '~/components/assistant/contract/ContractDocxPreview.vue'

function makeRisk(over: Partial<RiskDisplayPhaseB> = {}): RiskDisplayPhaseB {
    return {
        id: 'risk-1',
        clauseIndex: 0,
        clauseText: '工资按月支付。逾期支付的，每日按 0.05% 加收滞纳金。',
        clauseParagraphIndex: 1,
        level: 'medium',
        category: '违约金',
        problem: '违约金过低',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
        problematicQuote: '每日按 0.05% 加收滞纳金',
        quoteCharStart: 13,
        quoteCharEnd: 26,
        ...over,
    } as RiskDisplayPhaseB
}

describe('ContractDocxPreview · quote 字符级高亮集成', () => {
    beforeEach(() => {
        hoisted.mockDecorateQuoteRanges.mockClear()
        hoisted.mockClearAllQuoteHighlights.mockClear()
        hoisted.mockRenderAsync.mockClear()
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('CSS.highlights 不可用时 mount 不抛错（spec § 7.3.3 早出降级）', async () => {
        const wrapper = mount(ContractDocxPreview, {
            props: { reviewedFileId: 1, originalFileId: null, risks: [makeRisk()] },
        })
        await flushPromises()
        // 行为契约：组件确实调用了工具，由工具内部决定渲不渲染
        expect(hoisted.mockDecorateQuoteRanges).toHaveBeenCalled()
        wrapper.unmount()
    })

    it('quote=null 的 risk 透传到 decorateQuoteRanges（由工具按 § 6.4 跳过）', async () => {
        const wrapper = mount(ContractDocxPreview, {
            props: {
                reviewedFileId: 1,
                originalFileId: null,
                risks: [makeRisk({ problematicQuote: null, quoteCharStart: null, quoteCharEnd: null })],
            },
        })
        await flushPromises()
        const lastCall = hoisted.mockDecorateQuoteRanges.mock.calls.at(-1)
        const passedRisks = lastCall?.[0] as RiskDisplayPhaseB[]
        expect(passedRisks[0]?.quoteCharStart).toBeNull()
        wrapper.unmount()
    })

    it('切换 reviewedFileId 触发 clearAllQuoteHighlights（spec § 7.4 重渲染保护）', async () => {
        const wrapper = mount(ContractDocxPreview, {
            props: { reviewedFileId: 1, originalFileId: null, risks: [makeRisk()] },
        })
        await flushPromises()
        const before = hoisted.mockClearAllQuoteHighlights.mock.calls.length

        await wrapper.setProps({ reviewedFileId: 2 })
        await flushPromises()

        expect(hoisted.mockClearAllQuoteHighlights.mock.calls.length).toBeGreaterThan(before)
        wrapper.unmount()
    })

    it('focusedRiskId 变化触发 decorateQuoteRanges 重画', async () => {
        const wrapper = mount(ContractDocxPreview, {
            props: {
                reviewedFileId: 1,
                originalFileId: null,
                risks: [makeRisk(), makeRisk({ id: 'risk-2' })],
                focusedRiskId: null,
            },
        })
        await flushPromises()
        const before = hoisted.mockDecorateQuoteRanges.mock.calls.length

        await wrapper.setProps({ focusedRiskId: 'risk-1' })
        await nextTick()

        expect(hoisted.mockDecorateQuoteRanges.mock.calls.length).toBeGreaterThan(before)
        const lastCall = hoisted.mockDecorateQuoteRanges.mock.calls.at(-1)
        const passedState = lastCall?.[2] as { focusedRiskId: string | null; flashWindowActive: boolean }
        expect(passedState.focusedRiskId).toBe('risk-1')
        // focusedRiskId 切换时 flashWindowActive 应为 true（1 秒衰减窗口启动）
        expect(passedState.flashWindowActive).toBe(true)
        wrapper.unmount()
    })
})
```

- [ ] **Step 5.2：跑测试**

```bash
npx vitest run tests/app/components/assistant/contract/ContractDocxPreview.highlight.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: 4 个 it 全部 PASS。

- [ ] **Step 5.3：commit**

```bash
git add tests/app/components/assistant/contract/ContractDocxPreview.highlight.test.ts
git commit -m "test(contract): DocxPreview quote 字符级高亮集成测试"
```

---

## Task 6：完整 typecheck + 全量测试 + 浏览器抽样验收

**Files:**
- 不修改文件

- [ ] **Step 6.1：typecheck 全量**

```bash
bun run typecheck 2>&1 | tail -10
```

Expected: 0 错误。

- [ ] **Step 6.2：前端合同测试 + 工具测试 + composable 测试 + 类型测试**

```bash
npx vitest run \
    tests/app/components/assistant/contract/ \
    tests/app/utils/quoteHighlight.test.ts \
    tests/app/composables/useContractRiskHighlight.test.ts \
    tests/shared/utils/clauseLocator \
    tests/shared/types/contract.test.ts \
    --reporter=verbose 2>&1 | tail -40
```

Expected: 全部 PASS。

- [ ] **Step 6.3：浏览器肉眼抽样（chrome-devtools MCP）**

如果 dev server 没起，先 `bun dev`。

1. 浏览器打开 `http://localhost:3000`，登录
2. 进入一份 completed 合同审查（**优先选 PR 3 已合后产出的、含 problematicQuote 的审查**；PR 3 未合则跳过 4-6 走 § 6.4 降级抽样）
3. 段落级配色保留：高=浅红 / 中=浅橙 / 低=浅灰 + 左色条
4. quote 字符级高亮：含 problematicQuote 的段落里 quote 字符段深黄底
5. 切换风险卡 focused：quote 字符段闪一下深橙（约 1 秒）→ 衰减回深黄；段落级红边框继续亮
6. shift+click 另一条风险卡 pin：被 pin 的卡的 quote 段变棕黄
7. 切换 reviewedFileId（如上传新版本回传）：老 quote 高亮完全消失、新文档高亮按新 risks 重画
8. § 6.4 降级抽样（quote=null 的 risk）：段落级照常、字符级不出现
9. 切到 dark 主题：quote 高亮可感知但不抢前景文字（alpha 35/55/45%）

9 条全过 → UI 验收通过。

- [ ] **Step 6.4：commit message 序列校验**

```bash
git log --oneline | head -8
```

Expected:

```
test(contract): DocxPreview quote 字符级高亮集成测试
feat(contract): DocxPreview 接入 quote 字符级高亮（CSS Highlight API + 1 秒衰减）
feat(contract): 全局 CSS 加 quote 高亮三态规则（含深色模式）
feat(contract): quote 字符级高亮算法工具 + TDD 单测
refactor(contract): clauseLocator 暴露 findByParagraphIndex 供前端复用
```

5 个原子 commit。

---

## Task 7：开 PR · 整合到 dev

**Files:**
- 不修改文件

- [ ] **Step 7.1：push branch**

```bash
git push -u origin pr5-docx-preview-highlight
```

- [ ] **Step 7.2：开 PR（gh CLI）**

```bash
gh pr create --base dev --title "feat(contract): DocxPreview quote 字符级高亮 (PR 5)" --body "$(cat <<'EOF'
## Summary

风险卡里指出的具体问题词句，会在原文中以醒目的深黄色突出显示。律师点击该风险卡时，对应字句会"闪一下"变成深橙色（约 1 秒），方便快速定位；钉住的风险卡，对应字句变成棕黄色长亮。深色主题下高亮颜色自动柔化。律师从此能直接看到"AI 是从哪几个字得出的风险结论"，不必再读整段。

## 实现要点
- 段落级配色保留（high 红 / medium 橙 / low 灰）；新增 quote 字符级高亮叠加
- 用 CSS Custom Highlight API（baseline 2025/06）：跨 `<p>` / 跨 `<span>` 通过 Range 表达，不修改第三方 docx-preview 渲染产物
- 三态命名 Highlight：quote-default 深黄 60% / quote-focused 深橙 85% / quote-pinned 棕黄 70%；深色模式 35/55/45% 柔化
- focused 切换启动 1 秒 setTimeout 衰减窗口（spec § 7.5），到点回退到 quote-default；段落级红边框持续亮维持焦点锚
- 浏览器不支持 CSS.highlights 时静默退化到段落级（不写 DOM-mutate fallback）
- renderAsync 重渲染前 `CSS.highlights.clear()` 清掉 stale Range（spec § 7.4）
- `pinnedRiskIds` prop 直接来自 useContractRiskHighlight，DocxPreview 不再从 highlightedRiskIds 反推
- 复用 `clauseLocator.findByParagraphIndex`（Task 1 加 export），避免重复实现"非空段落序号"算法

## Spec
docs/superpowers/specs/2026-05-02-contract-review-precise-anchoring-and-track-changes-design.md § 7（7.1 ~ 7.6）+ § 6.4 + § 10.1 + § 11

## 依赖
- PR 1（partyDetector 修复）已合
- PR 2（数据模型重构）已合
- **PR 3（路线 2 锚点解析）强烈建议先行** —— 未合时 quote 字段全 null，UI 自动降级到段落级（视觉=现状），与 spec § 11.1 字面发布顺序约束对齐
- PR 4（风险卡 Layout A/C）已合 —— RiskDisplayPhaseB 已含 quote 字段；ContractReviewPanel.mapEntityToDisplay 已透传

## 改动文件
- 新建：app/utils/quoteHighlight.ts（算法 + 三态派生 + 1 秒衰减）
- 修改：shared/utils/clauseLocator.ts（PARA_BLOCK_SELECTOR / findByParagraphIndex 加 export）
- 修改：app/assets/css/tailwind.css（追加 ::highlight 三态规则 + 深色变体）
- 修改：app/components/assistant/contract/ContractDocxPreview.vue（类型升级 + 接入工具 + pinnedRiskIds prop + 1 秒衰减）
- 修改：app/components/assistant/contract/ContractReviewPanel.vue（两处 highlighted-risk-ids → pinned-risk-ids）
- 新建：tests/app/utils/quoteHighlight.test.ts（算法 6 场景 + pickHighlightState 矩阵）
- 新建：tests/app/components/assistant/contract/ContractDocxPreview.highlight.test.ts（组件集成 4 场景）

## 不动文件
- server/** / prisma/**（PR 5 完全不改服务端 / schema）
- shared/types/contract.ts（PR 4 已扩 quote 字段）
- 其他风险卡相关组件（RiskCard / RiskListPanel / RiskClauseDiff）
- app/utils/contractRiskLevelStyle.ts / app/composables/useContractRiskHighlight.ts

## Test plan
- [ ] `bun run typecheck` 0 错误
- [ ] `npx vitest run tests/app/utils/quoteHighlight.test.ts` 7 个 it PASS（含跨多 span 场景 + pickHighlightState 矩阵含 1 秒衰减）
- [ ] `npx vitest run tests/app/components/assistant/contract/ContractDocxPreview.highlight.test.ts` 4 个 it PASS
- [ ] `npx vitest run tests/app/components/assistant/contract/` 全套合同前端测试 PASS
- [ ] `npx vitest run tests/app/composables/useContractRiskHighlight.test.ts` PASS
- [ ] `npx vitest run tests/shared/utils/clauseLocator` PASS（仅加 export 不改行为）
- [ ] chrome-devtools MCP 浏览器抽样：段落级配色 + quote 字符级 + focused 1 秒闪烁衰减 + pinned 棕黄 + 重渲染清理 + § 6.4 降级 + 深色主题，9 条全过

## 已知限制 / 后续 PR
- 字符等价性边角（全角空格 / `<w:tab>` / `<w:br>`）不做精确映射（spec § 7.3.2 简化策略），实测出现明显偏差再加映射表
- DOM-mutate fallback 不实现（spec § 7.3.3 明确 YAGNI）
- 跨段 quote 含空行边角：仅按非空 line 与非空 `<p>` 1:1 对齐
EOF
)"
```

- [ ] **Step 7.3：返回 PR URL**

把 `gh pr create` 输出的 URL 回报给用户。

---

## Plan 完成。
