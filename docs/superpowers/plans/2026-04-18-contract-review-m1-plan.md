# 合同审查 M1 实施 Plan（数据层 + 依赖 + 样本）

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为合同审查 Phase 2（[spec](../specs/2026-04-17-contract-review-design.md)）准备数据层、依赖、共享类型、seed 骨架与样本合同 fixture，解锁后续 M2（docx 子模块）/ M3（AI 审查闭环）的实施。

**Architecture:** 纯"地基"层：Prisma schema 新增 `contract_reviews` 表、依赖装包、共享类型落地、中间件命名常量注册、seed 函数骨架（节点先 status=0 禁用，M3 再激活），不触碰任何 agent / API / UI 代码。

**Tech Stack:** Prisma 6.x + PostgreSQL；TypeScript + Zod；Bun 包管理；Vitest 测试；mammoth / jszip / fast-xml-parser / diff-match-patch / docx-preview。

**前置参考：**
- Spec：`docs/superpowers/specs/2026-04-17-contract-review-design.md`（尤其 §5 数据模型 / §11 M1 产出 / §14 开放问题）
- 范例代码：`prisma/models/document.prisma`、`prisma/seed.ts:36-220`（seedAssistantMainNode / seedAssistantTokenRule 结构）、`shared/types/case.ts:162`（InterruptType 枚举）、`server/services/workflow/middleware/types.ts`（MIDDLEWARE_NAMES / MIDDLEWARE_PRIORITY）
- 项目规范：`.claude/rules/commands.md`（测试用 `npx vitest run`）、`.claude/rules/git.md`（commit scope 约定）、`CLAUDE.md`（数据库本地运行在 docker）

**TDD 原则：** 每项类型 / 常量 / 函数变更先写 Vitest 失败测试，再实现，再跑通。参考 @superpowers:test-driven-development。

---

## 文件变更清单（统一概览）

**新建**
- `prisma/models/contractReview.prisma`
- `prisma/seeds/contract-samples/` 目录（含 5 份 .docx + README.md）
- `shared/types/contract.ts`
- `tests/shared/types/contract.test.ts`
- `tests/server/workflow/middleware/middlewareNames.test.ts`
- `tests/shared/types/case.interruptType.test.ts`
- `tests/server/prisma/seed-contract.test.ts`
- `tests/server/contract/sampleFixtures.test.ts`

**修改**
- `package.json` + `bun.lock`（装依赖）
- `shared/types/case.ts`（InterruptType 枚举加 AWAITING_STANCE）
- `server/services/workflow/middleware/types.ts`（MIDDLEWARE_NAMES 加 REVIEW_RESULT_PERSISTENCE 常量）
- `prisma/models/user.prisma`（追加 `contractReviews contractReviews[]` 反向关联，按项目约定）
- `prisma/seed.ts`（**export** `seedContractReviewMainNode` / `seedContractReviewTokenRule` 两个函数，供单测调用；**main() 不 await 调用**，M3 激活节点时再追加 await 并把 status=0→1）
- `.claude/rules/git.md`（scope 列表新增 `contract`）

**本期不动**（M2/M3 负责）
- `server/services/assistant/contract/**`、`server/services/workflow/middleware/reviewResultPersistence.middleware.ts`、`server/services/workflow/middleware/index.ts`（M3 实现 middleware 时一起补 export）
- `prisma/seeds/seedData.sql`（M3 启动并激活节点时一起补 nodes / prompts / point_consumption_items 对应 INSERT；参考 `case_analysis_token` id=12 的实际格式）
- 前端任何代码

---

## Task 1：安装新依赖

**Files:**
- Modify: `package.json`、`bun.lock`

- [ ] **Step 1.1：检查现有依赖清单**

```bash
grep -E '"(fast-xml-parser|diff-match-patch|docx-preview|mammoth|jszip)"' /Users/daixin/work/dev/LexSeek/LexSeek/package.json
```

**Expected:** 应看到 `mammoth`、`jszip` 条目（已装），`fast-xml-parser` / `diff-match-patch` / `docx-preview` **缺失**。

- [ ] **Step 1.2：装 `fast-xml-parser` 和 `diff-match-patch`**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
bun add fast-xml-parser diff-match-patch
bun add -d @types/diff-match-patch
```

**Expected:** `package.json` dependencies 里新增两条；devDependencies 含 `@types/diff-match-patch`（diff-match-patch 自身无官方 .d.ts）。`bun.lock` 更新。

- [ ] **Step 1.3：按需装 `docx-preview`**

```bash
grep -q '"docx-preview"' package.json || bun add docx-preview
```

**Expected:** 若已有则跳过；若新装则 `package.json` 新增条目。

- [ ] **Step 1.4：冒烟验证 import 能跑**

```bash
bun -e "import { XMLParser } from 'fast-xml-parser'; import DMP from 'diff-match-patch'; console.log(typeof XMLParser, typeof DMP)"
```

**Expected:** 输出 `function function`，无 import 错误。

- [ ] **Step 1.5：Commit**

```bash
git add package.json bun.lock
git commit -m "$(cat <<'EOF'
chore(contract): 安装合同审查 M1 依赖

