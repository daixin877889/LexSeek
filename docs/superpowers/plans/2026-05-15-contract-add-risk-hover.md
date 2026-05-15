# 合同审查「左侧预览 hover 新增风险」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在合同预览里 hover 段落点「＋」即可新增风险，自动带入段落原文与位置，并补全后端「新增风险」接口让其真正入库。

**Architecture:** 后端新增 `POST /reviews/add-risk/:id` 接口（handler → service → 复用 `createContractRiskDAO`）。前端 `ContractDocxPreview` 用事件委托在正文段落浮出「＋」按钮，点击 emit 段落原文+序号，经 `ContractReviewPanel` 打开 `RiskListPanel` 内的 `RiskEditDialog` 新增模式，确认后调新接口、刷新 `versioning` 工作区。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript；Prisma；Vitest（`npx vitest run`）；docx-preview。

**参照设计文档：** `docs/superpowers/specs/2026-05-15-contract-add-risk-hover-design.md`

**通用约定：**
- 测试一律 `npx vitest run <file>`，禁用 `bun test`。
- 类型检查 `bun run typecheck`。
- 每个任务结束提交一次（conventional commit + 中文，scope=`contract`）。
- 后端涉及 DB 的测试直接 `import { prisma } from '~~/server/utils/db'`，worker DB 自动隔离。

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `shared/types/contract.ts` | 改 | `RISK_SOURCES` 增加 `'manual'` |
| `prisma/models/contractRiskAndAnnotation.prisma` | 改 | `source` 列注释补 `'manual'`（仅注释） |
| `server/agents/contract/contractRisk.dao.ts` | 改 | `CreateContractRiskInput` 增加 `suggestedClauseText` |
| `server/agents/contract/contractRisk.service.ts` | 改 | 新增 `addManualRiskService` |
| `server/api/v1/assistant/contract/reviews/add-risk/[id].post.ts` | 建 | 新增单条风险接口 |
| `shared/utils/clauseLocator.ts` | 改 | 新增 `paragraphIndexOfElement` 反查函数 |
| `app/components/assistant/contract/ContractDocxPreview.vue` | 改 | 事件委托 + 浮动「＋」按钮 + emit `addRiskFromParagraph` |
| `app/components/assistant/contract/RiskEditDialog.vue` | 改 | 新增模式去条款序号、原文只读、去掉「法律风险」字段 |
| `app/components/assistant/contract/RiskListPanel.vue` | 改 | 移除顶部新增按钮+`openCreate`；`mainRisks` 排序键改；暴露外部触发新增的入口 |
| `app/components/assistant/contract/ContractReviewPanel.vue` | 改 | 串接 `addRiskFromParagraph` → 打开新增弹框 → 调新接口 → 刷新 |

---

## Task 1: 扩展 `CreateContractRiskInput` 支持 `suggestedClauseText`

**Files:**
- Modify: `server/agents/contract/contractRisk.dao.ts:12-31`

`contractRisks` 表已有 `suggestedClauseText` 列，但 `CreateContractRiskInput` 接口未暴露它。手动新增风险的「建议改写后条款」需要它。

- [ ] **Step 1: 修改接口**

在 `CreateContractRiskInput` 接口内、`suggestion` 字段之后加一行：

```typescript
    suggestion?: string | null
    /** AI 生成 / 律师填写的完整改写后条款（high/medium 必有；low 可空） */
    suggestedClauseText?: string | null
    /** 完整条款原文（NOT NULL） */
    clauseText: string
```

`createContractRiskDAO` 直接把 `input` 透传给 `prisma.contractRisks.create({ data: input })`，无需改实现。

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 与本次改动相关的文件无新增错误（项目存在与本需求无关的既有 typecheck 报错，忽略它们）。

- [ ] **Step 3: 提交**

```bash
git add server/agents/contract/contractRisk.dao.ts
git commit -m "feat(contract): CreateContractRiskInput 支持 suggestedClauseText"
```

---

## Task 2: `RISK_SOURCES` 增加 `'manual'`

**Files:**
- Modify: `shared/types/contract.ts:513`
- Modify: `prisma/models/contractRiskAndAnnotation.prisma:5`

- [ ] **Step 1: 改 RISK_SOURCES**

`shared/types/contract.ts` 第 513 行：

```typescript
export const RISK_SOURCES = ['ai', 'external_new', 'global_review', 'manual'] as const
```

`RiskSource` 类型由 `typeof RISK_SOURCES[number]` 派生，自动包含 `'manual'`。

- [ ] **Step 2: 改 prisma 注释（仅注释，非迁移）**

`prisma/models/contractRiskAndAnnotation.prisma` 第 5 行：

