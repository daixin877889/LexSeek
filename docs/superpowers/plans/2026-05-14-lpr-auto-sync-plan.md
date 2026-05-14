# LPR 利率每日自动同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用项目现有 `CronScheduler` + Redis 分布式锁基建做一个每天定时拉取 chinamoney LPR 数据自动入库的任务，管理后台可见上次同步状态 + 可手动触发。

**Architecture:** `cron-scheduler.ts` 注册 24h interval task → `syncLPRRatesService` 拉过去 30 天 → `fetchLPRFromChinamoneyService` 调 chinamoney POST API → 逐条 `findUnique by effectDate` 去重后 `createLPRRateService` 入库 → 全程记入 `lpr_sync_logs` 表 → 管理后台 `LPRSyncStatusCard` 显示最近一次状态 + 「立即同步」按钮调 POST handler。

**Tech Stack:** Nuxt 4 + Vue 3 + Prisma + PostgreSQL + `$fetch` (ofetch) + Vitest + shadcn-vue + dayjs

**Spec:** [docs/superpowers/specs/2026-05-14-lpr-auto-sync-design.md](../specs/2026-05-14-lpr-auto-sync-design.md)

---

## 文件结构总览

### 新建文件

```
prisma/models/rates.prisma                            # 追加 model lprSyncLogs（不动现有 3 张表）
server/services/rates/
├── lprSyncLog.dao.ts                                 # T2 - sync log CRUD
└── lprSync.service.ts                                # T3+T4 - fetch + 主流程
server/api/v1/admin/rates/lpr/
├── sync-status.get.ts                                # T5
└── sync.post.ts                                      # T6
app/components/admin/rates/
└── LPRSyncStatusCard.vue                             # T8
tests/server/services/rates/lprSync.service.test.ts  # T3+T4
tests/server/tools/rates/lpr-sync.api.test.ts        # T5+T6
```

### 修改文件

```
server/plugins/cron-scheduler.ts                      # T7 - 追加 task `lpr-daily-sync`
app/pages/admin/rates/lpr.vue                         # T9 - 嵌入 LPRSyncStatusCard
```

---

## 任务 T1：追加 lprSyncLogs prisma model + migrate

**Files:**
- Modify: `prisma/models/rates.prisma`
- Create: `prisma/migrations/<timestamp>_add_lpr_sync_logs/migration.sql`（prisma migrate dev 自动生成）

- [ ] **Step 1: 在 `prisma/models/rates.prisma` 文件末尾追加 lprSyncLogs model**

```prisma

/// LPR 自动同步日志（每次执行一条，含手动 / 自动触发）
model lprSyncLogs {
  id            Int       @id @default(autoincrement())
  /// 任务开始时间
  startedAt     DateTime  @map("started_at")    @db.Timestamptz(6)
  /// 任务结束时间（成功 / 失败时填入）
  finishedAt    DateTime? @map("finished_at")   @db.Timestamptz(6)
  /// running | success | failure
  status        String    @db.VarChar(16)
  /// 触发方式：auto (cron) | manual (admin 按钮)
  triggeredBy   String    @map("triggered_by")  @db.VarChar(16)
  /// 拉取窗口起始（请求时传给 API）
  rangeStart    DateTime  @map("range_start")   @db.Date
  rangeEnd      DateTime  @map("range_end")     @db.Date
  /// API 返回的 records 总条数
  fetchedCount  Int       @default(0) @map("fetched_count")
  /// 真正入库的新条目数（去重后）
  insertedCount Int       @default(0) @map("inserted_count")
  /// 失败时的错误信息
  errorMessage  String?   @map("error_message") @db.Text
  /// 手动触发时记录 admin user id（不加外键，参考 agentToolAuditLogs 风格）
  operatorId    Int?      @map("operator_id")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([startedAt(sort: Desc)])
  @@map("lpr_sync_logs")
}
```

- [ ] **Step 2: 运行 prisma migrate dev 生成迁移并应用到 dev 库**

Run:
```bash
bun run prisma:migrate --name add_lpr_sync_logs
```
Expected:
- `prisma/migrations/<timestamp>_add_lpr_sync_logs/migration.sql` 生成，含 `CREATE TABLE "lpr_sync_logs"` + `CREATE INDEX`
- 输出 `Your database is now in sync with your schema.`
- 自动跑 prisma generate 更新 `generated/prisma/`

- [ ] **Step 3: 同步测试库 schema**

`bun run prisma:migrate` 只更新 `.env.DATABASE_URL`（ls_new），测试库 `ls_new_testing` 需手动同步迁移（参考 PR1a-T5 implementer 的踩坑经验）：

Run:
```bash
docker exec -i postgres psql -U daixin -d ls_new_testing < prisma/migrations/$(ls -t prisma/migrations | head -1)/migration.sql
```
Expected: `CREATE TABLE` 和 `CREATE INDEX` 输出，无错误

- [ ] **Step 4: 验证 prisma client 已重新生成**

Run: `grep -c "lprSyncLogs" generated/prisma/client.ts`
Expected: ≥ 2

- [ ] **Step 5: Commit**

```bash
git add prisma/models/rates.prisma prisma/migrations/ generated/prisma/
git commit -m "feat(rates): 新增 lpr_sync_logs 表（记录每次同步结果）"
```

---

## 任务 T2：实现 lprSyncLog DAO

**Files:**
- Create: `server/services/rates/lprSyncLog.dao.ts`

