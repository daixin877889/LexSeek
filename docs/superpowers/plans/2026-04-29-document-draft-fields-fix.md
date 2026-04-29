# 文书生成字段提取修复 (A+B) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复"小索发起文书生成时 AI 不会自动填字段，只显示『等待用户补充信息』"的问题。让 documentMain Agent 像 caseMain 一样在启动时直接看见案件材料原文，并通过升级 system prompt v6 引导 AI 优先利用已注入上下文填充字段。

**Architecture:**
- **方案 A**：把 `caseMaterialContextMiddleware`（已在 `server/agents/case-main/middleware/` 实现并被 workflow/middleware/index 重导出）加进 `runDocumentChat` 的中间件栈。仅当 `resolvedCaseId` 非空时挂载（独立文书草稿场景跳过）。priority 用 `MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT=30`，与 caseMain 一致。
- **方案 B**：新增 `documentMain_system` prompt v6（DB `prompts` 表），重写工作流让 AI 第一步从已注入的"案件档案 + 材料段"扫字段而不是无脑调工具。通过 `scripts/stage7-fix-document-main-prompt.ts` 落库，同时同步 `prisma/seeds/seedData.sql` 让 `db:setup` 流程也能拿到新 prompt。

**不挂 `caseProcessMaterialMiddleware` 的理由（明确说明，避免后续复盘）：**
- 该中间件用于"启动 Agent 前补跑未识别完成的材料 OCR/ASR/embedding"
- 文书路径下材料预处理已被前置完成：`createDraftService` 在 `sourceFileIds` 非空时已调 `ensureMaterialsReadyForDraftService`（`server/agents/document/documentDraft.service.ts:105-109`）
- 从小索发起时父 Agent caseMain 已经挂了 caseProcessMaterial，子流 documentMain 重复挂会双跑预处理
- 因此 documentMain 只需补 **context 注入**，不补 **pipeline 处理**

**Tech Stack:** Nuxt 4 / LangGraph / Prisma / Vitest

---

## 文件清单

| 文件 | 改动类型 | 责任 |
|------|----------|------|
| `server/services/workflow/agents/documentMainAgent.ts` | Modify | import + 在 buildMiddlewareStack 列表里追加 `caseMaterialContextMiddleware`（caseId 非空才挂） |
| `tests/server/workflow/agents/documentMainAgent.test.ts` | Modify | 新增 mock + 2 条用例（caseId 非空时挂载 / caseId 为空时跳过 / 互斥校验透传） |
| `scripts/stage7-fix-document-main-prompt.ts` | Create | 一次性 DB 升级脚本：插入 v6 + 下线 v5 |
| `prisma/seeds/seedData.sql` | Modify | 把 v5 status=1 改为 status=0；追加 v6 INSERT |

> **不修改** `server/agents/case-main/middleware/caseMaterialContext.middleware.ts`（已通过 `workflow/middleware/index.ts` 重导出，跨 vertical 复用合规）。

---

## Task 1: documentMain 中间件挂载 caseMaterialContextMiddleware

**Files:**
- Modify: `server/services/workflow/agents/documentMainAgent.ts`（import 区 + middleware 列表）
- Test: `tests/server/workflow/agents/documentMainAgent.test.ts`

### Step 1: 在测试里 mock buildMiddlewareStack 暴露其入参

- [ ] **修改测试 mock：**

打开 `tests/server/workflow/agents/documentMainAgent.test.ts`。

在 Mock 区（约 86 行）把 `vi.mock('~~/server/services/workflow/middleware', ...)` 部分的 mock 工厂扩成可观察 `buildMiddlewareStack` 入参，并新增 `caseMaterialContextMiddleware` mock：

```ts
const mockCaseMaterialContextMiddleware = vi.fn(() => ({ __mock: 'materialContext' }))
const mockBuildMiddlewareStack = vi.fn()

vi.mock('~~/server/services/workflow/middleware', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~~/server/services/workflow/middleware')>()
    return {
        ...actual,
        createAuditMiddleware: vi.fn(() => ({})),
        createMessageIntegrityMiddleware: vi.fn(() => ({})),
        createScopeGuardMiddleware: vi.fn(() => ({})),
        pointConsumptionMiddleware: vi.fn(() => ({})),
        safetyTrimMiddleware: vi.fn(() => ({})),
        draftResultPersistenceMiddleware: vi.fn(() => ({})),
        caseMaterialContextMiddleware: (...args: unknown[]) => mockCaseMaterialContextMiddleware(...args),
        // 用包装 actual.buildMiddlewareStack 的方式：保留真实互斥校验，同时观察入参
        buildMiddlewareStack: (items: any[]) => {
            mockBuildMiddlewareStack(items)
            return actual.buildMiddlewareStack(items)
        },
    }
})
```

