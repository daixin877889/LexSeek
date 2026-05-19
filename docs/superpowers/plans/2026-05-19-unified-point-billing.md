# 积分计费体系统一改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有模型调用 / MinerU / ASR 都有可由后台配置项管理的积分扣费点，并把用户端消耗记录改造得友好可读。

**Architecture:** 在现有三阶段消耗引擎（`pointConsumption.service.ts` 的直接扣 / 预扣 / 结算 / 回滚）之上新增一层"配置感知"的统一计费服务 `pointBilling.service.ts`；所有场景通过它扣费。配置项 `pointConsumptionItems` 增加"计费模式"与"友好场景名"，消耗记录 `pointConsumptionRecords` 增加"操作关联标识 / 上下文快照 / 用量"，用户端明细按操作聚合展示。

**Tech Stack:** Nuxt 4 (Nitro) + TypeScript + Prisma + PostgreSQL；Vitest（worker 级 DB 隔离）；LangChain middleware。

**对应设计文档:** `docs/superpowers/specs/2026-05-19-unified-point-billing-design.md`

---

## 关键约定（所有任务通用）

- 类型检查用 `bun run typecheck`（不要用 `tsc`）。
- 测试用 `npx vitest run <file>`（禁用 `bun test`）。
- 单测先行：每个模块写完先跑该模块单测；全部任务完成后再跑全量 `bun run test`。
- 提交信息用中文 conventional commit，scope 用 `point`。
- 计费模式枚举值：`1 = TOKEN（按 token）`，`2 = COUNT（按次量）`。
- 消耗项目状态：`1 = 启用`，`0 = 停用`。
- 消耗记录状态：`0 = 无效`，`1 = 预扣`，`2 = 已结算`。

---

## Task 1: Prisma schema 新增字段并生成迁移

**Files:**
- Modify: `prisma/models/point.prisma`

- [ ] **Step 1: 给 `pointConsumptionItems` 加两个字段**

在 `prisma/models/point.prisma` 的 `model pointConsumptionItems` 内，`discount` 字段之后、`pointConsumptionRecords` 关系字段之前，插入：

```prisma
  /// 计费模式：1-按 token，2-按次量
  billingMode             Int                       @default(2) @map("billing_mode")
  /// 用户友好场景名（消耗记录展示用），为空时回退用 name
  displayName             String?                   @map("display_name") @db.VarChar(100)
```

- [ ] **Step 2: 给 `pointConsumptionRecords` 加三个字段**

在 `model pointConsumptionRecords` 内，`remark` 字段之后、`createdAt` 之前，插入：

```prisma
  /// 操作关联标识，聚合展示用，一次用户操作内多条记录共享同一值
  operationId   String?   @map("operation_id") @db.VarChar(64)
  /// 业务上下文快照（如「劳动合同纠纷案」「起诉状.pdf」），展示用
  contextLabel  String?   @map("context_label") @db.VarChar(255)
  /// 计费用量（页/分钟/张），仅按次量模式填充
  usageAmount   Int?      @map("usage_amount")
```

并在该 model 的 `@@index` 区块加一行索引：

```prisma
  @@index([operationId], map: "idx_point_consumption_records_operation_id")
```

- [ ] **Step 3: 生成迁移**

Run: `bun run prisma:migrate --name unified_point_billing_fields`
Expected: 在 `prisma/migrations/<timestamp>_unified_point_billing_fields/` 下生成 `migration.sql`，包含 5 个 `ADD COLUMN` 与 1 个 `CREATE INDEX`；命令结尾打印 "Database schema is up to date"。

- [ ] **Step 4: 验证类型生成**

Run: `bun run typecheck`
Expected: 通过，无报错（`generated/prisma/client` 已含新字段）。

- [ ] **Step 5: 同步测试模板库**

测试用的源库 `ls_new_testing` 需要同样的 schema。`prisma migrate dev` 已对当前 `DATABASE_URL` 库生效；确认 `ls_new_testing` 也已迁移：

Run: `bun run prisma:migrate` 后若 `DATABASE_URL` 指向开发库，再执行一次针对测试库的迁移应用，或直接 `bun run db:setup`。
Expected: `ls_new_testing` 含新列。

- [ ] **Step 6: 提交**

```bash
git add prisma/models/point.prisma prisma/migrations/ generated/prisma/
git commit -m "feat(point): 消耗项目与消耗记录新增计费模式/友好名/聚合字段"
```

---

## Task 2: 新增 BillingMode 类型定义

**Files:**
- Modify: `shared/types/point.types.ts`

- [ ] **Step 1: 新增 `BillingMode` 枚举与名称映射**

在 `shared/types/point.types.ts` 的 `PointConsumptionItemStatus` 枚举之后插入：

```typescript
/**
 * 积分计费模式
 */
export enum BillingMode {
    /** 按 token 计费 */
    TOKEN = 1,
    /** 按次量计费 */
    COUNT = 2,
}

/**
 * 积分计费模式名称
 */
export const BillingModeName = {
    [BillingMode.TOKEN]: "按 token",
    [BillingMode.COUNT]: "按次量",
}
```

- [ ] **Step 2: 更新 `PointConsumptionItem` 展示接口**

在 `shared/types/point.types.ts` 的 `PointConsumptionItem` 接口内，`status` 字段之后插入两行：

```typescript
    /** 计费模式：1-按 token，2-按次量 */
    billingMode: number
    /** 用户友好场景名，可空 */
    displayName: string | null
```

- [ ] **Step 3: 验证类型**

Run: `bun run typecheck`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add shared/types/point.types.ts
git commit -m "feat(point): 新增 BillingMode 枚举与消耗项目展示字段"
```

---

## Task 3: 更新 seedData.sql（回填配置 + 新增项 + 停用废弃项）

**Files:**
- Modify: `prisma/seeds/seedData.sql`

`point_consumption_items` 的 15 条 `INSERT` 位于第 1402–1416 行附近。

- [ ] **Step 1: 给 15 条已有 INSERT 的列清单追加两列**

对第 1402–1416 行每一条 `INSERT INTO "public"."point_consumption_items" (...)`，把列清单结尾的 `, "discount")` 改为 `, "discount", "billing_mode", "display_name")`，并在 `VALUES (...)` 结尾的 discount 值之后、右括号之前追加 `, <billing_mode>, <display_name>`，按下表取值（其余字段、时间戳保持不变）：

| id | key | billing_mode | display_name | status 改为 |
|----|-----|--------------|--------------|-------------|
| 1 | doc_parse | 2 | 'PDF 文档解析' | 1（不变） |
| 2 | asr_transcribe | 2 | '录音转文字' | 1（不变） |
| 3 | ocr_recognize | 2 | '图片文字识别' | **0** |
| 4 | title | 2 | NULL | **0** |
| 5 | summary | 2 | NULL | **0** |
| 6 | chronicle | 2 | NULL | **0** |
| 7 | claim | 2 | NULL | **0** |
| 8 | cause | 2 | NULL | **0** |
| 9 | trend | 2 | NULL | **0** |
| 10 | defense | 2 | NULL | **0** |
| 11 | evidence | 2 | NULL | **0** |
| 12 | case_analysis_token | 1 | '案件智能分析' | 1（不变） |
| 13 | document_draft_token | 1 | 'AI 文书起草' | 1（不变） |
| 14 | contract_review_token | 1 | '合同智能审查' | 1（不变） |
| 15 | assistant_token | 1 | 'AI 法律问答' | 1（不变） |

对 id 3–11 这 9 条，同时把 `VALUES` 里的 status 值（第 8 个值，原为 `1`）改为 `0`。

示例（id 1，改前 → 改后）：

```sql
-- 改前
INSERT INTO "public"."point_consumption_items" ("id", "key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount") VALUES (1, 'doc_parse', 'material', 'PDF 文档解析', 'PDF 文档解析', '页', 1, 1, '2026-03-16 20:28:50.424004+08', '2026-03-16 20:28:50.424004+08', NULL, '1.00');
-- 改后
INSERT INTO "public"."point_consumption_items" ("id", "key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount", "billing_mode", "display_name") VALUES (1, 'doc_parse', 'material', 'PDF 文档解析', 'PDF 文档解析', '页', 1, 1, '2026-03-16 20:28:50.424004+08', '2026-03-16 20:28:50.424004+08', NULL, '1.00', 2, 'PDF 文档解析');
```

- [ ] **Step 2: 追加两条新配置项**

在第 1416 行（id 15）之后插入两行：

```sql
INSERT INTO "public"."point_consumption_items" ("id", "key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount", "billing_mode", "display_name") VALUES (16, 'summary_generate', 'ai', '文件智能摘要', '文件上传后自动生成内容摘要', '次', 1, 0, '2026-05-19 00:00:00+08', '2026-05-19 00:00:00+08', NULL, '0.10', 1, '文件智能摘要');
INSERT INTO "public"."point_consumption_items" ("id", "key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount", "billing_mode", "display_name") VALUES (17, 'memory_extract', 'ai', '案件记忆整理', '对话结束后自动提取并整理案件关键事实', '次', 1, 0, '2026-05-19 00:00:00+08', '2026-05-19 00:00:00+08', NULL, '0.10', 1, '案件记忆整理');
```

- [ ] **Step 3: 同步开发库**

按 `.claude/rules/database.md`「数据级变更」要求，把上述变更同步到本地开发库（用 `prisma studio` 或直接连库执行等价 `UPDATE`/`INSERT`）。同时对测试源库 `ls_new_testing` 重新导入 seed，使后续测试拿到新配置。

- [ ] **Step 4: 提交**

```bash
git add prisma/seeds/seedData.sql
git commit -m "chore(point): 回填消耗项目计费模式与友好名，新增摘要/记忆项，停用废弃项"
```

---

## Task 4: 扩展底层 DAO 与消耗服务以透传新字段

**Files:**
- Modify: `server/services/point/pointConsumption.dao.ts`
- Modify: `server/services/point/pointConsumption.service.ts`
- Test: `tests/server/point/pointConsumption.dao.gap.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试 —— DAO 能落库新字段**

