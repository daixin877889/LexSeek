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
- **测试一律用 worker 级 DB 隔离**：直接 `import { prisma } from '~~/server/utils/db'`，**不要**手建 `PrismaClient`、不要 `config({path:'.env.testing'})`、不要覆写 `globalThis.prisma/logger`、`afterAll` 不要 `$disconnect`。`tests/_infra/worker-setup.ts` 已为每个 worker 注入全局 `prisma` / `logger` / 枚举常量并指向独立 worker DB。

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

测试用的源库 `ls_new_testing` 需要同样的 schema。`prisma migrate dev` 已对当前 `DATABASE_URL` 库生效；确认 `ls_new_testing` 也已迁移（必要时 `bun run db:setup`）。
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

在 `shared/types/point.types.ts` 的 `PointConsumptionItem` 接口内，`status` 字段之后插入两行（与同接口 `status: number` 风格一致，用 `number`）：

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

`point_consumption_items` 的 15 条 `INSERT` 位于第 1402–1416 行附近。按 `.claude/rules/database.md`，seedData 只允许 `INSERT`、不允许 `UPDATE`——调整已有数据**直接改对应 INSERT 的列清单与 VALUES**。

- [ ] **Step 1: 给 15 条已有 INSERT 的列清单追加两列**

对每一条 `INSERT INTO "public"."point_consumption_items" (...)`，把列清单结尾的 `, "discount")` 改为 `, "discount", "billing_mode", "display_name")`，并在 `VALUES (...)` 的 discount 值之后、右括号之前追加 `, <billing_mode>, <display_name>`，按下表取值（其余字段、时间戳保持不变）：

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

对 id 3–11 这 9 条，同时把 `VALUES` 里 status 值（第 8 个值，原为 `1`）改为 `0`。

示例（id 1，改前 → 改后）：

```sql
-- 改前
INSERT INTO "public"."point_consumption_items" ("id", "key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount") VALUES (1, 'doc_parse', 'material', 'PDF 文档解析', 'PDF 文档解析', '页', 1, 1, '2026-03-16 20:28:50.424004+08', '2026-03-16 20:28:50.424004+08', NULL, '1.00');
-- 改后
INSERT INTO "public"."point_consumption_items" ("id", "key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount", "billing_mode", "display_name") VALUES (1, 'doc_parse', 'material', 'PDF 文档解析', 'PDF 文档解析', '页', 1, 1, '2026-03-16 20:28:50.424004+08', '2026-03-16 20:28:50.424004+08', NULL, '1.00', 2, 'PDF 文档解析');
```

- [ ] **Step 2: 追加两条新配置项**

在 id 15 那条之后插入两行：

```sql
INSERT INTO "public"."point_consumption_items" ("id", "key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount", "billing_mode", "display_name") VALUES (16, 'summary_generate', 'ai', '文件智能摘要', '文件上传后自动生成内容摘要', '次', 1, 0, '2026-05-19 00:00:00+08', '2026-05-19 00:00:00+08', NULL, '0.10', 1, '文件智能摘要');
INSERT INTO "public"."point_consumption_items" ("id", "key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount", "billing_mode", "display_name") VALUES (17, 'memory_extract', 'ai', '案件记忆整理', '对话结束后自动提取并整理案件关键事实', '次', 1, 0, '2026-05-19 00:00:00+08', '2026-05-19 00:00:00+08', NULL, '0.10', 1, '案件记忆整理');
```

- [ ] **Step 3: 同步开发库与测试库**

按 `database.md`「数据级变更」要求，把上述变更同步到本地开发库（`prisma studio` 或直接连库执行等价 SQL）。同时对测试源库 `ls_new_testing` 重新导入 seed，使后续测试拿到新配置（含 `summary_generate` / `memory_extract` 两项）。

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

在 `tests/server/point/pointConsumption.dao.gap.test.ts` 末尾的 `describe` 内追加（该文件已有 worker DB 测试夹具，直接复用其 `prisma`）：

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

> 若 `createConsumptionRecordDao` 未在该测试文件 import，补 `import { createConsumptionRecordDao } from '~~/server/services/point/pointConsumption.dao'`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/point/pointConsumption.dao.gap.test.ts -t "落库 operationId"`
Expected: FAIL，`createConsumptionRecordDao` 不接受新参数。

- [ ] **Step 3: 扩展 `createConsumptionRecordDao`**

在 `server/services/point/pointConsumption.dao.ts` 的 `createConsumptionRecordDao`，`data` 入参类型与 `create` 的 `data` 同步加三个字段：

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

(b) `executeConsume` 改签名增加参数 `extra: { operationId?: string; contextLabel?: string; usageAmount?: number }`，由 `consumePointsService` 从 `options` 取值传入。在创建消耗记录的循环中：**`operationId`/`contextLabel` 写每一条记录，`usageAmount` 只写第一条**（避免拆分到多条积分记录时用量被重复求和）：

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

(c) `executePreDeduct` 同理增加 `extra` 参数，由 `preDeductPointsService` 从 `options` 传入。创建预扣记录时 `operationId` 取**该批次 `batchId`**（预扣场景操作关联标识即批次 ID），`contextLabel` 写每条，`usageAmount` 只写第一条：

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

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/server/point/pointConsumption.dao.gap.test.ts -t "落库 operationId"`
Expected: PASS。

- [ ] **Step 6: 跑消耗服务回归测试**

Run: `npx vitest run tests/server/point/pointConsumption.service.test.ts tests/server/point/pointConsumption.dao.test.ts`
Expected: 全部 PASS（新增字段均可选，不破坏原有行为）。

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

新建 `tests/server/point/pointBilling.service.test.ts`（worker DB 模式，见「关键约定」）：

```typescript
/**
 * 统一计费服务测试
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    billCheckService,
    billDirectService,
    billReserveService,
    billSettleService,
    billRollbackService,
} from '~~/server/services/point/pointBilling.service'

// 测试夹具：建用户 + 一条有效积分记录 + 一个消耗项目
async function setupFixture(opts: { billingMode: number; status: number; pointAmount: number; discount: string }) {
    const user = await prisma.users.create({
        data: { phone: `199${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`, password: 'x', name: 't' },
    })
    await prisma.pointRecords.create({
        data: {
            userId: user.id, pointAmount: 1000, used: 0, remaining: 1000,
            sourceType: 2, status: 1,
            effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
        },
    })
    const key = `bill_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    await prisma.pointConsumptionItems.create({
        data: {
            key, group: 'test', name: '计费测试项', unit: '次',
            pointAmount: opts.pointAmount, status: opts.status,
            discount: opts.discount, billingMode: opts.billingMode,
        },
    })
    return { user, key }
}