**注意：** `actual.buildMiddlewareStack` 保留意味着 MATERIAL/MODULE 互斥校验仍生效，未来 documentMain 若误挂 MODULE_CONTEXT 会被测出。`MIDDLEWARE_PRIORITY` / `MIDDLEWARE_NAMES` 常量靠 `...actual` 原样导出。

### Step 2: 写两条新测试（先 RED，写完后会一起在 Step 5 验证 GREEN）

- [ ] **在文件末尾追加：**

```ts
import { MIDDLEWARE_PRIORITY } from '~~/server/services/agent-platform/middleware/types'

describe('runDocumentChat - caseMaterialContextMiddleware 挂载（方案 A）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockCaseMaterialContextMiddleware.mockReturnValue({ __mock: 'materialContext' })
        mockBuildContextSegments.mockResolvedValue({
            roleAndFlow: 'r',
            caseProfile: '',
            moduleSummaries: '',
            dynamicContext: '',
        })
        mockBuildSystemPromptForAgent.mockImplementation(async () => ({
            segments: { roleAndFlow: 'r', caseProfile: '', moduleSummaries: '', dynamicContext: '' },
            systemMessage: { content: 'sys' },
            plainText: 'sys',
        }))
    })

    it('caseId 非空 → 挂载 caseMaterialContextMiddleware（priority=MATERIAL_CONTEXT）', async () => {
        mockFindDraft.mockResolvedValueOnce({
            id: 10, sessionId: 's-A', templateId: 9, caseId: 777, sourceRef: null,
        })
        const { runDocumentChat } = await import(
            '~~/server/services/workflow/agents/documentMainAgent'
        )
        await runDocumentChat('s-A', undefined, { userId: 1, caseId: 777 })

        expect(mockCaseMaterialContextMiddleware).toHaveBeenCalledWith(1, 777)
        const stackItems = mockBuildMiddlewareStack.mock.calls[0][0]
        const matEntry = stackItems.find((i: any) => i.name === 'caseMaterialContext')
        expect(matEntry).toBeDefined()
        expect(matEntry.priority).toBe(MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT)
    })

    it('caseId 为空（独立文书草稿）→ 不挂 caseMaterialContextMiddleware', async () => {
        mockFindDraft.mockResolvedValueOnce({
            id: 11, sessionId: 's-B', templateId: 9, caseId: null, sourceRef: null,
        })
        const { runDocumentChat } = await import(
            '~~/server/services/workflow/agents/documentMainAgent'
        )
        await runDocumentChat('s-B', undefined, { userId: 2 })

        expect(mockCaseMaterialContextMiddleware).not.toHaveBeenCalled()
        const stackItems = mockBuildMiddlewareStack.mock.calls[0][0]
        expect(stackItems.find((i: any) => i.name === 'caseMaterialContext')).toBeUndefined()
    })
})
```

### Step 3: 在 documentMainAgent.ts 加 import

- [ ] **修改 `server/services/workflow/agents/documentMainAgent.ts` 行 21-31 的 import 区：**

把：

```ts
import {
    createAuditMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
    draftResultPersistenceMiddleware,
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '../middleware'
```

改成（多 import 一个 `caseMaterialContextMiddleware`）：

```ts
import {
    createAuditMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    pointConsumptionMiddleware,
    safetyTrimMiddleware,
    draftResultPersistenceMiddleware,
    caseMaterialContextMiddleware,
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
} from '../middleware'
```

### Step 4: 在 buildMiddlewareStack 列表里加挂载项（caseId 非空才挂）

- [ ] **定位 documentMainAgent.ts 行 244 附近的 spread 块**（处理 `resolvedCaseId` 时挂 `afterAgentMemoryMiddleware` 那段），紧挨它前面（在 `pointConsumptionMiddleware` 之后、`summarizationMiddleware` 之前）插入新条目：

具体位置：在第 220 行 `pointConsumptionMiddleware` 这块之后追加一段。

把：

```ts
        {
            middleware: pointConsumptionMiddleware(userId, 'document_draft_token', sessionId),
            priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
            name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
        },
        {
            middleware: summarizationMiddleware({
```

