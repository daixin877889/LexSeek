# 历史数据迁移 · 计划三：数据校验、向量重嵌入与切换 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现迁移后数据校验命令 `verify`、案件材料向量重嵌入接入，并把蓝绿切换 runbook 固化到工具 README，完成整套迁移工具。

**Architecture:** `verify` 命令对新旧两库做四类校验（行数、业务聚合、抽样内容、非外键引用完整性），产出校验报告。向量重嵌入复用新项目既有的材料嵌入能力，对迁移后标记为"待嵌入"（`vectorIds=[]`、`lastEmbeddingAt=null`）的记录批量补嵌入。

**Tech Stack:** TypeScript、Prisma 7.7、vitest 4。

**依据：** 设计文档 `docs/superpowers/specs/2026-05-17-legacy-data-migration-design.md`（§11 向量、§13 校验、§14 切换 runbook）。本计划是 3 个计划中的第 3 个。计划一、二须先完成。

---

## 文件结构

```
legacy-migration/src/
├── verify/
│   ├── helpers.ts      解析异常清单、行数比较（纯函数）
│   ├── rowCounts.ts    行数校验
│   ├── aggregates.ts   业务聚合校验
│   ├── samples.ts      抽样内容校验
│   ├── references.ts   非外键引用完整性校验
│   └── index.ts        runVerify 汇总
└── index.ts            CLI（加 verify 命令）
legacy-migration/tests/verify/helpers.test.ts
```

---

## Task 1: verify 辅助纯函数

**Files:**
- Create: `legacy-migration/src/verify/helpers.ts`
- Test: `legacy-migration/tests/verify/helpers.test.ts`

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/verify/helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseExceptionCounts, rowCountVerdict } from '../../src/verify/helpers'

describe('parseExceptionCounts', () => {
  it('按表统计异常清单 CSV 的跳过行数', () => {
    const csv = 'table,old_id,reason\nusers,1,x\nusers,2,y\ncases,3,z'
    const m = parseExceptionCounts(csv)
    expect(m.get('users')).toBe(2)
    expect(m.get('cases')).toBe(1)
    expect(m.get('orders') ?? 0).toBe(0)
  })
  it('空清单（仅表头）返回空 Map', () => {
    expect(parseExceptionCounts('table,old_id,reason').size).toBe(0)
  })
})

