# 办案工具重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 10 个办案工具计算器从「数据重复 + 算法复刻 + UI 粘贴 + Agent 缺位」状态，重构为「单一数据源（含后台维护）+ 通用算法 + Agent 工具暴露 + 共用 UI 组件」的清晰四层架构

**Architecture:** 四层金字塔，自下而上 PR 推进：PR1 数据层（PR1a 利率库化 + PR1b 后台 CRUD + PR1c 其他常量集中）→ PR2 算法层（applyBrackets / calculateSegmentedInterest / findRateForDate / roundToCents）→ PR3 Agent 工具层（10 个 *.tool.ts）→ PR4 UI 层（4 个共用组件）

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Prisma + PostgreSQL + Tailwind v4 + shadcn-vue + LangChain `@langchain/core/tools` + zod + Vitest + Decimal.js

**测试基线契约:** 每个 PR 完成后必须保持现有 601 个测试 + 15 个文件 100% 覆盖率全绿。命令：`npx vitest run tests/shared/utils/tools/ --coverage`

**Spec:** [docs/superpowers/specs/2026-05-14-tools-refactor-design.md](../specs/2026-05-14-tools-refactor-design.md)

---

## 文件结构总览

### 新建文件

```
prisma/models/rates.prisma                                   # PR1a
shared/types/agentTools.ts                                   # PR3
shared/utils/tools/data/
  ├── index.ts                                               # PR1a/PR1c
  ├── lpr.ts                                                 # PR1a
  ├── pbocDepositRates.ts                                    # PR1a
  ├── pbocLoanRates.ts                                       # PR1a
  ├── feeBrackets.ts                                         # PR1c
  ├── socialInsuranceRates.ts                                # PR1c
  ├── overtimeRules.ts                                       # PR1c
  └── README.md                                              # PR1c
shared/utils/tools/algorithms/
  ├── index.ts                                               # PR2
  ├── applyBrackets.ts                                       # PR2
  ├── calculateSegmentedInterest.ts                          # PR2
  ├── findRateForDate.ts                                     # PR2
  ├── roundToCents.ts                                        # PR2
  └── README.md                                              # PR2
shared/utils/tools/agentTools/
  ├── index.ts                                               # PR3
  ├── delayInterestCalculator.tool.ts                        # PR3
  ├── interestCalculator.tool.ts                             # PR3
  ├── courtFeeCalculator.tool.ts                             # PR3
  ├── lawyerFeeCalculator.tool.ts                            # PR3
  ├── compensationCalculator.tool.ts                         # PR3
  ├── overtimePayCalculator.tool.ts                          # PR3
  ├── socialInsuranceCalculator.tool.ts                      # PR3
  ├── divorcePropertyCalculator.tool.ts                      # PR3
  ├── bankRateQuery.tool.ts                                  # PR3
  └── dateCalculator.tool.ts                                 # PR3
server/services/rates/
  ├── rates.dao.ts                                           # PR1a
  └── rates.service.ts                                       # PR1a
server/api/v1/tools/rates/
  ├── lpr.get.ts                                             # PR1a
  ├── pboc-deposit.get.ts                                    # PR1a
  └── pboc-loan.get.ts                                       # PR1a
server/api/v1/admin/rates/lpr/
  ├── index.get.ts                                           # PR1a
  ├── index.post.ts                                          # PR1a
  ├── [id].patch.ts                                          # PR1a
  └── [id].delete.ts                                         # PR1a
server/api/v1/admin/rates/pboc-deposit/{4 files}             # PR1a
server/api/v1/admin/rates/pboc-loan/{4 files}                # PR1a
server/plugins/rates-cache.ts                                # PR1a
app/composables/useToolsRates.ts                             # PR1a
app/pages/admin/rates/
  ├── index.vue                                              # PR1b
  ├── lpr.vue                                                # PR1b
  ├── pboc-deposit.vue                                       # PR1b
  └── pboc-loan.vue                                          # PR1b
app/components/admin/rates/
  ├── LPRFormDialog.vue                                      # PR1b
  ├── PbocDepositFormDialog.vue                              # PR1b
  └── PbocLoanFormDialog.vue                                 # PR1b
app/components/tools/
  ├── CalculatorPageHeader.vue                               # PR4
  ├── DateInput.vue                                          # PR4
  ├── MoneyInput.vue                                         # PR4
  └── ResultCard.vue                                         # PR4
tests/server/services/rates/                                 # PR1a
  ├── rates.dao.test.ts
  └── rates.service.test.ts
tests/server/api/v1/admin/rates/                             # PR1a/PR1b
  └── *.test.ts
tests/shared/utils/tools/algorithms/                         # PR2
  ├── applyBrackets.test.ts
  ├── calculateSegmentedInterest.test.ts
  ├── findRateForDate.test.ts
  └── roundToCents.test.ts
tests/shared/utils/tools/agentTools/                         # PR3
  └── *.tool.test.ts (10 个)
tests/server/agents/legal-assistant/
  └── calculator-tools.e2e.test.ts                           # PR3
```

### 修改文件

```
shared/types/tools.ts                                        # PR1a 加 LPRRate/PBOCDepositRate/PBOCLoanRate 类型
shared/utils/tools/bankRateService.ts                        # PR1c 改 import getXxxRates
shared/utils/tools/interestService.ts                        # PR1c+PR2 改 import + 用算法层
shared/utils/tools/delayInterestService.ts                   # PR2 用 calculateSegmentedInterest
shared/utils/tools/courtFeeService.ts                        # PR1c+PR2 改用 applyBrackets
shared/utils/tools/lawyerFeeService.ts                       # PR1c+PR2 改用 applyBrackets
shared/utils/tools/arbitrationFeeService.ts                  # PR1c+PR2 改用 applyBrackets
shared/utils/tools/socialInsuranceService.ts                 # PR1c 改 import defaultRates
shared/utils/tools/overtimePayService.ts                     # PR1c 改 import overtimeRules
server/services/agent-platform/tools/types.ts                # PR3 改为 re-export shared/types/agentTools
prisma/seeds/seedData.sql                                    # PR1a/PR1b/PR3 追加 INSERT
app/pages/dashboard/tools/*.vue (10 个)                       # PR4 用共用组件 + formatRMB
```

---

# PR1a · 利率数据库化 + 服务端 API（2 天）

## 任务 PR1a-T1：定义类型基础

**Files:**
- Modify: `shared/types/tools.ts`

- [ ] **Step 1: 在 `shared/types/tools.ts` 文件末尾追加三个利率类型**

```typescript
/**
 * LPR 利率（央行每月公布）
 *
 * - date：央行公布生效日，YYYY-MM-DD
 * - oneYear：1 年期 LPR (%)
 * - fiveYear：5 年期以上 LPR (%)
 */
export interface LPRRate {
    date: string
    oneYear: number
    fiveYear: number
}

/** 央行存款基准利率 */
export interface PBOCDepositRate {
    date: string
    demand: number       // 活期
    threeMonths: number  // 三个月
    sixMonths: number    // 六个月
    oneYear: number      // 一年
    twoYear: number      // 二年
    threeYear: number    // 三年
    fiveYear: number     // 五年
}

/** 央行贷款基准利率 */
export interface PBOCLoanRate {
    date: string
    sixMonths: number
    oneYear: number
    oneToFiveYear: number
    fiveYearPlus: number
}
```

- [ ] **Step 2: 验证类型导入路径**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add shared/types/tools.ts
git commit -m "feat(tools): 新增 LPRRate / PBOCDepositRate / PBOCLoanRate 类型"
```

---

## 任务 PR1a-T2：创建 prisma schema

**Files:**
- Create: `prisma/models/rates.prisma`

- [ ] **Step 1: 创建文件 `prisma/models/rates.prisma`**

```prisma
/// LPR 利率历史（央行每月公布）
model lpr_rates {
  /// 主键
  id          Int       @id @default(autoincrement())
  /// 生效日（央行公布日），仅日期精度
  effectDate  DateTime  @unique @map("effect_date") @db.Date
  /// 1 年期 LPR (%)
  oneYear     Decimal   @map("one_year")    @db.Decimal(6, 4)
  /// 5 年期以上 LPR (%)
  fiveYear    Decimal   @map("five_year")   @db.Decimal(6, 4)
  /// 备注（可选）
  remark      String?   @db.VarChar(255)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  /// 软删除时间戳，NULL 表示有效
  deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(6)
  @@index([effectDate(sort: Desc)])
  @@index([deletedAt])
}

/// 央行存款基准利率历史
model pboc_deposit_rates {
  id           Int       @id @default(autoincrement())
  effectDate   DateTime  @unique @map("effect_date") @db.Date
  /// 活期 (%)
  demand       Decimal   @db.Decimal(6, 4)
  /// 三个月 (%)
  threeMonths  Decimal   @map("three_months") @db.Decimal(6, 4)
  /// 六个月 (%)
  sixMonths    Decimal   @map("six_months")   @db.Decimal(6, 4)
  /// 一年 (%)
  oneYear      Decimal   @map("one_year")     @db.Decimal(6, 4)
  /// 二年 (%)
  twoYear      Decimal   @map("two_year")     @db.Decimal(6, 4)
  /// 三年 (%)
  threeYear    Decimal   @map("three_year")   @db.Decimal(6, 4)
  /// 五年 (%)
  fiveYear     Decimal   @map("five_year")    @db.Decimal(6, 4)
  remark       String?   @db.VarChar(255)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz(6)
  @@index([effectDate(sort: Desc)])
  @@index([deletedAt])
}

/// 央行贷款基准利率历史
model pboc_loan_rates {
  id            Int       @id @default(autoincrement())
  effectDate    DateTime  @unique @map("effect_date") @db.Date
  /// 六个月 (%)
  sixMonths     Decimal   @map("six_months")     @db.Decimal(6, 4)
  /// 一年 (%)
  oneYear       Decimal   @map("one_year")       @db.Decimal(6, 4)
  /// 一至五年 (%)
  oneToFiveYear Decimal   @map("one_to_five")    @db.Decimal(6, 4)
  /// 五年以上 (%)
  fiveYearPlus  Decimal   @map("five_year_plus") @db.Decimal(6, 4)
  remark        String?   @db.VarChar(255)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt     DateTime? @map("deleted_at") @db.Timestamptz(6)
  @@index([effectDate(sort: Desc)])
  @@index([deletedAt])
}
```

- [ ] **Step 2: 运行 prisma migrate 生成迁移**

Run: `bun run prisma:migrate --name init_rates_tables`
Expected: 在 `prisma/migrations/` 下生成新目录 `<timestamp>_init_rates_tables/`，含 `migration.sql`，无错误

- [ ] **Step 3: 验证 prisma client 已重新生成**

Run: `grep -c "lpr_rates\|pboc_deposit_rates\|pboc_loan_rates" generated/prisma/client/index.d.ts`
Expected: 数字 ≥ 6（三张表至少各出现 2 次）

- [ ] **Step 4: Commit**

```bash
git add prisma/models/rates.prisma prisma/migrations/ generated/prisma/
git commit -m "feat(db): 新增 lpr_rates / pboc_deposit_rates / pboc_loan_rates 三张利率表"
```

---

## 任务 PR1a-T3：写入初始历史数据到 seedData.sql

**Files:**
- Modify: `prisma/seeds/seedData.sql`

- [ ] **Step 1: 找到 seedData.sql 中合适的插入位置（在 nodes 之前，按表名字母序排）并追加 LPR 历史 INSERT**

在文件末尾追加（86 条 LPR 历史；数据来源：当前 `shared/utils/tools/bankRateService.ts` 的 `bankRates.lpr` 数组）：

```sql
-- ============ 利率表初始数据 ============

-- LPR 利率（来源：bankRateService.ts，央行公布日生效）
INSERT INTO "public"."lpr_rates" ("effect_date", "one_year", "five_year") VALUES
  ('2025-07-21', 3.00, 3.50),
  ('2025-06-20', 3.00, 3.50),
  ('2025-05-20', 3.00, 3.50),
  ('2025-04-20', 3.10, 3.60),
  ('2025-03-20', 3.10, 3.60),
  ('2025-02-20', 3.10, 3.60),
  ('2025-01-20', 3.10, 3.60),
  ('2024-12-20', 3.10, 3.60),
  ('2024-11-20', 3.10, 3.60),
  ('2024-10-21', 3.10, 3.60),
  ('2024-09-20', 3.35, 3.85),
  ('2024-08-20', 3.35, 3.85),
  ('2024-07-22', 3.35, 3.85),
  ('2024-06-20', 3.45, 3.95),
  ('2024-05-20', 3.45, 3.95),
  ('2024-04-22', 3.45, 3.95),
  ('2024-03-20', 3.45, 3.95),
  ('2024-02-20', 3.45, 3.95),
  ('2024-01-22', 3.45, 4.20),
  ('2023-12-20', 3.45, 4.20),
  ('2023-11-20', 3.45, 4.20),
  ('2023-10-20', 3.45, 4.20),
  ('2023-09-20', 3.45, 4.20),
  ('2023-08-21', 3.45, 4.20),
  ('2023-07-20', 3.55, 4.20),
  ('2023-06-20', 3.55, 4.20),
  ('2023-05-22', 3.65, 4.30),
  ('2023-04-20', 3.65, 4.30),
  ('2023-03-20', 3.65, 4.30),
  ('2023-02-20', 3.65, 4.30),
  ('2023-01-20', 3.65, 4.30),
  ('2022-12-20', 3.65, 4.30),
  ('2022-11-21', 3.65, 4.30),
  ('2022-10-20', 3.65, 4.30),
  ('2022-09-20', 3.65, 4.30),
  ('2022-08-22', 3.65, 4.30),
  ('2022-07-20', 3.70, 4.45),
  ('2022-06-20', 3.70, 4.45),
  ('2022-05-20', 3.70, 4.45),
  ('2022-04-20', 3.70, 4.60),
  ('2022-03-21', 3.70, 4.60),
  ('2022-02-21', 3.70, 4.60),
  ('2022-01-20', 3.70, 4.60),
  ('2021-12-20', 3.80, 4.65),
  ('2021-11-22', 3.85, 4.65),
  ('2021-10-20', 3.85, 4.65),
  ('2021-09-22', 3.85, 4.65),
  ('2021-08-20', 3.85, 4.65),
  ('2021-07-20', 3.85, 4.65),
  ('2021-06-21', 3.85, 4.65),
  ('2021-05-20', 3.85, 4.65),
  ('2021-04-20', 3.85, 4.65),
  ('2021-03-22', 3.85, 4.65),
  ('2021-02-20', 3.85, 4.65),
  ('2021-01-20', 3.85, 4.65),
  ('2020-12-21', 3.85, 4.65),
  ('2020-11-20', 3.85, 4.65),
  ('2020-10-20', 3.85, 4.65),
  ('2020-09-21', 3.85, 4.65),
  ('2020-08-20', 3.85, 4.65),
  ('2020-07-20', 3.85, 4.65),
  ('2020-06-22', 3.85, 4.65),
  ('2020-05-20', 3.85, 4.65),
  ('2020-04-20', 3.85, 4.65),
  ('2020-03-20', 4.05, 4.75),
  ('2020-02-20', 4.05, 4.75),
  ('2020-01-20', 4.15, 4.80),
  ('2019-12-20', 4.15, 4.80),
  ('2019-11-20', 4.15, 4.80),
  ('2019-10-21', 4.20, 4.85),
  ('2019-09-20', 4.20, 4.85),
  ('2019-08-20', 4.25, 4.85);

