# 办案工具重构 — 设计文档

## 背景

LexSeek 当前 10 个办案工具计算器（`app/pages/dashboard/tools/*.vue` + `shared/utils/tools/*Service.ts`）共约 10000 行代码，存在 4 类系统性冗余：

1. **数据双份**：LPR / 央行存款基准利率 / 央行贷款基准利率分别在 `interestService.ts`（按 `{sTime, rate, type, period}` 维度展开）和 `bankRateService.ts`（按 `{date, oneYear, fiveYear, ...}` 横排）中各维护一份；运维改 LPR 时需同步两处，少改一处就产生计算结果不一致。
2. **算法复刻**：
   - 「按日期查最近一条利率」在 4 个函数中独立实现，边界行为不一致；
   - 「跨利率档分段累加利息」核心循环在 5 处独立实现（`interestService.calculateLPRInterest` / `calculatePBOCInterest` + `delayInterestService` 前后两段 + `interest.vue` 内部第 4 套分段判断）；
   - 「金额分档累进」+ 配套「生成说明文本」在 4 个文件 8 个函数里各写一份（`courtFeeService.calculatePropertyCaseFee` / `calculateExecutionFee` + `lawyerFeeService.calculateCivilLawyerFee` + `arbitrationFeeService`），其中 `getPropertyCaseFeeDetail` 内嵌 10 层 `if-else` 金字塔。
3. **UI 粘贴**：8 个 .vue 帮助按钮模板（共 ~200 行）、4 处带 CSS 隐藏原生 picker 的日期输入框（共 ~80 行）、9 处 `function formatCurrency` 自定义、4 处 `function convertToChinese` 自定义、8 处结果卡 + 折叠明细表格。
4. **AI 缺位**：Agent 平台没有任何法律计算工具，需要 LLM 自己算或忽略；离婚案件 vertical 没法在对话中调用「财产分割计算」。

上一轮工作已建立 **100% 覆盖率测试基线**（`shared/utils/tools/` 下 15 个文件，statements / branches / functions / lines 四项指标全 100%，601 个测试用例），作为本次重构的验证契约：**重构后这套测试必须全部通过、且仍保持 100%**。

## 目标

1. 消除数据/算法/UI 三类冗余，让"运维改 LPR 一处生效全部计算器"成为可能
2. 把 10 个计算器全部包装为 Agent 可调用工具，让通用问答 / 案件分析 / 各 vertical 子节点能按需调用
3. 利率（LPR + 央行存款基准 + 央行贷款基准）入库 + 管理后台可维护，央行发新利率运营加一行 SQL 即可生效
4. 保持现有 100% 测试覆盖率契约不变

## 关键决策记录

| 决策点 | 选择 | 备注 |
|--------|------|------|
| 一般法规常量存储介质 | **TS 常量（git 提交）** | 律师费档位/诉讼费档位/社保费率/加班倍数等 10 年以上未变动 |
| 利率存储介质 | **数据库表 + 管理后台 CRUD** | LPR 月度变动，其他两种利率虽然 10 年未变但管理员一并维护更一致 |
| Agent 工具范围 | **全部 10 个计算器都包装** | 一次到位，nodes.tools 按 vertical 配置启用 |
| 重构节奏 | **拆分 6 个 PR**：PR1a 利率库化 + PR1b 后台 + PR1c 其他常量 + PR2 算法 + PR3 Agent + PR4 UI | 每个 PR 独立可测、可回滚 |
| 缓存策略 | **module-level cache + 启动注入** | 维持 service 同步 API，兼容现有同步测试 |
| 测试基线 | **现有 100% 不动** | 重构受测试验证，不允许反过来改测试 |

## 范围

### 在范围内

- `shared/utils/tools/*Service.ts` 11 个 service（含未上线的 arbitrationFeeService）
- `shared/utils/tools/utils/*.ts` 4 个 utils（calculator / date / excelExport / validators）
- `app/pages/dashboard/tools/*.vue` 10 个 UI 页面 + 1 个 index.vue
- 新增 `app/components/tools/` 共用组件
- 新增 `app/pages/admin/rates/` 后台维护页面
- 新增 `server/services/rates/` 利率领域 DAO + Service + API
- 新增 `shared/utils/tools/data/` 法规常量集中目录
- 新增 `shared/utils/tools/algorithms/` 通用算法目录
- 新增 `shared/utils/tools/agentTools/` Agent 工具包装目录
- 新增 3 张 prisma 表 + seedData.sql 初始数据