新增 fast-xml-parser（批注 XML 操作）与 diff-match-patch（条款级 diff 渲染）。
docx-preview 按需补装。mammoth / jszip 已在既有依赖中。
EOF
)"
```

---

## Task 2：`.claude/rules/git.md` 新增 `contract` scope

**Files:**
- Modify: `.claude/rules/git.md`（Scope 作用域章节）

- [ ] **Step 2.1：修改 scope 列表**

在 `## Scope 作用域` 下的列表末尾追加一行（保持与现有条目同格式）：

```markdown
- `contract` - 合同审查
```

- [ ] **Step 2.2：确认修改后的 scope 表完整**

```bash
grep -n "^- \`contract\`" .claude/rules/git.md
```

**Expected:** 输出一行含 `` - `contract` - 合同审查 ``。

- [ ] **Step 2.3：Commit**

```bash
git add .claude/rules/git.md
git commit -m "docs(contract): git.md scope 列表新增 contract 条目"
```

---

## Task 3：扩展 InterruptType 枚举（AWAITING_STANCE）

**Files:**
- Modify: `shared/types/case.ts:162-171`
- Create: `tests/shared/types/case.interruptType.test.ts`（作为一次性 regression guard，防止未来误删枚举值）

**说明：** 枚举新增一个值属于纯声明性变更，项目惯例是"直接改 + typecheck"。本 Task 保留一个轻量单测是为了锁定 `AWAITING_STANCE='awaiting_stance'` 字面值不被未来 PR 意外改动（前端 interrupt 分发依赖此字符串），**不走 "先写失败测试" 的 TDD 节拍**。

- [ ] **Step 3.1：添加枚举值**

在 `shared/types/case.ts:170` 的 `INSUFFICIENT_POINTS` 条后追加：

```typescript
    /** 中断点5：合同审查立场选择（甲方 / 乙方 / 中立；payload 含 partyA / partyB / contractType） */
    AWAITING_STANCE = 'awaiting_stance',
```

- [ ] **Step 3.2：创建回归测试**

`tests/shared/types/case.interruptType.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { InterruptType } from '#shared/types/case'

describe('InterruptType enum', () => {
    it('保留现有 4 个中断类型', () => {
        expect(InterruptType.CASE_INFO_CHECK).toBe('case_info_check')
        expect(InterruptType.BASIC_INFO_CONFIRM).toBe('basic_info_confirm')
        expect(InterruptType.MODULE_SELECT).toBe('module_select')
        expect(InterruptType.INSUFFICIENT_POINTS).toBe('insufficient_points')
    })

    it('新增立场等待中断值 AWAITING_STANCE=awaiting_stance', () => {
        expect(InterruptType.AWAITING_STANCE).toBe('awaiting_stance')
    })
})
```

- [ ] **Step 3.3：跑测试 + typecheck**

```bash
npx vitest run tests/shared/types/case.interruptType.test.ts --reporter=verbose
npx nuxi typecheck 2>&1 | grep -E "(case\.ts|InterruptType)" | head -10
```

**Expected:** 测试 PASS；typecheck 无与 `case.ts` / `InterruptType` 相关新增错误。

- [ ] **Step 3.4：Commit**

```bash
git add shared/types/case.ts tests/shared/types/case.interruptType.test.ts
git commit -m "feat(contract): InterruptType 新增 AWAITING_STANCE 立场中断枚举"
```

---

## Task 4：新建 `shared/types/contract.ts`（枚举 + API 接口）

**Files:**
- Create: `shared/types/contract.ts`
- Create: `tests/shared/types/contract.test.ts`

- [ ] **Step 4.1：写失败测试**

创建 `tests/shared/types/contract.test.ts`：