在 `tests/server/point/pointConsumption.dao.gap.test.ts` 末尾的 `describe` 内追加：

```typescript
it('createConsumptionRecordDao 应落库 operationId/contextLabel/usageAmount', async () => {
    const user = await prisma.users.create({
        data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
    })
    const item = await prisma.pointConsumptionItems.findFirstOrThrow({ where: { key: 'doc_parse' } })
    const pr = await prisma.pointRecords.create({
        data: {
            userId: user.id, pointAmount: 100, used: 0, remaining: 100,
            sourceType: 2, status: 1,
            effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
        },
    })
    const rec = await createConsumptionRecordDao({
        userId: user.id, pointRecordId: pr.id, itemId: item.id,
        pointAmount: 5, status: 2,
        operationId: 'op-test-1', contextLabel: '起诉状.pdf', usageAmount: 8,
    })
    expect(rec.operationId).toBe('op-test-1')
    expect(rec.contextLabel).toBe('起诉状.pdf')
    expect(rec.usageAmount).toBe(8)

    await prisma.pointConsumptionRecords.deleteMany({ where: { id: rec.id } })
    await prisma.pointRecords.deleteMany({ where: { id: pr.id } })
    await prisma.users.deleteMany({ where: { id: user.id } })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/point/pointConsumption.dao.gap.test.ts -t "落库 operationId"`
Expected: FAIL，`createConsumptionRecordDao` 不接受新参数（类型错误或字段为 null）。

- [ ] **Step 3: 扩展 `createConsumptionRecordDao`**

在 `server/services/point/pointConsumption.dao.ts` 的 `createConsumptionRecordDao`，把 `data` 入参类型与 `create` 的 `data` 同步加三个字段：

```typescript
export const createConsumptionRecordDao = async (
    data: {
        userId: number
        pointRecordId: number
        itemId: number
        batchId?: string | null
        pointAmount: number
        status: number
        sourceId?: number | null
        remark?: string | null
        operationId?: string | null
        contextLabel?: string | null
        usageAmount?: number | null
    },
    tx?: TxClient
): Promise<pointConsumptionRecords> => {
    try {
        const record = await (tx || prisma).pointConsumptionRecords.create({
            data: {
                users: { connect: { id: data.userId } },
                pointRecords: { connect: { id: data.pointRecordId } },
                pointConsumptionItems: { connect: { id: data.itemId } },
                batchId: data.batchId,
                pointAmount: data.pointAmount,
                status: data.status,
                sourceId: data.sourceId,
                remark: data.remark,
                operationId: data.operationId ?? null,
                contextLabel: data.contextLabel ?? null,
                usageAmount: data.usageAmount ?? null,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        })
        return record
    } catch (error) {
        logger.error('创建积分消耗记录失败：', error)
        throw error
    }
}
```

- [ ] **Step 4: 扩展 `ConsumeOptions` / `PreDeductOptions` 并透传**

在 `server/services/point/pointConsumption.service.ts`：

(a) `ConsumeOptions` 与 `PreDeductOptions` 各加三个可选字段：

```typescript
export interface ConsumeOptions {
    sourceId?: number
    remark?: string
    tx?: TxClient
    operationId?: string
    contextLabel?: string
    usageAmount?: number
}

export interface PreDeductOptions {
    sourceId?: number
    remark?: string
    tx?: TxClient
    contextLabel?: string
    usageAmount?: number
}
```

(b) `consumePointsService` / `preDeductPointsService` 把新字段透传给内部执行函数。`executeConsume` 改签名增加参数 `extra: { operationId?: string; contextLabel?: string; usageAmount?: number }`，并在创建消耗记录的循环中：**`operationId`/`contextLabel` 写入每一条记录，`usageAmount` 只写入第一条**（避免拆分到多条积分记录时用量被重复求和）：

```typescript
let isFirstRecord = true
for (const record of validRecords) {
    if (remainingToConsume <= 0) break
    const consumeFromRecord = Math.min(record.remaining, remainingToConsume)
    await updatePointRecordUsageDao(record.id, record.used + consumeFromRecord, record.remaining - consumeFromRecord, tx)
    const consumptionRecord = await createConsumptionRecordDao({
        userId, pointRecordId: record.id, itemId: item.id,
        pointAmount: consumeFromRecord,
        status: PointConsumptionRecordStatus.SETTLED,
        sourceId, remark: remark || `消耗积分：${item.name}`,
        operationId: extra.operationId ?? null,
        contextLabel: extra.contextLabel ?? null,
        usageAmount: isFirstRecord ? (extra.usageAmount ?? null) : null,
    }, tx)
    consumptionRecords.push(consumptionRecord)
    remainingToConsume -= consumeFromRecord
    isFirstRecord = false
}
```

(c) `executePreDeduct` 同理：创建预扣记录时 `operationId` 取**该批次 `batchId`**（预扣场景下操作关联标识即批次 ID），`contextLabel` 写每条，`usageAmount` 只写第一条：

```typescript
let isFirstRecord = true
for (const record of validRecords) {
    if (remainingToDeduct <= 0) break
    const deductFromRecord = Math.min(record.remaining, remainingToDeduct)
    await updatePointRecordUsageDao(record.id, record.used + deductFromRecord, record.remaining - deductFromRecord, tx)
    await createConsumptionRecordDao({
        userId, pointRecordId: record.id, itemId: item.id, batchId,
        pointAmount: deductFromRecord,
        status: PointConsumptionRecordStatus.PRE_DEDUCT,
        sourceId, remark: remark || `预扣积分：${item.name}`,
        operationId: batchId,
        contextLabel: extra.contextLabel ?? null,
        usageAmount: isFirstRecord ? (extra.usageAmount ?? null) : null,
    }, tx)
    remainingToDeduct -= deductFromRecord
    isFirstRecord = false
}
```