### 不在范围内

- 后端服务（server 端）现有任何接口不动（office 端原本就零计算器实现）
- imageWatermarkService（不是计算器）
- 法规级文档自动同步（央行 LPR API 抓取等）— 仍由人工维护
- 客户端实时推送（管理员改完后前端立即生效）— 仅做下一次进入工具页面拉新数据

## 整体架构

四层金字塔，自下而上构建。每一层独立可测，上层只依赖下层稳定 API：

```
┌─────────────────────────────────────────┐  PR4
│  UI 层：10 个 .vue + 4 个共用组件          │
│  CalculatorPageHeader / DateInput（薄包装） │
│  / MoneyInput / ResultCard                │
└────────────────┬────────────────────────┘
                 │ 调
┌────────────────┴────────────────────────┐  PR3
│  Agent 工具层：10 个 *.tool.ts             │
│  zod schema + ToolDefinition；             │
│  nodes.tools JSON 按 vertical 配置         │
└────────────────┬────────────────────────┘
                 │ 调
┌────────────────┴────────────────────────┐  PR2
│  算法层：通用工具                          │
│  applyBrackets / calculateSegmented        │
│  Interest / findRateForDate / roundToCents │
└────────────────┬────────────────────────┘
                 │ 用
┌────────────────┴────────────────────────┐  PR1
│  数据层：法规级常量唯一源                   │
│  - 利率（DB + 后台 CRUD）：PR1a + PR1b     │
│  - 其他常量（TS const）：PR1c              │
│  shared/utils/tools/data/                  │
└─────────────────────────────────────────┘
```

## PR1a · 利率数据库化 + 服务端 API（2 天）

### 数据库 schema

新增 `prisma/models/rates.prisma`，三张表结构对齐现有 TS 类型：

```prisma
/// LPR 利率历史（央行每月公布）
model lpr_rates {
  id          Int       @id @default(autoincrement())
  effectDate  DateTime  @unique @map("effect_date") @db.Date
  oneYear     Decimal   @map("one_year")    @db.Decimal(6,4)
  fiveYear    Decimal   @map("five_year")   @db.Decimal(6,4)
  remark      String?   @db.VarChar(255)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(6)
  @@index([effectDate(sort: Desc)])
  @@index([deletedAt])
}

/// 央行存款基准利率历史
model pboc_deposit_rates {
  id           Int       @id @default(autoincrement())
  effectDate   DateTime  @unique @map("effect_date") @db.Date
  demand       Decimal   @db.Decimal(6,4)
  threeMonths  Decimal   @map("three_months") @db.Decimal(6,4)
  sixMonths    Decimal   @map("six_months")  @db.Decimal(6,4)
  oneYear      Decimal   @map("one_year")    @db.Decimal(6,4)
  twoYear      Decimal   @map("two_year")    @db.Decimal(6,4)
  threeYear    Decimal   @map("three_year")  @db.Decimal(6,4)
  fiveYear     Decimal   @map("five_year")   @db.Decimal(6,4)
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
  sixMonths     Decimal   @map("six_months")     @db.Decimal(6,4)
  oneYear       Decimal   @map("one_year")       @db.Decimal(6,4)
  oneToFiveYear Decimal   @map("one_to_five")    @db.Decimal(6,4)
  fiveYearPlus  Decimal   @map("five_year_plus") @db.Decimal(6,4)
  remark        String?   @db.VarChar(255)
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt     DateTime? @map("deleted_at") @db.Timestamptz(6)
  @@index([effectDate(sort: Desc)])
  @@index([deletedAt])
}
```

> - `effectDate` 用 `@db.Date`（仅需日期粒度，与央行公布形态一致）
> - `createdAt / updatedAt / deletedAt` 统一 `@db.Timestamptz(6)`，与项目 `case.prisma` 等其他业务表惯例对齐
> - 软删除：管理后台「删除」实际写入 `deletedAt = now()`，可恢复；DAO 查询统一 `where: { deletedAt: null }` 过滤

