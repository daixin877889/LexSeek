# 合同审查 M1 实施 Plan（终稿）

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **对应 Spec**: [`2026-04-17-contract-review-design.md`](../specs/2026-04-17-contract-review-design.md) §11 "M1 数据层 + 依赖 + 样本" 里程碑
>
> **边界**: M1 只交付"会被 M2~M5 直接消费的地基"，不提前实现 agent / API / UI / middleware 逻辑。本 plan 对 spec 的覆盖范围以 spec §11 的 M1 行为准。

---

## 0. 执行原则（本轮迭代强制约束）

1. **复用现有基建，不重复造轮子**
   - `mammoth` / `jszip` / `docx-preview` / `docxtemplater` / `markdown-docx` / `html-docx-js-typescript` 均已安装，不重复操作
   - seed 写法严格复用 `seedAssistantMainNode` / `seedDocumentMainNode` / `seedDocumentDraftTokenRule` 模板
2. **不做当前里程碑没有消费方的提前设计**
   - `reviewResultPersistence.middleware.ts` 文件本身由 M3 创建；M1 只落"常量 `REVIEW_RESULT_PERSISTENCE`"，不在 `middleware/index.ts` 追加 export（文件不存在会导致 index.ts 编译失败）
   - agent / API / worker / UI 全部不在本 plan 范围
3. **路径、命令、测试方式、数据模型写法必须与当前仓库一致**
   - 测试目录：`tests/server/assistant/contract/` 对齐既有 `tests/server/assistant/document/`
   - 测试命令：`npx vitest run`（**禁止 `bun test`**，Nuxt 自动导入仅在 vitest 环境下可解析）
   - 迁移命令：`bun run prisma:migrate` → 实际是 `prisma migrate dev`（见 `package.json:15`）
   - seed 命令：`bunx prisma db seed`（项目默认 prisma-seed 入口）
4. **不偏离原始主线**
   - M1 只交付：依赖 / 数据表 / 共享类型 / 中断枚举 / MIDDLEWARE 常量 / 5 份样本 / 两个 seed 函数 / git.md scope
   - 验收标准来源 spec §11：`bun run prisma:migrate dev` + `bunx prisma db seed` 跑完；样本可被 mammoth 解析

---

## 1. 目标与非目标

### 1.1 Goal（与 spec §11 M1 一一对应）

完成以下 8 项，解锁 M2/M3:

1. 安装 `fast-xml-parser` + `diff-match-patch`；`docx-preview` 已装（0.3.7），跳过
2. `contract_reviews` 数据表（**不含 `caseId` 列**，`sessionId` UNIQUE）
3. `InterruptType.AWAITING_STANCE = 'awaiting_stance'` 枚举扩展
4. 新建 `shared/types/contract.ts`（业务枚举 + Risk + API 请求响应）
5. `MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE = 'reviewResultPersistence'` 常量
6. `seedContractReviewMainNode` + `seedContractReviewTokenRule` 两个 seed 函数 + `seedData.sql` 同步
7. 5 份样本 .docx 入 `prisma/seeds/contract-samples/`（spec §11 指定路径）
8. `.claude/rules/git.md` scope 列表新增 `contract`

### 1.2 本期明确不做

- `reviewResultPersistence.middleware.ts` 文件本身（M3 创建）
- `server/services/workflow/middleware/index.ts` 追加 export（等文件创建后随 M3 同步追加；M1 提前追加会导致 `import ... from './reviewResultPersistence.middleware'` 空模块错误）
- `contractReviewMain` agent 实现 / `parseAndAskStance` 工具 / `runContractReviewChat`
- 任何 API 路由 / UI 组件 / worker 分发分支
- `contractReviews.caseId` 列与 `idx_contract_reviews_case` 索引（spec §1.2 明确 M6+ 再补）

---

## 2. 当前仓库基线（已核对）

实施前先固化以下事实，防止写入过期假设：

| 条目 | 现状 |
|---|---|
| Prisma 版本 | **7.7.0**（`@prisma/client`），不是 6.x |
| `docx-preview` | 已装 `^0.3.7` |
| `mammoth` | 已装 `^1.11.0` |
| `jszip` | 已装 `^3.10.1` |
| `docxtemplater` | 已装 `^3.68.5` |
| `markdown-docx` | 已装 `^1.5.1` |
| `html-docx-js-typescript` | 已装 `^0.1.5` |
| `fast-xml-parser` | **未装** |
| `diff-match-patch` | **未装** |
| `InterruptType` 枚举位置 | `shared/types/case.ts:162`，现有 4 值 |
| `MIDDLEWARE_NAMES` 位置 | `server/services/workflow/middleware/types.ts:51`，现有 9 键 |
| `middleware/index.ts` 现有 export | 7 个 middleware 文件（不含 reviewResultPersistence） |
| `prisma/seed.ts` | 680 行；`main()` **在 L673 顶层直接执行**，import 会跑整遍 seed |
| 样本测试目录惯例 | `tests/fixtures/document-templates/` 有先例；但 spec §11 对合同样本明确要求 `prisma/seeds/contract-samples/` |
| 测试目录惯例 | 合同测试放 `tests/server/assistant/contract/`，对齐 `tests/server/assistant/document/` |
| `seedData.sql` 备份写法 | 用 `ON CONFLICT (key) DO NOTHING`（第 882 行 `document_draft_token`） |
| `.claude/rules/git.md` scope 列表 | 当前含 `ui / api / auth / db / theme / purchase / cases / tools / membership / payment / storage / oss / encryption / rbac / invitation / analysis`；**不含 `contract`** |

---

## 3. 文件变更清单

### 3.1 新建