调用 `executeConsume` / `executePreDeduct` 的地方把 `{ operationId, contextLabel, usageAmount }` 一并传入。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/server/point/pointConsumption.dao.gap.test.ts -t "落库 operationId"`
Expected: PASS。

- [ ] **Step 6: 跑消耗服务回归测试**

Run: `npx vitest run tests/server/point/pointConsumption.service.test.ts tests/server/point/pointConsumption.dao.test.ts`
Expected: 全部 PASS（新增字段为可选，不破坏原有行为）。

- [ ] **Step 7: 提交**

```bash
git add server/services/point/pointConsumption.dao.ts server/services/point/pointConsumption.service.ts tests/server/point/pointConsumption.dao.gap.test.ts
git commit -m "feat(point): 消耗 DAO 与服务透传 operationId/contextLabel/usageAmount"
```

---

## Task 5: 新建统一计费服务 —— billCheck 与 billDirect

**Files:**
- Create: `server/services/point/pointBilling.service.ts`
- Test: `tests/server/point/pointBilling.service.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/point/pointBilling.service.test.ts`，沿用同目录 `pointConsumption.service.test.ts` 的连接与 globalThis 初始化方式：

```typescript
/**
 * 统一计费服务测试
 *
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })

const createTestPrisma = () => {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL 环境变量未设置')
    return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}
const testPrisma = createTestPrisma()
const mockLogger = {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
}
;(globalThis as any).logger = mockLogger
;(globalThis as any).prisma = testPrisma

import {
    billCheckService,
    billDirectService,
} from '../../../server/services/point/pointBilling.service'

// 测试夹具：建用户 + 一条有效积分记录 + 一个消耗项目
async function setupFixture(opts: { billingMode: number; status: number; pointAmount: number; discount: string }) {
    const user = await testPrisma.users.create({
        data: { phone: `199${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`, password: 'x', name: 't' },
    })
    const pr = await testPrisma.pointRecords.create({
        data: {
            userId: user.id, pointAmount: 1000, used: 0, remaining: 1000,
            sourceType: 2, status: 1,
            effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
        },
    })
    const key = `bill_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const item = await testPrisma.pointConsumptionItems.create({
        data: {
            key, group: 'test', name: '计费测试项', unit: '次',
            pointAmount: opts.pointAmount, status: opts.status,
            discount: opts.discount, billingMode: opts.billingMode,
        },
    })
    return { user, pr, item, key }
}

describe('统一计费服务', () => {
    const createdUserIds: number[] = []

    afterEach(async () => {
        await testPrisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: createdUserIds } } })
        await testPrisma.pointRecords.deleteMany({ where: { userId: { in: createdUserIds } } })
        await testPrisma.pointConsumptionItems.deleteMany({ where: { key: { startsWith: 'bill_test_' } } })
        await testPrisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
        createdUserIds.length = 0
    })

    afterAll(async () => { await testPrisma.$disconnect() })

    it('停用的消耗项目应跳过扣减', async () => {
        const { user, key } = await setupFixture({ billingMode: 2, status: 0, pointAmount: 5, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { units: 3 })
        expect(r.skipped).toBe(true)
        expect(r.consumedAmount).toBe(0)
        const count = await testPrisma.pointConsumptionRecords.count({ where: { userId: user.id } })
        expect(count).toBe(0)
    })

    it('按次量模式应按 units 扣减并记录用量', async () => {
        const { user, key } = await setupFixture({ billingMode: 2, status: 1, pointAmount: 5, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { units: 3 }, { contextLabel: '身份证.jpg' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBe(15) // 5 * 3 * 1.0
        const rec = await testPrisma.pointConsumptionRecords.findFirstOrThrow({ where: { userId: user.id } })
        expect(rec.usageAmount).toBe(3)
        expect(rec.contextLabel).toBe('身份证.jpg')
        expect(rec.operationId).toBe(r.operationId)
    })

    it('按 token 模式应按 ceil(tokens/1000) 扣减且不记用量', async () => {
        const { user, key } = await setupFixture({ billingMode: 1, status: 1, pointAmount: 2, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { tokens: 2400 })
        expect(r.consumedAmount).toBe(6) // 2 * ceil(2400/1000)=2*3
        const rec = await testPrisma.pointConsumptionRecords.findFirstOrThrow({ where: { userId: user.id } })
        expect(rec.usageAmount).toBeNull()
    })

    it('billCheck 对停用项返回 skipped 且 sufficient=true', async () => {
        const { user, key } = await setupFixture({ billingMode: 2, status: 0, pointAmount: 5, discount: '1.00' })
        createdUserIds.push(user.id)
        const c = await billCheckService(user.id, key, { units: 1 })
        expect(c.skipped).toBe(true)
        expect(c.sufficient).toBe(true)
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/point/pointBilling.service.test.ts`
Expected: FAIL，`pointBilling.service.ts` 不存在。

- [ ] **Step 3: 创建统一计费服务（billCheck + billDirect）**

新建 `server/services/point/pointBilling.service.ts`：

```typescript
/**
 * 统一计费服务
 *
 * 在三阶段消耗引擎（pointConsumption.service）之上做"配置感知"封装：
 * - 读消耗项目配置，停用则跳过扣减
 * - 按 billingMode 把用量换算成消耗数量
 * - 透传 operationId / contextLabel / usageAmount 落库
 */
import { v4 as uuidv4 } from 'uuid'
import { findConsumptionItemByKeyDao } from './pointConsumption.dao'
import {
    checkPointsService,
    consumePointsService,
    preDeductPointsService,
    settlePointsService,
    rollbackPreDeductService,
} from './pointConsumption.service'
import { BillingMode, PointConsumptionItemStatus } from '#shared/types/point.types'

/** 计费用量：按 token 计费传 tokens，按次量计费传 units */
export interface BillingUsage {
    tokens?: number
    units?: number
}

/** 计费上下文 */
export interface BillingContext {
    /** 业务上下文快照标签（如「劳动合同纠纷案」） */
    contextLabel?: string
    /** 关联业务资源 ID */
    sourceId?: number
    /** 操作关联标识；不传则自动生成 */
    operationId?: string
}

/** 直接扣 / 预扣的通用结果 */
export interface BillResult {
    /** 是否因配置停用而跳过 */
    skipped: boolean
    /** 实际消耗积分 */
    consumedAmount: number
    /** 操作关联标识 */
    operationId: string
}

/** 预扣结果 */
export interface BillReserveResult {
    skipped: boolean
    /** 预扣批次 ID（停用时为空字符串） */
    batchId: string
    /** 预扣积分 */
    preDeductAmount: number
}

/** 积分检查结果 */
export interface BillCheckResult {
    skipped: boolean
    sufficient: boolean
    required: number
    available: number
}

/**
 * 按计费模式把用量换算成消耗数量。
 * 缺对应度量时降级用另一个并告警，保证不崩。
 */
const resolveQuantity = (
    billingMode: number,
    usage: BillingUsage,
): { quantity: number; usageUnits: number | null } => {
    if (billingMode === BillingMode.TOKEN) {
        if (usage.tokens != null) {
            return { quantity: Math.ceil(usage.tokens / 1000), usageUnits: null }
        }
        logger.warn('计费模式为 TOKEN 但缺少 tokens，降级用 units', { usage })
        return { quantity: usage.units ?? 0, usageUnits: usage.units ?? null }
    }
    // COUNT
    if (usage.units != null) {
        return { quantity: usage.units, usageUnits: usage.units }
    }
    logger.warn('计费模式为 COUNT 但缺少 units，降级用 tokens', { usage })
    return {
        quantity: usage.tokens != null ? Math.ceil(usage.tokens / 1000) : 0,
        usageUnits: null,
    }
}

/**
 * 检查积分是否够本次计费。停用项直接放行。
 */
export const billCheckService = async (
    userId: number,
    itemKey: string,
    usage: BillingUsage,
): Promise<BillCheckResult> => {
    const item = await findConsumptionItemByKeyDao(itemKey)
    if (!item) throw new Error(`消耗项目不存在: ${itemKey}`)
    if (item.status !== PointConsumptionItemStatus.ENABLED) {
        return { skipped: true, sufficient: true, required: 0, available: 0 }
    }
    const { quantity } = resolveQuantity(item.billingMode, usage)
    const check = await checkPointsService(userId, itemKey, quantity)
    return {
        skipped: false,
        sufficient: check.sufficient,
        required: check.required,
        available: check.available,
    }
}

/**
 * 直接扣减。停用项跳过；积分不足时由底层抛出错误，调用方按场景决定拦截或忽略。
 */