- 迁移走 `bun run prisma:migrate --name init_rates_tables`
- 初始历史数据写入 `prisma/seeds/seedData.sql`，把现有 TS 常量翻译成 INSERT 语句（86 条 LPR + 10 条 PBOC 存款 + 10 条 PBOC 贷款）

### 缓存机制（兼容现有同步 API + 100% 测试基线）

核心思路：shared 层维持 module-level 默认常量作为兜底（也作为测试基线数据），运行时通过 setter 注入最新数据；测试不调 setter → 使用默认 → 测试**完全不变**。

```typescript
// shared/utils/tools/data/lpr.ts
export interface LPRRate {
  date: string          // YYYY-MM-DD（保持现有结构，避免 service 跟着改）
  oneYear: number
  fiveYear: number
}

const DEFAULT_LPR_RATES: readonly LPRRate[] = [
  { date: '2025-07-21', oneYear: 3.00, fiveYear: 3.50 },
  // ... 全量历史快照，与 seedData.sql 保持一致
]

let runtimeCache: readonly LPRRate[] = DEFAULT_LPR_RATES

export function getLPRRates(): readonly LPRRate[] {
  return runtimeCache
}

/** 服务端启动 plugin 调用 / 客户端进入工具页面时调用 */
export function setLPRRates(rates: readonly LPRRate[]): void {
  runtimeCache = [...rates].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )
}
```

同样设计三个利率文件：`lpr.ts` / `pbocRates.ts` / `loanRates.ts`。其他法规常量（fee brackets / social insurance / overtime）走纯 `export const`（PR1c）。

### 服务端 API

按 [CLAUDE.md](CLAUDE.md) 第 5 条规则物理隔离：

```
server/api/v1/tools/rates/                   ← 用户端只读
├── lpr.get.ts
├── pboc-deposit.get.ts
└── pboc-loan.get.ts

server/api/v1/admin/rates/                   ← 管理端 CRUD（03.permission.ts 拦截）
├── lpr/index.get.ts        # GET 列表（按 effectDate desc 分页）
├── lpr/index.post.ts       # POST 新增
├── lpr/[id].patch.ts       # PATCH 修改
├── lpr/[id].delete.ts      # DELETE 删除
├── pboc-deposit/...        # 4 个对应文件
└── pboc-loan/...
```

Service 层 `server/services/rates/`:
- `rates.dao.ts` — Prisma CRUD（查询统一 `where: { deletedAt: null }`；删除走 update `{ deletedAt: new Date() }`）
- `rates.service.ts` — 业务包装；从 DAO 拿到 Prisma 实体后**用 `shared/utils/decimalToNumber.ts` 转换 Decimal 字段为 number** 再返回；写入 DB 后立即调用 `setLPRRates()` 等同步刷新本进程内存缓存

服务端启动 plugin `server/plugins/rates-cache.ts`：进程启动时一次性从 DB 加载全部利率（Decimal → number 已在 service 转好）灌入 `setLPRRates` / `setPBOCDepositRates` / `setPBOCLoanRates`。

### 客户端加载（lazy load 组件级）

不使用 route middleware（粒度过粗）。在 4 个共用组件（PR4 引入）的 setup 中按需 `useApiFetch` 拉取，首次进入工具页面触发，重复进入由现有 fetch 缓存机制去重：

```typescript
// app/components/tools/CalculatorPageHeader.vue 或 useRatesLoader composable
onMounted(async () => {
  const lpr = await useApiFetch<LPRRate[]>('/api/v1/tools/rates/lpr')
  if (lpr) setLPRRates(lpr)
  // 同样 pbocDeposit / pbocLoan
})
```

实现位置：建议抽 `app/composables/useToolsRates.ts` 统一封装，4 个共用组件按需 import 调用。

### RBAC

```
admin:rates:read    →  super_admin / admin / operator
admin:rates:write   →  super_admin / admin
```

新增权限通过 seedData.sql **追加 `INSERT INTO permissions` / `INSERT INTO role_permissions` 新行**（不允许写 UPDATE，参见 [database.md](.claude/rules/database.md) 数据级变更规则）。

## PR1b · 管理后台 admin CRUD 页面（1 天）

照搬现有 admin CRUD 风格（参考 `app/pages/admin/models/` / `app/pages/admin/orders/`）：

