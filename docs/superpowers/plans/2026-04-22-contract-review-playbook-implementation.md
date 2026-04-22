# 合同审查 Playbook 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现按合同类型的审查清单（Playbook），AI 在逐条条款审查时对照清单产出 matchedPointCode，结果页显示"命中 N/M"并联动跳转；清单快照冻结保证历史报告稳定。

**Architecture:** 新增 `contract_playbooks` 表（类型×code 维护要点）+ `contract_reviews.playbookSnapshot` JSON 字段（快照）。后端 `analyzeSingleClause` 在 prompt 里注入 `{{playbookSection}}`；前端新增 composable 派生"命中/未命中/清单外"三态。管理页 `/admin/contract-playbooks` 做 CRUD（GET/POST/PATCH，不含 DELETE/拖拽）。用户端 API 无改动（只读快照）。分 2 个 Phase：Phase 1 运营侧（数据层+管理页），Phase 2 用户侧（审查流程+结果页 UI）。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Prisma + PostgreSQL + LangChain + shadcn-vue + Tailwind v4 + Vitest + Bun

**Spec:** `docs/superpowers/specs/2026-04-21-contract-review-playbook-design.md`

**工期：** 5 天（Phase 1 = 2 天 · Phase 2 = 2.5 天 · 缓冲 0.5 天）

---

## 文件清单

### 新建
- `prisma/models/contractPlaybook.prisma` — Prisma 模型
- `shared/types/contract.ts` 扩展 — PlaybookSnapshot / StancePreference 等类型
- `server/services/assistant/contract/contractPlaybook.dao.ts` — DAO 层
- `server/services/assistant/contract/contractPlaybook.service.ts` — Service 层（薄封装）
- `server/api/v1/admin/contract-playbooks/index.get.ts` — 列表
- `server/api/v1/admin/contract-playbooks/index.post.ts` — 新增
- `server/api/v1/admin/contract-playbooks/[id].patch.ts` — 编辑
- `app/pages/admin/contract-playbooks/index.vue` — 管理页
- `app/composables/useContractPlaybookMatch.ts` — 前端派生
- `tests/server/assistant/contract/contractPlaybook.dao.test.ts`
- `tests/server/assistant/contract/contractPlaybookAdmin.api.test.ts`
- `tests/app/composables/useContractPlaybookMatch.test.ts`
- `tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts`

### 修改
- `prisma/models/contractReview.prisma` — 加 `playbookSnapshot Json?`
- `prisma/seeds/seedData.sql` — 新增 contract_playbooks 种子 + 更新 prompt 28
- `server/services/assistant/contract/analyzeSingleClause.ts` — 加 snapshot 入参 + 渲染 playbookSection
- `server/services/workflow/agents/contractReviewMainAgent.ts` — resume 分支写快照 + runAnalyzeLoop 传 snapshot
- `app/components/assistant/contract/OverviewPanel.vue` — 新增"清单对照"板块
- `app/components/assistant/contract/RiskListPanel.vue` — 风险卡加徽章
- `server/services/assistant/contract/contractReviewPdf.service.ts` — PDF 新增"清单对照结果"节
- `server/api/v1/admin/menu-routers.get.ts` — 注册新菜单项（如 DB 未自动兜底）
- `shared/types/contract.ts` — 扩展类型导出（`Risk` 新增 `matchedPointCode?`）
- `tests/server/assistant/contract/analyzeSingleClause.test.ts` — 扩展 playbook 场景

---

# Phase 1 · 运营侧（2 天）

## Task 1.1: Prisma schema + 迁移

**Files:**
- Create: `prisma/models/contractPlaybook.prisma`
- Modify: `prisma/models/contractReview.prisma`

- [ ] **Step 1: 新建 contractPlaybook.prisma 模型**

创建 `prisma/models/contractPlaybook.prisma`：

```prisma
/// 合同审查清单要点（按合同类型维护）
/// v1 不支持硬删除，只通过 enabled=false 停用
model contractPlaybooks {
  id               Int      @id @default(autoincrement())
  /// 合同类型；与 CONTRACT_TYPE_OPTIONS 对齐的字符串，DB 不加外键约束
  contractType     String   @map("contract_type") @db.VarChar(50)
  /// 稳定标识，快照引用使用（如 "probation"、"overtime"）
  code             String   @db.VarChar(20)
  /// 要点简称
  title            String   @db.VarChar(30)
  /// AI 判定风险级别的基线：high / medium / low
  defaultLevel     String   @map("default_level") @db.VarChar(10)
  /// 要点客观严格度：strict / balanced / lenient；默认 balanced
  stancePreference String   @default("balanced") @map("stance_preference") @db.VarChar(10)
  /// 给 AI 的指导语
  checkContent     String   @map("check_content") @db.Text
  /// 法律依据（可选）
  legalBasis       String?  @map("legal_basis") @db.Text
  /// 标准建议（可选，#4 追踪修订会用作修订文本基线）
  suggestion       String?  @db.Text
  enabled          Boolean  @default(true)
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([contractType, code], map: "idx_contract_playbooks_type_code")
  @@index([contractType, enabled, code], map: "idx_contract_playbooks_lookup")
  @@map("contract_playbooks")
}
```

- [ ] **Step 2: 在 contractReview.prisma 加 playbookSnapshot 字段**

在 `prisma/models/contractReview.prisma` 的 `summary` 字段下一行加：

```prisma
  /// 审查清单快照（M7 Playbook）：审查提交时写入，永久冻结
  /// 结构见 #shared/types/contract 的 PlaybookSnapshot；null 表示"其他"类型或无启用要点
  playbookSnapshot      Json?     @map("playbook_snapshot") @db.JsonB
```

- [ ] **Step 3: 生成迁移**

运行：
```bash
bun run prisma:migrate --name add_contract_playbooks
```

预期：生成 `prisma/migrations/<timestamp>_add_contract_playbooks/migration.sql`，含：
- `CREATE TABLE "contract_playbooks"`
- `ALTER TABLE "contract_reviews" ADD COLUMN "playbook_snapshot" JSONB`
- 两个索引

验证：`npx prisma migrate status` 显示 "Database schema is up to date"。

- [ ] **Step 4: 同步 Prisma client**

```bash
bun run prisma:generate
```

预期：`generated/prisma/client.ts` 含 `contractPlaybooks` 模型，`contractReviews` 有 `playbookSnapshot` 字段。

- [ ] **Step 5: 提交**

```bash
git add prisma/models/contractPlaybook.prisma prisma/models/contractReview.prisma prisma/migrations/ generated/prisma/
git commit -m "feat(db): 新增 contract_playbooks 表 + contractReviews.playbookSnapshot 字段"
```

---

## Task 1.2: 扩展 shared/types/contract.ts

**Files:**
- Modify: `shared/types/contract.ts`

- [ ] **Step 1: 新增立场偏好类型与常量**

在 `shared/types/contract.ts` 中 `STANCE_LABEL` 下方新增：

```ts
export type StancePreference = 'strict' | 'balanced' | 'lenient'

export const STANCE_PREFERENCE_OPTIONS = ['strict', 'balanced', 'lenient'] as const

export const STANCE_PREFERENCE_LABEL: Record<StancePreference, string> = {
    strict: '严格',
    balanced: '中性',
    lenient: '宽松',
}
```

- [ ] **Step 2: 新增 PlaybookSnapshot 相关类型**

在同文件末尾（`ContractReviewEvent` 定义之前）新增：

```ts
/**
 * 清单要点的快照形态（冻结在 contract_reviews.playbookSnapshot JSON 中）
 * 不直接等同于 contract_playbooks 行——后者可能被运营修改，快照不变。
 */
export interface PlaybookPointSnapshot {
    code: string
    title: string
    defaultLevel: 'high' | 'medium' | 'low'
    stancePreference: StancePreference
    checkContent: string
    legalBasis?: string
    suggestion?: string
}

export interface PlaybookSnapshot {
    contractType: string
    points: PlaybookPointSnapshot[]
    /** ISO 时间戳，便于 UI 显示"本审查使用清单版本快照于 YYYY-MM-DD" */
    snapshotAt: string
}
```

- [ ] **Step 3: 扩展 Risk 接口**

找到 `export interface Risk { ... }`，在 `suggestedClauseText?: string` 之后新增：

```ts
    /** 命中的要点 code；清单外风险留空（M7 Playbook） */
    matchedPointCode?: string
```

- [ ] **Step 4: 类型检查**

```bash
npx nuxi typecheck
```

预期：0 错误（或仅有与本 task 无关的已存在错误）。

- [ ] **Step 5: 提交**

```bash
git add shared/types/contract.ts
git commit -m "feat(types): 扩展 Risk + 新增 PlaybookSnapshot/StancePreference 类型"
```

---

## Task 1.3: DAO 层 — contractPlaybook.dao.ts

