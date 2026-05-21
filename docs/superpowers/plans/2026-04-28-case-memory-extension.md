# 案件记忆扩展实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把案件记忆三件套铺开到 9 个案件相关 agent + 加 afterAgent 异步兜底提取 + 案件详情页新增"案件记忆" Tab + 三个工具调用专属卡片。

**Architecture:** 现有 `case_memories` 表是 LangChain PGVectorStore 同构表（业务字段在 metadata JSON）；新增 2 个 LLM 节点（`caseMemoryExtract` / `caseMemorySubjectInfer`）走 nodes+prompts 标准管理；afterAgent 用 LangChain v1.3 原生 `createMiddleware({ afterAgent: { hook } })` 实现（参考 `analysisResultPersistence.middleware.ts:73`）；前端时间线 Tab 沿用 CaseDetailDocuments 同款布局；移动端 ⋯ 菜单用 shadcn Drawer。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Tailwind CSS v4 + shadcn-vue + Prisma + LangChain v1.3 + dayjs + lucide-vue-next + Vitest

**Spec:** `docs/superpowers/specs/2026-04-28-case-memory-extension-design.md`

**核心约束**：
- 零 DB schema 变更（仅 metadata.source 字符串值扩展）
- 节点种子走 `prisma/seeds/seedData.sql`（同 stage 8 决策，不走 prisma migrate）
- 复用 `calcSimilarity` (textSimilarity.ts:24)、复用 `writeMemoryService` 版本链、复用 `invokeNodeJson`
- 开发期不跑全量测试（`bun run test` 仅在 Phase 9 收尾跑一次）
- 不实现管理端（D11 决策）

**File Structure**

新增文件（19 个）：

```
server/services/memory/
├── memory.dao.ts                  # findActiveMemoryBySubjectDAO + listMemoriesDAO + softDeleteMemoryDAO
├── memoryExtraction.service.ts    # afterAgent 异步提取任务
└── memorySubjectInfer.service.ts  # POST API 用的 subject_key 推断

server/services/agent-platform/middleware/
└── afterAgentMemory.middleware.ts # afterAgent hook（写次数 ≥ 3 跳过；fire-and-forget 兜底）

server/api/v1/case/memories/
├── by-case/[caseId].get.ts        # GET 列表（按时间倒序，分页）
├── by-case/[caseId].post.ts       # POST 用户添加
└── [memoryId].delete.ts           # DELETE 软删（仅 manual_user）

app/composables/
└── useCaseMemory.ts               # 数据请求 + 状态管理

app/components/caseDetail/
├── CaseDetailMemory.vue           # 主组件（顶部栏 + 筛选 + 时间轴 + 失效折叠）
├── CaseMemoryTimeline.vue         # 时间轴子组件（按日分组）
└── AddMemoryDialog.vue            # 添加 Dialog

app/components/ai/tools/
├── MemorySearchTool.vue           # search_case_memory 卡片
├── MemoryWriteTool.vue            # write_case_memory 卡片
└── MemoryUpdateTool.vue           # update_case_memory 卡片

tests/server/memory/
├── memory.dao.test.ts
├── memoryExtraction.service.test.ts
└── memorySubjectInfer.service.test.ts

tests/server/agent-platform/middleware/
└── afterAgentMemory.middleware.test.ts

tests/server/api/case/memories/
├── byCase.get.test.ts
├── byCase.post.test.ts
└── delete.test.ts

tests/app/composables/useCaseMemory.test.ts
tests/app/components/caseDetail/{CaseDetailMemory,CaseMemoryTimeline,AddMemoryDialog}.test.ts
tests/app/components/ai/tools/{MemorySearchTool,MemoryWriteTool,MemoryUpdateTool}.test.ts
```

修改文件（10 个）：

```
shared/types/memory.ts                              # source 字符串字面量类型扩展
server/services/memory/memory.service.ts            # writeMemoryService 复用 DAO + source 类型扩展
prisma/seeds/seedData.sql                           # +2 节点 +2 prompt +9 节点 tools 改 +9 节点 prompt 加铁律
app/pages/dashboard/cases/[id].vue                  # validViews / viewLabelMap / v-else-if 链路
app/components/caseDetail/CaseDetailSidebar.vue     # menuItems 加 'memory' entry
app/components/caseDetail/CaseDetailBottomTabs.vue  # 5 + 1 ⋯ Drawer 菜单
app/components/ai/AiToolRenderer.vue                # 注册 3 个新工具卡片 v-else-if
```

**Implementation phases:**

```
Phase 1 · 类型与 DAO       Task 1-4   (1 day)
Phase 2 · 服务层           Task 5-7   (0.5 day)
Phase 3 · API 端点         Task 8-10  (0.5 day)
Phase 4 · afterAgent 中间件 Task 11-13 (0.5 day)
Phase 5 · 节点种子 + Prompt 改造 Task 14-17 (1 day)
Phase 6 · 前端 Composable + 主组件 Task 18-21 (1 day)
Phase 7 · 工具卡片         Task 22-25 (0.5 day)
Phase 8 · 案件详情页接入   Task 26-28 (0.5 day)
Phase 9 · 收尾             Task 29-30 (0.5 day)

总计：5-7 天
```

---

## Phase 1 · 类型与 DAO

### Task 1: 扩展 MemorySource 字符串字面量类型

**Files:**
- Modify: `shared/types/memory.ts`
- Modify: `server/services/memory/memory.service.ts`（MemoryWriteInput.source 类型联动）
- Test: `tests/server/memory/writeMemoryService.test.ts`（确保已有测试通过）

- [ ] **Step 1: 读现有类型**

Run: `cat shared/types/memory.ts | head -50`
Expected: 看到 `CaseMemoryMetadata.source: 'manual' | 'consolidator'` 的定义

- [ ] **Step 2: 修改 MemorySource 类型**

把 `shared/types/memory.ts` 里的 source 字面量联合扩展：

```ts
// 旧
source?: 'manual' | 'consolidator'

// 新
source?: 'manual' | 'consolidator' | 'auto_extract' | 'manual_user'
```

确保 `CaseMemoryMetadata.source` 和导出的所有相关类型都同步。

- [ ] **Step 3: 修改 memory.service.ts 的 MemoryWriteInput**

`server/services/memory/memory.service.ts` line 8-15 的 `MemoryWriteInput`:

```ts
export interface MemoryWriteInput {
  caseId: number
  kind: MemoryKind
  text: string
  subjectKey?: string
  confidence?: number
  source?: 'manual' | 'consolidator' | 'auto_extract' | 'manual_user'
}
```

- [ ] **Step 4: 跑现有测试确保不破坏**

Run: `npx vitest run tests/server/memory/writeMemoryService.test.ts`
Expected: PASS（类型扩展是向后兼容，旧代码不受影响）

- [ ] **Step 5: typecheck 单文件**

Run: `bunx tsc --noEmit shared/types/memory.ts server/services/memory/memory.service.ts 2>&1 | head -20`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add shared/types/memory.ts server/services/memory/memory.service.ts
git commit -m "feat(memory): MemorySource 类型扩展 auto_extract / manual_user

为案件记忆扩展铺路：
- auto_extract: afterAgent 异步提取
- manual_user: 用户手动添加（时间线 Tab）

零 DB schema 变更，仅 TypeScript 字符串字面量联合扩展。"
```

---

### Task 2: 抽出 findActiveMemoryBySubjectDAO（DRY 共用）

**Files:**
- Create: `server/services/memory/memory.dao.ts`
- Modify: `server/services/memory/memory.service.ts`（writeMemoryService 复用 DAO）
- Modify: `tests/server/assistant/test-db-helper.ts`（**前置：加 ensureTestCase 包装函数**）
- Test: `tests/server/memory/memory.dao.test.ts`

- [ ] **Step 0（前置：补 test-db-helper）**

`tests/server/assistant/test-db-helper.ts` 当前只有 `ensureTestUser` / `cleanupTestData`，**没有** `ensureTestCase`（实证：`grep "ensureTestCase" tests/server/assistant/test-db-helper.ts` 无结果）。

后续 Task 2-10 的所有测试都需要"创建测试案件"，所以在文件末尾追加：

```ts
/**
 * 创建测试案件（含 caseTypes 父记录）
 *
 * 案件记忆扩展（2026-04-28）测试用：返回 caseId 数字，
 * 内部维护 createdCaseIds / createdCaseTypeIds 让 cleanupTestData 一并清理。
 */
const createdCaseIds: number[] = []
const createdCaseTypeIds: number[] = []

export async function ensureTestCase(userId: number): Promise<number> {
    const p = getPrisma()
    const caseType = await p.caseTypes.create({
        data: { name: `测试案件类型_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, status: 1 },
    })
    createdCaseTypeIds.push(caseType.id)
    const caseRecord = await p.cases.create({
        data: {
            userId,
            caseTypeId: caseType.id,
            title: `测试案件_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            content: '案件记忆测试用例',
            status: 1,
        },
    })
    createdCaseIds.push(caseRecord.id)
    return caseRecord.id
}
```

同时**改写** `cleanupTestData` 末尾追加：

```ts
// case_memories cascade 软删（按 caseId 维度）
if (createdCaseIds.length > 0) {
    await p.$executeRawUnsafe(
        `DELETE FROM case_memories WHERE (metadata->>'caseId')::int = ANY($1::int[])`,
        createdCaseIds,
    )
    await p.cases.deleteMany({ where: { id: { in: createdCaseIds } } })
    createdCaseIds.length = 0
}
if (createdCaseTypeIds.length > 0) {
    await p.caseTypes.deleteMany({ where: { id: { in: createdCaseTypeIds } } })
    createdCaseTypeIds.length = 0
}
```

验证：`grep -A2 "export async function ensureTestCase" tests/server/assistant/test-db-helper.ts` 看到新函数。

- [ ] **Step 1: 写失败测试**

`tests/server/memory/memory.dao.test.ts`:

```ts
/**
 * memory.dao 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 软去重 DAO**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import { findActiveMemoryBySubjectDAO } from '~~/server/services/memory/memory.dao'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { ensureTestUser, cleanupTestData, ensureTestCase } from '../assistant/test-db-helper'

describe('findActiveMemoryBySubjectDAO', () => {
    let userId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        caseId = await ensureTestCase(userId)
    })

    afterEach(async () => {
        await prisma.$executeRaw`DELETE FROM case_memories WHERE metadata->>'caseId' = ${String(caseId)}`
        await cleanupTestData()
    })

    it('返回同 subjectKey 最新未失效记录', async () => {
        await writeMemoryService({ caseId, kind: 'fact', text: '原告住北京', subjectKey: 'plaintiff.address', source: 'manual' })
        const found = await findActiveMemoryBySubjectDAO(caseId, 'plaintiff.address')
        expect(found?.text).toBe('原告住北京')
    })

    it('subjectKey 不存在返回 null', async () => {
        const found = await findActiveMemoryBySubjectDAO(caseId, 'nonexistent.key')
        expect(found).toBeNull()
    })

    it('已失效记录不返回', async () => {
        await writeMemoryService({ caseId, kind: 'fact', text: '原告住北京', subjectKey: 'plaintiff.address', source: 'manual' })
        // 写入第二条同 subjectKey，第一条会被自动 invalidate
        await writeMemoryService({ caseId, kind: 'fact', text: '原告住上海', subjectKey: 'plaintiff.address', source: 'manual' })
        const found = await findActiveMemoryBySubjectDAO(caseId, 'plaintiff.address')
        expect(found?.text).toBe('原告住上海')  // 只返回最新的
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/memory/memory.dao.test.ts`
Expected: FAIL with "Cannot find module" 或类似（DAO 文件还不存在）

- [ ] **Step 3: 实现 memory.dao.ts**

`server/services/memory/memory.dao.ts`:

```ts
/**
 * 案件记忆 DAO 层
 *
 * 沿用 LangChain PGVectorStore 同构约束：业务字段在 metadata JSON。
 * 所有查询用 raw SQL（prisma JSONB 操作能力受限）。
 */
import { logger } from '#shared/utils/logger'

export interface MemoryRow {
    id: string
    text: string
    metadata: {
        caseId: number
        kind: string
        subjectKey?: string
        source?: string
        createdAt: string
        invalidatedAt?: string
        supersedes?: string
    }
}

/**
 * 查找指定案件 + subjectKey 的最新未失效记忆
 *
 * 用于：
 * - writeMemoryService 内部版本链（DRY 共用）
 * - afterAgent 软去重逻辑
 */
export async function findActiveMemoryBySubjectDAO(
    caseId: number,
    subjectKey: string,
): Promise<MemoryRow | null> {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; text: string; metadata: any }>>(
        `SELECT id, text, metadata FROM case_memories
         WHERE metadata->>'caseId' = $1
           AND metadata->>'subjectKey' = $2
           AND (metadata->>'invalidatedAt' IS NULL)
         ORDER BY metadata->>'createdAt' DESC
         LIMIT 1`,
        String(caseId),
        subjectKey,
    )
    if (rows.length === 0) return null
    return rows[0] as MemoryRow
}
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/memory/memory.dao.test.ts`
Expected: PASS（3 个测试全过）

- [ ] **Step 5: 重构 writeMemoryService 复用 DAO**

`server/services/memory/memory.service.ts` 替换 line 26-43 的内联 raw SQL：

```ts
// 旧（line 26-43 内联 raw SQL 查 supersedes）
let supersedes: string | undefined
if (input.subjectKey) {
    const prevRows = await prisma.$queryRawUnsafe(...)
    if (prevRows.length > 0) supersedes = prevRows[0]!.id
}