export const billDirectService = async (
    userId: number,
    itemKey: string,
    usage: BillingUsage,
    context?: BillingContext,
): Promise<BillResult> => {
    const item = await findConsumptionItemByKeyDao(itemKey)
    if (!item) throw new Error(`消耗项目不存在: ${itemKey}`)
    const operationId = context?.operationId ?? uuidv4()
    if (item.status !== PointConsumptionItemStatus.ENABLED) {
        logger.debug('消耗项目已停用，跳过扣减', { itemKey })
        return { skipped: true, consumedAmount: 0, operationId }
    }
    const { quantity, usageUnits } = resolveQuantity(item.billingMode, usage)
    if (quantity <= 0) {
        return { skipped: true, consumedAmount: 0, operationId }
    }
    const result = await consumePointsService(userId, itemKey, quantity, {
        sourceId: context?.sourceId,
        operationId,
        contextLabel: context?.contextLabel,
        usageAmount: usageUnits ?? undefined,
    })
    return { skipped: false, consumedAmount: result.consumedAmount, operationId }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/point/pointBilling.service.test.ts`
Expected: 4 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/point/pointBilling.service.ts tests/server/point/pointBilling.service.test.ts
git commit -m "feat(point): 新增统一计费服务 billCheck/billDirect"
```

---

## Task 6: 统一计费服务 —— billReserve / billSettle / billRollback

**Files:**
- Modify: `server/services/point/pointBilling.service.ts`
- Test: `tests/server/point/pointBilling.service.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `tests/server/point/pointBilling.service.test.ts` 的 `describe` 内追加：

```typescript
it('billReserve 预扣后 billSettle 应结算', async () => {
    const { user, key } = await setupFixture({ billingMode: 2, status: 1, pointAmount: 4, discount: '1.00' })
    createdUserIds.push(user.id)
    const reserved = await billReserveService(user.id, key, { units: 2 }, { contextLabel: '录音.mp3' })
    expect(reserved.skipped).toBe(false)
    expect(reserved.preDeductAmount).toBe(8) // 4 * 2
    expect(reserved.batchId).not.toBe('')

    const settled = await billSettleService(reserved.batchId, 3) // 实际 3 分钟
    expect(settled.consumedAmount).toBe(12) // 4 * 3
})

it('billReserve 后 billRollback 应回滚', async () => {
    const { user, key } = await setupFixture({ billingMode: 2, status: 1, pointAmount: 4, discount: '1.00' })
    createdUserIds.push(user.id)
    const reserved = await billReserveService(user.id, key, { units: 2 })
    const rolled = await billRollbackService(reserved.batchId)
    expect(rolled.releasedAmount).toBe(8)
})

it('停用项 billReserve 应跳过', async () => {
    const { user, key } = await setupFixture({ billingMode: 2, status: 0, pointAmount: 4, discount: '1.00' })
    createdUserIds.push(user.id)
    const reserved = await billReserveService(user.id, key, { units: 2 })
    expect(reserved.skipped).toBe(true)
    expect(reserved.batchId).toBe('')
})
```

并在测试文件顶部 import 处补上三个新函数：

```typescript
import {
    billCheckService,
    billDirectService,
    billReserveService,
    billSettleService,
    billRollbackService,
} from '../../../server/services/point/pointBilling.service'
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/point/pointBilling.service.test.ts -t "billReserve"`
Expected: FAIL，三个函数不存在。

- [ ] **Step 3: 实现三个函数**

在 `server/services/point/pointBilling.service.ts` 末尾追加：

```typescript
/**
 * 预扣。停用项跳过；返回批次 ID 供后续结算或回滚。
 */
export const billReserveService = async (
    userId: number,
    itemKey: string,
    usage: BillingUsage,
    context?: BillingContext,
): Promise<BillReserveResult> => {
    const item = await findConsumptionItemByKeyDao(itemKey)
    if (!item) throw new Error(`消耗项目不存在: ${itemKey}`)
    if (item.status !== PointConsumptionItemStatus.ENABLED) {
        logger.debug('消耗项目已停用，跳过预扣', { itemKey })
        return { skipped: true, batchId: '', preDeductAmount: 0 }
    }
    const { quantity, usageUnits } = resolveQuantity(item.billingMode, usage)
    if (quantity <= 0) {
        return { skipped: true, batchId: '', preDeductAmount: 0 }
    }
    const result = await preDeductPointsService(userId, itemKey, quantity, {
        sourceId: context?.sourceId,
        contextLabel: context?.contextLabel,
        usageAmount: usageUnits ?? undefined,
    })
    return { skipped: false, batchId: result.batchId, preDeductAmount: result.preDeductAmount }
}

/**
 * 结算预扣批次。actualUnits 为实际用量（按次量场景的真实页数/分钟数），
 * 不传则按预扣量结算。
 */
export const billSettleService = async (
    batchId: string,
    actualUnits?: number,
): Promise<{ consumedAmount: number }> => {
    if (!batchId) return { consumedAmount: 0 }
    const result = await settlePointsService(batchId, actualUnits)
    return { consumedAmount: result.consumedAmount }
}

/**
 * 回滚预扣批次。
 */
export const billRollbackService = async (
    batchId: string,
): Promise<{ releasedAmount: number }> => {
    if (!batchId) return { releasedAmount: 0 }
    const result = await rollbackPreDeductService(batchId)
    return { releasedAmount: result.releasedAmount }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/point/pointBilling.service.test.ts`
Expected: 全部 PASS（含 Task 5 的 4 个 + 新增 3 个）。

- [ ] **Step 5: 提交**

```bash
git add server/services/point/pointBilling.service.ts tests/server/point/pointBilling.service.test.ts
git commit -m "feat(point): 统一计费服务补齐 billReserve/billSettle/billRollback"
```

---

## Task 7: token 计费中间件改走统一计费服务

**Files:**
- Modify: `server/services/agent-platform/middleware/pointConsumption.middleware.ts`
- Test: `tests/server/workflow/middleware/pointConsumption.middleware.test.ts`（追加用例）

**改造点：** `beforeAgent` 的积分预检改用 `billCheckService`（停用项不再抛错、不 interrupt）；`afterModel` 改用 `billDirectService`；中间件 state 增加 `_billingOperationId`，一次 agent 运行复用同一值；中间件签名增加可选 `contextLabel`。

- [ ] **Step 1: 写失败测试 —— 停用项不触发 interrupt**

先确认测试文件现有结构，在 `tests/server/workflow/middleware/pointConsumption.middleware.test.ts` 追加一个用例：当 itemKey 对应配置项 `status=0` 时，`beforeAgent` 不应 interrupt（即不抛出 / 不返回 interrupt 信号），`afterModel` 不产生消耗记录。

```typescript
it('配置项停用时不扣减且不中断', async () => {
    // 建一个 status=0 的消耗项目
    const key = `mw_disabled_${Date.now()}`
    await prisma.pointConsumptionItems.create({
        data: { key, group: 'test', name: '停用项', unit: '千tokens', pointAmount: 1, status: 0, billingMode: 1 },
    })
    const user = await prisma.users.create({
        data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
    })
    const mw = pointConsumptionMiddleware(user.id, key)
    // beforeAgent 不应因"非会员/积分不足"中断
    const before = await mw.beforeAgent!.hook({ _resumingFromAfterModel: false } as any, {} as any)
    // afterModel 不应创建消耗记录
    await mw.afterModel!.hook({
        messages: [{ content: 'hi', usage_metadata: { total_tokens: 2000 } }],
    } as any, {} as any)
    const count = await prisma.pointConsumptionRecords.count({ where: { userId: user.id } })
    expect(count).toBe(0)

    await prisma.users.deleteMany({ where: { id: user.id } })
    await prisma.pointConsumptionItems.deleteMany({ where: { key } })
})
```

> 注：若现有测试文件用 mock 方式构造中间件输入，按其既有夹具风格对齐；本用例核心断言是"停用项不产生消耗记录、不中断"。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/workflow/middleware/pointConsumption.middleware.test.ts -t "停用"`
Expected: FAIL —— 当前 `checkPointsService` 对停用项抛错（`消耗项目已禁用`）。

- [ ] **Step 3: 改造中间件**

修改 `server/services/agent-platform/middleware/pointConsumption.middleware.ts`：

(a) 顶部 import 改为引入统一计费服务：

```typescript
import { billCheckService, billDirectService } from '~~/server/services/point/pointBilling.service'
import { getCurrentMembershipService } from '~~/server/services/membership/userMembership.service'
import { updateSessionState } from '~~/server/services/workflow/state/storage'
import { v4 as uuidv4 } from 'uuid'
```

（移除对 `checkPointsService` / `consumePointsService` 的 import。）

(b) 函数签名加可选 `contextLabel`：

```typescript
export const pointConsumptionMiddleware = (
    userId: number,
    itemKey: string,
    sessionId?: string,
    contextLabel?: string,
) => {
```

(c) `stateSchema` 增加一个字段：

```typescript
        stateSchema: z.object({
            _totalTokensConsumed: z.number().default(0),
            _totalPointsConsumed: z.number().default(0),
            _pendingDeductQuantity: z.number().default(0),
            _resumingFromAfterModel: z.boolean().default(false),
            _billingOperationId: z.string().default(''),
        }),
```

(d) `beforeAgent` 的第 3 步「检查积分最小单元」改用 `billCheckService`，停用项放行：

```typescript
                // 3. 检查积分（停用项放行）
                const check = await billCheckService(userId, itemKey, { tokens: 1000 })
                if (!check.skipped && !check.sufficient) {
                    interrupt({
                        type: InterruptType.INSUFFICIENT_POINTS,
                        message: '积分不足，请充值后继续',
                        data: {
                            isMember: true,
                            availablePoints: check.available,
                            requiredPoints: check.required,
                            totalPointsConsumed: state._totalPointsConsumed ?? 0,
                            totalTokensConsumed: state._totalTokensConsumed ?? 0,
                            reason: 'insufficient_points' as const,
                        },
                    })
                }

                // 生成本次 agent 运行的操作关联标识
                const operationId = state._billingOperationId || uuidv4()
                logger.info('积分预检通过', { userId, operationId })
                return { _billingOperationId: operationId }
```

> 会员校验（第 1、2 步）保持不变。

(e) `afterModel` 把两处 `consumePointsService(userId, itemKey, pendingQuantity)` 与 `consumePointsService(userId, itemKey, quantity)` 改为 `billDirectService`。补扣那处：

```typescript
                if (pendingQuantity > 0) {
                    try {
                        await billDirectService(userId, itemKey, { tokens: pendingQuantity * 1000 }, {
                            operationId: state._billingOperationId || undefined,
                        })
                        logger.info('补扣成功', { userId, quantity: pendingQuantity })
                    } catch {
                        const check = await billCheckService(userId, itemKey, { tokens: 1000 })
                        const membership = await getCurrentMembershipService(userId)
                        interrupt({
                            type: InterruptType.INSUFFICIENT_POINTS,
                            message: '积分不足，请充值后继续',
                            data: {
                                isMember: !!membership,
                                availablePoints: check.available,
                                requiredPoints: pendingQuantity,
                                totalPointsConsumed: state._totalPointsConsumed ?? 0,
                                totalTokensConsumed: state._totalTokensConsumed ?? 0,
                                reason: membership ? 'insufficient_points' as const : 'no_membership' as const,
                            },
                        })
                    }
                }
```

正常扣减那处（原第 3 步）：

```typescript
                try {
                    const result = await billDirectService(userId, itemKey, { tokens: totalTokens }, {
                        operationId: state._billingOperationId || undefined,
                        contextLabel,
                    })
                    const newState = {
                        _totalTokensConsumed: (state._totalTokensConsumed ?? 0) + totalTokens,
                        _totalPointsConsumed: (state._totalPointsConsumed ?? 0) + result.consumedAmount,
                        _pendingDeductQuantity: 0,
                        _resumingFromAfterModel: false,
                    }
                    if (sessionId) await updateSessionState(sessionId, newState)
                    return newState
                } catch (error) {
                    // 错误分支保持原逻辑（区分积分不足 / 其他错误），略
                }
```

> `catch` 分支内原有的 `checkPointsService` 调用一并改为 `billCheckService`；其余 interrupt / 待补扣逻辑不变。停用项不会进入此 `catch`（`billDirectService` 对停用项返回 `skipped` 而非抛错）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/workflow/middleware/pointConsumption.middleware.test.ts`
Expected: 全部 PASS（含新增「停用」用例与原有用例）。

- [ ] **Step 5: 类型检查**

Run: `bun run typecheck`
Expected: 通过。中间件调用方（`runtime.ts` / `subAgentToolFactory.ts` / 4 个 workflow agents）因新增参数为可选，无需改动即可编译。

- [ ] **Step 6: 提交**

```bash
git add server/services/agent-platform/middleware/pointConsumption.middleware.ts tests/server/workflow/middleware/pointConsumption.middleware.test.ts
git commit -m "feat(point): token 计费中间件改走统一计费服务，支持停用与操作聚合"
```

---

## Task 8: 图片 OCR 接入扣费

**Files:**
- Modify: `server/services/material/ocr.service.ts`
- Test: `tests/server/material/ocr.billing.test.ts`

OCR 有两个识别成功落库点：`createImageConversionInner`（普通流程）与 `createImageRecognitionByBase64Service`（base64 流程）。两处在识别成功、`createImageRecognitionRecordDao` 之后各加一次扣费。

- [ ] **Step 1: 写失败测试**

新建 `tests/server/material/ocr.billing.test.ts`，用真实 DB 验证：当 `ocr_recognize` 配置项启用时，OCR 成功后产生一条消耗记录。OCR 内部调用大模型，测试需 mock 模型层——若难以 mock，则改为**直接对 `billDirectService` + `ocr_recognize` 配置项**写集成测试（验证 `ocr_recognize` 启用/停用两态下的扣减结果），并在用例注释说明 OCR 服务接入点已手工核对。

```typescript
/**
 * OCR 扣费接入测试
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })
const testPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
;(globalThis as any).logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
;(globalThis as any).prisma = testPrisma

import { billDirectService } from '../../../server/services/point/pointBilling.service'

describe('OCR 扣费接入', () => {
    const userIds: number[] = []
    afterEach(async () => {
        await testPrisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await testPrisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await testPrisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
    })
    afterAll(async () => { await testPrisma.$disconnect() })

    it('ocr_recognize 启用时按张扣减', async () => {
        const user = await testPrisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        await testPrisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        // 临时把 ocr_recognize 置启用
        await testPrisma.pointConsumptionItems.updateMany({ where: { key: 'ocr_recognize' }, data: { status: 1 } })
        const r = await billDirectService(user.id, 'ocr_recognize', { units: 1 }, { contextLabel: 'test.jpg' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBeGreaterThan(0)
        await testPrisma.pointConsumptionItems.updateMany({ where: { key: 'ocr_recognize' }, data: { status: 0 } })
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/material/ocr.billing.test.ts`
Expected: FAIL（`ocr_recognize` 用量计算或扣减未按预期，或导入失败）。

- [ ] **Step 3: 在 OCR 服务接入扣费**

在 `server/services/material/ocr.service.ts` 顶部加 import：

```typescript
import { billDirectService } from '~~/server/services/point/pointBilling.service'
```

在 `createImageConversionInner` 内，第 7 步 `createImageRecognitionRecordDao` 创建记录成功之后、第 8 步触发摘要之前，加：

```typescript
        // 7.5 识别成功，扣减积分（停用态自动跳过；失败不阻断已完成的识别）
        try {
            await billDirectService(userId, 'ocr_recognize', { units: 1 }, {
                sourceId: ossFileId,
                contextLabel: ossFile.fileName ?? `图片_${ossFileId}`,
            })
        } catch (billError) {
            logger.error('OCR 积分扣减失败（识别结果已保存）', { ossFileId, error: billError })
        }
```

在 `createImageRecognitionByBase64Service` 内，第 6 步 `createImageRecognitionRecordDao` 之后、第 7 步触发向量化之前，加同样一段（`contextLabel` 用 `ossFile.fileName`）：

```typescript
        // 6.5 识别成功，扣减积分
        try {
            await billDirectService(userId, 'ocr_recognize', { units: 1 }, {
                sourceId: ossFileId,
                contextLabel: ossFile.fileName ?? `图片_${ossFileId}`,
            })
        } catch (billError) {
            logger.error('OCR 积分扣减失败（识别结果已保存）', { ossFileId, error: billError })
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/material/ocr.billing.test.ts`
Expected: PASS。

- [ ] **Step 5: 类型检查与提交**

Run: `bun run typecheck`
Expected: 通过。

```bash
git add server/services/material/ocr.service.ts tests/server/material/ocr.billing.test.ts
git commit -m "feat(point): 图片 OCR 接入统一计费扣费点"
```

---

## Task 9: MinerU PDF 解析改走统一计费服务

**Files:**
- Modify: `server/services/material/mineru.service.ts`

PDF 页数须 MinerU 解析完成后才知，维持「回调里按真实页数直接扣」，仅把 `consumePointsService` 换成 `billDirectService`。

- [ ] **Step 1: 替换扣费调用**

在 `server/services/material/mineru.service.ts`：

(a) 顶部 import 增加（保留现有 import）：

```typescript
import { billDirectService } from '~~/server/services/point/pointBilling.service'
```

(b) `completeConversionService` 内第 5 步「扣减积分」（约 583–591 行）替换为：

```typescript
        // 5. 扣减积分（按真实页数；停用态自动跳过；失败不阻断已完成的解析）
        try {
            await billDirectService(task.userId, DOC_PARSE_ITEM_KEY, { units: pageCount }, {
                sourceId: task.id,
                contextLabel: docRecord?.fileName ?? `文档_${task.ossFileId}`,
            })
            logger.info(`PDF 解析积分扣减成功：userId=${task.userId}, pages=${pageCount}`)
        } catch (pointError) {
            logger.error('PDF 解析积分扣减失败（解析结果已保存）：', pointError)
        }
```

> 若 `docRecord` 上无 `fileName` 字段，则 `contextLabel` 用 `\`文档_${task.ossFileId}\``。`DOC_PARSE_ITEM_KEY` 已在文件内定义为 `'doc_parse'`，保持不变。

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 通过。

- [ ] **Step 3: 回归测试**

Run: `npx vitest run tests/server/material/`
Expected: 现有 material 测试 PASS（行为等价：仍按真实页数扣，`doc_parse` 默认启用）。

- [ ] **Step 4: 提交**

```bash
git add server/services/material/mineru.service.ts
git commit -m "feat(point): PDF 解析改走统一计费服务"
```

---

## Task 10: ASR 语音转写改走统一计费服务

**Files:**
- Modify: `server/services/material/asr.service.ts`

ASR 已是「预扣→结算/回滚」，把三处底层调用换成统一计费服务的等价方法。

- [ ] **Step 1: 替换 import 与三处调用**

在 `server/services/material/asr.service.ts`：

(a) 顶部 import 增加：

```typescript
import { billReserveService, billSettleService, billRollbackService } from '~~/server/services/point/pointBilling.service'
```

（保留现有 `checkPointsService` / `consumePointsService` import，降级兜底分支仍在用。）

(b) 预扣处（约 551 行）：

```typescript
            const preDeductResult = await billReserveService(userId, ASR_TRANSCRIBE_ITEM_KEY, { units: durationMinutes }, {
                contextLabel: ossFile.fileName ?? `录音_${ossFileId}`,
            })
            preDeductBatchId = preDeductResult.skipped ? null : preDeductResult.batchId
```

> `billReserveService` 对停用态返回 `skipped=true`、`batchId=''`；此时 `preDeductBatchId` 置 `null`，后续结算/回滚逻辑遇 `null` 自然跳过。

(c) 结算处（约 853 行）`settlePointsService(preDeductBatchId, actualDurationMinutes)` 改为：

```typescript
                await billSettleService(preDeductBatchId, actualDurationMinutes)
```

(d) 回滚处（约 988 行）`rollbackPreDeductService(preDeductBatchId)` 改为：

```typescript
                await billRollbackService(preDeductBatchId)
```

> 若 `rollbackPreDeductService` 已无其他引用，从 import 移除；`settlePointsService` 同理。`consumePointsService` 仍被「预扣批次不存在的降级兜底」分支引用，保留。

- [ ] **Step 2: 类型检查**

Run: `bun run typecheck`
Expected: 通过。

- [ ] **Step 3: 回归测试**

Run: `npx vitest run tests/server/material/`
Expected: 现有 ASR 相关测试 PASS。

- [ ] **Step 4: 提交**

```bash
git add server/services/material/asr.service.ts
git commit -m "feat(point): 语音转写改走统一计费服务的预扣/结算/回滚"
```

---

## Task 11: 文件智能摘要接入扣费（best-effort）

**Files:**
- Modify: `server/services/material/material.service.ts`
- Test: `tests/server/material/summary.billing.test.ts`

文件摘要的 LLM 调用统一收口在 `callSummaryLlm`（`generateMaterialSummaryInner` 与 `generateOssFileSummaryInner` 都经它，约第 706 行）。跨命名空间防重保证一份文件只真正调用一次摘要 LLM，故在 `callSummaryLlm` 成功返回处扣一次费即可、不会重复。`callSummaryLlm` 的 `identifier` 入参形如 `{ ossFileId?, materialId? }`——OSS 级路径（识别完成后 fire-and-forget 触发）是主路径，Material 级路径几乎总命中防重早返。本任务只对 `ossFileId` 路径计费（`materialId` 路径跳过：该路径极少真正触发 LLM，且可避开 caseMaterials→cases 字段依赖）。

- [ ] **Step 1: 写失败测试**

新建 `tests/server/material/summary.billing.test.ts`，验证 `summary_generate` 配置项可被统一计费服务按 token 正确扣减：

```typescript
/**
 * 文件摘要扣费接入测试
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })
const testPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
;(globalThis as any).logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
;(globalThis as any).prisma = testPrisma

import { billDirectService } from '../../../server/services/point/pointBilling.service'

describe('文件摘要扣费接入', () => {
    const userIds: number[] = []
    afterEach(async () => {
        await testPrisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await testPrisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await testPrisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
        await testPrisma.pointConsumptionItems.updateMany({ where: { key: 'summary_generate' }, data: { status: 0 } })
    })
    afterAll(async () => { await testPrisma.$disconnect() })

    it('summary_generate 启用时按 token 扣减', async () => {
        const user = await testPrisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        await testPrisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        await testPrisma.pointConsumptionItems.updateMany({ where: { key: 'summary_generate' }, data: { status: 1 } })
        const r = await billDirectService(user.id, 'summary_generate', { tokens: 1500 }, { sourceId: 1, contextLabel: '起诉状.pdf' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBeGreaterThan(0)
    })

    it('summary_generate 停用时跳过', async () => {
        const user = await testPrisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const r = await billDirectService(user.id, 'summary_generate', { tokens: 1500 })
        expect(r.skipped).toBe(true)
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/material/summary.billing.test.ts`
Expected: FAIL（若 `summary_generate` 配置项尚未在测试库 seed，第一个用例因 `消耗项目不存在` 失败；确保 Task 3 的 seed 已同步到 `ls_new_testing`）。

- [ ] **Step 3: 在 callSummaryLlm 接入扣费**

在 `server/services/material/material.service.ts` 顶部加 import：

```typescript
import { billDirectService } from '~~/server/services/point/pointBilling.service'
```

在 `callSummaryLlm` 函数之前新增一个永不抛错的 best-effort 扣费 helper：

```typescript
/**
 * best-effort 文件摘要扣费：仅对 ossFile 路径计费，任何异常只记日志、绝不抛出
 * （抛出会被 callSummaryLlm 的重试循环误判为 LLM 失败）。
 */
async function chargeSummaryBilling(
    identifier: { ossFileId?: number; materialId?: number },
    summary: string,
): Promise<void> {
    try {
        if (!identifier.ossFileId) return
        const file = await prisma.ossFiles.findUnique({
            where: { id: identifier.ossFileId },
            select: { userId: true, fileName: true },
        })
        if (!file?.userId) return
        await billDirectService(file.userId, 'summary_generate', { tokens: summary.length * 2 }, {
            sourceId: identifier.ossFileId,
            contextLabel: file.fileName ?? `文件_${identifier.ossFileId}`,
        })
    } catch (billError) {
        logger.warn('文件摘要积分扣减跳过', { ...identifier, error: billError })
    }
}
```

在 `callSummaryLlm` 的重试循环里，把成功分支由「直接 return」改为「先扣费再 return」：

```typescript
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
            const summary = await generateSummaryService(model, content, {
                maxChars: SUMMARY_MAX_CHARS,
                systemPrompt,
            })
            await chargeSummaryBilling(identifier, summary)
            return summary
        } catch (e) {
            lastErr = e
            logger.warn(`摘要 LLM 调用第 ${attempt + 1} 次失败`, { ...identifier, error: e })
            if (attempt < RETRY_DELAYS_MS.length) {
                await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
            }
        }
    }