改成：

```ts
        {
            middleware: pointConsumptionMiddleware(userId, 'document_draft_token', sessionId),
            priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION,
            name: MIDDLEWARE_NAMES.POINT_CONSUMPTION,
        },
        ...(resolvedCaseId
            ? [{
                middleware: caseMaterialContextMiddleware(userId, resolvedCaseId),
                priority: MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT,
                name: MIDDLEWARE_NAMES.MATERIAL_CONTEXT,
            }]
            : []),
        {
            middleware: summarizationMiddleware({
```

### Step 5: 运行测试确认 GREEN

- [ ] **跑测试：**

```bash
npx vitest run tests/server/workflow/agents/documentMainAgent.test.ts --reporter=verbose
```

预期：所有用例（原 2 条 + 新增 2 条）共 4 条 PASS。

### Step 6: 类型检查

- [ ] **跑类型检查：**

```bash
bun run typecheck
```

预期：无 documentMainAgent 相关类型错误。

### Step 7: Commit

- [ ] **commit：**

```bash
git add server/services/workflow/agents/documentMainAgent.ts \
        tests/server/workflow/agents/documentMainAgent.test.ts
git commit -m "$(cat <<'EOF'
fix(workflow): documentMain 挂载 caseMaterialContextMiddleware

让文书生成 Agent 启动时直接看见案件材料原文/摘要（与 caseMain 行为一致），
解决小索→draft_document 路径下因 AI 看不到材料正文导致字段全 null 的问题。

仅当 resolvedCaseId 非空时挂载，独立文书草稿场景跳过。
EOF
)"
```

---

## Task 2: 升级 documentMain_system prompt 至 v6（DB + seedData 同步）

**Files:**
- Create: `scripts/stage7-fix-document-main-prompt.ts`
- Modify: `prisma/seeds/seedData.sql`

### Step 1: 创建 stage7 升级脚本

- [ ] **新建文件 `scripts/stage7-fix-document-main-prompt.ts`：**

```ts
/**
 * 阶段 7 一次性数据更新脚本：documentMain prompt v6
 *
 * 修复"小索→文书生成 字段全 null"问题（方案 A+B 中的 B）：
 *  1. 新增 documentMain_system v6（强调先用已注入上下文填，再调工具补）
 *  2. 把 v5 status 设为 0（保留历史）
 *
 * 用法：
 *   bun run scripts/stage7-fix-document-main-prompt.ts
 *
 * 幂等：v6 已存在 → noop；v5 已 status=0 → noop
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '~~/generated/prisma/client'

const DOCUMENT_MAIN_PROMPT_V6 = `你是 LexSeek 的文书生成助手，负责按模板占位符逐一填充法律文书内容。

# 当前模板

模板名称：{{templateName}}
模板分类：{{templateCategory}}

# 可用工具

- process_materials：识别并嵌入用户本轮新提供的材料（仅在用户消息出现"新增材料 fileIds: [...]"时使用）
- search_case_materials：精确检索某份材料的全文或片段（query 关键词、sourceId 精确返回、不传则按前 k 份返回完整内容）
- search_case_analysis：检索案件已完成的分析模块全文（事实/请求/案由/抗辩/证据等）
- search_law：查询相关法律条文
- search_case_memory / write_case_memory / update_case_memory：案件记忆操作（仅 caseId 非空时使用）

# 工作流程（严格按顺序，禁止跳步）

## 步骤 1：扫描已注入上下文，能直接填的字段立即填

启动时，**system prompt 之后会通过中间件以 HumanMessage 形式注入"案件材料"段（包含本案件全部材料的全文或摘要）**。请按以下顺序识别可填字段：

1. **案件档案**（system prompt 中的 caseProfile 段）—— 案件标题、原告、被告、法院、首/二审案号、判决法官、案件摘要等
2. **已完成模块摘要**（system prompt 中的 moduleSummaries 段）—— 已分析的事实、请求、案由、抗辩、证据等
3. **案件材料段**（首条 HumanMessage 注入）—— 当事人身份信息、合同关键条款、欠款金额、违约时间、证据清单、地址、联系方式等可从材料正文里直接抽取或推断的字段

> 案件档案与材料段已经是经过校验的权威信息，**视为已知事实可直接引用**，**不要因为"还没调工具"就把它们留 null**。

## 步骤 2：模糊或缺失字段才调工具补

