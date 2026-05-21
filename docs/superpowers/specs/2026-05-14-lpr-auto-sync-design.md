# LPR 利率每日自动同步设计

> 设计日期：2026-05-14
> 目标：让 `lpr_rates` 表自动跟随央行 LPR 发布更新，运维场景下可见可控可手动重试。

## 1. 背景

[2026-05-14 办案工具重构](2026-05-14-tools-refactor-design.md) 已经把 LPR 历史数据库化（`lpr_rates` 表 + 服务端 API + 客户端缓存 + 管理后台 CRUD）。但数据来源仍然是手工 seed —— 央行每月 20 日左右公布新 LPR 后，需要管理员手动新增一条记录，容易遗漏。

本设计加一个每日自动同步任务，从全国银行间同业拆借中心（[chinamoney.com.cn](https://www.chinamoney.com.cn/r/cms/chinese/chinamoney/html/currency/lpr-shibor-history-download.html)）的公开接口拉取最新数据，自动入库。

## 2. 设计目标

- **零运维**：央行发布后 24h 内数据自动入库，无需人工干预
- **可观测**：管理后台能一眼看到上次同步时间 + 结果 + 新增数量
- **可手动**：异常时可在管理后台一键重试，不必登服务器
- **抗故障**：API 失败、网络超时、数据格式异常都不阻塞调度，下次自动重试
- **多实例安全**：复用项目现有 `CronScheduler + Redis 分布式锁`，避免重复执行

## 3. 数据源

公开接口（POST，无需认证 / Cookie）：

```
POST https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis
?lang=CN
&strStartDate=YYYY-MM-DD
&strEndDate=YYYY-MM-DD
```

需要带上以下 header 模拟浏览器（实测必须，否则返回 403）：

| Header | 值 |
|--------|---|
| `Origin` | `https://www.chinamoney.com.cn` |
| `Referer` | `https://www.chinamoney.com.cn/r/cms/chinese/chinamoney/html/currency/lpr-shibor-history-download.html` |
| `User-Agent` | 标准浏览器 UA |
| `X-Requested-With` | `XMLHttpRequest` |
| `Accept` | `application/json, text/javascript, */*; q=0.01` |

实测响应（2025-11-01 ~ 2025-12-31）：

```json
{
    "head": { "rep_code": "200", "rep_message": "", "ts": 1778752637625 },
    "data": { "endDateCN": "2025-12-31", "startDateCN": "2025-11-01", "message": "" },
    "records": [
        { "5Y": "3.50", "1Y": "3.00", "showDateCN": "2025-12-22", "showDateEN": "22 Dec 2025" },
        { "5Y": "3.50", "1Y": "3.00", "showDateCN": "2025-11-20", "showDateEN": "20 Nov 2025" }
    ]
}
```

字段映射：

| API 字段 | TS 类型 | 落 `lpr_rates` 表字段 |
|---------|---------|----------------------|
| `records[].showDateCN` | `string`（YYYY-MM-DD） | `effectDate` |
| `records[].1Y` | `string`（待 parseFloat） | `oneYear` |
| `records[].5Y` | `string`（待 parseFloat） | `fiveYear` |

`head.rep_code` 不等于 `"200"` 视为业务错误抛出。

## 4. 架构与文件结构

```
prisma/models/rates.prisma                        # 追加 lprSyncLogs model（不动现有 3 张表）
server/services/rates/
├── lprSync.service.ts                            # fetch + 解析 + upsert + 记日志（新增）
├── lprSyncLog.dao.ts                             # sync log CRUD（新增）
├── rates.service.ts                              # 已有（PR1a-T6）
└── rates.dao.ts                                  # 已有（PR1a-T5）
server/api/v1/admin/rates/lpr/
├── sync.post.ts                                  # 手动触发同步（新增）
├── sync-status.get.ts                            # 查询最近一次同步状态（新增）
├── index.get.ts / index.post.ts / [id].patch.ts / [id].delete.ts  # 已有（PR1a-T8）
server/plugins/cron-scheduler.ts                  # 追加 task `lpr-daily-sync`
app/components/admin/rates/
├── LPRSyncStatusCard.vue                         # 状态卡片 + 立即同步按钮（新增）
└── LPRFormDialog.vue                             # 已有（PR1b-T2）
app/pages/admin/rates/lpr.vue                     # 在列表页顶部嵌入 LPRSyncStatusCard
tests/server/services/rates/lprSync.service.test.ts  # mock $fetch 单测
tests/server/tools/rates/lpr-sync.api.test.ts        # handler 测试
```

## 5. 数据模型

### 5.1 lprSyncLogs（新增表）

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
    /// 失败时的错误信息（API 报错 / 解析异常 / 网络超时等）
    errorMessage  String?   @map("error_message") @db.Text
    /// 手动触发时记录 admin user id
    operatorId    Int?      @map("operator_id")
    createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

    @@index([startedAt(sort: Desc)])
    @@map("lpr_sync_logs")
}
```

只索引 `startedAt desc` —— "查最近一次"是唯一查询路径。

### 5.2 与 lprRates 的关系

不加外键。lpr_sync_logs 只是审计日志，与 lpr_rates 业务数据解耦：
- 日志数据可以独立保留 / 清理
- 已存在的 lpr_rates 数据不受影响

## 6. 核心服务

### 6.1 fetchLPRFromChinamoneyService

```typescript
interface ChinamoneyLPRResponse {
    head: { rep_code: string; rep_message: string; ts: number }
    data: { endDateCN: string; startDateCN: string; message: string }
    records: Array<{
        '1Y': string
        '5Y': string
        showDateCN: string
        showDateEN: string
    }>
}