```prisma
  /// 来源：ai（首次审查）/ external_new（客户回传新增）/ global_review（全局复核）/ manual（律师手动新增）
  source     String @db.VarChar(20)
```

不需要 `prisma migrate`——`source` 是无约束 `VarChar(20)`。

- [ ] **Step 3: 类型检查**

Run: `bun run typecheck`
Expected: 无新增错误。

- [ ] **Step 4: 提交**

```bash
git add shared/types/contract.ts prisma/models/contractRiskAndAnnotation.prisma
git commit -m "feat(contract): 新增风险来源类型 manual"
```

---

## Task 3: `addManualRiskService`

**Files:**
- Modify: `server/agents/contract/contractRisk.service.ts`
- Test: `tests/server/assistant/contract/addManualRisk.service.test.ts`

service 做字段映射并调 `createContractRiskDAO`。落库口径参照同文件的 `persistAiRisksAsContractRows`。

- [ ] **Step 1: 写失败测试**

新建 `tests/server/assistant/contract/addManualRisk.service.test.ts`：

```typescript
/**
 * addManualRiskService 测试
 * **Feature: contract-add-risk-hover**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { addManualRiskService } from '~~/server/agents/contract/contractRisk.service'

describe('addManualRiskService', () => {
    const created = { reviews: [] as number[], users: [] as number[] }

    afterEach(async () => {
        await prisma.contractRisks.deleteMany({ where: { reviewId: { in: created.reviews } } })
        await prisma.contractReviews.deleteMany({ where: { id: { in: created.reviews } } })
        await prisma.users.deleteMany({ where: { id: { in: created.users } } })
        created.reviews = []
        created.users = []
    })

    async function seedReview(): Promise<number> {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x' },
        })
        created.users.push(user.id)
        const review = await prisma.contractReviews.create({
            data: { userId: user.id, sessionId: `s-${Date.now()}`, status: 'completed' },
        })
        created.reviews.push(review.id)
        return review.id
    }

    it('插入一条 source=manual 的风险，定位字段与 stance 正确落库', async () => {
        const reviewId = await seedReview()
        const risk = await addManualRiskService({
            reviewId,
            clauseText: '第二条 试用期为 6 个月。',
            clauseParagraphIndex: 5,
            level: 'high',
            category: '试用期',
            problem: '试用期过长',
            legalBasis: null,
            analysis: '超过法定上限',
            suggestion: '改为不超过 6 个月',
            suggestedClauseText: '试用期为 2 个月。',
        })
        expect(risk.source).toBe('manual')
        expect(risk.clauseText).toBe('第二条 试用期为 6 个月。')
        expect(risk.clauseParagraphIndex).toBe(5)
        expect(risk.clauseIndex).toBe(5)
        expect(risk.stance).toBe('balanced')
        expect(risk.problematicQuote).toBeNull()
        expect(risk.suggestedClauseText).toBe('试用期为 2 个月。')
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/addManualRisk.service.test.ts`
Expected: FAIL —— `addManualRiskService` 未导出。

- [ ] **Step 3: 实现 service**

在 `server/agents/contract/contractRisk.service.ts` 末尾追加。确认文件顶部已 import `createContractRiskDAO`（无则加 `import { createContractRiskDAO } from './contractRisk.dao'`）、`DEFAULT_AI_RISK_STANCE`（来自 `#shared/types/contract`）：

```typescript
/**
 * 律师手动新增单条风险（contract-add-risk-hover）。
 *
 * source 固定 'manual'；无精确句子锚点（problematicQuote 等留 null）；
 * clauseIndex 取与 clauseParagraphIndex 相同的值，使其在 RiskListPanel 按
 * clauseParagraphIndex 排序时落在正确的段落位置。
 */
export async function addManualRiskService(input: {
    reviewId: number
    clauseText: string
    clauseParagraphIndex: number
    level: RiskLevel
    category: string
    problem: string
    legalBasis?: string | null
    analysis?: string | null
    suggestion?: string | null
    suggestedClauseText?: string | null
}): Promise<contractRisks> {
    return createContractRiskDAO({
        reviewId: input.reviewId,
        source: 'manual',
        category: input.category,
        level: input.level,
        stance: DEFAULT_AI_RISK_STANCE,
        problem: input.problem,
        legalBasis: input.legalBasis ?? null,
        analysis: input.analysis ?? null,
        suggestion: input.suggestion ?? null,
        suggestedClauseText: input.suggestedClauseText ?? null,
        clauseText: input.clauseText,
        clauseParagraphIndex: input.clauseParagraphIndex,
        clauseIndex: input.clauseParagraphIndex,
    })
}
```