```typescript
import { describe, it, expectTypeOf } from 'vitest'
import type {
    RiskLevel,
    Stance,
    ContractReviewStatus,
    Risk,
    CreateReviewRequest,
    CreateReviewResponse,
    StanceRequest,
    PatchReviewRequest,
    RebuildDocxResponse,
    DownloadResponse,
} from '#shared/types/contract'

describe('shared/types/contract exports', () => {
    it('RiskLevel 是 high | medium | low 联合', () => {
        expectTypeOf<RiskLevel>().toEqualTypeOf<'high' | 'medium' | 'low'>()
    })

    it('Stance 三值', () => {
        expectTypeOf<Stance>().toEqualTypeOf<'partyA' | 'partyB' | 'neutral'>()
    })

    it('ContractReviewStatus 五状态', () => {
        expectTypeOf<ContractReviewStatus>().toEqualTypeOf<
            'pending' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'
        >()
    })

    it('Risk 必需字段齐全', () => {
        const sample: Risk = {
            id: 'uuid-1',
            clauseIndex: 3,
            clauseText: '条款原文',
            level: 'high',
            category: '付款',
            problem: '付款周期过长',
            analysis: '分析文本',
            risk: '法律风险',
            suggestion: '改为 30 日内',
            suggestedClauseText: '甲方应在收到发票后 30 日内付款',
        }
        expectTypeOf(sample).toMatchTypeOf<Risk>()
    })

    it('CreateReviewRequest / Response 形状', () => {
        const req: CreateReviewRequest = { sourceType: 'paste', text: '合同文本' }
        const resp: CreateReviewResponse = { reviewId: 1, sessionId: 's-1' }
        expectTypeOf(req.sourceType).toEqualTypeOf<'upload' | 'paste'>()
        expectTypeOf(resp).toMatchTypeOf<CreateReviewResponse>()
    })

    it('StanceRequest 允许可选 partyA / partyB', () => {
        const body: StanceRequest = { stance: 'partyA' }
        const body2: StanceRequest = { stance: 'neutral', partyA: 'A', partyB: 'B' }
        expectTypeOf(body).toMatchTypeOf<StanceRequest>()
        expectTypeOf(body2).toMatchTypeOf<StanceRequest>()
    })

    it('PatchReviewRequest 只含 risks（不含 summary）', () => {
        const body: PatchReviewRequest = { risks: [] }
        expectTypeOf(body).toMatchTypeOf<PatchReviewRequest>()
        // @ts-expect-error summary 被设计砍掉，不应可赋值
        const bad: PatchReviewRequest = { risks: [], summary: 'x' }
        void bad
    })

    it('Rebuild / Download 响应', () => {
        const r: RebuildDocxResponse = { reviewedFileId: 1, downloadUrl: 'https://x' }
        const d: DownloadResponse = { downloadUrl: 'https://y' }
        expectTypeOf(r).toMatchTypeOf<RebuildDocxResponse>()
        expectTypeOf(d).toMatchTypeOf<DownloadResponse>()
    })
})
```

- [ ] **Step 4.2：运行测试，确认失败**

```bash
npx vitest run tests/shared/types/contract.test.ts --reporter=verbose
```

**Expected:** 失败，提示 `Cannot find module '#shared/types/contract'`。

- [ ] **Step 4.3：创建 `shared/types/contract.ts`**

```typescript
// shared/types/contract.ts
// 合同审查模块双端共享类型（spec §5.2）。Prisma row 类型通过 #shared/types/prisma 导入，不在此镜像。

export type RiskLevel = 'high' | 'medium' | 'low'

export type Stance = 'partyA' | 'partyB' | 'neutral'

export type ContractReviewStatus =
    | 'pending'
    | 'reviewing'
    | 'awaiting_stance'
    | 'completed'
    | 'failed'

/** 单条风险点（存 contractReviews.risks JSON 字段） */
export interface Risk {
    id: string
    clauseIndex: number
    clauseText: string
    level: RiskLevel
    category: string
    problem: string
    legalBasis?: string
    analysis: string
    risk: string
    suggestion: string
    /** high/medium 级别必填（schema 层 refine 强制；low 可省） */
    suggestedClauseText?: string
}

// ==================== API 请求 / 响应 ====================

export interface CreateReviewRequest {
    sourceType: 'upload' | 'paste'
    /** sourceType='upload' 必填 */
    ossFileId?: number
    /** sourceType='paste' 必填；长度 ≥ 50、≤ 50_000 */
    text?: string
}

export interface CreateReviewResponse {
    reviewId: number
    sessionId: string
}

export interface StanceRequest {
    stance: Stance
    /** 允许用户在 Dialog 中补充 / 修正 AI 识别的甲方名称 */
    partyA?: string
    /** 同上，乙方 */
    partyB?: string
}

export interface PatchReviewRequest {
    /** 全量替换；后端按 RISK_SHAPE 校验 */
    risks: Risk[]
}

export interface RebuildDocxResponse {
    reviewedFileId: number
    downloadUrl: string
}

export interface DownloadResponse {
    downloadUrl: string
}
```

- [ ] **Step 4.4：再跑测试，确认通过**

```bash
npx vitest run tests/shared/types/contract.test.ts --reporter=verbose
```

**Expected:** 全绿。

- [ ] **Step 4.5：typecheck**

```bash
npx nuxi typecheck 2>&1 | grep -iE "(shared/types/contract|shared\\\\types\\\\contract)" | head -10
```

**Expected:** 无错误。

- [ ] **Step 4.6：Commit**

```bash
git add shared/types/contract.ts tests/shared/types/contract.test.ts
git commit -m "feat(contract): 新建 shared/types/contract.ts 共享类型"
```

---

## Task 5：`MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE` 常量

**Files:**
- Modify: `server/services/workflow/middleware/types.ts`
- Create: `tests/server/workflow/middleware/middlewareNames.test.ts`（作为 regression guard 锁定字面值）

**说明：** 常量追加属于纯声明性变更，不走"先写失败测试"节拍，直接改 + 单测验证 + typecheck。

- [ ] **Step 5.1：添加常量**

在 `server/services/workflow/middleware/types.ts` 的 `MIDDLEWARE_NAMES` 对象里，于 `RESULT_PERSISTENCE: 'analysisResultPersistence'`（L60）之后追加：

```typescript
    /** 合同审查结果持久化中间件（与 RESULT_PERSISTENCE 共享 priority=90） */
    REVIEW_RESULT_PERSISTENCE: 'reviewResultPersistence',
```