```

> 用量按摘要字符数估算 token（中文约 2 字符/token，传 `summary.length * 2` 作粗估）。`summary_generate` 默认停用，估算精度此阶段不敏感。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/material/summary.billing.test.ts`
Expected: 2 个用例 PASS。

- [ ] **Step 5: 类型检查与提交**

Run: `bun run typecheck && npx vitest run tests/server/material/`
Expected: 通过。

```bash
git add server/services/material/material.service.ts tests/server/material/summary.billing.test.ts
git commit -m "feat(point): 文件智能摘要接入统一计费扣费点（best-effort）"
```

---

## Task 12: 案件记忆整理接入扣费（best-effort）

**Files:**
- Modify: `server/services/memory/memoryExtraction.service.ts`

案件记忆由 `afterAgentMemoryMiddleware` fire-and-forget 调 `runMemoryExtractionService(params)`，`params` 为 `{ caseId, sessionId, messages }`（无 `userId`）。`runMemoryExtractionService` 内 `invokeNodeJson` 调大模型抽取记忆，`for` 循环写库，最后打印 `memoryExtraction 完成` 日志。扣费点在 `for` 循环之后、该日志之前。`userId` / 案件标题通过 `caseId` 查 `cases` 表获取（`cases.userId`、`cases.title` 均为非空字段）。

