# 历史数据迁移 · 计划一：工具骨架与迁移基础设施 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 `legacy-migration/` 独立工具项目，连通新旧数据库，实现迁移基础设施（配置、双库客户端、异常收集、进度表、配置外键重映射、通用分批迁移执行器、序列重置），并实现 preflight 上线前扫描命令。

**Architecture:** `legacy-migration/` 是仓库根目录下的独立 TypeScript 小项目，复用仓库的 prisma / tsx / vitest，不引入新依赖，迁移完成后可整体删除。旧库通过从旧 schema 生成的只读 legacy Prisma client 访问，新库通过仓库现有 `generated/prisma` client 访问。基础设施层提供通用的"分批读取 → 逐行转换 → 批量写入（失败降级逐行）→ 异常收集 → 熔断"执行器，供计划二的逐表迁移器复用。

**Tech Stack:** TypeScript、Prisma 7.7（legacy client + 新库 client）、`@prisma/adapter-pg`、tsx、vitest 4。

**依据设计文档：** `docs/superpowers/specs/2026-05-17-legacy-data-migration-design.md`（下称"设计文档"）。本计划是 3 个计划中的第 1 个，只覆盖基础设施与 preflight；逐表迁移在计划二，校验与重嵌入在计划三。

---

## 文件结构

```
legacy-migration/
├── README.md                 工具说明、环境变量、命令、清理步骤
├── .gitignore                忽略 legacy-client/ 与 reports 产物
├── tsconfig.json             TS 配置
├── vitest.config.ts          独立测试配置（纯函数，不依赖 DB 基建）
├── schema.legacy.prisma      旧库 schema 副本（generator output 指向 ./legacy-client）
├── legacy-client/            生成的只读 legacy Prisma client（gitignore）
├── reports/.gitkeep          迁移行数 / 异常清单 / 校验报告输出目录
├── src/
│   ├── config.ts             环境变量读取（两个连接串、批大小、熔断阈值）
│   ├── logger.ts             结构化日志
│   ├── clients.ts            legacy + 新库 Prisma client 实例工厂
│   ├── exceptions.ts         异常清单收集器（写 reports/）
│   ├── progress.ts           _migration_progress 表读写（断点续跑）
│   ├── idRemap.ts            配置外键重映射（按 name 配对旧→新 ID）
│   ├── sequenceReset.ts      自增序列重置
│   ├── runner.ts             通用分批迁移执行器（三层错误模型 + 熔断）
│   ├── preflight.ts          上线前 8 项扫描
│   └── index.ts              CLI 入口（本计划实现 preflight 命令）
└── tests/
    ├── config.test.ts
    ├── exceptions.test.ts
    ├── idRemap.test.ts
    └── runner.test.ts
```

职责边界：`config`/`logger` 是无依赖基础工具；`clients` 封装两个 DB 连接；`exceptions`/`progress` 是迁移期状态；`idRemap`/`sequenceReset`/`runner` 是迁移执行基础设施；`preflight` 是独立的扫描功能；`index` 只做命令分发。纯函数（`config`/`exceptions`/`idRemap`/`runner`）有单元测试；DB 绑定模块（`clients`/`progress`/`preflight`）由计划末的真实库冒烟运行验证。

---

## Task 1: 项目骨架

**Files:**
- Create: `legacy-migration/README.md`
- Create: `legacy-migration/.gitignore`
- Create: `legacy-migration/reports/.gitkeep`
- Create: `legacy-migration/tsconfig.json`
- Create: `legacy-migration/vitest.config.ts`

- [ ] **Step 1: 创建 `.gitignore`**

```
legacy-client/
reports/*
!reports/.gitkeep
```

- [ ] **Step 2: 创建 `reports/.gitkeep`（空文件）**

内容为空。用于让空目录进入 git。

- [ ] **Step 3: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 4: 创建 `vitest.config.ts`**

```ts
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5: 创建 `README.md`（初版，Task 12 完善）**

```markdown
# legacy-migration

LexSeekApi（旧）→ LexSeek（新）历史数据一次性迁移工具。一次性使用，迁移上线稳定后整体删除本目录。

设计文档：`docs/superpowers/specs/2026-05-17-legacy-data-migration-design.md`

## 环境变量

在仓库根 `.env` 中临时追加（迁移完成后移除）：

- `LEGACY_DATABASE_URL` — 旧库（LexSeekApi 生产库快照）连接串
- `DATABASE_URL` — 新库连接串（仓库已有）

## 命令（均从仓库根目录执行）

- `npx tsx legacy-migration/src/index.ts preflight` — 上线前扫描（计划一）
- `migrate` / `verify` — 见计划二、计划三

## 测试

`npx vitest run --config legacy-migration/vitest.config.ts`

## 清理