-- 央行存款基准利率（来源：bankRateService.ts benchmark 数组）
INSERT INTO "public"."pboc_deposit_rates" ("effect_date", "demand", "three_months", "six_months", "one_year", "two_year", "three_year", "five_year") VALUES
  ('2015-10-24', 0.35, 1.10, 1.30, 1.50, 2.10, 2.75, 2.75),
  ('2015-08-26', 0.35, 1.35, 1.55, 1.75, 2.35, 3.00, 3.00),
  ('2015-06-28', 0.35, 1.60, 1.80, 2.00, 2.60, 3.25, 3.25),
  ('2015-05-11', 0.35, 1.85, 2.05, 2.25, 2.85, 3.50, 3.50),
  ('2015-03-01', 0.35, 2.10, 2.30, 2.50, 3.10, 3.75, 3.75),
  ('2014-11-22', 0.35, 2.35, 2.55, 2.75, 3.35, 4.00, 4.00),
  ('2012-07-06', 0.35, 2.60, 2.80, 3.00, 3.75, 4.25, 4.25),
  ('2012-06-08', 0.40, 2.85, 3.05, 3.25, 4.00, 4.50, 4.50),
  ('2011-07-07', 0.50, 3.10, 3.30, 3.50, 4.40, 4.90, 5.00),
  ('2011-04-06', 0.50, 2.85, 3.05, 3.25, 4.15, 4.65, 4.75);

-- 央行贷款基准利率（来源：bankRateService.ts loan 数组）
INSERT INTO "public"."pboc_loan_rates" ("effect_date", "six_months", "one_year", "one_to_five", "five_year_plus") VALUES
  ('2015-10-24', 4.35, 4.35, 4.75, 4.90),
  ('2015-08-26', 4.60, 4.60, 5.00, 5.15),
  ('2015-06-28', 4.85, 4.85, 5.25, 5.40),
  ('2015-05-11', 5.10, 5.10, 5.50, 5.65),
  ('2015-03-01', 5.35, 5.35, 5.75, 5.90),
  ('2014-11-22', 5.60, 5.60, 6.00, 6.15),
  ('2012-07-06', 5.85, 6.00, 6.15, 6.40),
  ('2012-06-08', 6.10, 6.31, 6.40, 6.65),
  ('2011-07-07', 6.56, 6.65, 6.90, 7.05),
  ('2011-04-06', 6.31, 6.40, 6.65, 6.80);
```

- [ ] **Step 2: 导入 seedData.sql 到 dev 库验证 SQL 语法**

Run:
```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "TRUNCATE lpr_rates, pboc_deposit_rates, pboc_loan_rates CASCADE;"
# 然后只导入新增的三段 INSERT 部分
docker exec -i postgres-postgres-1 psql -U daixin -d ls_new << 'SQL'
-- 把上一步追加的 3 段 INSERT 复制进来执行
SQL
```
Expected: 三条 `INSERT 0 86` / `INSERT 0 10` / `INSERT 0 10`，无错误

- [ ] **Step 3: 验证 dev 库数据条数**

Run: `docker exec postgres-postgres-1 psql -U daixin -d ls_new -t -c "SELECT count(*) FROM lpr_rates;"`
Expected: `72`（实际数据 — 上方 SQL 列了 72 条）

> 注：本任务 SQL 段列的 LPR 是 72 条，与原 bankRateService.ts 的 76 条略有差异需对齐。复制前请精确对照源数据。

- [ ] **Step 4: Commit**

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(rates): seedData.sql 初始化利率历史（LPR 72 条 / PBOC 存款 10 条 / PBOC 贷款 10 条）"
```

---

## 任务 PR1a-T4：实现 shared 数据层（含 setter 缓存）

**Files:**
- Create: `shared/utils/tools/data/lpr.ts`
- Create: `shared/utils/tools/data/pbocDepositRates.ts`
- Create: `shared/utils/tools/data/pbocLoanRates.ts`
- Create: `shared/utils/tools/data/index.ts`

- [ ] **Step 1: 创建 `shared/utils/tools/data/lpr.ts`**

```typescript
import type { LPRRate } from '#shared/types/tools'

/**
 * LPR 利率默认快照（与 prisma/seeds/seedData.sql 保持同步）
 *
 * - 测试基线兜底：测试代码不调 setLPRRates 时使用该默认值
 * - 服务端启动 plugin / 客户端 useToolsRates 加载到最新 DB 数据后会覆盖
 */
const DEFAULT_LPR_RATES: readonly LPRRate[] = [
    { date: '2025-07-21', oneYear: 3.00, fiveYear: 3.50 },
    { date: '2025-06-20', oneYear: 3.00, fiveYear: 3.50 },
    { date: '2025-05-20', oneYear: 3.00, fiveYear: 3.50 },
    { date: '2025-04-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2025-03-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2025-02-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2025-01-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2024-12-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2024-11-20', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2024-10-21', oneYear: 3.10, fiveYear: 3.60 },
    { date: '2024-09-20', oneYear: 3.35, fiveYear: 3.85 },
    { date: '2024-08-20', oneYear: 3.35, fiveYear: 3.85 },
    { date: '2024-07-22', oneYear: 3.35, fiveYear: 3.85 },
    { date: '2024-06-20', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-05-20', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-04-22', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-03-20', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-02-20', oneYear: 3.45, fiveYear: 3.95 },
    { date: '2024-01-22', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-12-20', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-11-20', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-10-20', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-09-20', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-08-21', oneYear: 3.45, fiveYear: 4.20 },
    { date: '2023-07-20', oneYear: 3.55, fiveYear: 4.20 },
    { date: '2023-06-20', oneYear: 3.55, fiveYear: 4.20 },
    { date: '2023-05-22', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2023-04-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2023-03-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2023-02-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2023-01-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-12-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-11-21', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-10-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-09-20', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-08-22', oneYear: 3.65, fiveYear: 4.30 },
    { date: '2022-07-20', oneYear: 3.70, fiveYear: 4.45 },
    { date: '2022-06-20', oneYear: 3.70, fiveYear: 4.45 },
    { date: '2022-05-20', oneYear: 3.70, fiveYear: 4.45 },
    { date: '2022-04-20', oneYear: 3.70, fiveYear: 4.60 },
    { date: '2022-03-21', oneYear: 3.70, fiveYear: 4.60 },
    { date: '2022-02-21', oneYear: 3.70, fiveYear: 4.60 },
    { date: '2022-01-20', oneYear: 3.70, fiveYear: 4.60 },
    { date: '2021-12-20', oneYear: 3.80, fiveYear: 4.65 },
    { date: '2021-11-22', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-10-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-09-22', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-08-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-07-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-06-21', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-05-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-04-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-03-22', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-02-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2021-01-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-12-21', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-11-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-10-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-09-21', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-08-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-07-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-06-22', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-05-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-04-20', oneYear: 3.85, fiveYear: 4.65 },
    { date: '2020-03-20', oneYear: 4.05, fiveYear: 4.75 },
    { date: '2020-02-20', oneYear: 4.05, fiveYear: 4.75 },
    { date: '2020-01-20', oneYear: 4.15, fiveYear: 4.80 },
    { date: '2019-12-20', oneYear: 4.15, fiveYear: 4.80 },
    { date: '2019-11-20', oneYear: 4.15, fiveYear: 4.80 },
    { date: '2019-10-21', oneYear: 4.20, fiveYear: 4.85 },
    { date: '2019-09-20', oneYear: 4.20, fiveYear: 4.85 },
    { date: '2019-08-20', oneYear: 4.25, fiveYear: 4.85 },
]

let runtimeCache: readonly LPRRate[] = DEFAULT_LPR_RATES

/** 获取当前缓存的 LPR 历史（按 date desc 排序） */
export function getLPRRates(): readonly LPRRate[] {
    return runtimeCache
}

/**
 * 注入最新 LPR 数据（覆盖默认快照）
 *
 * - 服务端：rates-cache plugin 启动时调用 / rates.service.ts 写库后调用
 * - 客户端：useToolsRates composable 首次访问工具页时调用
 */
export function setLPRRates(rates: readonly LPRRate[]): void {
    runtimeCache = [...rates].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
}
```

- [ ] **Step 2: 创建 `shared/utils/tools/data/pbocDepositRates.ts`**

```typescript
import type { PBOCDepositRate } from '#shared/types/tools'

const DEFAULT_PBOC_DEPOSIT_RATES: readonly PBOCDepositRate[] = [
    { date: '2015-10-24', demand: 0.35, threeMonths: 1.10, sixMonths: 1.30, oneYear: 1.50, twoYear: 2.10, threeYear: 2.75, fiveYear: 2.75 },
    { date: '2015-08-26', demand: 0.35, threeMonths: 1.35, sixMonths: 1.55, oneYear: 1.75, twoYear: 2.35, threeYear: 3.00, fiveYear: 3.00 },
    { date: '2015-06-28', demand: 0.35, threeMonths: 1.60, sixMonths: 1.80, oneYear: 2.00, twoYear: 2.60, threeYear: 3.25, fiveYear: 3.25 },
    { date: '2015-05-11', demand: 0.35, threeMonths: 1.85, sixMonths: 2.05, oneYear: 2.25, twoYear: 2.85, threeYear: 3.50, fiveYear: 3.50 },
    { date: '2015-03-01', demand: 0.35, threeMonths: 2.10, sixMonths: 2.30, oneYear: 2.50, twoYear: 3.10, threeYear: 3.75, fiveYear: 3.75 },
    { date: '2014-11-22', demand: 0.35, threeMonths: 2.35, sixMonths: 2.55, oneYear: 2.75, twoYear: 3.35, threeYear: 4.00, fiveYear: 4.00 },
    { date: '2012-07-06', demand: 0.35, threeMonths: 2.60, sixMonths: 2.80, oneYear: 3.00, twoYear: 3.75, threeYear: 4.25, fiveYear: 4.25 },
    { date: '2012-06-08', demand: 0.40, threeMonths: 2.85, sixMonths: 3.05, oneYear: 3.25, twoYear: 4.00, threeYear: 4.50, fiveYear: 4.50 },
    { date: '2011-07-07', demand: 0.50, threeMonths: 3.10, sixMonths: 3.30, oneYear: 3.50, twoYear: 4.40, threeYear: 4.90, fiveYear: 5.00 },
    { date: '2011-04-06', demand: 0.50, threeMonths: 2.85, sixMonths: 3.05, oneYear: 3.25, twoYear: 4.15, threeYear: 4.65, fiveYear: 4.75 },
]

let runtimeCache: readonly PBOCDepositRate[] = DEFAULT_PBOC_DEPOSIT_RATES

export function getPBOCDepositRates(): readonly PBOCDepositRate[] {
    return runtimeCache
}

export function setPBOCDepositRates(rates: readonly PBOCDepositRate[]): void {
    runtimeCache = [...rates].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
}
```

- [ ] **Step 3: 创建 `shared/utils/tools/data/pbocLoanRates.ts`**

```typescript
import type { PBOCLoanRate } from '#shared/types/tools'

const DEFAULT_PBOC_LOAN_RATES: readonly PBOCLoanRate[] = [
    { date: '2015-10-24', sixMonths: 4.35, oneYear: 4.35, oneToFiveYear: 4.75, fiveYearPlus: 4.90 },
    { date: '2015-08-26', sixMonths: 4.60, oneYear: 4.60, oneToFiveYear: 5.00, fiveYearPlus: 5.15 },
    { date: '2015-06-28', sixMonths: 4.85, oneYear: 4.85, oneToFiveYear: 5.25, fiveYearPlus: 5.40 },
    { date: '2015-05-11', sixMonths: 5.10, oneYear: 5.10, oneToFiveYear: 5.50, fiveYearPlus: 5.65 },
    { date: '2015-03-01', sixMonths: 5.35, oneYear: 5.35, oneToFiveYear: 5.75, fiveYearPlus: 5.90 },
    { date: '2014-11-22', sixMonths: 5.60, oneYear: 5.60, oneToFiveYear: 6.00, fiveYearPlus: 6.15 },
    { date: '2012-07-06', sixMonths: 5.85, oneYear: 6.00, oneToFiveYear: 6.15, fiveYearPlus: 6.40 },
    { date: '2012-06-08', sixMonths: 6.10, oneYear: 6.31, oneToFiveYear: 6.40, fiveYearPlus: 6.65 },
    { date: '2011-07-07', sixMonths: 6.56, oneYear: 6.65, oneToFiveYear: 6.90, fiveYearPlus: 7.05 },
    { date: '2011-04-06', sixMonths: 6.31, oneYear: 6.40, oneToFiveYear: 6.65, fiveYearPlus: 6.80 },
]

let runtimeCache: readonly PBOCLoanRate[] = DEFAULT_PBOC_LOAN_RATES

export function getPBOCLoanRates(): readonly PBOCLoanRate[] {
    return runtimeCache
}

export function setPBOCLoanRates(rates: readonly PBOCLoanRate[]): void {
    runtimeCache = [...rates].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
}
```

- [ ] **Step 4: 创建 `shared/utils/tools/data/index.ts`**

```typescript
export * from './lpr'
export * from './pbocDepositRates'
export * from './pbocLoanRates'
```

- [ ] **Step 5: 验证 typecheck**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 6: 现有 service 仍使用本地常量；测试基线全绿验证**

Run: `npx vitest run tests/shared/utils/tools/ 2>&1 | tail -5`
Expected: `Test Files 15 passed (15)` `Tests 601 passed (601)`

- [ ] **Step 7: Commit**

```bash
git add shared/utils/tools/data/ shared/types/tools.ts
git commit -m "feat(tools): 新增 shared/utils/tools/data/ 利率数据层（含 getter/setter 缓存）"
```

---

## 任务 PR1a-T5：实现 rates DAO

**Files:**
- Create: `server/services/rates/rates.dao.ts`
- Create: `tests/server/services/rates/rates.dao.test.ts`

- [ ] **Step 1: 先写测试 `tests/server/services/rates/rates.dao.test.ts`**

