# 合同审查 M1 实施 Plan（Reviewed）

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

## 0. 本轮审查后的边界

**M1 只做真正会被后续里程碑直接复用的地基层**，不提前落未来里程碑才会消费的配置、常量和抽象。

本次审查后，M1 强制遵守 4 条原则：

1. 复用现有基建，不重复造轮子
2. 不做当前里程碑没有消费方的提前设计
3. 路径、命令、测试方式、数据模型写法必须与当前仓库一致
4. 不偏离原始主线：M1 只交付数据层、共享类型、样本 fixture、最小 seed

---

## 1. 目标与非目标

### 1.1 Goal

为合同审查功能补齐最小稳定底座：

- `contract_reviews` 数据表
- 合同审查共享类型
- `InterruptType.AWAITING_STANCE`
- 5 份测试用 `.docx` 样本合同
- `contract_review_token` 积分规则 seed

完成后，应能直接解锁：

- M2 的 docx 解析 / 批注子模块
- M3 的 agent / API / worker / middleware 闭环

### 1.2 本期明确不做

以下内容从 M1 移出，统一延后到真正需要它们的里程碑：

- `MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE`
- `reviewResultPersistence.middleware.ts`
- `server/services/workflow/middleware/index.ts` 新 export
- `contractReviewMain` 节点 / prompt seed
- `diff-match-patch` 依赖
- 任何 agent / API / UI / worker 代码
- `.claude/rules/git.md` 的 `contract` scope 文档更新

**原因：**

- 这些内容在 M1 没有运行时消费方
- 现在提前落地，只会增加评审面和返工概率
- 尤其 `contractReviewMain` 的模型选择最终必须复用 `documentMain` 对 `tool_choice` / 非 reasoner 模型的约束，离开 M3 的真实实现很容易写错

---

## 2. 当前仓库基线（已核对）

实施前先确认以下事实，避免继续基于过期假设写 plan：

- 当前仓库是 **Prisma 7.x**，不是 6.x
- `docx-preview` **已经安装**
- `mammoth`、`jszip` **已经安装**
- 仓库已存在可复用的 `.docx` 生成能力：
  - `markdown-docx`
  - `html-docx-js-typescript`
  - 参考 [CaseExportDialog.vue](/Users/daixin/work/dev/LexSeek/LexSeek/app/components/caseDetail/CaseExportDialog.vue:101)
- `prisma/seed.ts` 当前 **顶层直接执行 `main()`**，不能按“普通函数库”安全 import；若要给 seed helper 写函数级测试，必须先消除这个副作用
- 文书生成相关测试与服务都放在 `assistant/document` 目录下；合同审查应对齐为 `assistant/contract`，不要新造 `tests/server/contract` 这类平行目录

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
- `tests/shared/types/contract.test.ts`
- `tests/shared/types/case.interruptType.test.ts`
- `tests/server/assistant/contract/sampleFixtures.test.ts`
- `tests/server/assistant/contract/contractReview.seed.test.ts`

### 3.2 修改

- `package.json`
- `bun.lock`
- `shared/types/case.ts`
- `prisma/models/user.prisma`
- `prisma/seed.ts`
- `prisma/seeds/seedData.sql`
- `docs/tech-docs/architecture/data-model.md`

---