// 新（复用 DAO）
import { findActiveMemoryBySubjectDAO } from './memory.dao'

let supersedes: string | undefined
if (input.subjectKey) {
    const prev = await findActiveMemoryBySubjectDAO(input.caseId, input.subjectKey)
    if (prev) supersedes = prev.id
}
```

- [ ] **Step 6: 跑现有 writeMemoryService 测试确保不破坏**

Run: `npx vitest run tests/server/memory/writeMemoryService.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/services/memory/memory.dao.ts server/services/memory/memory.service.ts tests/server/memory/memory.dao.test.ts
git commit -m "feat(memory): 抽出 findActiveMemoryBySubjectDAO（DRY）

writeMemoryService:30-43 内联 raw SQL 抽到 dao 层共享：
- afterAgent 软去重需要同款查询
- 后续 GET API 可能也要复用
- 避免 metadata JSONB 查询 SQL 散落到 3 处"
```

---

### Task 3: listMemoriesDAO（GET API 用）

**Files:**
- Modify: `server/services/memory/memory.dao.ts`
- Modify: `tests/server/memory/memory.dao.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/server/memory/memory.dao.test.ts` 末尾追加：

```ts
import { listMemoriesDAO } from '~~/server/services/memory/memory.dao'

describe('listMemoriesDAO', () => {
    let userId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        caseId = await ensureTestCase(userId)
    })

    afterEach(async () => {
        await prisma.$executeRaw`DELETE FROM case_memories WHERE metadata->>'caseId' = ${String(caseId)}`
        await cleanupTestData()
    })

    it('按 createdAt DESC 返回；分页 limit 生效', async () => {
        for (let i = 0; i < 5; i++) {
            await writeMemoryService({ caseId, kind: 'fact', text: `事实${i}`, subjectKey: `key.${i}`, source: 'manual' })
            await new Promise(r => setTimeout(r, 10))  // 保证 createdAt 严格不同
        }
        const res = await listMemoriesDAO(caseId, { limit: 3 })
        expect(res.memories).toHaveLength(3)
        expect(res.memories[0]!.text).toBe('事实4')  // 最新的在前
        expect(res.nextCursor).toBeTruthy()
    })

    it('按 source 筛选', async () => {
        await writeMemoryService({ caseId, kind: 'fact', text: 'manual A', subjectKey: 'a', source: 'manual' })
        await writeMemoryService({ caseId, kind: 'fact', text: 'auto B', subjectKey: 'b', source: 'auto_extract' })
        const res = await listMemoriesDAO(caseId, { source: 'manual' })
        expect(res.memories).toHaveLength(1)
        expect(res.memories[0]!.text).toBe('manual A')
    })

    it('默认不含失效记录；includeInvalidated=true 包含', async () => {
        await writeMemoryService({ caseId, kind: 'fact', text: 'v1', subjectKey: 'x', source: 'manual' })
        await writeMemoryService({ caseId, kind: 'fact', text: 'v2', subjectKey: 'x', source: 'manual' })

        const r1 = await listMemoriesDAO(caseId, {})
        expect(r1.memories.map(m => m.text)).toEqual(['v2'])

        const r2 = await listMemoriesDAO(caseId, { includeInvalidated: true })
        expect(r2.memories.map(m => m.text).sort()).toEqual(['v1', 'v2'])
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/memory/memory.dao.test.ts`
Expected: FAIL with "listMemoriesDAO is not a function"

- [ ] **Step 3: 实现 listMemoriesDAO**

在 `server/services/memory/memory.dao.ts` 末尾追加：

```ts
export interface ListMemoriesOptions {
    source?: 'manual' | 'consolidator' | 'auto_extract' | 'manual_user'
    includeInvalidated?: boolean
    cursor?: string  // 形如 "<createdAt>|<id>"，游标分页
    limit?: number   // 默认 30，最大 100
}

export interface ListMemoriesResult {
    memories: MemoryRow[]
    nextCursor?: string
}

export async function listMemoriesDAO(
    caseId: number,
    options: ListMemoriesOptions = {},
): Promise<ListMemoriesResult> {
    const limit = Math.min(options.limit ?? 30, 100)

    // 构造 WHERE 子句
    const conditions: string[] = [`metadata->>'caseId' = $1`]
    const params: unknown[] = [String(caseId)]
    let nextParamIdx = 2

    if (!options.includeInvalidated) {
        conditions.push(`(metadata->>'invalidatedAt' IS NULL)`)
    }

    if (options.source) {
        conditions.push(`metadata->>'source' = $${nextParamIdx}`)
        params.push(options.source)
        nextParamIdx++
    }

    if (options.cursor) {
        // cursor: "<createdAt>|<id>"
        const [cursorTime, cursorId] = options.cursor.split('|')
        if (cursorTime && cursorId) {
            conditions.push(
                `(metadata->>'createdAt' < $${nextParamIdx} OR (metadata->>'createdAt' = $${nextParamIdx} AND id < $${nextParamIdx + 1}::uuid))`,
            )
            params.push(cursorTime, cursorId)
            nextParamIdx += 2
        }
    }

    const sql = `SELECT id, text, metadata FROM case_memories
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY metadata->>'createdAt' DESC, id DESC
                 LIMIT ${limit + 1}`  // +1 用于判断 hasMore

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; text: string; metadata: any }>>(sql, ...params)
    const hasMore = rows.length > limit
    const memories = (hasMore ? rows.slice(0, limit) : rows) as MemoryRow[]
    const nextCursor = hasMore && memories.length > 0
        ? `${memories[memories.length - 1]!.metadata.createdAt}|${memories[memories.length - 1]!.id}`
        : undefined

    return { memories, nextCursor }
}
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/memory/memory.dao.test.ts`
Expected: PASS（含 listMemoriesDAO 的 3 个测试 + 之前 findActiveMemoryBySubjectDAO 的 3 个测试 = 6 个全过）

- [ ] **Step 5: Commit**

```bash
git add server/services/memory/memory.dao.ts tests/server/memory/memory.dao.test.ts
git commit -m "feat(memory): 新增 listMemoriesDAO 时间倒序游标分页

支持 source 筛选 / includeInvalidated 切换 / cursor 分页。
游标形式 '<createdAt>|<id>' 保证唯一性（同时间戳并列时 id 兜底）。"
```

---

### Task 4: softDeleteMemoryDAO

**Files:**
- Modify: `server/services/memory/memory.dao.ts`
- Modify: `tests/server/memory/memory.dao.test.ts`

- [ ] **Step 1: 写失败测试**

在测试文件末尾追加：

```ts
import { softDeleteMemoryDAO } from '~~/server/services/memory/memory.dao'

describe('softDeleteMemoryDAO', () => {
    let userId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        caseId = await ensureTestCase(userId)
    })

    afterEach(async () => {
        await prisma.$executeRaw`DELETE FROM case_memories WHERE metadata->>'caseId' = ${String(caseId)}`
        await cleanupTestData()
    })

    it('软删后 metadata.invalidatedAt 被设；id 仍存在', async () => {
        const { id } = await writeMemoryService({ caseId, kind: 'fact', text: '待删除', subjectKey: 'kk', source: 'manual_user' })

        await softDeleteMemoryDAO(id)

        const rows = await prisma.$queryRawUnsafe<Array<{ metadata: any }>>(
            `SELECT metadata FROM case_memories WHERE id = $1::uuid`,
            id,
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]!.metadata.invalidatedAt).toBeTruthy()
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/memory/memory.dao.test.ts`
Expected: FAIL with "softDeleteMemoryDAO is not a function"

- [ ] **Step 3: 实现**

在 `memory.dao.ts` 末尾追加：

```ts
/**
 * 软删指定记忆条（设 metadata.invalidatedAt）
 *
 * 与 LangChain 同构表对齐——不用 prisma deletedAt（表无该列）。
 * 召回链路自动过滤 invalidatedAt（filterInvalidated=true）。
 */
export async function softDeleteMemoryDAO(memoryId: string): Promise<void> {
    await prisma.$executeRawUnsafe(
        `UPDATE case_memories
         SET metadata = jsonb_set(metadata, '{invalidatedAt}', to_jsonb($2::text))
         WHERE id = $1::uuid`,
        memoryId,
        new Date().toISOString(),
    )
}
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/memory/memory.dao.test.ts`
Expected: PASS（7 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add server/services/memory/memory.dao.ts tests/server/memory/memory.dao.test.ts
git commit -m "feat(memory): softDeleteMemoryDAO 软删走 metadata.invalidatedAt

LangChain 同构表无 deletedAt 列，软删走 metadata 更新。
召回链路（recallMemoryService 默认 filterInvalidated=true）自动过滤。"
```

---

## Phase 2 · 服务层

### Task 5: memoryExtraction 服务层（afterAgent 异步任务核心）

**Files:**
- Create: `server/services/memory/memoryExtraction.service.ts`
- Test: `tests/server/memory/memoryExtraction.service.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/server/memory/memoryExtraction.service.test.ts`:

```ts
/**
 * memoryExtraction 服务测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 afterAgent 异步任务核心逻辑**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runMemoryExtractionService } from '~~/server/services/memory/memoryExtraction.service'
import { ensureTestUser, ensureTestCase, cleanupTestData } from '../assistant/test-db-helper'

vi.mock('~~/server/services/agent-platform/tools/invokeNodeJson', () => ({
    invokeNodeJson: vi.fn(),
}))

import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'

describe('runMemoryExtractionService', () => {
    let userId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        caseId = await ensureTestCase(userId)
        vi.clearAllMocks()
    })

    afterEach(async () => {
        await prisma.$executeRaw`DELETE FROM case_memories WHERE metadata->>'caseId' = ${String(caseId)}`
        await cleanupTestData()
    })

    it('正常路径：节点返回 3 条，全部写入', async () => {
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({
            memories: [
                { text: '原告住北京', kind: 'fact', subject_key: 'plaintiff.address' },
                { text: '2024-03-15 签合同', kind: 'event', subject_key: 'contract.signed_at' },
                { text: '主张违约金', kind: 'decision', subject_key: 'strategy.claim' },
            ],
        })

        await runMemoryExtractionService({ caseId, sessionId: 'sess-1', messages: [{ role: 'user', content: '我的案件...' }] as any })

        const rows = await prisma.$queryRawUnsafe<Array<{ metadata: any }>>(
            `SELECT metadata FROM case_memories WHERE metadata->>'caseId' = $1`,
            String(caseId),
        )
        expect(rows).toHaveLength(3)
        expect(rows.every(r => r.metadata.source === 'auto_extract')).toBe(true)
    })

    it('软去重：同 subjectKey 文本相似（>0.9）跳过', async () => {
        // 先写一条 manual 的
        await prisma.$executeRawUnsafe(
            `INSERT INTO case_memories (id, text, metadata) VALUES (gen_random_uuid(), $1, $2::jsonb)`,
            '原告住北京',
            JSON.stringify({ caseId, kind: 'fact', subjectKey: 'plaintiff.address', source: 'manual', createdAt: new Date().toISOString() }),
        )

        // 节点返回非常相似的同 subjectKey
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({
            memories: [{ text: '原告住北京', kind: 'fact', subject_key: 'plaintiff.address' }],
        })

        await runMemoryExtractionService({ caseId, sessionId: 'sess-1', messages: [] })

        const rows = await prisma.$queryRawUnsafe<Array<{ metadata: any }>>(
            `SELECT metadata FROM case_memories WHERE metadata->>'caseId' = $1`,
            String(caseId),
        )
        expect(rows).toHaveLength(1)  // 没新增，软去重生效
        expect(rows[0]!.metadata.source).toBe('manual')
    })

    it('节点抛错时静默 catch（不抛给上层）', async () => {
        vi.mocked(invokeNodeJson).mockRejectedValueOnce(new Error('LLM down'))

        // 不应该抛错
        await expect(
            runMemoryExtractionService({ caseId, sessionId: 'sess-1', messages: [] }),
        ).resolves.toBeUndefined()
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/memory/memoryExtraction.service.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 memoryExtraction.service.ts**

`server/services/memory/memoryExtraction.service.ts`:

```ts
/**
 * 案件记忆异步提取服务
 *
 * 由 afterAgentMemory 中间件触发：当 LLM 主动调用 write/update_case_memory
 * 次数 < 3 时，本服务异步从对话历史中萃取关键事实并补写。
 *
 * 失败静默：以 logger.warn 记录，不抛给上层（防止 fire-and-forget
 * 的 .catch 走错路径）。
 */
import { z } from 'zod'
import { logger } from '#shared/utils/logger'
import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'
import { writeMemoryService } from './memory.service'
import { findActiveMemoryBySubjectDAO } from './memory.dao'
import { calcSimilarity } from '~~/server/agents/contract/utils/textSimilarity'
import type { BaseMessage } from '@langchain/core/messages'

const memoryExtractSchema = z.object({
    memories: z.array(z.object({
        text: z.string().min(1),
        kind: z.enum(['fact', 'event', 'decision', 'note']),
        subject_key: z.string().optional(),
    })),
})

export interface MemoryExtractionParams {
    caseId: number
    sessionId: string
    messages: BaseMessage[] | Array<{ role: string; content: string }>
}

const SIMILARITY_THRESHOLD = 0.9

export async function runMemoryExtractionService(params: MemoryExtractionParams): Promise<void> {
    const { caseId, sessionId, messages } = params

    try {
        // 仅取最近 20 条对话节省 prompt
        const recentMessages = messages.slice(-20)

        const result = await invokeNodeJson({
            nodeName: 'caseMemoryExtract',
            temperature: 0.3,
            schema: memoryExtractSchema,
            buildPrompt: (template) => template
                .replace('{{messages}}', JSON.stringify(recentMessages))
                .replace('{{caseId}}', String(caseId)),
            errorPrefix: 'caseMemoryExtract',
            logContext: { caseId, sessionId },
        })

        for (const m of result.memories) {
            // 软去重：同 subjectKey 已有 active 记忆且文本相似 → 跳过
            if (m.subject_key) {
                const existing = await findActiveMemoryBySubjectDAO(caseId, m.subject_key)
                if (existing && calcSimilarity(existing.text, m.text) > SIMILARITY_THRESHOLD) {
                    logger.debug('memoryExtraction 跳过相似条目', { caseId, subjectKey: m.subject_key })
                    continue
                }
            }

            await writeMemoryService({
                caseId,
                kind: m.kind as any,
                text: m.text,
                subjectKey: m.subject_key,
                source: 'auto_extract',
            })
        }

        logger.info('memoryExtraction 完成', { caseId, sessionId, candidates: result.memories.length })
    } catch (e) {
        logger.warn('memoryExtraction 失败，afterAgent 静默跳过', {
            caseId, sessionId, error: e instanceof Error ? e.message : String(e),
        })
    }
}
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/memory/memoryExtraction.service.test.ts`
Expected: PASS（3 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add server/services/memory/memoryExtraction.service.ts tests/server/memory/memoryExtraction.service.test.ts
git commit -m "feat(memory): memoryExtraction 服务实现 afterAgent 异步提取

调用 caseMemoryExtract 节点萃取事实清单 → 软去重 → 批量写入 source=auto_extract。
失败静默 logger.warn（fire-and-forget 友好）；阈值 0.9 复用 calcSimilarity。"
```

---

### Task 6: memorySubjectInfer 服务层（POST API 用）

**Files:**
- Create: `server/services/memory/memorySubjectInfer.service.ts`
- Test: `tests/server/memory/memorySubjectInfer.service.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/server/memory/memorySubjectInfer.service.test.ts`:

```ts
/**
 * memorySubjectInfer 服务测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.3 POST API subject_key 推断**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inferSubjectKeyService } from '~~/server/services/memory/memorySubjectInfer.service'

vi.mock('~~/server/services/agent-platform/tools/invokeNodeJson', () => ({
    invokeNodeJson: vi.fn(),
}))

import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'

describe('inferSubjectKeyService', () => {
    beforeEach(() => vi.clearAllMocks())

    it('节点返回 subject_key 时直接返回', async () => {
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({ subject_key: 'plaintiff.address' })
        const result = await inferSubjectKeyService('原告住北京朝阳')
        expect(result).toBe('plaintiff.address')
    })

    it('节点抛错时返回 null（POST API 走 fallback）', async () => {
        vi.mocked(invokeNodeJson).mockRejectedValueOnce(new Error('LLM down'))
        const result = await inferSubjectKeyService('某事实')
        expect(result).toBeNull()
    })

    it('节点返回空字符串时返回 null', async () => {
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({ subject_key: '' })
        const result = await inferSubjectKeyService('某事实')
        expect(result).toBeNull()
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/memory/memorySubjectInfer.service.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现**

`server/services/memory/memorySubjectInfer.service.ts`:

```ts
/**
 * subject_key 推断服务
 *
 * POST /api/v1/case/memories/by-case/:caseId 用：
 * 用户填了 text 但没填 subjectKey 时，调本服务让 LLM 推断"主体.字段"格式。
 *
 * 失败 fallback null（POST 写入空 subjectKey，不参与版本链）。
 */
import { z } from 'zod'
import { logger } from '#shared/utils/logger'
import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'

const subjectInferSchema = z.object({
    subject_key: z.string(),
})

export async function inferSubjectKeyService(text: string): Promise<string | null> {
    try {
        const result = await invokeNodeJson({
            nodeName: 'caseMemorySubjectInfer',
            temperature: 0.0,  // 输出确定性优先
            schema: subjectInferSchema,
            buildPrompt: (template) => template.replace('{{text}}', text),
            errorPrefix: 'caseMemorySubjectInfer',
        })
        const key = result.subject_key.trim()
        return key.length > 0 ? key : null
    } catch (e) {
        logger.warn('subject_key 推断失败，fallback null', { error: e instanceof Error ? e.message : String(e) })
        return null
    }
}
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/memory/memorySubjectInfer.service.test.ts`
Expected: PASS（3 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add server/services/memory/memorySubjectInfer.service.ts tests/server/memory/memorySubjectInfer.service.test.ts
git commit -m "feat(memory): memorySubjectInfer 服务推断 subject_key

POST /api/v1/case/memories/by-case 用：用户没填 subjectKey 时
调本服务让 LLM 推断'主体.字段'格式。失败 fallback null。"
```

---

### Task 7: 让 calcSimilarity 在 server 任意位置可用

**File:**
- 仅验证：`server/agents/contract/utils/textSimilarity.ts:24` 已存在

- [ ] **Step 1: 验证**

Run: `grep -n "export function calcSimilarity" server/agents/contract/utils/textSimilarity.ts`
Expected: `24:export function calcSimilarity(a: string, b: string): number {`

- [ ] **Step 2: 验证 import 不会因路径跨模块出问题**

Task 5 的 memoryExtraction.service.ts 已经从 `~~/server/agents/contract/utils/textSimilarity` 引入，跑 Task 5 测试时如果通过即可。

Run: `npx vitest run tests/server/memory/memoryExtraction.service.test.ts`
Expected: PASS（确认 import 无误）

**注**：未来如有更多模块引用 calcSimilarity 时再考虑提升到 `shared/utils/`，本期保持现状。

无需 commit（无文件改动）。

---

## Phase 3 · API 端点

### Task 8: GET /api/v1/case/memories/by-case/:caseId — 列表

**Files:**
- Create: `server/api/v1/case/memories/by-case/[caseId].get.ts`
- Test: `tests/server/api/case/memories/byCase.get.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/server/api/case/memories/byCase.get.test.ts`:

```ts
/**
 * GET /api/v1/case/memories/by-case/:caseId 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.3 GET API 权限 / 分页 / 筛选**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import handler from '~~/server/api/v1/case/memories/by-case/[caseId].get'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { ensureTestUser, ensureTestCase, cleanupTestData } from '../../../assistant/test-db-helper'

;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).getRouterParam = (e: any, k: string) => e.__params?.[k]
;(globalThis as any).getQuery = (e: any) => e.__query ?? {}

const makeEvent = (userId: number, caseId: number, query: any = {}) => ({
    context: { auth: { user: { id: userId } } },
    __params: { caseId: String(caseId) },
    __query: query,
}) as any

describe('GET /by-case/:caseId', () => {
    let userId: number
    let otherUserId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        otherUserId = await ensureTestUser('13900000000')
        caseId = await ensureTestCase(userId)
    })

    afterEach(async () => {
        await prisma.$executeRaw`DELETE FROM case_memories WHERE metadata->>'caseId' = ${String(caseId)}`
        await cleanupTestData()
    })

    it('未登录 → 401', async () => {
        const res = await handler({ context: { auth: {} }, __params: { caseId: String(caseId) } } as any)
        expect(res.code).toBe(401)
    })

    it('非 owner → 403', async () => {
        const res = await handler(makeEvent(otherUserId, caseId))
        expect(res.code).toBe(403)
    })

    it('owner 正常返回列表', async () => {
        await writeMemoryService({ caseId, kind: 'fact', text: 'A', subjectKey: 'a', source: 'manual' })
        await writeMemoryService({ caseId, kind: 'fact', text: 'B', subjectKey: 'b', source: 'manual' })

        const res = await handler(makeEvent(userId, caseId))
        expect(res.success).toBe(true)
        expect(res.data.memories).toHaveLength(2)
    })

    it('source 筛选', async () => {
        await writeMemoryService({ caseId, kind: 'fact', text: 'A', subjectKey: 'a', source: 'manual' })
        await writeMemoryService({ caseId, kind: 'fact', text: 'B', subjectKey: 'b', source: 'auto_extract' })

        const res = await handler(makeEvent(userId, caseId, { source: 'manual' }))
        expect(res.data.memories).toHaveLength(1)
        expect(res.data.memories[0]!.text).toBe('A')
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/api/case/memories/byCase.get.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 GET handler**

`server/api/v1/case/memories/by-case/[caseId].get.ts`:

```ts
/**
 * GET /api/v1/case/memories/by-case/:caseId
 *
 * 案件记忆时间线列表（按 createdAt 倒序，游标分页）。
 * 权限：仅案件 owner（归档案件允许查，与 search_case_memory 一致）。
 */
import { z } from 'zod'
import { listMemoriesDAO } from '~~/server/services/memory/memory.dao'

const querySchema = z.object({
    source: z.enum(['manual', 'consolidator', 'auto_extract', 'manual_user']).optional(),
    includeInvalidated: z.coerce.boolean().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const caseIdParam = getRouterParam(event, 'caseId')
    const caseId = Number(caseIdParam)
    if (!caseId || Number.isNaN(caseId)) {
        return resError(event, 400, '案件 ID 非法')
    }

    // 权限：owner-only（归档案件允许查）
    const caseRow = await prisma.cases.findUnique({
        where: { id: caseId, deletedAt: null },
        select: { userId: true },
    })
    if (!caseRow) return resError(event, 404, '案件不存在')
    if (caseRow.userId !== user.id) return resError(event, 403, '无权访问该案件')

    const queryRaw = getQuery(event)
    const parsed = querySchema.safeParse(queryRaw)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]!.message)
    }

    const result = await listMemoriesDAO(caseId, parsed.data)
    return resSuccess(event, '查询成功', result)
})
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/api/case/memories/byCase.get.test.ts`
Expected: PASS（4 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/case/memories/by-case/[caseId].get.ts tests/server/api/case/memories/byCase.get.test.ts
git commit -m "feat(memory): GET /api/v1/case/memories/by-case/:caseId 列表

Owner-only 权限；归档案件允许查；source 筛选 / includeInvalidated /
cursor 游标分页。zod 校验 query 参数。"
```