> `contractRisks` 与 `RiskLevel` 类型若文件顶部未引入，按现有 import 风格补 `import type { contractRisks } from '~~/generated/prisma/client'`、`RiskLevel` 加入 `#shared/types/contract` 的 import。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/addManualRisk.service.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/agents/contract/contractRisk.service.ts tests/server/assistant/contract/addManualRisk.service.test.ts
git commit -m "feat(contract): 新增 addManualRiskService 手动风险落库"
```

---

## Task 4: 新建 `POST /reviews/add-risk/:id` 接口

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/add-risk/[id].post.ts`
- Test: `tests/server/assistant/contract/addRisk.api.test.ts`

参照 `reviews/add-annotation/[id].post.ts` 的 handler 模式（`loadOwnedReview` + zod + service）。

- [ ] **Step 1: 写失败测试**

新建 `tests/server/assistant/contract/addRisk.api.test.ts`：

```typescript
/**
 * POST /reviews/add-risk/:id 接口测试
 * **Feature: contract-add-risk-hover**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import handler from '~~/server/api/v1/assistant/contract/reviews/add-risk/[id].post'

function mockEvent(opts: { userId: number; reviewId: string; body: unknown }) {
    return {
        context: { auth: { user: { id: opts.userId, name: '测试律师' } } },
        node: { req: {}, res: {} },
        __routerParams: { id: opts.reviewId },
        __body: opts.body,
    } as any
}

describe('POST /reviews/add-risk/:id', () => {
    const created = { reviews: [] as number[], users: [] as number[] }

    afterEach(async () => {
        await prisma.contractRisks.deleteMany({ where: { reviewId: { in: created.reviews } } })
        await prisma.contractReviews.deleteMany({ where: { id: { in: created.reviews } } })
        await prisma.users.deleteMany({ where: { id: { in: created.users } } })
        created.reviews = []
        created.users = []
    })

    async function seed(status: string, currentVersionId: number | null) {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x' },
        })
        created.users.push(user.id)
        const review = await prisma.contractReviews.create({
            data: { userId: user.id, sessionId: `s-${Date.now()}`, status, currentVersionId },
        })
        created.reviews.push(review.id)
        return { user, review }
    }

    const validBody = {
        clauseText: '第二条 试用期为 6 个月。',
        clauseParagraphIndex: 5,
        level: 'high',
        category: '试用期',
        problem: '试用期过长',
        analysis: '超过法定上限',
        suggestion: '改为不超过 6 个月',
        suggestedClauseText: '试用期为 2 个月。',
    }

    it('completed + 已迁移审查：成功新增 manual 风险', async () => {
        const { user, review } = await seed('completed', 1)
        const res: any = await handler(mockEvent({ userId: user.id, reviewId: String(review.id), body: validBody }))
        expect(res.code).toBe(0)
        const rows = await prisma.contractRisks.findMany({ where: { reviewId: review.id } })
        expect(rows).toHaveLength(1)
        expect(rows[0]!.source).toBe('manual')
    })

    it('未迁移审查（currentVersionId=null）：返回错误，不入库', async () => {
        const { user, review } = await seed('completed', null)
        const res: any = await handler(mockEvent({ userId: user.id, reviewId: String(review.id), body: validBody }))
        expect(res.code).not.toBe(0)
        const rows = await prisma.contractRisks.findMany({ where: { reviewId: review.id } })
        expect(rows).toHaveLength(0)
    })

    it('非 completed 审查：返回 409 类错误', async () => {
        const { user, review } = await seed('reviewing', 1)
        const res: any = await handler(mockEvent({ userId: user.id, reviewId: String(review.id), body: validBody }))
        expect(res.code).not.toBe(0)
    })
})
```

> 注：`mockEvent` 的 `__routerParams` / `__body` 是占位；实现 Step 3 后，按本项目其它合同接口测试（如 `rebuildDocx.api.test.ts`、`addRisk` 同目录已有接口测试）的既定 mock 方式对齐——读一个现有接口测试文件，套用它的 `getRouterParam` / `readBody` mock 写法替换 `mockEvent`。

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/addRisk.api.test.ts`
Expected: FAIL —— 接口文件不存在。

- [ ] **Step 3: 实现接口**

新建 `server/api/v1/assistant/contract/reviews/add-risk/[id].post.ts`：

```typescript
/**
 * POST /api/v1/assistant/contract/reviews/add-risk/:id
 *
 * 律师在合同预览中针对某段落手动新增一条风险。
 *
 * 请求体：风险内容字段 + clauseText（段落原文）+ clauseParagraphIndex（段落序号）。
 *
 * 前置：审查归属当前用户、status=completed、且 currentVersionId 非空（已迁移）。
 * 未迁移审查 GET 仍读 legacy JSON，新表插入不可见，故拒绝。
 *
 * 错误码：400 参数错误 / 401 未登录 / 403 无权 / 404 不存在 / 409 状态不允许
 */