迁移上线稳定后：删除本目录、删除新库 `_migration_progress` 表、移除 `.env` 中的 `LEGACY_DATABASE_URL`。
```

- [ ] **Step 6: 提交**

```bash
git add legacy-migration/.gitignore legacy-migration/reports/.gitkeep legacy-migration/tsconfig.json legacy-migration/vitest.config.ts legacy-migration/README.md
git commit -m "$(cat <<'EOF'
chore(migration): 初始化 legacy-migration 工具骨架
EOF
)"
```

---

## Task 2: 生成 legacy Prisma client

**Files:**
- Create: `legacy-migration/schema.legacy.prisma`
- Generate: `legacy-migration/legacy-client/`（命令产出，不手写）

- [ ] **Step 1: 复制旧库 schema**

旧项目与本仓库平级。从仓库根目录执行：

```bash
cp ../LexSeekApi/prisma/schema.prisma legacy-migration/schema.legacy.prisma
```

- [ ] **Step 2: 修改 generator output**

编辑 `legacy-migration/schema.legacy.prisma` 顶部的 generator 块，把 `output` 改为本目录内路径（其余不动）：

```prisma
generator client {
  provider = "prisma-client"
  output   = "./legacy-client"
}
```

> 该 schema 含 `Unsupported("vector")` 字段（`materials_embeddings`/`law_embeddings`），Prisma 能正常生成 client（这两表本迁移不读取，见设计文档 §11），无需改动。

- [ ] **Step 3: 生成 legacy client**

从仓库根目录执行：

```bash
npx prisma generate --schema=legacy-migration/schema.legacy.prisma
```

Expected: 输出 `Generated Prisma Client ... to ./legacy-migration/legacy-client`，目录下出现 `client.ts` 等文件。

> 若 Prisma 7 因仓库 `prisma.config.ts` 报模式冲突：在 `legacy-migration/` 内新建 `prisma.config.ts`（`import { defineConfig } from 'prisma/config'; export default defineConfig({ schema: 'schema.legacy.prisma' })`），`cd legacy-migration && npx prisma generate`。

- [ ] **Step 4: 验证生成产物**

```bash
ls legacy-migration/legacy-client/client.ts
```

Expected: 文件存在。

- [ ] **Step 5: 提交**

```bash
git add legacy-migration/schema.legacy.prisma
git commit -m "$(cat <<'EOF'
chore(migration): 加入旧库 schema 副本用于生成只读 legacy client
EOF
)"
```

> `legacy-client/` 已被 `.gitignore` 忽略，不入库；执行环境各自 `prisma generate` 重新生成。

---

## Task 3: 环境配置 config.ts

**Files:**
- Create: `legacy-migration/src/config.ts`
- Test: `legacy-migration/tests/config.test.ts`

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    delete process.env.LEGACY_DATABASE_URL
    delete process.env.DATABASE_URL
    delete process.env.MIGRATION_BATCH_SIZE
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it('缺少 LEGACY_DATABASE_URL 时抛错', () => {
    process.env.DATABASE_URL = 'postgresql://new'
    expect(() => loadConfig()).toThrow(/LEGACY_DATABASE_URL/)
  })

  it('两个连接串齐全时返回配置，批大小有默认值', () => {
    process.env.LEGACY_DATABASE_URL = 'postgresql://old'
    process.env.DATABASE_URL = 'postgresql://new'
    const cfg = loadConfig()
    expect(cfg.legacyDatabaseUrl).toBe('postgresql://old')
    expect(cfg.newDatabaseUrl).toBe('postgresql://new')
    expect(cfg.batchSize).toBe(800)
    expect(cfg.failureRateThreshold).toBe(0.05)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/config.test.ts`
Expected: FAIL（`loadConfig` 未定义 / 模块不存在）。

- [ ] **Step 3: 实现 `config.ts`**

```ts
export interface MigrationConfig {
  /** 旧库（LexSeekApi 生产库快照）连接串 */
  legacyDatabaseUrl: string
  /** 新库连接串 */
  newDatabaseUrl: string
  /** 每批行数 */
  batchSize: number
  /** 单表失败率熔断阈值（0~1） */
  failureRateThreshold: number
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[legacy-migration] 缺少环境变量 ${name}`)
  return v
}

export function loadConfig(): MigrationConfig {
  return {
    legacyDatabaseUrl: required('LEGACY_DATABASE_URL'),
    newDatabaseUrl: required('DATABASE_URL'),
    batchSize: Number(process.env.MIGRATION_BATCH_SIZE ?? 800),
    failureRateThreshold: Number(process.env.MIGRATION_FAILURE_THRESHOLD ?? 0.05),
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/config.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add legacy-migration/src/config.ts legacy-migration/tests/config.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): 迁移工具环境配置读取
EOF
)"
```

---

## Task 4: 日志与双库客户端

**Files:**
- Create: `legacy-migration/src/logger.ts`
- Create: `legacy-migration/src/clients.ts`

- [ ] **Step 1: 实现 `logger.ts`**

```ts
type Level = 'info' | 'warn' | 'error'

function emit(level: Level, msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = (msg: string) => emit('info', msg)
export const warn = (msg: string) => emit('warn', msg)
export const logError = (msg: string) => emit('error', msg)
```

- [ ] **Step 2: 实现 `clients.ts`**

旧库 client 来自 Task 2 生成的 `../legacy-client/client`；新库 client 复用仓库的 `generated/prisma/client`（从 `legacy-migration/src/` 到仓库根 `generated/` 为 `../../generated/`）。Prisma client 实例化沿用仓库 `prisma/seed.ts` 的 `PrismaPg` 适配器 + `-c TimeZone=UTC` 模式。

```ts
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient as NewPrismaClient } from '../../generated/prisma/client'
import { PrismaClient as LegacyPrismaClient } from '../legacy-client/client'

/** 新库 client（写入目标） */
export function createNewClient(url: string): NewPrismaClient {
  const adapter = new PrismaPg({ connectionString: url, options: '-c TimeZone=UTC' })
  return new NewPrismaClient({ adapter })
}

/** 旧库 client（只读数据源） */
export function createLegacyClient(url: string): LegacyPrismaClient {
  const adapter = new PrismaPg({ connectionString: url, options: '-c TimeZone=UTC' })
  return new LegacyPrismaClient({ adapter })
}