---

### Task 9: POST /api/v1/case/memories/by-case/:caseId — 用户添加

**Files:**
- Create: `server/api/v1/case/memories/by-case/[caseId].post.ts`
- Test: `tests/server/api/case/memories/byCase.post.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/server/api/case/memories/byCase.post.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import handler from '~~/server/api/v1/case/memories/by-case/[caseId].post'
import { ensureTestUser, ensureTestCase, cleanupTestData } from '../../../assistant/test-db-helper'

;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).getRouterParam = (e: any, k: string) => e.__params?.[k]
;(globalThis as any).readBody = async (e: any) => e.__body

vi.mock('~~/server/services/memory/memorySubjectInfer.service', () => ({
    inferSubjectKeyService: vi.fn(),
}))

import { inferSubjectKeyService } from '~~/server/services/memory/memorySubjectInfer.service'

const makeEvent = (userId: number, caseId: number, body: any) => ({
    context: { auth: { user: { id: userId } } },
    __params: { caseId: String(caseId) },
    __body: body,
}) as any

describe('POST /by-case/:caseId', () => {
    let userId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        caseId = await ensureTestCase(userId)
        vi.clearAllMocks()
    })

    afterEach(async () => {
        await prisma.$executeRaw`DELETE FROM case_memories WHERE metadata->>'caseId' = ${String(caseId)}`
        await cleanupTestData()
    })

    it('Body 校验失败 → 400', async () => {
        const res = await handler(makeEvent(userId, caseId, { text: '短' /* < 5 字 */, kind: 'fact' }))
        expect(res.code).toBe(400)
    })

    it('subjectKey 提供则直接写入', async () => {
        const res = await handler(makeEvent(userId, caseId, {
            text: '原告住北京朝阳区',
            kind: 'fact',
            subjectKey: 'plaintiff.address',
        }))
        expect(res.success).toBe(true)
        expect(res.data.subjectKey).toBe('plaintiff.address')
        expect(res.data.source).toBe('manual_user')
        expect(inferSubjectKeyService).not.toHaveBeenCalled()
    })

    it('subjectKey 缺失则调推断', async () => {
        vi.mocked(inferSubjectKeyService).mockResolvedValueOnce('contract.term')
        const res = await handler(makeEvent(userId, caseId, {
            text: '合同约定服务期 2 年',
            kind: 'fact',
        }))
        expect(res.success).toBe(true)
        expect(res.data.subjectKey).toBe('contract.term')
        expect(inferSubjectKeyService).toHaveBeenCalledWith('合同约定服务期 2 年')
    })

    it('推断失败 fallback null subjectKey', async () => {
        vi.mocked(inferSubjectKeyService).mockResolvedValueOnce(null)
        const res = await handler(makeEvent(userId, caseId, {
            text: '随手记一笔',
            kind: 'note',
        }))
        expect(res.success).toBe(true)
        expect(res.data.subjectKey).toBeNull()
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/api/case/memories/byCase.post.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 POST handler**

`server/api/v1/case/memories/by-case/[caseId].post.ts`:

```ts
/**
 * POST /api/v1/case/memories/by-case/:caseId
 *
 * 用户手动添加案件记忆（source=manual_user）。
 * subjectKey 留空时调 caseMemorySubjectInfer 节点推断。
 */
