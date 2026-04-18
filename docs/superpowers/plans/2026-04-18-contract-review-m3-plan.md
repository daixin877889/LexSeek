# 合同审查 M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 交付合同审查 AI 闭环——POST 创建审查 → SSE interrupt 等待立场 → POST 立场 → agent 按 responseFormat 产出 risks + 批注 .docx → GET 查询结果。

**Architecture:** 仿 `documentMainAgent.runDocumentChat` 骨架新建 `contractReviewMainAgent.runContractReviewChat`；新增 `parseAndAskStance` 工具（唯一 interrupt 点）+ `reviewResultPersistenceMiddleware`（末位 afterAgent 注入批注并两步写 OSS）。Worker 加 `scope='contract'` 分支。3 个 API：POST `/reviews`、GET `/reviews/:id`、POST `/reviews/:id/stance`。

**Tech Stack:** Nuxt 4 Nitro + LangChain v1 `createAgent` + `responseFormat` + LangGraph `interrupt`/`Command` + Prisma 7 + Vitest + 复用 M2 docx 子模块 + M1 已落地 schema/seed/type。

---

## 前置条件（M1/M2 交付物，勿重复实现）

- ✅ `prisma/models/contractReview.prisma` 已建 + migration `20260418000000_add_contract_reviews` 已应用 + client 已 generate
- ✅ `shared/types/contract.ts`（Risk / Stance / ContractReviewStatus / 请求响应类型）
- ✅ `InterruptType.AWAITING_STANCE` 枚举已加入 `shared/types/case.ts`
- ✅ `MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE = 'reviewResultPersistence'` 常量已加入 `server/services/workflow/middleware/types.ts`
- ⚠️ seedData.sql 已 seed：`contractReviewMain` node、`contractReview_system` 提示词 v1、`contract_review_token` 计费规则；**但 M1 写入的 `tools` 字段值是 `["parseAndAskStance"]`，与项目 `toolModules` 字典的 snake_case key 约定（`search_case_materials` 等）不匹配，本 plan Task 0 修正为 `["parse_and_ask_stance"]`**
- ✅ `server/services/assistant/contract/docx/`（parser / partyDetector / commentInjector / zipRewriter / xmlUtils / index）
- ✅ `server/services/assistant/contract/textToDocx.service.ts`

**M3 不交付：UI（M4）、PATCH（M5）、rebuild-docx（M5）、download（M5）、GET list（M6+）、caseId 列（M6+）**

---

## 覆盖率 & 测试命令

- 目录 `server/services/assistant/contract/` + 新增的 workflow tool/middleware/agent 全部 ≥ 90% 行覆盖
- 全量：`npx vitest run`；单文件：`npx vitest run path/to/test.ts`
- 禁止 `bun test`

---

## 任务总览

| # | 任务 | 产出 | 依赖 |
|---|---|---|---|
| 0 | 修正 M1 seed 错配：`contractReviewMain.tools` 值改为 snake_case | seedData.sql 1 处改动 + 本地 dev DB 同步 SQL | 无 |
| 1 | 接口扩展（promptRenderer / ToolContext） | 2 处扩展 | 无 |
| 2 | `riskSchema.builder.ts` + DAO + Service 骨架 | 3 文件 + 单测 | 1 |
| 3 | `parseAndAskStance.tool.ts` + 工具注册（snake_case key） | 1 文件 + 1 处注册 + 单测 | 2 |
| 4 | `reviewResultPersistence.middleware.ts` + index.ts export | 1 文件 + 单测 | 2 |
| 5 | `contractReviewMainAgent.ts`（`runContractReviewChat`） | 1 文件 + agents/index.ts export + smoke 单测 | 3, 4 |
| 6 | Worker `scope='contract'` 分支 | agentWorker.ts 插入 else-if | 5 |
| 7 | POST `/api/v1/assistant/contract/reviews`（含建 caseSession + 入队） | 1 API 文件 + contractReview.service 完整实现 + 集成测 | 2 |
| 8 | GET `/api/v1/assistant/contract/reviews/:id` | 1 文件 + 集成测 | 2 |
| 9 | POST `/api/v1/assistant/contract/reviews/:id/stance`（含 INTERRUPTED→COMPLETED 释放） | 1 文件 + 集成测 | 6, 7 |
| 10 | 端到端集成测：真实 DB 下的 afterAgent 持久化语义 | 1 测试文件 | 9 |

---

## Task 0：修正 M1 seed 里的工具名错配

**背景**：`server/services/workflow/tools/index.ts:25-36` 的 `toolModules` 字典使用 **snake_case key**（如 `search_case_materials`），`getToolInstancesService(names, ctx)` 按名字精确匹配。M1 seed 写入 `contractReviewMain.tools = '["parseAndAskStance"]'`，加载工具时会 warn `工具 parseAndAskStance 不存在，已跳过`，导致 agent 拿不到工具，只能"干说话"而无法 interrupt。必须改成 `["parse_and_ask_stance"]`。

**Files:**
- Modify: `prisma/seeds/seedData.sql` 第 932 行附近（`contractReviewMain` 行的 `tools` 字段值）
- DB 同步：对已运行的本地开发数据库 (`ls_new`) 与测试库 (`ls_new_testing`) 执行 `UPDATE`

- [ ] **Step 0.1：改 seedData.sql**

把 `INSERT INTO ... nodes ... VALUES ('contractReviewMain', ..., '["parseAndAskStance"]', ...)` 这行的 tools 字面值改为 `'["parse_and_ask_stance"]'`（保留 `ON CONFLICT DO NOTHING`，新库不受影响）。

- [ ] **Step 0.2：对本地 dev 库执行 UPDATE 同步**

```bash
psql 'postgresql://daixin:daixin88@localhost:5432/ls_new' -c \
  "UPDATE public.nodes SET tools = '[\"parse_and_ask_stance\"]'::jsonb WHERE name = 'contractReviewMain';"
psql 'postgresql://daixin:daixin88@localhost:5432/ls_new_testing' -c \
  "UPDATE public.nodes SET tools = '[\"parse_and_ask_stance\"]'::jsonb WHERE name = 'contractReviewMain';"
```

> 若 tools 列 Prisma type 为 TEXT 而非 JSONB，去掉 `::jsonb` 后缀；先 `\d nodes` 确认列类型。

- [ ] **Step 0.3：提交**

```bash
git add prisma/seeds/seedData.sql
git commit -m "fix(contract): M1 seed 工具名改为 snake_case 以匹配 toolModules 约定"
```

---

## Task 1：接口扩展

**Files:**
- Modify: `server/services/workflow/utils/promptRenderer.ts:13-24`（`PromptRenderContext` 接口新增 `reviewId` / `contractType` 两字段）
- Modify: `server/services/workflow/tools/types.ts:36-53`（`ToolContext` 接口新增 `reviewId` 字段）

> `middleware/index.ts` 里添加 `reviewResultPersistenceMiddleware` export 的动作**并入 Task 4**（反正同一次 commit 才能验证），本任务不碰 middleware 目录。

- [ ] **Step 1.1：扩展 PromptRenderContext**

```typescript
// server/services/workflow/utils/promptRenderer.ts:13-24
export interface PromptRenderContext {
    /** 案件 ID */
    caseId?: number
    /** 模块名称（如 case_summary、events_timeline） */
    moduleName?: string
    /** 案件类型 */
    caseType?: string
    /** 文书模板名称 */
    templateName?: string
    /** 文书模板类别 */
    templateCategory?: string
    /** 合同审查 ID（contract scope） */
    reviewId?: number
    /** 合同类型（AI 识别，可能为空） */
    contractType?: string
}
```

- [ ] **Step 1.2：扩展 ToolContext**

```typescript
// server/services/workflow/tools/types.ts:36-53
export interface ToolContext {
    userId: number
    caseId?: number
    sessionId: string
    runId?: string
    draftId?: number
    /** 合同审查 ID（parseAndAskStance 工具依赖） */
    reviewId?: number
}
```

- [ ] **Step 1.3：类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E "promptRenderer|tools/types" | head -20`
Expected: 无新增错误

- [ ] **Step 1.4：提交**

```bash
git add server/services/workflow/utils/promptRenderer.ts server/services/workflow/tools/types.ts
git commit -m "feat(contract): M3 扩展 PromptRenderContext / ToolContext 接口"
```

---

## Task 2：riskSchema.builder + contractReview.dao + contractReview.service（骨架）

**Files:**
- Create: `server/services/assistant/contract/riskSchema.builder.ts`
- Create: `server/services/assistant/contract/contractReview.dao.ts`
- Create: `server/services/assistant/contract/contractReview.service.ts`
- Create: `tests/server/assistant/contract/riskSchema.test.ts`
- Create: `tests/server/assistant/contract/contractReview.dao.test.ts`

### 2.1 riskSchema.builder.ts（纯函数，无 IO）

- [ ] **Step 2.1.1：写失败测 `tests/server/assistant/contract/riskSchema.test.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { buildRiskSchema, RISK_SHAPE } from '~~/server/services/assistant/contract/riskSchema.builder'