describe('统一计费服务', () => {
    const createdUserIds: number[] = []

    afterEach(async () => {
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: createdUserIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: createdUserIds } } })
        await prisma.pointConsumptionItems.deleteMany({ where: { key: { startsWith: 'bill_test_' } } })
        await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } })
        createdUserIds.length = 0
    })

    it('停用的消耗项目应跳过扣减', async () => {
        const { user, key } = await setupFixture({ billingMode: 2, status: 0, pointAmount: 5, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { units: 3 })
        expect(r.skipped).toBe(true)
        expect(r.consumedAmount).toBe(0)
        const count = await prisma.pointConsumptionRecords.count({ where: { userId: user.id } })
        expect(count).toBe(0)
    })

    it('按次量模式应按 units 扣减并记录用量', async () => {
        const { user, key } = await setupFixture({ billingMode: 2, status: 1, pointAmount: 5, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { units: 3 }, { contextLabel: '身份证.jpg' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBe(15) // 5 * 3 * 1.0
        const rec = await prisma.pointConsumptionRecords.findFirstOrThrow({ where: { userId: user.id } })
        expect(rec.usageAmount).toBe(3)
        expect(rec.contextLabel).toBe('身份证.jpg')
        expect(rec.operationId).toBe(r.operationId)
    })

    it('按 token 模式应按 ceil(tokens/1000) 扣减且不记用量', async () => {
        const { user, key } = await setupFixture({ billingMode: 1, status: 1, pointAmount: 2, discount: '1.00' })
        createdUserIds.push(user.id)
        const r = await billDirectService(user.id, key, { tokens: 2400 })
        expect(r.consumedAmount).toBe(6) // 2 * ceil(2400/1000)=2*3
        const rec = await prisma.pointConsumptionRecords.findFirstOrThrow({ where: { userId: user.id } })
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

> 此测试文件 import 了 Task 6 才实现的 `billReserve/billSettle/billRollback`——Task 5 跑测试时这三个用例尚未添加，import 不影响 Task 5 的 4 个用例执行（函数在 Task 6 补齐）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/point/pointBilling.service.test.ts`
Expected: FAIL，`pointBilling.service.ts` 不存在（import 报错）。

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

/** 直接扣结果 */
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

Run: `npx vitest run tests/server/point/pointBilling.service.test.ts -t "停用|按次量|按 token|billCheck"`
Expected: 4 个用例 PASS（billReserve 三个用例此时仍 FAIL，Task 6 补齐）。

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
Expected: 全部 7 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/point/pointBilling.service.ts tests/server/point/pointBilling.service.test.ts
git commit -m "feat(point): 统一计费服务补齐 billReserve/billSettle/billRollback"
```

---

## Task 7: token 计费中间件改走统一计费服务

**Files:**
- Modify: `server/services/agent-platform/middleware/pointConsumption.middleware.ts`
- Test: `tests/server/agent-platform/pointConsumption.middleware.billing.test.ts`（新建）

**改造点：** `beforeAgent` 积分预检改用 `billCheckService`（停用项不抛错、不 interrupt）；`afterModel` 改用 `billDirectService`；中间件 state 增加 `_billingOperationId`，一次 agent 运行复用同一值；中间件签名增加可选 `operationId` 与 `contextLabel`。

- [ ] **Step 1: 写失败测试（独立新文件）**

新建 `tests/server/agent-platform/pointConsumption.middleware.billing.test.ts`。该文件 mock `interrupt` 与会员服务（绕过会员校验），用真实 worker DB + 真实计费服务，验证「停用项不中断、不扣减」：

```typescript
/**
 * token 计费中间件 —— 统一计费接入测试
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

// interrupt 在图运行上下文外调用会抛错，mock 成可观测的空操作。
// 注意：vi.mock 工厂会被提升到文件顶部，引用的变量必须用 vi.hoisted 一并提升，
// 否则普通 const 触发 TDZ「Cannot access before initialization」。
const { interruptMock } = vi.hoisted(() => ({ interruptMock: vi.fn() }))
vi.mock('@langchain/langgraph', async (orig) => ({
    ...(await orig<any>()),
    interrupt: (...args: any[]) => interruptMock(...args),
}))
// 绕过会员校验：返回一个 truthy 会员
vi.mock('~~/server/services/membership/userMembership.service', () => ({
    getCurrentMembershipService: vi.fn(async () => ({ id: 1 })),
}))

import { prisma } from '~~/server/utils/db'
import { pointConsumptionMiddleware } from '~~/server/services/agent-platform/middleware/pointConsumption.middleware'

describe('token 计费中间件统一计费接入', () => {
    const userIds: number[] = []
    const keys: string[] = []

    afterEach(async () => {
        interruptMock.mockClear()
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointConsumptionItems.deleteMany({ where: { key: { in: keys } } })
        await prisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
        keys.length = 0
    })

    it('配置项停用时不中断、不产生消耗记录', async () => {
        const key = `mw_disabled_${Date.now()}`
        keys.push(key)
        await prisma.pointConsumptionItems.create({
            data: { key, group: 'test', name: '停用项', unit: '千tokens', pointAmount: 1, status: 0, billingMode: 1 },
        })
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)

        const mw: any = pointConsumptionMiddleware(user.id, key)
        await mw.beforeAgent.hook({ _resumingFromAfterModel: false }, {})
        await mw.afterModel.hook(
            { messages: [{ content: 'hi', usage_metadata: { total_tokens: 2000 } }], _billingOperationId: '' },
            {},
        )

        expect(interruptMock).not.toHaveBeenCalled()
        const count = await prisma.pointConsumptionRecords.count({ where: { userId: user.id } })
        expect(count).toBe(0)
    })

    it('配置项启用且积分充足时按 token 扣减并写 operationId', async () => {
        const key = `mw_enabled_${Date.now()}`
        keys.push(key)
        await prisma.pointConsumptionItems.create({
            data: { key, group: 'test', name: '启用项', unit: '千tokens', pointAmount: 1, status: 1, billingMode: 1, discount: '1.00' },
        })
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}1`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        await prisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 1000, used: 0, remaining: 1000, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })

        const mw: any = pointConsumptionMiddleware(user.id, key)
        const before = await mw.beforeAgent.hook({ _resumingFromAfterModel: false }, {})
        await mw.afterModel.hook(
            { messages: [{ content: 'x', usage_metadata: { total_tokens: 2000 } }], _billingOperationId: before._billingOperationId },
            {},
        )

        const recs = await prisma.pointConsumptionRecords.findMany({ where: { userId: user.id } })
        expect(recs.length).toBeGreaterThan(0)
        expect(recs[0]!.operationId).toBe(before._billingOperationId)
        expect(interruptMock).not.toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/server/agent-platform/pointConsumption.middleware.billing.test.ts`
Expected: FAIL —— 当前中间件 `checkPointsService` 对停用项抛错。

- [ ] **Step 3: 改造中间件**

修改 `server/services/agent-platform/middleware/pointConsumption.middleware.ts`：

(a) 顶部 import 调整：

```typescript
import { billCheckService, billDirectService } from '~~/server/services/point/pointBilling.service'
import { getCurrentMembershipService } from '~~/server/services/membership/userMembership.service'
import { updateSessionState } from '~~/server/services/workflow/state/storage'
import { v4 as uuidv4 } from 'uuid'
```

（移除对 `checkPointsService` / `consumePointsService` 的 import；保留 `getTokenCount` 不动。）

(b) 函数签名加两个可选参数：

```typescript
export const pointConsumptionMiddleware = (
    userId: number,
    itemKey: string,
    sessionId?: string,
    operationId?: string,
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

(d) `beforeAgent` 第 3 步「检查积分」改用 `billCheckService`（停用项放行），并初始化 operationId：

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

                // 操作关联标识：优先用外部传入（多 sub-agent 共享聚合），否则自生成
                const opId = state._billingOperationId || operationId || uuidv4()
                logger.info('积分预检通过', { userId, operationId: opId })
                return { _billingOperationId: opId }
```

> 会员校验（第 1、2 步）保持不变。

(e) `afterModel`：两处 `consumePointsService(...)` 改 `billDirectService`，`checkPointsService(...)` 改 `billCheckService`。补扣处：

```typescript
                if (pendingQuantity > 0) {
                    try {
                        await billDirectService(userId, itemKey, { tokens: pendingQuantity * 1000 }, {
                            operationId: state._billingOperationId || undefined,
                            contextLabel,
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

正常扣减处：

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
                    // 错误分支保持原逻辑（区分积分不足 / 其他错误），其中
                    // checkPointsService(...) 一并改为 billCheckService(...)
                }
```

> 停用项不会进入此 `catch`（`billDirectService` 对停用项返回 `skipped` 而非抛错）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/server/agent-platform/pointConsumption.middleware.billing.test.ts tests/server/workflow/middleware/pointConsumption.middleware.test.ts`
Expected: 新文件 2 个用例 PASS；原有 middleware 测试仍 PASS（如原测试 mock 了 service 层且因签名变化失败，按原 mock 风格同步更新 mock 目标）。

- [ ] **Step 5: 类型检查**

Run: `bun run typecheck`
Expected: 通过。中间件现有调用方因新增参数均为可选，无需改动即可编译（contextLabel 接线见 Task 8）。

- [ ] **Step 6: 提交**

```bash
git add server/services/agent-platform/middleware/pointConsumption.middleware.ts tests/server/agent-platform/pointConsumption.middleware.billing.test.ts
git commit -m "feat(point): token 计费中间件改走统一计费服务，支持停用与操作聚合"
```

---

## Task 8: 各 vertical 接入业务上下文与操作聚合标识

**Files:**
- Modify: `server/services/agent-platform/factory/runtime.ts`
- Modify: `server/services/agent-platform/subAgent/subAgentToolFactory.ts`
- Modify: `server/services/workflow/agents/assistantAgent.ts`
- Modify: `server/services/workflow/agents/moduleAgent.ts`
- Modify: `server/services/workflow/agents/documentMainAgent.ts`
- Modify: `server/services/workflow/agents/contractReviewMainAgent.ts`

两件事：(1) 给各 vertical 的计费中间件传 `contextLabel`，让消耗记录带「· 劳动合同纠纷案」业务上下文；(2) 案件分析模块对话里 moduleAgent 与其专家子代理（`ask_*_expert`）须共享同一 `operationId`，否则一次模块发问会拆成多行。每个 vertical 的 `contextLabel` 来源（调研已确认装配作用域内可取得）：

| vertical | 装配文件 | contextLabel 来源 | 兜底 |
|----------|---------|------------------|------|
| AI 法律问答 | `assistantAgent.ts` | `sessionId` → `caseSessions.title` | 无（可空） |
| 案件分析模块 | `moduleAgent.ts` / `subAgentToolFactory.ts` | `caseId` → `cases.title` | `案件_{caseId}` |
| 文书起草 | `documentMainAgent.ts` | 已加载的 `draft.title` | `draft.name` |
| 合同审查 | `contractReviewMainAgent.ts` | `review.originalFileId` → `ossFiles.fileName` | 合同类型 |
| createAgent 通用路径 | `runtime.ts` | 按 `ctx.scope` 分流：有 caseId 取案件名，否则取会话标题 | 同上 |

- [ ] **Step 1: 先确认真实装配点**

Run: `grep -rn "pointConsumptionMiddleware(" server/services/agent-platform/ server/services/workflow/`
Expected: 列出全部真实装配处。**以 grep 结果为准**——若某 vertical 实际走 `runtime.ts` 通用 `createAgent` 路径装配、其 `agents/*.ts` 文件并不直接调中间件，则只改真正的装配处，不对该 vertical 的 agent 文件做无效改动。下面各步按 grep 确认后的真实装配文件执行。

- [ ] **Step 2: 逐个 vertical 解析并传入 contextLabel**

对每个真实装配 `pointConsumptionMiddleware(...)` 处：在调用前于装配作用域内按上表"来源"做一次轻量查询拿标题（`import { prisma } from '~~/server/utils/db'`，可空字段做兜底），作为中间件**第 5 个参数**传入。

示例（assistantAgent.ts）：

```typescript
import { prisma } from '~~/server/utils/db'
// 装配中间件前：
const session = await prisma.caseSessions.findUnique({ where: { id: sessionId }, select: { title: true } })
const contextLabel = session?.title ?? undefined
// 装配：第 4 参 operationId 见 Step 3，问答场景无子代理可留 undefined
pointConsumptionMiddleware(userId, 'assistant_token', sessionId, undefined, contextLabel)
```

`documentMainAgent.ts` 用作用域内已有的 `draft.title ?? draft.name`；`contractReviewMainAgent.ts` 用 `prisma.ossFiles.findUnique` by `review.originalFileId` 取 `fileName`、兜底合同类型；`runtime.ts` 通用路径按 `ctx.scope` 分流取案件名/会话标题。

- [ ] **Step 3: 案件分析模块对话统一 operationId（moduleAgent + 专家子代理）**

一次模块对话发问由 moduleAgent 主体 + 若干 `ask_*_expert` 专家子代理组成，须共享 operationId 才能聚成一行：

1. `moduleAgent.ts`：在装配阶段生成一个 `const billingOperationId = uuidv4()`（`import { v4 as uuidv4 } from 'uuid'`）。
2. 把它作为 moduleAgent 自身计费中间件的**第 4 参数**：`pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId, billingOperationId, contextLabel)`。
3. moduleAgent 经 `subAgentToolFactory` 装配专家子代理工具时，把 `billingOperationId` 放进传给 `subAgentToolFactory` 的 `context` 对象（`context` 类型加一个可选 `billingOperationId?: string` 字段）。
4. `subAgentToolFactory.ts`（约 229 行）装配专家子代理的 `pointConsumptionMiddleware(context.userId, 'case_analysis_token', context.sessionId)` 改为传入第 4、5 参：`pointConsumptionMiddleware(context.userId, 'case_analysis_token', context.sessionId, context.billingOperationId, context.contextLabel)`（`contextLabel` 同步经 context 透传，来源为案件名）。

- [ ] **Step 4: 类型检查**

Run: `bun run typecheck`
Expected: 通过。

- [ ] **Step 5: 回归测试**

Run: `npx vitest run tests/server/agent-platform/ tests/server/workflow/`
Expected: 相关测试 PASS（新增只读查询 + 透传可选参数，不改扣费金额）。

- [ ] **Step 6: 提交**

```bash
git add server/services/agent-platform/factory/runtime.ts server/services/agent-platform/subAgent/subAgentToolFactory.ts server/services/workflow/agents/assistantAgent.ts server/services/workflow/agents/moduleAgent.ts server/services/workflow/agents/documentMainAgent.ts server/services/workflow/agents/contractReviewMainAgent.ts
git commit -m "feat(point): 各 vertical 计费接入业务上下文标签与统一聚合标识"
```

---

## Task 9: 初始案件分析（caseAnalysisV2 主图）改走统一计费服务

**Files:**
- Modify: `server/services/workflow/caseAnalysisV2.workflow.ts`

初始案件分析（一次"开始分析"批量跑 7 个模块）走 `caseAnalysisV2.workflow.ts` 的 stateGraph，**不经 token 计费中间件**——主图自己直接调 `checkPointsService` / `consumePointsService` 扣 `case_analysis_token`。本任务把这两处改走统一计费服务，并让 7 个模块共享同一 operationId 聚合成一行。

- [ ] **Step 1: 研读扣费位置**

读 `server/services/workflow/caseAnalysisV2.workflow.ts`，定位三处（约 200 / 343 / 356 行）：
- `checkPointsService(state.userId, ANALYSIS_POINT_ITEM_KEY, 1)` —— 积分预检（2 处）；
- `consumePointsService(state.userId, ANALYSIS_POINT_ITEM_KEY, tokenQuantity, { sourceId })` —— 每模块完成后扣费。
确认这三处所在的图节点，以及 state 上是否有贯穿整次分析运行的稳定标识（如 `runId` / 分析记录 id）。

- [ ] **Step 2: 准备统一 operationId**

一次"开始分析"的 7 次扣费需共享同一 operationId 才能聚合成一行。caseAnalysisV2 的运行 ID（`agentRuns.id`）由 `agentWorker.executeRun` 经 Langfuse ALS 注入，**不在 stateGraph 的 state 上**，须通过 Langfuse 上下文取：

- 在扣费节点内 `const runId = getLangfuseContext()?.runId`（`getLangfuseContext` 来自 `~~/server/lib/langfuse`，按该模块实际导出名为准）。
- 取到则 `operationId = String(runId)`；取不到则兜底——在工作流入口节点生成一个 `uuidv4()` 写入 state 新增字段 `_billingOperationId`，后续节点复用。
- 实现时先 grep `server/lib/langfuse` 确认获取当前 runId 的确切 API（`getLangfuseContext` / ALS getter），以源码为准。

- [ ] **Step 3: 替换为统一计费服务**

顶部 import 改为：

```typescript
import { billCheckService, billDirectService } from '~~/server/services/point/pointBilling.service'
```

（移除 `checkPointsService` / `consumePointsService` import。）

预检处替换：

```typescript
const check = await billCheckService(state.userId, ANALYSIS_POINT_ITEM_KEY, { tokens: 1000 })
if (!check.skipped && !check.sufficient) {
    // 维持原 interrupt / 积分不足处理逻辑（用 check.available / check.required）
}
```

每模块扣费处替换（`tokenQuantity` 是原本算好的"千 tokens 数量"，换算回 tokens 传入；operationId 用 Step 2 的统一标识；contextLabel 取案件名）：

```typescript
await billDirectService(state.userId, ANALYSIS_POINT_ITEM_KEY, { tokens: tokenQuantity * 1000 }, {
    sourceId: <原 sourceId>,
    operationId: <Step 2 的统一 operationId>,
    contextLabel: <案件名，可由 state 上的 caseId 查 cases.title 得到，兜底 `案件_${caseId}`>,
})
```

- [ ] **Step 4: 类型检查与回归测试**

Run: `bun run typecheck && npx vitest run tests/server/workflow/`
Expected: 通过；caseAnalysisV2 相关测试 PASS（行为等价：仍按 token 扣 `case_analysis_token`，`case_analysis_token` 默认启用）。

> 「7 个模块的消耗记录共享同一 operationId、聚合成一行」这一行为：聚合查询本身由 Task 15 的聚合测试覆盖；本任务只需在代码评审时确认 7 次 `billDirectService` 调用都传了 Step 2 的同一 `operationId`。不为 caseAnalysisV2 跑整图另写重型集成测试。

- [ ] **Step 5: 提交**

```bash
git add server/services/workflow/caseAnalysisV2.workflow.ts
git commit -m "feat(point): 初始案件分析主图扣费改走统一计费服务并统一聚合标识"
```

---

## Task 10: 图片 OCR 接入扣费

**Files:**
- Modify: `server/services/material/ocr.service.ts`
- Test: `tests/server/material/ocr.billing.test.ts`

OCR 两个识别成功落库点：`createImageConversionInner`（普通流程）与 `createImageRecognitionByBase64Service`（base64 流程），各在识别成功、`createImageRecognitionRecordDao` 之后加一次扣费。

- [ ] **Step 1: 写测试**

新建 `tests/server/material/ocr.billing.test.ts`（worker DB 模式）。本测试验证 `ocr_recognize` 计费项可被统一计费服务按次量正确处理（OCR 服务接入的 try/catch 为 3 行直调，正确性由本测试 + Task 5 的 billDirect 用例 + 代码评审共同保证）：

```typescript
/**
 * OCR 扣费接入 —— ocr_recognize 计费项验证
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { billDirectService } from '~~/server/services/point/pointBilling.service'

describe('OCR 扣费接入', () => {
    const userIds: number[] = []
    afterEach(async () => {
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
        await prisma.pointConsumptionItems.updateMany({ where: { key: 'ocr_recognize' }, data: { status: 0 } })
    })

    it('ocr_recognize 启用时按张扣减', async () => {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        await prisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        await prisma.pointConsumptionItems.updateMany({ where: { key: 'ocr_recognize' }, data: { status: 1 } })
        const r = await billDirectService(user.id, 'ocr_recognize', { units: 1 }, { contextLabel: 'test.jpg' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBeGreaterThan(0)
    })

    it('ocr_recognize 停用时跳过', async () => {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}2`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const r = await billDirectService(user.id, 'ocr_recognize', { units: 1 })
        expect(r.skipped).toBe(true)
    })
})
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/server/material/ocr.billing.test.ts`
Expected: 2 个用例 PASS（`ocr_recognize` 已由 Task 3 seed）。

- [ ] **Step 3: 在 OCR 服务接入扣费**

在 `server/services/material/ocr.service.ts` 顶部加 import：

```typescript
import { billDirectService } from '~~/server/services/point/pointBilling.service'
```

`createImageConversionInner` 内，第 7 步 `createImageRecognitionRecordDao` 之后、第 8 步触发摘要之前加：

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

`createImageRecognitionByBase64Service` 内，第 6 步 `createImageRecognitionRecordDao` 之后、第 7 步触发向量化之前加同样一段。

- [ ] **Step 4: 类型检查与提交**

Run: `bun run typecheck`
Expected: 通过。

```bash
git add server/services/material/ocr.service.ts tests/server/material/ocr.billing.test.ts
git commit -m "feat(point): 图片 OCR 接入统一计费扣费点"
```

---

## Task 11: MinerU PDF 解析改走统一计费服务

**Files:**
- Modify: `server/services/material/mineru.service.ts`

PDF 页数须解析完成后才知，维持「回调里按真实页数直接扣」，仅把 `consumePointsService` 换 `billDirectService`。

- [ ] **Step 1: 替换扣费调用**

(a) 顶部加 import：

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

> 若 `docRecord` 无 `fileName` 字段，`contextLabel` 用 `\`文档_${task.ossFileId}\``。`DOC_PARSE_ITEM_KEY` 已在文件内定义为 `'doc_parse'`。

- [ ] **Step 2: 类型检查与回归测试**

Run: `bun run typecheck && npx vitest run tests/server/material/`
Expected: 通过；material 测试 PASS（行为等价）。

- [ ] **Step 3: 提交**

```bash
git add server/services/material/mineru.service.ts
git commit -m "feat(point): PDF 解析改走统一计费服务"
```

---

## Task 12: ASR 语音转写改走统一计费服务

**Files:**
- Modify: `server/services/material/asr.service.ts`

ASR 已是「预扣→结算/回滚」，把三处底层调用换成统一计费服务。

- [ ] **Step 1: 替换 import 与三处调用**

(a) 顶部加 import：

```typescript
import { billReserveService, billSettleService, billRollbackService } from '~~/server/services/point/pointBilling.service'
```

（保留 `checkPointsService` / `consumePointsService` import，降级兜底分支仍用。）

(b) 预扣处（约 551 行）：

```typescript
            const preDeductResult = await billReserveService(userId, ASR_TRANSCRIBE_ITEM_KEY, { units: durationMinutes }, {
                contextLabel: ossFile.fileName ?? `录音_${ossFileId}`,
            })
            preDeductBatchId = preDeductResult.skipped ? null : preDeductResult.batchId
```

> 停用态 `billReserveService` 返回 `skipped=true`、`batchId=''`，`preDeductBatchId` 置 `null`，后续结算/回滚遇 `null` 自然跳过。

(c) 结算处（约 853 行）改为 `await billSettleService(preDeductBatchId, actualDurationMinutes)`。

(d) 回滚处（约 988 行）改为 `await billRollbackService(preDeductBatchId)`。

> 若 `rollbackPreDeductService` / `settlePointsService` 无其他引用则从 import 移除；`consumePointsService` 仍被「预扣批次不存在的降级兜底」分支引用，保留。

- [ ] **Step 2: 类型检查与回归测试**

Run: `bun run typecheck && npx vitest run tests/server/material/`
Expected: 通过；ASR 相关测试 PASS。

- [ ] **Step 3: 提交**

```bash
git add server/services/material/asr.service.ts
git commit -m "feat(point): 语音转写改走统一计费服务的预扣/结算/回滚"
```

---

## Task 13: 文件智能摘要接入扣费（best-effort）

**Files:**
- Modify: `server/services/material/material.service.ts`
- Test: `tests/server/material/summary.billing.test.ts`

文件摘要的 LLM 调用统一收口在 `callSummaryLlm`（约第 706 行，`generateMaterialSummaryInner` 与 `generateOssFileSummaryInner` 都经它）。跨命名空间防重保证一份文件只真正调用一次摘要 LLM，故在 `callSummaryLlm` 成功返回处扣一次费。`callSummaryLlm` 的 `identifier` 为 `{ ossFileId?, materialId? }`，**两条路径都要计费**——用户粘贴的纯文本材料（`CASE_CONTENT`）`ossFileId` 恒为空、只走 `materialId` 路径，是真实计费路径。

- [ ] **Step 1: 写测试**

新建 `tests/server/material/summary.billing.test.ts`（worker DB 模式），验证 `summary_generate` 计费项可按 token 处理：

```typescript
/**
 * 文件摘要扣费接入 —— summary_generate 计费项验证
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { billDirectService } from '~~/server/services/point/pointBilling.service'

describe('文件摘要扣费接入', () => {
    const userIds: number[] = []
    afterEach(async () => {
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
        await prisma.pointConsumptionItems.updateMany({ where: { key: 'summary_generate' }, data: { status: 0 } })
    })

    it('summary_generate 启用时按 token 扣减', async () => {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        await prisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        await prisma.pointConsumptionItems.updateMany({ where: { key: 'summary_generate' }, data: { status: 1 } })
        const r = await billDirectService(user.id, 'summary_generate', { tokens: 1500 }, { sourceId: 1, contextLabel: '起诉状.pdf' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBeGreaterThan(0)
    })

    it('summary_generate 停用时跳过', async () => {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}3`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const r = await billDirectService(user.id, 'summary_generate', { tokens: 1500 })
        expect(r.skipped).toBe(true)
    })
})
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/server/material/summary.billing.test.ts`
Expected: 2 个用例 PASS（`summary_generate` 已由 Task 3 seed）。

- [ ] **Step 3: 在 callSummaryLlm 接入扣费**

`server/services/material/material.service.ts` 顶部加 import：

```typescript
import { billDirectService } from '~~/server/services/point/pointBilling.service'
```

在 `callSummaryLlm` 函数之前新增一个**永不抛错**的 best-effort 扣费 helper（抛出会被 `callSummaryLlm` 重试循环误判为 LLM 失败）。两条路径都解析归属用户：

```typescript
/**
 * best-effort 文件摘要扣费：ossFile 与 material 两条路径都计费；
 * 任何异常只记日志、绝不抛出。
 */