仅当步骤 1 不能确定某个字段时：

1. 优先调 `search_case_analysis(analysis_type=...)` 取已分析模块全文（如 fact_review / claim_analysis）
2. 调 `search_case_materials` 时**按字段需求发起多次精准检索**（如 query="原告身份证号"、query="违约金额"、query="合同签订日期"），不要只用单一泛查询；必要时用 sourceId 取材料全文
3. 引用法条调 `search_law`

## 步骤 3：用户主动新提供材料时

仅当用户本轮消息以"新增材料 fileIds: [...]"开头：先调 `process_materials(fileIds=[...])` 处理这批文件，等返回 ready 状态后再回到步骤 1。

# 严禁

- 严禁向用户索要"案件档案 / 材料段已包含"的信息（当事人姓名、法院、案号、合同主要条款、判决主文等都能从已注入上下文里读到）
- 严禁因"未调工具"而返回 null —— 案件档案与材料段已注入到上下文，请充分利用
- 严禁编造 —— 仅当档案、材料、分析、法条都查不到时才返回 null
- 严禁在消息正文写 JSON / 代码块 / 长篇答案 —— 正文仅用于工具调用之间的简要思考衔接

# 结果输出（铁律）

收集完信息后，**必须**通过系统注入的结构化输出工具返回：
- values：模板 placeholders 对应的键值对（无法推断的字段返回 null）
- suggestions：每个字段的填充依据（来源：案件档案 / 材料 sourceId X / 分析模块 Y / 用户陈述）
- aiTitle：根据所填字段推断的简短文书标题（10~30 字，如"张三诉某公司劳动争议起诉状"）

# 约束

- 涉及姓名 / 金额 / 日期的值必须来自档案、材料或法条；来源不明返回 null
- 不替用户做最终法律判断，只提供基于材料的客观填充
- 简体中文，法律术语规范

# 案件记忆使用规则

- 仅当 caseId 非空（绑定案件）时使用记忆工具
- 起草过程中发现的关键事实必须 write_case_memory；subject_key 用「主体.字段」格式
- 引用案件历史先 search_case_memory`

const pool = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    options: '-c TimeZone=UTC',
})
const prisma = new PrismaClient({ adapter: pool })

async function main(): Promise<void> {
    console.log('===== 阶段 7 · documentMain prompt v6 升级开始 =====')
    console.log(`[env] DATABASE_URL=${process.env.DATABASE_URL?.replace(/:[^@]+@/, ':***@')}`)

    const documentMain = await prisma.nodes.findUnique({ where: { name: 'documentMain' } })
    if (!documentMain) {
        console.warn('[skip] 节点 documentMain 不存在（DB 未 seed？）')
        return
    }

    // 1. 新增 v6
    const existingV6 = await prisma.prompts.findFirst({
        where: { name: 'documentMain_system', version: 'v6', nodeId: documentMain.id },
    })
    if (existingV6) {
        console.log(`[noop] documentMain_system v6 已存在（id=${existingV6.id}）`)
    } else {
        const created = await prisma.prompts.create({
            data: {
                name: 'documentMain_system',
                title: '文书生成主Agent系统提示词 v6',
                content: DOCUMENT_MAIN_PROMPT_V6,
                variables: ['templateName', 'templateCategory'],
                version: 'v6',
                type: 'system',
                status: 1,
                nodeId: documentMain.id,
            },
        })
        console.log(`[ok] 新增 documentMain_system v6（id=${created.id}）`)
    }

    // 2. v5 → status=0（幂等）
    const v5Count = await prisma.prompts.updateMany({
        where: { name: 'documentMain_system', version: 'v2', nodeId: documentMain.id, status: 1 },
        data: { status: 0, updatedAt: new Date() },
    })
    if (v5Count.count > 0) {
        console.log(`[ok] documentMain_system v5（DB version 字段='v2'）status → 0（下线旧版本）`)
    } else {
        console.log(`[noop] documentMain_system v5 已是 status=0 或不存在`)
    }

    console.log('===== 阶段 7 · 完成 =====')
}

main()
    .catch((err) => {
        console.error('阶段 7 升级脚本失败：', err)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
```

> **注意**：DB 里 documentMain_system v5 的 `version` 字段值是字符串 `'v2'`（看 seedData.sql `id=20` 的 INSERT），不是字面 `'v5'`。脚本里 `where.version: 'v2'` 是为了匹配那条记录。"v5" 是 title 里的版本号，与 DB 的 version 字段独立。