```
app/pages/admin/rates/
├── index.vue           # 三个 tab 切换的入口页
├── lpr.vue             # LPR 列表 + 新增/编辑/删除（shadcn Table + Dialog）
├── pboc-deposit.vue    # 同上
└── pboc-loan.vue       # 同上

app/components/admin/rates/
├── LPRFormDialog.vue
├── PbocDepositFormDialog.vue
└── PbocLoanFormDialog.vue
```

`routers` 表新增「数据维护 → 利率管理」入口（`/admin/rates`），归在 admin 主菜单。

UI 行为：列表按 effectDate desc 分页；新增/编辑表单字段对应 schema；**删除走 useAlertDialogStore 二次确认后调用 service 的软删除方法**（实际写 `deletedAt = now()`，可恢复）；保存成功 toast + 刷新列表。

## PR1c · 其他法规常量集中（0.5 天）

新建 `shared/utils/tools/data/` 目录，迁移 TS 常量：

```
shared/utils/tools/data/
├── index.ts                    # 统一 re-export
├── lpr.ts                      # PR1a 已建立
├── pbocRates.ts                # PR1a 已建立
├── loanRates.ts                # PR1a 已建立
├── feeBrackets.ts              # 诉讼费/律师费/仲裁费分档累进表
├── socialInsuranceRates.ts     # 社保 6 险默认费率
├── overtimeRules.ts            # 加班费倍数（工作日 1.5 / 休息日 2.0 / 法定节假日 3.0）
└── README.md                   # 数据维护规则
```

**删除 / 迁移**：
- `interestService.ts` 内嵌的 LPR + 央行基准利率（约 245 行） → `import { getLPRRates, getPBOCDepositRates } from './data'`
- `bankRateService.ts` 内嵌的 LPR + 基准 + 贷款利率（约 115 行） → import
- `delayInterestService.ts:267` 硬编码 `lprRate = 3.85` → **删除**，未找到时 throw（结构上其实不可达，因为 setLPRRates default 非空）
- `socialInsuranceService.ts` 内嵌的 defaultRates → 迁到 `data/socialInsuranceRates.ts`
- `courtFeeService.ts` / `lawyerFeeService.ts` / `arbitrationFeeService.ts` 的分档常量 → 迁到 `data/feeBrackets.ts`

API 形态保持现有数据结构（`{date, oneYear, fiveYear}` 等），适配器函数（如 `getInterestRates(2, 1)` 派生为 `getLPRRates()` 的视图）在 PR2 算法层实现。

## PR2 · 算法层（2-2.5 天）

```
shared/utils/tools/algorithms/
├── index.ts
├── applyBrackets.ts             # 通用分档累进
├── calculateSegmentedInterest.ts # 通用跨利率档分段利息
├── findRateForDate.ts            # 通用按日期查最近利率
├── roundToCents.ts               # 四舍五入到分
└── README.md
```

### 4 个核心算法 API

```typescript
// 1. applyBrackets — 替代 8 处 if-else 金字塔
export interface Bracket {
  upTo: number              // 上限（含），最后一档 Infinity
  rate: number              // 该段费率
  flat?: number             // 该段固定基础费
  label: string             // 说明文本片段
}
export function applyBrackets(amount: number, brackets: Bracket[]): {
  fee: number
  breakdown: Array<{
    from: number
    to: number
    rate: number
    sub: number
    label: string
  }>
}

// 2. calculateSegmentedInterest — 替代 5 处跨段循环
export function calculateSegmentedInterest(params: {
  principal: number
  startDate: string
  endDate: string
  rateTable: Array<{ sTime: string, rate: number }>
  yearDays: 360 | 365
  rateMultiplier?: number          // 迟延履行用 4
}): {
  totalInterest: number
  segments: Array<{
    startDate: string
    endDate: string
    days: number
    rate: number
    adjustedRate: number
    interest: number
  }>
}

// 3. findRateForDate — 替代 4 处按日期查询
export function findRateForDate<T extends { date: string }>(
  table: readonly T[],
  date: string
): T | null

// 4. roundToCents — 替代 11 处 Math.round(x*100)/100
export const roundToCents = (x: number): number => Math.round(x * 100) / 100
```

### 调用方迁移