async function chargeSummaryBilling(
    identifier: { ossFileId?: number; materialId?: number },
    summary: string,
): Promise<void> {
    try {
        let userId: number | null = null
        let sourceId: number | undefined
        let contextLabel: string | undefined

        if (identifier.ossFileId) {
            const file = await prisma.ossFiles.findUnique({
                where: { id: identifier.ossFileId },
                select: { userId: true, fileName: true },
            })
            if (file?.userId) {
                userId = file.userId
                sourceId = identifier.ossFileId
                contextLabel = file.fileName ?? `文件_${identifier.ossFileId}`
            }
        } else if (identifier.materialId) {
            // 纯文本材料（CASE_CONTENT）只走此路径：caseMaterials 经 caseId 解析归属用户
            const material = await prisma.caseMaterials.findUnique({
                where: { id: identifier.materialId },
                select: { caseId: true, cases: { select: { userId: true, title: true } } },
            })
            if (material?.cases?.userId) {
                userId = material.cases.userId
                sourceId = identifier.materialId
                contextLabel = material.cases.title ?? `材料_${identifier.materialId}`
            }
        }

        if (userId == null) return  // 解析不到归属用户，best-effort 跳过
        await billDirectService(userId, 'summary_generate', { tokens: summary.length * 2 }, {
            sourceId,
            contextLabel,
        })
    } catch (billError) {
        logger.warn('文件摘要积分扣减跳过', { ...identifier, error: billError })
    }
}
```

> `caseMaterials` 到 `cases` 的关系名按 schema 实际为准（`material.caseId` → 关系字段）。若关系名不是 `cases`，按 `prisma/models/` 中 `caseMaterials` 模型定义调整 `select` 里的关系键。

在 `callSummaryLlm` 重试循环里，成功分支由「直接 return」改为「先扣费再 return」：

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

> 用量按摘要字符数估算 token（`summary.length * 2`）。`summary_generate` 默认停用，估算精度此阶段不敏感。

- [ ] **Step 4: 类型检查与提交**

Run: `bun run typecheck && npx vitest run tests/server/material/summary.billing.test.ts`
Expected: 通过。

```bash
git add server/services/material/material.service.ts tests/server/material/summary.billing.test.ts
git commit -m "feat(point): 文件智能摘要接入统一计费扣费点（best-effort）"
```

---

## Task 14: 案件记忆整理接入扣费（best-effort）

**Files:**
- Modify: `server/services/memory/memoryExtraction.service.ts`
- Test: `tests/server/memory/memory.billing.test.ts`

案件记忆由 `runMemoryExtractionService(params)` 提取，`params` 为 `{ caseId, sessionId, messages }`。扣费点在 `for` 写库循环之后、`logger.info('memoryExtraction 完成', ...)` 之前。`userId` / 案件标题经 `caseId` 查 `cases` 表（`cases.userId`、`cases.title` 均非空）。

- [ ] **Step 1: 加 import**

在 `server/services/memory/memoryExtraction.service.ts` 顶部 import 区追加：

```typescript
import { prisma } from '~~/server/utils/db'
import { billDirectService } from '~~/server/services/point/pointBilling.service'
```

- [ ] **Step 2: 在提取成功后接入扣费**

在 `runMemoryExtractionService` 内，写库 `for` 循环之后、`logger.info('memoryExtraction 完成', ...)` 之前插入：

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

> 该段被既有外层 `try/catch` 与自身 `try/catch` 双重包裹，不影响记忆主流程。

- [ ] **Step 3: 写测试**

新建 `tests/server/memory/memory.billing.test.ts`（worker DB 模式），验证 `memory_extract` 计费项可按 token 处理：

```typescript
/**
 * 案件记忆扣费接入 —— memory_extract 计费项验证
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { billDirectService } from '~~/server/services/point/pointBilling.service'

describe('案件记忆扣费接入', () => {
    const userIds: number[] = []
    afterEach(async () => {
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
        await prisma.pointConsumptionItems.updateMany({ where: { key: 'memory_extract' }, data: { status: 0 } })
    })

    it('memory_extract 启用时按 token 扣减', async () => {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        await prisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        await prisma.pointConsumptionItems.updateMany({ where: { key: 'memory_extract' }, data: { status: 1 } })
        const r = await billDirectService(user.id, 'memory_extract', { tokens: 1200 }, { sourceId: 1, contextLabel: '劳动合同纠纷案' })
        expect(r.skipped).toBe(false)
        expect(r.consumedAmount).toBeGreaterThan(0)
    })

    it('memory_extract 停用时跳过', async () => {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}4`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const r = await billDirectService(user.id, 'memory_extract', { tokens: 1200 })
        expect(r.skipped).toBe(true)
    })
})
```

- [ ] **Step 4: 跑测试与提交**

Run: `npx vitest run tests/server/memory/memory.billing.test.ts && bun run typecheck`
Expected: 通过。

```bash
git add server/services/memory/memoryExtraction.service.ts tests/server/memory/memory.billing.test.ts
git commit -m "feat(point): 案件记忆整理接入统一计费扣费点（best-effort）"
```

---

## Task 15: 用户端消耗记录聚合查询

**Files:**
- Modify: `server/services/point/pointConsumptionRecords.dao.ts`
- Modify: `server/services/point/pointConsumptionRecords.service.ts`
- Modify: `server/api/v1/points/usage.get.ts`
- Test: `tests/server/point/pointConsumptionRecords.aggregate.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/server/point/pointConsumptionRecords.aggregate.test.ts`（worker DB 模式）：

```typescript
/**
 * 消耗记录聚合查询测试
 * **Feature: unified-point-billing**
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { findAggregatedConsumptionRecordsByUserIdDao } from '~~/server/services/point/pointConsumptionRecords.dao'

describe('消耗记录聚合查询', () => {
    const userIds: number[] = []
    afterEach(async () => {
        await prisma.pointConsumptionRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.pointRecords.deleteMany({ where: { userId: { in: userIds } } })
        await prisma.users.deleteMany({ where: { id: { in: userIds } } })
        userIds.length = 0
    })

    it('同一 operationId 的多条记录应聚合成一行并合计积分', async () => {
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const pr = await prisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        const item = await prisma.pointConsumptionItems.findFirstOrThrow({ where: { key: 'assistant_token' } })
        for (const amt of [3, 2, 4]) {
            await prisma.pointConsumptionRecords.create({
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
        const user = await prisma.users.create({
            data: { phone: `199${Date.now().toString().slice(-8)}5`, password: 'x', name: 't' },
        })
        userIds.push(user.id)
        const pr = await prisma.pointRecords.create({
            data: {
                userId: user.id, pointAmount: 100, used: 0, remaining: 100, sourceType: 2, status: 1,
                effectiveAt: new Date(Date.now() - 1000), expiredAt: new Date(Date.now() + 8.64e7),
            },
        })
        const item = await prisma.pointConsumptionItems.findFirstOrThrow({ where: { key: 'assistant_token' } })
        for (const amt of [3, 2]) {
            await prisma.pointConsumptionRecords.create({
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
    /** 聚合分组键（operationId，或旧记录的 single-<id>），前端用作稳定 rowKey */
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

