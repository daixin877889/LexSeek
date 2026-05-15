# 合同审查「左侧预览 hover 新增风险」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在合同预览里 hover 段落点「＋」即可新增风险，自动带入段落原文与位置，并补全后端「新增风险」接口让其真正入库。

**Architecture:** 后端新增 `POST /reviews/add-risk/:id` 接口（handler → service → 复用 `createContractRiskDAO`）。前端 `ContractDocxPreview` 用事件委托在正文段落浮出「＋」按钮，点击 emit 段落原文+序号，经 `ContractReviewPanel` 打开 `RiskListPanel` 内的 `RiskEditDialog` 新增模式，确认后调新接口、刷新 `versioning` 工作区。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript；Prisma；Vitest（`npx vitest run`）；docx-preview。

**参照设计文档：** `docs/superpowers/specs/2026-05-15-contract-add-risk-hover-design.md`（已过 5check 审查）。本计划亦已过 5check 审查并据此修订。

**通用约定：**
- 测试一律 `npx vitest run <file>`，禁用 `bun test`。
- 类型检查 `bun run typecheck`（项目存在与本需求无关的既有 typecheck 报错，只需确认本次改动文件无新增错误）。
- 每个任务结束提交一次（conventional commit + 中文，scope=`contract`）。
- 后端涉及 DB 的测试 `import { prisma } from '~~/server/utils/db'`，worker DB 自动隔离。

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
| `app/components/assistant/contract/RiskListPanel.vue` | 改 | 移除顶部新增按钮+`openCreate`；`mainRisks` 排序键改；暴露外部触发新增入口 |
| `app/components/assistant/contract/ContractReviewPanel.vue` | 改 | 串接 `addRiskFromParagraph` → 打开新增弹框 → 调新接口（内联）→ 刷新 |

> 5check 决定：① 不新建 `useAddRisk.ts`——API 调用内联进 `ContractReviewPanel`，与 `useContractReviewRisksEditing` 内联 `useApiFetch` 的既有做法一致。② `useContractReviewRisksEditing.ts` 经核查无需改动——新增/编辑分流在 `RiskListPanel` + `ContractReviewPanel` 完成，编辑路径不变。

---

## Task 1: 扩展 `CreateContractRiskInput` 支持 `suggestedClauseText`

**Files:**
- Modify: `server/agents/contract/contractRisk.dao.ts:12-31`

`contractRisks` 表已有 `suggestedClauseText` 列（`contractRiskAndAnnotation.prisma:20`），但 `CreateContractRiskInput` 未暴露它。

- [ ] **Step 1: 修改接口**

在 `CreateContractRiskInput` 的 `suggestion?: string | null` 之后加一行：

```typescript
    suggestion?: string | null
    /** AI 生成 / 律师填写的完整改写后条款（high/medium 必有；low 可空） */
    suggestedClauseText?: string | null
    /** 完整条款原文（NOT NULL） */
    clauseText: string
```

`createContractRiskDAO` 把 `input` 透传给 `prisma.contractRisks.create({ data: input })`，无需改实现。

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 该文件无新增错误。

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

`RiskSource` 由 `typeof RISK_SOURCES[number]` 派生，自动含 `'manual'`。

- [ ] **Step 2: 改 prisma 注释（仅注释，非迁移）**

`prisma/models/contractRiskAndAnnotation.prisma` 第 5 行：

```prisma
  /// 来源：ai（首次审查）/ external_new（客户回传新增）/ global_review（全局复核）/ manual（律师手动新增）
  source     String @db.VarChar(20)
```

`source` 是无约束 `VarChar(20)`，不需 `prisma migrate`。

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

字段映射口径参照同文件 `persistAiRisksAsContractRows`。

> 注：`contractRisk.service.ts` 顶部已 import `contractRisks` / `RiskLevel` / `DEFAULT_AI_RISK_STANCE`；第 12 行现有 `import { updateContractRiskDAO } from './contractRisk.dao'`——把 `createContractRiskDAO` **合并进该行**，不要新写一行 import（避免 ESLint no-duplicate-imports）：`import { updateContractRiskDAO, createContractRiskDAO } from './contractRisk.dao'`。

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
            // originalFileId 是 NOT NULL 无默认列，传任意整数（无 FK 约束）
            data: { userId: user.id, sessionId: `s-${Date.now()}`, status: 'completed', originalFileId: 1 },
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