- [ ] **Step 1: 加 import**

在 `server/services/memory/memoryExtraction.service.ts` 顶部 import 区追加两行：

```typescript
import { prisma } from '~~/server/utils/db'
import { billDirectService } from '~~/server/services/point/pointBilling.service'
```

- [ ] **Step 2: 在提取成功后接入扣费**

在 `runMemoryExtractionService` 内，写库 `for` 循环结束之后、`logger.info('memoryExtraction 完成', ...)` 这一行**之前**，插入：

```typescript
        // best-effort 扣费：后台静默任务，memory_extract 默认停用，积分不足/异常只记日志
        try {
            const caseRow = await prisma.cases.findUnique({
                where: { id: caseId },
                select: { userId: true, title: true },
            })
            if (caseRow) {
                const extractedChars = result.memories.reduce((sum, m) => sum + m.text.length, 0)
                await billDirectService(caseRow.userId, 'memory_extract', { tokens: extractedChars * 2 }, {
                    sourceId: caseId,
                    contextLabel: caseRow.title,
                })
            }
        } catch (billError) {
            logger.warn('案件记忆积分扣减跳过', { caseId, error: billError })
        }
```

> 用量按提取结果文本字符数估算 token（`extractedChars * 2`）。该段落整体被 `runMemoryExtractionService` 既有的外层 `try/catch` 包裹，且自身再套一层 `try/catch`，双重保证不影响记忆主流程。`memory_extract` 默认停用。

- [ ] **Step 3: 写验证测试**

新建 `tests/server/memory/memory.billing.test.ts`，验证 `memory_extract` 配置项可被统一计费服务按 token 处理（结构同 Task 11 的 `summary.billing.test.ts`，把 key 换成 `memory_extract`、`describe` 名换成「案件记忆扣费接入」、`afterEach` 复位 `memory_extract` 状态为 0）：