export async function fetchLPRFromChinamoneyService(opts: {
    rangeStart: Date
    rangeEnd: Date
}): Promise<ChinamoneyLPRResponse['records']> {
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const url = `https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis?lang=CN&strStartDate=${fmt(opts.rangeStart)}&strEndDate=${fmt(opts.rangeEnd)}`

    const response = await $fetch<ChinamoneyLPRResponse>(url, {
        method: 'POST',
        headers: {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Origin': 'https://www.chinamoney.com.cn',
            'Referer': 'https://www.chinamoney.com.cn/r/cms/chinese/chinamoney/html/currency/lpr-shibor-history-download.html',
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

### 6.2 syncLPRRatesService（主流程）

```typescript
export interface SyncLPRResult {
    fetched: number
    inserted: number
    logId: number
}

export async function syncLPRRatesService(opts: {
    triggeredBy: 'auto' | 'manual'
    operatorId?: number
}): Promise<SyncLPRResult> {
    const startedAt = new Date()
    const rangeEnd = new Date()
    const rangeStart = new Date(Date.now() - 30 * 86400_000)

    // 1. 写一条 running 日志
    const log = await createLPRSyncLogDAO({
        startedAt,
        status: 'running',
        triggeredBy: opts.triggeredBy,
        operatorId: opts.operatorId ?? null,
        rangeStart,
        rangeEnd,
    })

    try {
        // 2. 拉取
        const records = await fetchLPRFromChinamoneyService({ rangeStart, rangeEnd })

        // 3. 逐条 upsert（已存在的 effectDate 跳过）
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

        // 4. 标记成功
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
```

`createLPRRateService` 内部会自动调 `refreshLPRCacheService`（PR1a-T6 实现），保证模块缓存与 DB 同步。

### 6.3 getLatestLPRSyncStatusService

```typescript
export async function getLatestLPRSyncStatusService() {
    return findLatestLPRSyncLogDAO()  // ORDER BY startedAt DESC LIMIT 1
}
```

## 7. 定时调度

在 [server/plugins/cron-scheduler.ts](../../../server/plugins/cron-scheduler.ts) 注册项目末尾追加：

```typescript
import { syncLPRRatesService } from '~~/server/services/rates/lprSync.service'

// LPR 利率每日同步（每 24h，拉取过去 30 天滚动）
scheduler.register({
    name: 'lpr-daily-sync',
    intervalMs: 24 * 60 * 60 * 1000,
    lockTtlSeconds: 60,
    fn: () => syncLPRRatesService({ triggeredBy: 'auto' }),
    runImmediately: false,
})
```

- `runImmediately: false` —— 避免冷启动慢
- `lockTtlSeconds: 60` —— chinamoney 一般 <1s，60s 足够兜底
- 与现有 `agent-runs-cleanup`、`oss-orphan-gc` 等 24h 任务一致风格

## 8. 管理端 API

### 8.1 POST /api/v1/admin/rates/lpr/sync — 手动触发

```typescript
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    try {
        const result = await syncLPRRatesService({
            triggeredBy: 'manual',
            operatorId: user?.id,
        })
        return resSuccess(event, '同步成功', result)
    } catch (err) {
        logger.error('手动同步 LPR 失败', err)
        return resError(event, 500, err instanceof Error ? err.message : '同步失败')
    }
})
```

返回 `{ fetched, inserted, logId }`。

### 8.2 GET /api/v1/admin/rates/lpr/sync-status — 查最近一次

```typescript
export default defineEventHandler(async (event) => {
    try {
        const log = await getLatestLPRSyncStatusService()
        return resSuccess(event, '查询成功', log)
    } catch (err) {
        logger.error('查询 LPR 同步状态失败', err)
        return resError(event, 500, '查询失败')
    }
})
```

返回单条最近 lprSyncLogs 记录或 null（首次部署还没跑过）。

权限：两个接口都走 `server/middleware/03.permission.ts` RBAC，按 [.claude/rules/api.md](../../../.claude/rules/api.md) "管理端 API 注册流程" 后台扫描后给 super_admin / admin 授权。

## 9. UI 组件

### 9.1 LPRSyncStatusCard.vue

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
                        本次新增 <strong>{{ log.insertedCount }}</strong> 条
                    </p>
                    <p v-else-if="log.status === 'failure'" class="text-sm">
                        <span class="text-destructive">失败</span>（{{ relativeTime(log.startedAt) }}）：
                        <span class="text-muted-foreground">{{ log.errorMessage }}</span>
                    </p>
                    <p v-else class="text-sm text-muted-foreground">
                        正在同步中（{{ relativeTime(log.startedAt) }} 开始）...
                    </p>
                </div>
                <Button :disabled="syncing" @click="onSync">
                    <RefreshCw class="w-4 h-4 mr-1" :class="syncing && 'animate-spin'" />
                    {{ syncing ? '同步中...' : '立即同步' }}
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

const emit = defineEmits<{ synced: [] }>()

interface SyncLog {
    id: number
    startedAt: string
    status: 'running' | 'success' | 'failure'
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
        if (result && result.inserted > 0) {
            await alertDialog.showDialog({
                title: '同步成功',
                description: `拉取到 ${result.fetched} 条 LPR 记录，新增 ${result.inserted} 条`,
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

### 9.2 lpr.vue 嵌入卡片

在 [app/pages/admin/rates/lpr.vue](../../../app/pages/admin/rates/lpr.vue) 列表 `<Card>` 之前插入：

```vue
<LPRSyncStatusCard @synced="loadList" />
```

`@synced` 触发后重新加载列表 —— 新数据立刻显示。

## 10. 错误处理与边界

| 场景 | 行为 |
|------|------|
| chinamoney HTTP 4xx/5xx | `$fetch` 抛 → catch → 记 `failure` + errorMessage |
| `head.rep_code !== "200"` | 视为业务错误抛 → 同上 |
| 网络超时 30s | timeout 触发 abort → 同上 |
| 响应 `records` 为空数组 | 不是错误，`fetched=0 / inserted=0`，记 `success` |
| `parseFloat('1Y')` 失败 | 抛 → 整个任务失败（数据源格式异常需要及时发现） |
| DB unique 冲突 | 不可能发生（先 findUnique 再 create）|
| 多实例并发 | `withDistributedLock('cron:lock:lpr-daily-sync', 60)` 兜底 |
| 手动触发与 cron 撞车 | 都走同一把锁，后到的直接 short-circuit 返回 null，handler 提示"已有同步进行中" |
| 部署后第一次 status 查询 | 返回 null → 卡片显示"尚未同步过" |

## 11. 测试策略

### 11.1 单元测试 lprSync.service.test.ts

mock `$fetch` 返回预设响应（含 happy path / 4xx / rep_code != 200 / 空 records），用真实 worker DB 验证：

- 拉到 N 条全新数据 → `insertedCount = N`
- 拉到的数据 effectDate 已存在 → `insertedCount = 0`
- 部分重复 → 只 insert 新数据
- API 返回 4xx → sync log 标 failure + 错误消息
- API 返回 rep_code != 200 → sync log 标 failure
- 数据源 fixture：直接用本 spec 第 3 节 的真实响应快照

### 11.2 handler 测试 lpr-sync.api.test.ts

- POST /sync 走完整流程，验证返回 { fetched, inserted, logId }
- GET /sync-status 在有 / 无日志情况下都返回正确数据
- 未登录返回 401

测试目录沿用 PR1a-T7 的踩坑修正：`tests/server/tools/rates/`（而非 `tests/server/api/`，后者被 vitest 排除）。

### 11.3 不做的测试

- E2E 真打 chinamoney —— 不稳定 + 慢，不放 CI
- 多实例锁竞争 —— 项目已有的 `withDistributedLock` 已经被其他定时任务覆盖测试过

## 12. 部署后的初始化

1. 跑 `bun run prisma:migrate --name add_lpr_sync_logs` 新增表
2. 管理后台 → 「API 权限」扫描录入 `/admin/rates/lpr/sync` 和 `/admin/rates/lpr/sync-status`
3. 「角色」页给 super_admin / admin 勾选这两个新权限
4. 重启服务后，cron-scheduler 自动开始按 24h 间隔执行
5. 管理员第一次进 `/admin/rates/lpr` 看到 LPRSyncStatusCard "尚未同步过"，点「立即同步」拉取初始数据

## 13. 不在范围内

- **微信 / 邮件 / Slack 通知**：用户明确说不要
- **PBOC 存款 / 贷款基准利率同步**：央行 2015 年后未再调整，定时拉无意义
- **同步日志历史列表页**：YAGNI，只保留最近一次状态够用；如果将来真需要审计历史，再加 `/admin/rates/lpr/sync-logs` 列表页
- **失败重试机制**：定时任务每 24h 自然重试一次足够；不实现 exponential backoff
- **数据校验告警**：LPR 跨越 50% 跳变这种"业务异常"暂不检测，央行不会出错

## 14. 决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 拉取频率 | 24h 滚动 / 6h 加密 / cron 固定时间 | 24h 滚动过去 30 天 | LPR 每月仅发布 1 次，24h 足够；过去 30 天兜底服务挂掉的丢数据情况；与现有 cron 任务风格一致 |
| 调度精度 | intervalMs / cron 表达式 | intervalMs | 项目现有 CronScheduler 不支持 cron 表达式，加这个能力是 scope creep |
| 失败处理 | 通知 / log 持久化 / 静默 log | log 持久化 + 后台卡片可视 | 用户选了 "管理后台加状态卡片 + 手动触发按钮" |
| 变动通知 | 主动推送 / 后台高亮 | 后台高亮 | 用户选了 "仅在后台卡片上高亮" |
| 日志保留 | 全部保留 / 30 天 / 90 天 | 全部保留（暂不清理） | 每天 1 条，1 年 365 条，规模可忽略；未来真需要再加清理任务 |
| API 来源 | chinamoney / 央行官网 / 第三方付费 API | chinamoney | 用户提供的 curl 已验证可用，免费、官方、JSON 格式清晰 |