先把 `contractRisk.service.ts:12` 的 import 改为 `import { updateContractRiskDAO, createContractRiskDAO } from './contractRisk.dao'`。然后在文件末尾追加：

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

handler 模式照搬 `reviews/add-annotation/[id].post.ts`（`loadOwnedReview` + zod + service）。

- [ ] **Step 1: 写失败测试**

新建 `tests/server/assistant/contract/addRisk.api.test.ts`。测试范式照搬同目录 `contractPlaybookAdmin.api.test.ts`——真实 worker DB + `globalThis` stub h3 自动导入函数（含 `readBody`）+ `await import` handler：

```typescript
/**
 * POST /reviews/add-risk/:id 接口测试
 * **Feature: contract-add-risk-hover**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { prisma } from '~~/server/utils/db'

// ===== globalThis stub（Nuxt nitro 自动导入），必须在 import handler 之前 =====
;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).getRouterParam = (e: any, key: string) => e.__params?.[key]
;(globalThis as any).readBody = async (e: any) => e.__body ?? {}
;(globalThis as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

const { default: handler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/add-risk/[id].post'
)

function makeEvent(opts: { userId: number; reviewId: number | string; body: unknown }) {
    return {
        context: { auth: { user: { id: opts.userId, name: '测试律师' } } },
        __params: { id: String(opts.reviewId) },
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

    async function seedUser(): Promise<number> {
        const u = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`, password: 'x' },
        })
        created.users.push(u.id)
        return u.id
    }

    async function seedReview(userId: number, status: string, currentVersionId: number | null): Promise<number> {
        const r = await prisma.contractReviews.create({
            // originalFileId 是 NOT NULL 无默认列，传任意整数
            data: { userId, sessionId: `s-${Date.now()}-${Math.random()}`, status, currentVersionId, originalFileId: 1 },
        })
        created.reviews.push(r.id)
        return r.id
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

    it('completed + 已迁移：成功新增 manual 风险', async () => {
        const userId = await seedUser()
        const reviewId = await seedReview(userId, 'completed', 1)
        const res: any = await handler(makeEvent({ userId, reviewId, body: validBody }))
        expect(res.code).toBe(0)
        const rows = await prisma.contractRisks.findMany({ where: { reviewId } })
        expect(rows).toHaveLength(1)
        expect(rows[0]!.source).toBe('manual')
    })

    it('未迁移审查（currentVersionId=null）：拒绝，不入库', async () => {
        const userId = await seedUser()
        const reviewId = await seedReview(userId, 'completed', null)
        const res: any = await handler(makeEvent({ userId, reviewId, body: validBody }))
        expect(res.code).not.toBe(0)
        expect(await prisma.contractRisks.count({ where: { reviewId } })).toBe(0)
    })

    it('非 completed 审查：拒绝', async () => {
        const userId = await seedUser()
        const reviewId = await seedReview(userId, 'reviewing', 1)
        const res: any = await handler(makeEvent({ userId, reviewId, body: validBody }))
        expect(res.code).not.toBe(0)
    })

    it('他人审查：owner-only 校验拒绝', async () => {
        const ownerId = await seedUser()
        const reviewId = await seedReview(ownerId, 'completed', 1)
        const otherId = await seedUser()
        const res: any = await handler(makeEvent({ userId: otherId, reviewId, body: validBody }))
        expect(res.code).not.toBe(0)
        expect(await prisma.contractRisks.count({ where: { reviewId } })).toBe(0)
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/server/assistant/contract/addRisk.api.test.ts`
Expected: FAIL —— 接口文件不存在（`await import` 报模块找不到）。

- [ ] **Step 3: 实现接口**

新建 `server/api/v1/assistant/contract/reviews/add-risk/[id].post.ts`：

```typescript
/**
 * POST /api/v1/assistant/contract/reviews/add-risk/:id
 *
 * 律师在合同预览中针对某段落手动新增一条风险。
 * 请求体：风险内容字段 + clauseText（段落原文）+ clauseParagraphIndex（段落序号）。
 * 前置：审查归属当前用户、status=completed、currentVersionId 非空（已迁移）。
 *
 * 错误码：400 参数 / 401 未登录 / 403 无权 / 404 不存在 / 409 状态不允许
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

    // 前端不消费返回的风险体（成功后走 versioning.refreshWorkspace 重拉），返回原始行即可
    return resSuccess(event, '新增成功', risk)
})
```

> `loadOwnedReview` → `getContractReviewDAO` 用无 `select` 的 `findFirst`，返回完整 `contractReviews` 行，`review.currentVersionId` 直接可用，无需改 `reviewGuard.ts`。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/server/assistant/contract/addRisk.api.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add server/api/v1/assistant/contract/reviews/add-risk/ tests/server/assistant/contract/addRisk.api.test.ts
git commit -m "feat(contract): 新增 POST add-risk 手动新增风险接口"
```

---

## Task 5: `clauseLocator` 段落序号反查函数

**Files:**
- Modify: `shared/utils/clauseLocator.ts`
- Test: `tests/shared/utils/clauseLocator.paragraphIndexOf.test.ts`

新增 element→index 反查函数。

> **口径决策（5check）：** `clauseParagraphIndex` 要落库，必须与 AI 风险落库口径一致——后端 `buildClauseToParagraphMap` / `collectNonEmptyParagraphs` 只数 `w:body` 直接子级段落、不进表格/脚注。docx-preview 渲染后 `w:body` 对应 `section.docx`。因此反查函数**只数 `section.docx` 直接子级 `<p>`**，而非复用 `findByParagraphIndex` 的 `querySelectorAll(PARA_BLOCK_SELECTOR)`（后者递归会数进表格/脚注，是前端定位口径）。含表格合同里前端定位口径与后端不一致属项目既有隐患，本需求让手动风险与 AI 风险口径一致、不扩大该隐患。

- [ ] **Step 1: 写失败测试**

新建 `tests/shared/utils/clauseLocator.paragraphIndexOf.test.ts`（与现有 `tests/shared/utils/clauseLocator.test.ts` 同目录、同 DOM 构造方式——用全局 `DOMParser`，项目未装 jsdom）：

```typescript
/**
 * paragraphIndexOfElement 测试
 * **Feature: contract-add-risk-hover**
 */
import { describe, it, expect } from 'vitest'
import { paragraphIndexOfElement } from '#shared/utils/clauseLocator'

function parse(html: string): HTMLElement {
    return new DOMParser().parseFromString(html, 'text/html').body
}

describe('paragraphIndexOfElement', () => {
    it('只数 section.docx 直接子级非空 <p>，返回 0-based 序号', () => {
        const body = parse(`<div class="docx-wrapper"><section class="docx">
            <p>第一段</p>
            <p>   </p>
            <p>第二段</p>
            <table><tbody><tr><td><p>表格内段落</p></td></tr></tbody></table>
            <p>第三段</p>
        </section></div>`)
        const section = body.querySelector('section.docx')!
        const ps = section.querySelectorAll(':scope > p')   // 直接子级 p
        expect(paragraphIndexOfElement(body, ps[0]!)).toBe(0)  // 第一段
        expect(paragraphIndexOfElement(body, ps[1]!)).toBe(-1) // 空段不计入
        expect(paragraphIndexOfElement(body, ps[2]!)).toBe(1)  // 第二段
        expect(paragraphIndexOfElement(body, ps[3]!)).toBe(2)  // 第三段（表格内 p 不占序号）
        const tdP = body.querySelector('td p')!
        expect(paragraphIndexOfElement(body, tdP)).toBe(-1)    // 表格内段落不在序号体系
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run tests/shared/utils/clauseLocator.paragraphIndexOf.test.ts`
Expected: FAIL —— `paragraphIndexOfElement` 未导出。

- [ ] **Step 3: 实现反查函数**

在 `shared/utils/clauseLocator.ts` 的 `findByParagraphIndex` 之后追加：

```typescript
/**
 * 取元素在「合同正文段落」序列中的 0-based 序号，供手动新增风险落库 clauseParagraphIndex。
 *
 * 口径对齐后端 buildClauseToParagraphMap（w:body 直接子级段落）——只统计
 * docx-preview 渲染出的 section.docx 的直接子级 <p>（非空）；表格 td 内、
 * 脚注内的段落不在该序号体系内，返回 -1。
 */
export function paragraphIndexOfElement(container: Element, target: Element): number {
    const section = container.querySelector('section.docx') ?? container
    let count = 0
    for (const el of Array.from(section.children)) {
        if (el.tagName !== 'P') continue
        if ((el.textContent ?? '').trim().length === 0) continue
        if (el === target) return count
        count++
    }
    return -1
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run tests/shared/utils/clauseLocator.paragraphIndexOf.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add shared/utils/clauseLocator.ts tests/shared/utils/clauseLocator.paragraphIndexOf.test.ts
git commit -m "feat(contract): clauseLocator 增加段落序号反查"
```

---

## Task 6: `ContractDocxPreview` hover「＋」按钮

**Files:**
- Modify: `app/components/assistant/contract/ContractDocxPreview.vue`

在 `containerRef` 上事件委托：`mouseover` 命中 `section.docx` 直接子级非空 `<p>`（排除表格 td 内段落）时，把单个浮动「＋」按钮定位到该段左侧；点「＋」emit `addRiskFromParagraph`。

- [ ] **Step 1: 加 emit 声明 + import**

文件顶部 import 追加 `import { PlusIcon } from 'lucide-vue-next'`；确认已 import `paragraphIndexOfElement`（在现有 `locateClauseElement` 的 import 行补：`import { locateClauseElement, paragraphIndexOfElement } from '#shared/utils/clauseLocator'`）。

`defineEmits`（现 46-50 行）追加一项：

```typescript
const emit = defineEmits<{
    focusRisk: [riskId: string]
    hoverClause: [riskId: string | null]
    locateResult: [notLocatedIds: Set<string>]
    addRiskFromParagraph: [payload: { clauseParagraphIndex: number, clauseText: string }]
}>()
```

- [ ] **Step 2: 加状态、逻辑与滚动监听（最终形态）**

`<script setup>` 内 `containerRef` 声明之后追加：

```typescript
// hover 新增风险：当前 hover 的正文段落 + 浮动「＋」位置
const hoveredParagraph = ref<HTMLElement | null>(null)
const addBtnTop = ref(0)

/** 可新增段落：section.docx 直接子级、非空 <p>，排除表格内段落 */
function isAddableParagraph(el: Element | null): el is HTMLElement {
    if (!el || !(el instanceof HTMLElement) || el.tagName !== 'P') return false
    if ((el.textContent ?? '').trim().length === 0) return false
    if (el.closest('td')) return false
    if (!el.parentElement?.classList.contains('docx')) return false
    return true
}

function syncAddBtnTop() {
    const para = hoveredParagraph.value
    const c = containerRef.value
    if (!para || !c) return
    addBtnTop.value = para.offsetTop - c.scrollTop
}

function onContainerMouseOver(e: MouseEvent) {
    const para = (e.target as HTMLElement | null)?.closest('p') ?? null
    if (!isAddableParagraph(para)) {
        hoveredParagraph.value = null
        return
    }
    hoveredParagraph.value = para
    syncAddBtnTop()
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

onMounted(() => containerRef.value?.addEventListener('scroll', syncAddBtnTop))
onBeforeUnmount(() => containerRef.value?.removeEventListener('scroll', syncAddBtnTop))
```

> `containerRef` 跨 docx 重渲染（`loadDocx` 的 `innerHTML=''`）始终存在，委托监听器与 scroll 监听器不会失效。

- [ ] **Step 3: 模板——事件委托 + 浮动按钮**

把 `containerRef` 的 `<div>` 包一层 `relative` 容器并加 `mouseover` 监听 + 浮动按钮（参照文件现有 template 结构，`containerRef` 那个 div 现含 `docx-preview-container` class）：

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
        class="absolute left-3 z-20 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow hover:scale-110 transition"
        :style="{ top: addBtnTop + 'px' }"
        title="在此段落新增风险"
        @click.stop="onAddBtnClick"
    >
        <PlusIcon class="size-3" />
    </button>
</div>
```

> `@click.stop` 避免冒泡触发风险段已有的 `focusRisk`。class 用 `text-primary-foreground`（与 `bg-primary` 配对的主题 token）。

- [ ] **Step 4: 浏览器验证**

`bun dev`，打开一个已完成的合同审查详情页：hover 正文段落 → 段左侧出现「＋」且随滚动跟随；hover 表格内段落 → 不出现「＋」。chrome-devtools 截图确认。

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

- [ ] **Step 2: FormState 去掉 risk，emptyForm/fromRisk 调整**

`FormState` 接口删除 `risk: string` 行。`emptyForm` 改为：

```typescript
const emptyForm = (): FormState => ({
    clauseIndex: props.prefill?.clauseParagraphIndex ?? 0,
    clauseText: props.prefill?.clauseText ?? '',
    level: 'medium', category: '', problem: '',
    legalBasis: '', analysis: '', suggestion: '', suggestedClauseText: '',
})
```

`fromRisk` 删除 `risk: r.risk` 行。

- [ ] **Step 3: 删 canSubmit 里的 risk 校验**

`canSubmit`（约第 60 行）当前含 `!f.risk.trim()`。把 `risk` 从该校验链删除——例如原 `if (!f.problem.trim() || !f.analysis.trim() || !f.risk.trim() || !f.suggestion.trim()) return false` 改为 `if (!f.problem.trim() || !f.analysis.trim() || !f.suggestion.trim()) return false`。

- [ ] **Step 4: handleConfirm 去掉 risk，但保持 Risk 类型兼容**

`emit('confirm', {...})` 的对象——删除 `risk: f.risk` 行，改为从原 risk 透传以满足 `Risk.risk` 必填类型：

```typescript
    emit('confirm', {
        ...(props.risk ?? {}),
        id: props.risk?.id ?? crypto.randomUUID(),
        // ...其余字段不变...
        risk: props.risk?.risk ?? '',   // Risk.risk 是必填字段；新增模式无此输入，透传原值或空串
        // ...
    })
```

> 新增模式提交不走 `confirm`-`Risk` 这条路径承载落库（落库走 Task 9 的新接口），但 `confirm` 事件签名是 `[payload: Risk]`、`Risk.risk` 必填，故须显式给 `risk` 以通过 typecheck。

- [ ] **Step 5: 模板——去法律风险输入框、原文条款新增模式只读**

`textFields` 配置数组删除 `{ key: 'risk', label: '法律风险', ... }` 整项；同时把 `clauseText` 那项也从 `textFields` 移除（改为下面单独渲染）。在「风险级别」之后单独渲染原文条款：

```html
<div class="space-y-1">
    <Label for="risk-clause-text">原文条款</Label>
    <div
        v-if="risk === null"
        id="risk-clause-text"
        class="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap"
    >{{ form.clauseText }}</div>
    <Textarea v-else id="risk-clause-text" v-model="form.clauseText" :rows="3" />
</div>
```

- [ ] **Step 6: 类型检查 + 浏览器验证**

Run: `bun run typecheck`（确认 RiskEditDialog 无新增错误）
浏览器：编辑模式弹框正常（原文可编辑、无法律风险字段、无条款序号）。新增模式在 Task 9 串接后验证。

- [ ] **Step 7: 提交**

```bash
git add app/components/assistant/contract/RiskEditDialog.vue
git commit -m "feat(contract): 新增风险弹框支持预填、原文只读、移除法律风险字段"
```

---

## Task 8: `RiskListPanel` 调整

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`

- [ ] **Step 1: 移除顶部新增按钮，清理空 wrapper**

删除模板顶部操作行的「新增风险」`<Button @click="openCreate">`（约 363-365 行，含 `PlusIcon`）。删除后其外层 `<div class="flex items-center gap-2">`（约 362 行）只剩条件渲染的「隐藏已处置」开关——若该 wrapper 删除按钮后无其它常驻子元素，连同 wrapper 一起删（把开关直接挂到上层），避免遗留空 flex 容器。`PlusIcon` 若不再被其它处引用，从 `lucide-vue-next` import 移除。

- [ ] **Step 2: 删除 openCreate**

删除 `function openCreate()`（约 146-150 行）。

- [ ] **Step 3: mainRisks 排序键改 clauseParagraphIndex**

`mainRisks` computed（约 238-244 行）两处 `.sort((a, b) => a.clauseIndex - b.clauseIndex)` 改为按 `clauseParagraphIndex`（可空、null 排末尾）：

```typescript
const mainSortKey = (r: RiskDisplayPhaseB) => r.clauseParagraphIndex ?? Number.MAX_SAFE_INTEGER
// 两处 sort 改为：
const unarchived = all.filter(r => !getArchivedStatus(r)).sort((a, b) => mainSortKey(a) - mainSortKey(b))
const archived = all.filter(r => !!getArchivedStatus(r)).sort((a, b) => mainSortKey(a) - mainSortKey(b))
```

`externalNewRisks` / `orphanedRisks` 两个 computed 不动（保持 `clauseIndex`）。

- [ ] **Step 4: 暴露外部触发新增的方法 + 预填**

`<script setup>` 增加：

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

`RiskEditDialog` 挂载处（约 697 行）加 `:prefill`：

```html
<AssistantContractRiskEditDialog
    v-model:open="editDialogOpen"
    :risk="editingRisk"
    :prefill="createPrefill"
    @confirm="handleEditConfirm"
/>
```

- [ ] **Step 5: handleEditConfirm 区分新增/编辑**

`defineEmits` 增加 `createRisk`：

```typescript
const emit = defineEmits<{
    // ...现有 emits...
    createRisk: [payload: { clauseText: string; clauseParagraphIndex: number; risk: Risk }]
}>()
```

`handleEditConfirm`（约 156-162 行）改为：

```typescript
function handleEditConfirm(payload: Risk) {
    if (createPrefill.value && !props.risks.some(r => r.id === payload.id)) {
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

## Task 9: 串接（`ContractReviewPanel`）

**Files:**
- Modify: `app/components/assistant/contract/ContractReviewPanel.vue`

把预览的 `addRiskFromParagraph` 接到 `RiskListPanel.openCreateWithPrefill`；`createRisk` 事件内联调新接口并刷新 `versioning` 工作区。

- [ ] **Step 1: script 加 ref 与 handler**

`<script setup>` 内追加（`useApiFetch` / `toast` / `Risk` / `versioning` / `reviewId` 文件中均已引入）：

```typescript
// 分栏(isSplit)/窄屏 v-if/v-else 互斥，同一时刻只渲染一个 RiskListPanel；
// 函数式 ref + if(el) 守卫确保 riskPanelRef 始终指向当前挂载实例（离场实例回调传 null 被忽略）。
const riskPanelRef = ref<{ openCreateWithPrefill: (p: { clauseText: string; clauseParagraphIndex: number }) => void } | null>(null)
function setRiskPanelRef(el: any) {
    if (el) riskPanelRef.value = el
}

function handleAddRiskFromParagraph(payload: { clauseParagraphIndex: number; clauseText: string }) {
    riskPanelRef.value?.openCreateWithPrefill(payload)
}

async function handleCreateRisk(payload: { clauseText: string; clauseParagraphIndex: number; risk: Risk }) {
    if (!reviewId.value) return
    const r = payload.risk
    const resp = await useApiFetch(
        `/api/v1/assistant/contract/reviews/add-risk/${reviewId.value}`,
        {
            method: 'POST',
            body: {
                clauseText: payload.clauseText,
                clauseParagraphIndex: payload.clauseParagraphIndex,
                level: r.level,
                category: r.category,
                problem: r.problem,
                legalBasis: r.legalBasis ?? null,
                analysis: r.analysis,
                suggestion: r.suggestion,
                suggestedClauseText: r.suggestedClauseText ?? null,
            },
            showError: false,
        },
    )
    if (resp != null) {
        await versioning.refreshWorkspace()
        toast.success('风险已新增')
    } else {
        toast.error('新增风险失败，请稍后重试')
    }
}
```

- [ ] **Step 2: 模板——两处 DocxPreview / RiskListPanel 各加事件与 ref**

分栏（约 701 行）与窄屏（约 766 行）两处 `AssistantContractDocxPreview` 各加：

```html
@add-risk-from-paragraph="handleAddRiskFromParagraph"
```

分栏（约 731 行）与窄屏（约 791 行）两处 `AssistantContractRiskListPanel` 各加：

```html
:ref="setRiskPanelRef"
@create-risk="handleCreateRisk"
```

- [ ] **Step 3: 浏览器端到端验证**

`bun dev` → 打开已完成的合同审查 → hover 正文段落点「＋」→ 弹框带入原文（只读）、无条款序号、无法律风险字段 → 填级别/问题/分析/建议/类别（中高需填改写）→ 确认 → 右侧风险清单出现新风险、左侧该段高亮、排序位置正确。chrome-devtools 走通。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "feat(contract): 串接预览 hover 新增风险全链路"
```

---

## Task 10: `RiskSource` 消费点审计 + 全量验证

- [ ] **Step 1: 审计 RiskSource 消费点**

`grep -rn "external_new\|global_review\|\.source" app/ server/ --include='*.ts' --include='*.vue'`，逐一确认对 `source` 做分组 / 穷尽 switch 的位置（`RiskListPanel` 分组、`OverviewPanel`、导出、`redlineInjector` 等）。`'manual'` 风险应与 `'ai'` 同等——落入主风险清单（`source !== 'external_new'` 分支天然成立）。若有穷尽 switch 缺 `'manual'` 分支，补默认分支。

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: 本需求涉及文件无新增错误。

- [ ] **Step 3: 跑合同模块相关测试**

Run: `npx vitest run tests/server/assistant/contract/ tests/shared/utils/clauseLocator.paragraphIndexOf.test.ts`
Expected: 全部通过（含本计划新增的 3 个测试文件）。

- [ ] **Step 4: simplify 技能审查改动**

对本计划全部改动运行 `simplify` 技能，按反馈修正。

- [ ] **Step 5: 全量测试**

Run: `bun run test`
Expected: 无本次引入的失败（项目存在既有并发污染失败，见 `tests/KNOWN_FAILS.md`，逐一核对失败文件确认与本次无关）。

- [ ] **Step 6: 最终提交**

```bash
git add -A
git commit -m "chore(contract): 新增风险 hover 全链路验证与消费点审计"
```

---

## 自审记录

- **Spec 覆盖**：设计文档 §4.1（交互形态/可新增范围）→ Task 6；§4.2 前端三组件 → Task 6/7/8/9；§4.3 后端接口 → Task 1/3/4；§4.4 排序 → Task 8 Step 3；§4.5 消费点审计 → Task 10 Step 1；§5 边界 → Task 6 Step 2。
- **数据流**：设计 §4.2 称「新增后并入 `review.risks`」——实际前端风险数据由 `versioning.currentView` 驱动，故新增成功后调 `versioning.refreshWorkspace()`（Task 9 Step 1）。
- **`useContractReviewRisksEditing.ts`**：设计 §7 曾点名要改它做新增/编辑分流。经核查该 composable 仅负责编辑路径的 PATCH，无需改动——新增走独立接口、分流在 `RiskListPanel.handleEditConfirm` + `ContractReviewPanel.handleCreateRisk` 完成，编辑路径完全不变。
- **段落序号口径（5check）**：手动风险 `clauseParagraphIndex` 经 `paragraphIndexOfElement` 按「`section.docx` 直接子级 `<p>`」计算，与后端 `buildClauseToParagraphMap` 同口径、与 AI 风险落库一致。含表格合同里前端定位口径（`findByParagraphIndex` 递归数表格内 p）与后端不一致属项目既有隐患，本需求不引入新的不一致、也不在范围内根治它。
- **未迁移审查**：Task 4 接口前置 `currentVersionId != null` 校验 + 对应测试用例。