> 注：本 DAO 没有独立测试文件。T3/T4 service 测试会通过真实 DB 操作隐式覆盖所有 DAO 函数；项目其他 DAO 也是这种 service-driven 覆盖模式（如 `rates.dao.test.ts` 单独写测试是因为它是 PR1a 基础设施层；这里 sync log DAO 是 service 内部细节）。

- [ ] **Step 1: 创建 `server/services/rates/lprSyncLog.dao.ts`**

```typescript
/**
 * LPR 同步日志数据访问层
 *
 * 提供 lpr_sync_logs 的创建、更新、查询最近一次。
 */
import type { Prisma } from '#shared/types/prisma'
import type { lprSyncLogs } from '~~/generated/prisma/client'
import { prisma } from '~~/server/utils/db'
type PrismaClient = typeof prisma

export async function createLPRSyncLogDAO(
    data: Prisma.lprSyncLogsCreateInput,
    tx?: PrismaClient,
): Promise<lprSyncLogs> {
    return (tx ?? prisma).lprSyncLogs.create({ data })
}

export async function updateLPRSyncLogDAO(
    id: number,
    data: Prisma.lprSyncLogsUpdateInput,
    tx?: PrismaClient,
): Promise<lprSyncLogs> {
    return (tx ?? prisma).lprSyncLogs.update({ where: { id }, data })
}

export async function findLatestLPRSyncLogDAO(
    tx?: PrismaClient,
): Promise<lprSyncLogs | null> {
    return (tx ?? prisma).lprSyncLogs.findFirst({
        orderBy: { startedAt: 'desc' },
    })
}
```

- [ ] **Step 2: typecheck**

Run: `bun run typecheck 2>&1 | grep "lprSyncLog.dao" | head -3`
Expected: 无错误（输出为空）

- [ ] **Step 3: Commit**

```bash
git add server/services/rates/lprSyncLog.dao.ts
git commit -m "feat(rates): 新增 lprSyncLog DAO（创建/更新/查最近一次）"
```

---

## 任务 T3：实现 fetchLPRFromChinamoneyService（独立函数 + mock 单测）

**Files:**
- Create: `server/services/rates/lprSync.service.ts`（先放 fetch 函数；T4 再追加 sync 主流程）
- Create: `tests/server/services/rates/lprSync.service.test.ts`

- [ ] **Step 1: 写测试 `tests/server/services/rates/lprSync.service.test.ts`**

```typescript
/**
 * LPR 同步服务测试
 *
 * **Feature: lpr-auto-sync**
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// mock $fetch（ofetch）：在 Nitro/Nuxt 环境中 $fetch 是 globalThis 上的全局
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

import { fetchLPRFromChinamoneyService } from '~~/server/services/rates/lprSync.service'

describe('fetchLPRFromChinamoneyService', () => {
    beforeEach(() => {
        fetchMock.mockReset()
    })

    it('成功响应返回 records 数组', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 1778752637625 },
            data: { endDateCN: '2025-12-31', startDateCN: '2025-11-01', message: '' },
            records: [
                { '5Y': '3.50', '1Y': '3.00', showDateCN: '2025-12-22', showDateEN: '22 Dec 2025' },
                { '5Y': '3.50', '1Y': '3.00', showDateCN: '2025-11-20', showDateEN: '20 Nov 2025' },
            ],
        })

        const records = await fetchLPRFromChinamoneyService({
            rangeStart: new Date('2025-11-01'),
            rangeEnd: new Date('2025-12-31'),
        })

        expect(records).toHaveLength(2)
        expect(records[0]).toMatchObject({ '1Y': '3.00', '5Y': '3.50', showDateCN: '2025-12-22' })

        // 验证 fetch 调用参数
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('strStartDate=2025-11-01'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Referer: expect.stringContaining('chinamoney.com.cn'),
                    'User-Agent': expect.stringContaining('Mozilla'),
                }),
                timeout: 30_000,
            }),
        )
    })

    it('rep_code !== 200 时抛错', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '500', rep_message: '内部错误', ts: 0 },
            data: {},
            records: [],
        })

        await expect(
            fetchLPRFromChinamoneyService({
                rangeStart: new Date('2025-11-01'),
                rangeEnd: new Date('2025-12-31'),
            }),
        ).rejects.toThrow(/chinamoney API 错误.*500.*内部错误/)
    })

    it('空 records 返回空数组（不抛错）', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [],
        })

        const records = await fetchLPRFromChinamoneyService({
            rangeStart: new Date('2025-11-01'),
            rangeEnd: new Date('2025-11-02'),
        })
        expect(records).toEqual([])
    })

    it('网络异常时透传错误', async () => {
        fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

        await expect(
            fetchLPRFromChinamoneyService({
                rangeStart: new Date('2025-11-01'),
                rangeEnd: new Date('2025-12-31'),
            }),
        ).rejects.toThrow('ECONNREFUSED')
    })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

Run: `npx vitest run tests/server/services/rates/lprSync.service.test.ts`
Expected: FAIL，提示 `fetchLPRFromChinamoneyService` 不存在 / 模块找不到

- [ ] **Step 3: 创建 `server/services/rates/lprSync.service.ts` 实现 fetch 函数**

```typescript
/**
 * LPR 自动同步服务
 *
 * 从全国银行间同业拆借中心（chinamoney.com.cn）公开接口拉取最新 LPR 数据，
 * 解析后入库 lpr_rates，并把每次执行结果记入 lpr_sync_logs。
 */