describe('buildRiskSchema', () => {
    it('返回 z.object，含 risks 数组 + summary 字符串', () => {
        const schema = buildRiskSchema()
        const parsed = schema.safeParse({
            risks: [],
            summary: '合同整体风险可控',
        })
        expect(parsed.success).toBe(true)
    })

    it('high 级别无 suggestedClauseText 校验失败', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: 'r1',
            clauseIndex: 0,
            clauseText: '原文',
            level: 'high',
            category: '付款',
            problem: '逾期未约定',
            analysis: '...',
            risk: '...',
            suggestion: '...',
        })
        expect(parsed.success).toBe(false)
        if (!parsed.success) {
            expect(parsed.error.issues[0].message).toContain('suggestedClauseText')
        }
    })

    it('medium 级别无 suggestedClauseText 校验失败', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: 'r2', clauseIndex: 1, clauseText: '原文', level: 'medium',
            category: '付款', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
        })
        expect(parsed.success).toBe(false)
    })

    it('low 级别无 suggestedClauseText 校验通过', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: 'r3', clauseIndex: 2, clauseText: '原文', level: 'low',
            category: '其他', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
        })
        expect(parsed.success).toBe(true)
    })

    it('high + suggestedClauseText 齐全校验通过', () => {
        const parsed = RISK_SHAPE.safeParse({
            id: 'r4', clauseIndex: 3, clauseText: '原文', level: 'high',
            category: '违约', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
            suggestedClauseText: '重写后的条款',
        })
        expect(parsed.success).toBe(true)
    })
})
```

- [ ] **Step 2.1.2：跑一次确认失败**

Run: `npx vitest run tests/server/assistant/contract/riskSchema.test.ts`
Expected: FAIL（文件不存在）

- [ ] **Step 2.1.3：实现 riskSchema.builder.ts**

```typescript
// server/services/assistant/contract/riskSchema.builder.ts
import { z } from 'zod'

const RISK_LEVEL = ['high', 'medium', 'low'] as const

/**
 * 合同审查专属 Zod schema。
 *
 * - high/medium 级别 Risk 强制 suggestedClauseText（通过 refine）
 * - low 级别可省略（减少 token 消耗）
 * - schema 形状固定，不依赖模板
 */
export const RISK_SHAPE = z.object({
    id: z.string().describe('UUID，前端渲染 key'),
    clauseIndex: z.number().int().nonnegative().describe('段落索引（0-based）'),
    clauseText: z.string().describe('原文段落全文'),
    level: z.enum(RISK_LEVEL).describe('风险级别'),
    category: z.string().describe('付款 / 交付 / 违约 / 保密 / 知识产权 / 争议解决 / 其他'),
    problem: z.string().describe('问题简述'),
    legalBasis: z.string().optional().describe('《民法典》第 XXX 条等'),
    analysis: z.string().describe('条款分析'),
    risk: z.string().describe('对当前立场方的法律风险'),
    suggestion: z.string().describe('修改建议（文字描述）'),
    suggestedClauseText: z.string().optional().describe('AI 重写后的完整条款（high/medium 必填）'),
}).refine(
    r => r.level === 'low' || !!r.suggestedClauseText,
    { message: 'high/medium 级别必须提供 suggestedClauseText', path: ['suggestedClauseText'] },
)

export function buildRiskSchema() {
    return z.object({
        risks: z.array(RISK_SHAPE).describe('风险点清单，按 clauseIndex 升序'),
        summary: z.string().describe('审查摘要 Markdown'),
    })
}
```

- [ ] **Step 2.1.4：测试通过**

Run: `npx vitest run tests/server/assistant/contract/riskSchema.test.ts`
Expected: 5 passed

### 2.2 contractReview.dao.ts

**API 设计**（仅 M3 需要的 CRUD 子集；M5 再补 PATCH 专用 DAO）：

```typescript
createContractReviewDAO(data): Promise<contractReviews>
getContractReviewDAO(id): Promise<contractReviews | null>
findContractReviewBySessionIdDAO(sessionId): Promise<contractReviews | null>
updateContractReviewDAO(id, data): Promise<contractReviews>
```

- [ ] **Step 2.2.1：写失败测 `tests/server/assistant/contract/contractReview.dao.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
    createContractReviewDAO,
    getContractReviewDAO,
    findContractReviewBySessionIdDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { prisma } from '~~/server/utils/prisma'
import { ensureTestUser, cleanupTestData } from '../../test-db-helper'

describe('contractReview DAO', () => {
    let testUserId: number
    const createdIds: number[] = []

    beforeAll(async () => {
        testUserId = await ensureTestUser()
    })

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.contractReviews.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    afterAll(async () => {
        await cleanupTestData()
    })

    it('createContractReviewDAO 可建立 pending 行', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId,
            sessionId: `test-session-${Date.now()}`,
            originalFileId: 0,  // dummy，实际场景建行时由 API 层保证文件归属
            status: 'pending',
        })
        createdIds.push(row.id)
        expect(row.id).toBeGreaterThan(0)
        expect(row.status).toBe('pending')
    })

    it('findContractReviewBySessionIdDAO 对未知 sessionId 返回 null', async () => {
        const row = await findContractReviewBySessionIdDAO('no-such-session-' + Date.now())
        expect(row).toBeNull()
    })

    it('findContractReviewBySessionIdDAO 命中 unique 索引', async () => {
        const sessionId = `test-session-${Date.now()}`
        const created = await createContractReviewDAO({
            userId: testUserId, sessionId, originalFileId: 0, status: 'pending',
        })
        createdIds.push(created.id)
        const found = await findContractReviewBySessionIdDAO(sessionId)
        expect(found?.id).toBe(created.id)
    })

    it('updateContractReviewDAO 可更新 stance + status', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId, sessionId: `test-session-${Date.now()}`,
            originalFileId: 0, status: 'awaiting_stance',
        })
        createdIds.push(row.id)
        const updated = await updateContractReviewDAO(row.id, {
            stance: 'partyA', partyA: '甲', partyB: '乙', status: 'reviewing',
        })
        expect(updated.stance).toBe('partyA')
        expect(updated.status).toBe('reviewing')
    })

    it('getContractReviewDAO 不可见 deletedAt!=null 行', async () => {
        const row = await createContractReviewDAO({
            userId: testUserId, sessionId: `test-session-${Date.now()}`,
            originalFileId: 0, status: 'pending',
        })
        createdIds.push(row.id)
        await prisma.contractReviews.update({
            where: { id: row.id }, data: { deletedAt: new Date() },
        })
        const found = await getContractReviewDAO(row.id)
        expect(found).toBeNull()
    })
})
```

- [ ] **Step 2.2.2：检查 test-db-helper 位置**

Run: `ls tests/server/assistant/ | head` — 若已有 `test-db-helper.ts` 则沿用；否则创建最小实现（复用 `tests/server/storage/test-db-helper.ts` 的 ensureTestUser / cleanupTestData 模式，只留"确保测试用户 + 清理本 describe 产生的数据"两函数，**不复制无关清理代码**）。

- [ ] **Step 2.2.3：实现 `server/services/assistant/contract/contractReview.dao.ts`**

```typescript
/**
 * 合同审查 DAO 层
 *
 * 仅暴露 M3 需要的 CRUD 子集（create / get / findBySessionId / update）。
 * 所有读接口默认过滤 deletedAt IS NULL；如需含软删行请走 prisma 直连。
 */
import { prisma } from '~~/server/utils/prisma'
import type { contractReviews, Prisma } from '~~/generated/prisma/client'

type CreateInput = Omit<Prisma.contractReviewsUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>
type UpdateInput = Prisma.contractReviewsUncheckedUpdateInput

export async function createContractReviewDAO(data: CreateInput): Promise<contractReviews> {
    return prisma.contractReviews.create({ data })
}

export async function getContractReviewDAO(id: number): Promise<contractReviews | null> {
    return prisma.contractReviews.findFirst({
        where: { id, deletedAt: null },
    })
}

export async function findContractReviewBySessionIdDAO(sessionId: string): Promise<contractReviews | null> {
    return prisma.contractReviews.findFirst({
        where: { sessionId, deletedAt: null },
    })
}