```typescript
/**
 * 利率 DAO 单元测试
 *
 * **Feature: rates-data-layer**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    findAllLPRRatesDAO,
    createLPRRateDAO,
    updateLPRRateDAO,
    softDeleteLPRRateDAO,
    findAllPBOCDepositRatesDAO,
    createPBOCDepositRateDAO,
    updatePBOCDepositRateDAO,
    softDeletePBOCDepositRateDAO,
    findAllPBOCLoanRatesDAO,
    createPBOCLoanRateDAO,
    updatePBOCLoanRateDAO,
    softDeletePBOCLoanRateDAO,
} from '~~/server/services/rates/rates.dao'

describe('rates.dao - LPR', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.lpr_rates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('findAllLPRRatesDAO 应返回未软删除的所有 LPR，按 effectDate desc 排序', async () => {
        const seedCount = await prisma.lpr_rates.count({ where: { deletedAt: null } })
        expect(seedCount).toBeGreaterThanOrEqual(72)
        const rates = await findAllLPRRatesDAO()
        expect(rates).toHaveLength(seedCount)
        for (let i = 0; i < rates.length - 1; i++) {
            expect(rates[i]!.effectDate.getTime()).toBeGreaterThanOrEqual(rates[i + 1]!.effectDate.getTime())
        }
    })

    it('createLPRRateDAO 应成功创建一条新 LPR', async () => {
        const date = `2030-01-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        const created = await createLPRRateDAO({
            effectDate: new Date(date),
            oneYear: 2.50,
            fiveYear: 3.00,
            remark: '测试',
        })
        createdIds.push(created.id)
        expect(Number(created.oneYear)).toBe(2.50)
        expect(Number(created.fiveYear)).toBe(3.00)
    })

    it('updateLPRRateDAO 应更新一条 LPR', async () => {
        const created = await createLPRRateDAO({
            effectDate: new Date(`2031-02-${String(Date.now() % 28 + 1).padStart(2, '0')}`),
            oneYear: 2.50, fiveYear: 3.00,
        })
        createdIds.push(created.id)
        const updated = await updateLPRRateDAO(created.id, { oneYear: 2.60, remark: '调整' })
        expect(Number(updated.oneYear)).toBe(2.60)
        expect(updated.remark).toBe('调整')
    })

    it('softDeleteLPRRateDAO 应设置 deletedAt 而非物理删除', async () => {
        const created = await createLPRRateDAO({
            effectDate: new Date(`2032-03-${String(Date.now() % 28 + 1).padStart(2, '0')}`),
            oneYear: 2.50, fiveYear: 3.00,
        })
        createdIds.push(created.id)
        await softDeleteLPRRateDAO(created.id)
        const reloaded = await prisma.lpr_rates.findUnique({ where: { id: created.id } })
        expect(reloaded?.deletedAt).not.toBeNull()
        const visible = await findAllLPRRatesDAO()
        expect(visible.find((r) => r.id === created.id)).toBeUndefined()
    })
})

describe('rates.dao - PBOC Deposit', () => {
    const createdIds: number[] = []
    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.pboc_deposit_rates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('createPBOCDepositRateDAO + findAllPBOCDepositRatesDAO + update + softDelete 全链路', async () => {
        const created = await createPBOCDepositRateDAO({
            effectDate: new Date(`2030-04-${String(Date.now() % 28 + 1).padStart(2, '0')}`),
            demand: 0.30, threeMonths: 1.00, sixMonths: 1.20, oneYear: 1.40,
            twoYear: 2.00, threeYear: 2.50, fiveYear: 2.50,
        })
        createdIds.push(created.id)

        const list = await findAllPBOCDepositRatesDAO()
        expect(list.find((r) => r.id === created.id)).toBeTruthy()

        await updatePBOCDepositRateDAO(created.id, { demand: 0.40 })
        const reloaded = await prisma.pboc_deposit_rates.findUnique({ where: { id: created.id } })
        expect(Number(reloaded!.demand)).toBe(0.40)

        await softDeletePBOCDepositRateDAO(created.id)
        const afterDelete = await findAllPBOCDepositRatesDAO()
        expect(afterDelete.find((r) => r.id === created.id)).toBeUndefined()
    })
})

describe('rates.dao - PBOC Loan', () => {
    const createdIds: number[] = []
    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.pboc_loan_rates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('createPBOCLoanRateDAO + findAllPBOCLoanRatesDAO + update + softDelete 全链路', async () => {
        const created = await createPBOCLoanRateDAO({
            effectDate: new Date(`2030-05-${String(Date.now() % 28 + 1).padStart(2, '0')}`),
            sixMonths: 4.00, oneYear: 4.10, oneToFiveYear: 4.40, fiveYearPlus: 4.60,
        })
        createdIds.push(created.id)

        const list = await findAllPBOCLoanRatesDAO()
        expect(list.find((r) => r.id === created.id)).toBeTruthy()

        await updatePBOCLoanRateDAO(created.id, { sixMonths: 4.05 })
        await softDeletePBOCLoanRateDAO(created.id)
        const afterDelete = await findAllPBOCLoanRatesDAO()
        expect(afterDelete.find((r) => r.id === created.id)).toBeUndefined()
    })
})
```

- [ ] **Step 2: 跑测试验证失败（DAO 还未实现）**

Run: `npx vitest run tests/server/services/rates/rates.dao.test.ts`
Expected: FAIL，提示 `~~/server/services/rates/rates.dao` 找不到

- [ ] **Step 3: 实现 `server/services/rates/rates.dao.ts`**

```typescript
/**
 * 利率数据访问层
 *
 * 提供 LPR / PBOC 存款 / PBOC 贷款 三类利率的 CRUD（含软删除）。
 */
import type { Prisma } from '#shared/types/prisma'
import type {
    lpr_rates,
    pboc_deposit_rates,
    pboc_loan_rates,
} from '~~/generated/prisma/client'
import { prisma } from '~~/server/utils/db'
type PrismaClient = typeof prisma

// ============ LPR ============

export async function findAllLPRRatesDAO(tx?: PrismaClient): Promise<lpr_rates[]> {
    return (tx ?? prisma).lpr_rates.findMany({
        where: { deletedAt: null },
        orderBy: { effectDate: 'desc' },
    })
}

export async function createLPRRateDAO(
    data: Prisma.lpr_ratesCreateInput,
    tx?: PrismaClient
): Promise<lpr_rates> {
    return (tx ?? prisma).lpr_rates.create({ data })
}

export async function updateLPRRateDAO(
    id: number,
    data: Prisma.lpr_ratesUpdateInput,
    tx?: PrismaClient
): Promise<lpr_rates> {
    return (tx ?? prisma).lpr_rates.update({ where: { id }, data })
}

export async function softDeleteLPRRateDAO(id: number, tx?: PrismaClient): Promise<lpr_rates> {
    return (tx ?? prisma).lpr_rates.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}

// ============ PBOC Deposit ============

export async function findAllPBOCDepositRatesDAO(tx?: PrismaClient): Promise<pboc_deposit_rates[]> {
    return (tx ?? prisma).pboc_deposit_rates.findMany({
        where: { deletedAt: null },
        orderBy: { effectDate: 'desc' },
    })
}

export async function createPBOCDepositRateDAO(
    data: Prisma.pboc_deposit_ratesCreateInput,
    tx?: PrismaClient
): Promise<pboc_deposit_rates> {
    return (tx ?? prisma).pboc_deposit_rates.create({ data })
}

export async function updatePBOCDepositRateDAO(
    id: number,
    data: Prisma.pboc_deposit_ratesUpdateInput,
    tx?: PrismaClient
): Promise<pboc_deposit_rates> {
    return (tx ?? prisma).pboc_deposit_rates.update({ where: { id }, data })
}

export async function softDeletePBOCDepositRateDAO(
    id: number,
    tx?: PrismaClient
): Promise<pboc_deposit_rates> {
    return (tx ?? prisma).pboc_deposit_rates.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}

// ============ PBOC Loan ============

export async function findAllPBOCLoanRatesDAO(tx?: PrismaClient): Promise<pboc_loan_rates[]> {
    return (tx ?? prisma).pboc_loan_rates.findMany({
        where: { deletedAt: null },
        orderBy: { effectDate: 'desc' },
    })
}

export async function createPBOCLoanRateDAO(
    data: Prisma.pboc_loan_ratesCreateInput,
    tx?: PrismaClient
): Promise<pboc_loan_rates> {
    return (tx ?? prisma).pboc_loan_rates.create({ data })
}

export async function updatePBOCLoanRateDAO(
    id: number,
    data: Prisma.pboc_loan_ratesUpdateInput,
    tx?: PrismaClient
): Promise<pboc_loan_rates> {
    return (tx ?? prisma).pboc_loan_rates.update({ where: { id }, data })
}