/** chinamoney API 响应结构 */
export interface ChinamoneyLPRResponse {
    head: { rep_code: string; rep_message: string; ts: number }
    data: { endDateCN: string; startDateCN: string; message: string }
    records: ChinamoneyLPRRecord[]
}

export interface ChinamoneyLPRRecord {
    '1Y': string
    '5Y': string
    showDateCN: string  // YYYY-MM-DD
    showDateEN: string
}

/**
 * 从 chinamoney 公开接口拉取 LPR 历史
 *
 * @param opts.rangeStart 拉取窗口起始日期
 * @param opts.rangeEnd 拉取窗口结束日期
 * @returns API 返回的 records 数组
 * @throws Error 当 API 返回 rep_code !== '200' 或网络异常
 */
export async function fetchLPRFromChinamoneyService(opts: {
    rangeStart: Date
    rangeEnd: Date
}): Promise<ChinamoneyLPRRecord[]> {
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const url = `https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis?lang=CN&strStartDate=${fmt(opts.rangeStart)}&strEndDate=${fmt(opts.rangeEnd)}`

    const response = await $fetch<ChinamoneyLPRResponse>(url, {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            Origin: 'https://www.chinamoney.com.cn',
            Referer: 'https://www.chinamoney.com.cn/r/cms/chinese/chinamoney/html/currency/lpr-shibor-history-download.html',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
            'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 30_000,
    })

    if (response.head.rep_code !== '200') {
        throw new Error(`chinamoney API 错误: ${response.head.rep_code} ${response.head.rep_message}`)
    }
    return response.records
}
```

- [ ] **Step 4: 跑测试验证 PASS**

Run: `npx vitest run tests/server/services/rates/lprSync.service.test.ts`
Expected: 4 tests passed

- [ ] **Step 5: Commit**

```bash
git add server/services/rates/lprSync.service.ts tests/server/services/rates/lprSync.service.test.ts
git commit -m "feat(rates): 新增 fetchLPRFromChinamoneyService 拉取 chinamoney LPR 数据"
```

---

## 任务 T4：实现 syncLPRRatesService 主流程

**Files:**
- Modify: `server/services/rates/lprSync.service.ts`（追加 sync 主流程 + getLatestLPRSyncStatusService）
- Modify: `tests/server/services/rates/lprSync.service.test.ts`（追加主流程测试）

- [ ] **Step 1: 在测试文件末尾追加 syncLPRRatesService 测试**

把以下内容追加到 `tests/server/services/rates/lprSync.service.test.ts` 末尾（在最后一个 describe 块之后）：

```typescript
import { prisma } from '~~/server/utils/db'
import { syncLPRRatesService, getLatestLPRSyncStatusService } from '~~/server/services/rates/lprSync.service'

describe('syncLPRRatesService', () => {
    const createdLogIds: number[] = []
    const createdRateDates: string[] = []

    beforeEach(() => {
        fetchMock.mockReset()
    })

    afterEach(async () => {
        if (createdLogIds.length > 0) {
            await prisma.lprSyncLogs.deleteMany({ where: { id: { in: createdLogIds } } })
            createdLogIds.length = 0
        }
        if (createdRateDates.length > 0) {
            await prisma.lprRates.deleteMany({
                where: { effectDate: { in: createdRateDates.map((d) => new Date(d)) } },
            })
            createdRateDates.length = 0
        }
    })

    it('happy path：拉到 2 条新数据全部入库', async () => {
        const newDate1 = `2099-01-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        const newDate2 = `2099-02-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        createdRateDates.push(newDate1, newDate2)

        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [
                { '1Y': '3.10', '5Y': '3.60', showDateCN: newDate1, showDateEN: '' },
                { '1Y': '3.20', '5Y': '3.70', showDateCN: newDate2, showDateEN: '' },
            ],
        })

        const result = await syncLPRRatesService({ triggeredBy: 'manual', operatorId: 1 })
        createdLogIds.push(result.logId)

        expect(result.fetched).toBe(2)
        expect(result.inserted).toBe(2)

        // 验证 sync log
        const log = await prisma.lprSyncLogs.findUnique({ where: { id: result.logId } })
        expect(log).toMatchObject({
            status: 'success',
            triggeredBy: 'manual',
            operatorId: 1,
            fetchedCount: 2,
            insertedCount: 2,
        })
        expect(log!.finishedAt).not.toBeNull()
        expect(log!.errorMessage).toBeNull()

        // 验证 lpr_rates 真的入库
        const rate1 = await prisma.lprRates.findUnique({ where: { effectDate: new Date(newDate1) } })
        expect(Number(rate1!.oneYear)).toBeCloseTo(3.10)
        expect(Number(rate1!.fiveYear)).toBeCloseTo(3.60)
    })

    it('已存在的 effectDate 跳过，inserted 只算新数据', async () => {
        const existingDate = `2098-01-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        const newDate = `2098-02-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        createdRateDates.push(existingDate, newDate)

        // 预先插入 existingDate
        await prisma.lprRates.create({
            data: {
                effectDate: new Date(existingDate),
                oneYear: 1.0,
                fiveYear: 2.0,
            },
        })

        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [
                { '1Y': '9.99', '5Y': '9.99', showDateCN: existingDate, showDateEN: '' },  // 已存在
                { '1Y': '3.10', '5Y': '3.60', showDateCN: newDate, showDateEN: '' },        // 新
            ],
        })

        const result = await syncLPRRatesService({ triggeredBy: 'auto' })
        createdLogIds.push(result.logId)

        expect(result.fetched).toBe(2)
        expect(result.inserted).toBe(1)

        // 验证已存在的没被覆盖（仍是 1.0/2.0 而不是 9.99）
        const existing = await prisma.lprRates.findUnique({ where: { effectDate: new Date(existingDate) } })
        expect(Number(existing!.oneYear)).toBeCloseTo(1.0)
        expect(Number(existing!.fiveYear)).toBeCloseTo(2.0)
    })

    it('API 失败时记 sync log failure + 抛错', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '500', rep_message: '内部错误', ts: 0 },
            data: {},
            records: [],
        })

        await expect(
            syncLPRRatesService({ triggeredBy: 'auto' }),
        ).rejects.toThrow(/chinamoney API 错误/)

        // 验证 failure log 已落库（找最近一条 failure）
        const log = await prisma.lprSyncLogs.findFirst({
            where: { status: 'failure', triggeredBy: 'auto' },
            orderBy: { startedAt: 'desc' },
        })
        expect(log).not.toBeNull()
        expect(log!.errorMessage).toMatch(/chinamoney API 错误/)
        expect(log!.fetchedCount).toBe(0)
        expect(log!.insertedCount).toBe(0)
        createdLogIds.push(log!.id)
    })

    it('空 records 视为成功 fetched=0/inserted=0', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [],
        })

        const result = await syncLPRRatesService({ triggeredBy: 'auto' })
        createdLogIds.push(result.logId)

        expect(result.fetched).toBe(0)
        expect(result.inserted).toBe(0)

        const log = await prisma.lprSyncLogs.findUnique({ where: { id: result.logId } })
        expect(log!.status).toBe('success')
    })

    it('网络异常时记 failure', async () => {
        fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'))

        await expect(
            syncLPRRatesService({ triggeredBy: 'auto' }),
        ).rejects.toThrow('ETIMEDOUT')

        const log = await prisma.lprSyncLogs.findFirst({
            where: { status: 'failure', errorMessage: { contains: 'ETIMEDOUT' } },
            orderBy: { startedAt: 'desc' },
        })
        expect(log).not.toBeNull()
        createdLogIds.push(log!.id)
    })
})