**Files:**
- Create: `server/services/assistant/contract/contractPlaybook.dao.ts`
- Test: `tests/server/assistant/contract/contractPlaybook.dao.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/contract/contractPlaybook.dao.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createPlaybookDAO,
    getPlaybookByIdDAO,
    listPlaybooksDAO,
    listEnabledPlaybookPointsDAO,
    updatePlaybookDAO,
} from '~~/server/services/assistant/contract/contractPlaybook.dao'

describe('contractPlaybook.dao', () => {
    beforeEach(async () => {
        await prisma.contractPlaybooks.deleteMany({})
    })

    it('createPlaybookDAO 创建要点', async () => {
        const row = await createPlaybookDAO({
            contractType: '劳动合同',
            code: 'probation',
            title: '试用期约定合规性',
            defaultLevel: 'high',
            stancePreference: 'strict',
            checkContent: '检查试用期是否超过法定上限。',
        })
        expect(row.id).toBeGreaterThan(0)
        expect(row.enabled).toBe(true)
        expect(row.stancePreference).toBe('strict')
    })

    it('listPlaybooksDAO 按类型 + enabled 过滤 + 按 code 排序', async () => {
        await createPlaybookDAO({ contractType: '劳动合同', code: 'overtime', title: '加班费', defaultLevel: 'medium', stancePreference: 'balanced', checkContent: 'x' })
        await createPlaybookDAO({ contractType: '劳动合同', code: 'probation', title: '试用期', defaultLevel: 'high', stancePreference: 'strict', checkContent: 'x' })
        await createPlaybookDAO({ contractType: '租赁合同', code: 'rent', title: '租金', defaultLevel: 'low', stancePreference: 'lenient', checkContent: 'x' })

        const list = await listPlaybooksDAO({ contractType: '劳动合同' })
        expect(list).toHaveLength(2)
        expect(list[0]!.code).toBe('overtime')  // 字母序
        expect(list[1]!.code).toBe('probation')
    })

    it('listEnabledPlaybookPointsDAO 仅返回启用项且字段投影正确', async () => {
        await createPlaybookDAO({ contractType: '劳动合同', code: 'probation', title: '试用期', defaultLevel: 'high', stancePreference: 'strict', checkContent: 'c1', legalBasis: 'lb', suggestion: 'sug' })
        const disabled = await createPlaybookDAO({ contractType: '劳动合同', code: 'disabled', title: 'off', defaultLevel: 'low', stancePreference: 'balanced', checkContent: 'x' })
        await updatePlaybookDAO(disabled.id, { enabled: false })

        const points = await listEnabledPlaybookPointsDAO('劳动合同')
        expect(points).toHaveLength(1)
        expect(points[0]!.code).toBe('probation')
        expect(points[0]!.legalBasis).toBe('lb')
        expect(points[0]!.suggestion).toBe('sug')
    })

    it('updatePlaybookDAO 切换 enabled', async () => {
        const row = await createPlaybookDAO({ contractType: '劳动合同', code: 'c1', title: 't', defaultLevel: 'low', stancePreference: 'balanced', checkContent: 'x' })
        const updated = await updatePlaybookDAO(row.id, { enabled: false })
        expect(updated.enabled).toBe(false)
    })

    it('getPlaybookByIdDAO 不存在返 null', async () => {
        const row = await getPlaybookByIdDAO(999999)
        expect(row).toBeNull()
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run tests/server/assistant/contract/contractPlaybook.dao.test.ts
```

预期：5 个用例全 FAIL（"Cannot find module ... contractPlaybook.dao"）。

- [ ] **Step 3: 实现 DAO**

创建 `server/services/assistant/contract/contractPlaybook.dao.ts`：

```ts
/**
 * 合同审查清单要点 DAO 层
 *
 * - v1 不做硬删，只通过 enabled 切换停用
 * - listEnabledPlaybookPointsDAO 专用于快照写入，返回字段对齐 PlaybookPointSnapshot
 *
 * **Feature: contract-review-playbook (M7)**
 */
import { prisma } from '~~/server/utils/db'
import type { contractPlaybooks, Prisma } from '~~/generated/prisma/client'
import type { PlaybookPointSnapshot, StancePreference } from '#shared/types/contract'

type CreateInput = Omit<Prisma.contractPlaybooksUncheckedCreateInput, 'id' | 'createdAt' | 'updatedAt'>
type UpdateInput = Prisma.contractPlaybooksUncheckedUpdateInput

export async function createPlaybookDAO(data: CreateInput): Promise<contractPlaybooks> {
    return prisma.contractPlaybooks.create({ data })
}

export async function getPlaybookByIdDAO(id: number): Promise<contractPlaybooks | null> {
    return prisma.contractPlaybooks.findUnique({ where: { id } })
}

export interface ListPlaybooksFilter {
    contractType?: string
    enabled?: boolean
    q?: string
}

export async function listPlaybooksDAO(filter: ListPlaybooksFilter = {}): Promise<contractPlaybooks[]> {
    const where: Prisma.contractPlaybooksWhereInput = {}
    if (filter.contractType) where.contractType = filter.contractType
    if (filter.enabled !== undefined) where.enabled = filter.enabled
    if (filter.q) where.title = { contains: filter.q, mode: 'insensitive' }
    return prisma.contractPlaybooks.findMany({
        where,
        orderBy: [{ contractType: 'asc' }, { code: 'asc' }],
    })
}

export async function updatePlaybookDAO(id: number, data: UpdateInput): Promise<contractPlaybooks> {
    return prisma.contractPlaybooks.update({
        where: { id },
        data: { ...data, updatedAt: new Date() },
    })
}

/**
 * 查快照专用：只取启用项，返回结构对齐 PlaybookPointSnapshot。
 * 调用方：contractReviewMainAgent resume 分支。
 */
export async function listEnabledPlaybookPointsDAO(contractType: string): Promise<PlaybookPointSnapshot[]> {
    const rows = await prisma.contractPlaybooks.findMany({
        where: { contractType, enabled: true },
        orderBy: { code: 'asc' },
        select: {
            code: true,
            title: true,
            defaultLevel: true,
            stancePreference: true,
            checkContent: true,
            legalBasis: true,
            suggestion: true,
        },
    })
    return rows.map(r => ({
        code: r.code,
        title: r.title,
        defaultLevel: r.defaultLevel as 'high' | 'medium' | 'low',
        stancePreference: r.stancePreference as StancePreference,
        checkContent: r.checkContent,
        legalBasis: r.legalBasis ?? undefined,
        suggestion: r.suggestion ?? undefined,
    }))
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run tests/server/assistant/contract/contractPlaybook.dao.test.ts
```

预期：5/5 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/assistant/contract/contractPlaybook.dao.ts tests/server/assistant/contract/contractPlaybook.dao.test.ts
git commit -m "feat(contract): 新增 contractPlaybook DAO 层"
```

---

## Task 1.4: 管理端 API — 列表 + 新增 + 编辑

**Files:**
- Create: `server/api/v1/admin/contract-playbooks/index.get.ts`
- Create: `server/api/v1/admin/contract-playbooks/index.post.ts`
- Create: `server/api/v1/admin/contract-playbooks/[id].patch.ts`
- Test: `tests/server/assistant/contract/contractPlaybookAdmin.api.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/assistant/contract/contractPlaybookAdmin.api.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { prisma } from '~~/server/utils/db'

await setup({ server: true })

async function asSuperAdmin() {
    // 沿用项目既有 test helper；若无，直接 mock event.context.auth
    // 此处假设测试基建已支持 super_admin 身份注入
}

describe('/api/v1/admin/contract-playbooks', () => {
    beforeEach(async () => {
        await prisma.contractPlaybooks.deleteMany({})
    })

    it('POST 新增要点，字段校验通过', async () => {
        const res = await $fetch<{ code: number; data: { id: number } }>('/api/v1/admin/contract-playbooks', {
            method: 'POST',
            body: {
                contractType: '劳动合同',
                code: 'probation',
                title: '试用期约定合规性',
                defaultLevel: 'high',
                stancePreference: 'strict',
                checkContent: '检查试用期是否超过法定上限。',
            },
            headers: { 'x-test-user-role': 'super_admin' },
        })
        expect(res.code).toBe(200)
        expect(res.data.id).toBeGreaterThan(0)
    })

    it('POST defaultLevel 非法值返回 400', async () => {
        const res = await $fetch<{ code: number; message: string }>('/api/v1/admin/contract-playbooks', {
            method: 'POST',
            body: {
                contractType: '劳动合同', code: 'x', title: 't', defaultLevel: 'critical',
                stancePreference: 'balanced', checkContent: 'x',
            },
            headers: { 'x-test-user-role': 'super_admin' },
            ignoreResponseError: true,
        })
        expect(res.code).toBe(400)
    })

    it('GET 列表支持 contractType 过滤', async () => {
        await prisma.contractPlaybooks.createMany({
            data: [
                { contractType: '劳动合同', code: 'c1', title: 't1', defaultLevel: 'high', stancePreference: 'strict', checkContent: 'x' },
                { contractType: '租赁合同', code: 'c2', title: 't2', defaultLevel: 'low', stancePreference: 'lenient', checkContent: 'x' },
            ],
        })
        const res = await $fetch<{ data: { list: unknown[] } }>('/api/v1/admin/contract-playbooks?contractType=劳动合同', {
            headers: { 'x-test-user-role': 'super_admin' },
        })
        expect(res.data.list).toHaveLength(1)
    })

    it('PATCH 编辑启用状态', async () => {
        const row = await prisma.contractPlaybooks.create({
            data: { contractType: '劳动合同', code: 'c1', title: 't1', defaultLevel: 'high', stancePreference: 'strict', checkContent: 'x' },
        })
        const res = await $fetch<{ code: number; data: { enabled: boolean } }>(`/api/v1/admin/contract-playbooks/${row.id}`, {
            method: 'PATCH',
            body: { enabled: false },
            headers: { 'x-test-user-role': 'super_admin' },
        })
        expect(res.code).toBe(200)
        expect(res.data.enabled).toBe(false)
    })
})
```

> **注**：项目测试基建是否已支持 super_admin 注入需在实现前确认；若未支持，参考 `tests/server/assistant/document/**` 既有 admin 测试沿用相同手法。

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run tests/server/assistant/contract/contractPlaybookAdmin.api.test.ts
```

预期：4 个用例全 FAIL（路由不存在）。

- [ ] **Step 3: 实现 GET /admin/contract-playbooks**

创建 `server/api/v1/admin/contract-playbooks/index.get.ts`：

```ts
/**
 * GET /api/v1/admin/contract-playbooks
 *
 * 管理端列出审查清单要点。权限由 03.permission 中间件拦截。
 *
 * Query：
 * - contractType: 合同类型精确过滤
 * - enabled: 启用状态过滤（true/false）
 * - q: 标题模糊搜索
 */
import { z } from 'zod'
import { listPlaybooksDAO } from '~~/server/services/assistant/contract/contractPlaybook.dao'