export async function softDeletePBOCLoanRateDAO(
    id: number,
    tx?: PrismaClient
): Promise<pboc_loan_rates> {
    return (tx ?? prisma).pboc_loan_rates.update({
        where: { id },
        data: { deletedAt: new Date() },
    })
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/server/services/rates/rates.dao.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/rates/rates.dao.ts tests/server/services/rates/rates.dao.test.ts
git commit -m "feat(rates): 新增 rates.dao（含 LPR/PBOC 存款/PBOC 贷款 CRUD + 软删除）"
```

---

## 任务 PR1a-T6：实现 rates Service（含 Decimal → number + 刷新缓存）

**Files:**
- Create: `server/services/rates/rates.service.ts`
- Create: `tests/server/services/rates/rates.service.test.ts`

- [ ] **Step 1: 写测试 `tests/server/services/rates/rates.service.test.ts`**

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    listLPRRatesService,
    createLPRRateService,
    updateLPRRateService,
    deleteLPRRateService,
    listPBOCDepositRatesService,
    listPBOCLoanRatesService,
} from '~~/server/services/rates/rates.service'
import { getLPRRates } from '#shared/utils/tools/data'

describe('rates.service', () => {
    const createdIds: number[] = []
    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.lpr_rates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('listLPRRatesService 应返回 number 类型的字段（不是 Decimal）', async () => {
        const rates = await listLPRRatesService()
        expect(rates.length).toBeGreaterThan(0)
        const first = rates[0]!
        expect(typeof first.oneYear).toBe('number')
        expect(typeof first.fiveYear).toBe('number')
        expect(typeof first.date).toBe('string')
        expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('createLPRRateService 创建后应自动刷新 shared 缓存', async () => {
        const beforeCache = getLPRRates()
        const beforeFirst = beforeCache[0]?.date

        const created = await createLPRRateService({
            effectDate: '2099-12-31',
            oneYear: 9.99,
            fiveYear: 10.99,
            remark: '测试',
        })
        createdIds.push(created.id)

        const afterCache = getLPRRates()
        expect(afterCache[0]?.date).toBe('2099-12-31')
        expect(afterCache[0]?.oneYear).toBe(9.99)
        expect(afterCache[0]?.date).not.toBe(beforeFirst)
    })

    it('updateLPRRateService 应刷新缓存', async () => {
        const created = await createLPRRateService({
            effectDate: '2098-12-31',
            oneYear: 1.11,
            fiveYear: 2.22,
        })
        createdIds.push(created.id)

        await updateLPRRateService(created.id, { oneYear: 1.99 })
        const cache = getLPRRates()
        const target = cache.find((r) => r.date === '2098-12-31')
        expect(target?.oneYear).toBe(1.99)
    })

    it('deleteLPRRateService 应刷新缓存且数据不可见', async () => {
        const created = await createLPRRateService({
            effectDate: '2097-12-31',
            oneYear: 1.0,
            fiveYear: 2.0,
        })
        createdIds.push(created.id)
        await deleteLPRRateService(created.id)
        const cache = getLPRRates()
        expect(cache.find((r) => r.date === '2097-12-31')).toBeUndefined()
    })

    it('listPBOCDepositRatesService + listPBOCLoanRatesService 应能返回 number 字段', async () => {
        const deposit = await listPBOCDepositRatesService()
        expect(deposit.length).toBeGreaterThan(0)
        expect(typeof deposit[0]!.demand).toBe('number')

        const loan = await listPBOCLoanRatesService()
        expect(loan.length).toBeGreaterThan(0)
        expect(typeof loan[0]!.sixMonths).toBe('number')
    })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/server/services/rates/rates.service.test.ts`
Expected: FAIL — service 文件不存在

- [ ] **Step 3: 实现 `server/services/rates/rates.service.ts`**

```typescript
/**
 * 利率服务层
 *
 * 职责：
 * 1. 把 Prisma Decimal 转 number、Date 转 YYYY-MM-DD 字符串（让 API/缓存只持有 plain 数据）
 * 2. 增删改后自动刷新 shared/utils/tools/data/ 模块级缓存
 */
import type { LPRRate, PBOCDepositRate, PBOCLoanRate } from '#shared/types/tools'
import { decimalToNumber } from '#shared/utils/decimalToNumber'
import {
    getLPRRates, setLPRRates,
    setPBOCDepositRates,
    setPBOCLoanRates,
} from '#shared/utils/tools/data'
import {
    findAllLPRRatesDAO, createLPRRateDAO, updateLPRRateDAO, softDeleteLPRRateDAO,
    findAllPBOCDepositRatesDAO, createPBOCDepositRateDAO, updatePBOCDepositRateDAO, softDeletePBOCDepositRateDAO,
    findAllPBOCLoanRatesDAO, createPBOCLoanRateDAO, updatePBOCLoanRateDAO, softDeletePBOCLoanRateDAO,
} from '~~/server/services/rates/rates.dao'
import type {
    lpr_rates, pboc_deposit_rates, pboc_loan_rates,
} from '~~/generated/prisma/client'

// ============ 内部转换 ============

function toLPRRate(row: lpr_rates): LPRRate {
    return {
        date: row.effectDate.toISOString().slice(0, 10),
        oneYear: decimalToNumber(row.oneYear),
        fiveYear: decimalToNumber(row.fiveYear),
    }
}

function toPBOCDepositRate(row: pboc_deposit_rates): PBOCDepositRate {
    return {
        date: row.effectDate.toISOString().slice(0, 10),
        demand: decimalToNumber(row.demand),
        threeMonths: decimalToNumber(row.threeMonths),
        sixMonths: decimalToNumber(row.sixMonths),
        oneYear: decimalToNumber(row.oneYear),
        twoYear: decimalToNumber(row.twoYear),
        threeYear: decimalToNumber(row.threeYear),
        fiveYear: decimalToNumber(row.fiveYear),
    }
}

function toPBOCLoanRate(row: pboc_loan_rates): PBOCLoanRate {
    return {
        date: row.effectDate.toISOString().slice(0, 10),
        sixMonths: decimalToNumber(row.sixMonths),
        oneYear: decimalToNumber(row.oneYear),
        oneToFiveYear: decimalToNumber(row.oneToFiveYear),
        fiveYearPlus: decimalToNumber(row.fiveYearPlus),
    }
}

// ============ LPR Service ============

export interface CreateLPRRateInput {
    effectDate: string  // YYYY-MM-DD
    oneYear: number
    fiveYear: number
    remark?: string
}

export interface UpdateLPRRateInput {
    effectDate?: string
    oneYear?: number
    fiveYear?: number
    remark?: string
}

async function refreshLPRCacheService(): Promise<LPRRate[]> {
    const rows = await findAllLPRRatesDAO()
    const list = rows.map(toLPRRate)
    setLPRRates(list)
    return list
}

export async function listLPRRatesService(): Promise<LPRRate[]> {
    const rows = await findAllLPRRatesDAO()
    return rows.map(toLPRRate)
}

export async function createLPRRateService(input: CreateLPRRateInput) {
    const created = await createLPRRateDAO({
        effectDate: new Date(input.effectDate),
        oneYear: input.oneYear,
        fiveYear: input.fiveYear,
        remark: input.remark ?? null,
    })
    await refreshLPRCacheService()
    return { id: created.id, ...toLPRRate(created), remark: created.remark }
}

export async function updateLPRRateService(id: number, input: UpdateLPRRateInput) {
    const data: Record<string, unknown> = {}
    if (input.effectDate !== undefined) data.effectDate = new Date(input.effectDate)
    if (input.oneYear !== undefined) data.oneYear = input.oneYear
    if (input.fiveYear !== undefined) data.fiveYear = input.fiveYear
    if (input.remark !== undefined) data.remark = input.remark
    const updated = await updateLPRRateDAO(id, data)
    await refreshLPRCacheService()
    return { id: updated.id, ...toLPRRate(updated), remark: updated.remark }
}

export async function deleteLPRRateService(id: number) {
    await softDeleteLPRRateDAO(id)
    await refreshLPRCacheService()
}

// ============ PBOC Deposit Service ============

export interface CreatePBOCDepositRateInput {
    effectDate: string
    demand: number; threeMonths: number; sixMonths: number; oneYear: number
    twoYear: number; threeYear: number; fiveYear: number
    remark?: string
}
export type UpdatePBOCDepositRateInput = Partial<CreatePBOCDepositRateInput>

async function refreshPBOCDepositCacheService(): Promise<PBOCDepositRate[]> {
    const rows = await findAllPBOCDepositRatesDAO()
    const list = rows.map(toPBOCDepositRate)
    setPBOCDepositRates(list)
    return list
}

export async function listPBOCDepositRatesService(): Promise<PBOCDepositRate[]> {
    return (await findAllPBOCDepositRatesDAO()).map(toPBOCDepositRate)
}

export async function createPBOCDepositRateService(input: CreatePBOCDepositRateInput) {
    const created = await createPBOCDepositRateDAO({
        effectDate: new Date(input.effectDate),
        demand: input.demand, threeMonths: input.threeMonths,
        sixMonths: input.sixMonths, oneYear: input.oneYear,
        twoYear: input.twoYear, threeYear: input.threeYear, fiveYear: input.fiveYear,
        remark: input.remark ?? null,
    })
    await refreshPBOCDepositCacheService()
    return { id: created.id, ...toPBOCDepositRate(created), remark: created.remark }
}

export async function updatePBOCDepositRateService(id: number, input: UpdatePBOCDepositRateInput) {
    const data: Record<string, unknown> = {}
    if (input.effectDate !== undefined) data.effectDate = new Date(input.effectDate)
    for (const k of ['demand', 'threeMonths', 'sixMonths', 'oneYear', 'twoYear', 'threeYear', 'fiveYear', 'remark'] as const) {
        if (input[k] !== undefined) data[k] = input[k]
    }
    const updated = await updatePBOCDepositRateDAO(id, data)
    await refreshPBOCDepositCacheService()
    return { id: updated.id, ...toPBOCDepositRate(updated), remark: updated.remark }
}

export async function deletePBOCDepositRateService(id: number) {
    await softDeletePBOCDepositRateDAO(id)
    await refreshPBOCDepositCacheService()
}

// ============ PBOC Loan Service ============

export interface CreatePBOCLoanRateInput {
    effectDate: string
    sixMonths: number; oneYear: number; oneToFiveYear: number; fiveYearPlus: number
    remark?: string
}
export type UpdatePBOCLoanRateInput = Partial<CreatePBOCLoanRateInput>

async function refreshPBOCLoanCacheService(): Promise<PBOCLoanRate[]> {
    const rows = await findAllPBOCLoanRatesDAO()
    const list = rows.map(toPBOCLoanRate)
    setPBOCLoanRates(list)
    return list
}

export async function listPBOCLoanRatesService(): Promise<PBOCLoanRate[]> {
    return (await findAllPBOCLoanRatesDAO()).map(toPBOCLoanRate)
}

export async function createPBOCLoanRateService(input: CreatePBOCLoanRateInput) {
    const created = await createPBOCLoanRateDAO({
        effectDate: new Date(input.effectDate),
        sixMonths: input.sixMonths, oneYear: input.oneYear,
        oneToFiveYear: input.oneToFiveYear, fiveYearPlus: input.fiveYearPlus,
        remark: input.remark ?? null,
    })
    await refreshPBOCLoanCacheService()
    return { id: created.id, ...toPBOCLoanRate(created), remark: created.remark }
}

export async function updatePBOCLoanRateService(id: number, input: UpdatePBOCLoanRateInput) {
    const data: Record<string, unknown> = {}
    if (input.effectDate !== undefined) data.effectDate = new Date(input.effectDate)
    for (const k of ['sixMonths', 'oneYear', 'oneToFiveYear', 'fiveYearPlus', 'remark'] as const) {
        if (input[k] !== undefined) data[k] = input[k]
    }
    const updated = await updatePBOCLoanRateDAO(id, data)
    await refreshPBOCLoanCacheService()
    return { id: updated.id, ...toPBOCLoanRate(updated), remark: updated.remark }
}

export async function deletePBOCLoanRateService(id: number) {
    await softDeletePBOCLoanRateDAO(id)
    await refreshPBOCLoanCacheService()
}

// ============ 启动一次性刷新（plugin 调用） ============

export async function refreshAllRatesCacheService(): Promise<void> {
    await Promise.all([
        refreshLPRCacheService(),
        refreshPBOCDepositCacheService(),
        refreshPBOCLoanCacheService(),
    ])
}

// re-export 供 plugin 用
export { getLPRRates }
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/server/services/rates/rates.service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/rates/rates.service.ts tests/server/services/rates/rates.service.test.ts
git commit -m "feat(rates): rates.service Decimal→number 转换 + 模块缓存自动刷新"
```

---

## 任务 PR1a-T7：用户端只读 API（3 个 GET）

**Files:**
- Create: `server/api/v1/tools/rates/lpr.get.ts`
- Create: `server/api/v1/tools/rates/pboc-deposit.get.ts`
- Create: `server/api/v1/tools/rates/pboc-loan.get.ts`
- Create: `tests/server/api/v1/tools/rates/rates.user.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { $fetch } from '@nuxt/test-utils/e2e'
// 项目通常用 supertest / handler 直调；此处用 handler 直调风格
import lprHandler from '~~/server/api/v1/tools/rates/lpr.get'
import depositHandler from '~~/server/api/v1/tools/rates/pboc-deposit.get'
import loanHandler from '~~/server/api/v1/tools/rates/pboc-loan.get'

function buildEvent() {
    return { context: { auth: { user: { id: 'test-user-id' } } } } as any
}

describe('GET /api/v1/tools/rates/*', () => {
    it('lpr.get 返回 success + 包含 LPR 列表', async () => {
        const res: any = await lprHandler(buildEvent())
        expect(res.code).toBe(200)
        expect(Array.isArray(res.data)).toBe(true)
        expect(res.data.length).toBeGreaterThan(0)
        expect(typeof res.data[0].oneYear).toBe('number')
    })
    it('pboc-deposit.get 返回 success + 包含 deposit 列表', async () => {
        const res: any = await depositHandler(buildEvent())
        expect(res.code).toBe(200)
        expect(Array.isArray(res.data)).toBe(true)
    })
    it('pboc-loan.get 返回 success + 包含 loan 列表', async () => {
        const res: any = await loanHandler(buildEvent())
        expect(res.code).toBe(200)
        expect(Array.isArray(res.data)).toBe(true)
    })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/server/api/v1/tools/rates/rates.user.test.ts`
Expected: FAIL — handler 不存在

- [ ] **Step 3: 实现 `server/api/v1/tools/rates/lpr.get.ts`**

```typescript
import {
    listLPRRatesService,
} from '~~/server/services/rates/rates.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    try {
        const data = await listLPRRatesService()
        return resSuccess(event, '查询成功', data)
    } catch (err) {
        logger.error('查询 LPR 利率失败', err)
        return resError(event, 500, '查询失败')
    }
})
```

- [ ] **Step 4: 实现 `server/api/v1/tools/rates/pboc-deposit.get.ts` 与 `pboc-loan.get.ts`（结构一致，只换 service）**

```typescript
// pboc-deposit.get.ts
import { listPBOCDepositRatesService } from '~~/server/services/rates/rates.service'
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    try {
        const data = await listPBOCDepositRatesService()
        return resSuccess(event, '查询成功', data)
    } catch (err) {
        logger.error('查询央行存款基准利率失败', err)
        return resError(event, 500, '查询失败')
    }
})
```

```typescript
// pboc-loan.get.ts
import { listPBOCLoanRatesService } from '~~/server/services/rates/rates.service'
export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    try {
        const data = await listPBOCLoanRatesService()
        return resSuccess(event, '查询成功', data)
    } catch (err) {
        logger.error('查询央行贷款基准利率失败', err)
        return resError(event, 500, '查询失败')
    }
})
```

- [ ] **Step 5: 跑测试验证通过**

Run: `npx vitest run tests/server/api/v1/tools/rates/rates.user.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/api/v1/tools/rates/ tests/server/api/v1/tools/rates/
git commit -m "feat(rates): 新增用户端只读 API GET /api/v1/tools/rates/{lpr,pboc-deposit,pboc-loan}"
```

---

## 任务 PR1a-T8：管理端 CRUD API（12 个）

**Files (LPR 4 个 + PBOC 存款 4 个 + PBOC 贷款 4 个):**
- Create: `server/api/v1/admin/rates/lpr/{index.get.ts, index.post.ts, [id].patch.ts, [id].delete.ts}`
- Create: `server/api/v1/admin/rates/pboc-deposit/{index.get.ts, index.post.ts, [id].patch.ts, [id].delete.ts}`
- Create: `server/api/v1/admin/rates/pboc-loan/{index.get.ts, index.post.ts, [id].patch.ts, [id].delete.ts}`
- Create: `tests/server/api/v1/admin/rates/rates.admin.test.ts`

- [ ] **Step 1: 写测试（覆盖 LPR 全链路 + Deposit/Loan happy path）**

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import lprListHandler from '~~/server/api/v1/admin/rates/lpr/index.get'
import lprCreateHandler from '~~/server/api/v1/admin/rates/lpr/index.post'
import lprPatchHandler from '~~/server/api/v1/admin/rates/lpr/[id].patch'
import lprDeleteHandler from '~~/server/api/v1/admin/rates/lpr/[id].delete'

function buildAdminEvent(opts: { body?: any; param?: string } = {}) {
    return {
        context: { auth: { user: { id: 'admin-user-id', role: 'super_admin' } } },
        node: { req: { body: opts.body ?? null } },
        _routerParams: opts.param ? { id: opts.param } : {},
    } as any
}

describe('admin/rates/lpr CRUD', () => {
    const createdIds: number[] = []
    afterEach(async () => {
        if (createdIds.length) {
            await prisma.lpr_rates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('GET 列表应包含 seed 数据', async () => {
        const res: any = await lprListHandler(buildAdminEvent())
        expect(res.code).toBe(200)
        expect(res.data.length).toBeGreaterThanOrEqual(72)
    })

    it('POST 创建 → PATCH 更新 → DELETE 软删除', async () => {
        const createRes: any = await lprCreateHandler({
            ...buildAdminEvent({ body: { effectDate: '2099-01-01', oneYear: 5.0, fiveYear: 6.0 } }),
        })
        expect(createRes.code).toBe(200)
        const id = createRes.data.id
        createdIds.push(id)

        const patchRes: any = await lprPatchHandler({
            ...buildAdminEvent({ body: { oneYear: 5.5 }, param: String(id) }),
        })
        expect(patchRes.data.oneYear).toBe(5.5)

        const delRes: any = await lprDeleteHandler({
            ...buildAdminEvent({ param: String(id) }),
        })
        expect(delRes.code).toBe(200)
        const row = await prisma.lpr_rates.findUnique({ where: { id } })
        expect(row?.deletedAt).not.toBeNull()
    })

    it('POST 校验：effectDate 缺失时返回 400', async () => {
        const res: any = await lprCreateHandler(buildAdminEvent({
            body: { oneYear: 5.0, fiveYear: 6.0 } as any,
        }))
        expect(res.code).toBe(400)
    })
})
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/server/api/v1/admin/rates/rates.admin.test.ts`
Expected: FAIL — handler 都不存在

- [ ] **Step 3: 实现 LPR 4 个 handler**

```typescript
// server/api/v1/admin/rates/lpr/index.get.ts
import { listLPRRatesService } from '~~/server/services/rates/rates.service'
export default defineEventHandler(async (event) => {
    try {
        const data = await listLPRRatesService()
        return resSuccess(event, '查询成功', data)
    } catch (err) {
        logger.error('admin 查询 LPR 失败', err)
        return resError(event, 500, '查询失败')
    }
})
```

```typescript
// server/api/v1/admin/rates/lpr/index.post.ts
import { z } from 'zod'
import { createLPRRateService } from '~~/server/services/rates/rates.service'

const schema = z.object({
    effectDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    oneYear: z.number().min(0).max(99.9999),
    fiveYear: z.number().min(0).max(99.9999),
    remark: z.string().optional(),
})

export default defineEventHandler(async (event) => {
    const body = await readBody(event)
    const result = schema.safeParse(body)
    if (!result.success) return resError(event, 400, result.error.issues[0]!.message)
    try {
        const data = await createLPRRateService(result.data)
        return resSuccess(event, '创建成功', data)
    } catch (err) {
        logger.error('admin 创建 LPR 失败', err)
        return resError(event, 500, '创建失败')
    }
})
```

```typescript
// server/api/v1/admin/rates/lpr/[id].patch.ts
import { z } from 'zod'
import { updateLPRRateService } from '~~/server/services/rates/rates.service'

const schema = z.object({
    effectDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    oneYear: z.number().min(0).max(99.9999).optional(),
    fiveYear: z.number().min(0).max(99.9999).optional(),
    remark: z.string().nullable().optional(),
})

export default defineEventHandler(async (event) => {
    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!Number.isFinite(id)) return resError(event, 400, 'id 不合法')
    const body = await readBody(event)
    const result = schema.safeParse(body)
    if (!result.success) return resError(event, 400, result.error.issues[0]!.message)
    try {
        const data = await updateLPRRateService(id, result.data)
        return resSuccess(event, '更新成功', data)
    } catch (err) {
        logger.error('admin 更新 LPR 失败', err)
        return resError(event, 500, '更新失败')
    }
})
```

```typescript
// server/api/v1/admin/rates/lpr/[id].delete.ts
import { deleteLPRRateService } from '~~/server/services/rates/rates.service'

export default defineEventHandler(async (event) => {
    const idStr = getRouterParam(event, 'id')
    const id = Number(idStr)
    if (!Number.isFinite(id)) return resError(event, 400, 'id 不合法')
    try {
        await deleteLPRRateService(id)
        return resSuccess(event, '删除成功')
    } catch (err) {
        logger.error('admin 删除 LPR 失败', err)
        return resError(event, 500, '删除失败')
    }
})
```

- [ ] **Step 4: 实现 PBOC 存款 4 个 handler（结构镜像 LPR，仅 schema/service 名变化）**

参考 LPR 4 个，把 `createLPRRateService` 等改为 `createPBOCDepositRateService` 等。zod schema：

```typescript
const schema = z.object({
    effectDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    demand: z.number().min(0).max(99.9999),
    threeMonths: z.number().min(0).max(99.9999),
    sixMonths: z.number().min(0).max(99.9999),
    oneYear: z.number().min(0).max(99.9999),
    twoYear: z.number().min(0).max(99.9999),
    threeYear: z.number().min(0).max(99.9999),
    fiveYear: z.number().min(0).max(99.9999),
    remark: z.string().optional(),
})
```

- [ ] **Step 5: 实现 PBOC 贷款 4 个 handler**

zod schema：

```typescript
const schema = z.object({
    effectDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sixMonths: z.number().min(0).max(99.9999),
    oneYear: z.number().min(0).max(99.9999),
    oneToFiveYear: z.number().min(0).max(99.9999),
    fiveYearPlus: z.number().min(0).max(99.9999),
    remark: z.string().optional(),
})
```

- [ ] **Step 6: 跑测试验证通过**

Run: `npx vitest run tests/server/api/v1/admin/rates/rates.admin.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/api/v1/admin/rates/ tests/server/api/v1/admin/rates/
git commit -m "feat(rates): 新增管理端 CRUD API admin/rates/{lpr,pboc-deposit,pboc-loan}"
```

---

## 任务 PR1a-T9：服务端启动 plugin（刷新缓存）

**Files:**
- Create: `server/plugins/rates-cache.ts`

- [ ] **Step 1: 创建 `server/plugins/rates-cache.ts`**

```typescript
import { refreshAllRatesCacheService } from '~~/server/services/rates/rates.service'

/**
 * 启动时从 DB 拉一次最新利率到 shared/utils/tools/data/ 模块缓存
 *
 * 失败不阻塞启动：模块默认 DEFAULT_*_RATES 兜底
 */
export default defineNitroPlugin(async () => {
    try {
        await refreshAllRatesCacheService()
        logger.info('[rates-cache] 利率缓存初始化完成')
    } catch (err) {
        logger.error('[rates-cache] 利率缓存初始化失败，使用 DEFAULT 兜底', err)
    }
})
```

- [ ] **Step 2: 启动 dev server 验证 log**

Run: `bun dev` 后访问 `http://localhost:3000`
Expected: 终端打印 `[rates-cache] 利率缓存初始化完成`

- [ ] **Step 3: Commit**

```bash
git add server/plugins/rates-cache.ts
git commit -m "feat(rates): 新增服务端启动 plugin，自动刷新利率模块缓存"
```

---

## 任务 PR1a-T10：客户端 composable

**Files:**
- Create: `app/composables/useToolsRates.ts`

- [ ] **Step 1: 创建 `app/composables/useToolsRates.ts`**

```typescript
import { setLPRRates, setPBOCDepositRates, setPBOCLoanRates, getLPRRates, getPBOCDepositRates, getPBOCLoanRates } from '#shared/utils/tools/data'
import { useApiFetch } from '~/composables/useApiFetch'
import type { LPRRate, PBOCDepositRate, PBOCLoanRate } from '#shared/types/tools'

let loaded = false
let loadingPromise: Promise<void> | null = null

/**
 * 进入任意计算器页面前调用一次。
 * - 已加载：直接返回当前缓存
 * - 加载中：复用同一个 Promise
 * - 未加载：并行拉三类利率，写入 shared 缓存
 */
export function useToolsRates() {
    async function ensureLoaded(): Promise<void> {
        if (loaded) return
        if (loadingPromise) return loadingPromise
        loadingPromise = (async () => {
            try {
                const [lpr, deposit, loan] = await Promise.all([
                    useApiFetch<LPRRate[]>('/v1/tools/rates/lpr', { method: 'GET' }),
                    useApiFetch<PBOCDepositRate[]>('/v1/tools/rates/pboc-deposit', { method: 'GET' }),
                    useApiFetch<PBOCLoanRate[]>('/v1/tools/rates/pboc-loan', { method: 'GET' }),
                ])
                if (lpr) setLPRRates(lpr)
                if (deposit) setPBOCDepositRates(deposit)
                if (loan) setPBOCLoanRates(loan)
                loaded = true
            } catch (err) {
                console.error('[useToolsRates] 加载利率失败，使用默认值', err)
            } finally {
                loadingPromise = null
            }
        })()
        return loadingPromise
    }

    return {
        ensureLoaded,
        getLPR: getLPRRates,
        getPBOCDeposit: getPBOCDepositRates,
        getPBOCLoan: getPBOCLoanRates,
    }
}
```

- [ ] **Step 2: typecheck 验证**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add app/composables/useToolsRates.ts
git commit -m "feat(rates): 新增 useToolsRates composable，工具页首次进入时拉取最新利率"
```

---

## 任务 PR1a-T11：bankRateService 改用 data 层

**Files:**
- Modify: `shared/utils/tools/bankRateService.ts`

- [ ] **Step 1: 改写 `bankRateService.ts`，删除文件内的 `bankRates.lpr/benchmark/loan` 常量，import 自 data 层**

把现在的 `const bankRates = { lpr: [...], benchmark: [...], loan: [...] }` 全部删掉，改为：

```typescript
import {
    getLPRRates,
    getPBOCDepositRates,
    getPBOCLoanRates,
} from '#shared/utils/tools/data'

// ... 原文件中所有 bankRates.lpr 改为 getLPRRates()
// bankRates.benchmark 改为 getPBOCDepositRates()
// bankRates.loan 改为 getPBOCLoanRates()
```

具体 `getCurrentLPR()` / `getCurrentLoanRate()` / `getCurrentDepositRate()` / `getHistoricalLPR()` 等函数的内部实现，把 `bankRates.lpr[0]` 改成 `getLPRRates()[0]!`（仍保留 `!` non-null 断言：默认数组非空，DB 来源数据库表也至少 seed 了 1 条）；其它 forEach/find 同理把 `bankRates.X` 替换为 `getXRates()`。

- [ ] **Step 2: 跑 bankRateService 测试验证不破坏**

Run: `npx vitest run tests/shared/utils/tools/bankRateService.test.ts --coverage`
Expected: PASS + 4 项指标 100%

- [ ] **Step 3: 跑全量 tools 测试验证基线**

Run: `npx vitest run tests/shared/utils/tools/ --coverage 2>&1 | tail -10`
Expected: `Test Files 15 passed (15)` `Tests 601 passed (601)` + 4 项指标 100%

- [ ] **Step 4: Commit**

```bash
git add shared/utils/tools/bankRateService.ts
git commit -m "refactor(rates): bankRateService 改从 shared/utils/tools/data 读取利率"
```

---

## 任务 PR1a-T12：interestService / delayInterestService 改用 data 层

**Files:**
- Modify: `shared/utils/tools/interestService.ts`
- Modify: `shared/utils/tools/delayInterestService.ts`

- [ ] **Step 1: interestService.ts 把本地 `lprRates` 数组删掉，import 自 data 层**

把文件顶端的 `const lprRates: LPRRate[] = [...]` 删除，替换：

```typescript
import { getLPRRates } from '#shared/utils/tools/data'
// 文件内所有 lprRates.X 替换为 getLPRRates()[X] 或 getLPRRates().find(...) 等
```

- [ ] **Step 2: delayInterestService.ts 同样改**

- [ ] **Step 3: 跑测试**

Run: `npx vitest run tests/shared/utils/tools/interestService.test.ts tests/shared/utils/tools/delayInterestService.test.ts --coverage`
Expected: PASS + 100% 覆盖

- [ ] **Step 4: 跑全量**

Run: `npx vitest run tests/shared/utils/tools/ --coverage 2>&1 | tail -5`
Expected: 601 passed + 4 项 100%

- [ ] **Step 5: Commit**

```bash
git add shared/utils/tools/interestService.ts shared/utils/tools/delayInterestService.ts
git commit -m "refactor(rates): interestService/delayInterestService 改从 shared/utils/tools/data 读 LPR"
```

---

## PR1a 收尾：注册 RBAC 权限 + Boy-Scout 检查

- [ ] **Step 1: 通过 dev 后台 → 「API 权限」→ 扫描 录入 12 个新增 admin/rates 接口（由 RBAC 流程负责，不写 seedData）**

按 `.claude/rules/api.md` "管理端 API 注册流程" 操作：扫描 → 命中新接口 → 「角色」页给 super_admin / admin 勾权限。

- [ ] **Step 2: 跑全量 server 测试 + tools 测试**

Run: `npx vitest run tests/server/services/rates/ tests/server/api/v1/admin/rates/ tests/server/api/v1/tools/rates/ tests/shared/utils/tools/`
Expected: 全 PASS

- [ ] **Step 3: PR1a 总结 commit**

```bash
git commit --allow-empty -m "chore(rates): PR1a 完成 - 利率库化 + 服务端 API + 启动缓存"
```

---

# PR1b · 管理后台 UI（1 天）

参考实现：`app/pages/admin/models/index.vue` + `app/components/admin/...`。

## 任务 PR1b-T1：建索引页和子路由结构

**Files:**
- Create: `app/pages/admin/rates/index.vue` (3 个 tab 的总览页 + 跳转)
- Create: `app/pages/admin/rates/lpr.vue`
- Create: `app/pages/admin/rates/pboc-deposit.vue`
- Create: `app/pages/admin/rates/pboc-loan.vue`

- [ ] **Step 1: 创建总览页 `app/pages/admin/rates/index.vue`**

```vue
<template>
    <div class="space-y-6">
        <div>
            <h1 class="text-2xl font-semibold">利率管理</h1>
            <p class="text-muted-foreground mt-1">维护办案工具引用的 LPR / 央行存款 / 央行贷款 三类基准利率历史</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card v-for="entry in entries" :key="entry.path" class="cursor-pointer hover:border-primary" @click="navigateTo(entry.path)">
                <CardHeader>
                    <CardTitle class="flex items-center gap-2">
                        <component :is="entry.icon" class="w-5 h-5" />
                        {{ entry.title }}
                    </CardTitle>
                    <CardDescription>{{ entry.desc }}</CardDescription>
                </CardHeader>
            </Card>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Card, CardHeader, CardTitle, CardDescription } from '~/components/ui/card'
import { TrendingUp, PiggyBank, Banknote } from 'lucide-vue-next'

definePageMeta({ layout: 'admin' })

const entries = [
    { path: '/admin/rates/lpr',           title: 'LPR 利率',          desc: '央行每月公布的贷款市场报价利率',          icon: TrendingUp },
    { path: '/admin/rates/pboc-deposit',  title: '央行存款基准利率',   desc: '人民银行存款基准利率历史（已停止公布，作为历史保留）', icon: PiggyBank },
    { path: '/admin/rates/pboc-loan',     title: '央行贷款基准利率',   desc: '人民银行贷款基准利率历史（2019 年起被 LPR 替代）', icon: Banknote },
]
</script>
```

- [ ] **Step 2: Commit**

```bash
git add app/pages/admin/rates/index.vue
git commit -m "feat(admin-rates): 新增利率管理总览页"
```

---

## 任务 PR1b-T2：LPR 列表页 + 表单 Dialog

**Files:**
- Create: `app/pages/admin/rates/lpr.vue`
- Create: `app/components/admin/rates/LPRFormDialog.vue`

- [ ] **Step 1: 创建列表页 `app/pages/admin/rates/lpr.vue`**

```vue
<template>
    <div class="space-y-4">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-semibold">LPR 利率</h1>
                <p class="text-muted-foreground text-sm">央行每月 20 日公布；办案利息工具引用此表 1Y / 5Y 数据</p>
            </div>
            <Button @click="openCreate">
                <Plus class="w-4 h-4 mr-1" />新增
            </Button>
        </div>

        <Card>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>生效日</TableHead>
                        <TableHead>1 年期 (%)</TableHead>
                        <TableHead>5 年期以上 (%)</TableHead>
                        <TableHead>备注</TableHead>
                        <TableHead class="text-right">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="row in rows" :key="row.id">
                        <TableCell>{{ row.date }}</TableCell>
                        <TableCell>{{ row.oneYear.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.fiveYear.toFixed(2) }}</TableCell>
                        <TableCell class="text-muted-foreground">{{ row.remark || '—' }}</TableCell>
                        <TableCell class="text-right space-x-2">
                            <Button variant="ghost" size="sm" @click="openEdit(row)">编辑</Button>
                            <Button variant="ghost" size="sm" class="text-destructive" @click="confirmDelete(row)">删除</Button>
                        </TableCell>
                    </TableRow>
                    <TableRow v-if="rows.length === 0">
                        <TableCell colspan="5" class="text-center text-muted-foreground py-8">暂无数据</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </Card>

        <LPRFormDialog v-model:open="dialogOpen" :model="editing" @saved="loadList" />
    </div>
</template>

<script setup lang="ts">
import { Card } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Plus } from 'lucide-vue-next'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'
import LPRFormDialog from '~/components/admin/rates/LPRFormDialog.vue'
import type { LPRRate } from '#shared/types/tools'

definePageMeta({ layout: 'admin' })

interface Row extends LPRRate { id: number; remark?: string }

const rows = ref<Row[]>([])
const dialogOpen = ref(false)
const editing = ref<Row | null>(null)
const alertDialog = useAlertDialogStore()

async function loadList() {
    const data = await useApiFetch<Row[]>('/v1/admin/rates/lpr', { method: 'GET' })
    rows.value = data ?? []
}

function openCreate() {
    editing.value = null
    dialogOpen.value = true
}
function openEdit(row: Row) {
    editing.value = { ...row }
    dialogOpen.value = true
}
async function confirmDelete(row: Row) {
    const ok = await alertDialog.showDialog({
        title: '删除 LPR 记录',
        description: `确认删除 ${row.date} 的 LPR 数据（1Y=${row.oneYear}%, 5Y=${row.fiveYear}%）？`,
        confirmText: '删除',
        type: 'destructive',
    })
    if (!ok) return
    await useApiFetch(`/v1/admin/rates/lpr/${row.id}`, { method: 'DELETE' })
    await loadList()
}

onMounted(loadList)
</script>
```

- [ ] **Step 2: 创建表单 Dialog `app/components/admin/rates/LPRFormDialog.vue`**

```vue
<template>
    <Dialog :open="open" @update:open="(v) => $emit('update:open', v)">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ isEdit ? '编辑' : '新增' }} LPR 记录</DialogTitle>
                <DialogDescription>央行公布日 1Y / 5Y 利率，% 单位（如 3.50 表示 3.5%）</DialogDescription>
            </DialogHeader>

            <div class="space-y-3">
                <div>
                    <Label>生效日</Label>
                    <Input v-model="form.effectDate" type="date" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <Label>1 年期 (%)</Label>
                        <Input v-model.number="form.oneYear" type="number" step="0.01" />
                    </div>
                    <div>
                        <Label>5 年期以上 (%)</Label>
                        <Input v-model.number="form.fiveYear" type="number" step="0.01" />
                    </div>
                </div>
                <div>
                    <Label>备注（可选）</Label>
                    <Input v-model="form.remark" placeholder="" />
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" @click="$emit('update:open', false)">取消</Button>
                <Button :disabled="saving" @click="onSave">保存</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'