```typescript
/**
 * 案件记忆扣费接入测试
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })
const testPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
;(globalThis as any).logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
;(globalThis as any).prisma = testPrisma

import { billDirectService } from '../../../server/services/point/pointBilling.service'

describe('案件记忆扣费接入', () => {
    const userIds: number[] = []
    afterEach(async () => {
        await testPrisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await testPrisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await testPrisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
        await testPrisma.pointConsumptionItems.updateMany({ where: { key: 'memory_extract' }, data: { status: 0 } })
    })
    afterAll(async () => { await testPrisma.$disconnect() })

    it('memory_extract 启用时按 token 扣减', async () => {
        const user = await testPrisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        await testPrisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        await testPrisma.pointConsumptionItems.updateMany({ where: { key: 'memory_extract' }, data: { status: 1 } })
        const r = await billDirectService(user.id, 'memory_extract', { tokens: 1200 }, { sourceId: 1, contextLabel: '劳动合同纠纷案' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBeGreaterThan(0)
    })

    it('memory_extract 停用时跳过', async () => {
        const user = await testPrisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const r = await billDirectService(user.id, 'memory_extract', { tokens: 1200 })
        expect(r.skipped).toBe(true)
    })
})
```

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/server/memory/memory.billing.test.ts`
Expected: 2 个用例 PASS。

- [ ] **Step 5: 类型检查与提交**

Run: `bun run typecheck`
Expected: 通过。

```bash
git add server/services/memory/memoryExtraction.service.ts tests/server/memory/memory.billing.test.ts
git commit -m "feat(point): 案件记忆整理接入统一计费扣费点（best-effort）"
```

---

## Task 13: 用户端消耗记录聚合查询

**Files:**
- Modify: `server/services/point/pointConsumptionRecords.dao.ts`
- Modify: `server/services/point/pointConsumptionRecords.service.ts`
- Modify: `server/api/v1/points/usage.get.ts`
- Test: `tests/server/point/pointConsumptionRecords.aggregate.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/point/pointConsumptionRecords.aggregate.test.ts`：

```typescript
/**
 * 消耗记录聚合查询测试
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(__dirname, '../../../.env.testing') })
const testPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
;(globalThis as any).logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
;(globalThis as any).prisma = testPrisma

import { findAggregatedConsumptionRecordsByUserIdDao } from '../../../server/services/point/pointConsumptionRecords.dao'

describe('消耗记录聚合查询', () => {
    const userIds: number[] = []
    afterEach(async () => {
        await testPrisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await testPrisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await testPrisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
    })
    afterAll(async () => { await testPrisma.$disconnect() })

    it('同一 operationId 的多条记录应聚合成一行并合计积分', async () => {
        const user = await testPrisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const pr = await testPrisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        const item = await testPrisma.pointConsumptionItems.findFirstOrThrow({ where: { key: 'assistant_token' } })
        // 同一操作的 3 条碎记录
        for (const amt of [3, 2, 4]) {
            await testPrisma.pointConsumptionRecords.create({
                data: {
                    userId: user.id, pointRecordId: pr.id, itemId: item.id, pointAmount: amt, status: 2,
                    operationId: 'op-agg-1', contextLabel: '关于工伤认定的咨询',
                },
            })
        }
        const result = await findAggregatedConsumptionRecordsByUserIdDao(user.id, { page: 1, pageSize: 10 })
        expect(result.total).toBe(1)
        expect(result.list).toHaveLength(1)
        expect(result.list[0]!.totalPoints).toBe(9)
        expect(result.list[0]!.contextLabel).toBe('关于工伤认定的咨询')
        expect(result.list[0]!.recordCount).toBe(3)
    })

    it('operationId 为空的旧记录各自独立成行', async () => {
        const user = await testPrisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const pr = await testPrisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        const item = await testPrisma.pointConsumptionItems.findFirstOrThrow({ where: { key: 'assistant_token' } })
        for (const amt of [3, 2]) {
            await testPrisma.pointConsumptionRecords.create({
                data: { userId: user.id, pointRecordId: pr.id, itemId: item.id, pointAmount: amt, status: 2 },
            })
        }
        const result = await findAggregatedConsumptionRecordsByUserIdDao(user.id, { page: 1, pageSize: 10 })
        expect(result.total).toBe(2)
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/point/pointConsumptionRecords.aggregate.test.ts`
Expected: FAIL，`findAggregatedConsumptionRecordsByUserIdDao` 不存在。

- [ ] **Step 3: 新增聚合查询 DAO**

在 `server/services/point/pointConsumptionRecords.dao.ts` 末尾追加：

```typescript
/** 聚合后的消耗记录行（一次操作一行） */
export interface AggregatedConsumptionRow {
    /** 聚合分组键（operationId，或旧记录的 single-<id>） */
    groupKey: string
    itemId: number
    /** 用户友好场景名（displayName 优先，回退 name） */
    sceneName: string
    /** 业务上下文快照 */
    contextLabel: string | null
    /** 计量单位 */
    unit: string
    /** 计费模式 */
    billingMode: number
    /** 合计消耗积分 */
    totalPoints: number
    /** 合计用量（按次量模式才有意义） */
    totalUsage: number
    /** 聚合状态：0-异常，1-处理中，2-已完成 */
    status: number
    /** 最早记录时间 */
    earliestAt: Date
    /** 该操作下的碎记录数 */
    recordCount: number
}

/**
 * 查询用户消耗记录（按 operationId 聚合，分页）。
 * operationId 为空的旧记录各自独立成行（分组键 single-<id>）。
 */
export const findAggregatedConsumptionRecordsByUserIdDao = async (
    userId: number,
    options: { page?: number; pageSize?: number },
    tx?: PrismaClient
): Promise<{ list: AggregatedConsumptionRow[]; total: number }> => {
    try {
        const { page = 1, pageSize = 10 } = options
        const offset = (page - 1) * pageSize
        const db = tx || prisma

        const rows = await db.$queryRaw<Array<{
            group_key: string
            item_id: number
            scene_name: string
            context_label: string | null
            unit: string
            billing_mode: number
            total_points: number
            total_usage: number
            has_invalid: boolean
            has_prededuct: boolean
            earliest_at: Date
            record_count: number
        }>>`
            SELECT
                COALESCE(r.operation_id, 'single-' || r.id::text) AS group_key,
                r.item_id,
                COALESCE(i.display_name, i.name) AS scene_name,
                MAX(r.context_label) AS context_label,
                i.unit,
                i.billing_mode,
                SUM(r.point_amount)::int AS total_points,
                SUM(COALESCE(r.usage_amount, 0))::int AS total_usage,
                BOOL_OR(r.status = 0) AS has_invalid,
                BOOL_OR(r.status = 1) AS has_prededuct,
                MIN(r.created_at) AS earliest_at,
                COUNT(*)::int AS record_count
            FROM point_consumption_records r
            JOIN point_consumption_items i ON i.id = r.item_id
            WHERE r.user_id = ${userId} AND r.deleted_at IS NULL
            GROUP BY COALESCE(r.operation_id, 'single-' || r.id::text), r.item_id, i.display_name, i.name, i.unit, i.billing_mode
            ORDER BY earliest_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
        `

        const totalRows = await db.$queryRaw<Array<{ count: bigint }>>`
            SELECT COUNT(*)::bigint AS count FROM (
                SELECT 1
                FROM point_consumption_records r
                WHERE r.user_id = ${userId} AND r.deleted_at IS NULL
                GROUP BY COALESCE(r.operation_id, 'single-' || r.id::text), r.item_id
            ) t
        `

        const list: AggregatedConsumptionRow[] = rows.map(row => ({
            groupKey: row.group_key,
            itemId: row.item_id,
            sceneName: row.scene_name,
            contextLabel: row.context_label,
            unit: row.unit,
            billingMode: row.billing_mode,
            totalPoints: row.total_points,
            totalUsage: row.total_usage,
            // 处理中优先于异常优先于已完成
            status: row.has_prededuct ? 1 : (row.has_invalid ? 0 : 2),
            earliestAt: row.earliest_at,
            recordCount: row.record_count,
        }))

        return { list, total: Number(totalRows[0]?.count ?? 0n) }
    } catch (error) {
        logger.error('聚合查询用户消耗记录失败：', error)
        throw error
    }
}
```

- [ ] **Step 4: 服务层封装**

在 `server/services/point/pointConsumptionRecords.service.ts` 新增（保留原 `getUserConsumptionRecords` 不动）：

```typescript
import {
    findPointConsumptionRecordsByUserIdDao,
    findAggregatedConsumptionRecordsByUserIdDao,
    type AggregatedConsumptionRow,
} from './pointConsumptionRecords.dao'

/**
 * 获取用户消耗记录（按操作聚合，对外展示用）。
 * - 按 token 计费的行不返回用量，仅返回积分
 * - 按次量计费的行返回合计用量 + 单位
 */