export async function updateContractReviewDAO(
    id: number,
    data: UpdateInput,
): Promise<contractReviews> {
    return prisma.contractReviews.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
    })
}
```

- [ ] **Step 2.2.4：测试通过**

Run: `npx vitest run tests/server/assistant/contract/contractReview.dao.test.ts`
Expected: 5 passed

### 2.3 contractReview.service.ts 骨架

**本任务仅搭骨架**（导出 `createAndStartContractReviewService` 桩函数，Task 7 POST 端点完成时补齐真正实现）：

- [ ] **Step 2.3.1：建 `server/services/assistant/contract/contractReview.service.ts`**

```typescript
/**
 * 合同审查 Service 层
 *
 * `createAndStartContractReviewService` 的完整实现由 Task 7 POST /reviews 端点补齐；
 * 本文件先暴露类型占位，避免其他 Task 引用时 TS 报错。
 */
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'

export interface CreateAndStartOptions extends CreateReviewRequest {
    userId: number
}

export type CreateAndStartResult =
    | CreateReviewResponse
    | { error: string; code: number }

// 实际实现在 Task 7 补齐；留 throw 占位防止误调
export async function createAndStartContractReviewService(
    _options: CreateAndStartOptions,
): Promise<CreateAndStartResult> {
    throw new Error('createAndStartContractReviewService: not yet implemented (Task 7)')
}
```

- [ ] **Step 2.3.2：类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E "contract/contractReview|riskSchema" | head -10`
Expected: 无新增错误

- [ ] **Step 2.3.3：提交**

```bash
git add server/services/assistant/contract/riskSchema.builder.ts \
        server/services/assistant/contract/contractReview.dao.ts \
        server/services/assistant/contract/contractReview.service.ts \
        tests/server/assistant/contract/riskSchema.test.ts \
        tests/server/assistant/contract/contractReview.dao.test.ts
git commit -m "feat(contract): M3 新增 riskSchema / DAO / service 骨架"
```

---

## Task 3：parseAndAskStance 工具 + 注册

**Files:**
- Create: `server/services/workflow/tools/parseAndAskStance.tool.ts`
- Modify: `server/services/workflow/tools/index.ts`（在 `toolModules` 字典新增 `parseAndAskStance` 入口）
- Create: `tests/server/workflow/tools/parseAndAskStance.test.ts`

### 3.1 单测（mock mammoth + partyDetector + interrupt）

- [ ] **Step 3.1.1：写失败测**

```typescript
// tests/server/workflow/tools/parseAndAskStance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 外部依赖：DAO / OSS / parser / partyDetector / interrupt
vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    updateContractReviewDAO: vi.fn(),
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
}))
vi.mock('~~/server/services/assistant/contract/docx', () => ({
    parseContractDocx: vi.fn(),
    detectParties: vi.fn(),
}))
vi.mock('@langchain/langgraph', async () => {
    const actual = await vi.importActual<any>('@langchain/langgraph')
    return {
        ...actual,
        interrupt: vi.fn(),
    }
})

import { createTool as parseAndAskStanceCreateTool } from '~~/server/services/workflow/tools/parseAndAskStance.tool'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { downloadFileService } from '~~/server/services/storage/storage.service'
import { parseContractDocx, detectParties } from '~~/server/services/assistant/contract/docx'
import { interrupt } from '@langchain/langgraph'

describe('parseAndAskStance createTool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('成功路径：下载 → 解析 → interrupt → 置 awaiting_stance → 恢复 → 置 reviewing → 返回上下文', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({ id: 1, userId: 7, originalFileId: 99 })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'users/7/a.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('fake'))
        ;(parseContractDocx as any).mockResolvedValueOnce({ paragraphs: ['P0', 'P1'], rawXml: '<xml/>' })
        ;(detectParties as any).mockResolvedValueOnce({
            partyA: '甲', partyB: '乙', contractType: '劳动合同', source: 'regex',
        })
        ;(interrupt as any).mockReturnValueOnce({
            stance: 'partyA', partyA: '甲（编辑后）', partyB: undefined,
        })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const tool = parseAndAskStanceCreateTool({ userId: 7, sessionId: 's1', reviewId: 1 })
        const result: any = await tool.invoke({})

        expect(interrupt).toHaveBeenCalledWith(expect.objectContaining({
            type: 'awaiting_stance', reviewId: 1, partyA: '甲', partyB: '乙', contractType: '劳动合同',
        }))
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(1, 1, {
            contractType: '劳动合同', partyA: '甲', partyB: '乙', status: 'awaiting_stance',
        })
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(2, 1, {
            stance: 'partyA', partyA: '甲（编辑后）', partyB: '乙', status: 'reviewing',
        })
        expect(result.stance).toBe('partyA')
        expect(result.stanceLabel).toBe('甲方')
        expect(result.stanceFocus).toContain('延长付款期限')
        expect(result.paragraphs).toEqual(['P0', 'P1'])
    })

    it('reviewId 缺失 → 抛错', async () => {
        const tool = parseAndAskStanceCreateTool({ userId: 7, sessionId: 's1' })
        await expect(tool.invoke({})).rejects.toThrow(/reviewId 缺失/)
    })

    it('OSS 文件找不到 → 抛错', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({ id: 1, userId: 7, originalFileId: 99 })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce(null)
        const tool = parseAndAskStanceCreateTool({ userId: 7, sessionId: 's1', reviewId: 1 })
        await expect(tool.invoke({})).rejects.toThrow(/OSS file 99 not found/)
    })

    it('用户未编辑甲乙方（resume.partyA/B 为 undefined）→ 继承识别值', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({ id: 1, userId: 7, originalFileId: 99 })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'p' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('x'))
        ;(parseContractDocx as any).mockResolvedValueOnce({ paragraphs: ['a'], rawXml: '<x/>' })
        ;(detectParties as any).mockResolvedValueOnce({
            partyA: '原甲', partyB: '原乙', contractType: null, source: 'llm',
        })
        ;(interrupt as any).mockReturnValueOnce({ stance: 'neutral' })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const tool = parseAndAskStanceCreateTool({ userId: 7, sessionId: 's1', reviewId: 1 })
        const result: any = await tool.invoke({})
        expect(result.partyA).toBe('原甲')
        expect(result.partyB).toBe('原乙')
        expect(result.stance).toBe('neutral')
    })
})
```

- [ ] **Step 3.1.2：跑失败**

Run: `npx vitest run tests/server/workflow/tools/parseAndAskStance.test.ts`
Expected: FAIL

### 3.2 实现工具

- [ ] **Step 3.2.1：实现 `server/services/workflow/tools/parseAndAskStance.tool.ts`**

```typescript
/**
 * parseAndAskStance 工具
 *
 * 合同审查 agent 首轮必调；职责：
 * 1. 下载原 .docx + parser 提取段落 + partyDetector 识别甲乙方
 * 2. 更新 DB 为 awaiting_stance 并 interrupt 等待用户立场
 * 3. 恢复后写回 stance + partyA/B（允许用户修正）→ 置 reviewing
 * 4. 返回 agent 继续审查所需上下文（含 paragraphs）
 */

import { tool } from '@langchain/core/tools'
import { interrupt } from '@langchain/langgraph'
import { z } from 'zod'
import type { ToolContext, ToolDefinition } from './types'
import { InterruptType } from '#shared/types/case'
import type { Stance } from '#shared/types/contract'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { downloadFileService } from '~~/server/services/storage/storage.service'
import {
    parseContractDocx,
    detectParties,
} from '~~/server/services/assistant/contract/docx'

const schema = z.object({})

const STANCE_LABELS: Record<Stance, string> = {
    partyA: '甲方',
    partyB: '乙方',
    neutral: '中立',
}

const STANCE_FOCUS_TABLE: Record<Stance, string> = {
    partyA: '延长付款期限、缩短交付、减少己方违约责任、增加对方违约成本、选择己方管辖地',
    partyB: '缩短付款周期、增加预付款、明确逾期违约金、放宽己方交付期限、减少己方违约责任',
    neutral: '识别所有可能产生歧义或权利义务不对等的条款，不偏向任何一方',
}

/** 工具定义（`ToolModule.toolDefinition`——注册表通过 `import * as` 聚合此模块导出） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'parse_and_ask_stance',
    description:
        '解析合同段落、识别甲乙方与合同类型、通过 interrupt 请求用户立场。返回立场相关的审查上下文。此工具无需任何参数，直接调用即可。一次会话只应调用一次。',
    schema,
}

/** 工具工厂（`ToolModule.createTool`——注册表通过 `import * as` 聚合此模块导出） */
export const createTool = (context: ToolContext) => tool(
    async () => {
        const { reviewId } = context
        if (!reviewId) throw new Error('parseAndAskStance: reviewId 缺失')

        const review = await getContractReviewDAO(reviewId)
        if (!review) throw new Error(`parseAndAskStance: review ${reviewId} not found`)

        const ossFile = await findOssFileByIdDao(review.originalFileId)
        if (!ossFile) throw new Error(`OSS file ${review.originalFileId} not found`)

        const docxBuffer = await downloadFileService(ossFile.filePath)
        const { paragraphs } = await parseContractDocx(docxBuffer)
        const { partyA, partyB, contractType } = await detectParties(paragraphs)

        await updateContractReviewDAO(reviewId, {
            contractType: contractType ?? null,
            partyA: partyA ?? null,
            partyB: partyB ?? null,
            status: 'awaiting_stance',
        })

        const resumed = interrupt({
            type: InterruptType.AWAITING_STANCE,
            reviewId,
            partyA,
            partyB,
            contractType,
        }) as { stance: Stance; partyA?: string; partyB?: string }

        const finalPartyA = resumed.partyA ?? partyA ?? null
        const finalPartyB = resumed.partyB ?? partyB ?? null

        await updateContractReviewDAO(reviewId, {
            stance: resumed.stance,
            partyA: finalPartyA,
            partyB: finalPartyB,
            status: 'reviewing',
        })

        return {
            stance: resumed.stance,
            stanceLabel: STANCE_LABELS[resumed.stance],
            stanceFocus: STANCE_FOCUS_TABLE[resumed.stance],
            partyA: finalPartyA,
            partyB: finalPartyB,
            contractType: contractType ?? null,
            paragraphs,
        }
    },
    toolDefinition,
)
```