- `prisma/models/contractReview.prisma`
- `shared/types/contract.ts`
- `prisma/seeds/contract-samples/README.md`
- `prisma/seeds/contract-samples/labor.docx`
- `prisma/seeds/contract-samples/lease.docx`
- `prisma/seeds/contract-samples/sale.docx`
- `prisma/seeds/contract-samples/service.docx`
- `prisma/seeds/contract-samples/loan.docx`
- `tests/shared/types/case.interruptType.test.ts`
- `tests/shared/types/contract.test.ts`
- `tests/server/workflow/middleware/types.reviewResultPersistence.test.ts`
- `tests/server/assistant/contract/sampleFixtures.test.ts`
- `tests/server/assistant/contract/contractReview.seed.test.ts`
- `prisma/migrations/<timestamp>_add_contract_reviews/migration.sql`（由 `prisma migrate dev` 生成）

### 3.2 修改

- `package.json`、`bun.lock`
- `shared/types/case.ts`（扩 `InterruptType.AWAITING_STANCE`）
- `server/services/workflow/middleware/types.ts`（扩 `MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE`）
- `prisma/models/user.prisma`（补 `contractReviews` 反向关系）
- `prisma/seed.ts`（新增两个函数 + `main()` 调用 + 加 CLI 入口守卫）
- `prisma/seeds/seedData.sql`（新增 `contract_review_token` 备份行）
- `docs/tech-docs/architecture/data-model.md`（同步新表）
- `.claude/rules/git.md`（scope 列表新增 `contract`）

---

## 4. Task 1：`.claude/rules/git.md` scope 新增 `contract`

**Files:** `.claude/rules/git.md`

### Why

- spec §11 M1 验收清单明确要求"向 `.claude/rules/git.md` scope 列表新增 `contract` 条目（本 spec 全部 commit 统一使用此 scope）"
- **必须最先做**：后续 Task 2-8 的提交全部使用 `(contract)` scope，若 git.md 未声明则违反项目提交规范 `.claude/rules/git.md`

### Steps

- [ ] **Step 1.1：更新 git.md scope 列表**

在 [.claude/rules/git.md:43](/Users/daixin/work/dev/LexSeek/LexSeek/.claude/rules/git.md:43) `analysis` 行之后追加：

```markdown
- `contract` - 合同审查
```

- [ ] **Step 1.2：提交**

```bash
git add .claude/rules/git.md
git commit -m "docs(contract): git.md scope 列表新增 contract"
```

---

## 5. Task 2：安装 M1 依赖

**Files:** `package.json` / `bun.lock`

### Why

- `fast-xml-parser`：M2 `commentInjector` 读写 `word/document.xml` 需要 XML 级节点操作
- `diff-match-patch`：M5 条款级 diff UI 需要。spec §11 M1 明确要求两个一起装（避免 M5 临时补装打乱节奏）
- `docx-preview` 已装，不重复操作

### Steps

- [ ] **Step 2.1：确认依赖基线**

```bash
grep -E '"(docx-preview|mammoth|jszip|fast-xml-parser|diff-match-patch)"' package.json
```

**Expected：** 输出含 `docx-preview` / `mammoth` / `jszip` 三行；不含 `fast-xml-parser` / `diff-match-patch`

- [ ] **Step 2.2：安装两个新依赖**

```bash
bun add fast-xml-parser diff-match-patch
bun add -D @types/diff-match-patch
```

> `fast-xml-parser` 自带 TypeScript 类型；`diff-match-patch` 是 JS 库需要单独装 `@types/diff-match-patch`。

- [ ] **Step 2.3：冒烟验证**

```bash
bun -e "import('fast-xml-parser').then(m => console.log(typeof m.XMLParser))"
bun -e "import('diff-match-patch').then(m => console.log(typeof m.diff_match_patch))"
```

**Expected：** 两行均输出 `function`

- [ ] **Step 2.4：提交**

```bash
git add package.json bun.lock
git commit -m "chore(contract): 安装合同审查 M1 所需 XML 与 diff 依赖"
```

---

## 6. Task 3：共享类型扩展（TDD）

**Files:**
- Modify: `shared/types/case.ts`
- Create: `shared/types/contract.ts`
- Create: `tests/shared/types/case.interruptType.test.ts`
- Create: `tests/shared/types/contract.test.ts`

### 6.1 `InterruptType.AWAITING_STANCE`

- [ ] **Step 3.1：先写回归测试**

`tests/shared/types/case.interruptType.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { InterruptType } from '#shared/types/case'

describe('InterruptType enum', () => {
    it('保留既有四个中断类型', () => {
        expect(InterruptType.CASE_INFO_CHECK).toBe('case_info_check')
        expect(InterruptType.BASIC_INFO_CONFIRM).toBe('basic_info_confirm')
        expect(InterruptType.MODULE_SELECT).toBe('module_select')
        expect(InterruptType.INSUFFICIENT_POINTS).toBe('insufficient_points')
    })

    it('新增 awaiting_stance（合同审查立场选择）', () => {
        expect(InterruptType.AWAITING_STANCE).toBe('awaiting_stance')
    })
})
```

- [ ] **Step 3.2：补实现**

在 [shared/types/case.ts:162](/Users/daixin/work/dev/LexSeek/LexSeek/shared/types/case.ts:162) 的 `InterruptType` 枚举末尾追加：

```typescript
    /** 中断点5：合同审查立场选择 */
    AWAITING_STANCE = 'awaiting_stance',
```

### 6.2 `shared/types/contract.ts`

**约束**（对齐 `.claude/rules/types.md` + spec §5.2）：

- 只放业务枚举、值对象、API 请求响应接口
- **不镜像 Prisma row 类型**（从 `#shared/types/prisma` 直接导入）
- 风格对齐既有 `shared/types/document.ts` 与 `shared/types/case.ts`

- [ ] **Step 3.3：先写类型失败测试**

`tests/shared/types/contract.test.ts`

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

