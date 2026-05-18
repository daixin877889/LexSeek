# 历史数据迁移 · 计划二：逐表迁移与编排 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在计划一的基础设施之上，实现 22 张表的转换函数与迁移器、配置外键重映射加载、外键预校验登记、`migrate` 编排命令，完成全量数据迁移。

**Architecture:** 每张表 = 一个纯转换函数（`src/transforms/`，单元测试）+ 一个迁移器规格（`src/migrators/`，复用计划一的 `runMigration`）。配置外键经 `idRemapLoader` 在迁移开始时构建 `旧ID→新ID` 映射；业务外键经 `FkRegistry` 在子表写入前预校验。`orchestrator` 按设计文档 §7 的阶段顺序串起所有迁移器，并做序列重置与管理员角色补绑。

**Tech Stack:** TypeScript、Prisma 7.7、vitest 4。

**依据：** 设计文档 `docs/superpowers/specs/2026-05-17-legacy-data-migration-design.md`（§7 顺序、§8 逐表转换规则、§9 兜底、§10 重映射、§6.4 角色衍生）。本计划是 3 个计划中的第 2 个。计划一（基础设施 + preflight）须先完成。

**前置约定：**
- 转换函数输入类型来自 Task 2 生成的 legacy client 的模型类型，统一在 `src/legacyTypes.ts` 中 re-export（导出路径以生成产物实际结构为准，通常是 `legacy-client/models`）。
- 转换函数输出对象由各迁移器的 `createMany` 按新库 Prisma 类型做编译期校验——字段写错 `tsc` 会报错。
- 设计文档 §8 的"时间戳兜底"由 `src/transforms/helpers.ts` 的 `tsFallback` 统一处理。

---

## 文件结构

```
legacy-migration/src/
├── legacyTypes.ts          re-export legacy client 模型类型
├── transforms/
│   ├── helpers.ts          时间戳兜底、枚举映射、占位值
│   ├── user.ts             transformUser、deriveUserRoles
│   ├── case.ts             transformCase、transformCaseSession
│   ├── membership.ts       transformUserMembership、transformMembershipUpgradeRecord
│   ├── point.ts            transformPointRecord、transformPointConsumptionRecord
│   ├── benefit.ts          transformUserBenefit
│   ├── redemption.ts       transformRedemptionCode、transformRedemptionRecord
│   ├── file.ts             transformOssFile
│   ├── recognition.ts      transformAsrTask/Record、transformDoc/ImageRecognition
│   ├── system.ts           transformSystemConfig
│   ├── caseMaterial.ts     mapCaseMaterial、mapTextContentRecord（B 类）
│   ├── caseAnalysis.ts     mapCaseAnalysis（B 类）
│   └── payment.ts          mapOrder、mapPaymentTransaction、synthesizeTransaction（B 类）
├── idRemapLoader.ts        构建 6 张配置表的 旧→新 ID 映射
├── fkRegistry.ts           已迁移父表 ID 登记 + 外键预校验
├── migrators/              各表 MigratorSpec 装配（按域分文件）
│   └── index.ts            导出全部迁移器
├── adminRoles.ts           管理员角色补绑
├── orchestrator.ts         按阶段编排全部迁移 + 序列重置 + 角色补绑
└── index.ts                CLI（计划一已建，本计划加 migrate 命令）
└── tests/transforms/       每个 transform 文件对应一个测试
```

---

## Task 1: legacy 类型 re-export 与转换辅助

**Files:**
- Create: `legacy-migration/src/legacyTypes.ts`
- Create: `legacy-migration/src/transforms/helpers.ts`
- Test: `legacy-migration/tests/transforms/helpers.test.ts`

- [ ] **Step 1: 创建 `legacyTypes.ts`**

re-export 全部需要的旧库模型类型。导出路径以 `legacy-client` 生成产物为准——先 `ls legacy-migration/legacy-client/` 确认模型类型文件（Prisma 7 `prisma-client` 生成器通常产出 `models.ts` 或 `models/` 目录）。

```ts
// legacy-client 的 prisma-client 生成器把每个模型导出为 `<model>Model` 类型。
import type * as Legacy from '../legacy-client/models'

export type LUser = Legacy.usersModel
export type LCase = Legacy.casesModel
export type LCaseSession = Legacy.caseSessionsModel
export type LCaseMaterial = Legacy.caseMaterialsModel
export type LCaseAnalysis = Legacy.caseAnalysesModel
export type LUserMembership = Legacy.userMembershipsModel
export type LMembershipUpgradeRecord = Legacy.membershipUpgradeRecordsModel
export type LPointRecord = Legacy.pointRecordsModel
export type LPointConsumptionRecord = Legacy.pointConsumptionRecordsModel
export type LUserBenefit = Legacy.userBenefitsModel
export type LRedemptionCode = Legacy.redemptionCodesModel
export type LRedemptionRecord = Legacy.redemptionRecordsModel
export type LOssFile = Legacy.ossFilesModel
export type LAsrTask = Legacy.asrTasksModel
export type LAsrRecord = Legacy.asrRecordsModel
export type LDocRecognition = Legacy.docRecognitionRecordsModel
export type LImageRecognition = Legacy.imageRecognitionRecordsModel
export type LSystemConfig = Legacy.systemConfigsModel
export type LPaymentOrder = Legacy.paymentOrdersModel
export type LPaymentTransaction = Legacy.paymentTransactionsModel
```

- [ ] **Step 2: 写 `helpers.test.ts` 失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { mapUserBenefitSourceType, tsFallback } from '../../src/transforms/helpers'

describe('tsFallback', () => {
  const now = new Date('2026-05-17T00:00:00Z')
  it('createdAt 为空时回退 updatedAt', () => {
    const r = tsFallback(null, new Date('2025-01-01T00:00:00Z'), now)
    expect(r.createdAt).toEqual(new Date('2025-01-01T00:00:00Z'))
  })
  it('两者都空时回退迁移时刻', () => {
    const r = tsFallback(null, null, now)
    expect(r.createdAt).toEqual(now)
    expect(r.updatedAt).toEqual(now)
  })
  it('updatedAt 为空时回退 createdAt', () => {
    const r = tsFallback(new Date('2025-02-02T00:00:00Z'), null, now)
    expect(r.updatedAt).toEqual(new Date('2025-02-02T00:00:00Z'))
  })
})