> 关键形状对齐：`server/services/workflow/tools/index.ts:13-35` 用 `import * as xxxTool from './xxx.tool'` 聚合，要求每个工具模块导出两个命名符号：`toolDefinition`（包含 name/description/schema）+ `createTool`（(ctx)=>StructuredTool）。**禁止**自创 `parseAndAskStanceModule` 这种命名。

- [ ] **Step 3.2.2：注册到 toolModules**

```typescript
// server/services/workflow/tools/index.ts 顶部追加 import：
import * as parseAndAskStanceTool from './parseAndAskStance.tool'

// toolModules 字典追加一项（注意 snake_case key，与 seed 里 contractReviewMain.tools = '["parse_and_ask_stance"]' 匹配）：
const toolModules: Record<string, ToolModule> = {
    // ...existing entries unchanged...
    parse_and_ask_stance: parseAndAskStanceTool,
}
```

- [ ] **Step 3.2.3：测试通过**

Run: `npx vitest run tests/server/workflow/tools/parseAndAskStance.test.ts`
Expected: 4 passed

- [ ] **Step 3.2.4：提交**

```bash
git add server/services/workflow/tools/parseAndAskStance.tool.ts \
        server/services/workflow/tools/index.ts \
        tests/server/workflow/tools/parseAndAskStance.test.ts
git commit -m "feat(contract): M3 新增 parse_and_ask_stance 工具 + 注册"
```

---

## Task 4：reviewResultPersistence 中间件

**Files:**
- Create: `server/services/workflow/middleware/reviewResultPersistence.middleware.ts`
- Modify: `server/services/workflow/middleware/index.ts`（追加 `export { reviewResultPersistenceMiddleware } from './reviewResultPersistence.middleware'`）
- Create: `tests/server/workflow/middleware/reviewResultPersistence.test.ts`

### 4.1 单测

- [ ] **Step 4.1.1：写失败测**

```typescript
// tests/server/workflow/middleware/reviewResultPersistence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    updateContractReviewDAO: vi.fn(),
}))
vi.mock('~~/server/services/assistant/contract/docx', () => ({
    injectComments: vi.fn(),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
    uploadFileService: vi.fn(),
}))
vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(),
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    createOssFileDao: vi.fn(),
}))

import { reviewResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/reviewResultPersistence.middleware'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { injectComments } from '~~/server/services/assistant/contract/docx'
import {
    downloadFileService,
    uploadFileService,
} from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import {
    findOssFileByIdDao,
    createOssFileDao,
} from '~~/server/services/files/ossFiles.dao'

function getHooks(mw: any) {
    // createMiddleware 返回的对象形状：mw.beforeAgent.hook / mw.afterAgent.hook
    // 若实现差异由工程读取 draftResultPersistence.middleware 的 runtime 形状来适配
    return {
        before: mw.beforeAgent?.hook ?? mw.beforeAgent,
        after: mw.afterAgent?.hook ?? mw.afterAgent,
    }
}

describe('reviewResultPersistenceMiddleware', () => {
    const opts = { reviewId: 42, sessionId: 's1' }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('beforeAgent 置 status=reviewing', async () => {
        const mw = reviewResultPersistenceMiddleware(opts)
        const { before } = getHooks(mw)
        await before({})
        expect(updateContractReviewDAO).toHaveBeenCalledWith(42, { status: 'reviewing' })
    })

    it('afterAgent happy path：写 risks/summary → 注入 → 上传 → 写 ossFile → status=completed', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99,
        })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectComments as any).mockResolvedValueOnce(Buffer.from('reviewed'))
        ;(uploadFileService as any).mockResolvedValueOnce({ name: 'users/7/contract-review/reviewed-42.docx' })
        ;(getDefaultStorageConfigDao as any).mockResolvedValueOnce({ bucket: 'test-bucket' })
        ;(createOssFileDao as any).mockResolvedValueOnce({ id: 200 })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({
            structuredResponse: {
                risks: [{ id: 'r1', clauseIndex: 0, level: 'low' }],
                summary: 'ok',
            },
        })
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(1, 42, {
            risks: [{ id: 'r1', clauseIndex: 0, level: 'low' }],
            summary: 'ok',
        })
        expect(injectComments).toHaveBeenCalled()
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, {
            reviewedFileId: 200, status: 'completed',
        })
    })

    it('structuredResponse 缺失 → status=failed，不调 injectComments', async () => {
        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({})
        expect(updateContractReviewDAO).toHaveBeenCalledWith(42, { status: 'failed' })
        expect(injectComments).not.toHaveBeenCalled()
    })

    it('injectComments 抛错 → risks/summary 已写库 + status=failed', async () => {
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99,
        })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectComments as any).mockRejectedValueOnce(new Error('xml parse fail'))
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({
            structuredResponse: {
                risks: [{ id: 'r1', clauseIndex: 0, level: 'low' }],
                summary: 'ok',
            },
        })
        // 第一次：写 risks/summary（可 rebuild 恢复的关键）
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(1, 42, {
            risks: [{ id: 'r1', clauseIndex: 0, level: 'low' }],
            summary: 'ok',
        })
        // 最后一次：status=failed
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, { status: 'failed' })
    })
})
```

- [ ] **Step 4.1.2：跑失败**

Run: `npx vitest run tests/server/workflow/middleware/reviewResultPersistence.test.ts`
Expected: FAIL

### 4.2 实现中间件

- [ ] **Step 4.2.1：实现 `server/services/workflow/middleware/reviewResultPersistence.middleware.ts`**