**注意：** 不要动 `MIDDLEWARE_PRIORITY`（90 是多个持久化中间件共享的通用优先级）。不动 `buildMiddlewareStack` 互斥校验（L74-81 只管 MATERIAL_CONTEXT vs MODULE_CONTEXT，与本新增无关）。

- [ ] **Step 5.2：创建回归测试**

`tests/server/workflow/middleware/middlewareNames.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { MIDDLEWARE_NAMES, MIDDLEWARE_PRIORITY } from '~~/server/services/workflow/middleware/types'

describe('MIDDLEWARE_NAMES / PRIORITY（合同审查扩展）', () => {
    it('保留既有 RESULT_PERSISTENCE=analysisResultPersistence', () => {
        expect(MIDDLEWARE_NAMES.RESULT_PERSISTENCE).toBe('analysisResultPersistence')
    })

    it('新增 REVIEW_RESULT_PERSISTENCE=reviewResultPersistence', () => {
        expect(MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE).toBe('reviewResultPersistence')
    })

    it('RESULT_PERSISTENCE 优先级仍为 90（末位执行）', () => {
        expect(MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE).toBe(90)
    })
})
```

- [ ] **Step 5.3：跑测试 + typecheck**

```bash
npx vitest run tests/server/workflow/middleware/middlewareNames.test.ts --reporter=verbose
npx nuxi typecheck 2>&1 | grep -E "middleware/types" | head -10
```

**Expected:** 3 个 case 全 PASS；typecheck 无与中间件常量相关新错误。

- [ ] **Step 5.4：Commit**

```bash
git add server/services/workflow/middleware/types.ts tests/server/workflow/middleware/middlewareNames.test.ts
git commit -m "feat(contract): MIDDLEWARE_NAMES 新增 REVIEW_RESULT_PERSISTENCE 常量"
```

---

## Task 6：`contract_reviews` 表（Prisma migrate）

**Files:**
- Create: `prisma/models/contractReview.prisma`
- Modify: Prisma 会生成迁移到 `prisma/migrations/XXXXXXXX_add_contract_reviews/`
- Modify: `~~/generated/prisma/client`（自动生成，无需手工编辑）

- [ ] **Step 6.1：确认本地 Postgres 容器运行中**

```bash
docker ps | grep postgres
```

**Expected:** 至少一个 running 的 postgres 容器。若未运行，先 `docker compose up -d postgres`（按项目 README）。

- [ ] **Step 6.2：创建 model 文件**

新建 `prisma/models/contractReview.prisma`：

```prisma
/// 合同审查记录表 - 每次合同审查会话的持久化记录（spec §5.1）
/// 约束：
/// - MVP 不含 caseId 列（§1.2 案件页复用延后）；M6+ 通过 ALTER TABLE 补列
/// - sessionId 改为 UNIQUE（override 父 spec §4.6 的 @@index）：重审 = 新建 review，1:1 映射
model contractReviews {
    id             Int       @id @default(autoincrement())
    userId         Int       @map("user_id")
    /// 关联 case_sessions.sessionId（scope='contract'）
    sessionId      String    @map("session_id") @db.VarChar(100)
    /// 原始合同 OSS 文件ID
    originalFileId Int       @map("original_file_id")
    /// 批注后的 OSS 文件ID（审查完成前为空；重生后覆盖）
    reviewedFileId Int?      @map("reviewed_file_id")
    /// AI 识别的合同类型（劳动/租赁/买卖/服务/借款/...）
    contractType   String?   @db.VarChar(50)
    /// 甲方名称
    partyA         String?   @db.VarChar(200)
    /// 乙方名称
    partyB         String?   @db.VarChar(200)
    /// 用户审查立场：partyA / partyB / neutral
    stance         String?   @db.VarChar(20)
    /// 审查状态：pending / reviewing / awaiting_stance / completed / failed
    status         String    @default("pending") @db.VarChar(30)
    /// 风险点列表（JSON 数组，schema 见 shared/types/contract.ts Risk[]）
    risks          Json?     @db.JsonB
    /// 审查摘要文本（Markdown）
    summary        String?   @db.Text
    createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    updatedAt      DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    deletedAt      DateTime? @map("deleted_at") @db.Timestamptz(6)

    user users @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    @@unique([sessionId], map: "idx_contract_reviews_session")
    @@index([userId, deletedAt], map: "idx_contract_reviews_user")
    @@index([status], map: "idx_contract_reviews_status")
    @@map("contract_reviews")
}
```

- [ ] **Step 6.3 ：users model 追加反向关联（项目约定必须）**

```bash
grep -n "model users" prisma/models/user.prisma
grep -nE "^\s+(cases|caseSessions|documentDrafts)\s+\w+\[\]" prisma/models/user.prisma
```

**Expected：** 看到 `users` model 定义，且多行形如 `cases cases[]` / `caseSessions caseSessions[]` / `documentDrafts documentDrafts[]` —— 证明项目对 1:N 关系一律双向声明。

在 `users` model 末尾、`@@index` 之前、跟 `documentDrafts documentDrafts[]` 同一段（约 L87 附近）追加：

```prisma
    contractReviews contractReviews[]
```