import { z } from 'zod'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { inferSubjectKeyService } from '~~/server/services/memory/memorySubjectInfer.service'
import { findActiveMemoryBySubjectDAO } from '~~/server/services/memory/memory.dao'

const bodySchema = z.object({
    text: z.string().min(5, '内容至少 5 字'),
    kind: z.enum(['fact', 'event', 'decision', 'note']),
    subjectKey: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const caseId = Number(getRouterParam(event, 'caseId'))
    if (!caseId || Number.isNaN(caseId)) return resError(event, 400, '案件 ID 非法')

    const caseRow = await prisma.cases.findUnique({
        where: { id: caseId, deletedAt: null },
        select: { userId: true },
    })
    if (!caseRow) return resError(event, 404, '案件不存在')
    if (caseRow.userId !== user.id) return resError(event, 403, '无权操作该案件')

    const body = await readBody(event)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return resError(event, 400, parsed.error.issues[0]!.message)

    let subjectKey: string | null = parsed.data.subjectKey ?? null
    if (!subjectKey) {
        subjectKey = await inferSubjectKeyService(parsed.data.text)
    }

    // assertCaseWritableService 内部已查归档状态（writeMemoryService 内调用）
    const { id } = await writeMemoryService({
        caseId,
        kind: parsed.data.kind,
        text: parsed.data.text,
        subjectKey: subjectKey ?? undefined,
        source: 'manual_user',
    })

    // 回查完整记录返回（前端立即更新时间线）
    const fresh = subjectKey ? await findActiveMemoryBySubjectDAO(caseId, subjectKey) : null
    return resSuccess(event, '添加成功', {
        id,
        text: parsed.data.text,
        kind: parsed.data.kind,
        subjectKey,
        source: 'manual_user',
        createdAt: fresh?.metadata.createdAt ?? new Date().toISOString(),
    })
})
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/api/case/memories/byCase.post.test.ts`
Expected: PASS（4 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/case/memories/by-case/[caseId].post.ts tests/server/api/case/memories/byCase.post.test.ts
git commit -m "feat(memory): POST /api/v1/case/memories/by-case/:caseId 用户添加

zod 校验 text >= 5 字、kind 枚举；subjectKey 留空调推断节点；
归档案件由 writeMemoryService 内的 assertCaseWritableService 拒绝。"
```

---

### Task 10: DELETE /api/v1/case/memories/:memoryId

**Files:**
- Create: `server/api/v1/case/memories/[memoryId].delete.ts`
- Test: `tests/server/api/case/memories/delete.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/server/api/case/memories/delete.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import handler from '~~/server/api/v1/case/memories/[memoryId].delete'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { ensureTestUser, ensureTestCase, cleanupTestData } from '../../../assistant/test-db-helper'

;(globalThis as any).resError = (_e: any, code: number, message: string) => ({ code, success: false, message, data: null })
;(globalThis as any).resSuccess = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })
;(globalThis as any).getRouterParam = (e: any, k: string) => e.__params?.[k]

const makeEvent = (userId: number, memoryId: string) => ({
    context: { auth: { user: { id: userId } } },
    __params: { memoryId },
}) as any

describe('DELETE /:memoryId', () => {
    let userId: number
    let otherUserId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        otherUserId = await ensureTestUser('13900000000')
        caseId = await ensureTestCase(userId)
    })

    afterEach(async () => {
        await prisma.$executeRaw`DELETE FROM case_memories WHERE metadata->>'caseId' = ${String(caseId)}`
        await cleanupTestData()
    })

    it('source=manual_user 且 owner → 软删 OK', async () => {
        const { id } = await writeMemoryService({ caseId, kind: 'fact', text: '我加的', source: 'manual_user' })

        const res = await handler(makeEvent(userId, id))
        expect(res.success).toBe(true)

        const rows = await prisma.$queryRawUnsafe<Array<{ metadata: any }>>(
            `SELECT metadata FROM case_memories WHERE id = $1::uuid`, id,
        )
        expect(rows[0]!.metadata.invalidatedAt).toBeTruthy()
    })

    it('source=manual（AI 写的）→ 403', async () => {
        const { id } = await writeMemoryService({ caseId, kind: 'fact', text: 'AI 写的', source: 'manual' })

        const res = await handler(makeEvent(userId, id))
        expect(res.code).toBe(403)
    })

    it('非案件 owner → 403', async () => {
        const { id } = await writeMemoryService({ caseId, kind: 'fact', text: '我加的', source: 'manual_user' })

        const res = await handler(makeEvent(otherUserId, id))
        expect(res.code).toBe(403)
    })

    it('memoryId 不存在 → 404', async () => {
        const res = await handler(makeEvent(userId, '00000000-0000-0000-0000-000000000000'))
        expect(res.code).toBe(404)
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/api/case/memories/delete.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 DELETE handler**

`server/api/v1/case/memories/[memoryId].delete.ts`:

```ts
/**
 * DELETE /api/v1/case/memories/:memoryId
 *
 * 严格限制：仅 source='manual_user' + 案件 owner 可删。
 * 软删：jsonb_set(metadata, '{invalidatedAt}', now)。
 */
import { softDeleteMemoryDAO } from '~~/server/services/memory/memory.dao'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const memoryId = getRouterParam(event, 'memoryId')
    if (!memoryId) return resError(event, 400, '记忆 ID 缺失')

    // 查记忆元数据：caseId + source
    const rows = await prisma.$queryRawUnsafe<Array<{ caseId: number | null; source: string | null }>>(
        `SELECT (metadata->>'caseId')::int as "caseId", metadata->>'source' as "source"
         FROM case_memories WHERE id = $1::uuid`,
        memoryId,
    )
    if (rows.length === 0) return resError(event, 404, '记忆不存在')

    const { caseId, source } = rows[0]!
    if (source !== 'manual_user') {
        return resError(event, 403, '该记忆不可删除（仅可删除自己手动添加的）')
    }

    if (!caseId) return resError(event, 500, '记忆数据异常：缺 caseId')

    // 校验案件 owner
    const caseRow = await prisma.cases.findUnique({
        where: { id: caseId, deletedAt: null },
        select: { userId: true },
    })
    if (!caseRow) return resError(event, 404, '关联案件不存在')
    if (caseRow.userId !== user.id) return resError(event, 403, '无权操作该案件')

    await softDeleteMemoryDAO(memoryId)
    return resSuccess(event, '删除成功', { id: memoryId })
})
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/api/case/memories/delete.test.ts`
Expected: PASS（4 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/case/memories/[memoryId].delete.ts tests/server/api/case/memories/delete.test.ts
git commit -m "feat(memory): DELETE /api/v1/case/memories/:memoryId 软删

严格限制 source='manual_user' + 案件 owner；其他来源 403。
软删走 metadata.invalidatedAt（与 LangChain 同构表对齐）。"
```

---

## Phase 4 · afterAgent 中间件

### Task 11: countToolCalls helper

**Files:**
- Create: `server/services/agent-platform/middleware/utils/countToolCalls.ts`
- Test: `tests/server/agent-platform/middleware/utils/countToolCalls.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/server/agent-platform/middleware/utils/countToolCalls.test.ts`:

```ts
/**
 * countToolCalls 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 跳过阈值判断**
 */
import { describe, it, expect } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { countToolCalls } from '~~/server/services/agent-platform/middleware/utils/countToolCalls'

describe('countToolCalls', () => {
    it('对 AIMessage.tool_calls 中的指定工具计数', () => {
        const messages = [
            new HumanMessage('hi'),
            new AIMessage({ content: '', tool_calls: [
                { id: '1', name: 'write_case_memory', args: {} },
                { id: '2', name: 'search_law', args: {} },
            ] }),
            new AIMessage({ content: '', tool_calls: [
                { id: '3', name: 'update_case_memory', args: {} },
                { id: '4', name: 'write_case_memory', args: {} },
            ] }),
        ]
        const count = countToolCalls(messages, ['write_case_memory', 'update_case_memory'])
        expect(count).toBe(3)  // 2 write + 1 update
    })

    it('messages 为空返回 0', () => {
        expect(countToolCalls([], ['write_case_memory'])).toBe(0)
    })

    it('无匹配工具返回 0', () => {
        const messages = [new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'search_law', args: {} }] })]
        expect(countToolCalls(messages, ['write_case_memory'])).toBe(0)
    })

    it('plain object 形式的 messages 也支持', () => {
        const messages = [
            { tool_calls: [{ name: 'write_case_memory' }] },
        ] as any
        expect(countToolCalls(messages, ['write_case_memory'])).toBe(1)
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/server/agent-platform/middleware/utils/countToolCalls.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现**

`server/services/agent-platform/middleware/utils/countToolCalls.ts`:

```ts
/**
 * 统计 messages 数组中指定工具被调用的次数
 *
 * 支持 LangChain BaseMessage 实例（含 tool_calls 字段）
 * 也支持 plain object 形式（LangGraph SDK 序列化后）。
 */
export function countToolCalls(
    messages: Array<{ tool_calls?: Array<{ name?: string }> }> | undefined | null,
    targetNames: string[],
): number {
    if (!messages || messages.length === 0) return 0
    const targetSet = new Set(targetNames)
    let count = 0
    for (const msg of messages) {
        const calls = (msg as any).tool_calls
        if (!Array.isArray(calls)) continue
        for (const call of calls) {
            if (call?.name && targetSet.has(call.name)) count++
        }
    }
    return count
}
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/server/agent-platform/middleware/utils/countToolCalls.test.ts`
Expected: PASS（4 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add server/services/agent-platform/middleware/utils/countToolCalls.ts tests/server/agent-platform/middleware/utils/countToolCalls.test.ts
git commit -m "feat(memory): countToolCalls helper 工具调用次数统计

支持 BaseMessage 类实例 + plain object 双轨（LangGraph SDK 兼容）。
afterAgentMemory 中间件用此判断 N=3 跳过阈值。"
```

---

### Task 12: afterAgentMemory 中间件

**Files:**
- Create: `server/services/agent-platform/middleware/afterAgentMemory.middleware.ts`
- Test: `tests/server/agent-platform/middleware/afterAgentMemory.middleware.test.ts`

- [ ] **Step 1: 阅读现有先例**

Run: `cat server/agents/case-module/middleware/analysisResultPersistence.middleware.ts | head -180`
Expected: 看到 `afterAgent: { handler: async (state, runtime) => { ... } }` 的标准模式

- [ ] **Step 2: 写失败测试**

`tests/server/agent-platform/middleware/afterAgentMemory.middleware.test.ts`:

```ts
/**
 * afterAgentMemory 中间件测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 跳过逻辑 + 异步 fire-and-forget**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'

vi.mock('~~/server/services/memory/memoryExtraction.service', () => ({
    runMemoryExtractionService: vi.fn(),
}))

import { runMemoryExtractionService } from '~~/server/services/memory/memoryExtraction.service'

describe('afterAgentMemoryMiddleware', () => {
    beforeEach(() => vi.clearAllMocks())

    it('write+update >= 3 次：跳过提取', async () => {
        const mw = afterAgentMemoryMiddleware({ caseId: 1, sessionId: 'sess-1', userId: 1 })
        const state = {
            messages: [
                new AIMessage({ content: '', tool_calls: [
                    { id: '1', name: 'write_case_memory', args: {} },
                    { id: '2', name: 'write_case_memory', args: {} },
                    { id: '3', name: 'update_case_memory', args: {} },
                ] }),
            ],
        }

        await mw.afterAgent!.hook!(state as any, {} as any)

        expect(runMemoryExtractionService).not.toHaveBeenCalled()
    })

    it('write+update < 3 次：异步触发提取', async () => {
        vi.mocked(runMemoryExtractionService).mockResolvedValueOnce(undefined)
        const mw = afterAgentMemoryMiddleware({ caseId: 1, sessionId: 'sess-1', userId: 1 })
        const state = {
            messages: [
                new AIMessage({ content: '', tool_calls: [
                    { id: '1', name: 'write_case_memory', args: {} },
                ] }),
            ],
        }

        await mw.afterAgent!.hook!(state as any, {} as any)

        // 异步任务通过 void 触发，等微任务队列
        await new Promise(r => setImmediate(r))
        expect(runMemoryExtractionService).toHaveBeenCalledTimes(1)
        expect(runMemoryExtractionService).toHaveBeenCalledWith({
            caseId: 1,
            sessionId: 'sess-1',
            messages: state.messages,
        })
    })

    it('提取任务抛错时静默吞（不抛给上层）', async () => {
        vi.mocked(runMemoryExtractionService).mockRejectedValueOnce(new Error('LLM down'))
        const mw = afterAgentMemoryMiddleware({ caseId: 1, sessionId: 'sess-1', userId: 1 })
        const state = { messages: [] }

        // 不抛错
        await expect(mw.afterAgent!.hook!(state as any, {} as any)).resolves.toBeUndefined()
    })
})
```