```typescript
/**
 * 合同审查结果持久化中间件（contractReviewMain 专用，末位）
 *
 * beforeAgent: 置 status='reviewing'
 * afterAgent:
 *   - structuredResponse 缺失 → status='failed'（risks=null，不可 rebuild）
 *   - structuredResponse 有值 → 写 risks/summary（失败态 rebuild 的前提）→ 注入批注 + 两步写 OSS → status='completed'
 *   - 注入/上传失败 → status='failed'（risks 已落库，用户可通过 rebuild-docx 重试）
 */

import { createMiddleware } from 'langchain'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '../../assistant/contract/contractReview.dao'
import { injectComments } from '../../assistant/contract/docx'
import {
    downloadFileService,
    uploadFileService,
} from '../../storage/storage.service'
import { getDefaultStorageConfigDao } from '../../storage/storageConfig.dao'
import {
    findOssFileByIdDao,
    createOssFileDao,
} from '../../files/ossFiles.dao'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType } from '~~/server/lib/storage/types'
import type { Risk } from '#shared/types/contract'

interface ReviewResultPersistenceOptions {
    reviewId: number
    sessionId: string
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const reviewResultPersistenceMiddleware = (
    options: ReviewResultPersistenceOptions,
) => createMiddleware({
    name: 'ReviewResultPersistenceMiddleware',

    beforeAgent: {
        hook: async (_state: any) => {
            try {
                await updateContractReviewDAO(options.reviewId, { status: 'reviewing' })
            } catch (err) {
                logger.error('reviewResultPersistence beforeAgent 失败', {
                    reviewId: options.reviewId, err,
                })
            }
        },
    },

    afterAgent: {
        hook: async (state: any) => {
            const structured = state.structuredResponse as
                | { risks: Risk[]; summary: string }
                | undefined

            if (!structured) {
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                logger.warn('reviewResultPersistence: structuredResponse 缺失', {
                    reviewId: options.reviewId,
                })
                return
            }

            // Step 1: 先落库 risks/summary（失败态 rebuild 的前提）
            try {
                await updateContractReviewDAO(options.reviewId, {
                    risks: structured.risks as any,
                    summary: structured.summary,
                })
            } catch (err) {
                logger.error('reviewResultPersistence: 写 risks/summary 失败', {
                    reviewId: options.reviewId, err,
                })
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
                return
            }

            // Step 2: 注入批注 + 上传新 .docx
            try {
                const review = await getContractReviewDAO(options.reviewId)
                if (!review) throw new Error(`review ${options.reviewId} not found`)
                const originalOssFile = await findOssFileByIdDao(review.originalFileId)
                if (!originalOssFile) throw new Error(`original oss file ${review.originalFileId} not found`)

                const originalBuffer = await downloadFileService(originalOssFile.filePath)
                const reviewedBuffer = await injectComments(originalBuffer, structured.risks)

                const ossPath = `users/${review.userId}/contract-review/reviewed-${options.reviewId}-${Date.now()}.docx`
                const uploadResult = await uploadFileService(ossPath, reviewedBuffer, {
                    contentType: DOCX_MIME,
                    userId: review.userId,
                })

                const storageConfig = await getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, review.userId)
                const bucketName = storageConfig?.bucket ?? ''

                const ossFileRow = await createOssFileDao({
                    userId: review.userId,
                    bucketName,
                    fileName: `reviewed-${options.reviewId}.docx`,
                    filePath: uploadResult.name,
                    fileSize: reviewedBuffer.length,
                    fileType: DOCX_MIME,
                    source: FileSource.CASE_ANALYSIS,
                    status: OssFileStatus.UPLOADED,
                    encrypted: false,
                })

                await updateContractReviewDAO(options.reviewId, {
                    reviewedFileId: ossFileRow.id,
                    status: 'completed',
                })
            } catch (err) {
                logger.error('reviewResultPersistence: 批注/上传失败', {
                    reviewId: options.reviewId, err,
                })
                await updateContractReviewDAO(options.reviewId, { status: 'failed' })
            }
        },
    },
})
```

> 关键对齐：`createOssFileDao` 入参是 plain 字段（非 Prisma nested connect）；`downloadFileService(filePath)` 单参数。实施前若发现 `uploadFileService` 返回字段名不是 `name` 而是 `path`，按实际返回值调整；**不可凭印象改 DAO 签名**。

- [ ] **Step 4.2.2：在 middleware/index.ts 追加 export**

```typescript
// server/services/workflow/middleware/index.ts
export { reviewResultPersistenceMiddleware } from './reviewResultPersistence.middleware'
```

- [ ] **Step 4.2.3：测试通过**

Run: `npx vitest run tests/server/workflow/middleware/reviewResultPersistence.test.ts`
Expected: 4 passed

- [ ] **Step 4.2.4：提交**

```bash
git add server/services/workflow/middleware/reviewResultPersistence.middleware.ts \
        server/services/workflow/middleware/index.ts \
        tests/server/workflow/middleware/reviewResultPersistence.test.ts
git commit -m "feat(contract): M3 新增 reviewResultPersistence 中间件"
```

---

## Task 5：contractReviewMainAgent + runContractReviewChat

**Files:**
- Create: `server/services/workflow/agents/contractReviewMainAgent.ts`
- Modify: `server/services/workflow/agents/index.ts`（加入 `export * from './contractReviewMainAgent'`）
- Create: `tests/server/workflow/agents/contractReviewMainAgent.test.ts`（基础 smoke：能创建 agent，不调真实模型；happy path 的真实 agent stream 覆盖放 Task 10 的集成测）

### 5.1 单测

- [ ] **Step 5.1.1：写 smoke 测**

```typescript
// tests/server/workflow/agents/contractReviewMainAgent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    findContractReviewBySessionIdDAO: vi.fn(),
}))
// 其他依赖均为现有稳定实现，不 mock；若跑全量测试需要隔离，视实际情况在
// Task 10 集成测里再加 mock（本 smoke 只检查 sessionId 未命中时抛错）

import { runContractReviewChat } from '~~/server/services/workflow/agents/contractReviewMainAgent'
import { findContractReviewBySessionIdDAO } from '~~/server/services/assistant/contract/contractReview.dao'

describe('runContractReviewChat', () => {
    beforeEach(() => vi.clearAllMocks())

    it('sessionId 未命中 review → 抛错', async () => {
        ;(findContractReviewBySessionIdDAO as any).mockResolvedValueOnce(null)
        await expect(
            runContractReviewChat('unknown-session', { userId: 7 }),
        ).rejects.toThrow(/No contract review/)
    })
})
```

- [ ] **Step 5.1.2：跑失败**

Run: `npx vitest run tests/server/workflow/agents/contractReviewMainAgent.test.ts`
Expected: FAIL

### 5.2 实现

- [ ] **Step 5.2.1：实现 `server/services/workflow/agents/contractReviewMainAgent.ts`**

```typescript
/**
 * 合同审查主代理（contractReviewMain 节点）
 *
 * 仿 documentMainAgent 骨架：
 * - 从 sessionId 反查 review（contractReviews.sessionId unique）
 * - 构造 buildRiskSchema() 作为 responseFormat
 * - 挂载 reviewResultPersistenceMiddleware（末位 afterAgent）
 * - 唯一工具 parseAndAskStance 由 toolModules 加载
 *
 * 参见 spec §6.2 / §6.6
 */

import {
    createAgent,
    summarizationMiddleware,
    type ReactAgent,
} from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { renderSystemPrompt } from '../utils/promptRenderer'
import {
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
    reviewResultPersistenceMiddleware,
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '../middleware'
import { findContractReviewBySessionIdDAO } from '../../assistant/contract/contractReview.dao'
import { buildRiskSchema } from '../../assistant/contract/riskSchema.builder'

const CONTRACT_MAIN_NODE_NAME = 'contractReviewMain'

function buildInitialPrompt(reviewId: number): string {
    return [
        `请审查合同（reviewId=${reviewId}）。`,
        '第一步：调用 parseAndAskStance 工具解析合同并请求用户立场；该工具会 interrupt 等待用户回复。',
        '第二步：工具返回后，根据 stance / stanceFocus / paragraphs 按 responseFormat 输出结构化风险清单。',
    ].join('\n')
}

export interface ContractReviewAgentOptions {
    userId: number
    signal?: AbortSignal
    command?: unknown
}

export async function runContractReviewChat(
    sessionId: string,
    options: ContractReviewAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
    const { userId, signal, command } = options

    const [checkpointer, store, nodeConfig, review] = await Promise.all([
        getCheckpointer(),
        getStore(),
        getValidNodeConfig(CONTRACT_MAIN_NODE_NAME, '合同审查主Agent'),
        findContractReviewBySessionIdDAO(sessionId),
    ])

    if (!review) {
        throw new Error(`No contract review found for session ${sessionId}`)
    }

    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) {
        throw new Error(`${CONTRACT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
    }

    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0,
        streaming: true,
    })

    const systemPrompt = renderSystemPrompt(nodeConfig, {
        reviewId: review.id,
        contractType: review.contractType ?? undefined,
    })

    const toolContext = {
        userId,
        sessionId,
        reviewId: review.id,
    }
    const tools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []

    const contextWindow = nodeConfig.modelContextWindow || 128000
    const triggerTokens = Math.max(Math.floor(contextWindow * 0.6), 30000)

    const middleware = buildMiddlewareStack([
        {
            middleware: pointConsumptionMiddleware(userId, 'contract_review_token', sessionId),
            priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
            name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
        },
        {
            middleware: summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
            priority: MIDDLEWARE_PRIORITY.SUMMARIZATION,
            name: MIDDLEWARE_NAMES.SUMMARIZATION,
        },
        {
            middleware: safetyTrimMiddleware({
                model, maxTokens: Math.floor(contextWindow * 0.8),
            }),
            priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
            name: MIDDLEWARE_NAMES.SAFETY_TRIM,
        },
        {
            middleware: reviewResultPersistenceMiddleware({
                reviewId: review.id,
                sessionId,
            }),
            priority: MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE,
            name: MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE,
        },
    ])

    const riskSchema = buildRiskSchema()

    const agent: ReactAgent = createAgent({
        model,
        systemPrompt,
        checkpointer,
        store,
        tools,
        responseFormat: riskSchema,
        middleware,
    })

    const input: Command | { messages: HumanMessage[] } = command
        ? new Command({ resume: command })
        : { messages: [new HumanMessage(buildInitialPrompt(review.id))] }

    return agent.stream(input, {
        configurable: { thread_id: sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        recursionLimit: 1000,
        signal,
    })
}
```

> M3 **不**导出 `getContractReviewThreadState`——当前没有任何调用点（worker 走 SSE stream，不需要读 thread state）；M4 UI 真正需要时再按 `documentMainAgent.getDocumentThreadState` 模板添加。

- [ ] **Step 5.2.2：agents/index.ts 追加 export**

```typescript
// server/services/workflow/agents/index.ts
export * from './contractReviewMainAgent'
```

- [ ] **Step 5.2.3：测试通过**

Run: `npx vitest run tests/server/workflow/agents/contractReviewMainAgent.test.ts`
Expected: 1 passed

- [ ] **Step 5.2.4：提交**

```bash
git add server/services/workflow/agents/contractReviewMainAgent.ts \
        server/services/workflow/agents/index.ts \
        tests/server/workflow/agents/contractReviewMainAgent.test.ts