- [ ] **Step 6.4：跑 Prisma migrate**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
bun run prisma:generate
# package.json 的 "prisma:migrate" 脚本已是 "prisma migrate dev"，额外参数透传即可
bun run prisma:migrate --name add_contract_reviews
```

**Expected:**
- `prisma format` 无错
- 生成 `prisma/migrations/YYYYMMDDHHMMSS_add_contract_reviews/migration.sql`
- SQL 中应含 `CREATE TABLE "contract_reviews"`、`CREATE UNIQUE INDEX "idx_contract_reviews_session"`、`CREATE INDEX "idx_contract_reviews_user"`、`CREATE INDEX "idx_contract_reviews_status"`、外键 `contract_reviews_user_id_fkey`
- **SQL 中不应含** `case_id` 列或 `idx_contract_reviews_case` 索引（MVP 裁剪）

- [ ] **Step 6.5：验证生成的 TypeScript 类型可用**

```bash
bun -e "import type { contractReviews } from '~~/generated/prisma/client'; const r: contractReviews = null as any; console.log('ok')"
```

**Expected:** `ok`，无 TS 错。

- [ ] **Step 6.6：Commit**

```bash
git add prisma/models/contractReview.prisma prisma/models/user.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(contract): 新增 contract_reviews 表 migration