## 4. Task 1：只安装 M1 真正需要的依赖

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`

### Why

- M2 的 `commentInjector` 需要 XML 级处理，`fast-xml-parser` 应该现在装
- `diff-match-patch` 只在 M5 的条款 diff UI 用到，M1 不装
- `docx-preview` 已存在，M1 不重复操作

- [ ] **Step 1.1：确认当前依赖基线**

```bash
rg -n "docx-preview|mammoth|jszip|fast-xml-parser|diff-match-patch" package.json
```

**Expected：**

- 能看到 `docx-preview` / `mammoth` / `jszip`
- 看不到 `fast-xml-parser`
- `diff-match-patch` 若缺失，不在 M1 补装

- [ ] **Step 1.2：只安装 `fast-xml-parser`**

```bash
bun add fast-xml-parser
```

- [ ] **Step 1.3：冒烟验证**

```bash
bun -e "import { XMLParser } from 'fast-xml-parser'; console.log(typeof XMLParser)"
```

**Expected：** 输出 `function`

- [ ] **Step 1.4：验证通过后提交**

建议提交：

```bash
git add package.json bun.lock
git commit -m "chore(analysis): 安装合同审查 M1 所需 XML 依赖"
```

---

## 5. Task 2：共享类型与中断枚举

**Files:**

- Modify: `shared/types/case.ts`
- Create: `shared/types/contract.ts`
- Create: `tests/shared/types/case.interruptType.test.ts`
- Create: `tests/shared/types/contract.test.ts`

### 5.1 `InterruptType.AWAITING_STANCE`

- [ ] **Step 2.1：先写回归测试**

`tests/shared/types/case.interruptType.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { InterruptType } from '#shared/types/case'

describe('InterruptType enum', () => {
    it('保留既有中断类型', () => {
        expect(InterruptType.CASE_INFO_CHECK).toBe('case_info_check')
        expect(InterruptType.BASIC_INFO_CONFIRM).toBe('basic_info_confirm')
        expect(InterruptType.MODULE_SELECT).toBe('module_select')
        expect(InterruptType.INSUFFICIENT_POINTS).toBe('insufficient_points')
    })

    it('新增 awaiting_stance', () => {
        expect(InterruptType.AWAITING_STANCE).toBe('awaiting_stance')
    })
})
```

- [ ] **Step 2.2：补实现**

在 [case.ts](/Users/daixin/work/dev/LexSeek/LexSeek/shared/types/case.ts:148) 的 `InterruptType` 中追加：

```typescript
    /** 中断点5：合同审查立场选择 */
    AWAITING_STANCE = 'awaiting_stance',
```

### 5.2 `shared/types/contract.ts`

**约束：**

- 只放业务枚举、值对象、API 请求响应
- **不镜像 Prisma row 类型**
- 风格对齐 [document.ts](/Users/daixin/work/dev/LexSeek/LexSeek/shared/types/document.ts:1)

- [ ] **Step 2.3：先写失败测试**

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

    it('请求响应类型可用', () => {
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

- [ ] **Step 2.4：补实现**

`shared/types/contract.ts`

```typescript
/**
 * 合同审查相关业务类型
 *
 * 约定：Prisma row 类型从 #shared/types/prisma 直接导入，不在此镜像。
 */

export type RiskLevel = 'high' | 'medium' | 'low'
export type Stance = 'partyA' | 'partyB' | 'neutral'
export type ContractReviewStatus =
    | 'pending'
    | 'reviewing'
    | 'awaiting_stance'
    | 'completed'
    | 'failed'

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

- [ ] **Step 2.5：验证**

```bash
npx vitest run tests/shared/types/case.interruptType.test.ts tests/shared/types/contract.test.ts --reporter=verbose
npx nuxi typecheck
```

- [ ] **Step 2.6：验证通过后提交**

建议提交：

```bash
git add shared/types/case.ts shared/types/contract.ts tests/shared/types/
git commit -m "feat(analysis): 新增合同审查共享类型与立场中断枚举"
```

---

## 6. Task 3：新增 `contract_reviews` 数据表

**Files:**

- Create: `prisma/models/contractReview.prisma`
- Modify: `prisma/models/user.prisma`
- Modify: `docs/tech-docs/architecture/data-model.md`
- Modify: `prisma/migrations/**`（自动生成）

### 6.1 模型定义

- [ ] **Step 3.1：新增 Prisma model**

`prisma/models/contractReview.prisma`

```prisma
/// 合同审查记录表
/// MVP 不含 caseId，案件页复用后续再补
model contractReviews {
    id             Int       @id @default(autoincrement())
    userId         Int       @map("user_id")
    sessionId      String    @map("session_id") @db.VarChar(100)
    originalFileId Int       @map("original_file_id")
    reviewedFileId Int?      @map("reviewed_file_id")
    contractType   String?   @db.VarChar(50)
    partyA         String?   @db.VarChar(200)
    partyB         String?   @db.VarChar(200)
    stance         String?   @db.VarChar(20)
    status         String    @default("pending") @db.VarChar(30)
    risks          Json?     @db.JsonB
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

- [ ] **Step 3.2：补 users 反向关系**

在 [user.prisma](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/models/user.prisma:84) 的文书相关关系附近追加：

```prisma
    contractReviews contractReviews[]