import { z } from 'zod'
import { loadOwnedReview } from '~~/server/services/assistant/contract/reviewGuard'
import { addManualRiskService } from '~~/server/agents/contract/contractRisk.service'
import { REVIEW_EDITABLE_STATUSES } from '#shared/types/contract'
import type { ContractReviewStatus } from '#shared/types/contract'

const bodySchema = z.object({
    clauseText: z.string().trim().min(1).max(10000),
    clauseParagraphIndex: z.number().int().nonnegative(),
    level: z.enum(['high', 'medium', 'low']),
    category: z.string().trim().min(1).max(50),
    problem: z.string().trim().min(1).max(2000),
    legalBasis: z.string().trim().max(2000).nullish(),
    analysis: z.string().trim().max(2000).nullish(),
    suggestion: z.string().trim().max(2000).nullish(),
    suggestedClauseText: z.string().max(10000).nullish(),
}).refine(
    r => r.level === 'low' || !!r.suggestedClauseText,
    { message: 'high/medium 级别必须提供建议改写后的条款', path: ['suggestedClauseText'] },
)

export default defineEventHandler(async (event) => {
    const guard = await loadOwnedReview(event, { actionLabel: '新增风险' })
    if (!guard.ok) return resError(event, guard.status, guard.message)
    const { review } = guard

    if (!REVIEW_EDITABLE_STATUSES.includes(review.status as ContractReviewStatus)) {
        return resError(event, 409, `当前状态不允许新增风险：${review.status}`)
    }
    if (review.currentVersionId == null) {
        return resError(event, 409, '该审查尚未生成版本快照，暂不支持新增风险')
    }

    const raw = await readBody(event)
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')

    const risk = await addManualRiskService({
        reviewId: review.id,
        clauseText: parsed.data.clauseText,
        clauseParagraphIndex: parsed.data.clauseParagraphIndex,
        level: parsed.data.level,
        category: parsed.data.category,
        problem: parsed.data.problem,
        legalBasis: parsed.data.legalBasis ?? null,
        analysis: parsed.data.analysis ?? null,
        suggestion: parsed.data.suggestion ?? null,
        suggestedClauseText: parsed.data.suggestedClauseText ?? null,
    })

    return resSuccess(event, '新增成功', risk)
})
```

> `loadOwnedReview` 返回的 `review` 含 `currentVersionId` 字段——若 guard 的 select 未包含，需在 `reviewGuard.ts` 的 select 补 `currentVersionId: true`（先 Read `server/services/assistant/contract/reviewGuard.ts` 确认；它转发自 `server/agents/contract/`）。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/addRisk.api.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add server/api/v1/assistant/contract/reviews/add-risk/ tests/server/assistant/contract/addRisk.api.test.ts
git commit -m "feat(contract): 新增 POST add-risk 手动新增风险接口"
```

---

## Task 5: `clauseLocator` 段落序号反查函数

**Files:**
- Modify: `shared/utils/clauseLocator.ts`
- Test: `tests/shared/clauseLocator.paragraphIndexOf.test.ts`

现有 `findByParagraphIndex(container, N)` 是 index→element；本任务加反向 element→index，复用同一 `PARA_BLOCK_SELECTOR` 与遍历算法。

- [ ] **Step 1: 写失败测试**

新建 `tests/shared/clauseLocator.paragraphIndexOf.test.ts`：

```typescript
/**
 * paragraphIndexOfElement 测试
 * **Feature: contract-add-risk-hover**
 */
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { paragraphIndexOfElement } from '#shared/utils/clauseLocator'

describe('paragraphIndexOfElement', () => {
    it('返回元素在非空块级段落序列中的 0-based 序号', () => {
        const dom = new JSDOM(`<div id="c">
            <p>第一段</p>
            <p>   </p>
            <p>第二段</p>
            <h2>标题段</h2>
        </div>`)
        const c = dom.window.document.getElementById('c')!
        const ps = c.querySelectorAll('p, h2')
        expect(paragraphIndexOfElement(c, ps[0]!)).toBe(0)   // 第一段
        expect(paragraphIndexOfElement(c, ps[1]!)).toBe(-1)  // 空段不计入
        expect(paragraphIndexOfElement(c, ps[2]!)).toBe(1)   // 第二段
        expect(paragraphIndexOfElement(c, ps[3]!)).toBe(2)   // 标题段
    })
})
```