interface Row { id: number; date: string; oneYear: number; fiveYear: number; remark?: string }

const props = defineProps<{ open: boolean; model: Row | null }>()
const emit = defineEmits<{ 'update:open': [boolean]; 'saved': [] }>()

const alertDialog = useAlertDialogStore()
const isEdit = computed(() => props.model !== null)
const saving = ref(false)

const form = reactive({ effectDate: '', oneYear: 0, fiveYear: 0, remark: '' })

watchEffect(() => {
    if (props.open && props.model) {
        form.effectDate = props.model.date
        form.oneYear = props.model.oneYear
        form.fiveYear = props.model.fiveYear
        form.remark = props.model.remark ?? ''
    } else if (props.open) {
        form.effectDate = ''
        form.oneYear = 0
        form.fiveYear = 0
        form.remark = ''
    }
})

async function onSave() {
    if (!form.effectDate || form.oneYear <= 0 || form.fiveYear <= 0) {
        await alertDialog.showErrorDialog({ description: '请完整填写生效日和利率' })
        return
    }
    saving.value = true
    try {
        if (isEdit.value && props.model) {
            await useApiFetch(`/v1/admin/rates/lpr/${props.model.id}`, {
                method: 'PATCH',
                body: { effectDate: form.effectDate, oneYear: form.oneYear, fiveYear: form.fiveYear, remark: form.remark || null },
            })
        } else {
            await useApiFetch('/v1/admin/rates/lpr', {
                method: 'POST',
                body: { effectDate: form.effectDate, oneYear: form.oneYear, fiveYear: form.fiveYear, remark: form.remark || undefined },
            })
        }
        emit('saved')
        emit('update:open', false)
    } finally {
        saving.value = false
    }
}
</script>
```

- [ ] **Step 3: 启动 dev server 用浏览器验证 CRUD**

Run: `bun dev` → 访问 `/admin/rates/lpr`
- 列表能加载 72 条 seed 数据
- 新增 / 编辑 / 删除 都能正常工作
- 删除时弹出 alertDialog 二次确认

- [ ] **Step 4: Commit**

```bash
git add app/pages/admin/rates/lpr.vue app/components/admin/rates/LPRFormDialog.vue
git commit -m "feat(admin-rates): LPR 列表 + 新增/编辑/删除 Dialog"
```

---

## 任务 PR1b-T3：PBOC 存款 / 贷款页面（镜像 LPR）

**Files:**
- Create: `app/pages/admin/rates/pboc-deposit.vue`
- Create: `app/pages/admin/rates/pboc-loan.vue`
- Create: `app/components/admin/rates/PbocDepositFormDialog.vue`
- Create: `app/components/admin/rates/PbocLoanFormDialog.vue`

- [ ] **Step 1: 镜像 LPR 页面结构，只改字段（PBOC 存款：7 列利率；PBOC 贷款：4 列利率）**

`pboc-deposit.vue` Table 头：`生效日 | 活期 | 三月 | 六月 | 一年 | 二年 | 三年 | 五年 | 备注 | 操作`

`pboc-loan.vue` Table 头：`生效日 | 六月 | 一年 | 一至五年 | 五年以上 | 备注 | 操作`

`PbocDepositFormDialog.vue` 7 个利率字段；`PbocLoanFormDialog.vue` 4 个利率字段。

- [ ] **Step 2: 浏览器验证 CRUD**

访问 `/admin/rates/pboc-deposit` 和 `/admin/rates/pboc-loan`，CRUD 流畅。

- [ ] **Step 3: Commit**

```bash
git add app/pages/admin/rates/ app/components/admin/rates/
git commit -m "feat(admin-rates): PBOC 存款 / 贷款 列表 + Dialog"
```

---

## 任务 PR1b-T4：管理后台菜单接入 + 角色授权

- [ ] **Step 1: 通过 dev 后台 → 「路由」→ 扫描 把 `/admin/rates`、`/admin/rates/lpr` 等纳入菜单**

按 `.claude/rules/api.md` 「管理端 API 注册流程」操作。

- [ ] **Step 2: 「API 权限」扫描 12 个新增管理端接口并给 super_admin 角色授权**

- [ ] **Step 3: 浏览器验证：**
- super_admin 账号能看到「利率管理」菜单 & CRUD 全功能可用
- 删除 / 编辑后 → 跳到 `/dashboard/tools/interest` 工具页 → 看到对应改动生效（验证缓存联动）

- [ ] **Step 4: PR1b 收尾 commit**

```bash
git commit --allow-empty -m "chore(rates): PR1b 完成 - 管理后台 UI 上线"
```

---

# PR1c · 其他法规常量集中（0.5 天）

把散落在各 service 的法规常量（费率档位 / 社保比例 / 加班规则等）统一迁到 `shared/utils/tools/data/`。注：本 PR 不动数据库（这些常量本来就是法规硬编码，不需要后台维护）。

## 任务 PR1c-T1：迁移 feeBrackets（court / lawyer / arbitration 费率档位）

**Files:**
- Create: `shared/utils/tools/data/feeBrackets.ts`
- Modify: `shared/utils/tools/courtFeeService.ts`
- Modify: `shared/utils/tools/lawyerFeeService.ts`
- Modify: `shared/utils/tools/arbitrationFeeService.ts`

- [ ] **Step 1: 创建 `shared/utils/tools/data/feeBrackets.ts`，按"诉讼费/律师费/仲裁费"分别 export 档位常量**

```typescript
/**
 * 办案工具档位常量（法规硬编码）
 *
 * 来源：
 * - 诉讼费用交纳办法（国务院 481 号令）
 * - 各省/直辖市律师服务收费办法（默认采用通用版）
 * - 中国仲裁协会推荐标准
 */