在 `server/services/point/pointConsumptionRecords.service.ts` 新增（保留原 `getUserConsumptionRecords` 不动）。**方法名以 `Service` 结尾**，按 token 计费不返回用量：

```typescript
import {
    findPointConsumptionRecordsByUserIdDao,
    findAggregatedConsumptionRecordsByUserIdDao,
    type AggregatedConsumptionRow,
} from './pointConsumptionRecords.dao'
import { BillingMode } from '#shared/types/point.types'

/**
 * 获取用户消耗记录（按操作聚合，对外展示用）。
 * - 按 token 计费的行不返回用量，仅返回积分
 * - 按次量计费的行返回合计用量 + 单位
 */
export const getUserAggregatedConsumptionRecordsService = async (
    userId: number,
    options: { page?: number; pageSize?: number },
): Promise<{
    list: Array<{
        /** 稳定行键，前端展开/收起用 */
        key: string
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
        key: row.groupKey,
        sceneName: row.sceneName,
        contextLabel: row.contextLabel,
        totalPoints: row.totalPoints,
        // 关键：token 计费不向用户暴露用量，避免锚定 token 成本
        usageText: row.billingMode === BillingMode.TOKEN
            ? null
            : (row.totalUsage > 0 ? `${row.totalUsage} ${row.unit}` : null),
        status: row.status,
        time: row.earliestAt,
    }))
    return { list, total: result.total, page, pageSize }
}
```