| 文件 | 改动 |
|------|------|
| `interestService.calculateLPRInterest` | 改用 `calculateSegmentedInterest` + `findRateForDate` |
| `interestService.calculatePBOCInterest` | 同上 |
| `delayInterestService` 前段（基准利率） | 改用 `calculateSegmentedInterest`（rateMultiplier=1） |
| `delayInterestService` 后段（LPR×4） | 改用 `calculateSegmentedInterest`（rateMultiplier=4） |
| `courtFeeService.calculatePropertyCaseFee` + `getPropertyCaseFeeDetail` | 合并改用 `applyBrackets`，删除 60 行嵌套 10 层 if-else |
| `courtFeeService.calculateExecutionFee` + `getExecutionFeeDetail` | 同上 |
| `lawyerFeeService.calculateCivilLawyerFee` + `getCivilFeeDescription` | 同上 |
| `arbitrationFeeService` 内的两个 | 同上 |
| `bankRateService.queryLPRRate` / `queryDepositRate` / `queryLoanRate` | 改用 `findRateForDate` |
| 全部 11 处 `Math.round(x*100)/100` | 改用 `roundToCents` |
| `interest.vue:822-966` 第 4 套跨段判断 | **删除**，让 service 内部处理 |

服务端对外 API（calculate 函数签名 / 返回值）**完全不变**，测试基线 100% 保持。

## PR3 · Agent 工具层（1.5 天）

```
shared/utils/tools/agentTools/
├── index.ts
├── delayInterestCalculator.tool.ts
├── interestCalculator.tool.ts
├── courtFeeCalculator.tool.ts
├── lawyerFeeCalculator.tool.ts
├── compensationCalculator.tool.ts
├── overtimePayCalculator.tool.ts
├── socialInsuranceCalculator.tool.ts
├── divorcePropertyCalculator.tool.ts
├── bankRateQuery.tool.ts
└── dateCalculator.tool.ts
```

### 类型迁移（关键前置）

现有 `ToolDefinition` / `ToolContext` 定义在 `server/services/agent-platform/tools/types.ts`，shared 层 import 会形成跨层依赖（违反 [types.md](.claude/rules/types.md) 第 3 节规范）。

**PR3 第一步**：把这两个类型迁移到 `shared/types/agentTools.ts`，server 侧改为从 shared 导入。Agent 工具文件即可干净地依赖 shared 类型，不引入 server 依赖。

### 工具统一模板

每个工具一个文件，结构对齐现有 `server/agents/contract/tools/parseAndAskStance.tool.ts`。**注意 `tool()` 第二参数传 plain object，不要用 `ToolDefinition<typeof schema>` 包装**（这是 LangChain 0.3+ 的标准用法，Context7 核对源码确认）：

```typescript
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { calculateDivorceProperty } from '../divorcePropertyService'
import type { ToolContext } from '#shared/types/agentTools'

const schema = z.object({
  totalAssets: z.number().describe('夫妻共同财产总额（元）'),
  totalDebts: z.number().describe('夫妻共同债务总额（元）'),
  husbandPersonalAssets: z.number().default(0).describe('丈夫个人财产'),
  wifePersonalAssets: z.number().default(0).describe('妻子个人财产'),
  hasChildSupport: z.boolean().default(false).describe('是否涉及子女抚养'),
  childAge: z.number().optional(),
  custodyParty: z.enum(['husband', 'wife', 'shared']).optional(),
  // ... 完整参数
})

const toolDefinition = {
  name: 'divorce_property_calculator',
  description:
    '依据《民法典》原则计算离婚财产分割：夫妻共同财产、个人财产、债务分担、抚养费等。' +
    '调用前从对话中提取或主动询问必要参数（财产总额、债务、个人财产、抚养相关）。',
  schema,
} as const

export { toolDefinition }

export const createTool = (_ctx: ToolContext) => tool(
  async (input) => {
    const result = calculateDivorceProperty(input)
    return JSON.stringify(result)
  },
  toolDefinition,
)
```

> - `.describe()` 会被 LangChain 自动抽取进 JSON Schema 的 `description` 字段，让 LLM 看到（Context7 验证）
> - `.default(0)` 会生成 JSON Schema `default` 字段，LLM 可合法省略该参数
> - `tool()` 第二参数传 **plain object**（不要用 `ToolDefinition<typeof schema>` 类型包装），这是 LangChain v0.3+ 的标准用法
> - 返回 `JSON.stringify(result)` 让 LLM 能解析结构化输出