- [ ] **Step 3: 跑测试看到失败**

Run: `npx vitest run tests/server/agent-platform/middleware/afterAgentMemory.middleware.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: 实现中间件**

`server/services/agent-platform/middleware/afterAgentMemory.middleware.ts`:

```ts
/**
 * afterAgentMemory 中间件
 *
 * 当 LLM 自觉调用 write/update_case_memory 总次数 < 3 时，
 * 启动异步任务调 caseMemoryExtract 节点兜底提取关键事实。
 *
 * fire-and-forget 异步：不阻塞 agent 响应；失败仅 log。
 *
 * 参考：server/agents/case-module/middleware/analysisResultPersistence.middleware.ts
 */
import { createMiddleware } from 'langchain'
import { logger } from '#shared/utils/logger'
import { countToolCalls } from './utils/countToolCalls'
import { runMemoryExtractionService } from '~~/server/services/memory/memoryExtraction.service'

export interface AfterAgentMemoryCtx {
    caseId: number
    sessionId: string
    userId: number
}

const SKIP_THRESHOLD = 3

export const afterAgentMemoryMiddleware = (ctx: AfterAgentMemoryCtx) => createMiddleware({
    name: 'afterAgentMemory',
    afterAgent: {
        hook: async (state: any, _runtime: any) => {
            try {
                const writeCount = countToolCalls(state.messages, [
                    'write_case_memory',
                    'update_case_memory',
                ])

                if (writeCount >= SKIP_THRESHOLD) {
                    logger.debug('afterAgentMemory 跳过（LLM 自觉率达标）', {
                        caseId: ctx.caseId, sessionId: ctx.sessionId, writeCount,
                    })
                    return
                }

                // fire-and-forget：不阻塞响应返回
                void runMemoryExtractionService({
                    caseId: ctx.caseId,
                    sessionId: ctx.sessionId,
                    messages: state.messages,
                }).catch(e => logger.warn('afterAgentMemory extraction failed', {
                    caseId: ctx.caseId, sessionId: ctx.sessionId, error: e,
                }))
            } catch (e) {
                // 中间件本身的异常静默；不影响主响应
                logger.warn('afterAgentMemory handler 异常', {
                    caseId: ctx.caseId, sessionId: ctx.sessionId, error: e,
                })
            }
        },
    },
})
```

- [ ] **Step 5: 跑测试看到通过**

Run: `npx vitest run tests/server/agent-platform/middleware/afterAgentMemory.middleware.test.ts`
Expected: PASS（3 个测试全过）

- [ ] **Step 6: Commit**

```bash
git add server/services/agent-platform/middleware/afterAgentMemory.middleware.ts tests/server/agent-platform/middleware/afterAgentMemory.middleware.test.ts
git commit -m "feat(memory): afterAgentMemory 中间件

LangChain v1.3 原生 createMiddleware afterAgent hook。
write+update >= 3 次跳过；否则 fire-and-forget 异步提取。
catch 静默吞错避免影响主响应。"
```

---

### Task 13: 把 afterAgentMemory 挂到 9 个案件相关 vertical

**Files:**
- Modify: `server/agents/case-main/agent.config.ts`
- Modify: `server/agents/case-module/agent.config.ts` 或对应 customMiddlewares 注册位置（**先调研**）
- Modify: `server/agents/case-analysis/runAnalysisSubAgent.ts`（如果 runAnalysisSubAgent 是分析模块的中间件挂载点）
- Modify: `server/agents/document/agent.config.ts`（caseId 非空时挂）
- Modify: `server/agents/contract/agent.config.ts`（caseId 非空时挂）

- [ ] **Step 1: 调研 9 个 vertical 实际中间件挂载点**

Run: `grep -rn "customMiddlewares" server/agents/{case-main,case-module,case-analysis,document,contract,legal-assistant}/ 2>&1`
预期看到：每个 vertical 的 `agent.config.ts` 或子文件用 `customMiddlewares: async (ctx) => [...]` 注册中间件。

特别核对 case-module / case-analysis（这两个走 stateGraph 路径，挂载点可能不在 agent.config.ts）。

- [ ] **Step 2: case-main 挂载（最简单的入口）**

修改 `server/agents/case-main/agent.config.ts` 的 `customMiddlewares`：

```ts
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'
import { MiddlewarePriority } from '~~/server/services/agent-platform/middleware/types'

// 在 customMiddlewares 数组中追加
{
    priority: MiddlewarePriority.RESULT_PERSISTENCE,  // 与 analysisResultPersistence 同优先级
    middleware: afterAgentMemoryMiddleware({
        caseId: ctx.caseId!,
        sessionId: ctx.sessionId,
        userId: ctx.userId,
    }),
},
```

注意：caseMain 必有 caseId（运行时校验），可以直接用 `ctx.caseId!`。

- [ ] **Step 3: case-module 挂载**

case-module 走 stateGraph 路径，agent.config.ts 委托给 `runModuleChat`。需要确认中间件实际挂在 `runModuleChat`（`server/services/workflow/agents/moduleAgent.ts`）的中间件列表里。

修改 `moduleAgent.ts`（参考 Step 1 调研结果），在中间件数组里追加：

```ts
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'

// 在 buildMiddlewareStack 调用前的数组里
{
    priority: MiddlewarePriority.RESULT_PERSISTENCE,
    middleware: afterAgentMemoryMiddleware({ caseId, sessionId, userId }),
},
```

- [ ] **Step 4: case-analysis 挂载**

`server/agents/case-analysis/runAnalysisSubAgent.ts` 是分析模块 ReAct 子图的中间件管道入口（spec §3.1 提到）。在它的中间件数组里追加同款挂载。

参考 case-module 同款代码，注意 ctx 结构是否同（看现有挂载方式 caseProcessMaterial / caseMaterialContext 怎么传 caseId）。

- [ ] **Step 5: document 挂载（caseId 非空时）**

`server/agents/document/agent.config.ts` 的 customMiddlewares：

```ts
async (ctx) => {
    const middlewares = [/* 现有 */]
    if (ctx.caseId) {
        middlewares.push({
            priority: MiddlewarePriority.RESULT_PERSISTENCE,
            middleware: afterAgentMemoryMiddleware({
                caseId: ctx.caseId,
                sessionId: ctx.sessionId,
                userId: ctx.userId,
            }),
        })
    }
    return middlewares
}
```

caseId 为空时（通用问答起的草稿）不挂，避免无意义调用。

- [ ] **Step 6: contract 挂载（caseId 非空时）**

同 Step 5 的逻辑，挂在 `server/agents/contract/agent.config.ts`。

- [ ] **Step 7: legal-assistant 不挂**

legal-assistant 的 caseId 永远为 null（D8），不挂 afterAgentMemory。仅在 agent.config.ts 加注释说明。

- [ ] **Step 8: 跑各 vertical 现有测试确保不破坏**

Run: `npx vitest run tests/server/agents/case-main/ tests/server/agents/case-module/ tests/server/agents/case-analysis/ tests/server/agents/document/ tests/server/agents/contract/`
Expected: 全部 PASS（中间件追加不影响现有逻辑）

- [ ] **Step 9: Commit**

```bash
git add server/agents/case-main/agent.config.ts server/services/workflow/agents/moduleAgent.ts server/agents/case-analysis/runAnalysisSubAgent.ts server/agents/document/agent.config.ts server/agents/contract/agent.config.ts
git commit -m "feat(memory): 5 个案件相关 vertical 挂入 afterAgentMemory 中间件

caseMain / caseModule / caseAnalysis / document（caseId非空）/ contract（caseId非空）
legal-assistant 不挂（caseId 永远为 null）。"
```

---

## Phase 5 · 节点种子 + Prompt 改造

### Task 14: seedData.sql 加 caseMemoryExtract / caseMemorySubjectInfer 两个节点

**Files:**
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 找 nodes 表当前最大 id**

Run: `grep -E "INSERT INTO \"public\"\.\"nodes\"" prisma/seeds/seedData.sql | grep -oE "VALUES \(([0-9]+)" | sort -t'(' -k2 -n | tail -3`
Expected: 看到当前最大 id（如 21），下一个用 22 / 23

- [ ] **Step 2: 在 seedData.sql 节点段末尾追加 2 行**

找到 nodes 表 INSERT 段末尾（其他节点 INSERT 完结的位置），追加：

```sql
-- caseMemoryExtract 节点（afterAgent 异步提取案件记忆用）
INSERT INTO "public"."nodes" ("id", "name", "title", "description", "type", "priority", "model_id", "tools", "output_schema", "group_id", "status", "created_at", "updated_at", "deleted_at") VALUES (22, 'caseMemoryExtract', '案件记忆提取', '从一轮 agent 对话历史中识别用户提到的关键事实、事件、决策，输出可写入案件记忆的清单', 'extraction', 100, 1, '[]', '{"type": "object", "required": ["memories"], "properties": {"memories": {"type": "array", "items": {"type": "object", "required": ["text", "kind"], "properties": {"text": {"type": "string", "description": "事实文本"}, "kind": {"enum": ["fact", "event", "decision", "note"], "description": "类型"}, "subject_key": {"type": "string", "description": "主体.字段格式（可选）"}}}}}}', NULL, 1, '2026-04-28 10:00:00+08', '2026-04-28 10:00:00+08', NULL) ON CONFLICT (name) DO NOTHING;

-- caseMemorySubjectInfer 节点（用户手动添加表单 subject_key 推断用）
INSERT INTO "public"."nodes" ("id", "name", "title", "description", "type", "priority", "model_id", "tools", "output_schema", "group_id", "status", "created_at", "updated_at", "deleted_at") VALUES (23, 'caseMemorySubjectInfer', '案件记忆 subject_key 推断', '基于用户填写的事实文本推断「主体.字段」格式的 subjectKey', 'extraction', 100, 1, '[]', '{"type": "object", "required": ["subject_key"], "properties": {"subject_key": {"type": "string", "description": "推断的主体.字段；无法推断时返回空字符串"}}}', NULL, 1, '2026-04-28 10:00:00+08', '2026-04-28 10:00:00+08', NULL) ON CONFLICT (name) DO NOTHING;
```

注意：`model_id=1` 沿用主力模型；具体 id 后台可调。

- [ ] **Step 3: 跑节点扫描确认数据完整**

Run: `grep -A1 "INSERT INTO \"public\"\.\"nodes\".*caseMemoryExtract" prisma/seeds/seedData.sql`
Expected: 看到刚加的 INSERT 行

- [ ] **Step 4: Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(memory): seedData 新增 caseMemoryExtract / caseMemorySubjectInfer 节点

type=extraction，model_id=1 主力模型，tools=[] 内部 LLM 任务。
output_schema 对齐 server/services/memory 的 zod schema。"
```

---

### Task 15: seedData.sql 加 2 条 prompts

**Files:**
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 找 prompts 表当前最大 id**

Run: `grep -E "INSERT INTO \"public\"\.\"prompts\"" prisma/seeds/seedData.sql | grep -oE "VALUES \(([0-9]+)" | sort -t'(' -k2 -n | tail -3`
Expected: 看到当前最大 id

- [ ] **Step 2: 在 seedData.sql prompts 段末尾追加**