- [ ] **Step 5: 接口改用聚合查询**

`server/api/v1/points/usage.get.ts` 内 `getUserConsumptionRecords` 改为 `getUserAggregatedConsumptionRecordsService`：

```typescript
import { getUserAggregatedConsumptionRecordsService } from '~~/server/services/point/pointConsumptionRecords.service'
// ...
        const result = await getUserAggregatedConsumptionRecordsService(user.id, {
            page: validatedQuery.page,
            pageSize: validatedQuery.pageSize,
        })
        return resSuccess(event, '获取积分消耗记录成功', result)
```

- [ ] **Step 6: 跑测试与类型检查**

Run: `npx vitest run tests/server/point/pointConsumptionRecords.aggregate.test.ts && bun run typecheck`
Expected: 2 个用例 PASS，类型通过。

- [ ] **Step 7: 提交**

```bash
git add server/services/point/pointConsumptionRecords.dao.ts server/services/point/pointConsumptionRecords.service.ts server/api/v1/points/usage.get.ts tests/server/point/pointConsumptionRecords.aggregate.test.ts
git commit -m "feat(point): 用户端消耗记录按操作聚合查询"
```

---

## Task 16: 管理端消耗项目支持新字段编辑

**Files:**
- Modify: `server/api/v1/admin/point-consumption-items/index.post.ts`
- Modify: `server/api/v1/admin/point-consumption-items/[id].put.ts`
- Modify: `server/services/point/pointConsumptionItems.service.ts`
- Modify: `server/services/point/pointConsumptionItems.dao.ts`
- Modify: `app/components/admin/point-items/FormDialog.vue`