### nodes.tools 配置（按 vertical 关联）

更新 `prisma/seeds/seedData.sql` 的 `nodes` 表 `tools` 字段：

| 节点 | 新增 tools 名 |
|------|-------------|
| `assistantMain` | 全部 10 个（让助手能按问答需要调） |
| `caseAnalysisMain` | divorce_property / compensation / court_fee / lawyer_fee / interest_calculator |
| `caseModuleDivorce`（如有此节点） | divorce_property |
| `caseModuleLabor`（如有） | compensation / overtime_pay / social_insurance |
| `caseModuleLoan`（如有） | interest_calculator / delay_interest |
| 合同审查 / 文档起草 vertical | 不添加（与计算无关） |

数据级变更，seedData.sql 直接改 INSERT VALUES。

### Agent 工具测试

每个工具一个 `.tool.test.ts`，放在 **`tests/shared/utils/tools/agentTools/`**（与现有 15 个 service 测试同级）：
- mock ToolContext，调 createTool 返回的 tool
- 用 zod schema 喂典型参数，验证返回 JSON 中关键字段
- 不重复 service 业务逻辑测试（已 100% 覆盖）

### 端到端集成验证（完成判定）

在 PR3 合并前补充 **「通用问答在对话中调用所有 10 个工具」** 的端到端集成测试：
- 测试位置：`tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts`
- 验证方式：构造 10 个典型业务问答 prompt（如"原告 100 万欠款，借期 1 年，按 LPR 4 倍算迟延履行利息是多少"），让 assistantMain agent 完整跑一遍，断言至少有一次 tool_call 命中目标工具
- 这条测试不替代各工具单测，但兜住"工具配进 nodes.tools 但 LLM 看不到 / 调不到"的回归

## PR4 · UI 层（2 天）

### 4 个共用组件

```
app/components/tools/
├── CalculatorPageHeader.vue
├── DateInput.vue
├── MoneyInput.vue
└── ResultCard.vue
```

**CalculatorPageHeader**：标题 + 问号按钮 + 弹出帮助卡（用 Popover + HelpCircle）。替代 8 处粘贴。

**DateInput**：**复用** 现有 `app/components/ui/calendar/` 的 Calendar + Popover 组合，做薄包装：触发器是带日历图标的 Input，点击弹出 Calendar 选日期。替代 4 处「Input type=date + 隐藏原生 picker CSS」的旧实现。

**MoneyInput**：金额输入 + 内部调 `numberToChinese` 显示大写。替代 4 处 convertToChinese。

**ResultCard**：结果展示卡 + Accordion 折叠明细表格（**复用** `app/components/ui/card/` + `app/components/ui/accordion/`）。替代 8 处粘贴。

### 删除清单

- 9 处 `function formatCurrency(value)` 自写 → 统一改 `import { formatRMB } from '#shared/utils/tools/utils/calculator'`
- 4 处 `function convertToChinese()` 自写 → MoneyInput 内部用 numberToChinese
- 8 处帮助按钮模板（约 200 行粘贴）
- 4 处日期输入模板 + CSS（约 80 行粘贴）
- 8 处结果卡 + 明细表（约 200 行粘贴）
- [interest.vue:540](app/pages/dashboard/tools/interest.vue:540) 的 `designatedLprTable` 第 3 份 LPR 日期表 → `getLPRRates().map(r => r.date)` 派生
- [interest.vue:822-966](app/pages/dashboard/tools/interest.vue:822) 第 4 套跨 LPR 实施日分段算法 → 删除（service 已处理）

> **不在本期范围**：`shared/utils/tools/utils/date.ts` / `app/utils/formatDate.ts` / 各 .vue 内联 formatDate 的 dayjs 迁移。这属于体系级技术债清理，与本次重构主线（数据 / 算法 / Agent / UI 复用）无直接关系，应独立规划。本期保留现有 date.ts。

## 测试基线契约

**核心约束**：每个 PR 完成后，跑：

```bash
npx vitest run tests/shared/utils/tools/ --coverage
```

必须显示 **15 个文件 statements / branches / functions / lines 四项指标全 100%**。