git commit -m "feat(contract): M3 新增 contractReviewMainAgent"
```

---

## Task 6：Worker 加 scope='contract' 分支

**Files:**
- Modify: `server/services/agent/agentWorker.ts:164-191`（在 `session.scope === 'document'` 分支之后、`session.scope === 'assistant'` 之后、case 域 `else` 之前**插入** contract 分支）

- [ ] **Step 6.1：修改 worker**

```typescript
// server/services/agent/agentWorker.ts —— 在 `else if (session.scope === 'assistant')` 之后追加：
else if (session.scope === 'contract') {
    if (session.userId == null) {
        throw new Error(
            `contract session ${run.sessionId} 缺失 userId（数据损坏）`,
        )
    }
    const { runContractReviewChat } = await import('../workflow/agents/contractReviewMainAgent')
    stream = await runContractReviewChat(run.sessionId, {
        userId: session.userId,
        command: input.command,
        signal: abortController.signal,
    })
}
```

- [ ] **Step 6.2：类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -i agentWorker | head`
Expected: 无新增错误

- [ ] **Step 6.3：提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "feat(contract): M3 agentWorker 加 contract scope 分支"
```

---

## Task 7：POST /reviews 端点 + Service 完整实现

**Files:**
- Create: `server/api/v1/assistant/contract/reviews.post.ts`
- Modify: `server/services/assistant/contract/contractReview.service.ts`（补齐 Task 2.3 留下的 throw 占位）
- Create: `tests/server/api/assistant/contract/reviews.post.test.ts`

### 7.1 Service 真正实现

- [ ] **Step 7.1.1：写失败测（service 层 + API 层合并在一个 test 文件里，端到端覆盖两种 sourceType）**

```typescript
// tests/server/api/assistant/contract/reviews.post.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
// ... 完整 mock + 测试见下方。注意：POST /reviews 测试覆盖：
//    1. sourceType='upload' 校验 ossFileId 归属当前用户 → 成功返回 { reviewId, sessionId }
//    2. sourceType='paste' 调 textToDocxService → upload → 成功
//    3. sourceType='upload' 但 ossFileId 不属于当前用户 → 403
//    4. sourceType='paste' 但 text > 50000 字符 → 413
//    5. 未登录 → 401
```

> 完整 test 内容由实施者在执行时展开，参考 `tests/server/api/assistant/document/drafts.post.test.ts` 的 mocking 结构；断言点必须覆盖以上 5 种路径。

- [ ] **Step 7.1.2：补齐 service**

```typescript
// server/services/assistant/contract/contractReview.service.ts —— 替换 Task 2.3 的 throw 占位
import { randomUUID } from 'node:crypto'
import type { CreateReviewRequest, CreateReviewResponse } from '#shared/types/contract'
import { createContractReviewDAO } from './contractReview.dao'
import { findOssFileByIdDao, createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { textToDocxService } from './textToDocx.service'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { prisma } from '~~/server/utils/prisma'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_PASTE_LEN = 50_000

export interface CreateAndStartOptions extends CreateReviewRequest {
    userId: number
}

export type CreateAndStartResult =
    | CreateReviewResponse
    | { error: string; code: number }

export async function createAndStartContractReviewService(
    options: CreateAndStartOptions,
): Promise<CreateAndStartResult> {
    const { userId, sourceType } = options
    let originalFileId: number

    if (sourceType === 'upload') {
        if (!options.ossFileId) return { error: 'ossFileId 必填', code: 400 }
        const ossFile = await findOssFileByIdDao(options.ossFileId)
        if (!ossFile || ossFile.userId !== userId) {
            return { error: '无权访问该文件', code: 403 }
        }
        // MIME 校验（防止用户上传非 .docx 文件）
        if (ossFile.fileType !== DOCX_MIME) {
            return { error: '仅支持 .docx 格式', code: 400 }
        }
        originalFileId = ossFile.id
    }
    else if (sourceType === 'paste') {
        const text = options.text ?? ''
        if (!text.trim()) return { error: 'text 不能为空', code: 400 }
        if (text.length > MAX_PASTE_LEN) {
            return { error: `粘贴文本不能超过 ${MAX_PASTE_LEN} 字符`, code: 413 }
        }
        const docxBuffer = await textToDocxService(text)
        const ossPath = `users/${userId}/contract-review/pasted-${Date.now()}.docx`
        const uploadResult = await uploadFileService(ossPath, docxBuffer, {
            contentType: DOCX_MIME, userId,
        })
        const storageConfig = await getDefaultStorageConfigDao(
            StorageProviderType.ALIYUN_OSS, userId,
        )
        const ossRow = await createOssFileDao({
            userId,
            bucketName: storageConfig?.bucket ?? '',
            fileName: `pasted-${Date.now()}.docx`,
            filePath: uploadResult.name,
            fileSize: docxBuffer.length,
            fileType: DOCX_MIME,
            source: FileSource.CASE_ANALYSIS,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        })
        originalFileId = ossRow.id
    }
    else {
        return { error: 'sourceType 仅支持 upload / paste', code: 400 }
    }

    const sessionId = randomUUID()

    // 先显式建 scope='contract' 的 caseSessions（对齐 documentDraft.service.ts:63-73 的模式——
    // 既有的 createAssistantSessionDAO 会硬编码 scope='assistant' 导致 agentWorker
    // 错路由到 runAssistantChat；必须绕开它直接 prisma.caseSessions.create）
    await prisma.caseSessions.create({
        data: {
            sessionId,
            scope: 'contract',
            userId,
            caseId: null,
            type: 1,
            status: 1,
            title: sourceType === 'paste' ? '合同审查 · 粘贴文本' : '合同审查',
        },
    })

    const review = await createContractReviewDAO({
        userId,
        sessionId,
        originalFileId,
        status: 'pending',
    })

    const enqueued = await enqueueRunService({
        sessionId, threadId: sessionId, userId, caseId: null,
        input: { message: undefined, command: undefined },
    })
    if ('error' in enqueued) return { error: enqueued.error, code: 429 }

    return { reviewId: review.id, sessionId }
}
```

> 关键对齐：参考 `server/services/assistant/document/documentDraft.service.ts:63-73`——同样是 `scope=document` 场景直接调 `prisma.caseSessions.create` 而不走 `createAssistantSessionDAO`（后者会硬编码 `scope='assistant'`）。本 service 照抄此模式，把 `scope` 换为 `'contract'`。

- [ ] **Step 7.1.3：实现 API 端点 `server/api/v1/assistant/contract/reviews.post.ts`**

```typescript
/**
 * POST /api/v1/assistant/contract/reviews
 *
 * 创建合同审查。paste 源会同步生成 .docx 上传 OSS；upload 源需提交归属本人的 ossFileId。
 * 立即入队一次 agent 运行（首轮会调 parseAndAskStance interrupt 等待立场）。
 */
import { z } from 'zod'
import { createAndStartContractReviewService } from '~~/server/services/assistant/contract/contractReview.service'

const BodySchema = z.object({
    sourceType: z.enum(['upload', 'paste']),
    ossFileId: z.number().int().positive().optional(),
    text: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = BodySchema.safeParse(await readBody(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const result = await createAndStartContractReviewService({
        userId: user.id, ...parsed.data,
    })
    if ('error' in result) return resError(event, result.code, result.error)

    return resSuccess(event, '创建成功', result)
})
```

- [ ] **Step 7.1.4：测试通过**

Run: `npx vitest run tests/server/api/assistant/contract/reviews.post.test.ts`
Expected: 5 passed

- [ ] **Step 7.1.5：提交**

```bash
git add server/api/v1/assistant/contract/reviews.post.ts \
        server/services/assistant/contract/contractReview.service.ts \
        tests/server/api/assistant/contract/reviews.post.test.ts
git commit -m "feat(contract): M3 新增 POST /reviews 端点"
```

---

## Task 8：GET /reviews/:id 端点

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id].get.ts`
- Create: `tests/server/api/assistant/contract/reviews.get.test.ts`

- [ ] **Step 8.1：写失败测（覆盖 401 / 403 / 404 / happy path 四路径）**

关键断言点：
1. 未登录 → 401
2. review.userId !== user.id → 403
3. id 不存在或 deletedAt!=null → 404
4. 成功返回 `{ review: { id, sessionId, status, contractType, partyA, partyB, stance, risks, summary, originalFileId, reviewedFileId, createdAt, updatedAt } }`（返回 **sessionId** 供前端 SSE 订阅；**不含** userId / deletedAt，防止越权暴露）

- [ ] **Step 8.2：实现**

```typescript
// server/api/v1/assistant/contract/reviews/[id].get.ts
import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, 'id 无效')

    const review = await getContractReviewDAO(id)
    if (!review) return resError(event, 404, '审查不存在')
    if (review.userId !== user.id) return resError(event, 403, '无权访问')

    return resSuccess(event, '获取成功', {
        review: {
            id: review.id,
            sessionId: review.sessionId,
            status: review.status,
            contractType: review.contractType,
            partyA: review.partyA,
            partyB: review.partyB,
            stance: review.stance,
            risks: review.risks,
            summary: review.summary,
            originalFileId: review.originalFileId,
            reviewedFileId: review.reviewedFileId,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt,
        },
    })
})
```

- [ ] **Step 8.3：测试通过 + 提交**

```bash
npx vitest run tests/server/api/assistant/contract/reviews.get.test.ts
git add server/api/v1/assistant/contract/reviews/'[id]'.get.ts \
        tests/server/api/assistant/contract/reviews.get.test.ts
git commit -m "feat(contract): M3 新增 GET /reviews/:id 端点"
```

---

## Task 9：POST /reviews/:id/stance 端点

**Files:**
- Create: `server/api/v1/assistant/contract/reviews/[id]/stance.post.ts`
- Create: `tests/server/api/assistant/contract/stance.post.test.ts`

- [ ] **Step 9.1：测试覆盖路径**

1. 未登录 → 401
2. review 不属于当前用户 → 403
3. review 状态不是 awaiting_stance（已 completed / failed）→ 200 幂等返回 `{ reviewId }`，不再入队
4. stance 参数非法（非 partyA/partyB/neutral）→ 400
5. happy path：成功入队 → 200 返回 `{ reviewId, runId }`
6. `enqueueRunService` 返回 `{ error: '...' }`（并发超限）→ 429
7. **旧 run 为 INTERRUPTED**：调用前 mock `findActiveRunBySessionIdDAO` 返回 INTERRUPTED run → 验证 `updateRunStatusDAO(oldId, COMPLETED)` 被调用、且 `enqueueRunService` 随后入队成功（对齐 `server/api/v1/assistant/document/chat.post.ts:59-76` 的分支 1 路径）

- [ ] **Step 9.2：实现**

```typescript
// server/api/v1/assistant/contract/reviews/[id]/stance.post.ts
import { z } from 'zod'
import { getContractReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import {
    enqueueRunService,
    // 注：agentRun.service 若未 re-export 这两者则按实际路径从 agentRun.dao 导入
} from '~~/server/services/agent/agentRun.service'
import {
    findActiveRunBySessionIdDAO,
    updateRunStatusDAO,
} from '~~/server/services/agent/agentRun.dao'
import { AGENT_RUN_STATUS } from '#shared/types/agentRun'

const BodySchema = z.object({
    stance: z.enum(['partyA', 'partyB', 'neutral']),
    partyA: z.string().optional(),
    partyB: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const reviewId = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(reviewId) || reviewId <= 0) {
        return resError(event, 400, 'id 无效')
    }

    const parsed = BodySchema.safeParse(await readBody(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    const review = await getContractReviewDAO(reviewId)
    if (!review) return resError(event, 404, '审查不存在')
    if (review.userId !== user.id) return resError(event, 403, '无权操作')

    if (review.status !== 'awaiting_stance') {
        return resSuccess(event, `立场已提交（状态：${review.status}）`, { reviewId })
    }

    // 关键：resume 前必须先把 INTERRUPTED 的旧 run 置 COMPLETED，
    // 释放 (sessionId, status IN pending/running/interrupted) 的 partial unique index，
    // 否则 enqueueRunService 会 P2002 冲突（对齐 document/chat.post.ts:59-64）
    const activeRun = await findActiveRunBySessionIdDAO(review.sessionId)
    if (activeRun && activeRun.status === AGENT_RUN_STATUS.INTERRUPTED) {
        await updateRunStatusDAO(activeRun.id, AGENT_RUN_STATUS.COMPLETED, {
            completedAt: new Date(),
        })
    }

    const result = await enqueueRunService({
        sessionId: review.sessionId,
        threadId: review.sessionId,
        userId: user.id,
        caseId: null,
        input: {
            message: undefined,
            command: { ...parsed.data },
        },
    })
    if ('error' in result) return resError(event, 429, result.error)

    return resSuccess(event, '立场已提交，审查继续', { reviewId, runId: result.runId })
})
```

- [ ] **Step 9.3：测试通过 + 提交**

```bash
npx vitest run tests/server/api/assistant/contract/stance.post.test.ts
git add server/api/v1/assistant/contract/reviews/'[id]'/stance.post.ts \
        tests/server/api/assistant/contract/stance.post.test.ts
git commit -m "feat(contract): M3 新增 POST /reviews/:id/stance 端点"
```

---

## Task 10：端到端集成测（agent happy path + 失败路径）

**Files:**
- Create: `tests/server/assistant/contract/m3Integration.test.ts`

**目的**：验证 spec §12.1 M3 行列两条"必含测试"的剩余部分（workflow/tool/middleware 层的单测已覆盖各自路径；本测补齐"commentInjector 抛错 → risks 已落库 + status=failed + rebuild-docx 可恢复"的**端到端 afterAgent 语义**）。

**注**：真正跑 `createAgent` 会真实调用 LLM，本测**不**跑真实模型。通过直接驱动 `reviewResultPersistenceMiddleware.afterAgent` hook 手动注入 `structuredResponse`，配合真实 `injectComments`（让它故意在 XML 损坏上抛错）来模拟。rebuild-docx 端点在 M5 才做，M3 本测**仅验证 status=failed 且 risks 已落库**，M5 的测试再验证 rebuild 恢复。

- [ ] **Step 10.1：写测**

```typescript
// tests/server/assistant/contract/m3Integration.test.ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { reviewResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/reviewResultPersistence.middleware'
import {
    createContractReviewDAO,
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { prisma } from '~~/server/utils/prisma'
import { ensureTestUser, cleanupTestData } from '../test-db-helper'

describe('M3 集成：结果持久化语义', () => {
    let userId: number
    const createdIds: number[] = []

    beforeAll(async () => {
        userId = await ensureTestUser()
    })

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.contractReviews.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    afterAll(async () => {
        await cleanupTestData()
    })

    function getAfterHook(mw: any) {
        return mw.afterAgent?.hook ?? mw.afterAgent
    }

    // 注：`structuredResponse 缺失 → failed` 的语义已由 Task 4 单测（mock）覆盖；
    // 本集成测只保留 "真实 DB + 真实 injectComments 准备阶段失败" 一例，
    // 验证 risks 能真的落库（M5 rebuild-docx 依赖此前提）。

    it('批注注入准备阶段失败（originalFile 不存在）→ risks 已落库 + status=failed（M5 rebuild-docx 可恢复）', async () => {
        // 用 originalFileId=0 让 findOssFileByIdDao 返回 null → 注入前准备阶段抛错
        // （真正进入 injectComments 抛错的路径由 Task 4 的 mock 单测覆盖；
        //  真实 DB 难以稳定构造坏 .docx Buffer 触发 injectComments 内部异常）
        const review = await createContractReviewDAO({
            userId,
            sessionId: `itest-${Date.now()}-inject-fail`,
            originalFileId: 0,
            status: 'reviewing',
        })
        createdIds.push(review.id)
        const mw = reviewResultPersistenceMiddleware({
            reviewId: review.id, sessionId: review.sessionId,
        })
        const after = getAfterHook(mw)
        const fakeRisks = [{
            id: 'r1', clauseIndex: 0, clauseText: 'P0', level: 'low',
            category: '其他', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x',
        }]
        await after({
            structuredResponse: { risks: fakeRisks, summary: '整体风险可控' },
        })
        const refreshed = await getContractReviewDAO(review.id)
        expect(refreshed?.status).toBe('failed')
        expect(refreshed?.risks).toEqual(fakeRisks)  // 关键：risks 已落库
        expect(refreshed?.summary).toBe('整体风险可控')
        expect(refreshed?.reviewedFileId).toBeNull()  // 未生成批注文件
    })
})
```

- [ ] **Step 10.2：跑通 + 提交**

```bash
npx vitest run tests/server/assistant/contract/m3Integration.test.ts
git add tests/server/assistant/contract/m3Integration.test.ts
git commit -m "test(contract): M3 端到端持久化语义集成测"
```

---

## 最终验收步骤

- [ ] 全量测试：`npx vitest run`，所有测试绿
- [ ] 类型检查：`npx nuxi typecheck`，无新增错误
- [ ] curl 冒烟（可选，需本地 dev server 运行）：

```bash
# 1. 上传 .docx 或 paste
curl -X POST http://localhost:3000/api/v1/assistant/contract/reviews \
     -H 'cookie: <your-auth-cookie>' \
     -H 'content-type: application/json' \
     -d '{"sourceType":"paste","text":"借款合同。甲方：张三。乙方：李四。借款金额 10 万元。"}'
# → { code: 200, data: { reviewId, sessionId } }

# 2. 等 SSE 推出 awaiting_stance interrupt 后提交立场
curl -X POST http://localhost:3000/api/v1/assistant/contract/reviews/$REVIEW_ID/stance \
     -H 'cookie: ...' -H 'content-type: application/json' \
     -d '{"stance":"partyB"}'

# 3. GET 查询
curl http://localhost:3000/api/v1/assistant/contract/reviews/$REVIEW_ID \
     -H 'cookie: ...'
# → { code: 200, data: { review: { status: 'completed', risks: [...], reviewedFileId: ... } } }
```

- [ ] 清理残留测试数据：`psql 'postgresql://daixin:daixin88@localhost:5432/ls_new_testing' -c "SELECT COUNT(*) FROM contract_reviews WHERE session_id LIKE 'test-%' OR session_id LIKE 'itest-%'"` → 应为 0

- [ ] 合并到 dev：参考 M2 merge 流程（`git stash push -u` 兜底 WIP → `git merge --no-ff feature/contract-review-m3` → stash pop）

---

## 复用清单（实施时严禁新造）

| 场景 | 复用 |
|---|---|
| Agent 骨架 | `documentMainAgent.runDocumentChat`（而非 caseMainAgent，更接近本场景的"单节点 + responseFormat"） |
| 节点配置加载 | `getValidNodeConfig` |
| 模型构造 | `createChatModel` |
| 提示词渲染 | `renderSystemPrompt`（已在 Task 1 扩展上下文字段） |
| 工具加载 | `getToolInstancesService` + `toolModules` 注册（Task 3） |
| 中间件优先级 | `buildMiddlewareStack` + `MIDDLEWARE_PRIORITY` + `MIDDLEWARE_NAMES` |
| 积分扣减 | `pointConsumptionMiddleware(userId, 'contract_review_token', sessionId)` |
| 持久化语义对照 | 仿 `draftResultPersistence.middleware`（status / 失败回退语义接近） |
| SSE 推送 | `agent.stream` + `encoding: 'text/event-stream'`（同 runDocumentChat） |
| Run 入队 + resume | `enqueueRunService({ input: { command } })`；Worker 已自动 `new Command({ resume })` |
| OSS 上传 | `uploadFileService` + `getDefaultStorageConfigDao` + `createOssFileDao`（plain 字段）|
| OSS 下载 | `findOssFileByIdDao(id)` → `downloadFileService(filePath)`（单参数）|
| docx 解析 / 批注注入 | 已复用 M2 `server/services/assistant/contract/docx/`（parser / partyDetector / injectComments）|
| paste → .docx | 复用 M2 `textToDocx.service` |

---

## YAGNI / 边界

本期**不做**：
- 任何 UI（M4）
- PATCH /reviews（M5）
- POST /rebuild-docx（M5，本期失败恢复仅"保留 risks 在 DB"即可）
- GET /reviews 列表（M6+）
- GET /download（M5）
- `contractReviews.caseId` / 案件页集成（M6+）
- 24h 超时 cron（M6+）
- 多合同对比 / 经验库（M6+）
- `FileSource.CONTRACT_REVIEW` 枚举新增（M6+，本期沿用 `CASE_ANALYSIS`）

本期**不改**：
- `chatSessions` / `agentRuns` / `AgentRunInput` 类型（已支持 `command` 字段透传）
- 其他 agent 路由（caseMain / moduleAgent / assistantAgent / documentMainAgent）
- `pointConsumptionMiddleware` 的计费 key 机制（seed 已就绪 `contract_review_token`）

---

## 风险提示（实施时留意，但不阻塞计划）

1. **`state.structuredResponse` 在 afterAgent 可见性**（spec §6.5 标注 PoC 前置）：实施 Task 5 跑 smoke + Task 10 集成测时，如发现 `state.structuredResponse` 为 undefined，改为读 `state.messages.at(-1).additional_kwargs.parsed` 或尾部 AIMessage 的 content JSON parse。**若回退方案也失败**，停下来找用户——不可悄悄把 status 写成 failed 糊弄过去。
2. **`chatSessions` scope='contract' 落库路径**：Task 7 service 层需要确认 session 行被正确建立且 `scope='contract'`。实施时对照 `server/api/v1/assistant/chat.post.ts` 或 `document/chat.post.ts` 的 scope 设置逻辑，**用相同的 pattern**。
3. **工具注册约定**：Task 3 在 `toolModules` 字典的新增入口形状必须和现有工具 100% 一致，实施时先 `head -50 server/services/workflow/tools/index.ts` 看约定再写。
4. **afterAgent hook 形状**：Task 4/10 里 `mw.afterAgent.hook` 的读法基于 `createMiddleware` 的当前返回值约定；如测试里读不到 hook，查 `draftResultPersistence.middleware` 测试（若无则直接 `console.log(mw)` 看真实形状）。

---

## Self-Review 检查清单

- [ ] 每个任务的 Files / Steps / Expected / Commit 都有具体内容
- [ ] 没有 "TBD / 稍后补 / 类似上面" 这类占位符
- [ ] 后续 Task 引用的方法名与前置 Task 定义一致
  - `buildRiskSchema`（Task 2）← `contractReviewMainAgent`（Task 5）引用 ✓
  - `parseAndAskStanceModule`（Task 3）← `toolModules` 注册 ✓
  - `reviewResultPersistenceMiddleware`（Task 4）← `contractReviewMainAgent` middleware 数组 ✓
  - `createAndStartContractReviewService`（Task 2.3 骨架 / Task 7 实现）← POST /reviews 端点 ✓
  - `injectComments`（M2 已存在）← Task 4 afterAgent ✓
  - `parseContractDocx` / `detectParties`（M2 已存在）← Task 3 tool ✓
- [ ] Spec §11 M3 的核心产出全部被 Task 覆盖：
  - 接口扩展（Task 1）✓
  - `contractReviewMain` node + 提示词（M1 已 seed，不新增）✓
  - buildRiskSchema（Task 2）✓
  - parseAndAskStance（Task 3）✓
  - reviewResultPersistenceMiddleware（Task 4）✓
  - contractReviewMainAgent + runContractReviewChat（Task 5）✓
  - Worker scope='contract'（Task 6）✓
  - contractReview.service/dao（Task 2 + 7）✓
  - POST/GET /reviews + POST /stance（Task 7/8/9）✓
  - contract_review_token（M1 已 seed）+ pointConsumptionMiddleware 接入（Task 5 middleware 数组内）✓
  - 必含测试（Task 3/4/10 覆盖）✓