管理后台已有完整的「消耗项目」CRUD 模块，本任务把 `billingMode` / `displayName` 两个新字段沿现有链路透传，使运营可在后台编辑。

- [ ] **Step 1: 增改接口 zod schema 加两字段**

在新增接口 `index.post.ts` 的 bodySchema 内加（新增项 `billingMode` 给默认值）：

```typescript
    billingMode: z.number().int().min(1).max(2).default(2),
    displayName: z.string().max(100).nullable().optional(),
```

在更新接口 `[id].put.ts` 的 bodySchema 内加（**两字段均 `.optional()` 且不给 `.default()`**——PUT 是部分更新，给默认值会在请求省略该字段时把 `billingMode` 回填成 2、覆盖原值）：

```typescript
    billingMode: z.number().int().min(1).max(2).optional(),
    displayName: z.string().max(100).nullable().optional(),
```

- [ ] **Step 2: service 与 dao 加两字段**

`server/services/point/pointConsumptionItems.service.ts`：`CreatePointConsumptionItemInput` / `UpdatePointConsumptionItemInput` 两个接口各加 `billingMode?: number` 与 `displayName?: string | null`。

`server/services/point/pointConsumptionItems.dao.ts`：`createPointConsumptionItemDao` / `updatePointConsumptionItemDao` 的 prisma `data` 字面量补这两字段（与现有逐字段列写风格一致）。