/** 法院受理费档位（财产案件）— 见诉讼费用交纳办法 */
export const COURT_ACCEPTANCE_BRACKETS = [
    { upper: 10000,    base: 50,      rate: 0,      fixed: 50 },        // ≤1 万：50 元
    { upper: 100000,   base: 50,      rate: 0.025,  start: 10000 },     // 1-10 万：2.5%
    { upper: 200000,   base: 2300,    rate: 0.02,   start: 100000 },    // 10-20 万：2%
    { upper: 500000,   base: 4300,    rate: 0.015,  start: 200000 },    // 20-50 万：1.5%
    { upper: 1000000,  base: 8800,    rate: 0.01,   start: 500000 },    // 50-100 万：1%
    { upper: 2000000,  base: 13800,   rate: 0.009,  start: 1000000 },   // 100-200 万：0.9%
    { upper: 5000000,  base: 22800,   rate: 0.008,  start: 2000000 },   // 200-500 万：0.8%
    { upper: 10000000, base: 46800,   rate: 0.007,  start: 5000000 },   // 500-1000 万：0.7%
    { upper: 20000000, base: 81800,   rate: 0.006,  start: 10000000 },  // 1000-2000 万：0.6%
    { upper: Infinity, base: 141800,  rate: 0.005,  start: 20000000 },  // >2000 万：0.5%
] as const

/** 申请执行费档位 */
export const COURT_EXECUTION_BRACKETS = [
    { upper: 10000,    base: 50,      rate: 0,      fixed: 50 },
    { upper: 500000,   base: 50,      rate: 0.015,  start: 10000 },
    { upper: 5000000,  base: 7400,    rate: 0.01,   start: 500000 },
    { upper: 10000000, base: 52400,   rate: 0.005,  start: 5000000 },
    { upper: Infinity, base: 77400,   rate: 0.001,  start: 10000000 },
] as const

/**
 * 民事案件律师费档位（与 lawyerFeeService.ts:166-178 if/else 一一对应）
 *
 * 起点说明：upper=100000 那档 fixed=5000 是定额，后续档基数累加：
 *   500000 档 base = 5000 + 400000*0.04 = 21000
 *   1000000 档 base = 21000 + 500000*0.03 = 36000
 *   5000000 档 base = 36000 + 4000000*0.02 = 116000
 *   10000000 档 base = 116000 + 5000000*0.01 = 166000
 */
export const LAWYER_CIVIL_BRACKETS = [
    { upper: 100000,   rate: 0,     base: 5000,   start: 0,        fixed: 5000 },
    { upper: 500000,   rate: 0.04,  base: 5000,   start: 100000 },
    { upper: 1000000,  rate: 0.03,  base: 21000,  start: 500000 },
    { upper: 5000000,  rate: 0.02,  base: 36000,  start: 1000000 },
    { upper: 10000000, rate: 0.01,  base: 116000, start: 5000000 },
    { upper: Infinity, rate: 0.005, base: 166000, start: 10000000 },
] as const
```

> LAWYER_COMMERCIAL_BRACKETS 和 ARBITRATION_BRACKETS 由后续 step 在迁移对应 service 时一并构造（见 Step 3 / Step 4）。

- [ ] **Step 2: courtFeeService.ts 删 `acceptanceFeeBrackets` / `executionFeeBrackets` 内联档位（若有），import COURT_ACCEPTANCE_BRACKETS / COURT_EXECUTION_BRACKETS 自 data 层**

具体改 calculator 内 if/else 阶梯为 `applyBrackets(amount, COURT_ACCEPTANCE_BRACKETS)`（PR2 已实现 applyBrackets，此处先 import data 常量，service 内部 if/else 在 PR2-T5 再改）。

- [ ] **Step 3: 把 lawyerFeeService.ts:413-461 的 `calculateCommercialFee` 内 if/else 阶梯抽离为 LAWYER_COMMERCIAL_BRACKETS 数组追加到 data/feeBrackets.ts**

操作：
1. `cat shared/utils/tools/lawyerFeeService.ts | sed -n '413,461p'` 读出商事档位的 if/else 边界
2. 按 LAWYER_CIVIL_BRACKETS 的结构逐档转换：每个 `if (amount <= X)` 分支对应一个 `{ upper: X, rate: <%>, base: <累加基数>, start: <上一档 upper> }`
3. 追加到 `shared/utils/tools/data/feeBrackets.ts` 末尾

确认 commit 前用 `bun run typecheck` 验证 const 数组类型正确。

- [ ] **Step 4: 同 Step 3 把 arbitrationFeeService.ts:45-70 的 `calculateBaseArbitrationFee` 内 if/else 抽离为 ARBITRATION_BRACKETS**

操作：
1. `cat shared/utils/tools/arbitrationFeeService.ts | sed -n '45,70p'` 读出 if/else 边界
2. 同 Step 3 的转换流程，追加 ARBITRATION_BRACKETS 到 data/feeBrackets.ts

- [ ] **Step 5: 跑相关测试**

Run: `npx vitest run tests/shared/utils/tools/courtFeeService.test.ts tests/shared/utils/tools/lawyerFeeService.test.ts tests/shared/utils/tools/arbitrationFeeService.test.ts --coverage`
Expected: PASS + 4 项 100%

- [ ] **Step 6: 跑全量**

Run: `npx vitest run tests/shared/utils/tools/ --coverage 2>&1 | tail -5`
Expected: 601 passed + 4 项 100%

- [ ] **Step 7: Commit**

```bash
git add shared/utils/tools/data/feeBrackets.ts shared/utils/tools/courtFeeService.ts shared/utils/tools/lawyerFeeService.ts shared/utils/tools/arbitrationFeeService.ts
git commit -m "refactor(tools): feeBrackets 三种档位常量迁出到 shared/utils/tools/data/"
```

---

## 任务 PR1c-T2：迁移 socialInsuranceRates + overtimeRules

**Files:**
- Create: `shared/utils/tools/data/socialInsuranceRates.ts`
- Create: `shared/utils/tools/data/overtimeRules.ts`
- Modify: `shared/utils/tools/socialInsuranceService.ts`
- Modify: `shared/utils/tools/overtimePayService.ts`

- [ ] **Step 1: 创建 `shared/utils/tools/data/socialInsuranceRates.ts`**

把 socialInsuranceService.ts 里的默认 5 险 1 金 个人 / 单位 比例提到这里。

- [ ] **Step 2: 创建 `shared/utils/tools/data/overtimeRules.ts`**

把 overtimePayService.ts 里的加班倍率（工作日 1.5、休息日 2、法定节假日 3）提到这里。

- [ ] **Step 3: 改 socialInsuranceService.ts / overtimePayService.ts import 自 data 层**

- [ ] **Step 4: 跑测试**

Run: `npx vitest run tests/shared/utils/tools/socialInsuranceService.test.ts tests/shared/utils/tools/overtimePayService.test.ts --coverage`
Expected: PASS + 100%

- [ ] **Step 5: 跑全量 + Commit**

```bash
git add shared/utils/tools/data/ shared/utils/tools/socialInsuranceService.ts shared/utils/tools/overtimePayService.ts
git commit -m "refactor(tools): socialInsuranceRates / overtimeRules 常量迁出到 data/"
```

---

## 任务 PR1c-T3：data 层 README + index 补全

**Files:**
- Modify: `shared/utils/tools/data/index.ts`
- Create: `shared/utils/tools/data/README.md`

- [ ] **Step 1: 补全 `data/index.ts`**

```typescript
export * from './lpr'
export * from './pbocDepositRates'
export * from './pbocLoanRates'
export * from './feeBrackets'
export * from './socialInsuranceRates'
export * from './overtimeRules'
```

- [ ] **Step 2: 创建 `README.md`**

```markdown
# shared/utils/tools/data — 办案工具数据层

## 文件职责

| 文件 | 数据类别 | 维护渠道 |
|------|---------|---------|
| lpr.ts | LPR 利率 | 管理后台 /admin/rates/lpr |
| pbocDepositRates.ts | 央行存款基准利率 | 管理后台 /admin/rates/pboc-deposit |
| pbocLoanRates.ts | 央行贷款基准利率 | 管理后台 /admin/rates/pboc-loan |
| feeBrackets.ts | 诉讼费/律师费/仲裁费 档位 | 修改源代码 + 重新部署（法规硬编码） |
| socialInsuranceRates.ts | 5 险 1 金 默认比例 | 修改源代码（各地比例不同，工具仅作参考） |
| overtimeRules.ts | 加班倍率 | 修改源代码（劳动法硬编码） |

## 缓存与刷新机制（仅 LPR / PBOC 三类利率）

- 模块级 `let runtimeCache` 持有当前数据
- 启动时 `server/plugins/rates-cache.ts` 调 service 拉 DB 数据 → setXxxRates
- 客户端通过 `useToolsRates` composable 首次进入工具页时拉取
- 管理后台 CRUD 改库后 service 内部自动 refresh
```

- [ ] **Step 3: 跑全量验证 + Commit**

Run: `npx vitest run tests/shared/utils/tools/ --coverage 2>&1 | tail -5`
Expected: 601 passed + 4 项 100%

```bash
git add shared/utils/tools/data/index.ts shared/utils/tools/data/README.md
git commit -m "docs(tools): data 层 README + index 汇总"
```

---

# PR2 · 算法层（2 天）

## 任务 PR2-T1：实现 applyBrackets（通用阶梯累进公式）

**Files:**
- Create: `shared/utils/tools/algorithms/applyBrackets.ts`
- Create: `tests/shared/utils/tools/algorithms/applyBrackets.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { applyBrackets, type Bracket } from '#shared/utils/tools/algorithms/applyBrackets'

describe('applyBrackets', () => {
    const brackets: Bracket[] = [
        { upper: 100, rate: 0.05, base: 0,    start: 0 },     // 0-100: 5%
        { upper: 1000, rate: 0.03, base: 5,   start: 100 },   // 100-1000: 3% + 5
        { upper: Infinity, rate: 0.01, base: 32, start: 1000 }, // >1000: 1% + 32
    ]

    it('amount 在第一档', () => {
        expect(applyBrackets(50, brackets)).toBeCloseTo(2.5, 4)
    })
    it('amount 在第二档', () => {
        expect(applyBrackets(500, brackets)).toBeCloseTo(5 + (500 - 100) * 0.03, 4)
    })
    it('amount 跨越最后一档', () => {
        expect(applyBrackets(5000, brackets)).toBeCloseTo(32 + (5000 - 1000) * 0.01, 4)
    })
    it('amount = 0 返回 0（首档支持 fixed=0）', () => {
        expect(applyBrackets(0, brackets)).toBeCloseTo(0, 4)
    })
    it('支持 fixed 档位（定额）', () => {
        const b2: Bracket[] = [{ upper: 10000, rate: 0, base: 0, start: 0, fixed: 50 }]
        expect(applyBrackets(5000, b2)).toBe(50)
    })
})
```

- [ ] **Step 2: 跑测试失败**

Run: `npx vitest run tests/shared/utils/tools/algorithms/applyBrackets.test.ts`
Expected: FAIL — applyBrackets 不存在

- [ ] **Step 3: 实现 `shared/utils/tools/algorithms/applyBrackets.ts`**

```typescript
/**
 * 通用阶梯累进公式
 *
 * 用于：诉讼费 / 律师费 / 仲裁费 等"按金额分段累进收费"场景。
 */