### Step 2: 同步 seedData.sql（让 db:setup 也能拿到 v6）

- [ ] **打开 `prisma/seeds/seedData.sql`，定位 id=20 的 documentMain_system 那行 INSERT。**

精确替换：把 `'v2', 'system', 1, 17` 改成 `'v2', 'system', 0, 17`（status 1→0，下线旧版本）。

定位标记字符串：`'documentMain_system', '文书生成主Agent系统提示词 v5'`

完整原行（约 3055 行）末尾：
```
... 'v2', 'system', 1, 17, '2026-04-18 01:18:11.463+08', '2026-04-20 18:57:05.912258+08', NULL);
```

改为：
```
... 'v2', 'system', 0, 17, '2026-04-18 01:18:11.463+08', '2026-04-20 18:57:05.912258+08', NULL);
```

紧接着在该 INSERT 之后追加一行新 INSERT（v6）。

注：因 v6 的 content 含大量换行，必须用 `E'...'` 转义字符串（与 v5 保持一致）。具体内容由实施者把上面 stage7 脚本里的 `DOCUMENT_MAIN_PROMPT_V6` 字符串字面量原样转写到 SQL 里（换行用 `\n`、单引号双写为 `''`）。

> **执行提示**：可以在跑完 stage7 脚本后，用 `pg_dump --table=public.prompts --data-only --column-inserts -t prompts ls_new` 把 v6 那一行 INSERT 抓出来贴到 seedData.sql。这样**避免手工转义**且与脚本输出位字节一致。

### Step 3: 把脚本应用到 dev + test 两套库

- [ ] **跑两次（仅 DATABASE_URL 不同）：**

```bash
# 1) 本地开发库（默认 .env 里的 DATABASE_URL）
bun run scripts/stage7-fix-document-main-prompt.ts

# 2) 测试模板库（worker DB 都是它的拷贝，必须同步）
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing?schema=public&TimeZone=UTC' bun run scripts/stage7-fix-document-main-prompt.ts
```

每次都应输出：
```
[ok] 新增 documentMain_system v6（id=...）
[ok] documentMain_system v5（DB version 字段='v2'）status → 0
```

### Step 4: 用 SQL 验证 v6 已生效 + db:setup 等价性自检

- [ ] **(a) 执行验证 SQL（dev 库）：**

```bash
# 容器名先用 docker ps 确认（项目可能是 postgres-postgres-1 / lexseek-postgres-1 等）
PG_CTN=$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)
docker exec "$PG_CTN" psql -U daixin -d ls_new -c "
SELECT version, status, length(content) AS prompt_len
FROM prompts WHERE name='documentMain_system' AND deleted_at IS NULL
ORDER BY id;
"
```

预期：v6 status=1 / 上一版 status=0、prompt_len 约 1500-2000 字节。

- [ ] **(b) seedData.sql 等价性自检（防止 db:setup 重建丢失 v6）：**

```bash
# 用 ls_new_testing_check 重跑 db:setup，看 v6 是否能从 seedData.sql 还原
docker exec "$PG_CTN" psql -U daixin -d postgres -c "DROP DATABASE IF EXISTS ls_new_testing_check; CREATE DATABASE ls_new_testing_check"
DATABASE_URL='postgresql://daixin:daixin88@localhost:5432/ls_new_testing_check?schema=public&TimeZone=UTC' bun run db:setup
docker exec "$PG_CTN" psql -U daixin -d ls_new_testing_check -c "
SELECT version, status FROM prompts WHERE name='documentMain_system' AND deleted_at IS NULL ORDER BY id;
"
docker exec "$PG_CTN" psql -U daixin -d postgres -c "DROP DATABASE ls_new_testing_check"
```

预期 SELECT 结果与上面 dev 库一致（v6 status=1）。如果 seedData.sql 漏写 v6 INSERT，这一步会暴露。

### Step 5: Commit

- [ ] **commit：**

```bash
git add scripts/stage7-fix-document-main-prompt.ts prisma/seeds/seedData.sql
git commit -m "$(cat <<'EOF'
feat(workflow): documentMain prompt v6 — 优先使用已注入上下文填字段

工作流第一步从"先调 search_case_materials"改为"先扫案件档案 + 材料段
直接填能填的字段，不确定的再多轮精准检索"。配合方案 A 中间件挂载，
解决小索→文书生成 因 AI 不会用已注入材料导致字段全 null 的问题。

stage7 脚本幂等升级 DB；seedData.sql 同步保证 db:setup 不回退。
EOF
)"
```