- [ ] **Step 3: 表单组件加两个字段控件**

`app/components/admin/point-items/FormDialog.vue`：
- 加「计费模式」下拉（shadcn `Select`，选项「按 token」=1 / 「按次量」=2，`SelectTrigger` 必须 `w-full`）。
- 加「友好名」`Input`。
- form 初始值、编辑回填（`openEdit`）、提交 payload 三处同步加这两字段。

- [ ] **Step 4: 类型检查与人工核对**

Run: `bun run typecheck`
Expected: 通过。

`bun dev` 后进管理后台「消耗项目」页，新建/编辑一个项目，确认「计费模式」「友好名」可填可存可回显（用 chrome-devtools MCP 核对）。

- [ ] **Step 5: 提交**

```bash
git add server/api/v1/admin/point-consumption-items/ server/services/point/pointConsumptionItems.service.ts server/services/point/pointConsumptionItems.dao.ts app/components/admin/point-items/FormDialog.vue
git commit -m "feat(point): 管理端消耗项目支持编辑计费模式与友好名"
```

---

## Task 17: 前端积分明细页改造

**Files:**
- Modify: `app/components/points/PointUsageTable.vue`
- Modify: `app/components/points/PointUsageMobile.vue`

接口返回结构已变（每行：`key` / `sceneName` / `contextLabel` / `totalPoints` / `usageText` / `status` / `time`）。