const QuerySchema = z.object({
    contractType: z.string().optional(),
    enabled: z.coerce.boolean().optional(),
    q: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const parsed = QuerySchema.safeParse(getQuery(event))
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const list = await listPlaybooksDAO(parsed.data)
        return resSuccess(event, '获取清单要点列表成功', { list, total: list.length })
    } catch (error: any) {
        logger.error('[admin] 获取合同审查清单失败', { userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '获取清单失败')
    }
})
```

- [ ] **Step 4: 实现 POST /admin/contract-playbooks**

创建 `server/api/v1/admin/contract-playbooks/index.post.ts`：

```ts
/**
 * POST /api/v1/admin/contract-playbooks
 *
 * 管理端新增清单要点。
 * 字段校验：defaultLevel / stancePreference 走 zod 枚举校验。
 * (contractType, code) 唯一，重复会被 Prisma unique 约束拦截 → 返回 409。
 */
import { z } from 'zod'
import { CONTRACT_TYPE_OPTIONS } from '#shared/types/contract'
import { createPlaybookDAO } from '~~/server/services/assistant/contract/contractPlaybook.dao'

const BodySchema = z.object({
    contractType: z.enum(CONTRACT_TYPE_OPTIONS),
    code: z.string().min(1).max(20).regex(/^[a-z0-9_]+$/, 'code 仅支持小写字母数字下划线'),
    title: z.string().min(1).max(30),
    defaultLevel: z.enum(['high', 'medium', 'low']),
    stancePreference: z.enum(['strict', 'balanced', 'lenient']).default('balanced'),
    checkContent: z.string().min(1).max(500),
    legalBasis: z.string().max(300).optional(),
    suggestion: z.string().max(500).optional(),
    enabled: z.boolean().default(true),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const body = await readBody(event)
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const row = await createPlaybookDAO(parsed.data)
        return resSuccess(event, '新增要点成功', row)
    } catch (error: any) {
        if (error?.code === 'P2002') {
            return resError(event, 409, '该合同类型下已存在相同 code 的要点')
        }
        logger.error('[admin] 新增清单要点失败', { userId: user.id, error: error?.message })
        return resError(event, 500, error?.message || '新增要点失败')
    }
})
```

- [ ] **Step 5: 实现 PATCH /admin/contract-playbooks/:id**

创建 `server/api/v1/admin/contract-playbooks/[id].patch.ts`：

```ts
/**
 * PATCH /api/v1/admin/contract-playbooks/:id
 *
 * 管理端编辑清单要点。支持全字段编辑 + 切换 enabled。
 * (contractType, code) 不允许修改（影响历史快照引用的稳定性）；如需改就停用再新建。
 */
import { z } from 'zod'
import {
    getPlaybookByIdDAO,
    updatePlaybookDAO,
} from '~~/server/services/assistant/contract/contractPlaybook.dao'

const BodySchema = z.object({
    title: z.string().min(1).max(30).optional(),
    defaultLevel: z.enum(['high', 'medium', 'low']).optional(),
    stancePreference: z.enum(['strict', 'balanced', 'lenient']).optional(),
    checkContent: z.string().min(1).max(500).optional(),
    legalBasis: z.string().max(300).nullable().optional(),
    suggestion: z.string().max(500).nullable().optional(),
    enabled: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    const id = Number(getRouterParam(event, 'id'))
    if (!Number.isInteger(id) || id <= 0) return resError(event, 400, 'id 非法')

    const existing = await getPlaybookByIdDAO(id)
    if (!existing) return resError(event, 404, '要点不存在')

    const body = await readBody(event)
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
        return resError(event, 400, parsed.error.issues[0]?.message ?? '参数错误')
    }

    try {
        const row = await updatePlaybookDAO(id, parsed.data)
        return resSuccess(event, '更新要点成功', row)
    } catch (error: any) {
        logger.error('[admin] 更新清单要点失败', { userId: user.id, id, error: error?.message })
        return resError(event, 500, error?.message || '更新失败')
    }
})
```

- [ ] **Step 6: 运行测试验证通过**

```bash
npx vitest run tests/server/assistant/contract/contractPlaybookAdmin.api.test.ts
```

预期：4/4 PASS。

- [ ] **Step 7: 提交**

```bash
git add server/api/v1/admin/contract-playbooks/ tests/server/assistant/contract/contractPlaybookAdmin.api.test.ts
git commit -m "feat(api): 新增合同审查清单管理端 CRUD 接口"
```

---

## Task 1.5: 管理端页面 `/admin/contract-playbooks`

**Files:**
- Create: `app/pages/admin/contract-playbooks/index.vue`

- [ ] **Step 1: 创建页面骨架**

创建 `app/pages/admin/contract-playbooks/index.vue`：

```vue
<script setup lang="ts">
/**
 * 合同审查清单管理页
 *
 * 左侧：合同类型 Tab（6 项 + 各启用数）
 * 右侧：要点列表（按 code 自然序）+ 新增/编辑抽屉
 *
 * v1 不含拖拽排序和硬删除。
 */
import { CONTRACT_TYPE_OPTIONS, STANCE_PREFERENCE_LABEL, RISK_LEVEL_LABEL } from '#shared/types/contract'
import type { StancePreference, RiskLevel } from '#shared/types/contract'

definePageMeta({
    layout: 'admin',
    title: '审查清单管理',
})

interface Playbook {
    id: number
    contractType: string
    code: string
    title: string
    defaultLevel: RiskLevel
    stancePreference: StancePreference
    checkContent: string
    legalBasis: string | null
    suggestion: string | null
    enabled: boolean
    createdAt: string
    updatedAt: string
}

// 排除"其他"类型（spec §1.2 不配清单）
const TYPES = CONTRACT_TYPE_OPTIONS.filter(t => t !== '其他')

const activeType = ref<string>(TYPES[0]!)
const list = ref<Playbook[]>([])
const loading = ref(false)
const searchQ = ref('')
const enabledFilter = ref<'all' | 'on' | 'off'>('all')

// 各类型启用数（左侧 Tab 徽章）
const typeCounts = ref<Record<string, number>>({})

async function loadList() {
    loading.value = true
    try {
        const res = await useApiFetch<{ list: Playbook[]; total: number }>(
            `/api/v1/admin/contract-playbooks?contractType=${encodeURIComponent(activeType.value)}`,
        )
        if (res?.list) {
            // 前端再做 enabled + q 过滤，避免每次改选项都发请求
            list.value = res.list.filter((p) => {
                if (enabledFilter.value === 'on' && !p.enabled) return false
                if (enabledFilter.value === 'off' && p.enabled) return false
                if (searchQ.value && !p.title.includes(searchQ.value)) return false
                return true
            })
        }
    } finally {
        loading.value = false
    }
}

async function loadCounts() {
    const res = await useApiFetch<{ list: Playbook[] }>(
        '/api/v1/admin/contract-playbooks?enabled=true',
    )
    if (res?.list) {
        const counts: Record<string, number> = {}
        for (const p of res.list) counts[p.contractType] = (counts[p.contractType] ?? 0) + 1
        typeCounts.value = counts
    }
}

// 编辑抽屉
const drawerOpen = ref(false)
const editing = ref<Partial<Playbook>>({})
const isEdit = computed(() => !!editing.value.id)

function openCreate() {
    editing.value = {
        contractType: activeType.value,
        defaultLevel: 'medium',
        stancePreference: 'balanced',
        enabled: true,
    }
    drawerOpen.value = true
}

function openEdit(p: Playbook) {
    editing.value = { ...p }
    drawerOpen.value = true
}

async function saveDrawer() {
    if (!editing.value.title || !editing.value.checkContent) {
        toast.error('标题和检查内容必填')
        return
    }
    const path = isEdit.value
        ? `/api/v1/admin/contract-playbooks/${editing.value.id}`
        : '/api/v1/admin/contract-playbooks'
    const res = await useApiFetch<Playbook>(path, {
        method: isEdit.value ? 'PATCH' : 'POST',
        body: editing.value,
    })
    if (res) {
        toast.success(isEdit.value ? '已更新' : '已新增')
        drawerOpen.value = false
        await Promise.all([loadList(), loadCounts()])
    }
}

async function toggleEnabled(p: Playbook) {
    const res = await useApiFetch<Playbook>(`/api/v1/admin/contract-playbooks/${p.id}`, {
        method: 'PATCH',
        body: { enabled: !p.enabled },
    })
    if (res) {
        toast.success(p.enabled ? '已停用' : '已启用')
        await Promise.all([loadList(), loadCounts()])
    }
}

watch([activeType, searchQ, enabledFilter], loadList, { immediate: false })
onMounted(async () => {
    await Promise.all([loadList(), loadCounts()])
})
</script>