- 现有 601 个测试用例**完全不修改**
- 36+ 处 `expect(result.details.some(d => d.includes(...)))` 关键字断言保持
- 如重构导致某个分支变得不可达，必须**删除**该分支（用 TS `!` 断言或代码简化），不允许加 `/* istanbul ignore */` 注释（vitest+nuxt+esbuild 环境下注释失效，见 [coverage-exceptions.md](../../../tests/shared/utils/tools/coverage-exceptions.md)）

新增模块（rates DAO / Service / API、Agent 工具、UI 组件）各自有独立的测试，不依赖测试基线 100% 约束。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 测试基线 100% 在重构中破坏 | 每个 PR 完成 + 准备合并前必跑 coverage 验证 |
| `calculateSegmentedInterest` 抽象后利息计算结果与现有不一致 | service 测试基线断言精确金额，不一致会立即失败 |
| `applyBrackets` 抽象后 `details` 字符串与现有不一致 | 测试基线断言关键字段；breakdown 输出格式与现有 `getXxxFeeDetail` 文本对齐 |
| 利率缓存与 DB 数据不一致（管理员改完后另一进程未刷新） | 多进程部署时通过 SSE 或下次进程重启刷新；本期接受"下次工具页面进入时拉新"延迟 |
| 客户端拉取利率失败时使用什么数据 | 默认 DEFAULT_LPR_RATES 兜底（与 seedData.sql 同步），保证计算器不崩 |
| seedData.sql 的 LPR 初始数据与 DEFAULT_LPR_RATES 不一致 | 通过同一份 generated 脚本互导：单一权威源 + 同步检查 |
| Agent 工具 schema 字段不全 / LLM 调用时缺参 | description 中明示"调用前需提取或询问"；service 内部有参数校验降级返回 |
| 6 个 PR 累积复杂度高 | 每个 PR 通过 [getting-started/pr-template] 单独 review，发现问题立即在该 PR 内修复 |

## 不实施清单（YAGNI）

- 实时 LPR API 抓取（央行无开放 API；运营月度手动维护可接受）
- 多进程 Redis 缓存同步（本期单进程部署够用）
- 利率历史变更审计日志（Prisma `updatedAt` + git 历史足够追溯）
- 工具用量统计（Agent skill metrics 不在本期范围）
- UI 层 FormField 通用包装（Tailwind 类名重复非关键问题）
- 删除 details: string[] 字段（保留以兼容测试基线 36+ 关键字断言）

## 完成判定

- [ ] 6 个 PR 全部合入 dev 分支
- [ ] `npx vitest run tests/shared/utils/tools/ --coverage` 显示 15 个文件四项指标全 100%
- [ ] `bun run typecheck` 无错误
- [ ] admin 后台「利率管理」可登录、可增删改（带 deletedAt 软删除）、修改后立即在工具页面生效
- [ ] 10 个工具页面在 dashboard 视觉无回归（chrome-devtools MCP 快照比对）
- [ ] 通用问答 Agent 在对话中可成功调用全部 10 个计算工具（`tests/server/agents/legal-assistant/calculator-tools.e2e.test.ts` 全绿）

## 工作量估算

| PR | 估算 | 关键风险 |
|----|------|--------|
| PR1a 利率库化 + 服务端 API | 2 天 | Decimal → number 转换边界、缓存与 DB 一致性 |
| PR1b 管理后台 admin CRUD | 1 天 | 多 tab 列表 + 三套 FormDialog |
| PR1c 其他常量迁移 | 0.5 天 | fee brackets / 社保 / 加班全部入 `shared/utils/tools/data/` |
| PR2 算法层抽象 + 调用方迁移 | **2-2.5 天** | 5 处 service 调用方改写 + breakdown 文本与现有 details 字段对齐 + 测试基线 100% 验证 |
| PR3 Agent 工具层 | 1.5 天 | 类型迁移到 shared + 10 个工具实现 + E2E 集成测试 |
| PR4 UI 层 4 个共用组件 | 2 天 | DateInput 薄包装 Calendar + 10 个页面替换 |
| **总计** | **9-10 天** | 每个 PR 独立验证，可串可并 |

## 后续

实施计划由 writing-plans skill 产出，落地为 `docs/superpowers/plans/2026-05-14-tools-refactor-plan.md`。