- 字段沿用父 spec §4.6；sessionId 改为 UNIQUE（"重审=新建"约束）
- MVP 不含 caseId 列与 idx_contract_reviews_case 索引（延后至 M6+ 案件页复用）
- users model 补反向关联 contractReviews[]
EOF
)"
```

---

## Task 7：5 份占位样本合同入仓

**Files:**
- Create: `prisma/seeds/contract-samples/` 目录
- Create: `prisma/seeds/contract-samples/labor.docx`（劳动合同）
- Create: `prisma/seeds/contract-samples/lease.docx`（租赁合同）
- Create: `prisma/seeds/contract-samples/sale.docx`（买卖合同）
- Create: `prisma/seeds/contract-samples/service.docx`（服务合同）
- Create: `prisma/seeds/contract-samples/loan.docx`（借款合同）
- Create: `prisma/seeds/contract-samples/README.md`
- Create: `tests/server/contract/sampleFixtures.test.ts`

- [ ] **Step 7.1：准备 5 份样本的原始文本**

临时存到工作区外（如 `/tmp/contract-sample-texts/*.md`），每份 300-800 字，需包含：
- 甲方 / 乙方 明示标签（用"甲方：XXX 公司" / "乙方：XXX"写法，便于 M2 partyDetector 正则命中）
- 至少 5-8 个带风险的条款（付款、交付、违约、保密、争议解决等）
- 无 `{{}}` 占位符（区别于文书模板）

**内容来源：** 由工程通过 AI / 网络通用模板生成脱敏版本，禁止用任何真实客户合同。

- [ ] **Step 7.2：将 5 份 .md 转为 .docx 入库**

使用外部工具（Microsoft Word / Google Docs / Pandoc）将每份 .md 转为 .docx。或临时写一个转换脚本（非仓库代码，仅一次性用）：

```bash
# 示例（如装了 pandoc）
for name in labor lease sale service loan; do
    pandoc /tmp/contract-sample-texts/$name.md -o prisma/seeds/contract-samples/$name.docx
done
```

然后**删除** `/tmp/contract-sample-texts/`（不入仓），只保留 `prisma/seeds/contract-samples/*.docx`。

- [ ] **Step 7.3：写 README 说明**

`prisma/seeds/contract-samples/README.md`：

```markdown
# 合同审查样本 Fixture

本目录的 5 份 .docx **仅用于 M1-M5 单元/集成/E2E 测试**，不参与生产 seed。

| 文件 | 合同类型 |
|---|---|
| labor.docx | 劳动合同 |
| lease.docx | 房屋租赁合同 |
| sale.docx | 买卖合同 |
| service.docx | 服务合同 |
| loan.docx | 借款合同 |

## 要求（由工程在外部工具生成）

1. 每份 300-800 字，含 6-10 个可疑条款（付款 / 交付 / 违约 / 保密 / 争议解决等）
2. 甲方 / 乙方 用明示"甲方：XXX" / "乙方：XXX"写法（方便 partyDetector 正则命中）
3. 无任何真实个人信息 / 企业名（全部脱敏）
4. 无 `{{占位符}}`（区别于文书模板）

## 重新生成

如需更新样本：
1. 准备 markdown → 用 pandoc / Word / Google Docs 导出为 .docx
2. 直接替换对应文件，Commit 时说明更新原因

## 测试使用

- `tests/server/contract/sampleFixtures.test.ts` 确保 5 份 .docx 存在且可被 mammoth 解析
- M2 `commentInjector` 会以这些样本跑"批注 ≥20 / 中文 / id 不冲突"单测
```

- [ ] **Step 7.4：写 fixture 测试（M1 冒烟 mammoth 可解 + 合并断言）**

`tests/server/contract/sampleFixtures.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'

const SAMPLE_DIR = join(__dirname, '../../../prisma/seeds/contract-samples')
const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const

describe('合同审查样本 fixture', () => {
    // M1 只做最小冒烟：mammoth 可解 + 段落 ≥ 5。
    // 甲/乙方正则命中率由 M2 partyDetector 单测覆盖，不在 M1 重复断言。
    it.each(SAMPLES)('%s.docx 可被 mammoth 解析且段落数 ≥ 5', async (name) => {
        const path = join(SAMPLE_DIR, `${name}.docx`)
        const buffer = await readFile(path)   // 读取失败会抛错，等效 access 断言
        const { value: rawText } = await mammoth.extractRawText({ buffer })
        const paragraphs = rawText.split(/\n+/).filter(p => p.trim().length > 0)
        expect(paragraphs.length).toBeGreaterThanOrEqual(5)
    })
})
```

- [ ] **Step 7.5：跑测试，确认通过**

```bash
npx vitest run tests/server/contract/sampleFixtures.test.ts --reporter=verbose
```

**Expected:** 5 个 case 全 PASS。若某份 .docx mammoth 不认或段落太少，回 Step 7.1 / 7.2 修样本。

- [ ] **Step 7.6：Commit**

```bash
git add prisma/seeds/contract-samples/ tests/server/contract/sampleFixtures.test.ts
git commit -m "$(cat <<'EOF'
test(contract): 新增 5 份占位样本合同 fixture

覆盖劳动/租赁/买卖/服务/借款五类；每份 ≥5 段、含明示"甲方"/"乙方"。
后续 M2 commentInjector / M5 E2E 以此目录为测试基础。
EOF
)"
```

---

## Task 8：`seedContractReviewMainNode` 函数骨架

**Files:**
- Modify: `prisma/seed.ts`（新增函数 + `main()` 追加 await）

**设计决策（spec §11 M1 备注）：** 节点 seed 为 `status=0`（禁用）+ `tools=['parseAndAskStance']`（预设引用）。M3 实现 `parseAndAskStance` 工具后 UPDATE `status=1`。本 task 先落函数 + 在 `main()` 里 await 调用，使本地与新环境 seed 都带这一行（禁用态不触发 workflow）。

- [ ] **Step 8.1：写失败测试**

`tests/prisma/seed-contract.test.ts`：

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { PrismaClient } from '~~/generated/prisma/client'

const prisma = new PrismaClient()

describe('seed: contractReviewMain 节点', () => {
    beforeAll(async () => {
        // 动态 import 避免静态 resolve 不到 seed 文件（seed.ts 是 runtime 调用）
        const seedModule = await import('~~/prisma/seed')
        // 期望 seed 入口已 export 这个函数
        expect(typeof (seedModule as any).seedContractReviewMainNode).toBe('function')
        await (seedModule as any).seedContractReviewMainNode(prisma)
        // 幂等：跑两次不报错
        await (seedModule as any).seedContractReviewMainNode(prisma)
    })

    it('nodes 表存在 name=contractReviewMain 的 agent 节点，且 status=0（M1 禁用）', async () => {
        const node = await prisma.nodes.findUnique({ where: { name: 'contractReviewMain' } })
        expect(node).not.toBeNull()
        expect(node?.type).toBe('agent')
        expect(node?.status).toBe(0)
        expect(node?.tools).toEqual(['parseAndAskStance'])
    })
})
```

- [ ] **Step 8.2：运行测试，确认失败**

```bash
npx vitest run tests/prisma/seed-contract.test.ts --reporter=verbose
```

**Expected:** 失败（函数未 export 或未实现）。

- [ ] **Step 8.3：实现 `seedContractReviewMainNode`**

在 `prisma/seed.ts` 里参照 `seedAssistantMainNode`（L36）的结构，在适当位置新增并 **export**（为单测可见）：

```typescript
/**
 * Seed: contractReviewMain 节点 + 提示词 v1
 *
 * M1 策略：
 * - 节点 status=0（禁用），tools 预设为 ['parseAndAskStance']
 * - M3 工具实现后将 status 改为 1 激活
 *
 * 模型优先复用 assistantMain（保持语言风格一致）；缺失时回退首个启用 model。
 * 幂等：upsert 节点，提示词 find-then-create（已存在则不覆盖）。
 */