<template>
    <div class="flex h-full">
        <!-- 左侧类型 Tab -->
        <div class="w-[200px] shrink-0 border-r bg-card p-2 space-y-1">
            <button
                v-for="t in TYPES"
                :key="t"
                class="w-full flex items-center justify-between px-3 py-2 rounded text-sm transition"
                :class="activeType === t ? 'bg-accent text-accent-foreground font-semibold' : 'hover:bg-muted'"
                @click="activeType = t"
            >
                <span>{{ t }}</span>
                <span class="text-xs text-muted-foreground">{{ typeCounts[t] ?? 0 }}</span>
            </button>
        </div>

        <!-- 右侧列表 -->
        <div class="flex-1 flex flex-col min-w-0">
            <div class="p-4 border-b flex items-center gap-3 bg-card">
                <Input v-model="searchQ" placeholder="按标题搜索" class="w-64" />
                <Select v-model="enabledFilter">
                    <SelectTrigger class="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部</SelectItem>
                        <SelectItem value="on">仅启用</SelectItem>
                        <SelectItem value="off">仅停用</SelectItem>
                    </SelectContent>
                </Select>
                <Button class="ml-auto" @click="openCreate">+ 新增要点</Button>
            </div>

            <div class="flex-1 overflow-auto p-4">
                <div v-if="loading" class="p-8 text-center text-muted-foreground">加载中...</div>
                <div v-else-if="!list.length" class="p-8 text-center text-muted-foreground">
                    该类型暂无要点，点击右上角"新增要点"
                </div>
                <Table v-else>
                    <TableHeader>
                        <TableRow>
                            <TableHead class="w-20">code</TableHead>
                            <TableHead>标题</TableHead>
                            <TableHead class="w-20">等级</TableHead>
                            <TableHead class="w-20">立场</TableHead>
                            <TableHead class="w-20">启用</TableHead>
                            <TableHead class="w-32">更新时间</TableHead>
                            <TableHead class="w-24">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow v-for="p in list" :key="p.id">
                            <TableCell class="font-mono text-xs">{{ p.code }}</TableCell>
                            <TableCell>{{ p.title }}</TableCell>
                            <TableCell>{{ RISK_LEVEL_LABEL[p.defaultLevel] }}</TableCell>
                            <TableCell>{{ STANCE_PREFERENCE_LABEL[p.stancePreference] }}</TableCell>
                            <TableCell>
                                <Switch :model-value="p.enabled" @update:model-value="toggleEnabled(p)" />
                            </TableCell>
                            <TableCell class="text-xs text-muted-foreground">
                                {{ new Date(p.updatedAt).toLocaleDateString() }}
                            </TableCell>
                            <TableCell>
                                <Button size="sm" variant="outline" @click="openEdit(p)">编辑</Button>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </div>

        <!-- 编辑抽屉 -->
        <Sheet v-model:open="drawerOpen">
            <SheetContent class="w-[520px] sm:max-w-[520px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>{{ isEdit ? '编辑要点' : '新增要点' }}</SheetTitle>
                </SheetHeader>
                <div class="space-y-4 py-4">
                    <div>
                        <Label>合同类型</Label>
                        <div class="text-sm text-muted-foreground mt-1">{{ editing.contractType }}</div>
                    </div>
                    <div v-if="!isEdit">
                        <Label>code（稳定标识，创建后不可改）</Label>
                        <Input v-model="editing.code" placeholder="如 probation" class="mt-1" />
                    </div>
                    <div>
                        <Label>标题</Label>
                        <Input v-model="editing.title" maxlength="30" class="mt-1" />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <Label>默认等级</Label>
                            <Select v-model="editing.defaultLevel">
                                <SelectTrigger class="mt-1"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="high">高</SelectItem>
                                    <SelectItem value="medium">中</SelectItem>
                                    <SelectItem value="low">低</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>立场偏好</Label>
                            <Select v-model="editing.stancePreference">
                                <SelectTrigger class="mt-1"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="strict">严格</SelectItem>
                                    <SelectItem value="balanced">中性</SelectItem>
                                    <SelectItem value="lenient">宽松</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div>
                        <Label>检查内容（给 AI 的指导语）</Label>
                        <Textarea v-model="editing.checkContent" rows="4" maxlength="500" class="mt-1" />
                    </div>
                    <div>
                        <Label>法律依据（可选）</Label>
                        <Textarea v-model="editing.legalBasis" rows="2" maxlength="300" class="mt-1" />
                    </div>
                    <div>
                        <Label>标准建议（可选）</Label>
                        <Textarea v-model="editing.suggestion" rows="3" maxlength="500" class="mt-1" />
                    </div>
                </div>
                <SheetFooter>
                    <Button variant="outline" @click="drawerOpen = false">取消</Button>
                    <Button @click="saveDrawer">保存</Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    </div>
</template>
```

- [ ] **Step 2: 运行类型检查**

```bash
npx nuxi typecheck
```

预期：0 错误（与本 task 无关的已存在错误除外）。

- [ ] **Step 3: 启动 dev server 手工验证**

```bash
bun dev
```

打开 `http://localhost:3000/admin/contract-playbooks`（以 super_admin 身份登录）：
- 左侧 6 个类型 Tab 可点击
- 右上角"新增要点"打开抽屉
- 抽屉填完字段点"保存"能成功写入、列表刷新
- 切换启用开关即时生效

- [ ] **Step 4: 提交**

```bash
git add app/pages/admin/contract-playbooks/
git commit -m "feat(ui): 新增合同审查清单管理页"
```

---

## Task 1.6: 菜单路由注册验证

**Files:**
- Potentially modify: `server/api/v1/admin/menu-routers.get.ts`

- [ ] **Step 1: 验证超管兜底是否自动发现新页面**

启动 dev server，以 super_admin 身份登录后访问 `/admin`，检查左侧菜单是否自动出现"审查清单管理"。

如果出现 → 跳过 Step 2，直接 commit 说明"依赖超管自动兜底"。

如果未出现 → 执行 Step 2。

- [ ] **Step 2: 若兜底未覆盖，在 DB 插入 router 行**

在 `prisma/seeds/seedData.sql` 的 routers INSERT 区块追加一行（对照现有 document-templates 的写法）：

```sql
INSERT INTO "public"."routers" ("name", "title", "path", "icon", "is_menu", "sort", "menu_group", "menu_group_sort", "created_at", "updated_at")
VALUES ('admin-contract-playbooks', '审查清单管理', '/admin/contract-playbooks', 'ClipboardList', true, 250, '合同审查', 30, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
```

应用：
```bash
docker exec postgres-postgres-1 psql -U postgres -d ls_new -c "<上面 SQL>"
```

- [ ] **Step 3: 提交**

```bash
git add prisma/seeds/seedData.sql 2>/dev/null  # 如有修改
git commit --allow-empty -m "chore(admin): 验证审查清单管理菜单注册（兜底或手动 INSERT）"
```

---

## Task 1.7: 初始空种子 + 6 类占位行

**Files:**
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 在 seedData.sql 追加 contract_playbooks 空种子区块**

在 `prisma/seeds/seedData.sql` 末尾（或 prompts 区块后）追加：

```sql
-- ==================== 合同审查清单要点（M7 Playbook） ====================
-- 每个类型预置 1 条占位要点，保证 seedData 可执行；运营在后台补齐其余
-- 后续法律顾问审校后的要点替换这里的 INSERT 即可

INSERT INTO "public"."contract_playbooks"
  ("contract_type", "code", "title", "default_level", "stance_preference", "check_content", "legal_basis", "suggestion", "enabled", "created_at", "updated_at")
VALUES
  ('劳动合同', 'probation', '试用期约定合规性', 'high', 'strict',
   '检查合同是否约定试用期；试用期长度是否超过《劳动合同法》第十九条规定的上限（3 个月合同无试用期；3 年以下不超 2 个月；3 年以上不超 6 个月）；试用期工资是否低于转正工资 80% 或低于当地最低工资。',
   '《劳动合同法》第十九条、第二十条',
   '建议将试用期调整为不超过 {{合法上限}} 个月，且试用期工资不低于转正工资 80%。',
   true, NOW(), NOW()),
  ('租赁合同', 'rent_increase', '租金调整机制', 'medium', 'balanced',
   '检查合同是否约定租金调整条款；调整频率、幅度、触发条件是否明确；是否赋予单方面调价权。',
   '《民法典》第七百零三条、第七百二十一条',
   '建议约定固定周期（如每 24 个月）调整一次，调整幅度上限不超过 CPI 涨幅。',
   true, NOW(), NOW()),
  ('买卖合同', 'delivery_risk', '交付与风险转移', 'high', 'balanced',
   '检查合同是否明确约定交付时间、地点、方式；风险转移节点是否清晰（交付 vs 所有权转移）；验收标准是否可操作。',
   '《民法典》第六百零四条、第六百零五条',
   '建议明确交付地点为"买方指定仓库签收"，风险自签收时转移，验收期 7 日。',
   true, NOW(), NOW()),
  ('服务合同', 'acceptance_criteria', '服务验收标准', 'high', 'balanced',
   '检查合同是否约定明确的服务交付物和验收标准；验收不通过的救济路径是否清晰；尾款支付是否与验收挂钩。',
   '《民法典》第七百七十二条',
   '建议将尾款 30% 与验收合格挂钩，验收周期 10 个工作日。',
   true, NOW(), NOW()),
  ('借款合同', 'interest_cap', '利率合规性', 'high', 'strict',
   '检查合同约定的利率、违约金、服务费等综合年化成本是否超过 LPR 的 4 倍（最高人民法院司法解释红线）。',
   '《最高人民法院关于审理民间借贷案件适用法律若干问题的规定》',
   '建议将综合年化成本控制在 LPR 4 倍以内，超过部分不受司法保护。',
   true, NOW(), NOW()),
  ('保密协议', 'scope_and_term', '保密范围与期限', 'medium', 'balanced',
   '检查保密范围是否具体（避免过宽的兜底条款）；保密期限是否合理；违反后果是否约定。',
   '《反不正当竞争法》第九条',
   '建议保密范围限定为明确列举的技术/商务信息；期限不超过 5 年；违约金设定为实际损失的 2 倍。',
   true, NOW(), NOW())
ON CONFLICT (contract_type, code) DO UPDATE SET
  title            = EXCLUDED.title,
  default_level    = EXCLUDED.default_level,
  stance_preference = EXCLUDED.stance_preference,
  check_content    = EXCLUDED.check_content,
  legal_basis      = EXCLUDED.legal_basis,
  suggestion       = EXCLUDED.suggestion,
  enabled          = EXCLUDED.enabled,
  updated_at       = NOW();
```

- [ ] **Step 2: 应用种子到本地 DB**

```bash
docker exec postgres-postgres-1 psql -U postgres -d ls_new < prisma/seeds/seedData.sql
```

或只跑上面新增区块（复制 SQL 手工跑）。

验证：
```bash
docker exec postgres-postgres-1 psql -U postgres -d ls_new -c "SELECT contract_type, count(*) FROM contract_playbooks GROUP BY contract_type;"
```

预期：6 行，每行 count=1。

- [ ] **Step 3: 启动 dev server 验证页面可见**

```bash
bun dev
```

访问 `/admin/contract-playbooks`，6 个类型 Tab 各显示 1 条要点。