```

### 6.2 迁移与文档

- [ ] **Step 3.3：生成 migration**

```bash
bun run prisma:generate
bun run prisma:migrate --name add_contract_reviews
```

**Expected：**

- 生成 `contract_reviews`
- 有 `idx_contract_reviews_session` 唯一索引
- **没有** `case_id`
- **没有** `idx_contract_reviews_case`

- [ ] **Step 3.4：同步测试数据库 schema**

测试用例跑的是独立测试库，迁移完开发库后要同步测试库：

```bash
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing' bun run prisma:push --accept-data-loss
```

- [ ] **Step 3.5：同步技术文档**

更新 [data-model.md](/Users/daixin/work/dev/LexSeek/LexSeek/docs/tech-docs/architecture/data-model.md:1)：

- 模型文件列表中加入 `contractReview.prisma`
- 核心关系中补充 `users -> contractReviews`
- 简述 `sessionId` 与合同审查会话一一对应

- [ ] **Step 3.6：验证**

```bash
npx nuxi typecheck
```

- [ ] **Step 3.7：验证通过后提交**

建议提交：

```bash
git add prisma/models/contractReview.prisma prisma/models/user.prisma prisma/migrations docs/tech-docs/architecture/data-model.md
git commit -m "feat(analysis): 新增 contract_reviews 数据表"
```

---

## 7. Task 4：测试用合同样本 fixture

**Files:**

- Create: `prisma/seeds/contract-samples/*.docx`
- Create: `prisma/seeds/contract-samples/README.md`
- Create: `tests/server/assistant/contract/sampleFixtures.test.ts`

### Why

- M2 / M3 / M5 都会复用这些 fixture
- 样本应直接跟合同审查模块走，不应散落在新的顶层测试目录
- 样本生成方式应可复现，优先复用仓库已有 docx 生成能力

- [ ] **Step 4.1：准备 5 份脱敏样本文本**

合同类型固定为：

- `labor`
- `lease`
- `sale`
- `service`
- `loan`

每份要求：

- 300-800 字
- 明示 `甲方：...` / `乙方：...`
- 含 5-8 个可疑条款
- 不含真实客户信息
- 不含 `{{}}` 占位符

- [ ] **Step 4.2：生成 `.docx`**

优先复用仓库现有方案，而不是引入外部工具依赖：

- 主方案：`markdown-docx`
- 备用：`html-docx-js-typescript`

参考 [CaseExportDialog.vue](/Users/daixin/work/dev/LexSeek/LexSeek/app/components/caseDetail/CaseExportDialog.vue:101)

可以使用一次性本地脚本生成后删除脚本本身，但生成逻辑必须可复现，不依赖 Word / Google Docs / pandoc。

- [ ] **Step 4.3：写 README**

`prisma/seeds/contract-samples/README.md`

```markdown
# 合同审查样本 Fixture

本目录仅存放合同审查测试样本，不参与生产 seed。

| 文件 | 类型 |
|---|---|
| labor.docx | 劳动合同 |
| lease.docx | 房屋租赁合同 |
| sale.docx | 买卖合同 |
| service.docx | 服务合同 |
| loan.docx | 借款合同 |

## 约束

1. 全部为脱敏虚构样本
2. 明示 `甲方` / `乙方`
3. 无 `{{占位符}}`
4. 供 M1-M5 测试复用
```

- [ ] **Step 4.4：写冒烟测试**

`tests/server/assistant/contract/sampleFixtures.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'

const SAMPLE_DIR = join(__dirname, '../../../../prisma/seeds/contract-samples')
const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const

describe('合同审查样本 fixture', () => {
    it.each(SAMPLES)('%s.docx 可被 mammoth 解析且段落数 >= 5', async (name) => {
        const path = join(SAMPLE_DIR, `${name}.docx`)
        const buffer = await readFile(path)
        const { value: rawText } = await mammoth.extractRawText({ buffer })
        const paragraphs = rawText.split(/\n+/).filter(p => p.trim().length > 0)
        expect(paragraphs.length).toBeGreaterThanOrEqual(5)
    })
})
```

- [ ] **Step 4.5：验证**

```bash
npx vitest run tests/server/assistant/contract/sampleFixtures.test.ts --reporter=verbose
```

- [ ] **Step 4.6：验证通过后提交**

建议提交：

```bash
git add prisma/seeds/contract-samples tests/server/assistant/contract/sampleFixtures.test.ts
git commit -m "test(analysis): 新增合同审查样本 fixture"
```

---

## 8. Task 5：最小 seed，只做 `contract_review_token`

**Files:**

- Modify: `prisma/seed.ts`
- Modify: `prisma/seeds/seedData.sql`
- Create: `tests/server/assistant/contract/contractReview.seed.test.ts`

### 8.1 关键约束

当前 [seed.ts](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/seed.ts:663) 顶层会直接执行 `main()`。

**因此 M1 不能直接照原方案写：**

```typescript
await import('~~/prisma/seed')
```

否则测试一 import 就会跑完整 seed，污染 DB 状态。

### 8.2 方案

优先方案：

1. 让 `prisma/seed.ts` 在“被 import 时”不自动执行 `main()`
2. 导出 `seedContractReviewTokenRule`
3. 用真实测试数据库验证该 helper 幂等

降级方案：

- 如果这轮不想改 `seed.ts` 入口结构，就**不做函数级单测**
- 改为 `bun prisma db seed` 连跑两次 + DB 断言 `contract_review_token` 只存在一条且字段正确

**推荐采用优先方案**，因为它能让后续 M3 的 seed 也变得可测试。

- [ ] **Step 5.1：先写测试**

`tests/server/assistant/contract/contractReview.seed.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import '../../case/test-setup'
import { disconnectTestDb, getTestPrisma } from '../../case/test-db-helper'

describe('contract_review_token seed', () => {
    const prisma = getTestPrisma()
    let seedContractReviewTokenRule: (prismaClient: typeof prisma) => Promise<void>

    beforeAll(async () => {
        const seedModule = await import('~~/prisma/seed')
        seedContractReviewTokenRule = seedModule.seedContractReviewTokenRule
        expect(typeof seedContractReviewTokenRule).toBe('function')
    })

    afterAll(async () => {
        await prisma.pointConsumptionItems.deleteMany({
            where: { key: 'contract_review_token' },
        })
        await disconnectTestDb()
    })

    it('幂等写入 contract_review_token', async () => {
        await seedContractReviewTokenRule(prisma as any)
        await seedContractReviewTokenRule(prisma as any)

        const row = await prisma.pointConsumptionItems.findUnique({
            where: { key: 'contract_review_token' },
        })

        expect(row).not.toBeNull()
        expect(row?.group).toBe('agentToken')
        expect(row?.status).toBe(1)
    })
})
```

- [ ] **Step 5.2：把 `seed.ts` 改成可安全 import**

要求：

- `main()` 保持 CLI 行为不变
- import 模块时不自动执行
- 只做最小修改，不顺手重构整个 seed 架构

- [ ] **Step 5.3：新增并导出 `seedContractReviewTokenRule`**

实现策略复用现有 [seedDocumentDraftTokenRule](/Users/daixin/work/dev/LexSeek/LexSeek/prisma/seed.ts:359)：

- 优先参考 `document_draft_token`
- 其次参考 `assistant_token`
- 最后回退 `case_analysis_token`

目标行：

```typescript
export async function seedContractReviewTokenRule(prismaClient: PrismaClient): Promise<void>
```

- [ ] **Step 5.4：在 `main()` 中调用**

放在文书生成 token rule 后面即可：

```typescript
    await seedContractReviewTokenRule(prisma)
```

- [ ] **Step 5.5：补 `seedData.sql` 备份行**

参考当前文件里 `document_draft_token` 的写法，不要自行发明新的 SQL 风格。

注意：

- 当前 `seedData.sql` **没有** `assistant_token` 行，不要照着不存在的行抄
- 应直接仿照 `document_draft_token` / `case_analysis_token`

- [ ] **Step 5.6：验证**

优先方案：

```bash
npx vitest run tests/server/assistant/contract/contractReview.seed.test.ts --reporter=verbose
bun prisma db seed
```

降级方案：

```bash
bun prisma db seed
bun prisma db seed
```

然后手工或脚本断言 `contract_review_token` 只有一条且字段正确。

- [ ] **Step 5.7：验证通过后提交**

建议提交：

```bash
git add prisma/seed.ts prisma/seeds/seedData.sql tests/server/assistant/contract/contractReview.seed.test.ts
git commit -m "feat(analysis): 新增 contract_review_token seed"
```

---

## 9. M1 全量验收

- [ ] **Step 6.1：跑定向测试**

优先方案（seed import-safe）：

```bash
npx vitest run \
  tests/shared/types/case.interruptType.test.ts \
  tests/shared/types/contract.test.ts \
  tests/server/assistant/contract/sampleFixtures.test.ts \
  tests/server/assistant/contract/contractReview.seed.test.ts \
  --reporter=verbose
```

降级方案（不做函数级 seed 单测）：

```bash
npx vitest run \
  tests/shared/types/case.interruptType.test.ts \
  tests/shared/types/contract.test.ts \
  tests/server/assistant/contract/sampleFixtures.test.ts \
  --reporter=verbose
```

- [ ] **Step 6.2：跑 typecheck**

```bash
npx nuxi typecheck
```

- [ ] **Step 6.3：跑 seed 验收**

优先方案：

```bash
bun prisma db seed
```

降级方案：

```bash
bun prisma db seed
bun prisma db seed
```

然后补一条 DB 断言，确认 `contract_review_token` 只有一条且字段正确。

- [ ] **Step 6.4：确认 M1 交付物完整**

检查项：

- `contract_reviews` 表存在
- `contract_reviews` 不含 `case_id`
- `shared/types/contract.ts` 已落地
- `InterruptType.AWAITING_STANCE` 已落地
- `contract_review_token` seed 可重复执行
- 5 份 `.docx` 样本都可被 `mammoth` 解析
- `docs/tech-docs/architecture/data-model.md` 已同步

- [ ] **Step 6.5：提交前检查**

只检查**本次相关文件**状态，不要求仓库全局 clean worktree。

---

## 10. 明确延后到后续里程碑

### 延后到 M3

- `contractReviewMain` 节点 / prompt seed
- `MIDDLEWARE_NAMES.REVIEW_RESULT_PERSISTENCE`
- `reviewResultPersistence.middleware.ts`
- `server/services/workflow/middleware/index.ts` export

### 延后到 M5

- `diff-match-patch`
- 条款级 diff UI

---

## 11. 建议提交切片

建议按 5 个原子提交：

1. `chore(analysis): 安装合同审查 M1 所需 XML 依赖`
2. `feat(analysis): 新增合同审查共享类型与立场中断枚举`
3. `feat(analysis): 新增 contract_reviews 数据表`
4. `test(analysis): 新增合同审查样本 fixture`
5. `feat(analysis): 新增 contract_review_token seed`

---

## 12. 审查结论

这版 M1 plan 的核心变化只有两点：

1. **删掉未被 M1 消费的未来设计**，把 `contractReviewMain` / middleware 常量 / diff 依赖都移出当前里程碑
2. **把仓库现实约束写进 plan**，特别是：
   - `docx-preview` 已安装
   - 样本 `.docx` 生成要复用现有导出能力
   - `prisma/seed.ts` 不能直接当函数库 import
   - 测试目录和文书生成模块保持同一组织方式
   - 测试库 schema 需要在迁移后单独同步

这样 M1 更短、更稳，也更接近“先把地基打实，再做闭环”的原始目标。