export type { NewPrismaClient, LegacyPrismaClient }
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误（确认两个 client 的 import 路径解析正确；若 `legacy-client` 未生成会报错——需先完成 Task 2）。

- [ ] **Step 4: 提交**

```bash
git add legacy-migration/src/logger.ts legacy-migration/src/clients.ts
git commit -m "$(cat <<'EOF'
feat(migration): 结构化日志与新旧库 Prisma client 工厂
EOF
)"
```

---

## Task 5: 异常清单收集器 exceptions.ts

**Files:**
- Create: `legacy-migration/src/exceptions.ts`
- Test: `legacy-migration/tests/exceptions.test.ts`

异常清单收集迁移期所有被跳过/失败的行（设计文档 §12），最终写入 `reports/`。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/exceptions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ExceptionCollector } from '../src/exceptions'

describe('ExceptionCollector', () => {
  it('累积异常并按表统计', () => {
    const c = new ExceptionCollector()
    c.add('users', 12, '唯一约束冲突：email')
    c.add('users', 30, '唯一约束冲突：email')
    c.add('cases', 5, '外键失配：caseTypeId')
    expect(c.count()).toBe(3)
    expect(c.countByTable('users')).toBe(2)
    expect(c.countByTable('orders')).toBe(0)
  })

  it('toCsv 输出表头与数据行', () => {
    const c = new ExceptionCollector()
    c.add('users', 12, '转换异常：boom')
    const csv = c.toCsv()
    expect(csv.split('\n')[0]).toBe('table,old_id,reason')
    expect(csv).toContain('users,12,转换异常：boom')
  })

  it('reason 含逗号或引号时按 CSV 规则转义', () => {
    const c = new ExceptionCollector()
    c.add('orders', 1, '原因,含逗号')
    expect(c.toCsv()).toContain('orders,1,"原因,含逗号"')
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/exceptions.test.ts`
Expected: FAIL（`ExceptionCollector` 未定义）。

- [ ] **Step 3: 实现 `exceptions.ts`**

```ts
import { writeFileSync } from 'node:fs'

export interface ExceptionRow {
  table: string
  oldId: number
  reason: string
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export class ExceptionCollector {
  private rows: ExceptionRow[] = []

  add(table: string, oldId: number, reason: string): void {
    this.rows.push({ table, oldId, reason })
  }

  count(): number {
    return this.rows.length
  }

  countByTable(table: string): number {
    return this.rows.filter(r => r.table === table).length
  }

  toCsv(): string {
    const header = 'table,old_id,reason'
    const body = this.rows.map(r => `${csvCell(r.table)},${csvCell(r.oldId)},${csvCell(r.reason)}`)
    return [header, ...body].join('\n')
  }

  /** 写入 reports/ 目录 */
  flush(filePath: string): void {
    writeFileSync(filePath, this.toCsv(), 'utf8')
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/exceptions.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add legacy-migration/src/exceptions.ts legacy-migration/tests/exceptions.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): 异常清单收集器
EOF
)"
```

---

## Task 6: 进度表 progress.ts

**Files:**
- Create: `legacy-migration/src/progress.ts`

`_migration_progress` 建在新库，记录每张表已迁移到的最大旧行 ID，支持 `--resume` 断点续跑（设计文档 §6.3）。该模块为 DB 绑定，由 Task 12 冒烟运行验证，不写单元测试。

- [ ] **Step 1: 实现 `progress.ts`**

```ts
/** 仅依赖 $executeRawUnsafe / $queryRawUnsafe 两个方法，便于在测试中以假对象注入 */
export interface RawDb {
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<unknown>
  $queryRawUnsafe: <T = unknown>(sql: string, ...args: unknown[]) => Promise<T[]>
}

export type ProgressStatus = 'running' | 'done'

/** 创建进度表（幂等） */
export async function ensureProgressTable(db: RawDb): Promise<void> {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS _migration_progress (
      table_name text PRIMARY KEY,
      last_id    bigint NOT NULL DEFAULT 0,
      status     text   NOT NULL DEFAULT 'running',
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/** 读取某表已迁移到的最大旧行 ID；无记录返回 0 */
export async function getLastId(db: RawDb, table: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ last_id: bigint | number }>(
    `SELECT last_id FROM _migration_progress WHERE table_name = $1`,
    table,
  )
  return rows[0] ? Number(rows[0].last_id) : 0
}

/** 写入/更新某表进度 */
export async function setProgress(
  db: RawDb,
  table: string,
  lastId: number,
  status: ProgressStatus,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO _migration_progress (table_name, last_id, status, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (table_name)
     DO UPDATE SET last_id = EXCLUDED.last_id, status = EXCLUDED.status, updated_at = now()`,
    table, lastId, status,
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add legacy-migration/src/progress.ts
git commit -m "$(cat <<'EOF'
feat(migration): 迁移进度表（断点续跑）
EOF
)"
```

---

## Task 7: 配置外键重映射 idRemap.ts

**Files:**
- Create: `legacy-migration/src/idRemap.ts`
- Test: `legacy-migration/tests/idRemap.test.ts`

业务表对配置表的外键需按 name 把旧 ID 映射为新 seed ID（设计文档 §6.2、§10）。本任务实现纯函数 `buildRemap`，构建/读取映射的 DB 部分在计划二接入。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/idRemap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildRemap } from '../src/idRemap'

describe('buildRemap', () => {
  const oldRows = [
    { id: 1, name: '民事' },
    { id: 2, name: '刑事' },
    { id: 9, name: '已废弃类型' },
  ]
  const newRows = [
    { id: 5, name: '民事' },
    { id: 6, name: '刑事' },
    { id: 7, name: '行政' },
  ]

  it('按 name 把旧 ID 映射到新 ID', () => {
    const remap = buildRemap(oldRows, newRows, r => r.name)
    expect(remap.get(1)).toBe(5)
    expect(remap.get(2)).toBe(6)
  })

  it('新库无同名项时该旧 ID 不在映射中（返回 undefined）', () => {
    const remap = buildRemap(oldRows, newRows, r => r.name)
    expect(remap.get(9)).toBeUndefined()
  })

  it('未匹配旧 ID 清单可枚举', () => {
    const remap = buildRemap(oldRows, newRows, r => r.name)
    expect(remap.unmatchedOldIds()).toEqual([9])
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/idRemap.test.ts`
Expected: FAIL（`buildRemap` 未定义）。

- [ ] **Step 3: 实现 `idRemap.ts`**

```ts
interface HasId {
  id: number
}

export interface Remap {
  /** 旧 ID → 新 ID；无映射返回 undefined */
  get: (oldId: number) => number | undefined
  /** 在新库找不到对应项的旧 ID 列表 */
  unmatchedOldIds: () => number[]
}

/**
 * 按自然键（keyFn，通常是 name）把旧配置表行映射到新配置表行。
 * 旧、新两侧 keyFn 取值相同的，建立 旧.id → 新.id 映射。
 */
export function buildRemap<TOld extends HasId, TNew extends HasId>(
  oldRows: TOld[],
  newRows: TNew[],
  keyFn: (row: TOld | TNew) => string,
): Remap {
  const newByKey = new Map<string, number>()
  for (const r of newRows) newByKey.set(keyFn(r), r.id)

  const map = new Map<number, number>()
  const unmatched: number[] = []
  for (const r of oldRows) {
    const newId = newByKey.get(keyFn(r))
    if (newId === undefined) unmatched.push(r.id)
    else map.set(r.id, newId)
  }

  return {
    get: oldId => map.get(oldId),
    unmatchedOldIds: () => [...unmatched],
  }
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/idRemap.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add legacy-migration/src/idRemap.ts legacy-migration/tests/idRemap.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): 配置外键 ID 重映射
EOF
)"
```

---

## Task 8: 序列重置 sequenceReset.ts

**Files:**
- Create: `legacy-migration/src/sequenceReset.ts`

保留旧 ID 插入后，必须把自增序列推到 `MAX(id)`（设计文档 §6.1），否则新数据写入会主键冲突。DB 绑定，由 Task 12 / 计划二验证。

- [ ] **Step 1: 实现 `sequenceReset.ts`**

```ts
import type { RawDb } from './progress'
import { log } from './logger'

/**
 * 把单张表的自增主键序列重置到当前 MAX(id)。
 * 表无行时 setval 到 1。
 */
export async function resetSequence(db: RawDb, table: string): Promise<void> {
  await db.$executeRawUnsafe(
    `SELECT setval(
       pg_get_serial_sequence($1, 'id'),
       GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${table}"), 1)
     )`,
    table,
  )
  log(`[sequenceReset] ${table} 序列已重置`)
}

/** 批量重置多张表的序列 */
export async function resetSequences(db: RawDb, tables: string[]): Promise<void> {
  for (const t of tables) await resetSequence(db, t)
}
```

> `setval` 的第二参数是字面量插值的表名（来自固定的内部表清单，非外部输入，无注入风险）；`pg_get_serial_sequence` 的表名参数走 `$1` 占位符。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add legacy-migration/src/sequenceReset.ts
git commit -m "$(cat <<'EOF'
feat(migration): 自增序列重置工具
EOF
)"
```

---

## Task 9: 通用分批迁移执行器 runner.ts

**Files:**
- Create: `legacy-migration/src/runner.ts`
- Test: `legacy-migration/tests/runner.test.ts`

执行器是迁移核心，实现设计文档 §6.3 + §12 的三层错误模型与熔断。读/转换/写均由调用方注入，执行器只负责分批、续跑、错误处理、统计——因此可用假依赖完整单元测试。

- [ ] **Step 1: 写失败测试**

`legacy-migration/tests/runner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ExceptionCollector } from '../src/exceptions'
import { runMigration, type MigratorSpec, type RunnerDeps } from '../src/runner'

/** 进度表假对象：getLastId 恒返回 0，setProgress 记录调用 */
function fakeDb() {
  return {
    $executeRawUnsafe: vi.fn(async () => 0),
    $queryRawUnsafe: vi.fn(async () => [] as never[]),
  }
}

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    newDb: fakeDb(),
    exceptions: new ExceptionCollector(),
    batchSize: 2,
    failureRateThreshold: 0.5,
    ...over,
  }
}

type Old = { id: number; bad?: 'throw' | 'skip' }

/** 给定旧行集合，构造一个按 id 升序分批读取的 readBatch */
function readBatchOf(rows: Old[]) {
  return async (afterId: number, limit: number) =>
    rows.filter(r => r.id > afterId).slice(0, limit)
}

describe('runMigration', () => {
  it('全部成功：分批读取、写入、统计', async () => {
    const rows: Old[] = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const written: number[][] = []
    const spec: MigratorSpec<Old, number> = {
      table: 't',
      readBatch: readBatchOf(rows),
      oldId: o => o.id,
      transform: async o => ({ unit: o.id }),
      writeBatch: async units => { written.push(units) },
    }
    const r = await runMigration(spec, deps())
    expect(r.read).toBe(3)
    expect(r.succeeded).toBe(3)
    expect(r.skipped).toBe(0)
    expect([...r.migratedIds].sort()).toEqual([1, 2, 3])
    expect(written.flat()).toEqual([1, 2, 3])
  })

  it('行级错误：转换抛错 / 返回 skip 的行被跳过并记入异常清单，其余继续', async () => {
    const rows: Old[] = [{ id: 1 }, { id: 2, bad: 'throw' }, { id: 3, bad: 'skip' }, { id: 4 }]
    const exceptions = new ExceptionCollector()
    const spec: MigratorSpec<Old, number> = {
      table: 't',
      readBatch: readBatchOf(rows),
      oldId: o => o.id,
      transform: async o => {
        if (o.bad === 'throw') throw new Error('boom')
        if (o.bad === 'skip') return { skip: '业务规则跳过' }
        return { unit: o.id }
      },
      writeBatch: async () => {},
    }
    const r = await runMigration(spec, deps({ exceptions }))
    expect(r.succeeded).toBe(2)
    expect(r.skipped).toBe(2)
    expect(exceptions.countByTable('t')).toBe(2)
  })

  it('批级失败：writeBatch 整批抛错时降级逐行，隔离坏行', async () => {
    const rows: Old[] = [{ id: 1 }, { id: 2 }]
    const exceptions = new ExceptionCollector()
    const spec: MigratorSpec<Old, number> = {
      table: 't',
      readBatch: readBatchOf(rows),
      oldId: o => o.id,
      transform: async o => ({ unit: o.id }),
      // 整批（length>1）抛错；逐行（length===1）时 id=2 抛错
      writeBatch: async units => {
        if (units.length > 1) throw new Error('batch failed')
        if (units[0] === 2) throw new Error('row 2 bad')
      },
    }
    const r = await runMigration(spec, deps({ exceptions }))
    expect(r.succeeded).toBe(1)
    expect(r.skipped).toBe(1)
    expect(exceptions.countByTable('t')).toBe(1)
  })

  it('熔断：失败率超阈值时抛错中止', async () => {
    const rows: Old[] = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, bad: 'throw' as const }))
    const spec: MigratorSpec<Old, number> = {
      table: 't',
      readBatch: readBatchOf(rows),
      oldId: o => o.id,
      transform: async () => { throw new Error('always bad') },
      writeBatch: async () => {},
    }
    await expect(runMigration(spec, deps({ batchSize: 50 }))).rejects.toThrow(/失败率/)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/runner.test.ts`
Expected: FAIL（`runMigration` 未定义）。

- [ ] **Step 3: 实现 `runner.ts`**

```ts
import type { ExceptionCollector } from './exceptions'
import { log } from './logger'
import { getLastId, type RawDb, setProgress } from './progress'

/** 转换输出：写入单元，或带原因的跳过 */
export type TransformOutput<TUnit> = { unit: TUnit } | { skip: string }

export interface MigratorSpec<TOld, TUnit> {
  /** 目标表名（同时作为进度 key 与异常清单分类名） */
  table: string
  /** 读取一批旧行：id > afterId，按 id 升序，最多 limit 条 */
  readBatch: (afterId: number, limit: number) => Promise<TOld[]>
  /** 取旧行主键 id */
  oldId: (old: TOld) => number
  /** 转换单行旧数据 → 写入单元或跳过 */
  transform: (old: TOld) => Promise<TransformOutput<TUnit>>
  /** 写入一批写入单元（内部决定写入哪些表） */
  writeBatch: (units: TUnit[]) => Promise<void>
}

export interface RunnerDeps {
  /** 新库（用于进度表读写） */
  newDb: RawDb
  /** 异常清单收集器 */
  exceptions: ExceptionCollector
  /** 每批行数 */
  batchSize: number
  /** 失败率熔断阈值（0~1） */
  failureRateThreshold: number
}

export interface MigrationResult {
  table: string
  read: number
  succeeded: number
  skipped: number
  /** 成功迁移的旧行 id 集合（供子表外键预校验，仅本次运行内有效） */
  migratedIds: Set<number>
}

/** 本批熔断检查的最小样本量——样本太小时失败率没有统计意义 */
const CIRCUIT_MIN_SAMPLE = 100

export async function runMigration<TOld, TUnit>(
  spec: MigratorSpec<TOld, TUnit>,
  deps: RunnerDeps,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    table: spec.table,
    read: 0,
    succeeded: 0,
    skipped: 0,
    migratedIds: new Set<number>(),
  }

  let afterId = await getLastId(deps.newDb, spec.table)
  log(`[${spec.table}] 开始迁移，从 id > ${afterId}`)

  for (;;) {
    // ③ 致命错误：readBatch 抛出的异常不在此 catch，向上传播 → 编排层中止、可 --resume
    const oldRows = await spec.readBatch(afterId, deps.batchSize)
    if (oldRows.length === 0) break
    result.read += oldRows.length

    // ① 行级转换：单行失败只跳过该行
    const units: { unit: TUnit; oldId: number }[] = []
    for (const old of oldRows) {
      const id = spec.oldId(old)
      try {
        const out = await spec.transform(old)
        if ('skip' in out) {
          result.skipped++
          deps.exceptions.add(spec.table, id, out.skip)
        } else {
          units.push({ unit: out.unit, oldId: id })
        }
      } catch (e) {
        result.skipped++
        deps.exceptions.add(spec.table, id, `转换异常：${(e as Error).message}`)
      }
    }

    // ② 批级失败：整批写入失败时降级为逐行写入，隔离坏行
    if (units.length > 0) {
      try {
        await spec.writeBatch(units.map(u => u.unit))
        for (const u of units) {
          result.succeeded++
          result.migratedIds.add(u.oldId)
        }
      } catch {
        log(`[${spec.table}] 批量写入失败，降级逐行插入定位坏行`)
        for (const u of units) {
          try {
            await spec.writeBatch([u.unit])
            result.succeeded++
            result.migratedIds.add(u.oldId)
          } catch (e) {
            result.skipped++
            deps.exceptions.add(spec.table, u.oldId, `写入失败：${(e as Error).message}`)
          }
        }
      }
    }

    afterId = spec.oldId(oldRows[oldRows.length - 1]!)
    await setProgress(deps.newDb, spec.table, afterId, 'running')

    // ④ 熔断：失败率异常高通常意味脚本 bug，主动中止
    if (
      result.read >= CIRCUIT_MIN_SAMPLE &&
      result.skipped / result.read > deps.failureRateThreshold
    ) {
      throw new Error(
        `[${spec.table}] 失败率 ${(result.skipped / result.read * 100).toFixed(1)}% ` +
        `超过阈值 ${(deps.failureRateThreshold * 100).toFixed(0)}%，疑似脚本 bug，已中止`,
      )
    }
  }

  await setProgress(deps.newDb, spec.table, afterId, 'done')
  log(`[${spec.table}] 完成：读取 ${result.read} / 成功 ${result.succeeded} / 跳过 ${result.skipped}`)
  return result
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx vitest run --config legacy-migration/vitest.config.ts tests/runner.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 提交**

```bash
git add legacy-migration/src/runner.ts legacy-migration/tests/runner.test.ts
git commit -m "$(cat <<'EOF'
feat(migration): 通用分批迁移执行器（三层错误模型 + 熔断）
EOF
)"
```

---

## Task 10: Preflight 上线前扫描 preflight.ts

**Files:**
- Create: `legacy-migration/src/preflight.ts`

实现设计文档 §16 的 8 项扫描。每项扫描查旧库（个别项查新库），输出告警清单。DB 绑定，由 Task 12 冒烟验证。

- [ ] **Step 1: 实现 `preflight.ts`**

```ts
import type { LegacyPrismaClient, NewPrismaClient } from './clients'
import { log, warn } from './logger'

export interface ScanResult {
  name: string
  status: 'ok' | 'warn'
  detail: string
}

/** 在旧库统计某 SQL 的计数（SQL 须返回单列单行 bigint） */
async function legacyCount(legacy: LegacyPrismaClient, sql: string): Promise<number> {
  const rows = await legacy.$queryRawUnsafe<{ n: bigint | number }>(sql)
  return rows[0] ? Number(rows[0].n) : 0
}

/** 1. 唯一约束冲突：users.username / users.email 重复非空值；oss_files (user,bucket,path) 重复 */
async function scanUniqueConflicts(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const dupUsername = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM (
      SELECT username FROM users WHERE username IS NOT NULL
      GROUP BY username HAVING count(*) > 1
    ) t`)
  const dupEmail = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM (
      SELECT email FROM users WHERE email IS NOT NULL
      GROUP BY email HAVING count(*) > 1
    ) t`)
  const dupOss = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM (
      SELECT user_id, bucket_name, file_path FROM oss_files
      WHERE file_path IS NOT NULL
      GROUP BY user_id, bucket_name, file_path HAVING count(*) > 1
    ) t`)
  const bad = dupUsername + dupEmail + dupOss
  return {
    name: '唯一约束冲突',
    status: bad === 0 ? 'ok' : 'warn',
    detail: `username 重复值 ${dupUsername} 组、email 重复值 ${dupEmail} 组、oss_files(user,bucket,path) 重复 ${dupOss} 组`,
  }
}

/** 2. 类型收窄：orderNo≤32 / redemption code≤32 / transactionId≤64 / imageType≤50 */
async function scanFieldLength(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const orderNo = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM payment_orders WHERE length(order_no) > 32`)
  const code = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM redemption_codes WHERE length(code) > 32`)
  const txId = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM payment_transactions WHERE length(transaction_id) > 64`)
  const imgType = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM image_recognition_records WHERE length(image_type) > 50`)
  const bad = orderNo + code + txId + imgType
  return {
    name: '类型收窄',
    status: bad === 0 ? 'ok' : 'warn',
    detail: `超长行数 — order_no:${orderNo} redemption code:${code} transaction_id:${txId} image_type:${imgType}`,
  }
}

/** 3. 视频材料：case_materials type=5（新库无对应类型） */
async function scanVideoMaterials(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const n = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM case_materials WHERE type = 5`)
  return {
    name: '视频材料',
    status: n === 0 ? 'ok' : 'warn',
    detail: `case_materials type=5（视频）共 ${n} 行，新库无对应类型，需用户决定处理方式`,
  }
}

/** 4. 配置匹配预检：旧配置表的 name 是否都能在新库找到对应 */
async function scanConfigMatch(legacy: LegacyPrismaClient, next: NewPrismaClient): Promise<ScanResult> {
  // [旧表名, 旧 name 列, 新表名, 新 name 列]
  const pairs: [string, string, string, string][] = [
    ['case_type', 'name', 'case_types', 'name'],
    ['membership_levels', 'name', 'membership_levels', 'name'],
    ['products', 'name', 'products', 'name'],
    ['analysis_modules', 'name', 'nodes', 'name'],
    ['point_consumption_items', 'name', 'point_consumption_items', 'name'],
    ['benefits', 'name', 'benefits', 'name'],
  ]
  const misses: string[] = []
  for (const [oldTable, oldCol, newTable, newCol] of pairs) {
    const oldRows = await legacy.$queryRawUnsafe<{ v: string }>(
      `SELECT DISTINCT ${oldCol} AS v FROM "${oldTable}" WHERE deleted_at IS NULL`,
    )
    const newRows = await next.$queryRawUnsafe<{ v: string }>(
      `SELECT DISTINCT ${newCol} AS v FROM "${newTable}" WHERE deleted_at IS NULL`,
    )
    const newSet = new Set(newRows.map(r => r.v))
    const unmatched = oldRows.map(r => r.v).filter(v => !newSet.has(v))
    if (unmatched.length > 0) misses.push(`${oldTable}→${newTable}: ${unmatched.join('、')}`)
  }
  return {
    name: '配置匹配预检',
    status: misses.length === 0 ? 'ok' : 'warn',
    detail: misses.length === 0 ? '旧配置名称在新库均有对应' : `失配：${misses.join('；')}`,
  }
}

/** 5. 必填外键空值：membership_upgrade_records 关键外键为 null */
async function scanUpgradeNullFk(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const n = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM membership_upgrade_records
    WHERE to_membership_id IS NULL OR payment_order_id IS NULL`)
  return {
    name: '会员升级记录缺关键外键',
    status: n === 0 ? 'ok' : 'warn',
    detail: `to_membership_id 或 payment_order_id 为 null 的行 ${n} 条，迁移时将跳过`,
  }
}

/** 6. case_analyses 缺口：sessionId 为空；analysisType 在新 nodes 无匹配 */
async function scanCaseAnalysesGap(legacy: LegacyPrismaClient, next: NewPrismaClient): Promise<ScanResult> {
  const nullSession = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM case_analyses WHERE session_id IS NULL`)
  const oldTypes = await legacy.$queryRawUnsafe<{ v: string }>(
    `SELECT DISTINCT analysis_type AS v FROM case_analyses WHERE deleted_at IS NULL`,
  )
  const newNodes = await next.$queryRawUnsafe<{ v: string }>(
    `SELECT DISTINCT name AS v FROM nodes WHERE deleted_at IS NULL`,
  )
  const nodeSet = new Set(newNodes.map(r => r.v))
  const unmatchedTypes = oldTypes.map(r => r.v).filter(v => !nodeSet.has(v))
  return {
    name: 'case_analyses 缺口',
    status: nullSession === 0 && unmatchedTypes.length === 0 ? 'ok' : 'warn',
    detail: `session_id 为空 ${nullSession} 行；analysisType 无匹配节点：${unmatchedTypes.join('、') || '无'}`,
  }
}

/** 7. NULL 时间戳：11 张迁移表 created_at/updated_at 为 null（旧可空、新必填） */
async function scanNullTimestamps(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const tables = [
    'user_memberships', 'user_benefits', 'redemption_codes', 'redemption_records',
    'payment_orders', 'membership_upgrade_records', 'asr_records', 'asr_tasks',
    'doc_recognition_records', 'image_recognition_records', 'case_analyses',
  ]
  const hits: string[] = []
  for (const t of tables) {
    const n = await legacyCount(legacy, `SELECT count(*)::bigint AS n FROM "${t}" WHERE created_at IS NULL OR updated_at IS NULL`)
    if (n > 0) hits.push(`${t}:${n}`)
  }
  return {
    name: 'NULL 时间戳',
    status: hits.length === 0 ? 'ok' : 'warn',
    detail: hits.length === 0 ? '无 NULL 时间戳' : `存在 NULL 时间戳（迁移时按规则兜底）：${hits.join(' ')}`,
  }
}

/** 8. 重复激活版本：case_analyses 同 caseId+analysisType 多条 isActive=1 */
async function scanDuplicateActive(legacy: LegacyPrismaClient): Promise<ScanResult> {
  const n = await legacyCount(legacy, `
    SELECT count(*)::bigint AS n FROM (
      SELECT case_id, analysis_type FROM case_analyses
      WHERE is_active = 1 AND deleted_at IS NULL
      GROUP BY case_id, analysis_type HAVING count(*) > 1
    ) t`)
  return {
    name: '重复激活版本',
    status: n === 0 ? 'ok' : 'warn',
    detail: `同 case+analysisType 多条 isActive=1 的组 ${n} 个（不阻塞迁移，需业务确认）`,
  }
}

/** 跑全部 8 项扫描，打印结果，返回结果数组 */
export async function runPreflight(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
): Promise<ScanResult[]> {
  const results: ScanResult[] = [
    await scanUniqueConflicts(legacy),
    await scanFieldLength(legacy),
    await scanVideoMaterials(legacy),
    await scanConfigMatch(legacy, next),
    await scanUpgradeNullFk(legacy),
    await scanCaseAnalysesGap(legacy, next),
    await scanNullTimestamps(legacy),
    await scanDuplicateActive(legacy),
  ]
  log('===== Preflight 扫描结果 =====')
  for (const r of results) {
    const line = `[${r.status === 'ok' ? 'OK  ' : 'WARN'}] ${r.name} — ${r.detail}`
    if (r.status === 'warn') warn(line)
    else log(line)
  }
  const warnCount = results.filter(r => r.status === 'warn').length
  log(`===== 共 ${results.length} 项，${warnCount} 项需关注 =====`)
  return results
}
```

> 表名 / 列名插值来自固定的内部清单（非外部输入），无注入风险。`deleted_at` 列在涉及的旧配置表（`case_type`/`membership_levels`/`products`/`analysis_modules`/`point_consumption_items`/`benefits`/`case_analyses`）均存在。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add legacy-migration/src/preflight.ts
git commit -m "$(cat <<'EOF'
feat(migration): preflight 上线前 8 项扫描
EOF
)"
```

---

## Task 11: CLI 入口 index.ts

**Files:**
- Create: `legacy-migration/src/index.ts`

本计划只实现 `preflight` 命令；`migrate`/`verify` 在后续计划补。

- [ ] **Step 1: 实现 `index.ts`**

```ts
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { createLegacyClient, createNewClient } from './clients'
import { loadConfig } from './config'
import { log, logError } from './logger'
import { runPreflight } from './preflight'

async function cmdPreflight(): Promise<void> {
  const cfg = loadConfig()
  const legacy = createLegacyClient(cfg.legacyDatabaseUrl)
  const next = createNewClient(cfg.newDatabaseUrl)
  try {
    const results = await runPreflight(legacy, next)
    const reportPath = 'legacy-migration/reports/preflight.json'
    writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8')
    log(`扫描报告已写入 ${reportPath}`)
  } finally {
    await legacy.$disconnect()
    await next.$disconnect()
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2]
  switch (cmd) {
    case 'preflight':
      await cmdPreflight()
      break
    default:
      logError(`未知命令：${cmd ?? '(空)'}。可用命令：preflight`)
      process.exitCode = 1
  }
}

main().catch(e => {
  logError((e as Error).stack ?? String(e))
  process.exitCode = 1
})
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add legacy-migration/src/index.ts
git commit -m "$(cat <<'EOF'
feat(migration): CLI 入口与 preflight 命令
EOF
)"
```

---

## Task 12: 全量测试 + Preflight 冒烟运行

**Files:**
- Modify: `legacy-migration/README.md`（补充 preflight 命令的实际用法）

- [ ] **Step 1: 跑全部单元测试**

Run: `npx vitest run --config legacy-migration/vitest.config.ts`
Expected: PASS（config 2 + exceptions 3 + idRemap 3 + runner 4 = 12 个用例）。

- [ ] **Step 2: 类型检查整个工具**

Run: `npx tsc --noEmit --project legacy-migration/tsconfig.json`
Expected: 无错误。

- [ ] **Step 3: 准备冒烟环境**

- 用旧库（LexSeekApi 生产库）的备份在本地恢复出一个测试库。
- 在仓库根 `.env` 临时追加 `LEGACY_DATABASE_URL=<测试库连接串>`，确认 `DATABASE_URL` 指向一个已 `prisma migrate deploy` + 导入 seedData 的新库（用于配置匹配预检）。

- [ ] **Step 4: 跑 preflight 冒烟**

Run（从仓库根目录）: `npx tsx legacy-migration/src/index.ts preflight`
Expected: 控制台打印 8 项扫描结果，`legacy-migration/reports/preflight.json` 生成。检查每项 detail 是否合理（数据库连接成功、计数非报错）。

> 这是计划一唯一的真实库验证步骤——它同时验证了 `clients`/`progress` 之外的 DB 连接链路与 8 项扫描 SQL 的正确性。扫描出的 warn 项即设计文档 §16 要求在演练阶段处理的问题，记录下来供计划二/演练阶段使用。

- [ ] **Step 5: 完善 README**

在 `legacy-migration/README.md` 的"命令"小节确认 preflight 用法描述与实际一致；补一行"preflight 报告输出到 `reports/preflight.json`"。

- [ ] **Step 6: 提交**

```bash
git add legacy-migration/README.md
git commit -m "$(cat <<'EOF'
docs(migration): 补充 preflight 使用说明
EOF
)"
```

---

## 自审记录

- **设计文档覆盖**：本计划对应设计文档 §5（工具结构）、§6.1–6.3（保留 ID / 重映射 / 幂等续跑）、§6.4 留待计划二、§10（重映射的纯函数部分）、§12（三层错误模型 → runner）、§16（preflight 8 项扫描）。逐表转换（§7–§9）、校验（§13）、向量重嵌入（§11）属计划二/三，不在本计划范围。
- **占位符扫描**：无 TBD / TODO；每个代码步骤含完整可运行代码。
- **类型一致性**：`RawDb` 在 `progress.ts` 定义、被 `runner.ts`/`sequenceReset.ts` 复用；`MigratorSpec`/`TransformOutput`/`RunnerDeps`/`MigrationResult` 在 `runner.ts` 定义并在 runner 测试中按相同签名使用；`LegacyPrismaClient`/`NewPrismaClient` 在 `clients.ts` 导出、被 `preflight.ts` 引用。
- **范围**：本计划产出可独立运行、可测试的成果——`preflight` 命令可对旧库备份直接运行。计划二（逐表迁移 + 编排）依赖本计划的 `runner`/`idRemap`/`progress`/`exceptions`/`clients`/`sequenceReset`。