- [ ] **Step 4: 提交**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(seed): 新增合同审查清单 6 类占位要点"
```

---

**Phase 1 完成检查点**

- [ ] `prisma migrate status` 干净
- [ ] `npx vitest run tests/server/assistant/contract/contractPlaybook*.test.ts` 全绿
- [ ] `npx nuxi typecheck` 0 错误
- [ ] `/admin/contract-playbooks` 页面可用，6 类 Tab × 1 条初始要点
- [ ] 运营可通过后台新增/编辑/停用要点

此时用户端尚无感知，Phase 2 上线后启用清单对照。

---

# Phase 2 · 用户侧（2.5 + 0.5 天）

## Task 2.1: 提示词模板更新（prompt id=28）

**Files:**
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 找到现有 prompt 28 定义，备份原内容**

查看 `prisma/seeds/seedData.sql` 第 2184 行起的 prompt 28 INSERT 语句。

- [ ] **Step 2: 替换 prompt 28 的 content 字段**

用下面完整 SQL 替换现有 prompt 28 的 INSERT 语句（或改为 UPDATE）：

```sql
INSERT INTO "public"."prompts" ("id", "name", "title", "content", "variables", "version", "type", "status", "node_id", "created_at", "updated_at", "deleted_at") VALUES (28, 'contractReviewAnalyzeClause_system', '合同审查·逐条条款分析提示词 v2',
'你正在审查合同（{{contractType}}），站在{{stanceLabel}}立场。
甲方：{{partyA}}；乙方：{{partyB}}。
当前条款（第 {{clauseIndex}} 条，编号 {{clauseNumber}}）：
"""
{{clauseText}}
"""

{{playbookSection}}

## 立场偏好使用规则
若上方存在审查清单，每条要点标注了"立场:strict/balanced/lenient"，组合判定口径：
- strict 要点：在用户当前立场下必须严格审查，任何模糊表述都出风险
- balanced 要点：按一般法律合规性审查，不偏不倚
- lenient 要点：若属行业商业惯例可接受，则可不报或降级为低风险
用户立场为"中立"时，所有要点按 balanced 处理。

## 输出要求
请判断该条款是否有风险。严格按 JSON 输出：

- 有风险（若违反清单某条，matchedPointCode 填对应 code；清单外风险 matchedPointCode 留空）：
  {
    "risk": {
      "id": "<UUID v4>",
      "clauseIndex": {{clauseIndex}},
      "clauseText": "<被分析的条款原文片段>",
      "level": "high" | "medium" | "low",
      "category": "<风险类别>",
      "problem": "<问题简述>",
      "legalBasis": "<相关法条，可选>",
      "analysis": "<详细分析>",
      "risk": "<法律风险点>",
      "suggestion": "<改进建议>",
      "suggestedClauseText": "<建议的条款修订文本，高/中风险必填>",
      "matchedPointCode": "<若命中清单要点，填其 code；否则留空>"
    },
    "skip": false
  }

- 无风险：
  { "risk": null, "skip": true }

注意：matchedPointCode 只能使用清单里列出的 code 原文，不要编号（如不要写 P1/P2）；清单外风险 matchedPointCode 留空字符串或不返此字段。',
'{"playbookSection": "integrated", "stanceLabel": "integrated", "contractType": "integrated", "partyA": "integrated", "partyB": "integrated", "clauseIndex": "integrated", "clauseNumber": "integrated", "clauseText": "integrated"}',
2, 'system', 1, 20, NOW(), NOW(), NULL)
ON CONFLICT (name) DO UPDATE SET
  title      = EXCLUDED.title,
  content    = EXCLUDED.content,
  variables  = EXCLUDED.variables,
  version    = EXCLUDED.version,
  updated_at = NOW();
```

- [ ] **Step 3: 应用到本地 DB**

```bash
docker exec postgres-postgres-1 psql -U postgres -d ls_new -c "<上面完整 SQL>"
```

验证：
```bash
docker exec postgres-postgres-1 psql -U postgres -d ls_new -c "SELECT version, LEFT(content, 50) FROM prompts WHERE id=28;"
```

预期：version=2，content 以"你正在审查合同"开头。

- [ ] **Step 4: 提交**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(prompt): 更新合同逐条分析提示词 v2，注入 playbookSection 占位符"
```

---

## Task 2.2: analyzeSingleClause 改造

**Files:**
- Modify: `server/services/assistant/contract/analyzeSingleClause.ts`
- Modify: `tests/server/assistant/contract/analyzeSingleClause.test.ts`

- [ ] **Step 1: 扩展 analyzeSingleClause 测试**

在 `tests/server/assistant/contract/analyzeSingleClause.test.ts` 末尾新增 describe 块：

```ts
import type { PlaybookSnapshot } from '#shared/types/contract'

const SNAPSHOT: PlaybookSnapshot = {
    contractType: '劳动合同',
    snapshotAt: '2026-04-22T00:00:00Z',
    points: [
        { code: 'probation', title: '试用期合规', defaultLevel: 'high', stancePreference: 'strict', checkContent: '检查试用期长度' },
        { code: 'overtime', title: '加班费基数', defaultLevel: 'medium', stancePreference: 'balanced', checkContent: '检查加班费' },
    ],
}

describe('analyzeSingleClause · playbook', () => {
    it('snapshot 传入时 prompt 渲染 playbookSection', async () => {
        // 以 spy mock createChatModel，断言 invoke 收到的 prompt 字符串含清单段
        // （测试细节参考原文件现有 mock 写法）
    })

    it('AI 返回合法 matchedPointCode 透传', async () => {
        // mock invoke 返回 risk.matchedPointCode='probation'，assert 返回对象含此字段
    })

    it('AI 返回非法 code 降级为清单外 + warn', async () => {
        // mock invoke 返回 risk.matchedPointCode='not_in_snapshot'，assert 返回对象 matchedPointCode 为 undefined
        // 额外 spy logger.warn 断言被调用一次
    })

    it('AI 漏返 matchedPointCode 直接当清单外', async () => {
        // mock invoke 返回 risk 无 matchedPointCode 字段，assert 返回对象 matchedPointCode 为 undefined；logger.warn 不被调用
    })

    it('snapshot=null 时 playbookSection 为空字符串', async () => {
        // 不传 snapshot；断言 prompt 里 {{playbookSection}} 被替换为空
    })
})
```

（完整 mock 细节参考当前 `analyzeSingleClause.test.ts` 同文件的第 1~60 行写法。）

- [ ] **Step 2: 跑测试验证失败**

```bash
npx vitest run tests/server/assistant/contract/analyzeSingleClause.test.ts
```

预期：新增 5 个用例 FAIL（函数签名不匹配）。

- [ ] **Step 3: 实现 analyzeSingleClause 改造**

修改 `server/services/assistant/contract/analyzeSingleClause.ts`：

1. 在文件顶部 `import type { ClauseSegment } ...` 行扩展引入类型：

```ts
import type { Risk, Stance, ClauseSegment, PlaybookSnapshot, PlaybookPointSnapshot } from '#shared/types/contract'
```

2. 扩展 `AnalyzeClauseContext` 接口：

```ts
export interface AnalyzeClauseContext {
    clause: ClauseSegment
    stance: Stance
    partyA: string | null
    partyB: string | null
    contractType: string | null
    /** M7 Playbook 快照；null 表示无清单（"其他"类型或运营未配置） */
    playbookSnapshot?: PlaybookSnapshot | null
}
```

3. 在文件末尾新增 `renderPlaybookSection` 函数：

```ts
/**
 * 把清单快照渲染成 prompt 里的"审查清单"段。snapshot 为空时返回空串。
 */
function renderPlaybookSection(snapshot: PlaybookSnapshot | null | undefined): string {
    if (!snapshot || !snapshot.points.length) return ''

    const lines: string[] = [`## 本合同审查清单（${snapshot.contractType}）`]
    for (const p of snapshot.points) {
        lines.push(`- code="${p.code}"  [${p.defaultLevel} · 立场:${p.stancePreference}]  ${p.title}`)
        lines.push(`    检查内容：${p.checkContent}`)
        if (p.legalBasis) lines.push(`    法律依据：${p.legalBasis}`)
        if (p.suggestion) lines.push(`    标准建议：${p.suggestion}`)
    }
    lines.push('')
    lines.push('请逐条审查合同条款。若违反上述某条要点，在输出风险时填 "matchedPointCode": "<对应 code>"（code 原样引用，不要编号）。若发现清单外的重大风险，照常输出，matchedPointCode 留空。')
    return lines.join('\n')
}
```

4. 在 `renderPromptTemplate` 函数中加入 `playbookSection` 变量：

```ts
function renderPromptTemplate(template: string, ctx: AnalyzeClauseContext): string {
    const stanceLabel = ctx.stance === 'partyA' ? '甲方' : ctx.stance === 'partyB' ? '乙方' : '中立第三方'
    const clauseText = ctx.clause.text.length > MAX_CLAUSE_CHARS
        ? `${ctx.clause.text.slice(0, MAX_CLAUSE_CHARS)}…(已截断)`
        : ctx.clause.text

    const rendered = renderContent(template, {
        stanceLabel,
        contractType: ctx.contractType ?? '未知类型',
        partyA: ctx.partyA ?? '未知',
        partyB: ctx.partyB ?? '未知',
        clauseIndex: String(ctx.clause.index),
        clauseNumber: ctx.clause.number ?? '无',
        clauseText,
        playbookSection: renderPlaybookSection(ctx.playbookSnapshot),
    })
    // ...其余不变
}
```

5. 在 `analyzeSingleClause` 主函数里，parsed 成功之后加入 code 白名单校验：

```ts
if (parsed.data.skip || !parsed.data.risk) return null

const rawRisk = parsed.data.risk
let matchedPointCode: string | undefined = rawRisk.matchedPointCode?.trim() || undefined