export async function seedContractReviewMainNode(prismaClient: PrismaClient): Promise<void> {
    const assistantMain = await prismaClient.nodes.findUnique({ where: { name: 'assistantMain' } })
    let modelId = assistantMain?.modelId
    if (modelId == null) {
        const firstModel = await prismaClient.models.findFirst({ where: { status: 1 } })
        if (!firstModel) {
            throw new Error('[seed] 无可用 model，请先 seed models 表后再执行 contractReviewMain seed')
        }
        modelId = firstModel.id
    }

    const node = await prismaClient.nodes.upsert({
        where: { name: 'contractReviewMain' },
        update: {},
        create: {
            name: 'contractReviewMain',
            title: '合同审查主 Agent',
            description: '合同审查专用：解析合同、请求立场、按立场产出 risks + 批注 .docx',
            type: 'agent',
            priority: 40,
            modelId,
            tools: ['parseAndAskStance'],
            // M1 禁用；M3 实现 parseAndAskStance 工具后 UPDATE 为 1
            status: 0,
        },
    })

    const systemPromptContent = `你是 LexSeek 的合同审查助手。用户上传了一份合同，你按下面的流程审查：

# 任务流程
1. 调用 parseAndAskStance 工具：工具会解析合同、识别甲乙方、请求用户审查立场。该工具会 interrupt 暂停等待用户输入。
2. 工具返回后，你会得到（ToolMessage）：stance / stanceLabel / stanceFocus / partyA / partyB / contractType / paragraphs。
3. 按 stance / stanceFocus 逐段审查，按响应格式（response schema）输出 risks + summary。

# 审查要求
- 逐段审查所有对当前立场方不利 / 权利义务不对等 / 存在法律风险的条款
- 每处问题输出一条 Risk；high / medium 级别必须提供 suggestedClauseText（AI 重写后的完整条款）
- 使用专业法律术语，禁用感叹号；引用具体法条（《民法典》《劳动合同法》《合同法》等及条号）
- 宁可多标，不可漏标
- summary 以 Markdown 简要说明合同整体风险画像、主要问题集中领域、建议行动顺序

# 当前元信息
- reviewId：{{reviewId}}
- 合同类型（若已识别）：{{contractType}}

# 段落引用规则
- clauseIndex 从工具返回的 paragraphs 数组索引取值（0-based）
- clauseText 必须是 paragraphs 中对应段落的完整文本
- 禁止编造段落`

    const existing = await prismaClient.prompts.findFirst({
        where: { nodeId: node.id, type: 'system', version: 'v1', deletedAt: null },
    })
    if (!existing) {
        await prismaClient.prompts.create({
            data: {
                name: 'contractReview_system',
                title: '合同审查系统提示词 v1',
                content: systemPromptContent,
                variables: ['reviewId', 'contractType'],
                version: 'v1',
                type: 'system',
                status: 1,
                nodeId: node.id,
            },
        })
    }

    console.log('[seed] contractReviewMain 节点（M1 禁用态）+ 提示词 v1 完成')
}
```

**注意：** 把 `seedAssistantMainNode`（L36）改为 `export async function`（若它不是 export），避免整体破坏既有其他 seed。更稳妥方式：**只对新函数加 `export`**，其他函数保留 private。

- [ ] **Step 8.4：在 `main()` 追加 await 调用**

在 `prisma/seed.ts:492` 的 `main()` 函数里，在 `await seedDocumentTemplates(prisma)` 之后追加：

```typescript
    await seedContractReviewMainNode(prisma)
```

- [ ] **Step 8.5：跑测试，确认通过**

```bash
npx vitest run tests/prisma/seed-contract.test.ts --reporter=verbose -t "contractReviewMain"
```

**Expected:** PASS。幂等性（beforeAll 调用两次不崩）也通过。

- [ ] **Step 8.6：跑一次实际 seed 验证**

```bash
bun prisma db seed 2>&1 | tail -20
```

**Expected:** 输出含 `[seed] contractReviewMain 节点（M1 禁用态）+ 提示词 v1 完成`，无报错。

- [ ] **Step 8.7：Commit**

```bash
git add prisma/seed.ts tests/prisma/seed-contract.test.ts
git commit -m "$(cat <<'EOF'
feat(contract): 新增 seedContractReviewMainNode 骨架

M1 策略：节点 status=0 禁用，tools 预设 ['parseAndAskStance']；
M3 实现工具后 UPDATE status=1 激活。
提示词 v1 对齐 spec §6.7，变量 reviewId / contractType。
EOF
)"
```

---

## Task 9：`seedContractReviewTokenRule` 函数

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `prisma/seeds/seedData.sql`
- Modify: `tests/prisma/seed-contract.test.ts`

- [ ] **Step 9.1：为 token rule 追加测试（同一文件）**

在 `tests/prisma/seed-contract.test.ts` 里追加 describe：

```typescript
describe('seed: contract_review_token 积分规则', () => {
    beforeAll(async () => {
        const seedModule = await import('~~/prisma/seed')
        expect(typeof (seedModule as any).seedContractReviewTokenRule).toBe('function')
        await (seedModule as any).seedContractReviewTokenRule(prisma)
        await (seedModule as any).seedContractReviewTokenRule(prisma)  // 幂等
    })

    it('point_consumption_items 存在 key=contract_review_token 的行', async () => {
        const row = await prisma.pointConsumptionItems.findUnique({
            where: { key: 'contract_review_token' },
        })
        expect(row).not.toBeNull()
        expect(row?.group).toBe('agentToken')
        expect(row?.status).toBe(1)
    })
})
```

- [ ] **Step 9.2：运行测试确认失败**

```bash
npx vitest run tests/prisma/seed-contract.test.ts -t "contract_review_token" --reporter=verbose
```

**Expected:** 失败（函数未 export）。

- [ ] **Step 9.3：实现并 export**

在 `prisma/seed.ts`（seedAssistantTokenRule L193 之后合适位置）追加：

```typescript
/**
 * Seed: contract_review_token 积分扣减规则
 *
 * 单价与 discount 由运营后续调整，M1 先用参考行（优先 assistant_token，缺失回退默认值）。
 */