---

## Task 3: 全套关键测试 + 类型检查（A+B 集成验证）

### Step 1: 跑核心相关测试

- [ ] **核心改动只触及 documentMainAgent.ts，先跑直接相关的单测：**

```bash
npx vitest run tests/server/workflow/agents/documentMainAgent.test.ts --reporter=verbose
```

预期：4 条用例全 PASS。

旁路单测（draftDocument tool / draftResultPersistence / DraftDocumentCard）本次未改源码，留给最终全量回归即可，不在本 plan 强制单跑。

### Step 2: 类型检查

- [ ] **跑类型检查：**

```bash
bun run typecheck
```

预期：0 错误（如有相关 ts 报错先修）。

### Step 3: 端到端冒烟（手动）

- [ ] **启动 dev server 并验证小索文书生成：**

```bash
bun dev  # 后台运行
```

操作：
1. 浏览器登录账号、进入一个**已有材料**的案件
2. 在小索里说"帮我起草起诉状"
3. 选模板提交
4. 观察草稿页右上角"已自动填写 X/Y 个字段"——X 应当 > 0

> **完成后立即** `kill -9 <dev_pid>` 释放端口（按用户偏好规则）。

---

## Self-Review

**1. Spec coverage：**
- 方案 A（挂中间件）—— Task 1 全 7 步：已覆盖
- 方案 B（升级 prompt）—— Task 2 全 5 步：已覆盖
- 集成验证 —— Task 3 全 3 步：已覆盖
- 不动现有 caseMaterialContextMiddleware 实现（已通过 re-export 跨 vertical 复用）：已覆盖
- 独立文书草稿（caseId=null）场景跳过中间件，与 afterAgentMemoryMiddleware 一致策略：已覆盖
- 显式说明不挂 caseProcessMaterialMiddleware 的理由（避免后续复盘）：已覆盖

**2. Placeholder 检查：** 无 TBD / TODO / "类似 Task N" / "添加适当错误处理"等占位符。所有代码块都是完整可执行内容。

**3. 类型一致性：**
- `MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT = 30`（已核 types.ts 行 41）
- `MIDDLEWARE_NAMES.MATERIAL_CONTEXT = 'caseMaterialContext'`（已核 types.ts 行 65）
- `caseMaterialContextMiddleware(userId, caseId)` 签名（已核 caseMaterialContext.middleware.ts 行 9）
- documentMainAgent.ts 现有 `resolvedCaseId` 变量名沿用（已核行 153）
- DB prompts 表 `version` 字段用字符串 `'v2'`（已核 seedData.sql 行 3055）；脚本里已注释说明 title v5 vs version v2 的差异

**4. 已知不确定项：**
- 容器名通过 `docker ps --format '{{.Names}}' | grep -i postgres | head -1` 自动取，无需硬编码。
- seedData.sql v6 INSERT 行的"具体 SQL 文本"由实施者从 `pg_dump` 抽取以避免手工转义错误。已在 Task 2 Step 2 注明。

**5. 5check 修订记录：**
- 删除 Task 1 原 Step 3"运行测试确认 RED"（仪式步骤）；改 Step 5 一次性 GREEN 验证
- 测试断言用 `MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT` 常量替换硬编码 30
- mock 改为包装 actual.buildMiddlewareStack（保留互斥校验）
- 合并 Task 2 原 Step 3+4（dev / test 库脚本调用）
- 删除 Task 3 原 Step 2（不存在的回归测试文件）+ Step 5（可选 commit 分支）
- Task 2 加 db:setup 等价性自检步骤（防止 seedData 漏写）
- 移除原 Self-Review 段的 5 处 emoji（项目铁律：UI/文档严禁 emoji）
- 显式记载 caseProcessMaterialMiddleware 不挂的理由（维度 1 审查反馈）

---

## Execution Handoff

Plan 已保存到 `docs/superpowers/plans/2026-04-29-document-draft-fields-fix.md`。

由于这是局部修复（2 个文件改 + 1 个新脚本 + 1 个 SQL 同步），任务粒度小且强依赖（A 和 B 必须一起部署才有完整效果），推荐 **inline execution**（在当前 session 顺序执行）。

按 `superpowers:executing-plans` 流程：Task 1 → Task 2 → Task 3 → 总验证。