// 白名单校验：AI 返回的 code 必须在快照里存在；否则降级为清单外（警告）
if (matchedPointCode && ctx.playbookSnapshot) {
    const validCodes = new Set(ctx.playbookSnapshot.points.map(p => p.code))
    if (!validCodes.has(matchedPointCode)) {
        logger.warn('analyzeSingleClause: AI 返回未知的 matchedPointCode，降级为清单外', {
            clauseIndex: ctx.clause.index,
            returnedCode: matchedPointCode,
            validCodes: [...validCodes],
        })
        matchedPointCode = undefined
    }
}
// snapshot 不存在时，AI 不应返回 matchedPointCode；如果返了，静默忽略
if (matchedPointCode && !ctx.playbookSnapshot) {
    matchedPointCode = undefined
}

return {
    ...rawRisk,
    id: randomUUID(),
    matchedPointCode,
} as Risk
```

6. 同步在 `RISK_SHAPE` 或 `SingleClauseResponse` 里加入 `matchedPointCode` 字段（查找 `./riskSchema.builder.ts`，若已有放行任意额外字段可不改；若 strict，需新增）。

- [ ] **Step 4: 运行测试验证通过**

```bash
npx vitest run tests/server/assistant/contract/analyzeSingleClause.test.ts
```

预期：全部通过（原有 + 新增 5 个）。

- [ ] **Step 5: 提交**

```bash
git add server/services/assistant/contract/analyzeSingleClause.ts tests/server/assistant/contract/analyzeSingleClause.test.ts server/services/assistant/contract/riskSchema.builder.ts
git commit -m "feat(contract): analyzeSingleClause 支持 playbookSnapshot 注入 + matchedPointCode 白名单校验"
```

---

## Task 2.3: contractReviewMainAgent resume 分支写快照

**Files:**
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`
- Test: `tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { runAnalyzeLoop } from '~~/server/services/workflow/agents/contractReviewMainAgent'

// mock analyzeSingleClause 观察它是否收到 playbookSnapshot 参数
vi.mock('~~/server/services/assistant/contract/analyzeSingleClause', () => ({
    analyzeSingleClause: vi.fn(async (ctx: any) => {
        if (ctx.clause.index === 1) {
            return {
                id: 'r1', clauseIndex: 1, clauseText: ctx.clause.text, level: 'high',
                category: 't', problem: 'p', analysis: 'a', risk: 'r', suggestion: 's',
                matchedPointCode: ctx.playbookSnapshot?.points[0]?.code,
            }
        }
        return null
    }),
}))

describe('contractReviewMainAgent resume · playbook snapshot', () => {
    // 测试焦点：resume 分支内 snapshot 正确从 DB 捞出、传入 runAnalyzeLoop
    // 由于 runContractReviewChat 整体很重，本测试只覆盖 runAnalyzeLoop 收到 snapshot 时的透传行为
    it('runAnalyzeLoop 把 playbookSnapshot 透传给 analyzeSingleClause', async () => {
        const { analyzeSingleClause } = await import('~~/server/services/assistant/contract/analyzeSingleClause')
        const snapshot = {
            contractType: '劳动合同',
            snapshotAt: '2026-04-22T00:00:00Z',
            points: [{ code: 'probation', title: 't', defaultLevel: 'high' as const, stancePreference: 'strict' as const, checkContent: 'c' }],
        }
        const result = await runAnalyzeLoop({
            segments: [{ index: 1, number: '1', text: 'x' }],
            stance: 'partyB',
            partyA: 'A', partyB: 'B', contractType: '劳动合同',
            playbookSnapshot: snapshot,
            emitterCtx: { runId: '', sessionId: 'test' },
        })
        expect(result.risks).toHaveLength(1)
        expect(result.risks[0]!.matchedPointCode).toBe('probation')
        expect(analyzeSingleClause).toHaveBeenCalledWith(
            expect.objectContaining({ playbookSnapshot: snapshot }),
        )
    })
})
```

- [ ] **Step 2: 运行测试验证失败**

```bash
npx vitest run tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts
```

预期：FAIL（`AnalyzeLoopContext` 无 `playbookSnapshot` 字段）。

- [ ] **Step 3: 扩展 AnalyzeLoopContext**

修改 `server/services/workflow/agents/contractReviewMainAgent.ts`：

1. 文件顶部 import 加：
```ts
import type { Risk, Stance, ClauseSegment, PlaybookSnapshot } from '#shared/types/contract'
import { listEnabledPlaybookPointsDAO } from '../../assistant/contract/contractPlaybook.dao'
```

2. `AnalyzeLoopContext` 接口加字段：
```ts
export interface AnalyzeLoopContext {
    segments: ClauseSegment[]
    stance: Stance
    partyA: string | null
    partyB: string | null
    contractType: string | null
    /** M7 Playbook 快照；null/undefined 表示无清单，analyzeSingleClause 内部会按无清单 prompt 审查 */
    playbookSnapshot?: PlaybookSnapshot | null
    emitterCtx: ContractReviewEmitterCtx
}
```

3. `runAnalyzeLoop` 的 `analyzeSingleClause` 调用处把 snapshot 传进去：
```ts
const risk = await analyzeSingleClause({
    clause: seg,
    stance: ctx.stance,
    partyA: ctx.partyA,
    partyB: ctx.partyB,
    contractType: ctx.contractType,
    playbookSnapshot: ctx.playbookSnapshot,
})
```

- [ ] **Step 4: 在 resume 分支写快照并传入 runAnalyzeLoop**

在 `runContractReviewChat` resume 分支（找 `if (command)` 块内部）：

1. 在 `await updateContractReviewDAO(review.id, { stance, ...status: 'reviewing' })` 之后、`if (segments.length === 0)` 之前，插入快照写入代码：

```ts
// M7：写入 playbook 快照（在 stance 落库后、analyze 开始前）
let playbookSnapshot: PlaybookSnapshot | null = null
if (review.contractType && review.contractType !== '其他') {
    try {
        const points = await listEnabledPlaybookPointsDAO(review.contractType)
        if (points.length > 0) {
            playbookSnapshot = {
                contractType: review.contractType,
                points,
                snapshotAt: new Date().toISOString(),
            }
            await updateContractReviewDAO(review.id, { playbookSnapshot })
            logger.info('Playbook 快照写入', {
                reviewId: review.id,
                contractType: review.contractType,
                pointCount: points.length,
            })
        }
    } catch (err) {
        logger.warn('Playbook 快照写入失败，降级为无清单审查', {
            reviewId: review.id,
            err: err instanceof Error ? err.message : String(err),
        })
    }
}
```

2. 修改下面的 `runAnalyzeLoop` 调用，传入 snapshot：

```ts
const { risks } = await runAnalyzeLoop({
    segments,
    stance,
    partyA: finalPartyA,
    partyB: finalPartyB,
    contractType: review.contractType,
    playbookSnapshot,                // [新增]
    emitterCtx,
})
```

- [ ] **Step 5: 运行测试验证通过**

```bash
npx vitest run tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts
```

预期：PASS。

回归检查：
```bash
npx vitest run tests/server/workflow/agents/contractReviewMainAgent.streaming.test.ts
```

预期：原有流式测试仍绿。

- [ ] **Step 6: 提交**

```bash
git add server/services/workflow/agents/contractReviewMainAgent.ts tests/server/workflow/agents/contractReviewMainAgent.playbook.test.ts
git commit -m "feat(contract): resume 分支写 playbook 快照并注入 analyze loop"
```

---

## Task 2.4: 前端 composable — useContractPlaybookMatch

**Files:**
- Create: `app/composables/useContractPlaybookMatch.ts`
- Test: `tests/app/composables/useContractPlaybookMatch.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/app/composables/useContractPlaybookMatch.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useContractPlaybookMatch } from '~/composables/useContractPlaybookMatch'
import type { PlaybookSnapshot, Risk } from '#shared/types/contract'

const snapshot: PlaybookSnapshot = {
    contractType: '劳动合同',
    snapshotAt: '2026-04-22T00:00:00Z',
    points: [
        { code: 'probation', title: '试用期', defaultLevel: 'high', stancePreference: 'strict', checkContent: 'c' },
        { code: 'overtime', title: '加班费', defaultLevel: 'medium', stancePreference: 'balanced', checkContent: 'c' },
        { code: 'compete', title: '竞业', defaultLevel: 'low', stancePreference: 'lenient', checkContent: 'c' },
    ],
}

const risk = (id: string, code?: string): Risk => ({
    id, clauseIndex: 1, clauseText: 't', level: 'high', category: 'c',
    problem: 'p', analysis: 'a', risk: 'r', suggestion: 's',
    matchedPointCode: code,
})

describe('useContractPlaybookMatch', () => {
    it('snapshot=null 时 enabled=false 其他为空', () => {
        const m = useContractPlaybookMatch(ref(null), ref([]))
        expect(m.enabled.value).toBe(false)
        expect(m.total.value).toBe(0)
        expect(m.hitCount.value).toBe(0)
        expect(m.hits.value).toEqual([])
        expect(m.misses.value).toEqual([])
        expect(m.extras.value).toEqual([])
    })

    it('命中计数 + 未命中 + 清单外三态派生正确', () => {
        const risks = [
            risk('r1', 'probation'),
            risk('r2', 'overtime'),
            risk('r3', 'overtime'),   // 重复命中同一条，hitCount 不重复计
            risk('r4'),                // 清单外
            risk('r5', 'nonexistent'), // 无效 code（实际场景服务端已降级为 undefined，但客户端也防御）
        ]
        const m = useContractPlaybookMatch(ref(snapshot), ref(risks))
        expect(m.enabled.value).toBe(true)
        expect(m.total.value).toBe(3)
        expect(m.hitCount.value).toBe(2)
        expect(m.hits.value).toHaveLength(2)
        expect(m.hits.value[0]!.point.code).toBe('probation')  // 按快照顺序
        expect(m.hits.value[1]!.point.code).toBe('overtime')
        expect(m.misses.value).toHaveLength(1)
        expect(m.misses.value[0]!.code).toBe('compete')
        expect(m.extras.value).toHaveLength(2)  // r4 + r5
    })

    it('响应式：snapshot / risks 变化时重算', () => {
        const snap = ref<PlaybookSnapshot | null>(null)
        const rs = ref<Risk[]>([])
        const m = useContractPlaybookMatch(snap, rs)
        expect(m.enabled.value).toBe(false)
        snap.value = snapshot
        rs.value = [risk('r1', 'probation')]
        expect(m.enabled.value).toBe(true)
        expect(m.hitCount.value).toBe(1)
    })
})
```