export const getUserAggregatedConsumptionRecords = async (
    userId: number,
    options: { page?: number; pageSize?: number },
): Promise<{
    list: Array<{
        sceneName: string
        contextLabel: string | null
        totalPoints: number
        /** 按次量模式的用量描述，如「8 页」；token 模式为 null */
        usageText: string | null
        status: number
        time: Date
    }>
    total: number
    page: number
    pageSize: number
}> => {
    const { page = 1, pageSize = 10 } = options
    const result = await findAggregatedConsumptionRecordsByUserIdDao(userId, options)
    const list = result.list.map((row: AggregatedConsumptionRow) => ({
        sceneName: row.sceneName,
        contextLabel: row.contextLabel,
        totalPoints: row.totalPoints,
        // 关键：token 计费不向用户暴露用量，避免锚定 token 成本
        usageText: row.billingMode === 1 ? null
            : (row.totalUsage > 0 ? `${row.totalUsage} ${row.unit}` : null),
        status: row.status,
        time: row.earliestAt,
    }))
    return { list, total: result.total, page, pageSize }
}
```

> `billingMode === 1` 即 `BillingMode.TOKEN`；此处用字面量 `1` 以避免在 service 层额外引入枚举依赖，注释已说明。

- [ ] **Step 5: 接口改用聚合查询**

把 `server/api/v1/points/usage.get.ts` 内 `getUserConsumptionRecords` 改为 `getUserAggregatedConsumptionRecords`：

```typescript
import { getUserAggregatedConsumptionRecords } from '~~/server/services/point/pointConsumptionRecords.service'
// ...
        const result = await getUserAggregatedConsumptionRecords(user.id, {
            page: validatedQuery.page,
            pageSize: validatedQuery.pageSize,
        })
        return resSuccess(event, '获取积分消耗记录成功', result)
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/server/point/pointConsumptionRecords.aggregate.test.ts`
Expected: 2 个用例 PASS。

- [ ] **Step 7: 类型检查与提交**

Run: `bun run typecheck`
Expected: 通过。

```bash
git add server/services/point/pointConsumptionRecords.dao.ts server/services/point/pointConsumptionRecords.service.ts server/api/v1/points/usage.get.ts tests/server/point/pointConsumptionRecords.aggregate.test.ts
git commit -m "feat(point): 用户端消耗记录按操作聚合查询"
```

---

## Task 14: 前端积分明细页改造

**Files:**
- Modify: `app/components/points/PointUsageTable.vue`
- Modify: `app/components/points/PointUsageMobile.vue`

接口返回结构已变（`sceneName` / `contextLabel` / `totalPoints` / `usageText` / `status` / `time`）。前端表格与移动端列表同步改造。

- [ ] **Step 1: 改造桌面端表格**

修改 `app/components/points/PointUsageTable.vue`：

(a) `PointUsageRecord` 接口改为：

```typescript
interface PointUsageRecord {
    sceneName: string;
    contextLabel: string | null;
    totalPoints: number;
    usageText: string | null;
    status: number;
    time: string;
}
```

(b) "使用场景"列单元格改为展示场景名 + 上下文：

```vue
                                    <td class="px-4 py-3 text-sm font-medium">
                                        <span>{{ usage.sceneName }}</span>
                                        <span v-if="usage.contextLabel" class="text-muted-foreground">
                                            · {{ usage.contextLabel }}
                                        </span>
                                    </td>
```

(c) "消耗积分"列绑定 `usage.totalPoints`：`-{{ usage.totalPoints }}`。

(d) 状态文案：`0 → 异常`、`1 → 处理中`、`2 → 已完成`（把原 "预扣" 改 "处理中"、"已结算" 改 "已完成"）。

(e) 展开详情行：按次量模式显示计费依据，token 模式只显示积分：

```vue
                        <tr v-if="expandedRows.has(rowKey(usage))" class="bg-primary/5 border-b">
                            <td colspan="5" class="px-4 py-4">
                                <div class="text-sm pl-8 space-y-1">
                                    <p v-if="usage.usageText">
                                        <span class="text-muted-foreground">计费用量：</span>{{ usage.usageText }}
                                    </p>
                                    <p>
                                        <span class="text-muted-foreground">消耗积分：</span>{{ usage.totalPoints }}
                                    </p>
                                </div>
                            </td>
                        </tr>
```

(f) 行展开用 `rowKey`（聚合后无 `id`，用场景+时间组合）替代原 `usage.id`：

```typescript
const rowKey = (u: PointUsageRecord) => `${u.sceneName}_${u.time}`;
const expandedRows = ref<Set<string>>(new Set());
const toggleRow = (key: string) => {
    if (expandedRows.value.has(key)) expandedRows.value.delete(key);
    else expandedRows.value.add(key);
    expandedRows.value = new Set(expandedRows.value);
};
```

模板里 `toggleRow(usage.id)` → `toggleRow(rowKey(usage))`，`expandedRows.has(usage.id)` → `expandedRows.has(rowKey(usage))`，`:key="usage.id"` → `:key="rowKey(usage)"`。删除原 Tooltip 里展示 `remark` 的部分（聚合后无 remark）。

- [ ] **Step 2: 改造移动端列表**

修改 `app/components/points/PointUsageMobile.vue`，比照桌面端同样调整字段（`sceneName` + `contextLabel`、`totalPoints`、`usageText`、状态文案）。具体字段绑定与桌面端一致。

- [ ] **Step 3: 启动开发服务器人工核对**

Run: `bun dev`，浏览器打开 `/dashboard/membership/point`，切到「积分使用记录」。
Expected:
- 使用场景列显示「AI 法律问答 · …」这类友好文案，无 "token / 词元" 字样。
- 一次对话只占一行（聚合生效）。
- 展开行：按次量场景（如 PDF 解析）显示「8 页」；token 场景只显示积分。
- 历史旧记录（无 operationId）正常逐条显示。

> 用 chrome-devtools MCP 调浏览器核对，并截图确认。

- [ ] **Step 4: 类型检查与提交**

Run: `bun run typecheck`
Expected: 通过。

```bash
git add app/components/points/PointUsageTable.vue app/components/points/PointUsageMobile.vue
git commit -m "feat(point): 积分明细页改造为友好场景名与聚合展示"
```

---

## Task 15: 清理废弃的预扣工具

**Files:**
- Delete: `server/services/agent-platform/tools/reservePoints.tool.ts`
- Delete: `server/services/agent-platform/tools/confirmPoints.tool.ts`
- Delete: `server/services/agent-platform/tools/rollbackPoints.tool.ts`
- Delete: `server/services/workflow/tools/reservePoints.tool.ts`
- Delete: `server/services/workflow/tools/confirmPoints.tool.ts`
- Delete: `server/services/workflow/tools/rollbackPoints.tool.ts`
- Modify: `server/services/agent-platform/tools/index.ts`

这三个工具已注册但未挂载到任何节点，统一计费服务接管预扣后彻底无用。

- [ ] **Step 1: 确认无实际挂载引用**

Run: `grep -rn "reserve_points\|confirm_points\|rollback_points" server/ prisma/ --include="*.ts" --include="*.sql" | grep -v "tools/index.ts" | grep -v "reservePoints.tool\|confirmPoints.tool\|rollbackPoints.tool"`
Expected: 无输出（确认无任何节点 `nodes.tools` 或 `PANEL_TOOL_MAP` 引用）。若有输出，停止并人工评估。

- [ ] **Step 2: 删除六个工具文件**

```bash
git rm server/services/agent-platform/tools/reservePoints.tool.ts \
       server/services/agent-platform/tools/confirmPoints.tool.ts \
       server/services/agent-platform/tools/rollbackPoints.tool.ts \
       server/services/workflow/tools/reservePoints.tool.ts \
       server/services/workflow/tools/confirmPoints.tool.ts \
       server/services/workflow/tools/rollbackPoints.tool.ts
```

- [ ] **Step 3: 从 tools/index.ts 注销**

在 `server/services/agent-platform/tools/index.ts` 删除三行 import（`reservePointsTool` / `confirmPointsTool` / `rollbackPointsTool`）以及注册表里的 `reserve_points` / `confirm_points` / `rollback_points` 三个键。

- [ ] **Step 4: 类型检查**

Run: `bun run typecheck`
Expected: 通过，无悬空 import。

- [ ] **Step 5: 提交**

```bash
git add server/services/agent-platform/tools/index.ts
git commit -m "chore(point): 删除未挂载的预扣工具死代码"
```

---

## Task 16: 全量测试与收尾

**Files:** 无（验证任务）

- [ ] **Step 1: 全量类型检查**

Run: `bun run typecheck`
Expected: 通过。

- [ ] **Step 2: 全量测试**

Run: `bun run test`
Expected: 全部 PASS；`server` / `shared` 覆盖率 ≥90%，`agent-platform/**` 子目录阈值满足。若有失败，定位修复后重跑。

- [ ] **Step 3: 残留数据检查**

确认测试用例都在 `afterEach` / `afterAll` 清理了创建的 user / pointRecords / pointConsumptionRecords / pointConsumptionItems。

- [ ] **Step 4: 用 simplify 技能优化新增代码**

对本次新增 / 改动的文件运行 `simplify` 技能，处理可复用、可精简之处。

- [ ] **Step 5: 收尾提交**

```bash
git add -A
git commit -m "chore(point): 积分计费体系统一改造收尾（simplify 优化）"
```

---

## 验收清单（对照设计文档）

- [ ] 9 个扣费点均有代码 hook：assistant/case_analysis/document/contract（中间件）、doc_parse（MinerU 回调）、asr_transcribe（ASR）、ocr_recognize（OCR）、summary_generate（摘要）、memory_extract（记忆）。
- [ ] 配置项 `billingMode` 可切换按 token / 按次量；`status` 停用时计费跳过、操作照常完成。
- [ ] 直接扣（agent / OCR / MinerU / 摘要 / 记忆）与预扣→结算/回滚（ASR）两套机制都可用。
- [ ] 后台静默任务（摘要 / 记忆）积分不足时 best-effort 跳过、不影响主流程。
- [ ] 用户端消耗记录：友好场景名 + 业务上下文、按操作聚合；按 token 计费不展示用量。
- [ ] 8 个废弃配置项停用、3 个死代码工具删除。