> 若项目无 `jsdom`，改用现有 `clauseLocator` 测试同款 DOM 构造方式（先看 `tests/` 下是否已有 clauseLocator 测试并对齐其写法）。

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/shared/clauseLocator.paragraphIndexOf.test.ts`
Expected: FAIL —— `paragraphIndexOfElement` 未导出。

- [ ] **Step 3: 实现反查函数**

在 `shared/utils/clauseLocator.ts` 的 `findByParagraphIndex` 函数之后追加：

```typescript
/**
 * findByParagraphIndex 的反向：取元素在「非空块级段落」序列中的 0-based 序号。
 * 仅统计 PARA_BLOCK_SELECTOR 命中且 textContent 非空的元素，与后端
 * collectNonEmptyParagraphs 同口径。元素为空段 / 不在序列中时返回 -1。
 */
export function paragraphIndexOfElement(container: Element, target: Element): number {
    const blocks = container.querySelectorAll(PARA_BLOCK_SELECTOR)
    let count = 0
    for (const el of blocks) {
        const text = (el.textContent ?? '').trim()
        if (text.length === 0) continue
        if (el === target) return count
        count++
    }
    return -1
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/shared/clauseLocator.paragraphIndexOf.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add shared/utils/clauseLocator.ts tests/shared/clauseLocator.paragraphIndexOf.test.ts
git commit -m "feat(contract): clauseLocator 增加段落序号反查"
```

---

## Task 6: `ContractDocxPreview` hover「＋」按钮

**Files:**
- Modify: `app/components/assistant/contract/ContractDocxPreview.vue`

在 `containerRef` 上做事件委托：`mouseover` 时若命中**容器直接子级**的非空 `<p>`/`<h*>`（排除表格 `<td>` 内段落），把单个浮动「＋」按钮定位到该段左侧；点「＋」emit `addRiskFromParagraph`。

- [ ] **Step 1: 加 emit 声明**

`defineEmits` 内追加：

```typescript
const emit = defineEmits<{
    focusRisk: [riskId: string]
    hoverClause: [riskId: string | null]
    locateResult: [notLocatedIds: Set<string>]
    addRiskFromParagraph: [payload: { clauseParagraphIndex: number, clauseText: string }]
}>()
```

- [ ] **Step 2: 加浮动按钮的状态与逻辑**

`<script setup>` 内（`containerRef` 声明之后）追加。先确认顶部已 `import { locateClauseElement, paragraphIndexOfElement } from '#shared/utils/clauseLocator'`：

```typescript
// hover 新增风险：当前 hover 的正文段落 + 浮动「＋」位置
const hoveredParagraph = ref<HTMLElement | null>(null)
const addBtnTop = ref(0)

/** 命中的元素是否为「可新增」正文段落：容器直接子级 + 非空 + p/h* */
function isAddableParagraph(el: Element | null): el is HTMLElement {
    if (!el || !(el instanceof HTMLElement)) return false
    if (!/^(P|H[1-6])$/.test(el.tagName)) return false
    if ((el.textContent ?? '').trim().length === 0) return false
    // 排除表格 td 内段落：其最近的块级祖先若是 td 则不可新增（前后端序号口径不一致）
    if (el.closest('td')) return false
    return true
}

function onContainerMouseOver(e: MouseEvent) {
    const para = (e.target as HTMLElement | null)?.closest('p, h1, h2, h3, h4, h5, h6') ?? null
    if (!isAddableParagraph(para) || !containerRef.value) {
        hoveredParagraph.value = null
        return
    }
    hoveredParagraph.value = para
    // 按内容 offsetTop 定位（容器是 overflow-y-auto 滚动容器，随滚动跟随）
    addBtnTop.value = para.offsetTop
}

function onAddBtnClick() {
    const para = hoveredParagraph.value
    if (!para || !containerRef.value) return
    const idx = paragraphIndexOfElement(containerRef.value, para)
    if (idx < 0) return
    emit('addRiskFromParagraph', {
        clauseParagraphIndex: idx,
        clauseText: (para.textContent ?? '').trim(),
    })
}
```

- [ ] **Step 3: 模板加事件委托与浮动按钮**

把 `containerRef` 的 `<div>` 改为带 `mouseover` 监听 + 内嵌浮动按钮（`containerRef` 元素跨重渲染存在，委托监听不会失效）：

```html
<div class="relative flex-1 min-h-0">
    <div
        ref="containerRef"
        class="docx-preview-container h-full overflow-y-auto rounded-md bg-background p-6"
        @mouseover="onContainerMouseOver"
    />
    <button
        v-if="hoveredParagraph"
        type="button"
        class="absolute left-3 z-20 flex size-5 items-center justify-center rounded-full bg-primary text-prim-foreground text-sm shadow hover:scale-110 transition"
        :style="{ top: addBtnTop + 'px' }"
        title="在此段落新增风险"
        @click.stop="onAddBtnClick"
    >
        <PlusIcon class="size-3" />
    </button>
</div>
```

> 顶部 import 加 `import { PlusIcon } from 'lucide-vue-next'`。按钮 `@click.stop` 避免冒泡触发风险段已有的 `focusRisk`。`addBtnTop` 用 `containerRef` 内容坐标——按钮与 `containerRef` 同处一个 `relative` 容器，但按钮在滚动区之外，需把 `addBtnTop` 减去 `containerRef.value.scrollTop`：在 Step 2 的 `onContainerMouseOver` 末尾改为 `addBtnTop.value = para.offsetTop - containerRef.value.scrollTop`，并加容器 `scroll` 监听同步刷新（`containerRef.value.addEventListener('scroll', ...)` 在 `onMounted` 挂、`onBeforeUnmount` 解，scroll 时重算 `addBtnTop`）。

- [ ] **Step 4: 浏览器验证**

启动 `bun dev`，打开一个已完成的合同审查详情页：hover 正文段落 → 段落左侧出现「＋」；hover 表格内段落 → 不出现「＋」。用 chrome-devtools 截图确认。

- [ ] **Step 5: 提交**

```bash
git add app/components/assistant/contract/ContractDocxPreview.vue
git commit -m "feat(contract): 合同预览段落 hover 显示新增风险按钮"
```

---

## Task 7: `RiskEditDialog` 新增模式改造

**Files:**
- Modify: `app/components/assistant/contract/RiskEditDialog.vue`

新增模式：接收预填 `clauseText`+`clauseParagraphIndex`；原文条款只读；去掉「法律风险」字段。

- [ ] **Step 1: 扩展 props**

`defineProps` 增加预填字段：

```typescript
const props = defineProps<{
    open: boolean
    risk: Risk | null
    /** 新增模式下由预览段落预填的原文与段落序号 */
    prefill?: { clauseText: string; clauseParagraphIndex: number } | null
}>()
```

- [ ] **Step 2: FormState 去掉 risk 字段，emptyForm/fromRisk 用预填**

`FormState` 接口删除 `risk: string` 一行。`emptyForm` 删除 `risk: ''`。`fromRisk` 删除 `risk: r.risk`。新增模式初始化用 prefill：

```typescript
const emptyForm = (): FormState => ({
    clauseIndex: props.prefill?.clauseParagraphIndex ?? 0,
    clauseText: props.prefill?.clauseText ?? '',
    level: 'medium', category: '', problem: '',
    legalBasis: '', analysis: '', suggestion: '', suggestedClauseText: '',
})
```

`watch(() => props.open, ...)` 内重置逻辑不变（`props.risk ? fromRisk : emptyForm`）。

- [ ] **Step 3: handleConfirm 去掉 risk 字段**

`emit('confirm', {...})` 的对象里删除 `risk: f.risk` 一行。

> 注意：`Risk` 类型仍有 `risk: string` 必填字段。新增走的是 Task 9 的新接口路径、不构造完整 `Risk`，此处 `confirm` 仅供编辑模式沿用；编辑模式的 `risk` 字段从 `...(props.risk ?? {})` 透传原值，不受影响。

- [ ] **Step 4: 模板——去掉法律风险输入框、原文条款新增模式只读**

`textFields` 配置数组删除 `{ key: 'risk', label: '法律风险', ... }` 一项。

「原文条款」从 `textFields` 中独立出来，新增模式只读展示。把 `textFields` 里 `clauseText` 一项移除，在模板风险级别之后单独渲染：

```html
<div class="space-y-1">
    <Label for="risk-clause-text">原文条款</Label>
    <div
        v-if="risk === null"
        id="risk-clause-text"
        class="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap"
    >{{ form.clauseText }}</div>
    <Textarea
        v-else
        id="risk-clause-text"
        v-model="form.clauseText"
        :rows="3"
    />
</div>
```

- [ ] **Step 5: 类型检查 + 浏览器验证**

Run: `bun run typecheck`（确认 RiskEditDialog 无新增错误）
浏览器：编辑模式弹框正常（原文可编辑、无法律风险字段、无条款序号）。新增模式在 Task 9 串接后验证。

- [ ] **Step 6: 提交**

```bash
git add app/components/assistant/contract/RiskEditDialog.vue
git commit -m "feat(contract): 新增风险弹框支持预填、原文只读、移除法律风险字段"
```

---

## Task 8: `RiskListPanel` 调整

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`

移除顶部「新增风险」按钮 + `openCreate`；`mainRisks` 排序键改 `clauseParagraphIndex`；暴露「外部触发新增」入口供 `ContractReviewPanel` 用预填打开 `RiskEditDialog`。

- [ ] **Step 1: 移除顶部新增按钮**

删除模板中顶部操作行的「新增风险」`<Button @click="openCreate">...新增风险</Button>`（约在 `RiskListPanel.vue:363`，含 `PlusIcon` 的那个按钮）。

- [ ] **Step 2: 删除 openCreate**

删除 `function openCreate()`（约 146-150 行）。`PlusIcon` 若不再被其它处使用，从 `lucide-vue-next` import 移除。

- [ ] **Step 3: mainRisks 排序键改 clauseParagraphIndex**

`mainRisks` computed（约 238-244 行）的两处 `.sort((a, b) => a.clauseIndex - b.clauseIndex)` 改为：

```typescript
const sortKey = (r: RiskDisplayPhaseB) => r.clauseParagraphIndex ?? Number.MAX_SAFE_INTEGER
// ...
const unarchived = all.filter(r => !getArchivedStatus(r)).sort((a, b) => sortKey(a) - sortKey(b))
const archived = all.filter(r => !!getArchivedStatus(r)).sort((a, b) => sortKey(a) - sortKey(b))
```

`externalNewRisks` / `orphanedRisks` 两处不动（保持 `clauseIndex`）。

- [ ] **Step 4: 暴露外部触发新增的方法**

`RiskEditDialog` 的预填 props 由新增的本地 ref 提供。增加：

```typescript
const createPrefill = ref<{ clauseText: string; clauseParagraphIndex: number } | null>(null)

/** 由父组件（预览 hover「＋」）调用：以预填打开新增弹框 */
function openCreateWithPrefill(payload: { clauseText: string; clauseParagraphIndex: number }) {
    if (!editable.value) return
    editingRisk.value = null
    createPrefill.value = payload
    editDialogOpen.value = true
}
defineExpose({ openCreateWithPrefill })
```

`RiskEditDialog` 挂载处（约 697 行）传 `:prefill`：

```html
<AssistantContractRiskEditDialog
    v-model:open="editDialogOpen"
    :risk="editingRisk"
    :prefill="createPrefill"
    @confirm="handleEditConfirm"
/>
```

- [ ] **Step 5: handleEditConfirm 区分新增/编辑**

`handleEditConfirm`（约 156-162 行）当前对新增/编辑都 emit `editRisks`。改为：编辑走原 `editRisks`；新增（`createPrefill` 非空）走新事件 `createRisk`。

```typescript
const emit = defineEmits<{
    // ...现有 emits...
    createRisk: [payload: { clauseText: string; clauseParagraphIndex: number; risk: Risk }]
}>()

function handleEditConfirm(payload: Risk) {
    const idx = props.risks.findIndex(r => r.id === payload.id)
    if (idx < 0 && createPrefill.value) {
        emit('createRisk', { ...createPrefill.value, risk: payload })
        createPrefill.value = null
        return
    }
    const newRisks = props.risks.map(r => (r.id === payload.id ? payload : r))
    emit('editRisks', newRisks)
}
```

- [ ] **Step 6: 类型检查**

Run: `bun run typecheck`
Expected: RiskListPanel 无新增错误。

- [ ] **Step 7: 提交**

```bash
git add app/components/assistant/contract/RiskListPanel.vue
git commit -m "feat(contract): RiskListPanel 移除顶部新增按钮、排序改段落口径、暴露预填新增入口"
```

---

## Task 9: 串接（`ContractReviewPanel` + 提交路径）

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

把预览的 `addRiskFromParagraph` 接到 `RiskListPanel.openCreateWithPrefill`；`createRisk` 事件调新接口并刷新 `versioning` 工作区。

- [ ] **Step 1: 给 RiskListPanel 与 DocxPreview 加 ref / 事件**

`ContractReviewPanel.vue` 的两处 `AssistantContractRiskListPanel`（分栏 731 行、窄屏 791 行）各加 `ref` 与 `@create-risk`；两处 `AssistantContractDocxPreview`（701、766 行）各加 `@add-risk-from-paragraph`。因有分栏/窄屏两套，用同一组 handler：

```html
<!-- DocxPreview 两处都加 -->
@add-risk-from-paragraph="handleAddRiskFromParagraph"

<!-- RiskListPanel 两处都加 -->
:ref="setRiskPanelRef"
@create-risk="handleCreateRisk"
```

- [ ] **Step 2: script 加 handler**

```typescript
import { addRiskApi } from '~/composables/contract/useAddRisk' // 见 Step 3

// 分栏/窄屏只有一套同时渲染，用单个 ref 收集当前挂载的 RiskListPanel 实例
const riskPanelRef = ref<{ openCreateWithPrefill: (p: { clauseText: string; clauseParagraphIndex: number }) => void } | null>(null)
function setRiskPanelRef(el: any) {
    if (el) riskPanelRef.value = el
}

function handleAddRiskFromParagraph(payload: { clauseParagraphIndex: number; clauseText: string }) {
    riskPanelRef.value?.openCreateWithPrefill(payload)
}

async function handleCreateRisk(payload: { clauseText: string; clauseParagraphIndex: number; risk: Risk }) {
    if (!reviewId.value) return
    const ok = await addRiskApi(reviewId.value, {
        clauseText: payload.clauseText,
        clauseParagraphIndex: payload.clauseParagraphIndex,
        level: payload.risk.level,
        category: payload.risk.category,
        problem: payload.risk.problem,
        legalBasis: payload.risk.legalBasis ?? null,
        analysis: payload.risk.analysis,
        suggestion: payload.risk.suggestion,
        suggestedClauseText: payload.risk.suggestedClauseText ?? null,
    })
    if (ok) {
        await versioning.refreshWorkspace()
        toast.success('风险已新增')
    } else {
        toast.error('新增风险失败，请稍后重试')
    }
}
```

- [ ] **Step 3: 新增 API 调用 composable**

新建 `app/composables/contract/useAddRisk.ts`：

```typescript
/**
 * 调用 POST /reviews/add-risk/:id 新增单条风险。
 * **Feature: contract-add-risk-hover**
 */
import { useApiFetch } from '~/composables/useApiFetch'

export interface AddRiskBody {
    clauseText: string
    clauseParagraphIndex: number
    level: string
    category: string
    problem: string
    legalBasis: string | null
    analysis: string
    suggestion: string
    suggestedClauseText: string | null
}

export async function addRiskApi(reviewId: number, body: AddRiskBody): Promise<boolean> {
    const resp = await useApiFetch(
        `/api/v1/assistant/contract/reviews/add-risk/${reviewId}`,
        { method: 'POST', body, showError: false },
    )
    return resp != null
}
```

- [ ] **Step 4: 浏览器端到端验证**

`bun dev` → 打开已完成的合同审查 → hover 正文段落点「＋」→ 弹框带入原文（只读）、无条款序号、无法律风险字段 → 填级别/问题/分析/建议/类别（中高需填改写）→ 确认 → 右侧风险清单出现新风险、左侧该段高亮、排序位置正确。用 chrome-devtools 走通。

- [ ] **Step 5: 提交**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue app/composables/contract/useAddRisk.ts
git commit -m "feat(contract): 串接预览 hover 新增风险全链路"
```

---

## Task 10: `RiskSource` 消费点审计 + 全量验证

**Files:**
- 审计（可能 Modify）：对 `RiskSource` 做穷尽分支的消费点

- [ ] **Step 1: 审计 RiskSource 消费点**

`grep -rn "external_new\|global_review\|RiskSource\|\.source" app/ server/ --include='*.ts' --include='*.vue'`，逐一确认对 `source` 做分组/穷尽 switch 的位置（`RiskListPanel` 分组、`OverviewPanel`、导出、`redlineInjector` 等）。`'manual'` 风险应与 `'ai'` 同等对待——落入主风险清单（`source !== 'external_new'` 分支天然成立，确认即可）。若发现穷尽 switch 缺 `'manual'` 分支，补默认分支。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 本需求涉及文件无新增错误。

- [ ] **Step 3: 跑合同模块相关测试**

Run: `npx vitest run tests/server/assistant/contract/ tests/shared/clauseLocator.paragraphIndexOf.test.ts`
Expected: 全部通过（含本计划新增的 3 个测试文件）。

- [ ] **Step 4: simplify 技能审查改动**

对本计划全部改动运行 `simplify` 技能，按反馈修正。

- [ ] **Step 5: 全量测试**

Run: `bun run test`
Expected: 无本次改动引入的失败（项目存在既有并发污染失败，见 `tests/KNOWN_FAILS.md`，逐一核对失败文件确认与本次无关）。

- [ ] **Step 6: 最终提交**

```bash
git add -A
git commit -m "chore(contract): 新增风险 hover 全链路验证与消费点审计"
```

---

## 自审记录

- **Spec 覆盖**：spec §4.1（交互形态 / 可新增范围）→ Task 6；§4.2 前端三组件 → Task 6/7/8/9；§4.3 后端接口 → Task 1/3/4；§4.4 排序 → Task 8 Step 3；§4.5 消费点审计 → Task 10 Step 1；§5 边界（表格排除）→ Task 6 Step 2。
- **数据流补充**：spec §4.2 称「新增后并入 review.risks」——实际前端风险数据由 `versioning` composable 的 `currentView` 驱动，故本计划改为新增成功后调 `versioning.refreshWorkspace()`（Task 9 Step 2）。
- **未迁移审查**：spec §4.3 的「currentVersionId != null」校验 → Task 4 Step 3 接口前置 + Task 4 Step 1 对应测试用例。