- [ ] **Step 1: 改造桌面端表格**

修改 `app/components/points/PointUsageTable.vue`：

(a) `PointUsageRecord` 接口改为：

```typescript
interface PointUsageRecord {
    key: string;
    sceneName: string;
    contextLabel: string | null;
    totalPoints: number;
    usageText: string | null;
    status: number;
    time: string;
}
```

(b) "使用场景"列单元格：

```vue
                                    <td class="px-4 py-3 text-sm font-medium">
                                        <span>{{ usage.sceneName }}</span>
                                        <span v-if="usage.contextLabel" class="text-muted-foreground">
                                            · {{ usage.contextLabel }}
                                        </span>
                                    </td>
```

(c) "消耗积分"列绑定 `-{{ usage.totalPoints }}`。

(d) 状态文案：`0 → 异常`、`1 → 处理中`、`2 → 已完成`。

(e) 展开详情行：按次量模式显示计费依据，token 模式只显示积分：

```vue
                        <tr v-if="expandedRows.has(usage.key)" class="bg-primary/5 border-b">
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

(f) 行展开改用接口返回的稳定 `usage.key`（聚合后无 `id`）：

```typescript
const expandedRows = ref<Set<string>>(new Set());
const toggleRow = (key: string) => {
    if (expandedRows.value.has(key)) expandedRows.value.delete(key);
    else expandedRows.value.add(key);
    expandedRows.value = new Set(expandedRows.value);
};
```

模板里 `toggleRow(usage.id)` → `toggleRow(usage.key)`，`expandedRows.has(usage.id)` → `expandedRows.has(usage.key)`，`:key="usage.id"` → `:key="usage.key"`。删除原 Tooltip 里展示 `remark` 的部分（聚合后无 remark）。

- [ ] **Step 2: 改造移动端列表**

`app/components/points/PointUsageMobile.vue` 比照桌面端调整字段（`sceneName` + `contextLabel`、`totalPoints`、`usageText`、状态文案、`key`）。

- [ ] **Step 3: 确认数据请求层无需改动**

`PointUsageTable` / `PointUsageMobile` 的数据由父页 `app/pages/dashboard/membership/point.vue` 通过 `usage` 接口取得后以 prop 传入。确认父页把接口返回的 `list` 原样传给组件——接口字段已整体替换，父页若有对旧字段（`itemDescription` / `pointAmount` / `id`）的引用需同步改为新字段；若父页只是透传 `list`，则无需改动。

- [ ] **Step 4: 启动开发服务器人工核对**

`bun dev`，浏览器开 `/dashboard/membership/point`「积分使用记录」。用 chrome-devtools MCP 核对并截图：
- 使用场景列显示「AI 法律问答 · …」友好文案，无 "token / 词元" 字样。
- 一次对话/一次案件分析只占一行。
- 展开行：按次量场景显示「8 页」，token 场景只显示积分。
- 历史旧记录（无 operationId）正常逐条显示。

- [ ] **Step 5: 类型检查与提交**

Run: `bun run typecheck`
Expected: 通过。

```bash
git add app/components/points/PointUsageTable.vue app/components/points/PointUsageMobile.vue
git commit -m "feat(point): 积分明细页改造为友好场景名与聚合展示"
```

---

## Task 18: 清理废弃的预扣工具

**Files:**
- Delete: `server/services/agent-platform/tools/reservePoints.tool.ts`
- Delete: `server/services/agent-platform/tools/confirmPoints.tool.ts`
- Delete: `server/services/agent-platform/tools/rollbackPoints.tool.ts`
- Delete: `server/services/workflow/tools/reservePoints.tool.ts`
- Delete: `server/services/workflow/tools/confirmPoints.tool.ts`
- Delete: `server/services/workflow/tools/rollbackPoints.tool.ts`
- Modify: `server/services/agent-platform/tools/index.ts`

`workflow/tools/` 下三个文件是 `agent-platform/tools/` 同名文件的 `export *` re-export shim，删实体后会悬空，须同删（共 6 个文件）。

- [ ] **Step 1: 确认无实际挂载引用**

Run: `grep -rn "reserve_points\|confirm_points\|rollback_points" server/ prisma/ --include="*.ts" --include="*.sql" | grep -v "tools/index.ts" | grep -v "reservePoints.tool\|confirmPoints.tool\|rollbackPoints.tool"`
Expected: 无输出。若有输出，停止并人工评估。

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

## Task 19: 全量测试与收尾

**Files:** 无（验证任务）

- [ ] **Step 1: 全量类型检查**

Run: `bun run typecheck`
Expected: 通过。

- [ ] **Step 2: 全量测试**

Run: `bun run test`
Expected: 全部 PASS；`server` / `shared` 覆盖率 ≥90%，`agent-platform/**` 子目录阈值满足。若有失败，定位修复后重跑。

- [ ] **Step 3: 残留数据检查**

确认测试用例都在 `afterEach` 清理了创建的 user / pointRecords / pointConsumptionRecords / pointConsumptionItems，无残留。

- [ ] **Step 4: 用 simplify 技能优化新增代码**

对本次新增 / 改动的文件运行 `simplify` 技能，处理可复用、可精简之处。

- [ ] **Step 5: 收尾提交**

```bash
git add -A
git commit -m "chore(point): 积分计费体系统一改造收尾（simplify 优化）"
```

---

## 验收清单（对照设计文档）

- [ ] 9 个扣费点均有代码 hook：assistant/document/contract（中间件）、case_analysis（中间件 + caseAnalysisV2 主图）、doc_parse（MinerU 回调）、asr_transcribe（ASR）、ocr_recognize（OCR）、summary_generate（摘要 callSummaryLlm，覆盖 ossFile + material 两路径）、memory_extract（记忆）。
- [ ] 配置项 `billingMode` 可切换按 token / 按次量，且可在管理后台编辑；`status` 停用时计费跳过、操作照常完成。
- [ ] 直接扣（agent / caseAnalysisV2 / OCR / MinerU / 摘要 / 记忆）与预扣→结算/回滚（ASR）两套机制都可用。
- [ ] 后台静默任务（摘要 / 记忆）积分不足时 best-effort 跳过、不影响主流程。
- [ ] 用户端消耗记录：友好场景名 + 业务上下文、按 operationId 聚合（案件分析 7 模块聚成一行）；按 token 计费不展示用量。
- [ ] 8 个废弃配置项停用、6 个死代码工具文件删除。
- [ ] 全部测试用 worker DB 隔离模式，无手建 PrismaClient。