describe('rowCountVerdict', () => {
  it('新行数 == 旧行数 - 跳过数 → ok', () => {
    expect(rowCountVerdict(100, 95, 5).status).toBe('ok')
  })
  it('不相等 → mismatch，detail 含差值', () => {
    const v = rowCountVerdict(100, 90, 5)
    expect(v.status).toBe('mismatch')
    expect(v.detail).toContain('5')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/verify/helpers.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `helpers.ts`**

```ts
/** 解析异常清单 CSV，按表统计被跳过的行数 */
export function parseExceptionCounts(csv: string): Map<string, number> {
  const m = new Map<string, number>()
  const lines = csv.split('\n').slice(1) // 跳过表头
  for (const line of lines) {
    if (!line.trim()) continue
    // table 是第一列（不含逗号）
    const table = line.slice(0, line.indexOf(','))
    m.set(table, (m.get(table) ?? 0) + 1)
  }
  return m
}

export interface CountVerdict {
  status: 'ok' | 'mismatch'
  detail: string
}

/** 行数判定：新库行数应等于 旧库行数 − 跳过数 */
export function rowCountVerdict(oldCount: number, newCount: number, skipped: number): CountVerdict {
  const expected = oldCount - skipped
  if (newCount === expected) {
    return { status: 'ok', detail: `旧 ${oldCount} − 跳过 ${skipped} = 新 ${newCount}` }
  }
  return {
    status: 'mismatch',
    detail: `旧 ${oldCount} − 跳过 ${skipped} = 期望 ${expected}，实际新库 ${newCount}，差 ${newCount - expected}`,
  }
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/verify/helpers.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/verify/helpers.ts legacy-migration/tests/verify/helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): verify 辅助纯函数（异常清单解析、行数判定）
EOF
)"
```

---

## Task 2: 行数校验 rowCounts.ts

**Files:**
- Create: `legacy-migration/src/verify/rowCounts.ts`

设计文档 §13 校验 1。逐表对比 新库行数 与 旧库行数 − 异常清单跳过数。DB 绑定，由 Task 6 冒烟验证。

- [ ] **Step 1: 实现 `rowCounts.ts`**

```ts
import { readFileSync } from 'node:fs'
import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import { log, warn } from '../logger'
import { parseExceptionCounts, rowCountVerdict } from './helpers'

/** [校验标签, 旧库 delegate, 新库 delegate, 异常清单中的表名] */
type Pair = [string, { count: () => Promise<number> }, { count: () => Promise<number> }, string]

export interface RowCountReport {
  label: string
  status: 'ok' | 'mismatch' | 'info'
  detail: string
}

/**
 * 行数校验。A 类表严格判定；B 类表（caseMaterials/orders/paymentTransactions/textContentRecords）
 * 因拆并行/合成行只做 info 展示，由运维结合 detail 判断。
 */
export async function verifyRowCounts(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  exceptionsCsvPath: string,
): Promise<RowCountReport[]> {
  let skipped: Map<string, number>
  try {
    skipped = parseExceptionCounts(readFileSync(exceptionsCsvPath, 'utf8'))
  } catch {
    warn(`[verify] 未找到异常清单 ${exceptionsCsvPath}，跳过数按 0 计`)
    skipped = new Map()
  }

  // A 类：严格判定
  const strictPairs: Pair[] = [
    ['system_configs', legacy.systemConfigs, next.systemConfigs, 'systemConfigs'],
    ['users', legacy.users, next.users, 'users'],
    ['oss_files', legacy.ossFiles, next.ossFiles, 'ossFiles'],
    ['asr_tasks', legacy.asrTasks, next.asrTasks, 'asrTasks'],
    ['asr_records', legacy.asrRecords, next.asrRecords, 'asrRecords'],
    ['doc_recognition_records', legacy.docRecognitionRecords, next.docRecognitionRecords, 'docRecognitionRecords'],
    ['image_recognition_records', legacy.imageRecognitionRecords, next.imageRecognitionRecords, 'imageRecognitionRecords'],
    ['cases', legacy.cases, next.cases, 'cases'],
    ['case_sessions', legacy.caseSessions, next.caseSessions, 'caseSessions'],
    ['case_analyses', legacy.caseAnalyses, next.caseAnalyses, 'caseAnalyses'],
    ['user_memberships', legacy.userMemberships, next.userMemberships, 'userMemberships'],
    ['membership_upgrade_records', legacy.membershipUpgradeRecords, next.membershipUpgradeRecords, 'membershipUpgradeRecords'],
    ['point_records', legacy.pointRecords, next.pointRecords, 'pointRecords'],
    ['point_consumption_records', legacy.pointConsumptionRecords, next.pointConsumptionRecords, 'pointConsumptionRecords'],
    ['user_benefits', legacy.userBenefits, next.userBenefits, 'userBenefits'],
    ['redemption_codes', legacy.redemptionCodes, next.redemptionCodes, 'redemptionCodes'],
    ['redemption_records', legacy.redemptionRecords, next.redemptionRecords, 'redemptionRecords'],
  ]

  const reports: RowCountReport[] = []
  for (const [label, oldD, newD, exTable] of strictPairs) {
    const [oc, nc] = [await oldD.count(), await newD.count()]
    const v = rowCountVerdict(oc, nc, skipped.get(exTable) ?? 0)
    reports.push({ label, status: v.status, detail: v.detail })
  }

  // B 类：info 展示（拆/并/合成导致行数不严格相等）
  const caseMaterialsOld = await legacy.caseMaterials.count()
  const caseMaterialsNew = await next.caseMaterials.count()
  reports.push({
    label: 'case_materials（B 类）',
    status: 'info',
    detail: `旧 ${caseMaterialsOld} / 新 ${caseMaterialsNew}（跳过 type=5 视频 + 外键失配）`,
  })
  const textNew = await next.textContentRecords.count()
  const textTypeOneOld = await legacy.caseMaterials.count({ where: { type: 1 } })
  reports.push({
    label: 'text_content_records（B 类衍生）',
    status: 'info',
    detail: `新 ${textNew} ≈ 旧 type=1 材料 ${textTypeOneOld}`,
  })
  const ordersOld = await legacy.paymentOrders.count()
  const ordersNew = await next.orders.count()
  reports.push({
    label: 'orders（B 类）',
    status: 'info',
    detail: `旧 payment_orders ${ordersOld} / 新 orders ${ordersNew}`,
  })
  const txOld = await legacy.paymentTransactions.count()
  const txNew = await next.paymentTransactions.count()
  reports.push({
    label: 'payment_transactions（B 类，含合成行）',
    status: 'info',
    detail: `旧 ${txOld} / 新 ${txNew}（新 = 旧迁移 + 合成补充）`,
  })

  log('--- 行数校验 ---')
  for (const r of reports) {
    const line = `[${r.status.toUpperCase()}] ${r.label} — ${r.detail}`
    if (r.status === 'mismatch') warn(line)
    else log(line)
  }
  return reports
}
```

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/verify/rowCounts.ts
git commit -m "$(cat <<'EOF'
feat(migration): 迁移后行数校验
EOF
)"
```

---

## Task 3: 业务聚合、抽样、引用完整性校验

**Files:**
- Create: `legacy-migration/src/verify/aggregates.ts`
- Create: `legacy-migration/src/verify/samples.ts`
- Create: `legacy-migration/src/verify/references.ts`

设计文档 §13 校验 2/3/4。均 DB 绑定，由 Task 6 冒烟验证。

- [ ] **Step 1: 实现 `aggregates.ts`**

```ts
import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import { log, warn } from '../logger'

export interface AggregateReport {
  label: string
  status: 'ok' | 'mismatch'
  detail: string
}

/** 关键业务聚合值新旧一致性（设计文档 §13 校验 4） */
export async function verifyAggregates(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
): Promise<AggregateReport[]> {
  const reports: AggregateReport[] = []

  // 1. 订单总金额（旧 payment_orders.amount 之和 vs 新 orders.amount 之和）
  const oldAmount = await legacy.paymentOrders.aggregate({ _sum: { amount: true } })
  const newAmount = await next.orders.aggregate({ _sum: { amount: true } })
  const oa = Number(oldAmount._sum.amount ?? 0)
  const na = Number(newAmount._sum.amount ?? 0)
  reports.push({
    label: '订单总金额',
    status: oa === na ? 'ok' : 'mismatch',
    detail: `旧 ${oa} / 新 ${na}（若有订单因 productId 无法确定被跳过则会不等，对照异常清单）`,
  })

  // 2. 积分剩余总量（point_records.remaining 之和）
  const oldRemain = await legacy.pointRecords.aggregate({ _sum: { remaining: true } })
  const newRemain = await next.pointRecords.aggregate({ _sum: { remaining: true } })
  const or = Number(oldRemain._sum.remaining ?? 0)
  const nr = Number(newRemain._sum.remaining ?? 0)
  reports.push({
    label: '积分剩余总量',
    status: or === nr ? 'ok' : 'mismatch',
    detail: `旧 ${or} / 新 ${nr}`,
  })

  // 3. 案件分析记录总数（应等于行数校验里的 case_analyses）
  const oldAnalyses = await legacy.caseAnalyses.count()
  const newAnalyses = await next.caseAnalyses.count()
  reports.push({
    label: '案件分析记录数',
    status: oldAnalyses >= newAnalyses ? 'ok' : 'mismatch',
    detail: `旧 ${oldAnalyses} / 新 ${newAnalyses}（新 ≤ 旧；差额为 analysisType 无匹配节点而跳过的）`,
  })

  log('--- 业务聚合校验 ---')
  for (const r of reports) {
    const line = `[${r.status.toUpperCase()}] ${r.label} — ${r.detail}`
    if (r.status === 'mismatch') warn(line)
    else log(line)
  }
  return reports
}
```

- [ ] **Step 2: 实现 `samples.ts`**

```ts
import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import { log, warn } from '../logger'

export interface SampleReport {
  label: string
  status: 'ok' | 'mismatch'
  detail: string
}

/** 在 [1, maxId] 内取 n 个随机 id */
function pickIds(maxId: number, n: number): number[] {
  const ids = new Set<number>()
  while (ids.size < Math.min(n, maxId)) {
    ids.add(1 + Math.floor(Math.random() * maxId))
  }
  return [...ids]
}

/**
 * 抽样内容校验（设计文档 §13 校验 3）：对 users / cases 抽样，
 * 逐字段比对旧→新关键字段是否符合转换规则。
 */
export async function verifySamples(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  sampleSize = 20,
): Promise<SampleReport[]> {
  const reports: SampleReport[] = []

  // users：phone / name 直拷应一致
  const userMax = (await legacy.users.aggregate({ _max: { id: true } }))._max.id ?? 0
  let userMismatch = 0
  for (const id of pickIds(userMax, sampleSize)) {
    const o = await legacy.users.findUnique({ where: { id } })
    if (!o) continue
    const n = await next.users.findUnique({ where: { id } })
    if (!n || n.phone !== o.phone || n.name !== o.name) userMismatch++
  }
  reports.push({
    label: `users 抽样（${sampleSize} 条）`,
    status: userMismatch === 0 ? 'ok' : 'mismatch',
    detail: userMismatch === 0 ? 'phone/name 全部一致' : `${userMismatch} 条不一致`,
  })

  // cases：title 直拷一致、stance 应为默认 'plaintiff'
  const caseMax = (await legacy.cases.aggregate({ _max: { id: true } }))._max.id ?? 0
  let caseMismatch = 0
  for (const id of pickIds(caseMax, sampleSize)) {
    const o = await legacy.cases.findUnique({ where: { id } })
    if (!o) continue
    const n = await next.cases.findUnique({ where: { id } })
    // 旧 case 可能因 caseTypeId 无法重映射被跳过——新库无此行属正常，不计 mismatch
    if (n && (n.title !== o.title || n.stance !== 'plaintiff')) caseMismatch++
  }
  reports.push({
    label: `cases 抽样（${sampleSize} 条）`,
    status: caseMismatch === 0 ? 'ok' : 'mismatch',
    detail: caseMismatch === 0 ? 'title 一致、stance 为默认值' : `${caseMismatch} 条不一致`,
  })

  log('--- 抽样内容校验 ---')
  for (const r of reports) {
    const line = `[${r.status.toUpperCase()}] ${r.label} — ${r.detail}`
    if (r.status === 'mismatch') warn(line)
    else log(line)
  }
  return reports
}
```

- [ ] **Step 3: 实现 `references.ts`**

```ts
import type { NewPrismaClient } from '../clients'
import { log, warn } from '../logger'

export interface ReferenceReport {
  label: string
  status: 'ok' | 'warn'
  detail: string
}

/**
 * 非外键约束引用的完整性校验（设计文档 §13 校验 2）。
 * 新库 DB 外键约束已保证带 FK 的引用不悬空；此处只查"无 FK 约束的引用列"：
 * text_content_records.materialId / caseId、recognition 表的 ossFileId。
 */
export async function verifyReferences(next: NewPrismaClient): Promise<ReferenceReport[]> {
  const reports: ReferenceReport[] = []

  // text_content_records.materialId 应都能在 case_materials 找到
  const orphanText = await next.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*)::bigint AS n FROM text_content_records t
    LEFT JOIN case_materials m ON m.id = t.material_id
    WHERE t.material_id IS NOT NULL AND m.id IS NULL
  `)
  const orphanTextN = Number(orphanText[0]?.n ?? 0)
  reports.push({
    label: 'text_content_records.materialId 引用',
    status: orphanTextN === 0 ? 'ok' : 'warn',
    detail: `悬空 ${orphanTextN} 行`,
  })

  // 识别记录的 ossFileId 应都能在 oss_files 找到（无 FK 约束）
  for (const t of ['doc_recognition_records', 'image_recognition_records', 'asr_records']) {
    const r = await next.$queryRawUnsafe<{ n: bigint }[]>(`
      SELECT count(*)::bigint AS n FROM "${t}" x
      LEFT JOIN oss_files f ON f.id = x.oss_file_id
      WHERE x.oss_file_id IS NOT NULL AND f.id IS NULL
    `)
    const n = Number(r[0]?.n ?? 0)
    reports.push({
      label: `${t}.ossFileId 引用`,
      status: n === 0 ? 'ok' : 'warn',
      detail: `悬空 ${n} 行`,
    })
  }

  log('--- 引用完整性校验 ---')
  for (const r of reports) {
    const line = `[${r.status.toUpperCase()}] ${r.label} — ${r.detail}`
    if (r.status === 'warn') warn(line)
    else log(line)
  }
  return reports
}
```

- [ ] **Step 4: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/verify/aggregates.ts legacy-migration/src/verify/samples.ts legacy-migration/src/verify/references.ts
git commit -m "$(cat <<'EOF'
feat(migration): 业务聚合、抽样、引用完整性校验
EOF
)"
```

---

## Task 4: verify 汇总与命令接入

**Files:**
- Create: `legacy-migration/src/verify/index.ts`
- Modify: `legacy-migration/src/index.ts`（加 `verify` 命令）

- [ ] **Step 1: 实现 `verify/index.ts`**

```ts
import { writeFileSync } from 'node:fs'
import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import { log } from '../logger'
import { verifyAggregates } from './aggregates'
import { verifyReferences } from './references'
import { verifyRowCounts } from './rowCounts'
import { verifySamples } from './samples'

/** 跑全部四类校验，汇总报告并落盘 */
export async function runVerify(legacy: LegacyPrismaClient, next: NewPrismaClient): Promise<void> {
  log('===== 迁移后数据校验开始 =====')
  const rowCounts = await verifyRowCounts(legacy, next, 'legacy-migration/reports/exceptions.csv')
  const aggregates = await verifyAggregates(legacy, next)
  const samples = await verifySamples(legacy, next)
  const references = await verifyReferences(next)

  const all = [
    ...rowCounts.map(r => ({ ...r, group: '行数' })),
    ...aggregates.map(r => ({ ...r, group: '聚合' })),
    ...samples.map(r => ({ ...r, group: '抽样' })),
    ...references.map(r => ({ ...r, group: '引用' })),
  ]
  const problems = all.filter(r => r.status === 'mismatch' || r.status === 'warn')

  const reportPath = 'legacy-migration/reports/verify.json'
  writeFileSync(reportPath, JSON.stringify(all, null, 2), 'utf8')
  log(`===== 校验完成：${all.length} 项，${problems.length} 项需关注，报告见 ${reportPath} =====`)
  if (problems.length > 0) {
    log('需关注项：')
    for (const p of problems) log(`  [${p.group}] ${p.label} — ${p.detail}`)
  }
}
```

- [ ] **Step 2: 在 `index.ts` 加 `verify` 命令**

在 `legacy-migration/src/index.ts` 的 import 区加 `import { runVerify } from './verify/index'`，新增命令函数并在 `switch` 中注册：

```ts
async function cmdVerify(): Promise<void> {
  const cfg = loadConfig()
  const legacy = createLegacyClient(cfg.legacyDatabaseUrl)
  const next = createNewClient(cfg.newDatabaseUrl)
  try {
    await runVerify(legacy, next)
  } finally {
    await legacy.$disconnect()
    await next.$disconnect()
  }
}
```

`switch` 内加 `case 'verify': await cmdVerify(); break`，并把 `default` 的提示更新为 `可用命令：preflight、migrate、verify`。

- [ ] **Step 3: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/verify/index.ts legacy-migration/src/index.ts
git commit -m "$(cat <<'EOF'
feat(migration): verify 校验汇总与命令接入
EOF
)"
```

---

## Task 5: 案件材料向量重嵌入接入

**Files:**
- Create: `legacy-migration/src/reembed.ts`（按调研结果二选一实现）
- Modify: `legacy-migration/src/index.ts`（加 `reembed` 命令）

设计文档 §11：迁移后案件材料需重新生成向量。迁移已把 `text_content_records` / `doc_recognition_records` / `image_recognition_records` / `asr_records` 的 `vectorIds` 置 `[]`、`lastEmbeddingAt` 置 `null`，即"待嵌入"标记。

- [ ] **Step 1: 调研新项目既有嵌入能力**

查以下位置，确认新项目是否已有"按 `lastEmbeddingAt` 为空批量补嵌入材料"的能力：

```bash
ls server/scripts/
grep -rl "lastEmbeddingAt" server/services/retrieval server/services/material 2>/dev/null
grep -rln "case_material_embeddings\|caseMaterialEmbeddings" server/services 2>/dev/null
```

- 已知 `server/scripts/rebuildLawEmbeddings.ts` 存在（重建法条向量）。确认是否有材料侧的等价脚本，或材料处理服务是否提供可复用的"嵌入单条材料"函数。

- [ ] **Step 2A: 若新项目已有材料批量嵌入脚本/能力**

不在 `legacy-migration/` 内重复实现。改为在工具 README 的切换 runbook 中记录："迁移后执行 `<新项目的材料重嵌入命令>` 对 `lastEmbeddingAt IS NULL` 的材料补嵌入"。`reembed.ts` 仅写一个薄封装，调用该能力；或直接在 README 注明命令、跳过本文件。

- [ ] **Step 2B: 若新项目无现成批量能力**

实现 `legacy-migration/src/reembed.ts`：分页读取 `text_content_records` / `doc_recognition_records` / `image_recognition_records` / `asr_records` 中 `lastEmbeddingAt IS NULL` 的记录，调用新项目材料处理服务暴露的"嵌入单条材料/文本"函数（按 Step 1 调研到的实际接口），写入 `case_material_embeddings`，并回填该记录的 `vectorIds` / `lastEmbeddingAt`。分批、可重跑（`lastEmbeddingAt` 非空即已处理，天然幂等）。

> 具体函数签名以 Step 1 调研到的新项目接口为准——该接口属新项目既有代码，本计划不重复定义其内部实现。

- [ ] **Step 3: 在 `index.ts` 加 `reembed` 命令（若走 2B）**

参照 `cmdVerify` 模式新增 `cmdReembed`，`switch` 注册 `case 'reembed'`，`default` 提示加 `reembed`。

- [ ] **Step 4: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/reembed.ts legacy-migration/src/index.ts
git commit -m "$(cat <<'EOF'
feat(migration): 案件材料向量重嵌入接入
EOF
)"
```

> 若走 2A 且未新增 `reembed.ts`，本任务仅提交 README 改动（并入 Task 6）。

---

## Task 6: 切换 runbook 固化 + 全量测试

**Files:**
- Modify: `legacy-migration/README.md`

- [ ] **Step 1: 跑全部单元测试**

Run: `npx vitest run --config legacy-migration/vitest.config.ts`
Expected: PASS（计划一、二、三的全部用例）。

- [ ] **Step 2: 类型检查整个工具**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: 把切换 runbook 写入 README**

在 `legacy-migration/README.md` 追加"切换流程"小节，内容对齐设计文档 §14：

```markdown
## 切换流程（蓝绿切换，停写窗口 1-2 小时）

### 演练阶段（上线前，可反复）
1. 用旧库生产备份恢复出测试库。
2. `npx tsx legacy-migration/src/index.ts preflight` — 处理扫描出的 warn 项。
3. `npx tsx legacy-migration/src/index.ts migrate` — 跑迁移。
4. `npx tsx legacy-migration/src/index.ts verify` — 校验。
5. 核对异常清单与校验报告，迭代脚本，重复至干净。

### 正式切换
1. 旧系统停写（设为只读或挂维护页）。
2. 备份旧库快照（回滚兜底）。
3. 新库：`prisma migrate deploy` + 导入 seedData.sql（剔除 users / user_roles 两表的 INSERT）+ 跑 seed.ts。
4. 配置 `.env`：`LEGACY_DATABASE_URL`、`DATABASE_URL`、`MIGRATION_ADMIN_ROLE_ID`；填好 `src/adminRoles.ts` 的 `ADMIN_BINDINGS`。
5. `migrate` → `verify`。
6. 向量重嵌入（可与冒烟并行，未完成期间历史材料暂不可语义检索）。
7. 冒烟测试新系统关键路径（登录 / 看案件 / 看订单 / 看会员 / 看材料）。
8. 校验 + 冒烟通过 → 切域名到新版、开放写入；不通过 → 回滚（域名切回旧版、旧系统恢复写入）。

### 清理（上线稳定后）
- 删除 `legacy-migration/` 目录。
- 删除新库 `_migration_progress` 表。
- 移除 `.env` 中的 `LEGACY_DATABASE_URL`、`MIGRATION_ADMIN_ROLE_ID`。
```

- [ ] **Step 4: 提交**

```bash
git add legacy-migration/README.md
git commit -m "$(cat <<'EOF'
docs(migration): 固化蓝绿切换 runbook
EOF
)"
```

- [ ] **Step 5: verify 冒烟运行**

在计划二 Task 15 冒烟迁移过的环境上跑：

Run: `npx tsx legacy-migration/src/index.ts verify`
Expected: 打印四类校验结果，`legacy-migration/reports/verify.json` 生成；mismatch / warn 项应能与异常清单一一对应解释。

---

## 自审记录

- **设计文档覆盖**：本计划实现 §13（四类校验 → verify 命令）、§11（向量重嵌入接入）、§14（切换 runbook 固化到 README）。至此设计文档全部章节均有对应实现：§5–§6、§16 在计划一，§7–§10、§12 在计划二，§11、§13、§14 在计划三。
- **占位符扫描**：无 TBD/TODO。Task 5 是"先调研新项目既有能力、再二选一实现"——调研步骤含明确的检查命令，分支处置明确，非空泛占位（向量重嵌入本身依赖新项目嵌入服务的既有接口，不应在迁移工具内重造）。
- **类型一致性**：`parseExceptionCounts`/`rowCountVerdict` 在 `verify/helpers.ts` 定义并被 `rowCounts.ts` 使用；各 verify 子模块的 `*Report` 类型在各自文件定义、在 `verify/index.ts` 汇总；`runVerify` 接入 `index.ts` 与 `cmdMigrate`/`cmdPreflight` 同构。
- **范围**：本计划完成后，`legacy-migration` 工具具备 `preflight` / `migrate` / `verify`（及可选 `reembed`）全部命令，可支撑设计文档 §14 的完整演练与正式切换。