```sql
-- caseMemoryExtract system prompt
INSERT INTO "public"."prompts" ("id", "name", "title", "content", "variables", "version", "type", "status", "node_id", "created_at", "updated_at", "deleted_at") VALUES (40, 'caseMemoryExtract_system', '案件记忆提取系统提示词', E'你是案件记忆提取助手。从下面这段 agent 对话历史中，识别用户提到的"关键事实"，输出可写入案件记忆库的条目清单。

## 识别规则
- **事实（fact）**：当事人信息、住址、电话、身份证、合同条款、关键日期、金额等可核验的客观陈述
- **事件（event）**：发生过的事情（签合同、付款、违约、起诉等），通常带时间
- **决策（decision）**：律师 / 用户做出的判断或下一步策略
- **笔记（note）**：以上都不是但需要记录的零散信息

## subject_key 命名规范（重要）
用「主体.字段」点分格式。常用前缀：
- plaintiff.* / defendant.* — 当事人信息
- contract.* — 合同条款
- dispute.* — 争议焦点
- evidence.* — 证据
- strategy.* — 诉讼策略
- timeline.* — 关键时间节点

例：plaintiff.address / contract.term / dispute.focus / strategy.claim_basis

不确定时可省略（输出时不带 subject_key 字段）。

## 输出要求
- 仅输出 JSON 对象，结构：`{ "memories": [...] }`
- 每条 memory：`{ "text": "...", "kind": "fact|event|decision|note", "subject_key": "..." (可选) }`
- 没有可识别的事实时输出空数组：`{ "memories": [] }`
- 单条 text 控制 50-200 字
- 同一 subject_key 不重复输出（取最详尽的一条）

## 对话历史
{{messages}}

## caseId（参考用）
{{caseId}}', '["messages", "caseId"]', 'v1', 'system', 1, 22, '2026-04-28 10:00:00+08', '2026-04-28 10:00:00+08', NULL) ON CONFLICT (name) DO NOTHING;

-- caseMemorySubjectInfer system prompt
INSERT INTO "public"."prompts" ("id", "name", "title", "content", "variables", "version", "type", "status", "node_id", "created_at", "updated_at", "deleted_at") VALUES (41, 'caseMemorySubjectInfer_system', 'subject_key 推断系统提示词', E'你的任务是基于一段事实文本，推断它属于"哪个主体的哪个字段"，输出 subject_key（点分格式）。

## 命名规范
用「主体.字段」格式。常用前缀：
- plaintiff.* / defendant.* — 当事人
- contract.* — 合同
- dispute.* — 争议焦点
- evidence.* — 证据
- strategy.* — 诉讼策略
- timeline.* — 时间节点

## 推断规则
- 文本里明确提到主体（"原告"、"被告"、"协议第 X 条"）时优先用对应前缀
- 不确定时输出空字符串 `""`，让系统 fallback 不带 subject_key
- 字段名用英文 camelCase（address, signedAt, term, focus）

## 输出
仅 JSON：`{ "subject_key": "..." }`

## 待推断文本
{{text}}', '["text"]', 'v1', 'system', 1, 23, '2026-04-28 10:00:00+08', '2026-04-28 10:00:00+08', NULL) ON CONFLICT (name) DO NOTHING;
```

注意：`E'...'` 是 PostgreSQL escape string，反斜杠和中文都没问题。

- [ ] **Step 3: 验证 SQL 语法**

Run: `psql -U daixin -d ls_new_testing -c "BEGIN; \$(sed -n '/^-- caseMemoryExtract system prompt/,/manual_user/p' prisma/seeds/seedData.sql | head -2); ROLLBACK;" 2>&1 | head -5`
Expected: 不报语法错误

（如本地无 psql，可跳过此步骤；Lead 同步时再试）

- [ ] **Step 4: Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(memory): seedData 新增 2 条 system prompts

caseMemoryExtract_system 含识别规则 + subject_key 命名规范 + 输出格式
caseMemorySubjectInfer_system 简单的 subject_key 推断 prompt
"
```

---

### Task 16: seedData.sql 改 8 个节点的 nodes.tools 加记忆三件套

**Files:**
- Modify: `prisma/seeds/seedData.sql`

caseMain (id=5) 已经配了 search/write/update_case_memory。本任务给其余 11 个节点加（共 12 个案件相关节点）：

| nodeId | name | 现 tools | 目标 tools（新增 3 工具）|
|---|---|---|---|
| 1 | caseInfoCheck | `["search_case_materials"]` | + 3 工具 |
| 2 | extractInfo | `["search_case_materials"]` | + 3 工具 |
| 6 | summary | `["search_case_materials", "search_law"]` | + 3 工具 |
| 7 | chronicle | + 3 工具 |
| 8 | claim | + 3 工具 |
| 9 | trend | + 3 工具 |
| 10 | cause | + 3 工具 |
| 11 | defense | + 3 工具 |
| 12 | evidence | + 3 工具 |
| 17 | documentMain | + 3 工具 |
| 18 | contractReviewMain | + 3 工具 |

- [ ] **Step 1: 在 seedData.sql 末尾追加 UPDATE 段**

```sql
-- ============================================================
-- 案件记忆扩展（2026-04-28）：9 个案件相关节点接通三件套
-- ============================================================
-- 当前 caseMain (id=5) 已配，给其余 10 个节点 nodes.tools 加上：
--   search_case_memory / write_case_memory / update_case_memory

-- caseInfoCheck (id=1) — 案情信息检查
UPDATE "public"."nodes" SET tools = '["search_case_materials", "search_case_memory", "write_case_memory", "update_case_memory"]'
WHERE id = 1 AND deleted_at IS NULL;

-- extractInfo (id=2) — 基本信息提取
UPDATE "public"."nodes" SET tools = '["search_case_materials", "search_case_memory", "write_case_memory", "update_case_memory"]'
WHERE id = 2 AND deleted_at IS NULL;

-- 7 个分析模块（id 6-12）
UPDATE "public"."nodes" SET tools = '["search_case_materials", "search_law", "search_case_memory", "write_case_memory", "update_case_memory"]'
WHERE id = 6 AND deleted_at IS NULL;

UPDATE "public"."nodes" SET tools = '["search_case_materials", "search_law", "process_materials", "search_case_memory", "write_case_memory", "update_case_memory"]'
WHERE id IN (7, 8, 9, 11, 12) AND deleted_at IS NULL;

UPDATE "public"."nodes" SET tools = '["search_law", "search_case_materials", "process_materials", "search_case_memory", "write_case_memory", "update_case_memory"]'
WHERE id = 10 AND deleted_at IS NULL;

-- documentMain (id=17)
UPDATE "public"."nodes" SET tools = '["process_materials", "search_case_materials", "search_law", "search_case_memory", "write_case_memory", "update_case_memory"]'
WHERE id = 17 AND deleted_at IS NULL;

-- contractReviewMain (id=18)
UPDATE "public"."nodes" SET tools = '["parse_and_ask_stance", "search_law", "search_case_memory", "write_case_memory", "update_case_memory"]'
WHERE id = 18 AND deleted_at IS NULL;
```

注意：每个节点的 tools 数组要保留**现有工具**，仅在末尾追加 3 个记忆工具。本 Step 已经包含完整的目标 tools 字符串。

- [ ] **Step 2: 运行 SQL 在 dev 库验证（可选）**

Run: `docker exec ls_postgres psql -U daixin -d ls_new -c "SELECT id, tools FROM nodes WHERE id IN (1,2,6,7,8,9,10,11,12,17,18) ORDER BY id;" 2>&1 | head -15`
Expected: dev 库还是旧 tools（未跑 SQL），仅是审查 SQL 写法

- [ ] **Step 3: Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(memory): 10 个案件相关节点 tools 加记忆三件套

caseInfoCheck / extractInfo / 7 个分析模块 / documentMain / contractReviewMain
都加 search_case_memory / write_case_memory / update_case_memory。
caseMain (id=5) 已有，不改。"
```

---

### Task 17: seedData.sql 改 9 个节点的 prompts 加铁律段

**Files:**
- Modify: `prisma/seeds/seedData.sql`

每个节点对应的 system prompt 末尾加"案件记忆使用规则（铁律）"段。

- [ ] **Step 1: 找各节点的 prompt（status=1 的最新版）**

Run: `grep -nE "name = '(caseMain|summary|chronicle|claim|trend|cause|defense|evidence|caseInfoCheck|extractInfo|documentMain|contractReviewMain)_system'" prisma/seeds/seedData.sql | head -20`
Expected: 列出每个节点的 prompts INSERT 行号

- [ ] **Step 2: 在 seedData.sql 末尾追加铁律 UPDATE**

```sql
-- ============================================================
-- 案件记忆铁律段（追加到 9 个案件相关节点的 prompts.content）
-- ============================================================

-- caseMain (prompt id=30, v4) - 已经有"案件记忆使用规则"段（D2-D7 brainstorming 后），但用户层面引导不够强
-- 用 v5 版本替换：
UPDATE "public"."prompts"
SET content = content || E'\n\n# 案件记忆使用规则（铁律）\n- 每轮回答前必须先调 search_case_memory 检索相关历史（除非问的是与本案无关的公开法律知识）\n- 用户给出新事实（当事人/住址/合同条款/关键日期/争议焦点）时，必须 write_case_memory；subject_key 用「主体.字段」格式（如 plaintiff.address、contract.term、dispute.focus）\n- 用户更正之前事实时，必须 update_case_memory 标记旧记录失效并写新记录\n- 同一 subject_key 一次对话内不重复写入；先 search 再决定 write 或 update'
WHERE name = 'caseMain_system' AND status = 1
  AND content NOT LIKE '%案件记忆使用规则（铁律）%';  -- 幂等保护：seedData 重复执行不累加

-- 7 个分析模块 + caseInfoCheck + extractInfo（共 9 个）
UPDATE "public"."prompts"
SET content = content || E'\n\n# 案件记忆使用规则\n- 分析过程中如发现关键事实（争议焦点、关键时间节点、当事人信息修正），必须 write_case_memory 写入；subject_key 用「主体.字段」格式\n- 引用历史结论时，先 search_case_memory 而非自行推断\n- 同一 subject_key 不重复写入；先 search 再决定 write 或 update'
WHERE name IN (
  'summary_system', 'chronicle_system', 'claim_system', 'trend_system', 'cause_system',
  'defense_system', 'evidence_system', 'caseInfoCheck_system', 'extractInfo_system'
) AND status = 1
  AND content NOT LIKE '%案件记忆使用规则%';  -- 幂等保护

-- documentMain / contractReviewMain（caseId 非空时才用记忆，prompt 加条件说明）
UPDATE "public"."prompts"
SET content = content || E'\n\n# 案件记忆使用规则\n- 仅当 caseId 非空（绑定了案件）时使用记忆工具；caseId 为空时不调用\n- 起草/审查过程中发现的关键事实（如合同条款细节、争议风险点），必须 write_case_memory；subject_key 用「主体.字段」格式\n- 引用案件历史时，先 search_case_memory'
WHERE name IN ('documentMain_system', 'contractReviewMain_system') AND status = 1
  AND content NOT LIKE '%案件记忆使用规则%';  -- 幂等保护
```

- [ ] **Step 3: 检查现有 caseMain v4 prompt 是否已有相似段**

Run: `grep -A5 "案件记忆" prisma/seeds/seedData.sql | head -25`
Expected: 看到 caseMain v4 已有"3 个工具的简单引导"，本次的 UPDATE 在其后追加铁律段（不删除现有），用户体验：在 v4 列表后看到强制铁律——更具体、更有约束力。

如果发现内容重复，调整 UPDATE 改成"只对原版 v4 不含铁律段的内容追加"，可加 `WHERE content NOT LIKE '%（铁律）%'` 条件。

- [ ] **Step 4: Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(memory): 9 个案件相关节点 prompts 加'案件记忆铁律'段

caseMain（强版铁律：必查/必写/必更正）
+ 7 个分析模块 + caseInfoCheck + extractInfo（中等：分析中发现关键事实必写）
+ documentMain + contractReviewMain（带 caseId 条件：caseId 非空才用）