describe('shared/types/contract', () => {
    it('导出基础联合类型', () => {
        expectTypeOf<RiskLevel>().toEqualTypeOf<'high' | 'medium' | 'low'>()
        expectTypeOf<Stance>().toEqualTypeOf<'partyA' | 'partyB' | 'neutral'>()
        expectTypeOf<ContractReviewStatus>().toEqualTypeOf<
            'pending' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'
        >()
    })

    it('Risk 形状正确', () => {
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

    it('API 请求响应类型可用', () => {
        const req: CreateReviewRequest = { sourceType: 'paste', text: '合同文本' }
        const resp: CreateReviewResponse = { reviewId: 1, sessionId: 's-1' }
        const stance: StanceRequest = { stance: 'partyA', partyA: '甲方', partyB: '乙方' }
        const patch: PatchReviewRequest = { risks: [] }
        const rebuild: RebuildDocxResponse = { reviewedFileId: 1, downloadUrl: 'https://x' }
        const download: DownloadResponse = { downloadUrl: 'https://y' }

        expectTypeOf(req).toMatchTypeOf<CreateReviewRequest>()
        expectTypeOf(resp).toMatchTypeOf<CreateReviewResponse>()
        expectTypeOf(stance).toMatchTypeOf<StanceRequest>()
        expectTypeOf(patch).toMatchTypeOf<PatchReviewRequest>()
        expectTypeOf(rebuild).toMatchTypeOf<RebuildDocxResponse>()
        expectTypeOf(download).toMatchTypeOf<DownloadResponse>()
    })
})
```

- [ ] **Step 3.4：补实现**

`shared/types/contract.ts`

```typescript
/**
 * 合同审查业务类型
 *
 * 约定：Prisma row 类型从 #shared/types/prisma 直接导入，不在此文件镜像。
 */

export type RiskLevel = 'high' | 'medium' | 'low'
export type Stance = 'partyA' | 'partyB' | 'neutral'
export type ContractReviewStatus =
    | 'pending'
    | 'reviewing'
    | 'awaiting_stance'
    | 'completed'
    | 'failed'

/** 单条风险（存 contractReviews.risks JSON 字段；schema 层 refine 强制 high/medium 必含 suggestedClauseText） */
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
    suggestedClauseText?: string
}

export interface CreateReviewRequest {
    sourceType: 'upload' | 'paste'
    ossFileId?: number
    text?: string
}

export interface CreateReviewResponse {
    reviewId: number
    sessionId: string
}

export interface StanceRequest {
    stance: Stance
    partyA?: string
    partyB?: string
}

export interface PatchReviewRequest {
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

- [ ] **Step 3.5：验证**

```bash
npx vitest run tests/shared/types/case.interruptType.test.ts tests/shared/types/contract.test.ts --reporter=verbose
npx nuxi typecheck
```

**Expected：** 两个测试全绿；typecheck 0 error

- [ ] **Step 3.6：提交**

```bash
git add shared/types/case.ts shared/types/contract.ts tests/shared/types/
git commit -m "feat(contract): 新增合同审查共享类型与立场中断枚举"
```

---

## 7. Task 4：`MIDDLEWARE_NAMES` 常量扩展（TDD）

**Files:**
- Modify: `server/services/workflow/middleware/types.ts`
- Create: `tests/server/workflow/middleware/types.reviewResultPersistence.test.ts`

### Why

- spec §5.3 要求 M1 先落常量，M3 创建 `reviewResultPersistence.middleware.ts` 时引用
- `middleware/index.ts` 的 `export * from './reviewResultPersistence.middleware'` **不在 M1 追加**——文件不存在会导致整条 middleware barrel 链编译失败

- [ ] **Step 4.1：先写常量测试**

`tests/server/workflow/middleware/types.reviewResultPersistence.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
    MIDDLEWARE_NAMES,
    MIDDLEWARE_PRIORITY,
} from '~~/server/services/workflow/middleware/types'

describe('MIDDLEWARE_NAMES 扩展', () => {
    it('保留既有 9 个中间件名常量', () => {
        expect(MIDDLEWARE_NAMES.PROCESS_MATERIAL).toBe('caseProcessMaterial')
        expect(MIDDLEWARE_NAMES.POINT_CONSUMPTION).toBe('pointConsumption')
        expect(MIDDLEWARE_NAMES.MATERIAL_CONTEXT).toBe('caseMaterialContext')
        expect(MIDDLEWARE_NAMES.MODULE_CONTEXT).toBe('moduleContext')
        expect(MIDDLEWARE_NAMES.SUMMARIZATION).toBe('summarization')
        expect(MIDDLEWARE_NAMES.SAFETY_TRIM).toBe('safetyTrim')
        expect(MIDDLEWARE_NAMES.SKILLS_DISCOVERY).toBe('skillsDiscovery')
        expect(MIDDLEWARE_NAMES.TODO_LIST).toBe('todoList')
        expect(MIDDLEWARE_NAMES.RESULT_PERSISTENCE).toBe('analysisResultPersistence')
    })

    it('新增 REVIEW_RESULT_PERSISTENCE 常量', () => {
        expect(MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE).toBe('reviewResultPersistence')
    })

    it('REVIEW_RESULT_PERSISTENCE 与 RESULT_PERSISTENCE 共用末位优先级', () => {
        // MVP 策略：两者同 priority=90，实际运行时只挂一个
        expect(MIDDLEWARE_PRIORITY.RESULT_PERSISTENCE).toBe(90)
    })
})
```

- [ ] **Step 4.2：补实现**

在 [server/services/workflow/middleware/types.ts:60](/Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/middleware/types.ts:60) 的 `MIDDLEWARE_NAMES` 字典内追加：

```typescript
    /** 合同审查结果持久化（与 RESULT_PERSISTENCE 语义对等，独立 agent 使用） */
    REVIEW_RESULT_PERSISTENCE: 'reviewResultPersistence',
```

**不改**：既有 `RESULT_PERSISTENCE = 'analysisResultPersistence'` 常量保留，caseMain 代码零侵入。`MIDDLEWARE_PRIORITY` 字典不动（已有 `RESULT_PERSISTENCE: 90`，合同审查 M3 时直接复用该优先级）。

- [ ] **Step 4.3：验证**

```bash
npx vitest run tests/server/workflow/middleware/types.reviewResultPersistence.test.ts --reporter=verbose
npx nuxi typecheck
```

- [ ] **Step 4.4：提交**

```bash
git add server/services/workflow/middleware/types.ts tests/server/workflow/middleware/
git commit -m "feat(contract): 新增 MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE 常量"
```

---

## 8. Task 5：`contract_reviews` 数据表

**Files:**
- Create: `prisma/models/contractReview.prisma`
- Modify: `prisma/models/user.prisma`
- Modify: `docs/tech-docs/architecture/data-model.md`
- Create: `prisma/migrations/<timestamp>_add_contract_reviews/migration.sql`（自动生成）

### 8.1 模型定义（对齐 spec §5.1）

- [ ] **Step 5.1：新建 Prisma model**

`prisma/models/contractReview.prisma`

```prisma
/// 合同审查记录表
/// MVP 不含 caseId 列（案件页复用 M6+ 再通过 ALTER TABLE 补齐）
model contractReviews {
    id             Int       @id @default(autoincrement())
    /// 发起审查的用户 id
    userId         Int       @map("user_id")
    /// LangGraph thread_id；重审 = 新建 review = 新 sessionId（1:1 映射）
    sessionId      String    @map("session_id") @db.VarChar(100)
    /// 原始合同 OSS 文件 id
    originalFileId Int       @map("original_file_id")
    /// 批注回写后的 .docx OSS 文件 id（reviewResultPersistence.afterAgent 写入）
    reviewedFileId Int?      @map("reviewed_file_id")
    /// 合同类型（AI 识别；劳动 / 租赁 / 买卖 / 服务 / 借款 等）
    contractType   String?   @db.VarChar(50)
    /// 甲方名称（AI 识别，用户可在立场 Dialog 中修正）
    partyA         String?   @db.VarChar(200)
    /// 乙方名称
    partyB         String?   @db.VarChar(200)
    /// 用户选定的审查立场：partyA / partyB / neutral
    stance         String?   @db.VarChar(20)
    /// 状态机：pending -> reviewing -> awaiting_stance -> reviewing -> completed | failed
    status         String    @default("pending") @db.VarChar(30)
    /// 结构化风险清单（Risk[] JSON）
    risks          Json?     @db.JsonB
    /// 审查摘要 Markdown
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

- [ ] **Step 5.2：补 `users` 反向关系**

在 [prisma/models/user.prisma:87](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/models/user.prisma:87) `documentDrafts` 行之后追加：

```prisma
    /// 用户合同审查记录（一对多）
    contractReviews contractReviews[]
```

### 8.2 迁移与文档同步

- [ ] **Step 5.3：确认 migrate 命令存在**

```bash
grep '"prisma:migrate"' package.json
```

**Expected：** `"prisma:migrate": "prisma migrate dev"`（确认已有，不需手写命令）

- [ ] **Step 5.4：生成 Prisma client + migration**

```bash
bun run prisma:generate
bun run prisma:migrate -- --name add_contract_reviews
```

> **参数传递**：`bun run prisma:migrate` 背后是 `prisma migrate dev`，`--name` 需要 `--` 分隔符把参数透传给 prisma（否则 bun 会把 `--name` 当 npm script 自己的 flag）。

**Expected：**

- 新建 `prisma/migrations/<timestamp>_add_contract_reviews/migration.sql`
- 包含 `CREATE TABLE contract_reviews`，**不含 `case_id` 列**
- 包含 `CREATE UNIQUE INDEX idx_contract_reviews_session ON contract_reviews(session_id)`
- 包含 `idx_contract_reviews_user` / `idx_contract_reviews_status` 两个普通索引
- **不含** `idx_contract_reviews_case`

- [ ] **Step 5.5：同步测试数据库 schema**

测试走独立测试库 `ls_new_testing`，迁移完开发库后必须同步测试库（经验沿用 MEMORY.md "2026-04-01 修复全量测试失败问题"）：

```bash
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing' bun run prisma:push --accept-data-loss
```

- [ ] **Step 5.6：同步技术文档**

更新 [docs/tech-docs/architecture/data-model.md](/Users/daixin/work/dev/LexSeek/LexSeek/docs/tech-docs/architecture/data-model.md:1)：

- 模型文件列表补 `contractReview.prisma`
- 核心关系补 `users -> contractReviews`（1:N）
- 简述 `sessionId` UNIQUE 约束对应"合同审查会话 1:1 映射"

- [ ] **Step 5.7：验证**

```bash
npx nuxi typecheck
```

**Expected：** Prisma Client 类型已含 `contractReviews` 表；0 error

- [ ] **Step 5.8：提交**

```bash
git add prisma/models/contractReview.prisma prisma/models/user.prisma prisma/migrations docs/tech-docs/architecture/data-model.md
git commit -m "feat(contract): 新增 contract_reviews 数据表"
```

---

## 9. Task 6：样本 `.docx` fixture

**Files:**
- Create: `prisma/seeds/contract-samples/{labor,lease,sale,service,loan}.docx`
- Create: `prisma/seeds/contract-samples/README.md`
- Create: `tests/server/assistant/contract/sampleFixtures.test.ts`

### 9.1 为什么放 `prisma/seeds/contract-samples/`

- spec §11 M1 与 §1.2 明确指定该路径（非 `tests/fixtures/`），因为 M6+ 案件页复用时可能会引入"系统预置合同样本展示"需求，届时 samples 需要走 seed 流程上传 OSS
- M1 只作为 M2~M5 测试 fixture 使用，不写进 `seed.ts` 主逻辑
- `prisma/seeds/document-templates/` 已有同类先例（既作 seed 物料又作 fixture）

### 9.2 样本要求

合同类型 5 个固定档：`labor` / `lease` / `sale` / `service` / `loan`

每份样本规范：

- 300-800 字
- **明示 `甲方：...` / `乙方：...`**（partyDetector 正则路径依赖）
- 含 5-8 个可疑条款（付款期 / 违约金 / 管辖 / 保密 / 交付 / ...）
- 全部虚构脱敏，无真实客户信息
- 不含 `{{占位符}}`（避免与文书模板 fixture 混淆）

### 9.3 Steps

- [ ] **Step 6.1：准备 5 份脱敏样本文本**

按上述规范编写纯文本内容，每段落之间空行分隔。

- [ ] **Step 6.2：用仓库既有方案生成 .docx**

仓库唯一既有 .docx 生成范式见 [app/components/caseDetail/CaseExportDialog.vue:104](/Users/daixin/work/dev/LexSeek/LexSeek/app/components/caseDetail/CaseExportDialog.vue:104)：

- **主路径（首选）**：`markdown-docx ^1.5.1`，适合从 markdown 文本直转 .docx
- **备路径**：`html-docx-js-typescript ^0.1.5`，仅在 markdown 模板无法表达某些格式时使用

> **不用** `docxtemplater`：那是模板占位填充库，本场景是生成纯文本 + 甲乙方段落的样本，不匹配。

**生成方式**：写一次性脚本 `scripts/generate-contract-samples.ts`，运行后**删除脚本**（生成的 5 份 `.docx` 入 git 作稳定 fixture）。严禁依赖 Word / Google Docs / pandoc 等本地工具。

- [ ] **Step 6.3：写 README**

`prisma/seeds/contract-samples/README.md`

```markdown
# 合同审查样本 .docx

本目录存放合同审查 M2~M5 的测试样本。M1 仅作为 fixture，不进 `seed.ts` 生产逻辑。

| 文件 | 合同类型 |
|---|---|
| labor.docx | 劳动合同 |
| lease.docx | 房屋租赁合同 |
| sale.docx | 买卖合同 |
| service.docx | 服务合同 |
| loan.docx | 借款合同 |

## 约束

1. 全部为脱敏虚构样本，无真实客户信息
2. 明示 `甲方：...` / `乙方：...`（partyDetector 正则路径依赖）
3. 无 `{{占位符}}`
4. 供 M1 冒烟 + M2 docx 子模块单测 + M3 agent 集成测试 + M5 E2E 复用
```

- [ ] **Step 6.4：写冒烟测试**

`tests/server/assistant/contract/sampleFixtures.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'

const SAMPLE_DIR = join(__dirname, '../../../../prisma/seeds/contract-samples')
const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const

describe('合同审查样本 fixture', () => {
    it.each(SAMPLES)('%s.docx 可 mammoth 解析 + 含甲乙方标识', async (name) => {
        const path = join(SAMPLE_DIR, `${name}.docx`)
        const buffer = await readFile(path)
        const { value: rawText } = await mammoth.extractRawText({ buffer })

        // M1 冒烟：能解析出非空文本即可；段落数详细校验推到 M2 docx parser 单测
        expect(rawText.length).toBeGreaterThan(0)
        expect(rawText).toMatch(/甲方[：:]/)
        expect(rawText).toMatch(/乙方[：:]/)
    })
})
```

- [ ] **Step 6.5：验证**

```bash
npx vitest run tests/server/assistant/contract/sampleFixtures.test.ts --reporter=verbose
```

**Expected：** 5 个 case（5 份样本，每个一条合并断言）全部通过

- [ ] **Step 6.6：提交**

```bash
git add prisma/seeds/contract-samples tests/server/assistant/contract/sampleFixtures.test.ts
git commit -m "test(contract): 新增合同审查 5 份样本 .docx fixture"
```

---

## 10. Task 7：seed 扩展（`contractReviewMain` 节点 + `contract_review_token` 积分规则）

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `prisma/seeds/seedData.sql`
- Create: `tests/server/assistant/contract/contractReview.seed.test.ts`

### 10.1 关键实现约束

spec §11 M1 明确要求"`seedContractReviewMainNode` / `seedContractReviewTokenRule` 写 seed"。实施有三个合规点：

**1. 让 `prisma/seed.ts` 可安全 import**

当前 [prisma/seed.ts:673](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/seed.ts:673) 顶层直接执行 `main()`。测试 `import` seed 模块取 helper 函数时会跑完整 seed，污染测试库。

改动策略（只动入口，不重构整个 seed 架构）：

```typescript
import type { PrismaClient } from '~~/generated/prisma/client'

// 文件末尾改为：
async function main(): Promise<void> {
    await seedAssistantMainNode(prisma)
    await seedAssistantTitleGenNode(prisma)
    await seedAssistantTokenRule(prisma)
    await seedAssistantRouters(prisma)
    await seedDocumentTemplates(prisma)
    await seedDocumentMainNode(prisma)
    await seedDocumentDraftTokenRule(prisma)
    await seedContractReviewMainNode(prisma)     // 新增
    await seedContractReviewTokenRule(prisma)    // 新增
}

// CLI 入口守卫：只在"直接执行本文件"时跑 main()
// 模式来源：仓库既有 `scripts/importDocumentTemplates.ts:301`；Prisma 7 用 tsx 跑 seed，此表达式在 tsx / bun / node 下均可正确判断
if (import.meta.url === `file://${process.argv[1]}`) {
    main()
        .catch((err) => {
            console.error('[seed] 执行失败：', err)
            process.exitCode = 1
        })
        .finally(async () => {
            await prisma.$disconnect()
        })
}

export {
    seedContractReviewMainNode,
    seedContractReviewTokenRule,
}
```

> **不用 `import.meta.main`**：该属性是 Bun 专有；Prisma 7 未在 `package.json` 配置 `prisma.seed`，`bunx prisma db seed` 通过 **tsx** 执行 `prisma/seed.ts`，tsx 下 `import.meta.main` 为 `undefined`，守卫永远为 false → seed 静默不跑。仓库已有先例 `scripts/importDocumentTemplates.ts:301` 用 `import.meta.url === \`file://${process.argv[1]}\``，直接对齐。

**2. `seedContractReviewMainNode` 模型选择**

严格仿 [seedDocumentMainNode](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/seed.ts:234)：

- 优先复用 `caseMain.modelId`
- 若 `caseMain` 模型是 reasoner（如 DeepSeek-R1），回退首个非 reasoner chat 模型
- 原因：LangChain `responseFormat` 依赖 `tool_choice`，reasoner 不支持

**3. `seedContractReviewTokenRule` 复用既有字段**

严格仿 [seedDocumentDraftTokenRule](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/seed.ts:364)：

- 优先参考 `assistant_token`（字段：`group='agentToken'` / `unit='千tokens'` / `pointAmount=1` / `discount='1.00'`）
- 次选 `case_analysis_token`
- 都不存在时使用默认值

### 10.2 Steps

- [ ] **Step 7.1：先写 seed helper 测试**

`tests/server/assistant/contract/contractReview.seed.test.ts`

> **跨目录复用说明**：本测试 import `tests/server/case/test-setup` + `test-db-helper`，这是本轮首次让 `tests/server/assistant/` 下的测试复用 `case/` 的测试库 helper。两者都写测试库 `ls_new_testing`，helper 语义与本测试需求一致（独立测试库 + `getTestPrisma` + `disconnectTestDb`），无需重复造轮子。document M1 测试未复用该 helper 因为文书模板测试走 fixture 文件而非 DB。M3 / 后续里程碑测试可沿用同样 import 路径。

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import '../../case/test-setup'
import { disconnectTestDb, getTestPrisma } from '../../case/test-db-helper'

describe('合同审查 seed 函数', () => {
    const prisma = getTestPrisma()
    let seedContractReviewMainNode: (p: typeof prisma) => Promise<void>
    let seedContractReviewTokenRule: (p: typeof prisma) => Promise<void>

    beforeAll(async () => {
        const seedModule = await import('~~/prisma/seed')
        seedContractReviewMainNode = seedModule.seedContractReviewMainNode
        seedContractReviewTokenRule = seedModule.seedContractReviewTokenRule
        expect(typeof seedContractReviewMainNode).toBe('function')
        expect(typeof seedContractReviewTokenRule).toBe('function')
    })

    afterAll(async () => {
        await prisma.prompts.deleteMany({
            where: { name: 'contractReview_system' },
        })
        await prisma.nodes.deleteMany({
            where: { name: 'contractReviewMain' },
        })
        await prisma.pointConsumptionItems.deleteMany({
            where: { key: 'contract_review_token' },
        })
        await disconnectTestDb()
    })

    it('seedContractReviewMainNode 幂等写入节点与提示词', async () => {
        await seedContractReviewMainNode(prisma as any)
        await seedContractReviewMainNode(prisma as any)

        const node = await prisma.nodes.findUnique({ where: { name: 'contractReviewMain' } })
        expect(node).not.toBeNull()
        expect(node?.type).toBe('agent')
        expect(node?.priority).toBe(40)
        expect(node?.tools).toEqual(['parseAndAskStance'])
        expect(node?.status).toBe(1)
        expect(node?.modelId).not.toBeNull()

        const prompts = await prisma.prompts.findMany({
            where: { nodeId: node!.id, type: 'system', version: 'v1', deletedAt: null },
        })
        expect(prompts).toHaveLength(1)
        expect(prompts[0].name).toBe('contractReview_system')
    })

    it('seedContractReviewTokenRule 幂等写入积分规则', async () => {
        await seedContractReviewTokenRule(prisma as any)
        await seedContractReviewTokenRule(prisma as any)

        const row = await prisma.pointConsumptionItems.findUnique({
            where: { key: 'contract_review_token' },
        })
        expect(row).not.toBeNull()
        expect(row?.group).toBe('agentToken')
        expect(row?.unit).toBe('千tokens')
        expect(row?.status).toBe(1)
    })
})
```

- [ ] **Step 7.2：改 `main()` 入口，使 seed.ts 可安全 import**

按 §10.1 "1. 让 `prisma/seed.ts` 可安全 import" 修改文件末尾。保留 `await seedAssistantMainNode(prisma) ...` 等既有顺序不变。

- [ ] **Step 7.3：新增 `seedContractReviewMainNode`**

插入位置：`seedDocumentMainNode` 函数之后、`seedDocumentDraftTokenRule` 之前。

核心结构（具体实现参照 `seedDocumentMainNode` L234-L355 复制骨架后按下表改写）：

| 字段 | 值 |
|---|---|
| 节点 name | `contractReviewMain` |
| 节点 title | `合同审查主Agent` |
| 节点 description | `按 responseFormat 输出结构化风险清单，并通过 parseAndAskStance 工具中断请求用户立场` |
| 节点 type | `agent` |
| 节点 priority | `40`（在 documentMain=30 之后） |
| 节点 tools | `['parseAndAskStance']` |
| 节点 status | `1` |
| 节点 modelId | 优先 `caseMain.modelId`；若 reasoner 则回退首个非 reasoner chat 模型 |
| 提示词 name | `contractReview_system` |
| 提示词 title | `合同审查系统提示词 v1` |
| 提示词 content | 来自 spec §6.7 的 v1 完整内容（含 `{{reviewId}}` / `{{contractType}}` 变量） |
| 提示词 variables | `[]`（spec §6.7 注：首轮未定义变量由 renderContent 保留字面值） |
| 提示词 version | `v1` |
| 提示词 type | `system` |
| 提示词 status | `1` |

**提示词 content**（从 spec §6.7 完整复制，存在 spec 内，此处不再重复；实施时**严禁改写**）：

- [ ] **Step 7.4：新增 `seedContractReviewTokenRule`**

插入位置：`seedDocumentDraftTokenRule` 之后、`main()` 之前。

结构严格复制 [prisma/seed.ts:364-391](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/seed.ts:364) `seedDocumentDraftTokenRule` 骨架（扁平读变量 + 扁平列 upsert 字段，不用 spread，避免 Prisma Decimal 隐式推断差异）：

```typescript
async function seedContractReviewTokenRule(prismaClient: PrismaClient): Promise<void> {
    // 优先参考 assistant_token，其次 case_analysis_token，都不存在时使用默认值
    const reference =
        (await prismaClient.pointConsumptionItems.findUnique({ where: { key: 'assistant_token' } })) ??
        (await prismaClient.pointConsumptionItems.findUnique({ where: { key: 'case_analysis_token' } }))

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

> `PrismaClient` 类型来自 `~~/generated/prisma/client`；`prisma/seed.ts` 顶部已有该 import（L1 附近），新增函数签名直接复用即可，无需额外 import。

- [ ] **Step 7.5：补 `seedData.sql` 备份行**

在 [prisma/seeds/seedData.sql:882](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/seeds/seedData.sql:882) `document_draft_token` 行之后新增：

```sql
-- contract_review_token: 合同审查 token 计费规则（由 seed.ts 的 seedContractReviewTokenRule 幂等写入，此处为等幂备份）
INSERT INTO "public"."point_consumption_items" ("key", "group", "name", "description", "unit", "point_amount", "status", "created_at", "updated_at", "deleted_at", "discount") VALUES ('contract_review_token', 'agentToken', '合同审查 token 计费', '合同审查按模型 token 用量扣减积分', '千tokens', 1, 1, '2026-04-18 10:00:00+08', '2026-04-18 10:00:00+08', NULL, '1.00') ON CONFLICT (key) DO NOTHING;
```

**不写 `contractReviewMain` 节点的 SQL 备份**——节点依赖 `modelId` 动态查询，不适合 SQL 硬编码（与 `documentMain` 节点一致，都不在 seedData.sql 中）。

- [ ] **Step 7.6：验证**

```bash
# 先跑单测
npx vitest run tests/server/assistant/contract/contractReview.seed.test.ts --reporter=verbose

# 再跑 seed 两次验证幂等
bunx prisma db seed
bunx prisma db seed
```

**Expected：**

- 测试全绿
- 两次 seed 命令均成功，控制台输出 `[seed] contract_review_token 积分规则完成`
- `psql` 查询 `SELECT COUNT(*) FROM point_consumption_items WHERE key='contract_review_token'` 返回 `1`
- `psql` 查询 `SELECT COUNT(*) FROM nodes WHERE name='contractReviewMain'` 返回 `1`
- 额外冒烟验证"import 不触发 main()"：`bun -e "import('./prisma/seed.ts').then(m => console.log('helpers:', typeof m.seedContractReviewMainNode, typeof m.seedContractReviewTokenRule))"` 输出 `helpers: function function`，且**无** `[seed] ... 完成` 日志出现

- [ ] **Step 7.7：提交**

```bash
git add prisma/seed.ts prisma/seeds/seedData.sql tests/server/assistant/contract/contractReview.seed.test.ts
git commit -m "feat(contract): 新增 contractReviewMain 节点与 contract_review_token seed"
```

---

## 11. Task 8：M1 全量验收

- [ ] **Step 8.1：跑定向测试**

```bash
npx vitest run \
  tests/shared/types/case.interruptType.test.ts \
  tests/shared/types/contract.test.ts \
  tests/server/workflow/middleware/types.reviewResultPersistence.test.ts \
  tests/server/assistant/contract/sampleFixtures.test.ts \
  tests/server/assistant/contract/contractReview.seed.test.ts \
  --reporter=verbose
```

**Expected：** 5 个文件全绿

- [ ] **Step 8.2：跑 typecheck**

```bash
npx nuxi typecheck
```

**Expected：** 0 error

- [ ] **Step 8.3：跑 seed 验收（幂等）**

```bash
bunx prisma db seed
bunx prisma db seed
```

**Expected：** 两次均成功；`contractReviewMain` 节点唯一存在；`contract_review_token` 唯一存在

- [ ] **Step 8.4：确认 M1 交付物完整**

Checklist（对齐 spec §11 M1 验收）：

- [ ] `fast-xml-parser` + `diff-match-patch` 已装，package.json 可见
- [ ] `contract_reviews` 表存在
- [ ] `contract_reviews` **不含 `case_id`** 列
- [ ] `idx_contract_reviews_session` 为 UNIQUE 约束（非普通 index）
- [ ] `shared/types/contract.ts` 已落地（10 个类型导出）
- [ ] `InterruptType.AWAITING_STANCE` 已落地
- [ ] `MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE` 常量已落地
- [ ] `seedContractReviewMainNode` + `seedContractReviewTokenRule` 可通过 `bunx prisma db seed` 执行成功
- [ ] 5 份 `.docx` 样本存在且 mammoth 可解析，含甲方/乙方标识
- [ ] `docs/tech-docs/architecture/data-model.md` 已同步
- [ ] `.claude/rules/git.md` scope 含 `contract`
- [ ] `seedData.sql` 含 `contract_review_token` 备份行

- [ ] **Step 8.5：提交前检查**

只检查**本次相关文件**状态，不要求仓库全局 clean worktree：

```bash
git status
git log --oneline main..HEAD
```

**Expected：** 7 个提交对应 7 个 Task（Task 8 不产生单独提交），`git log --oneline main..HEAD` 由新到旧输出：

```
feat(contract): 新增 contractReviewMain 节点与 contract_review_token seed
test(contract): 新增合同审查 5 份样本 .docx fixture
feat(contract): 新增 contract_reviews 数据表
feat(contract): 新增 MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE 常量
feat(contract): 新增合同审查共享类型与立场中断枚举
chore(contract): 安装合同审查 M1 所需 XML 与 diff 依赖
docs(contract): git.md scope 列表新增 contract
```

---

## 12. 明确延后到后续里程碑

### 延后到 M2

- `server/services/assistant/contract/docx/` 四文件（parser / partyDetector / commentInjector / zipRewriter）
- `textToDocxService`
- 对 5 份样本的批注注入单测

### 延后到 M3

- `reviewResultPersistence.middleware.ts` 文件本体
- `server/services/workflow/middleware/index.ts` 追加 `export * from './reviewResultPersistence.middleware'`
- `contractReviewMain` agent 骨架 `server/services/workflow/agents/contractReviewMainAgent.ts`
- `parseAndAskStance` 工具 + `toolModules` 注册
- `runContractReviewChat` + agentWorker `scope='contract'` 分支
- `contractReview.service.ts` / `contractReview.dao.ts`
- 5 个 API 端点（POST/GET/PATCH/rebuild-docx/download/stance）
- `PromptRenderContext` 扩展 `reviewId` / `contractType`；`ToolContext` 扩展 `reviewId`

### 延后到 M4

- `/dashboard/assistant/contract` 路由与 6 个 Vue 组件
- `useContractReview` composable

### 延后到 M5

- 条款级 diff 对比 UI（复用 M1 装的 `diff-match-patch`）
- PATCH risks 编辑 / rebuild-docx 并发占位

---

## 13. M3 启动前首件事清单（供后续 plan 引用，M1 不执行）

M3 plan 需在 Step 0 处理以下 8 项（确保从 M1 地基到 M3 接口无缝衔接）：

1. 验证 `state.structuredResponse` 在 `afterAgent` 钩子可见的 PoC（与文书生成共用；若文书生成 M3 已 PoC 通过则跳过）
2. 创建 `server/services/workflow/middleware/reviewResultPersistence.middleware.ts`
3. 在 `server/services/workflow/middleware/index.ts` 追加 `export * from './reviewResultPersistence.middleware'`
4. 扩展 `PromptRenderContext` 接口加 optional `reviewId` / `contractType` 字段（`server/services/workflow/utils/promptRenderer.ts`）
5. 扩展 `ToolContext` 接口加 optional `reviewId` 字段（`server/services/workflow/tools/types.ts`）
6. 校验 `getValidNodeConfig('contractReviewMain')` 可正常读取 M1 的节点与提示词
7. 校验 `pointConsumptionMiddleware(userId, 'contract_review_token', sessionId)` 可正常匹配 M1 的积分规则
8. 在 `agentWorker.executeRun` 的 scope 分流中补 `else if (session.scope === 'contract')` 分支

---

## 14. 风险与缓释（M1 级别）

| # | 风险 | 缓释 |
|---|---|---|
| R1 | `prisma/seed.ts` 680 行已偏大，继续追加两个函数进一步逼近 800 行门槛 | M1 只追加，不重构；**若未来再加新 seed，需在 M4+ 单独拆分 seed.ts** |
| R2 | tsx/bun/node 执行 `prisma/seed.ts` 时 `import.meta.url` 路径形态差异 | Step 7.2 采用与 `scripts/importDocumentTemplates.ts:301` 完全一致的 `import.meta.url === \`file://${process.argv[1]}\`` 表达式；Step 7.6 新增验证"import 不触发 main()"；Step 8.3 验证 `bunx prisma db seed` 正常跑完 |
| R3 | 合同样本生成依赖 `markdown-docx` / `html-docx-js-typescript` 的细节 | 生成脚本是一次性脚本，跑成功后删除；生成的 `.docx` 进 git 作稳定 fixture |
| R4 | 测试库 schema 不同步导致 seed 测试失败（沿用历史教训） | Step 5.5 强制同步测试库；sampleFixtures + seed 测试均使用独立测试库 |
| R5 | `caseMain` 不存在或为 reasoner，导致 `seedContractReviewMainNode` 模型回退路径触发 | 严格复用 `seedDocumentMainNode` 既有 fallback 链；M3 启动前首件事第 6 项再次验证 |

---

## 15. 提交切片汇总

共 7 个原子提交（对齐 Task 1~7，Task 8 只做验收不提交）：

1. `docs(contract): git.md scope 列表新增 contract`
2. `chore(contract): 安装合同审查 M1 所需 XML 与 diff 依赖`
3. `feat(contract): 新增合同审查共享类型与立场中断枚举`
4. `feat(contract): 新增 MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE 常量`
5. `feat(contract): 新增 contract_reviews 数据表`
6. `test(contract): 新增合同审查 5 份样本 .docx fixture`
7. `feat(contract): 新增 contractReviewMain 节点与 contract_review_token seed`

> **顺序依据**：git.md 声明 `contract` scope 必须最先提交，否则 Task 2-7 使用 `(contract)` scope 时违反仓库提交规范 `.claude/rules/git.md`。

---

## 16. 与 Spec §11 M1 验收条款对齐校验

| spec §11 M1 要求项 | 对应本 plan Task |
|---|---|
| `.claude/rules/git.md` scope 新增 `contract` | Task 1 |
| `bun add fast-xml-parser diff-match-patch` | Task 2 |
| `docx-preview` 已装则跳过 | Task 2 Step 2.1 |
| 已有 `mammoth` / `jszip`（无需装） | Task 2 Step 2.1 |
| `InterruptType.AWAITING_STANCE` 枚举扩展 | Task 3 §6.1 |
| 新建 `shared/types/contract.ts` | Task 3 §6.2 |
| `MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE` 常量 | Task 4 |
| `contractReviews` migrate（不含 caseId，unique 索引） | Task 5 |
| 5 份样本 `.docx` 入 `prisma/seeds/contract-samples/` | Task 6 |
| `seedContractReviewMainNode` + `seedContractReviewTokenRule` | Task 7 |
| `middleware/index.ts` export | **延后到 M3**（文件本体 M3 创建，提前 export 会编译失败）——已在本 plan §1.2 与 §13 第 3 项明示 |
| 验收：`bun run prisma:migrate dev` + `bunx prisma db seed` 跑完；样本可被 mammoth 解析 | Task 5 + Task 6 + Task 8 |

**唯一与 spec 文字稍有偏差的点**：`middleware/index.ts` 的 export 从 M1 推到 M3。理由已记录，由 M3 plan 第一件事补齐。

---

**本 plan 冻结 M1 实施范围。任何超出上述 Task 1-7 的改动（包括顺手重构既有 seed 架构、提前创建 reviewResultPersistence.middleware.ts 空骨架等），一律延后。**