- [ ] **Step 2: 跑测试验证失败**

```bash
npx vitest run tests/app/composables/useContractPlaybookMatch.test.ts
```

预期：FAIL（模块不存在）。

- [ ] **Step 3: 实现 composable**

创建 `app/composables/useContractPlaybookMatch.ts`：

```ts
/**
 * 合同审查清单对照派生 composable
 *
 * 输入：playbookSnapshot（冻结在 review 里）+ risks（AI 输出）
 * 输出：命中/未命中/清单外三态 + enabled / total / hitCount 统计
 *
 * 用于 OverviewPanel"清单对照"板块 + RiskListPanel 风险卡徽章。
 *
 * **Feature: contract-review-playbook (M7)**
 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { PlaybookSnapshot, PlaybookPointSnapshot, Risk } from '#shared/types/contract'

export interface PlaybookMatchResult {
    enabled: ComputedRef<boolean>
    total: ComputedRef<number>
    hitCount: ComputedRef<number>
    hits: ComputedRef<Array<{ point: PlaybookPointSnapshot; risk: Risk }>>
    misses: ComputedRef<PlaybookPointSnapshot[]>
    extras: ComputedRef<Risk[]>
}

export function useContractPlaybookMatch(
    snapshot: Ref<PlaybookSnapshot | null>,
    risks: Ref<Risk[]>,
): PlaybookMatchResult {
    const enabled = computed(() => snapshot.value !== null && snapshot.value.points.length > 0)

    const validCodes = computed(() => {
        if (!snapshot.value) return new Set<string>()
        return new Set(snapshot.value.points.map(p => p.code))
    })

    const total = computed(() => snapshot.value?.points.length ?? 0)

    // code -> first matched risk（按 risks 顺序取首个）
    const codeToRisk = computed(() => {
        const m = new Map<string, Risk>()
        for (const r of risks.value) {
            const code = r.matchedPointCode
            if (!code) continue
            if (!validCodes.value.has(code)) continue
            if (!m.has(code)) m.set(code, r)
        }
        return m
    })

    const hitCount = computed(() => codeToRisk.value.size)

    const hits = computed(() => {
        if (!snapshot.value) return []
        return snapshot.value.points
            .filter(p => codeToRisk.value.has(p.code))
            .map(p => ({ point: p, risk: codeToRisk.value.get(p.code)! }))
    })

    const misses = computed(() => {
        if (!snapshot.value) return []
        return snapshot.value.points.filter(p => !codeToRisk.value.has(p.code))
    })

    const extras = computed(() => {
        return risks.value.filter((r) => {
            if (!r.matchedPointCode) return true
            if (!validCodes.value.has(r.matchedPointCode)) return true
            return false
        })
    })

    return { enabled, total, hitCount, hits, misses, extras }
}
```

- [ ] **Step 4: 跑测试验证通过**

```bash
npx vitest run tests/app/composables/useContractPlaybookMatch.test.ts
```

预期：3/3 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/composables/useContractPlaybookMatch.ts tests/app/composables/useContractPlaybookMatch.test.ts
git commit -m "feat(contract): 新增前端派生 composable useContractPlaybookMatch"
```

---

## Task 2.5: OverviewPanel 增加"清单对照"板块

**Files:**
- Modify: `app/components/assistant/contract/OverviewPanel.vue`

- [ ] **Step 1: 改 props 接受 snapshot 和 risks**

修改 `app/components/assistant/contract/OverviewPanel.vue` 的 `<script setup>`：

在 defineProps 里加 `playbookSnapshot`（risks 已有）：

```ts
import { TriangleAlert, Info, ClipboardList, ChevronDown } from 'lucide-vue-next'
import type { Risk, ContractOverview, PlaybookSnapshot } from '#shared/types/contract'

const props = defineProps<{
    risks: Risk[]
    summary: ContractOverview | null
    playbookSnapshot: PlaybookSnapshot | null
}>()
```

派生逻辑加入：

```ts
import { useContractPlaybookMatch } from '~/composables/useContractPlaybookMatch'

const snapshotRef = computed(() => props.playbookSnapshot)
const risksRefForMatch = computed(() => props.risks)
const playbookMatch = useContractPlaybookMatch(snapshotRef as any, risksRefForMatch as any)

const missesExpanded = ref(false)
```

- [ ] **Step 2: 在模板里插入"清单对照"板块**

在 `<template>` 中，原先"总评"之前插入：

```vue
<!-- 清单对照板块（仅 playbookMatch.enabled 时显示） -->
<div
    v-if="playbookMatch.enabled.value"
    class="rounded-md border bg-background px-3 py-2 space-y-2"
>
    <div class="flex items-center gap-2 text-xs font-semibold">
        <ClipboardList class="size-3.5" />
        <span>审查清单 · {{ playbookSnapshot!.contractType }}</span>
        <span class="ml-auto text-muted-foreground">
            命中 {{ playbookMatch.hitCount.value }} / {{ playbookMatch.total.value }}
        </span>
    </div>

    <!-- 命中项 -->
    <div v-if="playbookMatch.hits.value.length" class="space-y-1">
        <button
            v-for="h in playbookMatch.hits.value"
            :key="h.point.code"
            :data-riskid="h.risk.id"
            class="block w-full text-left text-xs px-1.5 py-1 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
            @click="emit('focusRisk', h.risk.id)"
        >
            <span class="text-red-600 dark:text-red-300 mr-1">⚠</span>
            <span class="font-medium">{{ h.point.title }}</span>
            <span class="text-muted-foreground ml-1">（{{ h.point.defaultLevel === 'high' ? '高' : h.point.defaultLevel === 'medium' ? '中' : '低' }}）</span>
        </button>
    </div>

    <!-- 未命中项 -->
    <div v-if="playbookMatch.misses.value.length" class="border-t pt-1.5">
        <button
            class="w-full flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            @click="missesExpanded = !missesExpanded"
        >
            <ChevronDown class="size-3 transition-transform" :class="{ 'rotate-180': missesExpanded }" />
            <span>未命中 {{ playbookMatch.misses.value.length }} 条</span>
        </button>
        <div v-if="missesExpanded" class="mt-1 pl-4 space-y-0.5">
            <div
                v-for="p in playbookMatch.misses.value"
                :key="p.code"
                class="text-xs text-muted-foreground"
            >
                · {{ p.title }}
            </div>
        </div>
    </div>
</div>
```

- [ ] **Step 3: 改 ContractReviewPanel 把 snapshot 传下来**

修改 `app/components/assistant/contract/ContractReviewPanel.vue`：

找到 OverviewPanel（或间接通过 RiskListPanel）的使用处。

在 useContractReview 的返回里应已有 review 对象——从 `review.value?.playbookSnapshot` 派生 snapshot。

在 template 里把 `:playbook-snapshot="review?.playbookSnapshot ?? null"` 加到 OverviewPanel props。

具体路径：OverviewPanel 是从 RiskListPanel 里嵌套的，所以：

1. `RiskListPanel.vue` defineProps 加 `playbookSnapshot: PlaybookSnapshot | null`
2. 把它转发给 `<AssistantContractOverviewPanel :playbook-snapshot="playbookSnapshot" ... />`
3. `ContractReviewPanel.vue` 使用 RiskListPanel 时传 `:playbook-snapshot="review?.playbookSnapshot as PlaybookSnapshot | null ?? null"`

- [ ] **Step 4: 运行测试 + 类型检查**

```bash
npx nuxi typecheck
npx vitest run tests/app/components/assistant/contract/OverviewPanel.test.ts
```

预期：类型 0 错误；OverviewPanel 原有测试不受影响（没传 playbookSnapshot 走 null 分支，不渲染板块）。

如 OverviewPanel 现有测试挂掉，补一行：
```ts
// 原有挂载处：playbookSnapshot: null
```

- [ ] **Step 5: 启动 dev 手工验证**

```bash
bun dev
```

上传一份劳动合同，等审查完成，总览区能看到"审查清单 · 劳动合同 · 命中 N/M"板块，点命中项能跳到对应风险卡。

- [ ] **Step 6: 提交**

```bash
git add app/components/assistant/contract/OverviewPanel.vue app/components/assistant/contract/RiskListPanel.vue app/components/assistant/contract/ContractReviewPanel.vue
git commit -m "feat(ui): OverviewPanel 新增清单对照板块（命中/未命中）"
```

---

## Task 2.6: RiskListPanel 风险卡要点徽章

**Files:**
- Modify: `app/components/assistant/contract/RiskListPanel.vue`

- [ ] **Step 1: 读快照并渲染徽章**

修改 `RiskListPanel.vue`：

1. defineProps 加（Task 2.5 里已加）：
```ts
playbookSnapshot: PlaybookSnapshot | null
```

2. 派生一个 code → title 的 Map：
```ts
const pointTitleByCode = computed(() => {
    const m = new Map<string, string>()
    if (props.playbookSnapshot) {
        for (const p of props.playbookSnapshot.points) {
            m.set(p.code, p.title)
        }
    }
    return m
})

function titleForRisk(r: Risk): string | null {
    if (!r.matchedPointCode) return null
    return pointTitleByCode.value.get(r.matchedPointCode) ?? null
}
```

3. 在 CardHeader 的标题行，紧跟 `{{ r.category }}` 之后，加徽章：

```vue
<Badge
    v-if="titleForRisk(r)"
    variant="secondary"
    class="text-[10px] px-1.5 py-0 font-normal shrink-0"