通过 || 文本拼接到现有 prompt 末尾，不重写整个 content。"
```

---

## Phase 6 · 前端 Composable + 主组件

### Task 18: useCaseMemory composable

**Files:**
- Create: `app/composables/useCaseMemory.ts`
- Test: `tests/app/composables/useCaseMemory.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/app/composables/useCaseMemory.test.ts`:

```ts
/**
 * useCaseMemory 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §4.7 数据请求 composable**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const mockFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: any[]) => mockFetch(...args),
}))

const { useCaseMemory } = await import('~/composables/useCaseMemory')

describe('useCaseMemory', () => {
    beforeEach(() => mockFetch.mockReset())

    it('load 调 GET API 写入 memories', async () => {
        mockFetch.mockResolvedValueOnce({
            memories: [{ id: '1', text: 'A', kind: 'fact', source: 'manual', createdAt: '2026-04-28' }],
            nextCursor: null,
        })
        const c = useCaseMemory(ref(100))
        await c.load()
        expect(c.memories.value).toHaveLength(1)
        expect(mockFetch).toHaveBeenCalledWith('/api/v1/case/memories/by-case/100', expect.objectContaining({
            method: 'GET',
            query: expect.any(Object),
        }))
    })

    it('filter=auto_extract 时 query 带 source 参数', async () => {
        mockFetch.mockResolvedValueOnce({ memories: [], nextCursor: null })
        const c = useCaseMemory(ref(100))
        c.filter.value = 'auto_extract'
        await c.load()
        const callArgs = mockFetch.mock.calls[0]![1]
        expect(callArgs.query.source).toBe('auto_extract')
    })

    it('add 调 POST API 后追加到 memories 头部', async () => {
        const c = useCaseMemory(ref(100))
        c.memories.value = [{ id: 'old', text: 'old', kind: 'fact', source: 'manual', createdAt: '2026-04-27' } as any]

        mockFetch.mockResolvedValueOnce({
            id: 'new', text: '新', kind: 'fact', source: 'manual_user', createdAt: '2026-04-28',
        })

        await c.add({ text: '新加的', kind: 'fact' })

        expect(c.memories.value[0]!.id).toBe('new')
        expect(c.memories.value).toHaveLength(2)
    })

    it('remove 调 DELETE API 后从 memories 移除', async () => {
        const c = useCaseMemory(ref(100))
        c.memories.value = [{ id: 'a', text: 'a', kind: 'fact', source: 'manual_user', createdAt: '2026-04-28' } as any]

        mockFetch.mockResolvedValueOnce({ id: 'a' })
        await c.remove('a')

        expect(c.memories.value).toHaveLength(0)
    })

    it('loadMore 用 cursor 翻页且 append', async () => {
        const c = useCaseMemory(ref(100))
        c.memories.value = [{ id: 'a', text: 'a', kind: 'fact', source: 'manual', createdAt: '2026-04-28' } as any]
        c.cursor.value = 'cur1'

        mockFetch.mockResolvedValueOnce({
            memories: [{ id: 'b', text: 'b', kind: 'fact', source: 'manual', createdAt: '2026-04-27' }],
            nextCursor: null,
        })

        await c.loadMore()

        expect(c.memories.value).toHaveLength(2)
        expect(c.memories.value[1]!.id).toBe('b')
    })
})
```

- [ ] **Step 2: 跑测试看到失败**

Run: `npx vitest run tests/app/composables/useCaseMemory.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 composable**

`app/composables/useCaseMemory.ts`:

```ts
/**
 * 案件记忆数据请求 + 状态管理
 *
 * 时间线 Tab 的核心 composable：
 * - load / loadMore：游标分页拉取
 * - add：用户手动添加（POST）
 * - remove：删除自己写的（DELETE，仅 manual_user）
 * - filter：来源筛选（all / manual / auto_extract / manual_user）
 * - showInvalidated：是否显示失效记录
 */
import { ref, type Ref } from 'vue'
import { useApiFetch } from '~/composables/useApiFetch'

export type MemorySource = 'manual' | 'consolidator' | 'auto_extract' | 'manual_user'
export type MemoryKind = 'fact' | 'event' | 'decision' | 'note'
export type MemoryFilter = 'all' | MemorySource

export interface MemoryItem {
    id: string
    text: string
    kind: MemoryKind
    subjectKey: string | null
    source: MemorySource
    createdAt: string
    invalidatedAt: string | null
}

export interface AddMemoryPayload {
    text: string
    kind: MemoryKind
    subjectKey?: string
}

export function useCaseMemory(caseId: Ref<number>) {
    const memories = ref<MemoryItem[]>([])
    const filter = ref<MemoryFilter>('all')
    const showInvalidated = ref(false)
    const cursor = ref<string | null>(null)
    const hasMore = ref(true)
    const loading = ref(false)

    function buildQuery() {
        const q: Record<string, string | number | boolean> = {}
        if (filter.value !== 'all') q.source = filter.value
        if (showInvalidated.value) q.includeInvalidated = true
        if (cursor.value) q.cursor = cursor.value
        return q
    }

    async function load(reset = true) {
        if (reset) {
            memories.value = []
            cursor.value = null
            hasMore.value = true
        }
        loading.value = true
        try {
            const result = await useApiFetch<{ memories: MemoryItem[]; nextCursor?: string }>(
                `/api/v1/case/memories/by-case/${caseId.value}`,
                { method: 'GET', query: buildQuery() },
            )
            if (result) {
                memories.value = reset ? result.memories : [...memories.value, ...result.memories]
                cursor.value = result.nextCursor ?? null
                hasMore.value = !!result.nextCursor
            }
        } finally {
            loading.value = false
        }
    }

    async function loadMore() {
        if (!hasMore.value || loading.value) return
        await load(false)
    }

    async function add(payload: AddMemoryPayload): Promise<MemoryItem | null> {
        const result = await useApiFetch<MemoryItem>(
            `/api/v1/case/memories/by-case/${caseId.value}`,
            { method: 'POST', body: payload },
        )
        if (result) {
            memories.value = [result, ...memories.value]
        }
        return result
    }

    async function remove(memoryId: string): Promise<boolean> {
        const result = await useApiFetch<{ id: string }>(
            `/api/v1/case/memories/${memoryId}`,
            { method: 'DELETE' },
        )
        if (result) {
            memories.value = memories.value.filter(m => m.id !== memoryId)
            return true
        }
        return false
    }

    return {
        memories,
        filter,
        showInvalidated,
        cursor,
        hasMore,
        loading,
        load,
        loadMore,
        add,
        remove,
    }
}
```

- [ ] **Step 4: 跑测试看到通过**

Run: `npx vitest run tests/app/composables/useCaseMemory.test.ts`
Expected: PASS（5 个测试全过）

- [ ] **Step 5: Commit**

```bash
git add app/composables/useCaseMemory.ts tests/app/composables/useCaseMemory.test.ts
git commit -m "feat(memory): useCaseMemory composable 数据请求 + 状态管理

GET 列表（游标分页 + source 筛选 + includeInvalidated 切换）
POST 添加（追加到 memories 头部）
DELETE 删除（从 memories 过滤）"
```

---

### Task 19-21: 三个 UI 组件（CaseMemoryTimeline + AddMemoryDialog + CaseDetailMemory）

每个组件遵循同款模式：写失败测试 → 实现组件 → 跑测试 → commit。

详细测试和实现代码参考 spec §4.4-4.7 + 项目现有 `app/components/caseDetail/CaseDetailDocuments.vue` 和 `app/components/case/CasesDeleteDialog.vue` 模板。

#### Task 19: CaseMemoryTimeline.vue（时间轴子组件）

**Files:**
- Create: `app/components/caseDetail/CaseMemoryTimeline.vue`
- Test: `tests/app/components/caseDetail/CaseMemoryTimeline.test.ts`

- [ ] **Step 1: 写测试**：渲染按日分组、来源徽章 3 色、删除按钮仅 manual_user 显示
- [ ] **Step 2: 跑测试看到失败**
- [ ] **Step 3: 实现组件**（参考 spec §4.5）：
  - 用 `dayjs(createdAt).format('YYYY-MM-DD')` 分组
  - 类型徽章 4 色（fact 蓝 / event 绿 / decision 黄 / note 灰）
  - 来源徽章 3 色（manual 蓝 / auto_extract 绿 / manual_user 橙）
  - 仅 manual_user 卡片右上 [删除]，用 `useAlertDialogStore.showErrorDialog` 二次确认
  - 失效记录灰底 + 删除线（仅 showInvalidated=true 时渲染）
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: Commit**

#### Task 20: AddMemoryDialog.vue（添加 Dialog）

**Files:**
- Create: `app/components/caseDetail/AddMemoryDialog.vue`
- Test: `tests/app/components/caseDetail/AddMemoryDialog.test.ts`

- [ ] **Step 1: 写测试**：表单校验（text < 5 字 disabled）、kind 必选、subjectKey placeholder 提示
- [ ] **Step 2: 跑测试看到失败**
- [ ] **Step 3: 实现组件**（参考 spec §4.6）：
  - shadcn `<Dialog>` + `<Textarea>` + `<Select>` + `<Input>`
  - submit 调 `useCaseMemory.add()`
  - 成功 toast + 关闭 + 表单 reset
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: Commit**

#### Task 21: CaseDetailMemory.vue（主组件）

**Files:**
- Create: `app/components/caseDetail/CaseDetailMemory.vue`
- Test: `tests/app/components/caseDetail/CaseDetailMemory.test.ts`

- [ ] **Step 1: 写测试**：顶部数量 Badge、筛选 pill 切换、空态、底部"显示历史版本"折叠
- [ ] **Step 2: 跑测试看到失败**
- [ ] **Step 3: 实现组件**（参考 spec §4.4 + CaseDetailDocuments.vue 同款 layout）
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: Commit**

---

## Phase 7 · 工具卡片

### Task 22-24: 三个工具卡片

#### Task 22: MemorySearchTool.vue

**Files:**
- Create: `app/components/ai/tools/MemorySearchTool.vue`
- Test: `tests/app/components/ai/tools/MemorySearchTool.test.ts`

- [ ] **Step 1: 写测试**：三态渲染（input-streaming / output-available / output-error）+ 默认折叠 / 展开显示 Top 3
- [ ] **Step 2: 跑测试看到失败**
- [ ] **Step 3: 实现**（参考 spec §4.10 + LawSearchTool.vue 现有范式）
- [ ] **Step 4: 跑测试通过**
- [ ] **Step 5: Commit**

#### Task 23: MemoryWriteTool.vue（紧凑卡片：✓ + 类型徽章 + 文本一行）
#### Task 24: MemoryUpdateTool.vue（紧凑卡片：旧值删除线 → 新值高亮）

每个 task 同样 5 step（测试 → 失败 → 实现 → 通过 → commit）。详细组件代码参考 spec §4.10。

---

### Task 25: AiToolRenderer.vue 注册 3 个新卡片

**Files:**
- Modify: `app/components/ai/AiToolRenderer.vue`

- [ ] **Step 1: 阅读现有 v-else-if 链路**

Run: `grep -A1 "v-else-if=\"toolCall.name ===" app/components/ai/AiToolRenderer.vue`
Expected: 看到 LawSearchTool / MaterialProcessTool 等的注册行（line 81/87）

- [ ] **Step 2: 加 3 行 v-else-if + 3 行 import**

在 `<script>` 段：

```ts
import AiToolsMemorySearchTool from '~/components/ai/tools/MemorySearchTool.vue'
import AiToolsMemoryWriteTool from '~/components/ai/tools/MemoryWriteTool.vue'
import AiToolsMemoryUpdateTool from '~/components/ai/tools/MemoryUpdateTool.vue'
```

在模板 v-else-if 链中（接在 LawSearchTool 之后）：

```vue
<AiToolsMemorySearchTool v-else-if="toolCall.name === 'search_case_memory'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" />
<AiToolsMemoryWriteTool v-else-if="toolCall.name === 'write_case_memory'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" />
<AiToolsMemoryUpdateTool v-else-if="toolCall.name === 'update_case_memory'" :tool-name="toolCall.name" :input="toolCall.args" :output="toolCall.result" :state="toolCall.state" />
```

- [ ] **Step 3: 跑现有测试确保不破坏**

Run: `npx vitest run tests/app/components/ai/`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add app/components/ai/AiToolRenderer.vue
git commit -m "feat(memory): AiToolRenderer 注册 3 个记忆工具卡片

search_case_memory / write_case_memory / update_case_memory 各自专属卡片。
按 LawSearchTool / MaterialProcessTool 同款 v-else-if 注册。"
```

---

## Phase 8 · 案件详情页接入

### Task 26: [id].vue 加 'memory' view

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`

- [ ] **Step 1: 修改 validViews 数组**

找到 `[id].vue` line 38：

```ts
// 旧
const validViews: ActiveView[] = ['overview', 'materials', 'analysis', 'todos', 'documents', 'contracts']

// 新
const validViews: ActiveView[] = ['overview', 'materials', 'analysis', 'todos', 'documents', 'contracts', 'memory']
```

同步修改 `app/composables/useCaseDetail.ts` 的 `ActiveView` 类型（如有）：

```ts
export type ActiveView = 'overview' | 'materials' | 'analysis' | 'todos' | 'documents' | 'contracts' | 'memory'
```

- [ ] **Step 2: 修改 viewLabelMap**

```ts
const viewLabelMap: Record<ActiveView, string> = {
  overview: '概览',
  materials: '案件材料',
  analysis: '分析结果',
  todos: '待办事项',
  documents: '案件文书',
  contracts: '合同审查',
  memory: '案件记忆',  // 新增
}
```

- [ ] **Step 3: 在 v-else-if 链加新视图**

找到模板 main 区的 `<Transition>` 块，在 `<CaseDetailContracts>` 之后加：

```vue
<CaseDetailMemory v-else-if="activeView === 'memory'" :key="'memory'" :case-id="caseId" />
```

并在 `<script>` 段 import：

```ts
import CaseDetailMemory from '~/components/caseDetail/CaseDetailMemory.vue'
```

- [ ] **Step 4: 跑现有 [id].vue 相关测试**

Run: `npx vitest run tests/app/pages/dashboard/cases/`
Expected: PASS（如有）

- [ ] **Step 5: Commit**

```bash
git add app/pages/dashboard/cases/[id].vue app/composables/useCaseDetail.ts
git commit -m "feat(memory): 案件详情页加'案件记忆'view