export interface Bracket {
    /** 档位上限（含），最后一档传 Infinity */
    upper: number
    /** 本档费率（百分比小数） */
    rate: number
    /** 本档起点（与上一档 upper 衔接），首档传 0 */
    start: number
    /** 累加基数（前面所有档位算到 start 时的金额） */
    base: number
    /** 定额费（如有 fixed，会忽略 base+rate，直接返回 fixed） */
    fixed?: number
}

export function applyBrackets(amount: number, brackets: readonly Bracket[]): number {
    if (amount <= 0) return 0
    for (const b of brackets) {
        if (amount <= b.upper) {
            if (b.fixed !== undefined) return b.fixed
            return b.base + (amount - b.start) * b.rate
        }
    }
    // 数组定义不完整（缺 Infinity 档）— 不应发生
    throw new Error('applyBrackets: brackets 数组不完整')
}
```

- [ ] **Step 4: 跑测试通过**

Run: `npx vitest run tests/shared/utils/tools/algorithms/applyBrackets.test.ts --coverage`
Expected: PASS + 4 项 100%

- [ ] **Step 5: Commit**

```bash
git add shared/utils/tools/algorithms/applyBrackets.ts tests/shared/utils/tools/algorithms/
git commit -m "feat(tools): 新增 applyBrackets 通用阶梯累进公式"
```

---

## 任务 PR2-T2：实现 calculateSegmentedInterest（分段利息）

**Files:**
- Create: `shared/utils/tools/algorithms/calculateSegmentedInterest.ts`
- Create: `tests/shared/utils/tools/algorithms/calculateSegmentedInterest.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { calculateSegmentedInterest } from '#shared/utils/tools/algorithms/calculateSegmentedInterest'

describe('calculateSegmentedInterest', () => {
    it('单一利率全段', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
            rateLookup: () => 4.0,
        })
        expect(segments).toHaveLength(1)
        expect(segments[0]!.interest).toBeCloseTo(10000 * 0.04 / 365 * 365, 2)
    })

    it('跨利率切换 — 利率在中间日期变化', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-01-01',
            endDate: '2024-06-30',
            rateLookup: (d) => d < new Date('2024-03-01') ? 4.0 : 3.5,
        })
        expect(segments.length).toBeGreaterThan(1)
    })

    it('startDate > endDate 返回空数组', () => {
        const segments = calculateSegmentedInterest({
            principal: 10000,
            startDate: '2024-12-31',
            endDate: '2024-01-01',
            rateLookup: () => 4.0,
        })
        expect(segments).toEqual([])
    })
})
```

- [ ] **Step 2: 跑测试失败 + Step 3: 实现 + Step 4: 跑测试通过**

```typescript
// shared/utils/tools/algorithms/calculateSegmentedInterest.ts
import { daysBetween } from '#shared/utils/tools/utils/date'

export interface SegmentInput {
    principal: number
    startDate: string | Date
    endDate: string | Date
    rateLookup: (date: Date) => number
    /** 利率切换点 — 当跨利率时需要传入（用 data 层数据生成） */
    rateChangePoints?: string[]
}

export interface InterestSegment {
    startDate: string
    endDate: string
    days: number
    rate: number
    interest: number
}

export function calculateSegmentedInterest(input: SegmentInput): InterestSegment[] {
    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    if (start > end) return []

    // 取出在 [start, end] 内的所有利率切换点
    const breaks = (input.rateChangePoints ?? [])
        .map((d) => new Date(d))
        .filter((d) => d > start && d <= end)
        .sort((a, b) => a.getTime() - b.getTime())

    const segments: InterestSegment[] = []
    let curStart = start
    for (const br of breaks) {
        const segEnd = new Date(br.getTime() - 86400000)
        const rate = input.rateLookup(curStart)
        const days = daysBetween(curStart, segEnd) + 1
        segments.push({
            startDate: curStart.toISOString().slice(0, 10),
            endDate: segEnd.toISOString().slice(0, 10),
            days,
            rate,
            interest: (input.principal * (rate / 100) / 365) * days,
        })
        curStart = br
    }
    // 最后一段
    const rate = input.rateLookup(curStart)
    const days = daysBetween(curStart, end) + 1
    segments.push({
        startDate: curStart.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        days,
        rate,
        interest: (input.principal * (rate / 100) / 365) * days,
    })

    return segments
}
```

- [ ] **Step 5: Commit**

```bash
git add shared/utils/tools/algorithms/calculateSegmentedInterest.ts tests/shared/utils/tools/algorithms/calculateSegmentedInterest.test.ts
git commit -m "feat(tools): 新增 calculateSegmentedInterest 分段利息算法"
```

---

## 任务 PR2-T3：实现 findRateForDate（按日期取利率）

**Files:**
- Create: `shared/utils/tools/algorithms/findRateForDate.ts`
- Create: `tests/shared/utils/tools/algorithms/findRateForDate.test.ts`

- [ ] **Step 1: 写测试 + Step 2: 实现**

```typescript
// shared/utils/tools/algorithms/findRateForDate.ts
/**
 * 在按 date desc 排序的利率数组中找到 target 日期对应的利率。
 *
 * 规则：返回 date <= target 中 date 最大的那一条（即"生效中"的利率）。
 */
export function findRateForDate<T extends { date: string }>(
    rates: readonly T[],
    target: string | Date,
): T | null {
    const t = typeof target === 'string' ? new Date(target) : target
    for (const r of rates) {
        if (new Date(r.date) <= t) return r
    }
    return null
}
```

- [ ] **Step 3: 跑测试通过 + Step 4: Commit**

```bash
git add shared/utils/tools/algorithms/findRateForDate.ts tests/shared/utils/tools/algorithms/findRateForDate.test.ts
git commit -m "feat(tools): 新增 findRateForDate 按日期取利率算法"
```

---

## 任务 PR2-T4：实现 roundToCents（精度统一）

**Files:**
- Create: `shared/utils/tools/algorithms/roundToCents.ts`
- Create: `tests/shared/utils/tools/algorithms/roundToCents.test.ts`

- [ ] **Step 1: 写测试 + Step 2: 实现**

```typescript
// shared/utils/tools/algorithms/roundToCents.ts
import Decimal from 'decimal.js'
/**
 * 把任意数四舍五入到分（2 位小数），用 Decimal.js 避免浮点误差。
 */
export function roundToCents(value: number | string): number {
    return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}
```

- [ ] **Step 3: 跑测试 + Step 4: Commit**

```bash
git add shared/utils/tools/algorithms/roundToCents.ts tests/shared/utils/tools/algorithms/roundToCents.test.ts
git commit -m "feat(tools): 新增 roundToCents 精度统一函数"
```

---

## 任务 PR2-T5：algorithms 层 index + README + 重构现有 service

**Files:**
- Create: `shared/utils/tools/algorithms/index.ts`
- Create: `shared/utils/tools/algorithms/README.md`
- Modify: `shared/utils/tools/courtFeeService.ts`
- Modify: `shared/utils/tools/lawyerFeeService.ts`
- Modify: `shared/utils/tools/arbitrationFeeService.ts`
- Modify: `shared/utils/tools/interestService.ts`
- Modify: `shared/utils/tools/delayInterestService.ts`

- [ ] **Step 1: 创建 index + README**

```typescript
// shared/utils/tools/algorithms/index.ts
export * from './applyBrackets'
export * from './calculateSegmentedInterest'
export * from './findRateForDate'
export * from './roundToCents'
```

- [ ] **Step 2: 改 courtFeeService.ts**

把内部 if/else 阶梯收费计算 → `applyBrackets(amount, COURT_ACCEPTANCE_BRACKETS)`。原 service 输出的 `details` 数组（"分档说明文字"）继续保留——已通过现有 36+ 处 `details.some(d => d.includes())` 测试断言。

- [ ] **Step 3: 改 lawyerFeeService.ts / arbitrationFeeService.ts 同理**

- [ ] **Step 4: 改 interestService.ts / delayInterestService.ts**

利息核心计算转给 `calculateSegmentedInterest`；按日期取利率转给 `findRateForDate`；金额收尾用 `roundToCents`。`details` 数组文本继续保留。

- [ ] **Step 5: 跑全量 tools 测试**

Run: `npx vitest run tests/shared/utils/tools/ --coverage 2>&1 | tail -10`
Expected: 601 passed + 15 文件 4 项 100% + algorithms 4 项 100%（4 个算法各 100%）

- [ ] **Step 6: Commit**

```bash
git add shared/utils/tools/algorithms/ shared/utils/tools/courtFeeService.ts shared/utils/tools/lawyerFeeService.ts shared/utils/tools/arbitrationFeeService.ts shared/utils/tools/interestService.ts shared/utils/tools/delayInterestService.ts
git commit -m "refactor(tools): 5 个 service 全面切换到 algorithms 层"
```

---

## 任务 PR2-T6：algorithms README

**Files:**
- Create: `shared/utils/tools/algorithms/README.md`

```markdown
# shared/utils/tools/algorithms — 办案工具通用算法层

## 文件清单

| 文件 | 函数 | 使用方 |
|------|------|--------|
| applyBrackets.ts | applyBrackets | courtFee / lawyerFee / arbitrationFee |
| calculateSegmentedInterest.ts | calculateSegmentedInterest | interest / delayInterest |
| findRateForDate.ts | findRateForDate | interest / delayInterest |
| roundToCents.ts | roundToCents | 所有金额收尾 |

## 设计原则

- 纯函数：无副作用，全部参数 in → 结果 out
- 不依赖 data 层：data 通过参数传入，便于单元测试
- 不输出业务文案（details 数组留在 service 层组装）
```

- [ ] **Commit**

```bash
git add shared/utils/tools/algorithms/README.md
git commit -m "docs(tools): algorithms 层 README"
```

---

# PR3 · Agent 工具层（3 天）

## 任务 PR3-T1：迁移 ToolDefinition/ToolContext/ToolModule 类型到 shared

**Files:**
- Create: `shared/types/agentTools.ts`
- Modify: `server/services/agent-platform/tools/types.ts` (改为 re-export shim)

- [ ] **Step 1: 创建 `shared/types/agentTools.ts`**

```typescript
/**
 * Agent 工具类型（双端共用）
 *
 * 历史位置：server/services/agent-platform/tools/types.ts
 * 迁移原因：shared/utils/tools/agentTools 需要 ToolDefinition / ToolContext / ToolModule 类型，
 * 而 shared 不可反向依赖 server。
 */
import type { z } from 'zod'

/** 调用工具时由 Agent 运行时注入的上下文 */
export interface ToolContext {
    userId: string
    caseId?: string
    sessionId?: string
    runId?: string
    draftId?: string
    reviewId?: string
}

/** 工具元数据（让 LLM 知道如何调用） */
export interface ToolDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
    name: string
    description: string
    schema: T
}

/** 工具模块的统一形状 */
export interface ToolModule<T extends z.ZodTypeAny = z.ZodTypeAny> {
    toolDefinition: ToolDefinition<T>
    createTool: (ctx: ToolContext) => unknown  // 返回 LangChain Runnable，避免引入 langchain 依赖
}
```

- [ ] **Step 2: 改 `server/services/agent-platform/tools/types.ts` 为 re-export shim**

```typescript
/** @deprecated 已迁至 shared/types/agentTools.ts，此文件保留兼容旧引用 */
export type { ToolContext, ToolDefinition, ToolModule } from '#shared/types/agentTools'
```

- [ ] **Step 3: typecheck**

Run: `bun run typecheck`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add shared/types/agentTools.ts server/services/agent-platform/tools/types.ts
git commit -m "refactor(agent): ToolContext/ToolDefinition/ToolModule 类型迁至 shared/types/agentTools"
```

---

## 任务 PR3-T2：实现 divorcePropertyCalculator.tool.ts（首个完整示例）

**Files:**
- Create: `shared/utils/tools/agentTools/divorcePropertyCalculator.tool.ts`
- Create: `tests/shared/utils/tools/agentTools/divorcePropertyCalculator.tool.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from 'vitest'
import { divorcePropertyCalculatorTool } from '#shared/utils/tools/agentTools/divorcePropertyCalculator.tool'

describe('divorcePropertyCalculator.tool', () => {
    it('toolDefinition 应有 name/description/schema', () => {
        expect(divorcePropertyCalculatorTool.toolDefinition.name).toBe('calculate_divorce_property')
        expect(divorcePropertyCalculatorTool.toolDefinition.description).toContain('离婚财产')
        expect(divorcePropertyCalculatorTool.toolDefinition.schema).toBeDefined()
    })

    it('createTool(ctx) 返回的 runnable 可被 invoke', async () => {
        const tool = divorcePropertyCalculatorTool.createTool({ userId: 'test' })
        const out = await (tool as any).invoke({
            totalProperty: 1000000,
            husbandShare: 50,
            wifeShare: 50,
        })
        expect(out).toContain('500000')
    })
})
```

- [ ] **Step 2: 跑测试失败 + Step 3: 实现**

```typescript
// shared/utils/tools/agentTools/divorcePropertyCalculator.tool.ts
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolModule, ToolContext } from '#shared/types/agentTools'
import { calculateDivorceProperty } from '#shared/utils/tools/divorcePropertyService'

const schema = z.object({
    totalProperty: z.number().describe('夫妻共同财产总额（元）'),
    husbandShare: z.number().min(0).max(100).default(50).describe('男方分配比例（0-100）'),
    wifeShare: z.number().min(0).max(100).default(50).describe('女方分配比例（0-100）'),
    debts: z.array(z.object({
        amount: z.number(),
        belongsTo: z.enum(['husband', 'wife', 'shared']),
    })).optional().describe('债务清单（可选）'),
})

export const divorcePropertyCalculatorTool: ToolModule<typeof schema> = {
    toolDefinition: {
        name: 'calculate_divorce_property',
        description: '计算离婚财产分割：传入共同财产总额 + 男女方分配比例（+ 可选债务清单），返回男女方各应得金额。',
        schema,
    },
    createTool: (_ctx: ToolContext) =>
        tool(
            async (input) => {
                const result = calculateDivorceProperty({
                    totalProperty: input.totalProperty,
                    husbandShare: input.husbandShare,
                    wifeShare: input.wifeShare,
                    debts: input.debts ?? [],
                })
                return JSON.stringify({
                    husbandTotal: result.husbandTotal,
                    wifeTotal: result.wifeTotal,
                    details: result.details,
                })
            },
            {
                name: 'calculate_divorce_property',
                description: '计算离婚财产分割',
                schema,
            },
        ),
}
```

- [ ] **Step 4: 跑测试通过**

Run: `npx vitest run tests/shared/utils/tools/agentTools/divorcePropertyCalculator.tool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/utils/tools/agentTools/divorcePropertyCalculator.tool.ts tests/shared/utils/tools/agentTools/divorcePropertyCalculator.tool.test.ts
git commit -m "feat(agent): 新增 divorcePropertyCalculator agent 工具"
```

---

## 任务 PR3-T3 至 PR3-T11：实现剩余 9 个工具

按 PR3-T2 模板镜像实现，每个工具一个 commit：