export async function seedContractReviewTokenRule(prismaClient: PrismaClient): Promise<void> {
    const reference = await prismaClient.pointConsumptionItems.findUnique({
        where: { key: 'assistant_token' },
    })
    const pointAmount = reference?.pointAmount ?? 1
    const discount = reference?.discount ?? 1
    const unit = reference?.unit ?? '千tokens'
    const group = reference?.group ?? 'agentToken'

    await prismaClient.pointConsumptionItems.upsert({
        where: { key: 'contract_review_token' },
        update: {},
        create: {
            key: 'contract_review_token',
            group,
            name: '合同审查 token 计费',
            description: '合同审查按模型 token 用量扣减积分',
            unit,
            pointAmount,
            discount,
            status: 1,
        },
    })
    console.log('[seed] contract_review_token 积分规则完成')
}
```

并在 `main()` 的 `await seedContractReviewMainNode(prisma)` 之后追加：

```typescript
    await seedContractReviewTokenRule(prisma)
```

- [ ] **Step 9.4：更新 `prisma/seeds/seedData.sql`**

检查现有 SQL 结构：

```bash
grep -n "pointConsumptionItems\|point_consumption_items\|assistant_token" prisma/seeds/seedData.sql | head -10
```

仿照既有 `assistant_token` 行的位置与格式，追加一行 INSERT（或按现有 SQL 的风格 upsert）：

```sql
-- contract_review_token（M1 新增；默认与 assistant_token 一致，运营后续调整）
INSERT INTO point_consumption_items (key, "group", name, description, unit, point_amount, discount, status)
VALUES ('contract_review_token', 'agentToken', '合同审查 token 计费', '合同审查按模型 token 用量扣减积分', '千tokens', 1, 1, 1)
ON CONFLICT (key) DO NOTHING;
```

（具体列名 / 冲突策略以文件既有格式为准。）

- [ ] **Step 9.5：跑测试确认通过**

```bash
npx vitest run tests/prisma/seed-contract.test.ts --reporter=verbose
```

**Expected:** 全绿（两个 describe 的 case 都过）。

- [ ] **Step 9.6：再跑一次真实 seed**

```bash
bun prisma db seed 2>&1 | tail -10
```

**Expected:** 含两条 `[seed] contract... 完成` 日志；无错。

- [ ] **Step 9.7：Commit**

```bash
git add prisma/seed.ts prisma/seeds/seedData.sql tests/prisma/seed-contract.test.ts
git commit -m "feat(contract): 新增 contract_review_token 积分规则 seed"
```

---

## Task 10：M1 全量验收

- [ ] **Step 10.1：跑本期相关测试**

```bash
npx vitest run \
  tests/shared/types/case.interruptType.test.ts \
  tests/shared/types/contract.test.ts \
  tests/server/workflow/middleware/middlewareNames.test.ts \
  tests/server/contract/sampleFixtures.test.ts \
  tests/prisma/seed-contract.test.ts \
  --reporter=verbose
```

**Expected:** 全绿，0 失败。

- [ ] **Step 10.2：跑全量测试确认无回归**

```bash
npx vitest run 2>&1 | tail -30
```

**Expected:** 失败数不超过 pre-M1 基线（新增失败 = 0）。若出现新失败，定位并修复后再 commit。

- [ ] **Step 10.3：类型检查**

```bash
npx nuxi typecheck 2>&1 | tail -30
```

**Expected:** 无新增类型错误（基线错误数不变）。

- [ ] **Step 10.4：冒烟验证 seed 幂等**

```bash
bun prisma db seed && bun prisma db seed
```

**Expected:** 两次运行都成功，无错误。

- [ ] **Step 10.5：若 Step 10.1-10.4 全部通过，M1 完成**

此时工作树应干净（`git status` 无 tracked 修改）。M1 完成后可进入 M2（docx 子模块）。

---

## 依赖 / 风险 / 开放问题

| 项 | 说明 |
|---|---|
| 依赖 | Postgres docker 容器运行中；`bun prisma:migrate dev` 会连本地数据库 |
| 风险：样本 .docx 来源 | 工程在外部工具生成，禁止使用任何真实客户合同；已在 README 明示 |
| 风险：seed 节点禁用 | M3 启动前 `contractReviewMain` 节点 status=0，任何尝试启动该 agent 都应该被 `getValidNodeConfig` 过滤；若 M3 发现未被过滤，需在 M3 先做修正再激活 |
| 开放问题 O1（spec §14） | `contract_review_token` 单价运营未定；M1 默认 1，M3 启动前运营确认或保持默认 |
| 文件 user model 改动范围 | 只加一行反向关联，避免误改既有字段 |
| `prisma/seed.ts` export 范围 | 只对 `seedContractReviewMainNode` / `seedContractReviewTokenRule` 加 `export`，其余函数保留 private |

---

## Commit 约定

本 plan 全部 commit 使用 scope `contract`（Task 2 先落地规范）。提交信息用 conventional commit + 中文描述；必要时 HEREDOC body。**严禁** `--amend` / `--no-verify` / `push --force`（按 CLAUDE.md 安全协议）。