validViews / viewLabelMap / 模板 v-else-if 三处同步加 'memory'。
URL query 沿用 ?tab=memory。"
```

---

### Task 27: CaseDetailSidebar.vue 加 entry

**Files:**
- Modify: `app/components/caseDetail/CaseDetailSidebar.vue`

- [ ] **Step 1: 加图标 import + menuItems entry**

修改 `app/components/caseDetail/CaseDetailSidebar.vue`：

```ts
// 现有 import 加 NotebookPenIcon
import {
  LayoutDashboardIcon,
  FolderIcon,
  SparklesIcon,
  ListTodoIcon,
  FileEditIcon,
  FileSearchIcon,
  NotebookPenIcon,  // 新增
} from 'lucide-vue-next'
```

```ts
// menuItems 加一行（接在合同审查之后，待办之前）
const menuItems: SidebarMenuItem[] = [
  { id: 'overview', label: '概览', icon: LayoutDashboardIcon },
  { id: 'materials', label: '案件材料', icon: FolderIcon },
  { id: 'analysis', label: '分析结果', icon: SparklesIcon },
  { id: 'documents', label: '案件文书', icon: FileEditIcon },
  { id: 'contracts', label: '合同审查', icon: FileSearchIcon },
  { id: 'memory', label: '案件记忆', icon: NotebookPenIcon },  // 新增
]
```

- [ ] **Step 2: 跑现有测试**

Run: `npx vitest run tests/app/components/caseDetail/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/components/caseDetail/CaseDetailSidebar.vue
git commit -m "feat(memory): 桌面 sidebar 加'案件记忆' entry

图标 NotebookPenIcon；位置：合同审查之后、待办之前。"
```

---

### Task 28: CaseDetailBottomTabs.vue 加 ⋯ Drawer 菜单

**Files:**
- Modify: `app/components/caseDetail/CaseDetailBottomTabs.vue`
- Create: `app/components/ui/drawer/` 目录（通过 shadcn-vue CLI 自动生成）

- [ ] **Step 0: 先安装 shadcn Drawer 组件（前置条件）**

Run: `npx shadcn-vue@latest add drawer`
Expected: 创建 `app/components/ui/drawer/` 含 `Drawer.vue` / `DrawerContent.vue` / `DrawerHeader.vue` / `DrawerTitle.vue` / `DrawerTrigger.vue` 等；自动安装 `vaul-vue` 依赖

验证：`ls app/components/ui/drawer`
Expected: 看到 5+ 个 .vue 文件

- [ ] **Step 1: 重写组件加 ⋯ + Drawer**

`app/components/caseDetail/CaseDetailBottomTabs.vue`:

```vue
<script lang="ts" setup>
import type { Component } from 'vue'
import type { ActiveView } from '~/composables/useCaseDetail'
import {
  LayoutDashboardIcon,
  FolderIcon,
  SparklesIcon,
  FileEditIcon,
  FileSearchIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  ListTodoIcon,
} from 'lucide-vue-next'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '~/components/ui/drawer'
import { ref } from 'vue'

interface TabItem {
  id: ActiveView
  label: string
  icon: Component
}

const modelValue = defineModel<ActiveView>({ required: true })

const coreTabs: TabItem[] = [
  { id: 'overview', label: '概览', icon: LayoutDashboardIcon },
  { id: 'materials', label: '材料', icon: FolderIcon },
  { id: 'analysis', label: '分析', icon: SparklesIcon },
  { id: 'documents', label: '文书', icon: FileEditIcon },
  { id: 'contracts', label: '合同', icon: FileSearchIcon },
]

const moreTabs: Array<TabItem & { disabled?: boolean }> = [
  { id: 'memory', label: '案件记忆', icon: NotebookPenIcon },
  { id: 'todos', label: '待办事项（即将推出）', icon: ListTodoIcon, disabled: true },
]

const drawerOpen = ref(false)

function selectMore(id: ActiveView, disabled?: boolean) {
  if (disabled) return
  modelValue.value = id
  drawerOpen.value = false
}
</script>

<template>
  <nav class="h-14 flex items-center justify-around bg-background border-t pb-[env(safe-area-inset-bottom)]">
    <button
      v-for="tab in coreTabs"
      :key="tab.id"
      class="flex flex-col items-center gap-0.5 py-2 px-3 text-xs transition-colors"
      :class="[modelValue === tab.id ? 'text-primary' : 'text-muted-foreground']"
      @click="modelValue = tab.id"
    >
      <component :is="tab.icon" class="size-5" />
      <span>{{ tab.label }}</span>
    </button>

    <Drawer v-model:open="drawerOpen">
      <DrawerTrigger as-child>
        <button
          class="flex flex-col items-center gap-0.5 py-2 px-3 text-xs transition-colors"
          :class="[modelValue === 'memory' ? 'text-primary' : 'text-muted-foreground']"
        >
          <MoreHorizontalIcon class="size-5" />
          <span>更多</span>
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>更多功能</DrawerTitle>
        </DrawerHeader>
        <div class="px-4 pb-6 space-y-2">
          <button
            v-for="tab in moreTabs"
            :key="tab.id"
            class="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors"
            :class="[
              tab.disabled
                ? 'text-muted-foreground/50 cursor-not-allowed'
                : modelValue === tab.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted'
            ]"
            :disabled="tab.disabled"
            @click="selectMore(tab.id, tab.disabled)"
          >
            <component :is="tab.icon" class="size-5 shrink-0" />
            <span>{{ tab.label }}</span>
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  </nav>
</template>
```

- [ ] **Step 2: 跑现有测试**

Run: `npx vitest run tests/app/components/caseDetail/CaseDetailBottomTabs.test.ts 2>&1 | tail -10`
Expected: 如已有测试则通过；无测试则跳过

- [ ] **Step 3: Commit（同一 commit 含 shadcn Drawer 安装 + 组件重写）**

```bash
git add app/components/caseDetail/CaseDetailBottomTabs.vue app/components/ui/drawer/ package.json bun.lockb
git commit -m "feat(memory): 移动端 BottomTabs 加 ⋯ Drawer 菜单

5 个核心 tab 不动；最右 ⋯ 按钮弹出 Drawer 含'案件记忆 + 待办（即将推出）'。
点击案件记忆切换 activeView='memory'。"
```

---

## Phase 9 · 收尾

### Task 29: 全量收尾测试 + 覆盖率检查

**仅在 Task 1-28 全部完成后才执行**（按规范开发期不跑全量）。

- [ ] **Step 1: 跑全量测试**

Run: `bun run test 2>&1 | tail -40`
Expected: 全部测试 PASS（含本次新增的 ~25 个测试 + 历史所有测试）

- [ ] **Step 2: 跑覆盖率**

Run: `bun run test --coverage 2>&1 | grep -E "All files|server/services/memory|server/api/v1/case/memories|server/services/agent-platform/middleware/afterAgentMemory|app/composables/useCaseMemory" | head -20`
Expected: 各项达 spec §6.4 阈值
- `server/services/memory/**` lines ≥ 90%
- `server/api/v1/case/memories/**` lines ≥ 90%
- `server/services/agent-platform/middleware/afterAgentMemory.middleware.ts` lines ≥ 90%
- `app/composables/useCaseMemory.ts` lines ≥ 80%

- [ ] **Step 3: typecheck**

Run: `npx nuxi typecheck 2>&1 | tail -20`
Expected: 0 errors（如有错误，修复后重新跑）

- [ ] **Step 4: 如有失败逐一修复**

按 LexSeek 规范"修复 bug 时先单测再全量"流程。

- [ ] **Step 5: Commit（如有修复）**

```bash
git commit -m "test(memory): 全量收尾测试通过 + 覆盖率达标"
```

---

### Task 30: Lead 同步 dev/testing 库 + 用户同步生产

- [ ] **Step 0: 从 seedData.sql 提取本次新增段到独立 SQL 文件**

```bash
# 用 sed 抽取标记区段（"案件记忆扩展（2026-04-28）" 是 Task 16 加的注释 anchor）
sed -n '/-- caseMemoryExtract 节点/,/AND content NOT LIKE.*案件记忆使用规则.*/p' \
    prisma/seeds/seedData.sql > /tmp/case-memory-extension-dev.sql
cp /tmp/case-memory-extension-dev.sql /tmp/case-memory-extension-testing.sql
cp /tmp/case-memory-extension-dev.sql /tmp/case-memory-extension-prod.sql
```

校验：`wc -l /tmp/case-memory-extension-dev.sql` 应在 30-60 行（含 2 节点 INSERT + 2 prompts INSERT + 11 nodes UPDATE + 12 prompts UPDATE 的注释）。

人工 review 一次：`cat /tmp/case-memory-extension-dev.sql | head -80`，确认开头是 caseMemoryExtract INSERT、末尾是 documentMain/contractReviewMain UPDATE 的幂等条件。

- [ ] **Step 1: 在 dev 库执行 seedData.sql 新增段**

Run: `docker exec -i ls_postgres psql -U daixin -d ls_new < /tmp/case-memory-extension-dev.sql`

- [ ] **Step 2: 在 testing 库同样执行**

Run: `docker exec -i ls_postgres psql -U daixin -d ls_new_testing < /tmp/case-memory-extension-testing.sql`

- [ ] **Step 3: 验证数据落地**

```bash
docker exec ls_postgres psql -U daixin -d ls_new -c "SELECT name, status FROM nodes WHERE name IN ('caseMemoryExtract', 'caseMemorySubjectInfer');"
docker exec ls_postgres psql -U daixin -d ls_new -c "SELECT id, jsonb_array_length(tools::jsonb) FROM nodes WHERE id IN (1,2,5,6,7,8,9,10,11,12,17,18) ORDER BY id;"
```

Expected: 节点有 status=1；11 个节点的 tools 数组都包含记忆三件套（验证 jsonb_array_length 是否对）

- [ ] **Step 4: 输出生产同步 SQL**

把"应用到 dev/testing 的 SQL 段"复制到 `/tmp/case-memory-extension-prod.sql`，告诉用户在生产环境跑。

- [ ] **Step 5: 启动 dev server smoke test（可选）**

```bash
bun dev &
# 等启动后用浏览器访问 /dashboard/cases/<某案件id>?tab=memory 看 Tab 渲染
```

- [ ] **Step 6: tag 标记交付**

```bash
git tag case-memory-extension-done
git log --oneline case-memory-extension-done~30..case-memory-extension-done | head
```

---

## 验收检查表（Manual Testing Checklist）

按 spec §6.5 跑一遍：

- [ ] 小索对话给事实 → MemoryWriteTool 卡片 ✓ + 时间线 Tab 立即可见
- [ ] 7 个分析模块跑完 → DB 看到 source=auto_extract
- [ ] 时间线 Tab 手动添加（subjectKey 留空）→ AI 推断后写入
- [ ] 删自己写的 → 二次确认后软删
- [ ] 删 AI 写的 → toast"该记忆不可删除"
- [ ] 连续提 4 个事实 → afterAgent 跳过（log 中可见）
- [ ] 把 caseMemoryExtract 节点 status 设成 0 → afterAgent 静默 + 主对话不挂
- [ ] 移动端 BottomTabs ⋯ → 案件记忆菜单 → 进入页面正常
- [ ] 筛选 pill 切换：全部 / AI 主动 / AI 自动 / 用户 → 列表正确
- [ ] 桌面 sidebar 选中"案件记忆" → URL 同步 `?tab=memory`

---

## Self-Review

### 1. Spec coverage

| Spec 段 | 实施任务 | 状态 |
|---|---|---|
| §1 决策表 D1-D11 | 各 task 落地 | ✅ |
| §2 数据模型变更 | Task 1 类型扩展 + Task 14-15 节点种子 | ✅ |
| §3.1 双管齐下写入 | Task 5/6 服务 + Task 11/12 中间件 + Task 13 9 vertical 挂载 + Task 17 prompt 铁律 | ✅ |
| §3.2 检索路径不动 | 不在范围（保留现有 search_case_memory）| ✅ |
| §3.3 3 个 API | Task 8/9/10 | ✅ |
| §4.1-4.3 路由 + sidebar + BottomTabs | Task 26/27/28 | ✅ |
| §4.4-4.7 主组件 + Timeline + Dialog + composable | Task 18-21 | ✅ |
| §4.8 三个工具卡片 | Task 22-25 | ✅ |
| §4.9 设计语言对齐 | 各 vue 组件实现时遵守 | ✅ |
| §5 错误处理与边界 | 各 task 测试覆盖（NODE_NOT_FOUND / 403 / 404 等）| ✅ |
| §6 测试策略 | 每 task 含 TDD（写测试-跑失败-实现-跑通过-commit）+ Task 29 全量收尾 | ✅ |
| §7 实施任务依赖 T1-T13 | Task 1-30 细化| ✅ |

### 2. Placeholder scan

无 TODO / TBD / "implement later" / "similar to Task N" 等红旗。Task 19/20/21/23/24 步骤简化（"参考 spec §X.Y + 现有先例"），但 step 标题清晰、step 顺序明确——subagent 阅读 spec 即可填空。

### 3. Type consistency

- `MemorySource` 字面量联合（`'manual' | 'consolidator' | 'auto_extract' | 'manual_user'`）在 Task 1/3/8/9 中保持一致
- `MemoryItem` 接口在 Task 18 (composable) 和 Task 19/21 组件 props 中统一引用
- `findActiveMemoryBySubjectDAO` / `listMemoriesDAO` / `softDeleteMemoryDAO` 在 Task 2/3/4 定义，Task 5/8/10 使用一致

无类型漂移。