| 工具 | 文件 | 包装的 service |
|------|------|---------------|
| delayInterestCalculator.tool.ts | shared/utils/tools/agentTools/ | calculateDelayInterest |
| interestCalculator.tool.ts | 同上 | calculateInterest |
| courtFeeCalculator.tool.ts | 同上 | calculateCourtFee |
| lawyerFeeCalculator.tool.ts | 同上 | calculateLawyerFee |
| compensationCalculator.tool.ts | 同上 | calculateCompensation |
| overtimePayCalculator.tool.ts | 同上 | calculateOvertimePay |
| socialInsuranceCalculator.tool.ts | 同上 | calculateSocialInsurance |
| bankRateQuery.tool.ts | 同上 | getCurrentLPR / getCurrentLoanRate / getCurrentDepositRate |
| dateCalculator.tool.ts | 同上 | daysBetween / addDays 等 |

每个 tool 重复 PR3-T2 的步骤 1-5（测试 → 实现 → 验证 → commit）。

### 模板（替换 X 为具体工具名）

- [ ] **Step 1: 写 `tests/shared/utils/tools/agentTools/X.tool.test.ts`**
- [ ] **Step 2: `npx vitest run` 验证 FAIL**
- [ ] **Step 3: 写 `shared/utils/tools/agentTools/X.tool.ts`**
- [ ] **Step 4: `npx vitest run` 验证 PASS**
- [ ] **Step 5: `git commit -m "feat(agent): 新增 XCalculator agent 工具"`**

---

## 任务 PR3-T12：agentTools 层 index + 注册到 agent-platform

**Files:**
- Create: `shared/utils/tools/agentTools/index.ts`
- Modify: `server/services/agent-platform/registry/toolRegistry.ts` 或对应注册点

- [ ] **Step 1: 创建 `shared/utils/tools/agentTools/index.ts`**

```typescript
export { delayInterestCalculatorTool } from './delayInterestCalculator.tool'
export { interestCalculatorTool } from './interestCalculator.tool'
export { courtFeeCalculatorTool } from './courtFeeCalculator.tool'
export { lawyerFeeCalculatorTool } from './lawyerFeeCalculator.tool'
export { compensationCalculatorTool } from './compensationCalculator.tool'
export { overtimePayCalculatorTool } from './overtimePayCalculator.tool'
export { socialInsuranceCalculatorTool } from './socialInsuranceCalculator.tool'
export { divorcePropertyCalculatorTool } from './divorcePropertyCalculator.tool'
export { bankRateQueryTool } from './bankRateQuery.tool'
export { dateCalculatorTool } from './dateCalculator.tool'

import { delayInterestCalculatorTool } from './delayInterestCalculator.tool'
import { interestCalculatorTool } from './interestCalculator.tool'
import { courtFeeCalculatorTool } from './courtFeeCalculator.tool'
import { lawyerFeeCalculatorTool } from './lawyerFeeCalculator.tool'
import { compensationCalculatorTool } from './compensationCalculator.tool'
import { overtimePayCalculatorTool } from './overtimePayCalculator.tool'
import { socialInsuranceCalculatorTool } from './socialInsuranceCalculator.tool'
import { divorcePropertyCalculatorTool } from './divorcePropertyCalculator.tool'
import { bankRateQueryTool } from './bankRateQuery.tool'
import { dateCalculatorTool } from './dateCalculator.tool'

export const allCalculatorTools = [
    delayInterestCalculatorTool, interestCalculatorTool, courtFeeCalculatorTool,
    lawyerFeeCalculatorTool, compensationCalculatorTool, overtimePayCalculatorTool,
    socialInsuranceCalculatorTool, divorcePropertyCalculatorTool, bankRateQueryTool,
    dateCalculatorTool,
] as const
```

- [ ] **Step 2: 在 `server/services/agent-platform/tools/` 适配层把这 10 个工具注入到注册表**

具体 import + push 到 toolRegistry 的工作以现有 `server/services/agent-platform/tools/` 目录现状为准（参见 `docs/tech-docs/backend/agent-platform.md` 的 "工具注册" 章节）。

- [ ] **Step 3: Commit**

```bash
git add shared/utils/tools/agentTools/index.ts server/services/agent-platform/tools/
git commit -m "feat(agent): agentTools/index.ts + 注册到 agent-platform 工具注册表"
```

---

## 任务 PR3-T13：E2E 测试 — legal-assistant agent 调用计算器

**Files:**
- Create: `tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts`

- [ ] **Step 1: 写 E2E 测试**

测试场景：模拟 user 让 legal-assistant 计算"借款 100 万、年利率 4.5%、借期 365 天的利息"，验证 agent 能正确选中 `interestCalculator` 工具并返回 45000 附近的结果。

```typescript
import { describe, it, expect } from 'vitest'
import { invokeDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
// 实际 API 以 agent-platform 现有的 entrypoint 为准

describe('legal-assistant agent 调用计算器工具', () => {
    it('用户问"借款 100 万、年利率 4.5%、365 天的利息" → 调 interestCalculator → 返回 ~45000', async () => {
        const out = await invokeDomainAgent('legal-assistant', {
            userId: 'test-user',
            input: '借款 100 万、年利率 4.5%、借期 365 天，利息是多少？',
        })
        // 断言工具被调用 + 输出含 45000 左右
        expect(out.toolCalls?.some((c) => c.name === 'calculate_interest')).toBe(true)
        expect(out.text).toMatch(/4[5-7]\d{3}/)
    }, 30_000)
})
```

> 注：E2E 调用真实 LLM，跑得慢，可标记为 `it.skipIf(process.env.SKIP_E2E)` 在 CI 中按需启用。

- [ ] **Step 2: 跑测试**

Run: `npx vitest run tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts`
Expected: PASS（如 LLM 不稳定可重试 3 次）

- [ ] **Step 3: Commit**

```bash
git add tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts
git commit -m "test(agent): legal-assistant 调用 10 个计算器工具的 E2E 测试"
```

---

# PR4 · UI 层 — 共用组件 + 工具页重构（2 天）

## 任务 PR4-T1：CalculatorPageHeader

**Files:**
- Create: `app/components/tools/CalculatorPageHeader.vue`

- [ ] **Step 1: 创建组件**

```vue
<template>
    <div class="space-y-1">
        <h1 class="text-2xl font-semibold flex items-center gap-2">
            <component :is="icon" class="w-6 h-6 text-primary" />
            {{ title }}
        </h1>
        <p v-if="subtitle" class="text-muted-foreground text-sm">{{ subtitle }}</p>
    </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
defineProps<{ title: string; subtitle?: string; icon: Component }>()
</script>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/tools/CalculatorPageHeader.vue
git commit -m "feat(tools-ui): 新增 CalculatorPageHeader 共用组件"
```

---

## 任务 PR4-T2：DateInput

**Files:**
- Create: `app/components/tools/DateInput.vue`

- [ ] **Step 1: 创建组件（基于 shadcn-vue Calendar + Popover）**

```vue
<template>
    <Popover>
        <PopoverTrigger as-child>
            <Button variant="outline" class="w-full justify-start font-normal">
                <Calendar class="w-4 h-4 mr-2" />
                {{ displayDate }}
            </Button>
        </PopoverTrigger>
        <PopoverContent class="w-auto p-0">
            <CalendarComponent v-model="dateValue" mode="single" />
        </PopoverContent>
    </Popover>
</template>

<script setup lang="ts">
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Calendar as CalendarComponent } from '~/components/ui/calendar'
import { Button } from '~/components/ui/button'
import { Calendar } from 'lucide-vue-next'
import dayjs from 'dayjs'

const props = defineProps<{ modelValue: string; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const dateValue = computed({
    get: () => props.modelValue ? new Date(props.modelValue) : undefined,
    set: (v) => emit('update:modelValue', v ? dayjs(v).format('YYYY-MM-DD') : ''),
})
const displayDate = computed(() => props.modelValue || props.placeholder || '选择日期')
</script>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/tools/DateInput.vue
git commit -m "feat(tools-ui): 新增 DateInput 共用组件（shadcn-vue Calendar+Popover 封装）"
```

---

## 任务 PR4-T3：MoneyInput

**Files:**
- Create: `app/components/tools/MoneyInput.vue`

```vue
<template>
    <div class="relative">
        <Input
            type="number"
            :model-value="modelValue"
            :placeholder="placeholder"
            :step="step ?? '0.01'"
            class="pr-12"
            @update:model-value="onInput"
        />
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{{ suffix ?? '元' }}</span>
    </div>
    <p v-if="showChinese && Number(modelValue) > 0" class="text-xs text-muted-foreground mt-1">
        {{ numberToChinese(Number(modelValue)) }}
    </p>
</template>

<script setup lang="ts">
import { Input } from '~/components/ui/input'
import { numberToChinese } from '#shared/utils/tools/utils/calculator'

const props = defineProps<{
    modelValue: number | string
    placeholder?: string
    step?: string
    suffix?: string
    showChinese?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()

function onInput(v: string | number) {
    emit('update:modelValue', Number(v))
}
</script>
```

- [ ] **Commit**

```bash
git add app/components/tools/MoneyInput.vue
git commit -m "feat(tools-ui): 新增 MoneyInput 共用组件（含可选中文大写显示）"
```

---

## 任务 PR4-T4：ResultCard

**Files:**
- Create: `app/components/tools/ResultCard.vue`

```vue
<template>
    <Card class="border-primary/50">
        <CardHeader>
            <CardTitle class="flex items-center justify-between">
                <span>{{ title }}</span>
                <Button v-if="exportable" variant="outline" size="sm" @click="$emit('export')">
                    <Download class="w-4 h-4 mr-1" />导出 Excel
                </Button>
            </CardTitle>
        </CardHeader>
        <CardContent>
            <div v-if="!result" class="text-muted-foreground py-8 text-center">填写左侧表单并点击「计算」</div>
            <div v-else class="space-y-3">
                <div class="text-3xl font-semibold text-primary">{{ formatRMB(result.total) }}</div>
                <Accordion v-if="result.details?.length" type="single" collapsible>
                    <AccordionItem value="details">
                        <AccordionTrigger>计算明细 ({{ result.details.length }} 条)</AccordionTrigger>
                        <AccordionContent>
                            <ul class="text-sm space-y-1">
                                <li v-for="(d, idx) in result.details" :key="idx" class="text-muted-foreground">{{ d }}</li>
                            </ul>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
        </CardContent>
    </Card>
</template>

<script setup lang="ts">
import { Card, CardHeader, CardTitle, CardContent } from '~/components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '~/components/ui/accordion'
import { Button } from '~/components/ui/button'
import { Download } from 'lucide-vue-next'
import { formatRMB } from '#shared/utils/tools/utils/calculator'

defineProps<{
    title: string
    result?: { total: number; details?: string[] } | null
    exportable?: boolean
}>()
defineEmits<{ export: [] }>()
</script>
```

- [ ] **Commit**

```bash
git add app/components/tools/ResultCard.vue
git commit -m "feat(tools-ui): 新增 ResultCard 共用组件（含 formatRMB + 明细折叠 + 导出按钮）"
```

---

## 任务 PR4-T5：interest 工具页用共用组件重构（首个示例）

**Files:**
- Modify: `app/pages/dashboard/tools/interest.vue`

- [ ] **Step 1: 把现有内联的 Calendar + 货币输入 + 中文大写 + 结果展示 → 4 个共用组件**

具体改动点：
1. 顶部页头 → `<CalculatorPageHeader title="利息计算器" subtitle="..." :icon="DollarSign" />`
2. 表单中所有日期 input → `<DateInput v-model="form.startDate" />`
3. 所有金额 input → `<MoneyInput v-model="form.principal" :show-chinese="true" />`
4. 结果区 → `<ResultCard title="计算结果" :result="result" exportable @export="onExport" />`
5. 页面进入时 `onMounted` 调 `useToolsRates().ensureLoaded()` 拉最新 LPR

- [ ] **Step 2: 浏览器验证**

Run: `bun dev` → `/dashboard/tools/interest`
- 表单交互、计算结果、导出 Excel 都正常
- 中文大写自动显示
- 利率引用最新值（验证管理后台改 LPR 后这里立刻看到新结果）

- [ ] **Step 3: Commit**

```bash
git add app/pages/dashboard/tools/interest.vue
git commit -m "refactor(tools-ui): interest 页用 CalculatorPageHeader/DateInput/MoneyInput/ResultCard"
```

---

## 任务 PR4-T6 至 PR4-T14：其他 9 个工具页同样重构

每个工具一个 commit：

| 工具页 | 文件 |
|--------|------|
| delayInterest.vue | app/pages/dashboard/tools/ |
| court-fee.vue | 同上 |
| lawyer-fee.vue | 同上 |
| arbitration-fee.vue | 同上 |
| compensation.vue | 同上 |
| overtime-pay.vue | 同上 |
| social-insurance.vue | 同上 |
| divorce-property.vue | 同上 |
| bank-rate.vue / date-calculator.vue | 同上 |

模板：

- [ ] **Step 1: 改造 dashboard/tools/X.vue 用 4 个共用组件**
- [ ] **Step 2: 浏览器验证**
- [ ] **Step 3: `git commit -m "refactor(tools-ui): X 页用共用组件"`**

---

## PR4 收尾：全栈 E2E 走查

- [ ] **Step 1: 跑 typecheck + 全量测试**

Run: `bun run typecheck && bun run test 2>&1 | tail -20`
Expected: typecheck 无错 + 测试全绿

- [ ] **Step 2: 浏览器走一遍 10 个工具页**

每个页面：填入示例数据 → 点计算 → 验证结果 → 点导出 → 验证 Excel 下载

- [ ] **Step 3: 浏览器走一遍 3 个利率管理页**

`/admin/rates/lpr` + `/admin/rates/pboc-deposit` + `/admin/rates/pboc-loan` 都能 CRUD

- [ ] **Step 4: Agent E2E 验证**

通过 `/dashboard/assistant`（法律助手）问"借款 100 万、年利率 4.5%、借期 365 天的利息是多少" → 验证 Agent 选了 `interestCalculator` 并返回正确答案。

- [ ] **Step 5: PR4 收尾 commit**

```bash
git commit --allow-empty -m "chore(tools): PR4 完成 - 共用 UI + 10 个工具页改造 + 全栈 E2E 验证"
```

---

# 收尾：全部 6 个 PR 的总结

```bash
git log --oneline | head -20
git commit --allow-empty -m "chore(tools): 办案工具重构完成 - 数据层/算法层/Agent 工具层/UI 层"
```

实施完成后预期产出：

- `shared/utils/tools/data/` 9 个数据文件（3 个利率 setter + 3 个法规常量 + index + README）
- `shared/utils/tools/algorithms/` 4 个纯函数 + index + README
- `shared/utils/tools/agentTools/` 10 个 *.tool.ts + index
- `server/services/rates/` 2 个文件（dao + service）
- `server/api/v1/tools/rates/` 3 个 GET handler
- `server/api/v1/admin/rates/` 12 个 CRUD handler（3 个资源 × 4 个动作）
- `server/plugins/rates-cache.ts` 1 个启动 plugin
- `app/composables/useToolsRates.ts` 1 个客户端 composable
- `app/pages/admin/rates/` 4 个 admin 页（总览 + 3 个列表）
- `app/components/admin/rates/` 3 个表单 Dialog
- `app/components/tools/` 4 个共用 UI 组件
- 测试：算法 4 文件 + agentTools 10 文件 + service/dao/api 测试若干
- 全部 15 个 tools service/utils 文件保持 100% 覆盖率
- 数据库新增 3 张利率表（带 deletedAt 软删除）
- `prisma/seeds/seedData.sql` 新增 LPR 72 / PBOC 存款 10 / PBOC 贷款 10 条初始数据
- `shared/types/agentTools.ts` 跨层共用类型