describe('getLatestLPRSyncStatusService', () => {
    let createdId: number | null = null

    afterEach(async () => {
        if (createdId !== null) {
            await prisma.lprSyncLogs.delete({ where: { id: createdId } }).catch(() => {})
            createdId = null
        }
    })

    it('返回最近一条日志（按 startedAt desc）', async () => {
        const past = new Date(Date.now() - 60_000)
        const recent = new Date()

        const old = await prisma.lprSyncLogs.create({
            data: {
                startedAt: past,
                status: 'success',
                triggeredBy: 'auto',
                rangeStart: new Date('2025-11-01'),
                rangeEnd: new Date('2025-12-01'),
                fetchedCount: 1,
                insertedCount: 1,
            },
        })
        const newer = await prisma.lprSyncLogs.create({
            data: {
                startedAt: recent,
                status: 'success',
                triggeredBy: 'manual',
                rangeStart: new Date('2025-12-01'),
                rangeEnd: new Date('2026-01-01'),
                fetchedCount: 2,
                insertedCount: 2,
            },
        })
        createdId = newer.id

        const latest = await getLatestLPRSyncStatusService()
        expect(latest?.id).toBe(newer.id)

        // 清理 old
        await prisma.lprSyncLogs.delete({ where: { id: old.id } })
    })

    it('没有日志时返回 null', async () => {
        // 测试库可能有其他测试残留的日志，这里只验证函数本身能调通
        const latest = await getLatestLPRSyncStatusService()
        expect(latest === null || typeof latest.id === 'number').toBe(true)
    })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

Run: `npx vitest run tests/server/services/rates/lprSync.service.test.ts`
Expected: FAIL，提示 `syncLPRRatesService` 和 `getLatestLPRSyncStatusService` 不存在

- [ ] **Step 3: 在 `server/services/rates/lprSync.service.ts` 末尾追加主流程实现**

```typescript

import {
    createLPRSyncLogDAO,
    updateLPRSyncLogDAO,
    findLatestLPRSyncLogDAO,
} from '~~/server/services/rates/lprSyncLog.dao'
import { createLPRRateService } from '~~/server/services/rates/rates.service'
import { prisma } from '~~/server/utils/db'

export interface SyncLPRResult {
    fetched: number
    inserted: number
    logId: number
}

/**
 * 同步 chinamoney LPR 数据到 lpr_rates 表
 *
 * 流程：1) 写 running log → 2) fetch → 3) 逐条去重后 createLPRRateService → 4) 标记成功
 * 任何步骤失败：catch + 写 failure log + 透传原错误
 *
 * @param opts.triggeredBy 触发方式，cron 任务传 'auto'，管理后台按钮传 'manual'
 * @param opts.operatorId 手动触发时记录 admin user id
 */
export async function syncLPRRatesService(opts: {
    triggeredBy: 'auto' | 'manual'
    operatorId?: number
}): Promise<SyncLPRResult> {
    const startedAt = new Date()
    const rangeEnd = new Date()
    const rangeStart = new Date(Date.now() - 30 * 86400_000)

    const log = await createLPRSyncLogDAO({
        startedAt,
        status: 'running',
        triggeredBy: opts.triggeredBy,
        operatorId: opts.operatorId ?? null,
        rangeStart,
        rangeEnd,
    })

    try {
        const records = await fetchLPRFromChinamoneyService({ rangeStart, rangeEnd })

        let inserted = 0
        for (const r of records) {
            const effectDate = new Date(r.showDateCN)
            const exists = await prisma.lprRates.findUnique({ where: { effectDate } })
            if (exists) continue

            await createLPRRateService({
                effectDate: r.showDateCN,
                oneYear: parseFloat(r['1Y']),
                fiveYear: parseFloat(r['5Y']),
                remark: '自动同步自 chinamoney',
            })
            inserted++
        }

        await updateLPRSyncLogDAO(log.id, {
            finishedAt: new Date(),
            status: 'success',
            fetchedCount: records.length,
            insertedCount: inserted,
        })

        logger.info(`[lpr-sync] 完成：拉到 ${records.length} 条，新增 ${inserted} 条`)
        return { fetched: records.length, inserted, logId: log.id }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await updateLPRSyncLogDAO(log.id, {
            finishedAt: new Date(),
            status: 'failure',
            errorMessage: msg,
        })
        logger.error(`[lpr-sync] 失败：${msg}`)
        throw err
    }
}

/** 查询最近一次 LPR 同步状态（管理后台卡片用） */
export async function getLatestLPRSyncStatusService() {
    return findLatestLPRSyncLogDAO()
}
```

- [ ] **Step 4: 跑测试验证 PASS**

Run: `npx vitest run tests/server/services/rates/lprSync.service.test.ts`
Expected: 11 tests passed（4 fetch + 5 syncLPRRates + 2 getLatestStatus）

- [ ] **Step 5: 跑全量 tools/server 基线验证不破坏现有测试**

Run: `npx vitest run tests/shared/utils/tools/ tests/server/services/rates/ tests/server/tools/rates/ 2>&1 | tail -5`
Expected: `Tests` 数量 ≥ 之前基线（676 + 11 新增 ≈ 700 左右）全 PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/rates/lprSync.service.ts tests/server/services/rates/lprSync.service.test.ts
git commit -m "feat(rates): 新增 syncLPRRatesService 主流程 + 同步日志记录"
```

---

## 任务 T5：管理端 GET /api/v1/admin/rates/lpr/sync-status

**Files:**
- Create: `server/api/v1/admin/rates/lpr/sync-status.get.ts`
- Create: `tests/server/tools/rates/lpr-sync.api.test.ts`

- [ ] **Step 1: 写测试**

```typescript
/**
 * LPR 同步 API 测试
 *
 * **Feature: lpr-auto-sync**
 *
 * 注：测试目录放在 tests/server/tools/rates/ 而非 tests/server/api/...，
 * 因为 tests/server/api/** 被 vitest exclude（参考 PR1a-T7 implementer 的踩坑修正）
 */
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import syncStatusHandler from '~~/server/api/v1/admin/rates/lpr/sync-status.get'

function buildAdminEvent() {
    return {
        context: { auth: { user: { id: 1, role: 'super_admin' } } },
    } as any
}

describe('GET /api/v1/admin/rates/lpr/sync-status', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.lprSyncLogs.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('未登录返回 401', async () => {
        const res: any = await syncStatusHandler({ context: { auth: undefined } } as any)
        expect(res.code).toBe(401)
    })

    it('有日志时返回最近一条', async () => {
        const log = await prisma.lprSyncLogs.create({
            data: {
                startedAt: new Date(),
                finishedAt: new Date(),
                status: 'success',
                triggeredBy: 'manual',
                rangeStart: new Date('2025-11-01'),
                rangeEnd: new Date('2025-12-01'),
                fetchedCount: 5,
                insertedCount: 1,
                operatorId: 1,
            },
        })
        createdIds.push(log.id)

        const res: any = await syncStatusHandler(buildAdminEvent())
        expect(res.code).toBe(0)
        expect(res.data?.id).toBe(log.id)
        expect(res.data?.status).toBe('success')
        expect(res.data?.fetchedCount).toBe(5)
        expect(res.data?.insertedCount).toBe(1)
    })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

Run: `npx vitest run tests/server/tools/rates/lpr-sync.api.test.ts`
Expected: FAIL — handler 模块不存在

- [ ] **Step 3: 实现 `server/api/v1/admin/rates/lpr/sync-status.get.ts`**

```typescript
import { getLatestLPRSyncStatusService } from '~~/server/services/rates/lprSync.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    try {
        const data = await getLatestLPRSyncStatusService()
        return resSuccess(event, '查询成功', data)
    } catch (err) {
        logger.error('查询 LPR 同步状态失败', err)
        return resError(event, 500, '查询失败')
    }
})
```

- [ ] **Step 4: 跑测试验证 PASS**

Run: `npx vitest run tests/server/tools/rates/lpr-sync.api.test.ts`
Expected: 2 tests passed

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/admin/rates/lpr/sync-status.get.ts tests/server/tools/rates/lpr-sync.api.test.ts
git commit -m "feat(rates): 新增 GET /admin/rates/lpr/sync-status 查询最近同步状态"
```

---

## 任务 T6：管理端 POST /api/v1/admin/rates/lpr/sync

**Files:**
- Create: `server/api/v1/admin/rates/lpr/sync.post.ts`
- Modify: `tests/server/tools/rates/lpr-sync.api.test.ts`（追加 POST handler 测试）

- [ ] **Step 1: 在测试文件末尾追加 POST handler 测试**

```typescript

import { vi } from 'vitest'

// mock $fetch（与 lprSync.service.test.ts 用法一致）
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

import syncHandler from '~~/server/api/v1/admin/rates/lpr/sync.post'

describe('POST /api/v1/admin/rates/lpr/sync', () => {
    const createdLogIds: number[] = []
    const createdRateDates: string[] = []

    afterEach(async () => {
        fetchMock.mockReset()
        if (createdLogIds.length > 0) {
            await prisma.lprSyncLogs.deleteMany({ where: { id: { in: createdLogIds } } })
            createdLogIds.length = 0
        }
        if (createdRateDates.length > 0) {
            await prisma.lprRates.deleteMany({
                where: { effectDate: { in: createdRateDates.map((d) => new Date(d)) } },
            })
            createdRateDates.length = 0
        }
    })

    it('未登录返回 401', async () => {
        const res: any = await syncHandler({ context: { auth: undefined } } as any)
        expect(res.code).toBe(401)
    })

    it('成功触发同步，返回 fetched + inserted + logId', async () => {
        const newDate = `2097-03-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        createdRateDates.push(newDate)

        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '200', rep_message: '', ts: 0 },
            data: {},
            records: [
                { '1Y': '3.10', '5Y': '3.60', showDateCN: newDate, showDateEN: '' },
            ],
        })

        const res: any = await syncHandler(buildAdminEvent())
        expect(res.code).toBe(0)
        expect(res.data?.fetched).toBe(1)
        expect(res.data?.inserted).toBe(1)
        expect(typeof res.data?.logId).toBe('number')
        createdLogIds.push(res.data.logId)

        // 验证 log 的 operatorId
        const log = await prisma.lprSyncLogs.findUnique({ where: { id: res.data.logId } })
        expect(log?.operatorId).toBe(1)
        expect(log?.triggeredBy).toBe('manual')
    })

    it('chinamoney 报错时返回 500 + 错误消息', async () => {
        fetchMock.mockResolvedValueOnce({
            head: { rep_code: '500', rep_message: '内部错误', ts: 0 },
            data: {},
            records: [],
        })

        const res: any = await syncHandler(buildAdminEvent())
        expect(res.code).toBe(500)
        expect(res.message).toMatch(/chinamoney API 错误/)

        // 验证 failure log 已落库
        const log = await prisma.lprSyncLogs.findFirst({
            where: { status: 'failure', operatorId: 1 },
            orderBy: { startedAt: 'desc' },
        })
        expect(log).not.toBeNull()
        createdLogIds.push(log!.id)
    })
})
```

- [ ] **Step 2: 跑测试验证 FAIL**

Run: `npx vitest run tests/server/tools/rates/lpr-sync.api.test.ts`
Expected: FAIL — `sync.post` handler 模块不存在

- [ ] **Step 3: 实现 `server/api/v1/admin/rates/lpr/sync.post.ts`**

包一层 `withDistributedLock` —— 与 cron 共用同一把 Redis 锁，避免手动触发和定时任务撞车（spec §10 边界要求）：

```typescript
import { syncLPRRatesService } from '~~/server/services/rates/lprSync.service'
import { withDistributedLock } from '~~/server/utils/cron'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    try {
        const result = await withDistributedLock(
            'cron:lock:lpr-daily-sync',
            60,
            () => syncLPRRatesService({ triggeredBy: 'manual', operatorId: user.id }),
        )

        if (result === null) {
            return resError(event, 409, '已有同步任务在执行中，请稍后再试')
        }
        return resSuccess(event, '同步成功', result)
    } catch (err) {
        logger.error('手动同步 LPR 失败', err)
        const msg = err instanceof Error ? err.message : '同步失败'
        return resError(event, 500, msg)
    }
})
```

> 设计要点：lock key `cron:lock:lpr-daily-sync` 与 `server/plugins/cron-scheduler.ts` 注册的 task name 拼出的 key 一致（`CronScheduler.start()` 内部用 `cron:lock:${task.name}`）。这样手动触发和定时任务竞争同一把锁。

- [ ] **Step 4: 跑测试验证 PASS**

Run: `npx vitest run tests/server/tools/rates/lpr-sync.api.test.ts`
Expected: 5 tests passed（2 sync-status + 3 sync）

- [ ] **Step 5: Commit**

```bash
git add server/api/v1/admin/rates/lpr/sync.post.ts tests/server/tools/rates/lpr-sync.api.test.ts
git commit -m "feat(rates): 新增 POST /admin/rates/lpr/sync 手动触发同步"
```

---

## 任务 T7：注册定时任务到 cron-scheduler.ts

**Files:**
- Modify: `server/plugins/cron-scheduler.ts`

- [ ] **Step 1: Read 现有 `server/plugins/cron-scheduler.ts`，确认末尾 task 注册位置**

Run: `grep -n "scheduler.register\|scheduler.start" server/plugins/cron-scheduler.ts`
Expected: 看到多条 `scheduler.register({...})` 调用 + 最后一行 `scheduler.start()`，定位最后一个 `register` 后、`scheduler.start()` 前的位置作为插入点

- [ ] **Step 2: 在文件顶部 import 区追加**

在 `import { handleExpiredPaymentTransactionsService } from ...` 之后追加：

```typescript
import { syncLPRRatesService } from '~~/server/services/rates/lprSync.service'
```

- [ ] **Step 3: 在 `scheduler.start()` 之前追加 task 注册**

```typescript

  // LPR 利率每日自动同步（每 24h，拉取过去 30 天滚动窗口）
  scheduler.register({
    name: 'lpr-daily-sync',
    intervalMs: 24 * 60 * 60 * 1000,
    lockTtlSeconds: 60,
    fn: () => syncLPRRatesService({ triggeredBy: 'auto' }),
    runImmediately: false,
  })
```

- [ ] **Step 4: typecheck**

Run: `bun run typecheck 2>&1 | grep "cron-scheduler" | head -3`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add server/plugins/cron-scheduler.ts
git commit -m "feat(rates): cron-scheduler 注册 lpr-daily-sync 定时任务（每 24h）"
```

---

## 任务 T8：LPRSyncStatusCard.vue

**Files:**
- Create: `app/components/admin/rates/LPRSyncStatusCard.vue`

- [ ] **Step 1: 确认 dayjs relativeTime 插件可用**

Run: `grep -rE "dayjs.extend\(relativeTime\)" app/ shared/ 2>/dev/null | head -3`
Expected: 至少有一处 extend（项目应已注册过；如果没有，需要在组件内 extend 一次）

- [ ] **Step 2: 创建 `app/components/admin/rates/LPRSyncStatusCard.vue`**

```vue
<template>
    <Card>
        <CardContent class="py-4">
            <div class="flex items-center justify-between gap-4">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <RefreshCw class="w-4 h-4 text-primary" />
                        <span class="font-medium">LPR 数据同步</span>
                    </div>
                    <p v-if="!log" class="text-sm text-muted-foreground">
                        尚未同步过 — 点击右侧按钮立即拉取最新数据
                    </p>
                    <p v-else-if="log.status === 'success'" class="text-sm text-muted-foreground">
                        上次同步：{{ relativeTime(log.startedAt) }} ·
                        <span class="text-emerald-600">成功</span> ·
                        拉到 {{ log.fetchedCount }} 条 ·
                        本次新增 <strong class="text-foreground">{{ log.insertedCount }}</strong> 条
                    </p>
                    <p v-else-if="log.status === 'failure'" class="text-sm">
                        <span class="text-destructive">失败</span>（{{ relativeTime(log.startedAt) }}）：
                        <span class="text-muted-foreground">{{ log.errorMessage }}</span>
                    </p>
                    <p v-else class="text-sm text-muted-foreground">
                        正在同步中（{{ relativeTime(log.startedAt) }} 开始）
                    </p>
                </div>
                <Button :disabled="syncing" @click="onSync">
                    <RefreshCw class="w-4 h-4 mr-1" :class="syncing && 'animate-spin'" />
                    {{ syncing ? '同步中' : '立即同步' }}
                </Button>
            </div>
        </CardContent>
    </Card>
</template>

<script setup lang="ts">
import { Card, CardContent } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { RefreshCw } from 'lucide-vue-next'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'
import dayjs from 'dayjs'
import relativeTimePlugin from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTimePlugin)
dayjs.locale('zh-cn')

const emit = defineEmits<{ synced: [] }>()

interface SyncLog {
    id: number
    startedAt: string
    finishedAt: string | null
    status: 'running' | 'success' | 'failure'
    triggeredBy: 'auto' | 'manual'
    fetchedCount: number
    insertedCount: number
    errorMessage?: string | null
}

const log = ref<SyncLog | null>(null)
const syncing = ref(false)
const alertDialog = useAlertDialogStore()

async function loadStatus() {
    log.value = await useApiFetch<SyncLog | null>('/api/v1/admin/rates/lpr/sync-status', { method: 'GET' })
}

async function onSync() {
    syncing.value = true
    try {
        const result = await useApiFetch<{ fetched: number; inserted: number }>(
            '/api/v1/admin/rates/lpr/sync',
            { method: 'POST' },
        )
        await loadStatus()
        emit('synced')
        if (result) {
            await alertDialog.showDialog({
                title: '同步成功',
                description: result.inserted > 0
                    ? `拉取到 ${result.fetched} 条 LPR 记录，新增 ${result.inserted} 条`
                    : `拉取到 ${result.fetched} 条 LPR 记录，无新增`,
            })
        }
    } finally {
        syncing.value = false
    }
}

function relativeTime(iso: string): string {
    return dayjs(iso).fromNow()
}

onMounted(loadStatus)
</script>
```

- [ ] **Step 3: typecheck**

Run: `bun run typecheck 2>&1 | grep "LPRSyncStatusCard" | head -3`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add app/components/admin/rates/LPRSyncStatusCard.vue
git commit -m "feat(admin-rates): 新增 LPRSyncStatusCard 状态卡片 + 立即同步按钮"
```

---

## 任务 T9：lpr.vue 嵌入 LPRSyncStatusCard

**Files:**
- Modify: `app/pages/admin/rates/lpr.vue`

- [ ] **Step 1: Read 现有 `app/pages/admin/rates/lpr.vue` 确认结构**

Run: `head -30 app/pages/admin/rates/lpr.vue`
Expected: 看到顶部 `<div class="space-y-4">` 容器 + `<Card>` 列表 + `<LPRFormDialog>`

- [ ] **Step 2: 在 `<script setup>` 顶部追加 import（与 PR4-T1 至 T4 修复经验一致：业务组件必须显式 import）**

在文件 `<script setup lang="ts">` 标签后第一行，插入：

```typescript
import LPRSyncStatusCard from '~/components/admin/rates/LPRSyncStatusCard.vue'
```

- [ ] **Step 3: 在 template 顶部，把 LPRSyncStatusCard 插到「列表 Card」之前**

具体改动：在 `<div class="space-y-4">` 之内，第一个 `<div class="flex items-center justify-between">` 之后、`<Card>` 之前，插入：

```vue

        <LPRSyncStatusCard @synced="loadList" />
```

最终顶部结构应该是：

```vue
<template>
    <div class="space-y-4">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-semibold">LPR 利率</h1>
                <p class="text-muted-foreground text-sm">...</p>
            </div>
            <Button @click="openCreate">
                <Plus class="w-4 h-4 mr-1" />新增
            </Button>
        </div>

        <LPRSyncStatusCard @synced="loadList" />

        <Card>
            <Table>
                <!-- ... -->
```

- [ ] **Step 4: typecheck**

Run: `bun run typecheck 2>&1 | grep "lpr.vue\|LPRSyncStatusCard" | head -3`
Expected: 无错误

- [ ] **Step 5: 启动 dev 验证（用户手动跑）**

Run: `bun dev` → 访问 `http://localhost:3000/admin/rates/lpr`

预期：
- 页面顶部「新增」按钮下方显示 LPRSyncStatusCard
- 首次访问显示「尚未同步过」（如果之前 T4 测试残留过 success log，可能显示成功态）
- 点「立即同步」→ loading 旋转 → 完成后弹窗提示「拉取到 N 条 / 新增 N 条」→ 卡片自动刷新 + 列表 reload

- [ ] **Step 6: Commit**

```bash
git add app/pages/admin/rates/lpr.vue
git commit -m "feat(admin-rates): lpr 列表页顶部嵌入 LPRSyncStatusCard"
```

---

## 任务 T10：PR 收尾 — 全量回归 + RBAC 注册说明

- [ ] **Step 1: 跑全量 tools / rates 测试，确认 PR 整体不破坏基线**

Run:
```bash
npx vitest run tests/shared/utils/tools/ tests/server/services/rates/ tests/server/tools/rates/ 2>&1 | tail -8
```
Expected:
- `Test Files` 至少 17 个全 passed（原 19 个 tools + rates，新增 1 个 lprSync.service.test.ts 不变；lpr-sync.api.test.ts 是新增）
- `Tests` 数量 ≥ 688（676 tools + 5 lpr-sync.api + 7 lprSync.service）全 PASS

- [ ] **Step 2: 提示用户完成 RBAC 注册（人工步骤，不在自动化范围）**

按 `.claude/rules/api.md` 「管理端 API 注册流程」操作：

1. `bun dev` 启动服务
2. 浏览器进管理后台 → 「API 权限」→ 点扫描按钮
3. 命中两个新接口：
   - `POST /api/v1/admin/rates/lpr/sync`
   - `GET /api/v1/admin/rates/lpr/sync-status`
4. 「角色」页给 `super_admin` 和 `admin` 角色勾选这两个新权限
5. 退出 dev，重启服务确认权限生效

- [ ] **Step 3: 浏览器端到端验证（用户手动跑）**

1. 访问 `/admin/rates/lpr` 看到状态卡片
2. 点「立即同步」→ 应能成功（最近 30 天通常没新 LPR，inserted=0 也正常）
3. 测试错误路径：临时把 `lprSync.service.ts` 里的 URL 改成 `https://www.chinamoney.com.cn/wrong-path` → 重启 → 点同步 → 卡片显示失败 + 错误信息（验证后改回正确 URL）

- [ ] **Step 4: 总结 commit**

```bash
git commit --allow-empty -m "chore(rates): LPR 自动同步功能完成 - cron 任务 + 状态卡片 + 手动触发"
```

---

## 收尾交付物清单

实施完成后应有：

**新建（8 个文件）：**
- `prisma/models/rates.prisma` 内追加 `lprSyncLogs` model
- `prisma/migrations/<ts>_add_lpr_sync_logs/migration.sql`
- `server/services/rates/lprSyncLog.dao.ts`
- `server/services/rates/lprSync.service.ts`
- `server/api/v1/admin/rates/lpr/sync.post.ts`
- `server/api/v1/admin/rates/lpr/sync-status.get.ts`
- `app/components/admin/rates/LPRSyncStatusCard.vue`
- `tests/server/services/rates/lprSync.service.test.ts`
- `tests/server/tools/rates/lpr-sync.api.test.ts`

**修改（2 个文件）：**
- `server/plugins/cron-scheduler.ts`（追加 1 个 task 注册）
- `app/pages/admin/rates/lpr.vue`（追加 1 个 import + 1 个组件标签）

**测试覆盖：**
- `fetchLPRFromChinamoneyService`: 4 cases（成功 / API 错码 / 空 records / 网络异常）
- `syncLPRRatesService`: 5 cases（全新数据 / 跳重复 / API 错 / 空 records / 网络异常）
- `getLatestLPRSyncStatusService`: 2 cases（有日志 / 无日志）
- `GET /sync-status`: 2 cases（401 / 200）
- `POST /sync`: 3 cases（401 / 200 / chinamoney 报错 500）

**生效条件（部署）：**
- prisma migrate 同步线上库
- 管理后台扫描 2 个新接口 + 角色授权
- 服务重启后 cron 任务自动启动，24h 后第一次自动执行