describe('mapUserBenefitSourceType', () => {
  it('按对照表把旧数字码映射为新字符串枚举', () => {
    expect(mapUserBenefitSourceType(1)).toBe('membership_gift')
    expect(mapUserBenefitSourceType(99)).toBe('admin_gift')
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/helpers.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `helpers.ts`**

```ts
/** 时间戳兜底：设计文档 §8 跨表通用规则 */
export function tsFallback(
  createdAt: Date | null | undefined,
  updatedAt: Date | null | undefined,
  migratedAt: Date,
): { createdAt: Date; updatedAt: Date } {
  const c = createdAt ?? updatedAt ?? migratedAt
  const u = updatedAt ?? createdAt ?? migratedAt
  return { createdAt: c, updatedAt: u }
}

/**
 * user_benefits.sourceType：旧 Int → 新 String 枚举。
 * 对照表在演练阶段查旧项目代码核对（设计文档 §9 枚举映射表）；
 * 此处为初版假设，若 preflight/演练发现不符须修正。
 */
const USER_BENEFIT_SOURCE_TYPE: Record<number, string> = {
  1: 'membership_gift',
  2: 'benefit_package',
  3: 'redemption_code',
  99: 'admin_gift',
}
export function mapUserBenefitSourceType(old: number): string {
  return USER_BENEFIT_SOURCE_TYPE[old] ?? 'admin_gift'
}

/**
 * payment_transactions.paymentMethod：旧 paymentWay Int → 新 String。
 * 1-JSAPI→mini_program，2-H5→wap，3-APP→app（演练阶段核对）。
 */
const PAYMENT_METHOD: Record<number, string> = { 1: 'mini_program', 2: 'wap', 3: 'app' }
export function mapPaymentMethod(old: number): string {
  return PAYMENT_METHOD[old] ?? 'mini_program'
}

/** payment paymentType Int → paymentChannel String */
export function mapPaymentChannel(old: number): string {
  return old === 2 ? 'alipay' : 'wechat'
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/helpers.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 6: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/legacyTypes.ts legacy-migration/src/transforms/helpers.ts legacy-migration/tests/transforms/helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): legacy 类型 re-export 与转换辅助函数
EOF
)"
```

---

## Task 2: 配置外键重映射加载 idRemapLoader.ts

**Files:**
- Create: `legacy-migration/src/idRemapLoader.ts`

读旧+新两边的 6 张配置表，用计划一的 `buildRemap` 构建映射。DB 绑定，由 Task 15 冒烟验证。

- [ ] **Step 1: 实现 `idRemapLoader.ts`**

```ts
import { buildRemap, type Remap } from './idRemap'
import type { LegacyPrismaClient, NewPrismaClient } from './clients'
import { warn } from './logger'

export interface ConfigRemaps {
  caseTypes: Remap
  membershipLevels: Remap
  products: Remap
  nodes: Remap
  pointConsumptionItems: Remap
  benefits: Remap
}

/** 读旧+新配置表，按 name 构建全部重映射；打印失配项 */
export async function loadConfigRemaps(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
): Promise<ConfigRemaps> {
  const byName = (r: { name: string }) => r.name

  const caseTypes = buildRemap(
    await legacy.caseType.findMany({ select: { id: true, name: true } }),
    await next.caseTypes.findMany({ select: { id: true, name: true } }),
    byName,
  )
  const membershipLevels = buildRemap(
    await legacy.membershipLevels.findMany({ select: { id: true, name: true } }),
    await next.membershipLevels.findMany({ select: { id: true, name: true } }),
    byName,
  )
  const products = buildRemap(
    await legacy.products.findMany({ select: { id: true, name: true } }),
    await next.products.findMany({ select: { id: true, name: true } }),
    byName,
  )
  // 旧 analysis_modules 的 name → 新 nodes 的 name
  const nodes = buildRemap(
    await legacy.analysisModules.findMany({ select: { id: true, name: true } }),
    await next.nodes.findMany({ select: { id: true, name: true } }),
    byName,
  )
  const pointConsumptionItems = buildRemap(
    await legacy.pointConsumptionItems.findMany({ select: { id: true, name: true } }),
    await next.pointConsumptionItems.findMany({ select: { id: true, name: true } }),
    byName,
  )
  const benefits = buildRemap(
    await legacy.benefits.findMany({ select: { id: true, name: true } }),
    await next.benefits.findMany({ select: { id: true, name: true } }),
    byName,
  )

  const remaps = { caseTypes, membershipLevels, products, nodes, pointConsumptionItems, benefits }
  for (const [name, r] of Object.entries(remaps)) {
    const unmatched = r.unmatchedOldIds()
    if (unmatched.length > 0) warn(`[idRemap] ${name} 有 ${unmatched.length} 个旧 ID 在新库无对应：${unmatched.join(',')}`)
  }
  return remaps
}
```

> `case_analyses.nodeId` 的回填用旧 `analysisType`（字符串）直接匹配新 `nodes.name`，由 `caseAnalysis` 迁移器单独处理（见 Task 11），不走 `nodes` Remap 的旧 ID 通道。这里的 `nodes` Remap 备而不用，保留以防后续需要。

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/idRemapLoader.ts
git commit -m "$(cat <<'EOF'
feat(migration): 配置外键重映射加载器
EOF
)"
```

---

## Task 3: 外键预校验登记 fkRegistry.ts

**Files:**
- Create: `legacy-migration/src/fkRegistry.ts`
- Test: `legacy-migration/tests/fkRegistry.test.ts`

记录每张父表已成功迁移的旧 ID，供子表迁移器写入前预校验（设计文档 §12 业务外键预校验）。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/fkRegistry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FkRegistry } from '../src/fkRegistry'

describe('FkRegistry', () => {
  it('登记并查询父表已迁移 ID', () => {
    const reg = new FkRegistry()
    reg.record('users', new Set([1, 2, 3]))
    expect(reg.has('users', 2)).toBe(true)
    expect(reg.has('users', 9)).toBe(false)
  })
  it('未登记的表查询返回 false', () => {
    const reg = new FkRegistry()
    expect(reg.has('cases', 1)).toBe(false)
  })
  it('requireAll：全部存在返回 null，缺失返回原因', () => {
    const reg = new FkRegistry()
    reg.record('users', new Set([1]))
    reg.record('cases', new Set([10]))
    expect(reg.requireAll([['users', 1], ['cases', 10]])).toBeNull()
    expect(reg.requireAll([['users', 1], ['cases', 99]])).toMatch(/cases#99/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/fkRegistry.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `fkRegistry.ts`**

```ts
export class FkRegistry {
  private tables = new Map<string, Set<number>>()

  /** 登记某父表本次运行成功迁移的旧 ID 集合 */
  record(table: string, ids: Set<number>): void {
    const existing = this.tables.get(table)
    if (existing) for (const id of ids) existing.add(id)
    else this.tables.set(table, new Set(ids))
  }

  /** 某父表是否含该旧 ID */
  has(table: string, id: number): boolean {
    return this.tables.get(table)?.has(id) ?? false
  }

  /**
   * 校验一组外键引用是否全部存在。
   * 全部存在返回 null；任一缺失返回缺失原因字符串（供异常清单）。
   */
  requireAll(refs: [table: string, id: number][]): string | null {
    const missing = refs.filter(([t, id]) => !this.has(t, id)).map(([t, id]) => `${t}#${id}`)
    return missing.length === 0 ? null : `父行缺失：${missing.join('、')}`
  }
}
```

- [ ] **Step 4: 跑测试确认通过 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/fkRegistry.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/fkRegistry.ts legacy-migration/tests/fkRegistry.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): 外键预校验登记表
EOF
)"
```

---

## Task 4: A 类转换 — 用户域（users + user_roles 衍生）

**Files:**
- Create: `legacy-migration/src/transforms/user.ts`
- Test: `legacy-migration/tests/transforms/user.test.ts`

实现设计文档 §8.1 `users` 行 + §6.4 角色衍生。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/transforms/user.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deriveUserRoles, transformUser } from '../../src/transforms/user'
import type { LUser } from '../../src/legacyTypes'

const base = {
  id: 1, name: '张三', username: 'zhangsan', email: null, phone: '13800000000',
  password: 'hash', role: 'user', status: 1, company: null, profile: null,
  inviteCode: 'ABC123', invitedBy: null, openid: null, unionid: null,
  registerChannel: 'web', apiKey: 'uuid',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-02T00:00:00Z'),
  deletedAt: null,
} as unknown as LUser

describe('transformUser', () => {
  it('直拷字段、丢弃 role/apiKey、contractExportSignature 置 null', () => {
    const r = transformUser(base)
    expect(r.id).toBe(1)
    expect(r.phone).toBe('13800000000')
    expect(r.inviteCode).toBe('ABC123')
    expect(r.contractExportSignature).toBeNull()
    expect('role' in r).toBe(false)
    expect('apiKey' in r).toBe(false)
  })
})

describe('deriveUserRoles', () => {
  it('role=admin 衍生一条 user_roles，绑定传入的 adminRoleId', () => {
    const rows = deriveUserRoles({ ...base, role: 'admin' } as LUser, 2)
    expect(rows).toEqual([{ userId: 1, roleId: 2 }])
  })
  it('role=user 不衍生', () => {
    expect(deriveUserRoles(base, 2)).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/user.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `user.ts`**

```ts
import type { LUser } from '../legacyTypes'

/** §8.1 users：直拷大部分字段，丢弃 role/apiKey，新增 contractExportSignature=null */
export function transformUser(o: LUser) {
  return {
    id: o.id,
    name: o.name,
    username: o.username,
    email: o.email,
    phone: o.phone,
    password: o.password,
    status: o.status,
    company: o.company,
    profile: o.profile,
    contractExportSignature: null,
    inviteCode: o.inviteCode,
    invitedBy: o.invitedBy,
    openid: o.openid,
    unionid: o.unionid,
    registerChannel: o.registerChannel,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §6.4：旧 role='admin' → 衍生一条 user_roles，绑定 adminRoleId；其余不衍生 */
export function deriveUserRoles(o: LUser, adminRoleId: number): { userId: number; roleId: number }[] {
  return o.role === 'admin' ? [{ userId: o.id, roleId: adminRoleId }] : []
}
```

> `users` 的 `createdAt/updatedAt` 新库为可空，直拷即可，不需 `tsFallback`。

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/user.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/transforms/user.ts legacy-migration/tests/transforms/user.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): users 转换与 user_roles 衍生
EOF
)"
```

---

## Task 5: A 类转换 — 案件域（cases、case_sessions）

**Files:**
- Create: `legacy-migration/src/transforms/case.ts`
- Test: `legacy-migration/tests/transforms/case.test.ts`

实现设计文档 §8.1 `cases`、`case_sessions` 行。`cases.caseTypeId` 走配置重映射；`case_sessions.userId` 由迁移器从关联 case 反查后传入。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/transforms/case.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { transformCase, transformCaseSession } from '../../src/transforms/case'
import type { LCase, LCaseSession } from '../../src/legacyTypes'

const ts = { createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2025-01-02T00:00:00Z'), deletedAt: null }

describe('transformCase', () => {
  const oldCase = {
    id: 7, title: '案件', content: '内容', userId: 1, caseTypeId: 2,
    plaintiff: null, defendant: null, caseNumber: '(2025)001', status: 1,
    completedAt: null, closedAt: null, ...ts,
  } as unknown as LCase

  it('caseTypeId 经重映射，丢弃 caseNumber/completedAt/closedAt，新增字段填默认', () => {
    const r = transformCase(oldCase, 50)
    expect(r).not.toBeNull()
    expect(r!.caseTypeId).toBe(50)
    expect(r!.isDemo).toBe(false)
    expect(r!.stance).toBe('plaintiff')
    expect(r!.summary).toBeNull()
    expect('caseNumber' in r!).toBe(false)
  })
  it('caseTypeId 重映射失败（传 null）返回 null（由迁移器跳过/兜底）', () => {
    expect(transformCase(oldCase, null)).toBeNull()
  })
})

describe('transformCaseSession', () => {
  it('scope=case、status=2、type=1，userId 取传入的反查值', () => {
    const oldSession = { id: 3, caseId: 7, sessionId: 'sess-1', ...ts } as unknown as LCaseSession
    const r = transformCaseSession(oldSession, 1)
    expect(r.scope).toBe('case')
    expect(r.status).toBe(2)
    expect(r.type).toBe(1)
    expect(r.userId).toBe(1)
    expect(r.caseId).toBe(7)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/case.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `case.ts`**

```ts
import type { LCase, LCaseSession } from '../legacyTypes'

/**
 * §8.1 cases：caseTypeId 走配置重映射（newCaseTypeId 由迁移器传入）。
 * 重映射失败时返回 null，迁移器据此跳过或兜底。
 */
export function transformCase(o: LCase, newCaseTypeId: number | null) {
  if (newCaseTypeId === null) return null
  return {
    id: o.id,
    title: o.title,
    content: o.content,
    userId: o.userId,
    caseTypeId: newCaseTypeId,
    plaintiff: o.plaintiff ?? undefined,
    defendant: o.defendant ?? undefined,
    summary: null,
    extractedInfo: undefined,
    courtName: null,
    firstInstanceCaseNo: null,
    secondInstanceCaseNo: null,
    firstInstanceJudge: null,
    secondInstanceJudge: null,
    status: o.status,
    isDemo: false,
    stance: 'plaintiff',
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.1 case_sessions：scope=case、status=2（已完成）、type=1。
 * userId 由迁移器从关联 case 反查后传入（旧 case_sessions 无 userId）。
 */
export function transformCaseSession(o: LCaseSession, caseUserId: number | null) {
  return {
    id: o.id,
    sessionId: o.sessionId,
    scope: 'case',
    userId: caseUserId,
    caseId: o.caseId,
    status: 2,
    type: 1,
    title: null,
    metadata: undefined,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

> Prisma 的 `Json?` 字段：传 `undefined` 表示不写（取 DB null）；旧值存在时传旧值。`plaintiff/defendant` 旧值可能为 null，`?? undefined` 规避 Prisma `JsonNull` 区分问题。

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/case.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/transforms/case.ts legacy-migration/tests/transforms/case.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): cases 与 case_sessions 转换
EOF
)"
```

---

## Task 6: A 类转换 — 会员交易域

**Files:**
- Create: `legacy-migration/src/transforms/membership.ts`、`point.ts`、`benefit.ts`、`redemption.ts`
- Test: 对应 4 个测试文件

实现设计文档 §8.1 的 `user_memberships`、`membership_upgrade_records`、`point_records`、`point_consumption_records`、`user_benefits`、`redemption_codes`、`redemption_records`。

- [ ] **Step 1: 写 `tests/transforms/membership.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { transformMembershipUpgradeRecord, transformUserMembership } from '../../src/transforms/membership'
import type { LMembershipUpgradeRecord, LUserMembership } from '../../src/legacyTypes'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformUserMembership', () => {
  it('levelId 重映射，sourceType 为 null 兜底 99，autoRenew 为 null 兜底 false', () => {
    const o = {
      id: 1, userId: 1, levelId: 3, startDate: now, endDate: now,
      autoRenew: null, status: 1, sourceType: null, sourceId: null,
      createdAt: null, updatedAt: null, deletedAt: null,
      upgradedFromId: null, upgradedToId: null, upgradePrice: null, isUpgrade: false,
    } as unknown as LUserMembership
    const r = transformUserMembership(o, 8, now)
    expect(r).not.toBeNull()
    expect(r!.levelId).toBe(8)
    expect(r!.sourceType).toBe(99)
    expect(r!.autoRenew).toBe(false)
    expect(r!.createdAt).toEqual(now)
  })
  it('levelId 重映射失败返回 null', () => {
    const o = { id: 1, levelId: 3 } as unknown as LUserMembership
    expect(transformUserMembership(o, null, now)).toBeNull()
  })
})

describe('transformMembershipUpgradeRecord', () => {
  it('toMembershipId / paymentOrderId 任一为 null 返回 null（跳过）', () => {
    const o = { id: 1, toMembershipId: null, paymentOrderId: 5 } as unknown as LMembershipUpgradeRecord
    expect(transformMembershipUpgradeRecord(o, now)).toBeNull()
  })
  it('pointCompensation 为 null 兜底 0，paymentOrderId→orderId', () => {
    const o = {
      id: 1, userId: 1, fromMembershipId: 2, toMembershipId: 3,
      paymentOrderId: 9, upgradePrice: '10.00', pointCompensation: null,
      createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LMembershipUpgradeRecord
    const r = transformMembershipUpgradeRecord(o, now)
    expect(r).not.toBeNull()
    expect(r!.orderId).toBe(9)
    expect(r!.pointCompensation).toBe(0)
    expect(r!.transferPoints).toBe(0)
  })
})
```

- [ ] **Step 2: 写 `tests/transforms/point.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { transformPointConsumptionRecord, transformPointRecord } from '../../src/transforms/point'
import type { LPointConsumptionRecord, LPointRecord } from '../../src/legacyTypes'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformPointRecord', () => {
  it('直拷字段，新增 transferOut=0、transferToRecordId=null', () => {
    const o = {
      id: 1, userId: 1, pointAmount: 100, used: 0, remaining: 100,
      sourceType: 1, sourceId: null, userMembershipId: null,
      effectiveAt: now, expiredAt: now, settlementAt: null, status: 1, remark: null,
      createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LPointRecord
    const r = transformPointRecord(o)
    expect(r.transferOut).toBe(0)
    expect(r.transferToRecordId).toBeNull()
    expect(r.pointAmount).toBe(100)
  })
})

describe('transformPointConsumptionRecord', () => {
  it('itemId 重映射，新增 batchId=null', () => {
    const o = {
      id: 1, userId: 1, pointRecordId: 2, itemId: 5, pointAmount: 10,
      status: 1, sourceId: null, remark: null, createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LPointConsumptionRecord
    const r = transformPointConsumptionRecord(o, 30)
    expect(r).not.toBeNull()
    expect(r!.itemId).toBe(30)
    expect(r!.batchId).toBeNull()
  })
  it('itemId 重映射失败返回 null', () => {
    expect(transformPointConsumptionRecord({ id: 1, itemId: 5 } as unknown as LPointConsumptionRecord, null)).toBeNull()
  })
})
```

- [ ] **Step 3: 写 `tests/transforms/benefit.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { transformUserBenefit } from '../../src/transforms/benefit'
import type { LUserBenefit } from '../../src/legacyTypes'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformUserBenefit', () => {
  it('benefitValue Decimal→BigInt 取整，sourceType Int→String，effectiveAt/expiredAt 兜底', () => {
    const o = {
      id: 1, userId: 1, benefitId: 2, benefitValue: { toString: () => '1024.50' },
      unit: 'MB', consumedValue: 0, remainingValue: 0, status: 1,
      sourceType: 1, sourceId: null, effectiveAt: null, expiredAt: null, remark: null,
      createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LUserBenefit
    const r = transformUserBenefit(o, 9, now)
    expect(r).not.toBeNull()
    expect(r!.benefitId).toBe(9)
    expect(r!.benefitValue).toBe(1025n)
    expect(r!.sourceType).toBe('membership_gift')
    expect(r!.effectiveAt).toEqual(now)
    expect(r!.expiredAt).toEqual(new Date('2099-12-31T00:00:00Z'))
  })
})
```

- [ ] **Step 4: 写 `tests/transforms/redemption.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { transformRedemptionCode, transformRedemptionRecord } from '../../src/transforms/redemption'
import type { LRedemptionCode, LRedemptionRecord } from '../../src/legacyTypes'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformRedemptionCode', () => {
  it('giftPoint=0 → type=1、pointAmount=null', () => {
    const o = { id: 1, code: 'C1', levelId: 3, duration: 30, status: 1, remark: null, giftPoint: 0, createdBy: 1, createdAt: now, updatedAt: now, deletedAt: null } as unknown as LRedemptionCode
    const r = transformRedemptionCode(o, 8, now)
    expect(r).not.toBeNull()
    expect(r!.type).toBe(1)
    expect(r!.pointAmount).toBeNull()
    expect(r!.levelId).toBe(8)
  })
  it('giftPoint>0 → type=3、pointAmount=giftPoint', () => {
    const o = { id: 2, code: 'C2', levelId: 3, duration: 30, status: 1, remark: null, giftPoint: 500, createdBy: 1, createdAt: now, updatedAt: now, deletedAt: null } as unknown as LRedemptionCode
    const r = transformRedemptionCode(o, 8, now)
    expect(r!.type).toBe(3)
    expect(r!.pointAmount).toBe(500)
  })
})

describe('transformRedemptionRecord', () => {
  it('仅保留 userId/codeId/时间戳', () => {
    const o = { id: 1, userId: 1, codeId: 2, redeemedAt: now, expiresAt: now, status: 1, membershipId: 5, createdAt: null, updatedAt: null, deletedAt: null } as unknown as LRedemptionRecord
    const r = transformRedemptionRecord(o, now)
    expect(r.userId).toBe(1)
    expect(r.codeId).toBe(2)
    expect(r.createdAt).toEqual(now)
    expect('status' in r).toBe(false)
  })
})
```

- [ ] **Step 5: 跑 4 个测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/membership.test.ts tests/transforms/point.test.ts tests/transforms/benefit.test.ts tests/transforms/redemption.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 6: 实现 `membership.ts`**

```ts
import type { LMembershipUpgradeRecord, LUserMembership } from '../legacyTypes'
import { tsFallback } from './helpers'

/** §8.1 user_memberships：levelId 重映射；sourceType null→99；autoRenew null→false */
export function transformUserMembership(o: LUserMembership, newLevelId: number | null, migratedAt: Date) {
  if (newLevelId === null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    levelId: newLevelId,
    startDate: o.startDate,
    endDate: o.endDate,
    autoRenew: o.autoRenew ?? false,
    status: o.status,
    settlementAt: null,
    sourceType: o.sourceType ?? 99,
    sourceId: o.sourceId,
    remark: null,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.1 membership_upgrade_records：paymentOrderId→orderId；
 * toMembershipId 或 paymentOrderId 为 null 时返回 null（迁移器跳过 + 异常清单）；
 * pointCompensation null→0；丢弃 fromLevelId/toLevelId/originalRemainingDays/status。
 */
export function transformMembershipUpgradeRecord(o: LMembershipUpgradeRecord, migratedAt: Date) {
  if (o.toMembershipId == null || o.paymentOrderId == null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    fromMembershipId: o.fromMembershipId,
    toMembershipId: o.toMembershipId,
    orderId: o.paymentOrderId,
    upgradePrice: o.upgradePrice,
    pointCompensation: o.pointCompensation ?? 0,
    transferPoints: 0,
    details: undefined,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 7: 实现 `point.ts`**

```ts
import type { LPointConsumptionRecord, LPointRecord } from '../legacyTypes'

/** §8.1 point_records：直拷，新增 transferOut=0、transferToRecordId=null。旧库 createdAt/updatedAt 必填，直拷 */
export function transformPointRecord(o: LPointRecord) {
  return {
    id: o.id,
    userId: o.userId,
    pointAmount: o.pointAmount,
    used: o.used,
    remaining: o.remaining,
    sourceType: o.sourceType,
    sourceId: o.sourceId,
    userMembershipId: o.userMembershipId,
    effectiveAt: o.effectiveAt,
    expiredAt: o.expiredAt,
    settlementAt: o.settlementAt,
    status: o.status,
    transferOut: 0,
    transferToRecordId: null,
    remark: o.remark,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 point_consumption_records：itemId 重映射；新增 batchId=null。旧 createdAt/updatedAt 必填 */
export function transformPointConsumptionRecord(o: LPointConsumptionRecord, newItemId: number | null) {
  if (newItemId === null) return null
  return {
    id: o.id,
    userId: o.userId,
    pointRecordId: o.pointRecordId,
    itemId: newItemId,
    batchId: null,
    pointAmount: o.pointAmount,
    status: o.status,
    sourceId: o.sourceId,
    remark: o.remark,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 8: 实现 `benefit.ts`**

```ts
import type { LUserBenefit } from '../legacyTypes'
import { mapUserBenefitSourceType, tsFallback } from './helpers'

/** 长期有效的兜底过期时间（设计文档 §9） */
const FAR_FUTURE = new Date('2099-12-31T00:00:00Z')

/**
 * §8.1 user_benefits：benefitId 重映射；benefitValue Decimal→BigInt 取整；
 * sourceType Int→String；effectiveAt null→createdAt、expiredAt null→2099-12-31；
 * 丢弃 consumedValue/remainingValue/unit。
 */
export function transformUserBenefit(o: LUserBenefit, newBenefitId: number | null, migratedAt: Date) {
  if (newBenefitId === null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    benefitId: newBenefitId,
    benefitValue: BigInt(Math.round(Number(o.benefitValue.toString()))),
    sourceType: mapUserBenefitSourceType(o.sourceType),
    sourceId: o.sourceId,
    effectiveAt: o.effectiveAt ?? ts.createdAt,
    expiredAt: o.expiredAt ?? FAR_FUTURE,
    status: o.status,
    remark: o.remark,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 9: 实现 `redemption.ts`**

```ts
import type { LRedemptionCode, LRedemptionRecord } from '../legacyTypes'
import { tsFallback } from './helpers'

/**
 * §8.1 redemption_codes：levelId 重映射；giftPoint>0 → type=3、pointAmount=giftPoint，
 * 否则 type=1、pointAmount=null；丢弃 createdBy。
 */
export function transformRedemptionCode(o: LRedemptionCode, newLevelId: number | null, migratedAt: Date) {
  if (newLevelId === null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  const hasGift = (o.giftPoint ?? 0) > 0
  return {
    id: o.id,
    code: o.code,
    type: hasGift ? 3 : 1,
    levelId: newLevelId,
    duration: o.duration,
    pointAmount: hasGift ? o.giftPoint : null,
    expiredAt: null,
    status: o.status,
    remark: o.remark,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 redemption_records：仅保留 userId/codeId/时间戳 */
export function transformRedemptionRecord(o: LRedemptionRecord, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    codeId: o.codeId,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 10: 跑 4 个测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/membership.test.ts tests/transforms/point.test.ts tests/transforms/benefit.test.ts tests/transforms/redemption.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/transforms/membership.ts legacy-migration/src/transforms/point.ts legacy-migration/src/transforms/benefit.ts legacy-migration/src/transforms/redemption.ts legacy-migration/tests/transforms/
git commit -m "$(cat <<'EOF'
feat(migration): 会员、积分、权益、兑换域转换函数
EOF
)"
```

---

## Task 7: A 类转换 — 文件识别域 + system_configs

**Files:**
- Create: `legacy-migration/src/transforms/file.ts`、`recognition.ts`、`system.ts`
- Test: 对应 3 个测试文件

实现设计文档 §8.1 的 `oss_files`、`asr_tasks`、`asr_records`、`doc_recognition_records`、`image_recognition_records` 与 §8.3 `system_configs`。识别类表的 `vectorIds` 重置为 `[]`、`lastEmbeddingAt` 重置为 `null`（设计文档 §11）。

- [ ] **Step 1: 写 `tests/transforms/recognition.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { transformAsrRecord, transformDocRecognition } from '../../src/transforms/recognition'
import type { LAsrRecord, LDocRecognition } from '../../src/legacyTypes'

const now = new Date('2026-05-17T00:00:00Z')

describe('transformAsrRecord', () => {
  it('vectorIds 重置为 []、lastEmbeddingAt 重置为 null、新增 tempFilePath=null', () => {
    const o = {
      id: 1, userId: 1, ossFileId: 2, asrTasksId: null, status: 2,
      audioUrl: 'url', audioDuration: 60, result: {}, jsonOssFileId: null,
      speakers: [], keywords: ['k'], summary: 's', vectorIds: ['v1', 'v2'],
      lastEmbeddingAt: now, lastEditAt: null, createdAt: null, updatedAt: null, deletedAt: null,
    } as unknown as LAsrRecord
    const r = transformAsrRecord(o, now)
    expect(r.vectorIds).toEqual([])
    expect(r.lastEmbeddingAt).toBeNull()
    expect(r.tempFilePath).toBeNull()
    expect(r.createdAt).toEqual(now)
  })
})

describe('transformDocRecognition', () => {
  it('createdAt 为 null 兜底迁移时刻，vectorIds 重置', () => {
    const o = {
      id: 1, userId: 1, ossFileId: 2, status: 2, htmlContent: null, markdownContent: null,
      keywords: [], summary: null, vectorIds: ['v'], lastEmbeddingAt: now, lastEditAt: null,
      createdAt: null, updatedAt: null, deletedAt: null,
    } as unknown as LDocRecognition
    const r = transformDocRecognition(o, now)
    expect(r.vectorIds).toEqual([])
    expect(r.lastEmbeddingAt).toBeNull()
    expect(r.createdAt).toEqual(now)
  })
})
```

- [ ] **Step 2: 实现 `recognition.ts`**

```ts
import type { LAsrRecord, LAsrTask, LDocRecognition, LImageRecognition } from '../legacyTypes'
import { tsFallback } from './helpers'

/** §8.1 asr_tasks：新增 isEncrypted=false */
export function transformAsrTask(o: LAsrTask, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    taskId: o.taskId,
    status: o.status,
    isEncrypted: false,
    taskRawData: o.taskRawData ?? undefined,
    result: o.result ?? undefined,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 asr_records：新增 tempFilePath=null；vectorIds 重置 []、lastEmbeddingAt 重置 null */
export function transformAsrRecord(o: LAsrRecord, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    ossFileId: o.ossFileId,
    asrTasksId: o.asrTasksId,
    status: o.status,
    audioUrl: o.audioUrl,
    audioDuration: o.audioDuration,
    result: o.result ?? undefined,
    jsonOssFileId: o.jsonOssFileId,
    tempFilePath: null,
    speakers: o.speakers ?? undefined,
    keywords: o.keywords ?? undefined,
    summary: o.summary,
    vectorIds: [],
    lastEmbeddingAt: null,
    lastEditAt: o.lastEditAt,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 doc_recognition_records：vectorIds 重置 []、lastEmbeddingAt 重置 null */
export function transformDocRecognition(o: LDocRecognition, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    ossFileId: o.ossFileId,
    status: o.status,
    htmlContent: o.htmlContent,
    markdownContent: o.markdownContent,
    keywords: o.keywords ?? undefined,
    summary: o.summary,
    vectorIds: [],
    lastEmbeddingAt: null,
    lastEditAt: o.lastEditAt,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/** §8.1 image_recognition_records：同上；imageType 字段 100→50，preflight 已扫长度 */
export function transformImageRecognition(o: LImageRecognition, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    userId: o.userId,
    ossFileId: o.ossFileId,
    status: o.status,
    imageType: o.imageType,
    htmlContent: o.htmlContent,
    markdownContent: o.markdownContent,
    keywords: o.keywords ?? undefined,
    summary: o.summary,
    vectorIds: [],
    lastEmbeddingAt: null,
    lastEditAt: o.lastEditAt,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 3: 实现 `file.ts`**

```ts
import type { LOssFile } from '../legacyTypes'

/** §8.1 oss_files：直拷（旧 createdAt/updatedAt 可空、新库也可空）；新增 encrypted=false、originalMimeType=null */
export function transformOssFile(o: LOssFile) {
  return {
    id: o.id,
    userId: o.userId,
    bucketName: o.bucketName,
    fileName: o.fileName,
    filePath: o.filePath,
    fileSize: o.fileSize,
    fileType: o.fileType,
    fileMd5: o.fileMd5,
    source: o.source,
    status: o.status,
    encrypted: false,
    originalMimeType: null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 4: 实现 `system.ts`**

```ts
import type { LSystemConfig } from '../legacyTypes'

/** §8.3 system_configs：结构两边一致，一对一直拷（旧 createdAt/updatedAt 必填） */
export function transformSystemConfig(o: LSystemConfig) {
  return {
    id: o.id,
    configGroup: o.configGroup,
    key: o.key,
    value: o.value,
    description: o.description,
    status: o.status,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 5: 写 `tests/transforms/file.test.ts` 与 `tests/transforms/system.test.ts`**

`file.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { transformOssFile } from '../../src/transforms/file'
import type { LOssFile } from '../../src/legacyTypes'

describe('transformOssFile', () => {
  it('新增 encrypted=false、originalMimeType=null', () => {
    const o = {
      id: 1, userId: 1, bucketName: 'b', fileName: 'f', filePath: 'p',
      fileSize: 100, fileType: 'image/png', fileMd5: null, source: null, status: 0,
      createdAt: null, updatedAt: null, deletedAt: null,
    } as unknown as LOssFile
    const r = transformOssFile(o)
    expect(r.encrypted).toBe(false)
    expect(r.originalMimeType).toBeNull()
  })
})
```

`system.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { transformSystemConfig } from '../../src/transforms/system'
import type { LSystemConfig } from '../../src/legacyTypes'

describe('transformSystemConfig', () => {
  it('一对一直拷', () => {
    const now = new Date()
    const o = { id: 1, configGroup: 'g', key: 'k', value: { a: 1 }, description: null, status: 1, createdAt: now, updatedAt: now, deletedAt: null } as unknown as LSystemConfig
    expect(transformSystemConfig(o)).toEqual(o)
  })
})
```

- [ ] **Step 6: 跑全部新测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/recognition.test.ts tests/transforms/file.test.ts tests/transforms/system.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/transforms/recognition.ts legacy-migration/src/transforms/file.ts legacy-migration/src/transforms/system.ts legacy-migration/tests/transforms/recognition.test.ts legacy-migration/tests/transforms/file.test.ts legacy-migration/tests/transforms/system.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): 文件、识别记录、系统配置转换函数
EOF
)"
```

---

## Task 8: B 类转换 — case_materials + text_content_records

**Files:**
- Create: `legacy-migration/src/transforms/caseMaterial.ts`
- Test: `legacy-migration/tests/transforms/caseMaterial.test.ts`

实现设计文档 §8.2 B-1。一条旧材料 → 一条新 `case_materials`；旧 `type=1`（文本）额外产出一条 `text_content_records`。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/transforms/caseMaterial.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapCaseMaterial, mapTextContentRecord } from '../../src/transforms/caseMaterial'
import type { LCaseMaterial } from '../../src/legacyTypes'

const now = new Date('2026-05-17T00:00:00Z')
const baseMat = {
  id: 1, userId: 5, caseId: 7, name: '材料', type: 1, content: '正文',
  ossFileId: null, asrRecordId: null, materialGroup: null,
  keywords: [], summary: '摘要', vectorIds: ['v'], lastEmbeddingAt: now, lastEditAt: null,
  createdAt: now, updatedAt: now, deletedAt: null,
} as unknown as LCaseMaterial

describe('mapCaseMaterial', () => {
  it('新增 isEncrypted=false、status=3、draftId=null；丢弃 content/userId 等', () => {
    const r = mapCaseMaterial(baseMat)
    expect(r.isEncrypted).toBe(false)
    expect(r.status).toBe(3)
    expect(r.draftId).toBeNull()
    expect('content' in r).toBe(false)
    expect('userId' in r).toBe(false)
  })
})

describe('mapTextContentRecord', () => {
  it('type=1 文本材料产出 text_content_records，vectorIds 重置、lastEmbeddingAt 重置', () => {
    const r = mapTextContentRecord(baseMat)
    expect(r).not.toBeNull()
    expect(r!.materialId).toBe(1)
    expect(r!.userId).toBe(5)
    expect(r!.caseId).toBe(7)
    expect(r!.content).toBe('正文')
    expect(r!.vectorIds).toEqual([])
    expect(r!.lastEmbeddingAt).toBeNull()
    expect(r!.status).toBe(2)
  })
  it('非文本材料（type=2）不产出 text_content_records', () => {
    expect(mapTextContentRecord({ ...baseMat, type: 2 } as LCaseMaterial)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/caseMaterial.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `caseMaterial.ts`**

```ts
import type { LCaseMaterial } from '../legacyTypes'

/**
 * §8.2 B-1：旧材料 → 新 case_materials。
 * type 值域 1→1/2→2/3→3/4→4；旧 type=5（视频）由 preflight 拦截，迁移器对 type=5 跳过。
 * 丢弃 userId/content/asrRecordId/materialGroup/keywords/summary/vectorIds/lastEmbeddingAt/lastEditAt。
 */
export function mapCaseMaterial(o: LCaseMaterial) {
  return {
    id: o.id,
    caseId: o.caseId,
    draftId: null,
    name: o.name,
    type: o.type,
    ossFileId: o.ossFileId,
    isEncrypted: false,
    status: 3,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.2 B-1：仅旧 type=1（文本/案情材料）额外产出一条 text_content_records。
 * 非文本类返回 null（其解析内容已在 doc/image/asr 识别表，靠 ossFileId 关联，不重复搬）。
 */
export function mapTextContentRecord(o: LCaseMaterial) {
  if (o.type !== 1) return null
  return {
    userId: o.userId,
    caseId: o.caseId,
    materialId: o.id,
    content: o.content,
    htmlContent: null,
    summary: o.summary,
    status: 2,
    vectorIds: [],
    lastEmbeddingAt: null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

> `text_content_records.id` 自增，不带旧 ID；幂等由迁移器按 `materialId` 判存在（见 Task 12）。`case_materials` 旧 `createdAt/updatedAt` 为 NOT NULL，直拷。

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/caseMaterial.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/transforms/caseMaterial.ts legacy-migration/tests/transforms/caseMaterial.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): case_materials 与 text_content_records 拆行转换
EOF
)"
```

---

## Task 9: B 类转换 — case_analyses

**Files:**
- Create: `legacy-migration/src/transforms/caseAnalysis.ts`
- Test: `legacy-migration/tests/transforms/caseAnalysis.test.ts`

实现设计文档 §8.2 B-2 的纯映射部分。`nodeId`、`sessionId` 由迁移器解析后传入（`sessionId` 为空时迁移器新建 legacy 会话，见 Task 12）。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/transforms/caseAnalysis.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapCaseAnalysis } from '../../src/transforms/caseAnalysis'
import type { LCaseAnalysis } from '../../src/legacyTypes'

const now = new Date('2026-05-17T00:00:00Z')
const base = {
  id: 1, caseId: 7, analysisType: 'case_summary', analysisProcess: 'p',
  analysisResult: '结果', isActive: 1, generationType: 1, userId: 5, version: 2,
  sessionId: 'sess-1', title: 't', usageToken: 1500, messageId: 'm',
  keywords: [], summary: '摘要', vectorIds: ['v'], lastEmbeddingAt: now,
  status: 0, startedAt: now, completedAt: now, createdAt: null, updatedAt: null, deletedAt: null,
} as unknown as LCaseAnalysis

describe('mapCaseAnalysis', () => {
  it('isActive Int→Boolean，status 0→1，pointDeducted=true，tokens=usageToken', () => {
    const r = mapCaseAnalysis(base, 12, 'sess-1', now)
    expect(r.nodeId).toBe(12)
    expect(r.sessionId).toBe('sess-1')
    expect(r.isActive).toBe(true)
    expect(r.status).toBe(1)
    expect(r.pointDeducted).toBe(true)
    expect(r.tokens).toBe(1500)
    expect(r.tokenCount).toBeNull()
    expect(r.originalResult).toBeNull()
    expect(r.createdAt).toEqual(now)
    expect('analysisProcess' in r).toBe(false)
  })
  it('status 映射：旧 2→新 2、旧 3→新 3', () => {
    expect(mapCaseAnalysis({ ...base, status: 2 } as LCaseAnalysis, 12, 's', now).status).toBe(2)
    expect(mapCaseAnalysis({ ...base, status: 3 } as LCaseAnalysis, 12, 's', now).status).toBe(3)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/caseAnalysis.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `caseAnalysis.ts`**

```ts
import type { LCaseAnalysis } from '../legacyTypes'
import { tsFallback } from './helpers'

/** 旧 status 0/1/2/3 → 新 status 1/1/2/3（旧 0 与 1 都映射为新 1-进行中） */
function mapStatus(old: number): number {
  return old <= 1 ? 1 : old
}

/**
 * §8.2 B-2：case_analyses 纯映射。
 * nodeId、sessionId 由迁移器解析后传入（nodeId 来自 analysisType→nodes.name 匹配；
 * sessionId 旧非空直传、旧空时迁移器新建 legacy 会话后传入）。
 * isActive Int→Boolean；status 旧 0~3→新 1~3；pointDeducted=true（防新系统重扣）；
 * tokens=usageToken；丢弃 analysisProcess/generationType/userId/title/messageId/keywords/vectorIds/lastEmbeddingAt/startedAt/completedAt。
 */
export function mapCaseAnalysis(o: LCaseAnalysis, nodeId: number, sessionId: string, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    caseId: o.caseId,
    sessionId,
    nodeId,
    analysisType: o.analysisType,
    analysisResult: o.analysisResult,
    originalResult: null,
    version: o.version,
    status: mapStatus(o.status),
    isActive: o.isActive === 1,
    pointDeducted: true,
    tokenCount: null,
    tokens: o.usageToken,
    summary: o.summary,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/caseAnalysis.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/transforms/caseAnalysis.ts legacy-migration/tests/transforms/caseAnalysis.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): case_analyses 转换（nodeId/sessionId 回填映射）
EOF
)"
```

---

## Task 10: B 类转换 — payment（orders + payment_transactions）

**Files:**
- Create: `legacy-migration/src/transforms/payment.ts`
- Test: `legacy-migration/tests/transforms/payment.test.ts`

实现设计文档 §8.2 B-3。旧 `payment_orders`→新 `orders`；旧 `payment_transactions`→新 `payment_transactions`；为已支付却无交易记录的订单合成交易。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/transforms/payment.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapOrder, mapPaymentTransaction, synthesizeTransaction } from '../../src/transforms/payment'
import type { LPaymentOrder, LPaymentTransaction } from '../../src/legacyTypes'

const now = new Date('2026-05-17T00:00:00Z')
const order = {
  id: 100, orderNo: 'ORD100', userId: 1, levelId: 3, amount: '99.00',
  paymentType: 1, paymentWay: 1, status: 1, prepayId: 'pp', paymentTime: now,
  duration: 12, paymentUnit: 1, description: '会员', productId: 9, quantity: 1,
  createdAt: null, updatedAt: null, deletedAt: null,
} as unknown as LPaymentOrder

describe('mapOrder', () => {
  it('productId 重映射、paymentUnit→durationUnit、expiredAt=createdAt、isUpgrade 推断', () => {
    const r = mapOrder(order, 20, false, now)
    expect(r).not.toBeNull()
    expect(r!.productId).toBe(20)
    expect(r!.durationUnit).toBe('month')
    expect(r!.expiredAt).toEqual(now)
    expect(r!.orderType).toBe('purchase')
    expect(r!.paidAt).toEqual(now)
    expect(r!.remark).toBe('会员')
  })
  it('出现在升级记录中 → orderType=upgrade', () => {
    expect(mapOrder(order, 20, true, now)!.orderType).toBe('upgrade')
  })
  it('productId 重映射失败返回 null', () => {
    expect(mapOrder(order, null, false, now)).toBeNull()
  })
})

describe('mapPaymentTransaction', () => {
  it('生成 transactionNo、字段渠道/方式映射、expiredAt=createdAt', () => {
    const tx = {
      id: 5, orderId: 100, transactionId: 'WX123', paymentType: 1, paymentWay: 2,
      amount: '99.00', status: 1, tradeState: 'SUCCESS', bankType: 'ICBC',
      payerInfo: {}, rawData: { raw: 1 }, notifyTime: now, successTime: now,
      createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LPaymentTransaction
    const r = mapPaymentTransaction(tx)
    expect(r.transactionNo).toBe('LEGACY5')
    expect(r.outTradeNo).toBe('WX123')
    expect(r.paymentChannel).toBe('wechat')
    expect(r.paymentMethod).toBe('wap')
    expect(r.expiredAt).toEqual(now)
    expect(r.paidAt).toEqual(now)
  })
})

describe('synthesizeTransaction', () => {
  it('用订单自身支付字段合成交易，transactionNo=LEGACY-ORD+orderId', () => {
    const r = synthesizeTransaction(order, now)
    expect(r.transactionNo).toBe('LEGACY-ORD100')
    expect(r.orderId).toBe(100)
    expect(r.paymentChannel).toBe('wechat')
    expect(r.status).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/payment.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `payment.ts`**

```ts
import type { LPaymentOrder, LPaymentTransaction } from '../legacyTypes'
import { mapPaymentChannel, mapPaymentMethod, tsFallback } from './helpers'

/**
 * §8.2 B-3：旧 payment_orders → 新 orders。
 * productId 重映射后由迁移器传入（newProductId）；isUpgrade 由迁移器判断该 order 是否出现在
 * membership_upgrade_records.paymentOrderId 中后传入。
 * paymentUnit 1→'month'/2→'year'；expiredAt=createdAt；description→remark；
 * 丢弃 paymentType/paymentWay/prepayId/levelId/quantity。
 */
export function mapOrder(o: LPaymentOrder, newProductId: number | null, isUpgrade: boolean, migratedAt: Date) {
  if (newProductId === null) return null
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    id: o.id,
    orderNo: o.orderNo,
    userId: o.userId,
    productId: newProductId,
    amount: o.amount,
    duration: o.duration,
    durationUnit: o.paymentUnit === 2 ? 'year' : 'month',
    orderType: isUpgrade ? 'upgrade' : 'purchase',
    status: o.status,
    paidAt: o.paymentTime,
    expiredAt: ts.createdAt,
    remark: o.description,
    adminRemark: null,
    adminRemarkUpdatedBy: null,
    adminRemarkUpdatedAt: null,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.2 B-3：旧 payment_transactions → 新 payment_transactions。
 * 生成必填 transactionNo='LEGACY'+id；transactionId→outTradeNo；rawData→callbackData；
 * successTime→paidAt；paymentType→paymentChannel、paymentWay→paymentMethod；expiredAt=createdAt；
 * 丢弃 tradeState/bankType/payerInfo/notifyTime。旧 createdAt/updatedAt 为 NOT NULL。
 */
export function mapPaymentTransaction(o: LPaymentTransaction) {
  return {
    id: o.id,
    transactionNo: `LEGACY${o.id}`,
    orderId: o.orderId,
    amount: o.amount,
    paymentChannel: mapPaymentChannel(o.paymentType),
    paymentMethod: mapPaymentMethod(o.paymentWay),
    outTradeNo: o.transactionId,
    prepayId: null,
    status: o.status,
    paidAt: o.successTime,
    expiredAt: o.createdAt,
    callbackData: o.rawData ?? undefined,
    errorMessage: null,
    remark: null,
    adminRemark: null,
    adminRemarkUpdatedBy: null,
    adminRemarkUpdatedAt: null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    deletedAt: o.deletedAt,
  }
}

/**
 * §8.2 B-3：为"已支付却无对应旧交易记录"的订单合成一条 payment_transactions。
 * id 自增（不带旧 ID）；transactionNo='LEGACY-ORD'+orderId；幂等由迁移器按 transactionNo 去重。
 */
export function synthesizeTransaction(o: LPaymentOrder, migratedAt: Date) {
  const ts = tsFallback(o.createdAt, o.updatedAt, migratedAt)
  return {
    transactionNo: `LEGACY-ORD${o.id}`,
    orderId: o.id,
    amount: o.amount,
    paymentChannel: mapPaymentChannel(o.paymentType),
    paymentMethod: mapPaymentMethod(o.paymentWay),
    outTradeNo: null,
    prepayId: o.prepayId,
    status: o.status,
    paidAt: o.paymentTime,
    expiredAt: ts.createdAt,
    callbackData: undefined,
    errorMessage: null,
    remark: null,
    adminRemark: null,
    adminRemarkUpdatedBy: null,
    adminRemarkUpdatedAt: null,
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
    deletedAt: o.deletedAt,
  }
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型检查 + 提交**

```bash
npx vitest run --config legacy-migration/vitest.config.ts tests/transforms/payment.test.ts
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/transforms/payment.ts legacy-migration/tests/transforms/payment.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): payment_orders 拆分为 orders 与 payment_transactions 的转换
EOF
)"
```

---

## Task 11: 迁移器装配 migrators/

**Files:**
- Create: `legacy-migration/src/migrators/index.ts`

把每张表的「读旧批 → 转换 → 写新批」组装成 `MigratorSpec`（计划一 `runner.ts` 定义）。简单 A 类表用统一模式；B 类与有外键预校验/重映射的表带依赖参数。本任务产出一个工厂 `buildMigrators(ctx)`，`ctx` 含两个 client、配置重映射、FK 登记表、迁移时刻、adminRoleId。

- [ ] **Step 1: 实现 `migrators/index.ts`**

```ts
import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import type { ConfigRemaps } from '../idRemapLoader'
import type { FkRegistry } from '../fkRegistry'
import type { MigratorSpec } from '../runner'
import { deriveUserRoles, transformUser } from '../transforms/user'
import { transformCase, transformCaseSession } from '../transforms/case'
import { transformMembershipUpgradeRecord, transformUserMembership } from '../transforms/membership'
import { transformPointConsumptionRecord, transformPointRecord } from '../transforms/point'
import { transformUserBenefit } from '../transforms/benefit'
import { transformRedemptionCode, transformRedemptionRecord } from '../transforms/redemption'
import { transformOssFile } from '../transforms/file'
import { transformAsrRecord, transformAsrTask, transformDocRecognition, transformImageRecognition } from '../transforms/recognition'
import { transformSystemConfig } from '../transforms/system'
import { mapCaseMaterial, mapTextContentRecord } from '../transforms/caseMaterial'
import { mapCaseAnalysis } from '../transforms/caseAnalysis'
import { mapOrder, mapPaymentTransaction, synthesizeTransaction } from '../transforms/payment'

export interface MigrationCtx {
  legacy: LegacyPrismaClient
  next: NewPrismaClient
  remaps: ConfigRemaps
  fk: FkRegistry
  migratedAt: Date
  adminRoleId: number
}

/** 按 id 升序分批读取的通用 readBatch（legacy delegate 须有 id 与 findMany） */
function pagedRead<T>(delegate: { findMany: (args: unknown) => Promise<T[]> }) {
  return (afterId: number, limit: number) =>
    delegate.findMany({ where: { id: { gt: afterId } }, orderBy: { id: 'asc' }, take: limit }) as Promise<T[]>
}

/**
 * 构建全部迁移器。返回按 §7 阶段顺序排列的数组；
 * orchestrator 直接顺序执行即满足外键依赖。
 */
export function buildMigrators(ctx: MigrationCtx): MigratorSpec<unknown, unknown>[] {
  const { legacy, next, remaps, fk, migratedAt, adminRoleId } = ctx
  const specs: MigratorSpec<unknown, unknown>[] = []

  // —— 阶段 0：system_configs ——
  specs.push({
    table: 'systemConfigs',
    readBatch: pagedRead(legacy.systemConfigs),
    oldId: (o: any) => o.id,
    transform: async (o: any) => ({ unit: transformSystemConfig(o) }),
    writeBatch: async (units: any[]) => { await next.systemConfigs.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  // —— 阶段 1：users（写入后衍生 user_roles）——
  specs.push({
    table: 'users',
    readBatch: pagedRead(legacy.users),
    oldId: (o: any) => o.id,
    transform: async (o: any) => ({ unit: { user: transformUser(o), roles: deriveUserRoles(o, adminRoleId) } }),
    writeBatch: async (units: any[]) => {
      await next.users.createMany({ data: units.map(u => u.user), skipDuplicates: true })
      const roles = units.flatMap(u => u.roles)
      if (roles.length > 0) await next.userRoles.createMany({ data: roles, skipDuplicates: true })
    },
  } as MigratorSpec<unknown, unknown>)

  // —— 阶段 2：oss_files / asr_tasks / asr_records / doc / image ——
  specs.push(simpleSpec('ossFiles', legacy.ossFiles, next.ossFiles, (o: any) => transformOssFile(o)))
  specs.push(simpleSpec('asrTasks', legacy.asrTasks, next.asrTasks, (o: any) => transformAsrTask(o, migratedAt)))
  specs.push(fkSpec('asrRecords', legacy.asrRecords, next.asrRecords,
    (o: any) => transformAsrRecord(o, migratedAt),
    (o: any) => [['users', o.userId], ...(o.asrTasksId != null ? [['asrTasks', o.asrTasksId]] : [])] as [string, number][],
    fk))
  specs.push(fkSpec('docRecognitionRecords', legacy.docRecognitionRecords, next.docRecognitionRecords,
    (o: any) => transformDocRecognition(o, migratedAt),
    (o: any) => [['users', o.userId]] as [string, number][], fk))
  specs.push(fkSpec('imageRecognitionRecords', legacy.imageRecognitionRecords, next.imageRecognitionRecords,
    (o: any) => transformImageRecognition(o, migratedAt),
    (o: any) => [['users', o.userId]] as [string, number][], fk))

  // —— 阶段 3：cases / case_sessions / case_materials(+text_content) / case_analyses ——
  specs.push({
    table: 'cases',
    readBatch: pagedRead(legacy.cases),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll([['users', o.userId]])
      if (fkErr) return { skip: fkErr }
      const newCaseTypeId = remaps.caseTypes.get(o.caseTypeId) ?? null
      const row = transformCase(o, newCaseTypeId)
      return row ? { unit: row } : { skip: `caseTypeId ${o.caseTypeId} 无法重映射` }
    },
    writeBatch: async (units: any[]) => { await next.cases.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  specs.push({
    table: 'caseSessions',
    // 读旧会话并 join 关联 case 取 userId
    readBatch: (afterId, limit) => legacy.caseSessions.findMany({
      where: { id: { gt: afterId } }, orderBy: { id: 'asc' }, take: limit,
      include: { cases: { select: { userId: true } } },
    }) as Promise<unknown[]>,
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll([['cases', o.caseId]])
      if (fkErr) return { skip: fkErr }
      return { unit: transformCaseSession(o, o.cases?.userId ?? null) }
    },
    writeBatch: async (units: any[]) => { await next.caseSessions.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  specs.push({
    table: 'caseMaterials',
    readBatch: pagedRead(legacy.caseMaterials),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      if (o.type === 5) return { skip: '旧 type=5（视频）新库无对应类型' }
      const fkErr = fk.requireAll([['cases', o.caseId]])
      if (fkErr) return { skip: fkErr }
      return { unit: { material: mapCaseMaterial(o), text: mapTextContentRecord(o) } }
    },
    writeBatch: async (units: any[]) => {
      await next.caseMaterials.createMany({ data: units.map(u => u.material), skipDuplicates: true })
      const texts = units.map(u => u.text).filter((t): t is NonNullable<typeof t> => t != null)
      // text_content_records 自增 ID，按 materialId 去重保证幂等
      for (const t of texts) {
        const exists = await next.textContentRecords.findFirst({ where: { materialId: t.materialId } })
        if (!exists) await next.textContentRecords.create({ data: t })
      }
    },
  } as MigratorSpec<unknown, unknown>)

  specs.push({
    table: 'caseAnalyses',
    readBatch: pagedRead(legacy.caseAnalyses),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll([['cases', o.caseId]])
      if (fkErr) return { skip: fkErr }
      // nodeId：analysisType → 新 nodes.name
      const node = await next.nodes.findUnique({ where: { name: o.analysisType }, select: { id: true } })
      if (!node) return { skip: `analysisType '${o.analysisType}' 在新 nodes 无匹配` }
      // sessionId：旧非空直用；旧空则为该 case 取/建一个 legacy 会话
      const sessionId = o.sessionId ?? await ensureLegacySession(next, o.caseId, o.userId)
      return { unit: mapCaseAnalysis(o, node.id, sessionId, migratedAt) }
    },
    writeBatch: async (units: any[]) => { await next.caseAnalyses.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  // —— 阶段 4：会员与交易 ——
  specs.push(remapSpec('userMemberships', legacy.userMemberships, next.userMemberships,
    (o: any) => transformUserMembership(o, remaps.membershipLevels.get(o.levelId) ?? null, migratedAt),
    (o: any) => [['users', o.userId]] as [string, number][], fk, `levelId 无法重映射`))

  specs.push({
    table: 'orders',
    // join 升级记录判断 orderType
    readBatch: pagedRead(legacy.paymentOrders),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll([['users', o.userId]])
      if (fkErr) return { skip: fkErr }
      // productId：旧 productId 优先重映射；为空时按 levelId 找会员商品
      let newProductId: number | null = o.productId != null ? (remaps.products.get(o.productId) ?? null) : null
      if (newProductId === null && o.levelId != null) {
        const newLevelId = remaps.membershipLevels.get(o.levelId)
        if (newLevelId != null) {
          const p = await next.products.findFirst({ where: { levelId: newLevelId, type: 1, deletedAt: null }, select: { id: true } })
          newProductId = p?.id ?? null
        }
      }
      const isUpgrade = (await legacy.membershipUpgradeRecords.count({ where: { paymentOrderId: o.id } })) > 0
      const row = mapOrder(o, newProductId, isUpgrade, migratedAt)
      return row ? { unit: row } : { skip: `productId 无法确定（productId=${o.productId} levelId=${o.levelId}）` }
    },
    writeBatch: async (units: any[]) => { await next.orders.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>)

  specs.push(fkSpec('paymentTransactions', legacy.paymentTransactions, next.paymentTransactions,
    (o: any) => mapPaymentTransaction(o),
    (o: any) => [['orders', o.orderId]] as [string, number][], fk))

  specs.push(remapSpec('membershipUpgradeRecords', legacy.membershipUpgradeRecords, next.membershipUpgradeRecords,
    (o: any) => transformMembershipUpgradeRecord(o, migratedAt),
    (o: any) => [['users', o.userId], ['userMemberships', o.fromMembershipId], ['userMemberships', o.toMembershipId], ['orders', o.paymentOrderId]] as [string, number][],
    fk, `关键外键为 null（失败/未完成的升级）`))

  specs.push(fkSpec('pointRecords', legacy.pointRecords, next.pointRecords,
    (o: any) => transformPointRecord(o),
    (o: any) => [['users', o.userId], ...(o.userMembershipId != null ? [['userMemberships', o.userMembershipId]] : [])] as [string, number][], fk))

  specs.push(remapSpec('pointConsumptionRecords', legacy.pointConsumptionRecords, next.pointConsumptionRecords,
    (o: any) => transformPointConsumptionRecord(o, remaps.pointConsumptionItems.get(o.itemId) ?? null),
    (o: any) => [['users', o.userId], ['pointRecords', o.pointRecordId]] as [string, number][], fk, `itemId 无法重映射`))

  specs.push(remapSpec('userBenefits', legacy.userBenefits, next.userBenefits,
    (o: any) => transformUserBenefit(o, remaps.benefits.get(o.benefitId) ?? null, migratedAt),
    (o: any) => [['users', o.userId]] as [string, number][], fk, `benefitId 无法重映射`))

  // —— 阶段 5：兑换 ——
  specs.push(remapSpec('redemptionCodes', legacy.redemptionCodes, next.redemptionCodes,
    (o: any) => transformRedemptionCode(o, remaps.membershipLevels.get(o.levelId) ?? null, migratedAt),
    () => [] as [string, number][], fk, `levelId 无法重映射`))

  specs.push(fkSpec('redemptionRecords', legacy.redemptionRecords, next.redemptionRecords,
    (o: any) => transformRedemptionRecord(o, migratedAt),
    (o: any) => [['users', o.userId], ['redemptionCodes', o.codeId]] as [string, number][], fk))

  return specs
}

/** 旧 case_analyses.sessionId 为空时，为该 case 取/建一个 legacy 会话，返回 sessionId */
async function ensureLegacySession(next: NewPrismaClient, caseId: number, userId: number | null): Promise<string> {
  const sessionId = `legacy-case-${caseId}`
  const exists = await next.caseSessions.findUnique({ where: { sessionId }, select: { sessionId: true } })
  if (!exists) {
    await next.caseSessions.create({
      data: { sessionId, scope: 'case', userId, caseId, status: 2, type: 1 },
    })
  }
  return sessionId
}

/** A 类无外键无重映射表的简单迁移器 */
function simpleSpec(table: string, legacyDelegate: any, newDelegate: any, transform: (o: any) => any): MigratorSpec<unknown, unknown> {
  return {
    table,
    readBatch: pagedRead(legacyDelegate),
    oldId: (o: any) => o.id,
    transform: async (o: any) => ({ unit: transform(o) }),
    writeBatch: async (units: any[]) => { await newDelegate.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>
}

/** 带业务外键预校验的迁移器 */
function fkSpec(table: string, legacyDelegate: any, newDelegate: any, transform: (o: any) => any,
  refs: (o: any) => [string, number][], fk: FkRegistry): MigratorSpec<unknown, unknown> {
  return {
    table,
    readBatch: pagedRead(legacyDelegate),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll(refs(o))
      if (fkErr) return { skip: fkErr }
      return { unit: transform(o) }
    },
    writeBatch: async (units: any[]) => { await newDelegate.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>
}

/** 带外键预校验 + 转换可能返回 null（重映射失败）的迁移器 */
function remapSpec(table: string, legacyDelegate: any, newDelegate: any, transform: (o: any) => any,
  refs: (o: any) => [string, number][], fk: FkRegistry, nullReason: string): MigratorSpec<unknown, unknown> {
  return {
    table,
    readBatch: pagedRead(legacyDelegate),
    oldId: (o: any) => o.id,
    transform: async (o: any) => {
      const fkErr = fk.requireAll(refs(o))
      if (fkErr) return { skip: fkErr }
      const row = transform(o)
      return row ? { unit: row } : { skip: nullReason }
    },
    writeBatch: async (units: any[]) => { await newDelegate.createMany({ data: units, skipDuplicates: true }) },
  } as MigratorSpec<unknown, unknown>
}
```

> 此文件用 `any` 弱化泛型——迁移器是粘合层，转换函数本身已在各自单测里强类型校验；`createMany` 的 `data` 仍会按新库 Prisma 类型做编译期检查。`legacy.<model>` 的 delegate 名称即旧 schema 的 model 名（`paymentOrders`/`caseAnalyses` 等驼峰）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误（重点确认每个 `next.<model>.createMany` 的 data 字段与新库 schema 对得上——若某转换函数字段名/类型有误，此处会报错，回到对应 transform 修正）。

- [ ] **Step 3: 提交**

```bash
git add legacy-migration/src/migrators/index.ts
git commit -m "$(cat <<'EOF'
feat(migration): 22 张表迁移器装配
EOF
)"
```

---

## Task 12: 管理员角色补绑 adminRoles.ts

**Files:**
- Create: `legacy-migration/src/adminRoles.ts`

设计文档 §6.4：关键账号按手机号补绑 RBAC 角色。`users` 迁移时已由 `deriveUserRoles` 给旧 `role='admin'` 绑定了基础 admin 角色；本步骤为指定手机号的账号补绑额外角色（如 super_admin）。

- [ ] **Step 1: 实现 `adminRoles.ts`**

```ts
import type { NewPrismaClient } from './clients'
import { log, warn } from './logger'

/**
 * 关键账号角色补绑配置：手机号 → 角色 code 列表。
 * 演练阶段按实际管理员名单与新库 roles 表的 code 填写。
 */
const ADMIN_BINDINGS: { phone: string; roleCodes: string[] }[] = [
  // 示例（执行前按真实名单替换）：
  // { phone: '13064768490', roleCodes: ['super_admin'] },
]

/** 按手机号给关键账号补绑角色（幂等：user_roles 有 (userId,roleId) 唯一约束） */
export async function bindAdminRoles(next: NewPrismaClient): Promise<void> {
  if (ADMIN_BINDINGS.length === 0) {
    warn('[adminRoles] 未配置关键账号角色绑定，跳过（如需请填写 ADMIN_BINDINGS）')
    return
  }
  for (const { phone, roleCodes } of ADMIN_BINDINGS) {
    const user = await next.users.findUnique({ where: { phone }, select: { id: true } })
    if (!user) { warn(`[adminRoles] 手机号 ${phone} 在新库无对应用户，跳过`); continue }
    for (const code of roleCodes) {
      const role = await next.roles.findUnique({ where: { code }, select: { id: true } })
      if (!role) { warn(`[adminRoles] 角色 code '${code}' 不存在，跳过`); continue }
      await next.userRoles.upsert({
        where: { idx_user_role_unique: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      })
      log(`[adminRoles] ${phone} 绑定角色 ${code}`)
    }
  }
}
```

> `upsert` 的 `where` 用 `user_roles` 的复合唯一约束名 `idx_user_role_unique`（见新库 `rbac.prisma` `@@unique([userId, roleId], name: "idx_user_role_unique")`）。

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/adminRoles.ts
git commit -m "$(cat <<'EOF'
feat(migration): 管理员关键账号角色补绑
EOF
)"
```

---

## Task 13: 编排器 orchestrator.ts

**Files:**
- Create: `legacy-migration/src/orchestrator.ts`

按设计文档 §7 顺序执行全部迁移器，串起 FK 登记、序列重置、角色补绑、异常清单输出。

- [ ] **Step 1: 实现 `orchestrator.ts`**

```ts
import { writeFileSync } from 'node:fs'
import type { LegacyPrismaClient, NewPrismaClient } from './clients'
import type { MigrationConfig } from './config'
import { ExceptionCollector } from './exceptions'
import { FkRegistry } from './fkRegistry'
import { loadConfigRemaps } from './idRemapLoader'
import { log } from './logger'
import { ensureProgressTable } from './progress'
import { runMigration } from './runner'
import { resetSequences } from './sequenceReset'
import { bindAdminRoles } from './adminRoles'
import { buildMigrators } from './migrators/index'

/** 所有保留旧 ID 插入、需迁移后重置序列的表（按新库表名） */
const SEQUENCE_TABLES = [
  'system_configs', 'users', 'oss_files', 'asr_tasks', 'asr_records',
  'doc_recognition_records', 'image_recognition_records', 'cases', 'case_sessions',
  'case_materials', 'text_content_records', 'case_analyses', 'user_memberships',
  'orders', 'payment_transactions', 'membership_upgrade_records', 'point_records',
  'point_consumption_records', 'user_benefits', 'redemption_codes', 'redemption_records',
  'user_roles',
]

export async function runFullMigration(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  cfg: MigrationConfig,
  adminRoleId: number,
): Promise<void> {
  const migratedAt = new Date()
  const exceptions = new ExceptionCollector()
  const fk = new FkRegistry()

  log('===== 数据迁移开始 =====')
  await ensureProgressTable(next as any)
  const remaps = await loadConfigRemaps(legacy, next)
  const migrators = buildMigrators({ legacy, next, remaps, fk, migratedAt, adminRoleId })

  const deps = { newDb: next as any, exceptions, batchSize: cfg.batchSize, failureRateThreshold: cfg.failureRateThreshold }

  // 阶段 0~5：按 §7 顺序逐表迁移；每张完成后把成功 ID 登记进 FkRegistry 供子表预校验
  for (const spec of migrators) {
    const result = await runMigration(spec as any, deps)
    fk.record(spec.table, result.migratedIds)
  }

  // 阶段 6：序列重置
  log('--- 重置自增序列 ---')
  await resetSequences(next as any, SEQUENCE_TABLES)

  // 阶段 6：管理员角色补绑
  log('--- 管理员角色补绑 ---')
  await bindAdminRoles(next)

  // 异常清单落盘
  const reportPath = 'legacy-migration/reports/exceptions.csv'
  exceptions.flush(reportPath)
  log(`===== 数据迁移完成：异常 ${exceptions.count()} 行，清单见 ${reportPath} =====`)
  writeFileSync(
    'legacy-migration/reports/migration-summary.json',
    JSON.stringify({ migratedAt, exceptions: exceptions.count() }, null, 2),
    'utf8',
  )
}
```

> `payment_transactions` 的合成补充行（`synthesizeTransaction`）在主迁移之后单独执行——见 Task 14 在 `migrate` 命令里接入；合成行用自增 ID，须在 `payment_transactions` 序列重置之后插入（设计文档 §6.1 衍生行规则）。

- [ ] **Step 2: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/orchestrator.ts
git commit -m "$(cat <<'EOF'
feat(migration): 迁移编排器（阶段顺序 + 序列重置 + 角色补绑）
EOF
)"
```

---

## Task 14: 合成交易补充 + migrate 命令接入

**Files:**
- Modify: `legacy-migration/src/orchestrator.ts`（加入合成交易步骤）
- Modify: `legacy-migration/src/index.ts`（加入 `migrate` 命令）

- [ ] **Step 1: 在 `orchestrator.ts` 加入合成交易函数**

在 `orchestrator.ts` 末尾追加，并在 `runFullMigration` 的"序列重置"之后、"角色补绑"之前调用 `await synthesizeMissingTransactions(legacy, next, migratedAt, exceptions)`：

```ts
import { synthesizeTransaction } from './transforms/payment'

/**
 * 为"已支付（status=1）却无对应 payment_transactions"的订单合成交易行。
 * 在 payment_transactions 序列重置之后执行，合成行用自增 ID；
 * 幂等：按 transactionNo（LEGACY-ORD+orderId）唯一约束去重。
 */
async function synthesizeMissingTransactions(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  migratedAt: Date,
  exceptions: ExceptionCollector,
): Promise<void> {
  log('--- 合成缺失的支付交易 ---')
  let after = 0
  let synthesized = 0
  for (;;) {
    const orders = await legacy.paymentOrders.findMany({
      where: { id: { gt: after }, status: 1 }, orderBy: { id: 'asc' }, take: 500,
    })
    if (orders.length === 0) break
    for (const o of orders) {
      const hasTx = await next.paymentTransactions.findFirst({ where: { orderId: o.id }, select: { id: true } })
      if (hasTx) continue
      // 仅为迁移成功的订单合成（订单可能因外键/重映射失败被跳过）
      const orderExists = await next.orders.findUnique({ where: { id: o.id }, select: { id: true } })
      if (!orderExists) continue
      try {
        await next.paymentTransactions.create({ data: synthesizeTransaction(o, migratedAt) })
        synthesized++
      } catch (e) {
        exceptions.add('paymentTransactions(合成)', o.id, `合成失败：${(e as Error).message}`)
      }
    }
    after = orders[orders.length - 1]!.id
  }
  log(`--- 合成交易完成：新增 ${synthesized} 条 ---`)
}
```

- [ ] **Step 2: 在 `index.ts` 加入 `migrate` 命令**

在 `legacy-migration/src/index.ts` 的 `import` 区加 `import { runFullMigration } from './orchestrator'`，新增 `cmdMigrate`，并在 `switch` 中加 `case 'migrate'`：

```ts
async function cmdMigrate(): Promise<void> {
  const cfg = loadConfig()
  const adminRoleId = Number(process.env.MIGRATION_ADMIN_ROLE_ID ?? 0)
  if (!adminRoleId) throw new Error('缺少 MIGRATION_ADMIN_ROLE_ID（新库基础 admin 角色的 id）')
  const legacy = createLegacyClient(cfg.legacyDatabaseUrl)
  const next = createNewClient(cfg.newDatabaseUrl)
  try {
    await runFullMigration(legacy, next, cfg, adminRoleId)
  } finally {
    await legacy.$disconnect()
    await next.$disconnect()
  }
}
```

`switch` 内：

```ts
    case 'migrate':
      await cmdMigrate()
      break
```

并把 `default` 分支的提示改为 `可用命令：preflight、migrate`。

- [ ] **Step 3: 类型检查 + 提交**

```bash
npx tsc --noEmit --project legacy-migration/tsconfig.json
git add legacy-migration/src/orchestrator.ts legacy-migration/src/index.ts
git commit -m "$(cat <<'EOF'
feat(migration): 合成缺失支付交易 + migrate 命令接入
EOF
)"
```

---

## Task 15: 全量测试 + migrate 冒烟运行

- [ ] **Step 1: 跑全部单元测试**

Run: `npx vitest run --config legacy-migration/vitest.config.ts`
Expected: PASS（计划一 12 个 + 本计划 helpers 4 / fkRegistry 3 / user 3 / case 3 / membership 4 / point 3 / benefit 1 / redemption 4 / recognition 2 / file 1 / system 1 / caseMaterial 4 / caseAnalysis 3 / payment 6，共约 50+ 个用例全部通过）。

- [ ] **Step 2: 类型检查整个工具**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: migrate 冒烟运行**

准备：旧库测试库（同计划一 Task 12）；新库为空业务表 + 已 seed 配置；`.env` 设好 `LEGACY_DATABASE_URL`、`DATABASE_URL`、`MIGRATION_ADMIN_ROLE_ID`（新库 `roles` 表中基础 admin 角色的 id，可 `prisma studio` 查）。

Run（从仓库根目录）: `npx tsx legacy-migration/src/index.ts migrate`
Expected: 控制台按阶段打印各表"读取/成功/跳过"，最后输出异常计数；`legacy-migration/reports/exceptions.csv` 与 `migration-summary.json` 生成。

- [ ] **Step 4: 人工核对冒烟结果**

- 抽查新库几张表行数与旧库对比（粗略一致）。
- 打开 `exceptions.csv` 检查异常是否都是预期内的（preflight 已知项），无大面积异常。
- 确认无 FK 报错、无中断。

> 系统化的数据校验在计划三的 `verify` 命令；本步骤只确认 migrate 能跑通。

- [ ] **Step 5: 提交（若冒烟中修了 bug）**

```bash
git add -A legacy-migration/
git commit -m "$(cat <<'EOF'
fix(migration): 修复冒烟运行发现的问题
EOF
)"
```

> 若冒烟无需改动，本步骤跳过。

---

## 自审记录

- **设计文档覆盖**：本计划实现 §6.4（角色衍生 + 补绑）、§7（阶段顺序 → orchestrator 的 migrators 数组顺序）、§8.1/§8.2/§8.3（全部 22 张表转换）、§9（兜底：tsFallback、sourceType 99、autoRenew false、pointCompensation 0、effectiveAt/expiredAt、productId、orderType、transactionNo、redemption type/pointAmount）、§10（idRemapLoader 构建 6 张配置重映射）、§12（fkRegistry 外键预校验 + runner 三层错误）。向量重嵌入与系统化校验属计划三。
- **占位符扫描**：无 TBD/TODO。`adminRoles.ts` 的 `ADMIN_BINDINGS` 与 `helpers.ts` 的枚举对照表标注"演练阶段按真实名单/旧代码核对"——这是执行期必须确认的真实配置项，非代码占位。
- **类型一致性**：转换函数签名在各自 transform 文件定义、在对应测试与 `migrators/index.ts` 中按相同签名调用；`MigrationCtx`/`ConfigRemaps`/`FkRegistry`/`MigratorSpec` 跨文件一致；`migrators/index.ts` 用 `any` 弱化粘合层泛型，但 `createMany({ data })` 仍由新库 Prisma 类型在 `tsc` 把关。
- **范围**：本计划产出可运行的 `migrate` 命令，完成全量数据迁移。计划三（`verify` 校验 + 向量重嵌入 + 切换 runbook）依赖本计划的迁移结果。