>
    <TooltipProvider>
        <Tooltip>
            <TooltipTrigger as-child>
                <span class="flex items-center gap-0.5">
                    <ClipboardList class="size-2.5" />
                    {{ titleForRisk(r) }}
                </span>
            </TooltipTrigger>
            <TooltipContent class="max-w-xs text-xs">
                <div class="font-semibold mb-1">{{ titleForRisk(r) }}</div>
                <div v-if="pointByCode(r.matchedPointCode!)?.checkContent" class="mb-1">
                    <span class="text-muted-foreground">检查：</span>
                    {{ pointByCode(r.matchedPointCode!)?.checkContent }}
                </div>
                <div v-if="pointByCode(r.matchedPointCode!)?.legalBasis" class="mb-1">
                    <span class="text-muted-foreground">法律依据：</span>
                    {{ pointByCode(r.matchedPointCode!)?.legalBasis }}
                </div>
                <div v-if="pointByCode(r.matchedPointCode!)?.suggestion">
                    <span class="text-muted-foreground">建议：</span>
                    {{ pointByCode(r.matchedPointCode!)?.suggestion }}
                </div>
            </TooltipContent>
        </Tooltip>
    </TooltipProvider>
</Badge>
```

辅助函数：
```ts
function pointByCode(code: string) {
    return props.playbookSnapshot?.points.find(p => p.code === code) ?? null
}
```

lucide import 加 `ClipboardList`。

- [ ] **Step 2: 类型检查 + 单测**

```bash
npx nuxi typecheck
npx vitest run tests/app/components/assistant/contract/RiskListPanel.test.ts
```

预期：0 错误；原有测试通过。

- [ ] **Step 3: 手工验证**

```bash
bun dev
```

上传劳动合同审查，命中清单的风险卡标题行显示灰色徽章"⚠·试用期约定合规性"，hover 显示 tooltip 全文。

- [ ] **Step 4: 提交**

```bash
git add app/components/assistant/contract/RiskListPanel.vue
git commit -m "feat(ui): 风险卡加清单要点徽章 + tooltip 展示全文"
```

---

## Task 2.7: PDF 导出新增"清单对照"节

**Files:**
- Modify: `server/services/assistant/contract/contractReviewPdf.service.ts`

- [ ] **Step 1: 读当前 PDF 服务结构**

查看 `server/services/assistant/contract/contractReviewPdf.service.ts`，找到渲染"总览"区的位置（应类似一个段落/表格组合）。

- [ ] **Step 2: 在总览之后插入清单对照节**

在 PDF 渲染的"总览"完整输出之后（找标志如 `// 总览 end` 或 `overall` 内容尾），插入：

```ts
// M7 Playbook：清单对照节（snapshot 存在时才渲染）
const snapshot = review.playbookSnapshot as PlaybookSnapshot | null
if (snapshot && snapshot.points.length > 0) {
    const hitCodes = new Set(
        (review.risks as Risk[] | null ?? [])
            .map(r => r.matchedPointCode)
            .filter((c): c is string => !!c && snapshot.points.some(p => p.code === c)),
    )
    // 章节标题
    doc.addPage()  // 或按现有规则分页
    doc.fontSize(16).text(`审查清单对照 · ${snapshot.contractType}`, { continued: false })
    doc.moveDown(0.5)
    doc.fontSize(12).text(`命中 ${hitCodes.size} / ${snapshot.points.length}`, { continued: false })
    doc.moveDown(0.5)

    // 命中项
    for (const p of snapshot.points) {
        if (!hitCodes.has(p.code)) continue
        doc.fontSize(11).fillColor('#b91c1c').text(`⚠ ${p.title}（${levelLabel(p.defaultLevel)}）`, { continued: false })
        doc.moveDown(0.2)
    }
    doc.fillColor('black').moveDown(0.3)

    // 未命中项
    const misses = snapshot.points.filter(p => !hitCodes.has(p.code))
    if (misses.length > 0) {
        doc.fontSize(11).text(`已检查未发现问题（${misses.length} 条）：`, { continued: false })
        for (const p of misses) {
            doc.fontSize(10).fillColor('#6b7280').text(`  · ${p.title}`)
        }
        doc.fillColor('black')
    }
    doc.moveDown(1)
}
```

> `levelLabel` 如该文件没有，直接 inline：`p.defaultLevel === 'high' ? '高' : p.defaultLevel === 'medium' ? '中' : '低'`。
>
> 若该文件使用的不是 pdfkit 而是其他 PDF 库（如 puppeteer HTML → PDF），按同文件现有写法替换。

- [ ] **Step 3: 类型补全**

在文件顶部 import 加：
```ts
import type { PlaybookSnapshot, Risk } from '#shared/types/contract'
```

- [ ] **Step 4: 单测补一例**

在 `tests/server/assistant/contract/contractReviewPdf.service.test.ts`（已存在）新增一个 case：

```ts
it('snapshot 存在时 PDF 含审查清单对照节', async () => {
    // 构造一个带 playbookSnapshot + 1 条命中 risk 的 review
    // 生成 PDF，断言其文本内容含 '审查清单对照' 字样
    // （具体断言手段参考原文件现有 pdf 内容提取方式）
})
```

- [ ] **Step 5: 跑测试 + 手工验证 PDF**

```bash
npx vitest run tests/server/assistant/contract/contractReviewPdf.service.test.ts
```

手工：在 dev 环境完成一次劳动合同审查 → 点"导出评审报告" → 打开 PDF，检查有"审查清单对照"节。

- [ ] **Step 6: 提交**

```bash
git add server/services/assistant/contract/contractReviewPdf.service.ts tests/server/assistant/contract/contractReviewPdf.service.test.ts
git commit -m "feat(pdf): 评审报告 PDF 新增审查清单对照节"
```

---

## Task 2.8: E2E 综合验证

**Files:**
- 无新建；通过 chrome-devtools MCP 手工验证

- [ ] **Step 1: 启动 dev + 登录**

```bash
bun dev
```

以普通用户身份登录。

- [ ] **Step 2: 劳动合同场景**

- 上传一份真实劳动合同 .docx
- 在立场 Dialog 中选"乙方"
- 等待审查完成
- **检查**：
  - 结果页总览区下方可见"审查清单 · 劳动合同 · 命中 N/M"板块
  - 命中项点击能跳转到对应风险卡
  - 未命中项折叠展开可用
  - 风险卡标题行的灰色徽章可见
  - hover 徽章显示要点全文
  - 点"导出评审报告"生成 PDF 含清单对照节

- [ ] **Step 3: "其他"类型场景**

- 上传一份明显非 6 类的合同（如合作框架协议）
- AI 识别为"其他"类型
- 等待审查完成
- **检查**：
  - 总览区无"审查清单"板块
  - 风险卡无徽章
  - 审查其余流程照常

- [ ] **Step 4: 历史审查冻结验证**

- 登录 `/admin/contract-playbooks`，编辑劳动合同的某条要点（如改标题或停用）
- 回到用户端打开上一次劳动合同审查
- **检查**：总览区的清单对照与刚才看到的一致（快照冻结）

- [ ] **Step 5: 记录验证结果**

在 dev 分支 commit 一条 E2E 验证记录：

```bash
git commit --allow-empty -m "test(e2e): Playbook 端到端手工验证通过（劳动合同 / 其他 / 快照冻结）"
```

---

## Task 2.9: 最终联调 + 缓冲（0.5 天）

**Files:**
- 根据实测暴露的问题修

- [ ] **Step 1: 跑全量测试**

```bash
npx vitest run
```

预期：全绿；若有红的排查修复。

- [ ] **Step 2: 类型检查**

```bash
npx nuxi typecheck
```

预期：0 错误。

- [ ] **Step 3: 代码规范检查（如项目有 eslint）**

```bash
bun run lint
```

修复明显违规。

- [ ] **Step 4: simplify 技能优化**

使用 `simplify` 技能走一遍本次改动涉及的文件，按建议合理简化。

- [ ] **Step 5: 推送 + PR 或合并到 dev**

```bash
git push origin feat/contract-playbook
# 或直接合到 dev
git checkout dev
git merge --no-ff feat/contract-playbook -m "Merge branch 'feat/contract-playbook' into dev"
git push origin dev
```

---

## 完成验证清单（Definition of Done）

Phase 1：
- [ ] `contract_playbooks` 表在 migrations 里、`prisma migrate status` 干净
- [ ] 管理页 `/admin/contract-playbooks` 可增改、切换启用
- [ ] DAO/API 单测全绿，覆盖率 ≥80%（核心路径）
- [ ] 初始种子 6 类 × 1 条落库

Phase 2：
- [ ] resume 分支自动写 playbookSnapshot（劳动合同等 6 类）
- [ ] "其他"类型不写快照、不显示板块
- [ ] analyzeSingleClause prompt 正确注入 playbookSection
- [ ] AI 返回 matchedPointCode 透传到前端；非法 code 降级为 undefined 且有 warn 日志
- [ ] OverviewPanel 清单对照板块 + 命中跳转
- [ ] RiskListPanel 风险卡徽章 + tooltip
- [ ] PDF 含审查清单对照节
- [ ] 历史审查快照永久冻结，后台编辑要点不影响老审查
- [ ] E2E 三场景（劳动 / 其他 / 冻结）全部验证通过

---

## 风险与缓解速查

| 风险 | 缓解 |
|------|------|
| Phase 1 上线后 Phase 2 还没好，管理页有要点但 AI 不消费 | Phase 1 单独合到 dev 但不发 prod；全部完成再联合发 |
| AI 返回 matchedPointCode 胡乱写 | 服务端白名单校验已覆盖 + 日志 warn 便于后续监控 |
| 种子要点法律严谨度不够 | 占位 6 条是项目组初稿；发版前等法律顾问审校（不占本期工期） |
| OverviewPanel 改动引入回归 | 现有 OverviewPanel 测试继续跑；Task 2.5 Step 4 显式覆盖 |
| PDF 库兼容性（不确定用 pdfkit 还是 puppeteer） | Task 2.7 Step 2 注脚说明按原文件风格替换；遇到再补 |
