# 通用法律助手 · 第一期实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上线"通用法律助手 · 对话"页面，支持无 case 会话的持久化对话、积分门控、会话列表管理；不包含合同审查/文书生成（第二、三期）。

**Architecture:** 放宽 `caseSessions.caseId` / `agentRuns.caseId` 为可空，新增 `scope` 字段；新增 `assistantMain` 节点与对应 `assistantAgent`（对照 `caseMainAgent`，去除 case 相关中间件）；agentWorker 按 `session.scope` 分流；前端新增 `/dashboard/assistant/chat` 页，复用 `<AiChat>` 组件 + `useStreamChat` 基础设施。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Prisma + PostgreSQL + LangGraph + LangChain `createAgent`。测试使用 Vitest（`npx vitest run`）。包管理 bun。

**Spec reference:** `docs/superpowers/specs/2026-04-17-legal-assistant-design.md` §9.1（本计划严格遵循此章节）。

---

## 文件结构

### 新增文件
```
server/
├── services/
│   ├── assistant/
│   │   ├── assistantSession.dao.ts         # 仅操作 case_sessions(scope=assistant)，Zod 校验
│   │   ├── assistantSession.service.ts     # 会话 CRUD / 标题生成封装
│   │   ├── types.ts                        # 内部类型
│   │   └── index.ts
│   └── workflow/
│       └── agents/
│           └── assistantAgent.ts           # runAssistantChat / getAssistantThreadState
├── api/v1/assistant/
│   ├── sessions.get.ts                     # 会话列表（分页）
│   ├── sessions.post.ts                    # 新建会话
│   ├── sessions/[id].get.ts                # 获取单个会话（含消息历史）
│   ├── sessions/[id].patch.ts              # 重命名
│   ├── sessions/[id].delete.ts             # 软删
│   ├── chat.post.ts                        # 发消息（SSE，6 分支）
│   └── runs/cancel/[runId].post.ts         # 取消运行
prisma/
└── seed.ts                                 # 新增 assistantMain node + prompt v1 + assistant_token 规则
app/
├── pages/dashboard/assistant/
│   ├── chat.vue                            # 对话页
│   ├── contract.vue                        # WIP 占位页
│   └── document.vue                        # WIP 占位页
├── components/assistant/
│   └── AssistantSessionList.vue            # 会话列表侧栏
└── composables/
    └── useAssistantChat.ts                 # 对话 composable
shared/types/
└── assistant.ts                            # AssistantSession / 列表响应类型

tests/
├── server/assistant/
│   ├── assistantSession.dao.test.ts
│   ├── assistantSession.service.test.ts
│   ├── assistantAgent.integration.test.ts
│   └── chat.post.integration.test.ts
├── server/case/
│   ├── session.dao.gap.test.ts             # findSessionWithOwnershipCheck 回退测试
│   └── case.dao.gap.test.ts                # findCaseBySessionIdDao 守卫测试
└── server/agent/
    ├── agentRun.dao.test.ts                # caseId null 允许写入
    └── agentWorker.test.ts                 # scope 分流 + 数据异常抛错
```

### 修改文件
```
prisma/models/case.prisma                                # caseSessions 模型
prisma/models/agentRun.prisma                            # agentRuns 模型
server/services/case/session.dao.ts                      # findSessionWithOwnershipCheck
server/services/case/case.dao.ts                         # findCaseBySessionIdDao
server/api/v1/case/analysis/xiaosuo-session/[sessionId].delete.ts  # null 守卫
server/services/agent/agentRun.service.ts                # EnqueueRunParams.caseId -> number | null
server/services/agent/agentRun.dao.ts                    # CreateAgentRunParams.caseId -> number | null
server/services/agent/agentWorker.ts                     # select 扩展 + scope 分流
app/components/dashboard/navMain.vue                     # 侧边栏菜单注册（如需）或在 RBAC 路由表
```

---

## Task 1: Prisma schema 变更与 migration

**Files:**
- Modify: `prisma/models/case.prisma` (caseSessions 模型)
- Modify: `prisma/models/agentRun.prisma` (agentRuns 模型)
- Generate: `prisma/migrations/<timestamp>_add_assistant_scope_to_sessions_and_runs/migration.sql`

**参考规范：** spec §4.2, §4.3, §4.11.5

- [ ] **Step 1: 修改 `prisma/models/case.prisma` 的 caseSessions 模型**

把 `caseSessions` 模型完全替换为：

```prisma
/// 案件会话表 - 存储案件分析的会话上下文，对应 LangGraph 的 thread_id
/// 通过 scope 字段扩展为双域：case（案件内）与 assistant（通用法律助手）
model caseSessions {
    /// 会话ID，主键，自增
    id        Int       @id @default(autoincrement())
    /// 会话唯一标识，对应 LangGraph thread_id
    sessionId String    @unique @map("session_id") @db.VarChar(100)
    /// 会话归属域：case（案件内）/ assistant（通用法律助手）
    scope     String    @default("case") @db.VarChar(20)
    /// 会话所有者用户ID
    /// - scope=assistant：必须存在（应用层校验）
    /// - scope=case：冗余字段，便于列表按用户查询（存量可为 NULL，鉴权回退到 case.userId）
    userId    Int?      @map("user_id")
    /// 关联的案件ID
    /// - scope=case：必须存在（应用层校验）
    /// - scope=assistant：必须为 NULL
    caseId    Int?      @map("case_id")
    /// 会话状态：1-进行中，2-已完成，3-已中断，4-已失败
    status    Int       @default(1)
    /// 会话类型：1-普通对话，2-初始化分析（仅 case 域使用）
    type      Int       @default(1)
    /// 会话标题（assistant 场景由首条消息自动生成，用户可重命名）
    title     String?   @db.VarChar(200)
    /// 会话元数据（JSON），type=2 时存储 { selectedModules: string[] } 等
    metadata  Json?     @db.JsonB
    /// 创建时间
    createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
    /// 最后更新时间
    updatedAt DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
    /// 删除时间，为 NULL 表示未删除
    deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)

    /// 关联的案件（scope=assistant 时为 null）
    case cases? @relation(fields: [caseId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    /// 关联的用户（scope=assistant 必存在；scope=case 存量可为 null）
    user users? @relation(fields: [userId], references: [id], onDelete: NoAction, onUpdate: NoAction)

    /// 关联的案件分析结果
    caseAnalyses caseAnalyses[]

    @@index([userId, scope, deletedAt], map: "idx_case_sessions_user_scope")
    @@index([caseId], map: "idx_case_sessions_case_id")
    @@index([scope, status], map: "idx_case_sessions_scope_status")
    @@index([type], map: "idx_case_sessions_type")
    @@index([deletedAt], map: "idx_case_sessions_deleted_at")
    @@map("case_sessions")
}
```

- [ ] **Step 2: 为 `users` 模型补一条反向关系（如不存在）**

在 `prisma/models/user.prisma` 的 `users` 模型中新增：

```prisma
    /// 关联的会话（case 域 + assistant 域）
    caseSessions caseSessions[]
```

- [ ] **Step 3: 修改 `prisma/models/agentRun.prisma`**

把 `caseId` 行改成：

```prisma
    /// 关联的案件ID（关联 session 的 scope=assistant 时为空）
    caseId      Int?      @map("case_id")
```

其余字段不变。

- [ ] **Step 4: 运行 prisma generate 预检查**

Run: `bun run prisma:generate`
Expected: 生成成功，无 schema 错误。若报错先修正 schema。

- [ ] **Step 5: 预览 SQL 确认仅生成 ALTER**

Run: `bun prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`

（或手动 diff 当前 DB 与 schema）
Expected: 输出包含:
- `ALTER TABLE "case_sessions" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'case'`
- `ALTER TABLE "case_sessions" ADD COLUMN "user_id" INTEGER`
- `ALTER TABLE "case_sessions" ADD COLUMN "title" VARCHAR(200)`
- `ALTER TABLE "case_sessions" ALTER COLUMN "case_id" DROP NOT NULL`
- `ALTER TABLE "agent_runs" ALTER COLUMN "case_id" DROP NOT NULL`
- 相应 CREATE INDEX 语句

若输出包含 `DROP TABLE` 或 `DROP COLUMN` 立即停止并排查。

- [ ] **Step 6: 执行 migration**

Run: `bun run prisma:migrate dev --name add_assistant_scope_to_sessions_and_runs`
Expected: 生成 migration 文件并应用成功。

- [ ] **Step 7: 提交 schema + migration**

```bash
git add prisma/models/case.prisma prisma/models/agentRun.prisma prisma/models/user.prisma prisma/migrations/*_add_assistant_scope_to_sessions_and_runs
git commit -m "feat(db): 扩展 case_sessions 支持 assistant scope + 放宽 agent_runs.case_id

- case_sessions 新增 scope/user_id/title 字段与索引
- case_sessions.case_id 和 agent_runs.case_id 改为可空
- 用于支撑通用法律助手的无 case 会话（spec §4.2/§4.3）"
```

---

## Task 2: Seed 基础数据（assistantMain 节点 + 提示词 + 积分规则）

**Files:**
- Modify or Create: `prisma/seed.ts`
- Reference: spec §4.4, §4.11.4, §5.4

- [ ] **Step 1: 先阅读现有 `prisma/seed.ts`（如存在）了解 seed 结构**

Run: `ls -la /Users/daixin/work/dev/LexSeek/LexSeek/prisma/seed.ts && cat /Users/daixin/work/dev/LexSeek/LexSeek/prisma/seed.ts | head -80`

了解：
- seed 是否幂等（用 upsert 还是 skipDuplicates）
- 现有 nodes seed 的 modelId 来源
- 是否有 `pointConsumptionRules` 的 seed 风格参考

如果 `prisma/seed.ts` 不存在或不完整，创建一个最小可用版本。

- [ ] **Step 2: 新增 assistantMain 节点 seed 函数**

在 `prisma/seed.ts` 中加入：

```typescript
async function seedAssistantMainNode(prisma: PrismaClient) {
  // 1. 找一个可用 model（默认用 caseMain 同一个 modelId 以降成本）
  const caseMain = await prisma.nodes.findUnique({ where: { name: 'caseMain' } })
  if (!caseMain) throw new Error('caseMain 节点不存在，请先运行主 seed')

  // 2. upsert assistantMain 节点
  const node = await prisma.nodes.upsert({
    where: { name: 'assistantMain' },
    update: {},  // 不覆盖已有配置（运营可能已调整 modelId/tools）
    create: {
      name: 'assistantMain',
      title: '通用法律助手主Agent',
      description: '无案件上下文的法律问答与工具调用',
      type: 'agent',
      priority: 10,
      modelId: caseMain.modelId,
      tools: ['searchLaw'],  // 第一期工具，第二期追加 reviewContract / draftDocument
      status: 1,
    },
  })

  // 3. upsert 系统提示词 v1
  const systemPromptContent = `你是 LexSeek 的通用法律助手，服务于中国大陆法律场景下的律师、法务与普通用户。

# 能力边界
- 你可以回答法律知识问题、提供文书起草思路、做合同基础分析。
- 你可以调用 searchLaw 工具检索最新法条。
- 你【不】拥有任何案件上下文；如果用户提到"我的案件"但没有贴出详情，主动请用户提供关键信息。
- 对于需要严谨尽职调查的任务（完整合同审查、正式文书生成），提示用户切换到
  「合同审查」「文书生成」专用入口，那里有专用工具与流程。

# 输出要求
- 准确、中立、使用法律术语，避免情绪化用语与感叹号。
- 引用法条时标注名称与条号（如《民法典》第 509 条）。
- 涉及不确定事实时主动说明前提假设。
- 默认使用简体中文。
- 所有涉及日期、金额、主体名称的内容，必须明确来源（来自用户输入 / 法条 / 工具返回）。

# 不做的事
- 不替用户做最终法律决定，只提供分析与建议。
- 不编造案例编号、当事人姓名、未经检索的法条内容。
- 不讨论与法律无关的话题（礼貌拒绝并引导回法律咨询）。`

  const existing = await prisma.prompts.findFirst({
    where: { nodeId: node.id, type: 'system', version: 'v1' },
  })
  if (!existing) {
    await prisma.prompts.create({
      data: {
        name: 'assistantMain_system',
        title: '通用法律助手系统提示词 v1',
        content: systemPromptContent,
        variables: [],
        version: 'v1',
        type: 'system',
        status: 1,
        nodeId: node.id,
      },
    })
  }

  console.log('[seed] assistantMain 节点 + 提示词 v1 完成')
}
```

- [ ] **Step 3: 新增 `assistant_token` 积分规则 seed**

先用 Grep 找到现有 `pointConsumptionRules` 或类似表的 seed 风格：

Run: `grep -rn "pointConsumption\|point_consumption" /Users/daixin/work/dev/LexSeek/LexSeek/server/services/point/ | head -10`

找到现有 item 表名与字段（可能是 `consumptionItems`/`pointConsumptionRules`/`pointRules`），然后按同样的风格 upsert：

```typescript
async function seedAssistantTokenRule(prisma: PrismaClient) {
  // 以实际表名替换 <ITEM_TABLE>；默认单价 1 积分 / 1000 tokens（可由运营调整）
  // 如果已有 case_analysis_token 行，参照其字段结构
  const reference = await prisma.pointConsumptionRules.findFirst({
    where: { itemKey: 'case_analysis_token' },
  })

  await prisma.pointConsumptionRules.upsert({
    where: { itemKey: 'assistant_token' },
    update: {},  // 不覆盖运营已设置的单价
    create: reference
      ? { ...reference, id: undefined, itemKey: 'assistant_token', itemName: '通用法律助手 token 计费' }
      : {
          itemKey: 'assistant_token',
          itemName: '通用法律助手 token 计费',
          // 其余字段按实际表结构填写（单价、计量单位等，由第一步 grep 的参考行推断）
          status: 1,
        },
  })
  console.log('[seed] assistant_token 规则完成')
}
```

**重要**：若实际表名不是 `pointConsumptionRules`，以项目中的真实模型名为准。

- [ ] **Step 4: 在 main seed 中调用**

在 seed.ts 的 main 函数末尾加：

```typescript
await seedAssistantMainNode(prisma)
await seedAssistantTokenRule(prisma)
```

- [ ] **Step 5: 运行 seed**

Run: `bun prisma db seed`
Expected: 控制台看到 `[seed] assistantMain 节点 + 提示词 v1 完成` 和 `[seed] assistant_token 规则完成`。

- [ ] **Step 6: 验证 DB**

Run:
```bash
psql $DATABASE_URL -c "SELECT name, type, tools FROM nodes WHERE name='assistantMain';"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM prompts WHERE name='assistantMain_system' AND status=1;"
psql $DATABASE_URL -c "SELECT item_key FROM point_consumption_rules WHERE item_key='assistant_token';"
```
Expected: 三条查询都返回 1 行。

- [ ] **Step 7: 提交**

```bash
git add prisma/seed.ts
git commit -m "feat(db): seed assistantMain 节点与 assistant_token 积分规则

- 新增 assistantMain Agent 节点（复用 caseMain 同模型）
- 新增系统提示词 v1（assistantMain_system）
- 新增 assistant_token 计费规则（单价由运营后续调整）
- seed 使用 upsert，可幂等重入"
```

---

## Task 3: 改造 `session.dao.ts:findSessionWithOwnershipCheck`（TDD）

**Files:**
- Modify: `server/services/case/session.dao.ts:152-159`
- Test: `tests/server/case/session.dao.gap.test.ts` (已存在，追加 case)

**参考规范：** spec §4.11.1

- [ ] **Step 1: 先读现有测试文件 + DAO 实现**

Run:
```bash
cat /Users/daixin/work/dev/LexSeek/LexSeek/tests/server/case/session.dao.gap.test.ts
sed -n '140,200p' /Users/daixin/work/dev/LexSeek/LexSeek/server/services/case/session.dao.ts
```

了解现有测试结构与 DAO 签名。

- [ ] **Step 2: 写失败测试 - assistant 域 session 鉴权**

在 `tests/server/case/session.dao.gap.test.ts` 中追加：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
// ... 其余现有 import

describe('findSessionWithOwnershipCheck - assistant scope', () => {
  it('scope=assistant 时应通过 session.userId 鉴权（session.case 为 null）', async () => {
    const user = await createTestUser()
    const sessionId = `assist-${Date.now()}-${Math.random()}`
    await prisma.caseSessions.create({
      data: {
        sessionId,
        scope: 'assistant',
        userId: user.id,
        caseId: null,
        type: 1,
      },
    })
    // 直接调用内部函数要把它导出为 test-only；若已走其他公共 DAO 调用链也可测外壳
    const result = await softDeleteSessionDAO({
      sessionId,
      userId: user.id,
      allowedTypes: [1],
    })
    expect(result.success).toBe(true)
  })

  it('scope=assistant 时对他人 userId 拒绝', async () => {
    const owner = await createTestUser()
    const intruder = await createTestUser()
    const sessionId = `assist-${Date.now()}-${Math.random()}`
    await prisma.caseSessions.create({
      data: { sessionId, scope: 'assistant', userId: owner.id, caseId: null, type: 1 },
    })
    const result = await softDeleteSessionDAO({
      sessionId,
      userId: intruder.id,
      allowedTypes: [1],
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/无权/)
  })

  it('scope=case 存量 userId=null 时通过 case.userId 回退鉴权', async () => {
    const user = await createTestUser()
    const caseRow = await createTestCase(user.id)
    const sessionId = `case-${Date.now()}-${Math.random()}`
    await prisma.caseSessions.create({
      data: {
        sessionId,
        scope: 'case',
        userId: null,  // 存量数据模拟
        caseId: caseRow.id,
        type: 1,
      },
    })
    const result = await softDeleteSessionDAO({
      sessionId,
      userId: user.id,
      allowedTypes: [1],
    })
    expect(result.success).toBe(true)
  })
})
```

（若 `createTestUser` / `createTestCase` 已在 `tests/server/case/test-db-helper.ts` 中存在则直接用，否则在 helper 中加）

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/server/case/session.dao.gap.test.ts -t "assistant scope" --reporter=verbose`
Expected: 三条用例 FAIL（现有 `findSessionWithOwnershipCheck` 遇到 `session.case === null` 会 NPE）。

- [ ] **Step 4: 修改 `findSessionWithOwnershipCheck`**

替换 `server/services/case/session.dao.ts:152-159` 为：

```typescript
/**
 * 查找未删除的 session 并校验权限（内部公共逻辑）。
 *
 * 兼容 scope=case（存量 userId 可能为 NULL，回退 session.case.userId）
 * 与 scope=assistant（session.case 为 null，只能用 session.userId）。
 */
async function findSessionWithOwnershipCheck(sessionId: string, userId: number) {
    const session = await prisma.caseSessions.findFirst({
        where: { sessionId, deletedAt: null },
        include: { case: { select: { userId: true } } },
    })
    if (!session) return { session: null, error: 'Session 不存在' as const }

    const ownerId = session.userId ?? session.case?.userId
    if (ownerId == null || ownerId !== userId) {
        return { session: null, error: '无权操作该 Session' as const }
    }
    return { session, error: null }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/server/case/session.dao.gap.test.ts -t "assistant scope" --reporter=verbose`
Expected: PASS × 3

- [ ] **Step 6: 跑该文件全量回归**

Run: `npx vitest run tests/server/case/session.dao.gap.test.ts --reporter=verbose`
Expected: 全部 PASS（现有 case 域测试不受影响）

- [ ] **Step 7: 提交**

```bash
git add tests/server/case/session.dao.gap.test.ts server/services/case/session.dao.ts
git commit -m "fix(session): findSessionWithOwnershipCheck 支持 assistant scope

- 新增 session.userId 优先、session.case.userId 回退的鉴权路径
- 覆盖 scope=assistant（case 为 null）与 scope=case 存量 userId=null 两种场景
- 参见 spec §4.11.1"
```

---

## Task 4: 改造 `findCaseBySessionIdDao` + xiaosuo delete null 守卫（TDD）

**Files:**
- Modify: `server/services/case/case.dao.ts` (findCaseBySessionIdDao)
- Modify: `server/api/v1/case/analysis/xiaosuo-session/[sessionId].delete.ts`
- Test: `tests/server/case/case.dao.gap.test.ts`（已存在）

**参考规范：** spec §4.11.1

- [ ] **Step 1: 定位现有代码**

Run:
```bash
grep -n "findCaseBySessionIdDao\|session\.case\." /Users/daixin/work/dev/LexSeek/LexSeek/server/services/case/case.dao.ts
cat /Users/daixin/work/dev/LexSeek/LexSeek/server/api/v1/case/analysis/xiaosuo-session/\[sessionId\].delete.ts
```

- [ ] **Step 2: 全项目穷举 `session.case.` 访问点**

Run: `grep -rn "session\.case\." server/ app/ tests/ 2>/dev/null`

**对每个访问点做判断**：是否在 `session.case` 可能为 null 的代码路径上？若是，加入修改清单。本 Task 处理 `case.dao.ts` + `xiaosuo-session.delete.ts` 两个已知点；若 grep 发现新的访问点，在本 Task 一并处理。

- [ ] **Step 3: 写失败测试 - `findCaseBySessionIdDao` 遇到 assistant session**

在 `tests/server/case/case.dao.gap.test.ts` 追加：

```typescript
describe('findCaseBySessionIdDao - assistant session', () => {
  it('遇到 scope=assistant session（session.case 为 null）应返回 null 而非崩溃', async () => {
    const user = await createTestUser()
    const sessionId = `assist-${Date.now()}-${Math.random()}`
    await prisma.caseSessions.create({
      data: { sessionId, scope: 'assistant', userId: user.id, caseId: null, type: 1 },
    })
    const result = await findCaseBySessionIdDao(sessionId)
    expect(result).toBeNull()
  })

  it('case 域正常 session 应正常返回 case', async () => {
    const user = await createTestUser()
    const caseRow = await createTestCase(user.id)
    const sessionId = `case-${Date.now()}-${Math.random()}`
    await prisma.caseSessions.create({
      data: { sessionId, scope: 'case', userId: user.id, caseId: caseRow.id, type: 1 },
    })
    const result = await findCaseBySessionIdDao(sessionId)
    expect(result?.id).toBe(caseRow.id)
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run tests/server/case/case.dao.gap.test.ts -t "assistant session" --reporter=verbose`
Expected: FAIL（访问 `session.case.deletedAt` 时 NPE）

- [ ] **Step 5: 修改 `findCaseBySessionIdDao`**

找到 `server/services/case/case.dao.ts` 中的 `findCaseBySessionIdDao` 实现，核心语句从：

```typescript
if (!session || session.case.deletedAt) return null
return session.case
```

改为：

```typescript
if (!session || !session.case || session.case.deletedAt) return null
return session.case
```

- [ ] **Step 6: 修改 `xiaosuo-session/[sessionId].delete.ts`**

在现有鉴权代码前加 null 守卫：

```typescript
// 小索子会话只存在于 case 域
if (!session.case) {
  return resError(event, 404, 'session 不存在或不属于案件域')
}
// 保留原鉴权
if (session.case.userId !== user.id) {
  return resError(event, 403, '无权操作')
}
```

- [ ] **Step 7: 处理 Step 2 grep 发现的其他 `session.case.` 访问点**

对每个访问点按照同样的 null-safe 模式改造。若调用方在 assistant scope 下本就不该被调到，加显式 `scope !== 'case'` 早返回或抛错。

- [ ] **Step 8: TypeScript 编译检查**

Run: `npx nuxi typecheck`
Expected: 无类型错误。若仍有 `session.case` 相关 TS 错误，按提示补 null 检查。

- [ ] **Step 9: 运行测试**

Run: `npx vitest run tests/server/case/case.dao.gap.test.ts --reporter=verbose`
Expected: 所有 case.dao 测试 PASS

- [ ] **Step 10: 提交**

```bash
git add tests/server/case/case.dao.gap.test.ts server/services/case/case.dao.ts server/api/v1/case/analysis/xiaosuo-session/\[sessionId\].delete.ts
git commit -m "fix(case): 兼容 assistant scope session 的 null case 关系

- findCaseBySessionIdDao 遇到 scope=assistant session 返回 null 不崩
- xiaosuo-session delete 加 session.case null 守卫
- 同步修正 grep 穷举发现的其他访问点
- 参见 spec §4.11.1"
```

---

## Task 5: agentRun DAO/Service caseId 签名放宽（TDD）

**Files:**
- Modify: `server/services/agent/agentRun.service.ts` (EnqueueRunParams)
- Modify: `server/services/agent/agentRun.dao.ts` (CreateAgentRunParams + createAgentRunDAO)
- Test: `tests/server/agent/agentRun.dao.test.ts`（新建或扩展）

**参考规范：** spec §4.11.3

- [ ] **Step 1: 先读现有实现**

Run:
```bash
sed -n '1,70p' /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent/agentRun.dao.ts
sed -n '10,60p' /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent/agentRun.service.ts
```

- [ ] **Step 2: 写失败测试 - `createAgentRunDAO` 接受 null caseId**

在 `tests/server/agent/agentRun.dao.test.ts` 新建：

```typescript
import { describe, it, expect } from 'vitest'
import { createAgentRunDAO } from '~~/server/services/agent/agentRun.dao'

describe('createAgentRunDAO - caseId null 支持', () => {
  it('caseId=null 时应正常写入（assistant 域场景）', async () => {
    const user = await createTestUser()
    const sessionId = `assist-${Date.now()}-${Math.random()}`
    await prisma.caseSessions.create({
      data: { sessionId, scope: 'assistant', userId: user.id, caseId: null, type: 1 },
    })
    const run = await createAgentRunDAO({
      sessionId,
      threadId: sessionId,
      userId: user.id,
      caseId: null,
      input: { message: 'hello' },
    })
    expect(run.caseId).toBeNull()
    expect(run.sessionId).toBe(sessionId)
  })

  it('caseId=数字时保持兼容 case 域', async () => {
    const user = await createTestUser()
    const caseRow = await createTestCase(user.id)
    const sessionId = `case-${Date.now()}-${Math.random()}`
    await prisma.caseSessions.create({
      data: { sessionId, scope: 'case', userId: user.id, caseId: caseRow.id, type: 1 },
    })
    const run = await createAgentRunDAO({
      sessionId,
      threadId: sessionId,
      userId: user.id,
      caseId: caseRow.id,
      input: { message: 'hi' },
    })
    expect(run.caseId).toBe(caseRow.id)
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/server/agent/agentRun.dao.test.ts --reporter=verbose`
Expected: FAIL（TS 编译错误：`caseId: null` 不匹配 `caseId: number`）

- [ ] **Step 4: 修改 `agentRun.dao.ts` 的 `CreateAgentRunParams`**

替换：
```typescript
export interface CreateAgentRunParams {
  sessionId: string
  threadId: string
  userId: number
  caseId: number
  input: AgentRunInput
}
```
为：
```typescript
export interface CreateAgentRunParams {
  sessionId: string
  threadId: string
  userId: number
  /** 关联案件 ID；scope=assistant 时传 null */
  caseId: number | null
  input: AgentRunInput
}
```

`createAgentRunDAO` 内的 Prisma create data 无需改动（Prisma 对可空列接受 null）。

- [ ] **Step 5: 修改 `agentRun.service.ts` 的 `EnqueueRunParams`**

同样把 `caseId: number` 改为 `caseId: number | null`。

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/server/agent/agentRun.dao.test.ts --reporter=verbose`
Expected: PASS × 2

- [ ] **Step 7: 跑 agent 全量回归**

Run: `npx vitest run tests/server/agent --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 8: TypeScript 编译**

Run: `npx nuxi typecheck`
Expected: 无错误（现有 case 域调用点传 `caseId: number` 兼容 `number | null`）

- [ ] **Step 9: 提交**

```bash
git add tests/server/agent/agentRun.dao.test.ts server/services/agent/agentRun.dao.ts server/services/agent/agentRun.service.ts
git commit -m "feat(agent): 放宽 agentRuns 入队签名支持 null caseId

- CreateAgentRunParams.caseId / EnqueueRunParams.caseId 改为 number | null
- 兼容 assistant scope（无 case）与 case scope（有 case）两种入队
- 现有 case 域调用点类型自动兼容
- 参见 spec §4.11.3"
```

---

## Task 6: agentWorker 改造（TDD）

**Files:**
- Modify: `server/services/agent/agentWorker.ts` (executeRun 路由逻辑)
- Test: `tests/server/agent/agentWorker.test.ts`（新建或扩展）

**参考规范：** spec §5.2

- [ ] **Step 1: 读现有 executeRun 实现**

Run: `sed -n '100,200p' /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent/agentWorker.ts`

重点看 130-180 行左右的 session select + switch 路由。

- [ ] **Step 2: 写失败测试 - assistant scope 路由**

在 `tests/server/agent/agentWorker.test.ts` 新建或追加：

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('agentWorker.executeRun - scope 分流', () => {
  it('scope=assistant 时调用 runAssistantChat 而非 runCaseChat', async () => {
    const runAssistantChatSpy = vi.fn().mockResolvedValue(new ReadableStream())
    const runCaseChatSpy = vi.fn().mockResolvedValue(new ReadableStream())
    vi.doMock('~~/server/services/workflow/agents/assistantAgent', () => ({ runAssistantChat: runAssistantChatSpy }))
    vi.doMock('~~/server/services/workflow/agents/caseMainAgent', () => ({ runCaseChat: runCaseChatSpy }))

    // ... 准备 agentRuns 行 scope=assistant（通过 session join 间接拿到 scope）
    // ... 调用 executeRun 或其公开触发路径
    expect(runAssistantChatSpy).toHaveBeenCalled()
    expect(runCaseChatSpy).not.toHaveBeenCalled()
  })

  it('scope=assistant 但 session.userId=null 应抛明确错误', async () => {
    // 通过原生 SQL 造一条损坏数据（scope=assistant 但 userId=null）
    const sessionId = `broken-${Date.now()}`
    await prisma.$executeRaw`
      INSERT INTO case_sessions (session_id, scope, user_id, case_id, status, type, created_at, updated_at)
      VALUES (${sessionId}, 'assistant', NULL, NULL, 1, 1, NOW(), NOW())
    `
    // ... 触发 executeRun
    await expect(triggerExecuteRun(sessionId)).rejects.toThrow(/缺失 userId/)
  })

  it('scope=case 但 session.caseId=null 应抛明确错误', async () => {
    const sessionId = `broken-${Date.now()}`
    await prisma.$executeRaw`
      INSERT INTO case_sessions (session_id, scope, user_id, case_id, status, type, created_at, updated_at)
      VALUES (${sessionId}, 'case', NULL, NULL, 1, 1, NOW(), NOW())
    `
    await expect(triggerExecuteRun(sessionId)).rejects.toThrow(/缺失 caseId/)
  })
})
```

（`triggerExecuteRun` 由 test helper 提供；若 `executeRun` 是 class 私有，暴露 `@internal` 接口用于测试，或改测公共入口 `processPendingRuns`）

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/server/agent/agentWorker.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 4: 修改 `agentWorker.ts` 的 session select 字段**

找到 `server/services/agent/agentWorker.ts` 中的：
```typescript
const session = await prisma.caseSessions.findUnique({
    where: { sessionId: run.sessionId },
    select: { type: true, metadata: true },
})
```
改为：
```typescript
const session = await prisma.caseSessions.findUnique({
    where: { sessionId: run.sessionId },
    select: {
        scope: true,
        type: true,
        metadata: true,
        userId: true,
        caseId: true,
    },
})
```

- [ ] **Step 5: 修改 `agentWorker.ts` 的路由逻辑**

在原 `switch (session.type)` 之前插入 scope 分流：

```typescript
if (!session) {
    throw new Error(`session ${run.sessionId} not found`)
}

// === 新增：scope 分流 ===
if (session.scope === 'assistant') {
    if (session.userId == null) {
        throw new Error(
            `assistant session ${run.sessionId} 缺失 userId（数据损坏）`,
        )
    }
    return await runAssistantChat(run.sessionId, message, {
        userId: session.userId,
        command,
        signal,
        thinking,
    })
}

// === 原有 case 域分支：caseId 必须存在 ===
if (session.caseId == null) {
    throw new Error(
        `case session ${run.sessionId} 缺失 caseId（scope 与 caseId 不一致，数据损坏）`,
    )
}
const caseId = session.caseId  // TS 收窄为 number

// 保留原有 switch(session.type) 路由，但把所有 run.caseId / session.caseId!
// 替换为上面收窄后的 const caseId
```

**注意**：`runAssistantChat` 在 Task 8 实现后才能 import，此时可先 import 占位 stub；Task 8 完成后本 Task 再次运行测试确认通过。

- [ ] **Step 6: 添加占位 stub**

在 `server/services/workflow/agents/index.ts` 先 export 占位：
```typescript
export async function runAssistantChat(
    _sessionId: string,
    _message: string | undefined,
    _options: { userId: number; command?: unknown; signal?: AbortSignal; thinking?: boolean },
): Promise<ReadableStream<Uint8Array>> {
    throw new Error('runAssistantChat 尚未实现（将在 Task 8 完成）')
}
```

Task 8 完成后替换为真实实现。

- [ ] **Step 7: 运行"数据异常抛错"测试确认通过**

Run: `npx vitest run tests/server/agent/agentWorker.test.ts -t "数据损坏" --reporter=verbose`
Expected: PASS × 2

（assistant 路由测试会因 stub 抛错而 FAIL，这是预期；Task 8 完成后重新验证）

- [ ] **Step 8: 提交**

```bash
git add tests/server/agent/agentWorker.test.ts server/services/agent/agentWorker.ts server/services/workflow/agents/index.ts
git commit -m "feat(worker): agentWorker 按 scope 分流 + 数据异常显式抛错

- findUnique select 扩展为 scope/userId/caseId 字段（避免静默路由错误）
- scope=assistant 分流到 runAssistantChat（Task 8 实现）
- scope=case + caseId=null 或 scope=assistant + userId=null 抛明确错误
- 参见 spec §5.2"
```

---

## Task 7: 新增 `shared/types/assistant.ts` + `assistantSession.dao.ts`（TDD）

**Files:**
- Create: `shared/types/assistant.ts`
- Create: `server/services/assistant/assistantSession.dao.ts`
- Create: `server/services/assistant/types.ts`
- Create: `server/services/assistant/index.ts`
- Test: `tests/server/assistant/assistantSession.dao.test.ts`

**参考规范：** spec §4.10, §5.1, §5.6.1-3

- [ ] **Step 1: 创建 `shared/types/assistant.ts`**

```typescript
/**
 * 通用法律助手相关类型
 */

/** 会话归属域 */
export enum SessionScope {
  CASE = 'case',
  ASSISTANT = 'assistant',
}

/** 助手会话（前端列表展示用） */
export interface AssistantSession {
  sessionId: string
  title: string | null
  updatedAt: string  // ISO 字符串
  createdAt: string
}

/** 会话列表响应 */
export interface AssistantSessionListResponse {
  list: AssistantSession[]
  total: number
  page: number
  pageSize: number
}

/** 会话创建响应 */
export interface CreateAssistantSessionResponse {
  sessionId: string
  title: string | null
}
```

- [ ] **Step 2: 创建 `server/services/assistant/types.ts`**

```typescript
import { z } from 'zod'

export const CreateAssistantSessionSchema = z.object({
  userId: z.number().int().positive(),
  title: z.string().max(200).optional(),
})

export type CreateAssistantSessionInput = z.infer<typeof CreateAssistantSessionSchema>

export const UpdateAssistantSessionSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.number().int().positive(),
  title: z.string().min(1).max(200).optional(),
})

export type UpdateAssistantSessionInput = z.infer<typeof UpdateAssistantSessionSchema>

export const ListAssistantSessionsSchema = z.object({
  userId: z.number().int().positive(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
})
```

- [ ] **Step 3: 写失败测试 - 参数化 Zod 校验与 DAO 基本 CRUD**

创建 `tests/server/assistant/assistantSession.dao.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import {
  createAssistantSessionDAO,
  getAssistantSessionDAO,
  listAssistantSessionsDAO,
  renameAssistantSessionDAO,
  softDeleteAssistantSessionDAO,
} from '~~/server/services/assistant/assistantSession.dao'

describe('assistantSession.dao', () => {
  describe('createAssistantSessionDAO', () => {
    it('成功创建 scope=assistant session，sessionId 为 UUID，caseId 为 null', async () => {
      const user = await createTestUser()
      const session = await createAssistantSessionDAO({ userId: user.id })
      expect(session.scope).toBe('assistant')
      expect(session.userId).toBe(user.id)
      expect(session.caseId).toBeNull()
      expect(session.type).toBe(1)
      expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    })

    it.each([
      [{ userId: 0 }, 'userId positive'],
      [{ userId: -1 }, 'userId positive'],
      [{ userId: null as any }, 'userId type'],
    ])('Zod 校验拒绝非法输入: %o', async (input, _desc) => {
      await expect(createAssistantSessionDAO(input as any)).rejects.toThrow()
    })
  })

  describe('getAssistantSessionDAO', () => {
    it('根据 sessionId + userId 取回会话，跨用户返回 null', async () => {
      const owner = await createTestUser()
      const intruder = await createTestUser()
      const session = await createAssistantSessionDAO({ userId: owner.id })
      expect((await getAssistantSessionDAO(session.sessionId, owner.id))?.sessionId).toBe(session.sessionId)
      expect(await getAssistantSessionDAO(session.sessionId, intruder.id)).toBeNull()
    })

    it('scope=case session 不被返回（只匹配 assistant）', async () => {
      const user = await createTestUser()
      const caseRow = await createTestCase(user.id)
      const sessionId = `case-${Date.now()}`
      await prisma.caseSessions.create({
        data: { sessionId, scope: 'case', userId: user.id, caseId: caseRow.id, type: 1 },
      })
      expect(await getAssistantSessionDAO(sessionId, user.id)).toBeNull()
    })
  })

  describe('listAssistantSessionsDAO', () => {
    it('按 updatedAt desc 分页返回当前用户的 assistant session', async () => {
      const user = await createTestUser()
      const s1 = await createAssistantSessionDAO({ userId: user.id, title: 'A' })
      await new Promise(r => setTimeout(r, 10))
      const s2 = await createAssistantSessionDAO({ userId: user.id, title: 'B' })
      const result = await listAssistantSessionsDAO({ userId: user.id, page: 1, pageSize: 20 })
      expect(result.list[0].sessionId).toBe(s2.sessionId)
      expect(result.list[1].sessionId).toBe(s1.sessionId)
      expect(result.total).toBe(2)
    })

    it('软删的会话不返回', async () => {
      const user = await createTestUser()
      const session = await createAssistantSessionDAO({ userId: user.id })
      await softDeleteAssistantSessionDAO(session.sessionId, user.id)
      const result = await listAssistantSessionsDAO({ userId: user.id, page: 1, pageSize: 20 })
      expect(result.list).toHaveLength(0)
    })
  })

  describe('renameAssistantSessionDAO', () => {
    it('成功修改 title', async () => {
      const user = await createTestUser()
      const session = await createAssistantSessionDAO({ userId: user.id })
      await renameAssistantSessionDAO({ sessionId: session.sessionId, userId: user.id, title: '新标题' })
      const updated = await getAssistantSessionDAO(session.sessionId, user.id)
      expect(updated?.title).toBe('新标题')
    })

    it('跨用户修改返回 false', async () => {
      const owner = await createTestUser()
      const intruder = await createTestUser()
      const session = await createAssistantSessionDAO({ userId: owner.id })
      const result = await renameAssistantSessionDAO({
        sessionId: session.sessionId,
        userId: intruder.id,
        title: '篡改',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('softDeleteAssistantSessionDAO', () => {
    it('设置 deletedAt', async () => {
      const user = await createTestUser()
      const session = await createAssistantSessionDAO({ userId: user.id })
      const result = await softDeleteAssistantSessionDAO(session.sessionId, user.id)
      expect(result.success).toBe(true)
      const row = await prisma.caseSessions.findFirst({ where: { sessionId: session.sessionId } })
      expect(row?.deletedAt).not.toBeNull()
    })
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

Run: `npx vitest run tests/server/assistant/assistantSession.dao.test.ts --reporter=verbose`
Expected: FAIL（DAO 尚未实现）

- [ ] **Step 5: 实现 `assistantSession.dao.ts`**

```typescript
import { randomUUID } from 'node:crypto'
import {
  CreateAssistantSessionSchema,
  UpdateAssistantSessionSchema,
  ListAssistantSessionsSchema,
  type CreateAssistantSessionInput,
  type UpdateAssistantSessionInput,
} from './types'

/**
 * 创建 scope=assistant 的会话。
 *
 * Zod 校验确保 userId 正整数；sessionId 由服务端生成 UUID；
 * caseId 固定为 null；type 默认 1（普通对话）。
 */
export async function createAssistantSessionDAO(input: CreateAssistantSessionInput) {
  const parsed = CreateAssistantSessionSchema.parse(input)
  return prisma.caseSessions.create({
    data: {
      sessionId: randomUUID(),
      scope: 'assistant',
      userId: parsed.userId,
      caseId: null,
      type: 1,
      status: 1,
      title: parsed.title ?? null,
    },
  })
}

/**
 * 按 sessionId + userId 取单个 assistant 会话（过滤 scope 与 deletedAt）。
 */
export async function getAssistantSessionDAO(sessionId: string, userId: number) {
  return prisma.caseSessions.findFirst({
    where: {
      sessionId,
      scope: 'assistant',
      userId,
      deletedAt: null,
    },
  })
}

/**
 * 列表：当前用户的 assistant 会话，按 updatedAt desc 分页。
 */
export async function listAssistantSessionsDAO(
  input: { userId: number; page?: number; pageSize?: number },
) {
  const parsed = ListAssistantSessionsSchema.parse(input)
  const where = {
    scope: 'assistant',
    userId: parsed.userId,
    deletedAt: null,
  }
  const [list, total] = await Promise.all([
    prisma.caseSessions.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (parsed.page - 1) * parsed.pageSize,
      take: parsed.pageSize,
      select: { sessionId: true, title: true, updatedAt: true, createdAt: true },
    }),
    prisma.caseSessions.count({ where }),
  ])
  return {
    list: list.map(r => ({
      sessionId: r.sessionId,
      title: r.title,
      updatedAt: r.updatedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  }
}

/**
 * 重命名（仅允许所有者）。
 */
export async function renameAssistantSessionDAO(
  input: UpdateAssistantSessionInput,
): Promise<{ success: boolean; error?: string }> {
  const parsed = UpdateAssistantSessionSchema.parse(input)
  const result = await prisma.caseSessions.updateMany({
    where: {
      sessionId: parsed.sessionId,
      scope: 'assistant',
      userId: parsed.userId,
      deletedAt: null,
    },
    data: {
      title: parsed.title,
      updatedAt: new Date(),
    },
  })
  if (result.count === 0) {
    return { success: false, error: '会话不存在或无权操作' }
  }
  return { success: true }
}

/**
 * 软删（仅允许所有者）。
 */
export async function softDeleteAssistantSessionDAO(
  sessionId: string,
  userId: number,
): Promise<{ success: boolean; error?: string }> {
  const result = await prisma.caseSessions.updateMany({
    where: {
      sessionId,
      scope: 'assistant',
      userId,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  })
  if (result.count === 0) {
    return { success: false, error: '会话不存在或无权操作' }
  }
  return { success: true }
}
```

- [ ] **Step 6: 创建 `index.ts` barrel export**

```typescript
// server/services/assistant/index.ts
export * from './assistantSession.dao'
export * from './assistantSession.service'
export * from './types'
```

（`assistantSession.service.ts` 在下一个 Task 实现）

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/server/assistant/assistantSession.dao.test.ts --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add shared/types/assistant.ts server/services/assistant/ tests/server/assistant/assistantSession.dao.test.ts
git commit -m "feat(assistant): 新增 assistantSession DAO 与共享类型

- shared/types/assistant.ts 定义 AssistantSession 等类型
- assistantSession.dao 自建 CRUD（不复用 case 域 DAO）
- Zod 校验 scope/userId 必填、caseId=null
- 参见 spec §4.10, §5.6.1-3"
```

---

## Task 8: 新增 `assistantAgent.ts` 实现

**Files:**
- Create: `server/services/workflow/agents/assistantAgent.ts`
- Modify: `server/services/workflow/agents/index.ts`（替换 Task 6 的 stub）
- Test: `tests/server/assistant/assistantAgent.integration.test.ts`（集成测试）

**参考规范：** spec §5.3

- [ ] **Step 1: 读 `caseMainAgent.ts` 作为参考模板**

Run: `cat /Users/daixin/work/dev/LexSeek/LexSeek/server/services/workflow/agents/caseMainAgent.ts`

对照 spec §5.3 逐行理解差异（去掉 case 相关中间件、工具上下文不传 caseId）。

- [ ] **Step 2: 实现 `assistantAgent.ts`**

```typescript
/**
 * 通用法律助手主代理（assistantMain 节点）
 *
 * 对照 caseMainAgent 的 assistant 版：
 * - 系统提示词不假设 case 上下文
 * - 工具集不含 case 相关工具
 * - 中间件不注入 caseMaterialContext / caseProcessMaterial / moduleContext
 * - 积分计费键为 assistant_token（与 case_analysis_token 独立）
 */

import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { getCheckpointer, getStore } from '../checkpointer'
import { getValidNodeConfig } from '../../node/node.service'
import { createChatModel } from '../../node/chatModelFactory'
import { getToolInstancesService } from '../tools'
import { renderSystemPrompt } from '../utils/promptRenderer'
import {
  pointConsumptionMiddleware,
  safetyTrimMiddleware,
} from '../middleware'

const ASSISTANT_MAIN_NODE_NAME = 'assistantMain'

export interface AssistantAgentOptions {
  userId: number
  thinking?: boolean
  signal?: AbortSignal
  command?: unknown
}

/**
 * 执行通用法律助手对话。
 *
 * @param sessionId LangGraph thread_id
 * @param message 用户消息（resume 场景传 undefined）
 * @param options userId / thinking / signal / command
 * @returns SSE 格式的 ReadableStream
 */
export async function runAssistantChat(
  sessionId: string,
  message: string | undefined,
  options: AssistantAgentOptions,
): Promise<ReadableStream<Uint8Array>> {
  const { userId, thinking = true, signal, command } = options

  const [checkpointer, store, mainConfig] = await Promise.all([
    getCheckpointer(),
    getStore(),
    getValidNodeConfig(ASSISTANT_MAIN_NODE_NAME, '通用法律助手主Agent'),
  ])

  const activeApiKey = mainConfig.modelApiKeys.find(k => k.status === 1)
  if (!activeApiKey) {
    throw new Error(`${ASSISTANT_MAIN_NODE_NAME} 节点没有可用的 API 密钥`)
  }

  const model = createChatModel({
    sdkType: mainConfig.modelSdkType,
    modelName: mainConfig.modelName,
    apiKey: activeApiKey.apiKey,
    baseUrl: mainConfig.modelProviderBaseUrl,
    temperature: 0.7,
    streaming: true,
    thinking,
  })

  // 渲染系统提示词：assistantMain 的 v1 提示词无变量
  const systemPrompt = renderSystemPrompt(mainConfig, {})

  // 工具上下文不含 caseId
  const toolContext = { userId, sessionId }
  const tools = mainConfig.tools.length > 0
    ? getToolInstancesService(mainConfig.tools, toolContext)
    : []

  const contextWindow = mainConfig.modelContextWindow || 128000
  const triggerTokens = Math.max(Math.floor(contextWindow * 0.6), 30000)

  const agent: ReactAgent = createAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools,
    middleware: [
      // assistant_token 独立计费
      pointConsumptionMiddleware(userId, 'assistant_token', sessionId),
      summarizationMiddleware({
        model,
        trigger: [{ tokens: triggerTokens }],
      }),
      safetyTrimMiddleware({
        model,
        maxTokens: Math.floor(contextWindow * 0.8),
      }),
    ],
  })

  const input = command
    ? new Command({ resume: command })
    : { messages: [new HumanMessage(message!)] }

  return agent.stream(input, {
    configurable: { thread_id: sessionId },
    streamMode: ['values', 'messages', 'updates'],
    subgraphs: true,
    encoding: 'text/event-stream',
    recursionLimit: 1000,
    signal,
  })
}

/**
 * 读取 assistant 会话 checkpoint 状态（用于 interrupt 检测 / 消息历史）。
 *
 * 结构与 caseMainAgent 的 getChatThreadState 一致。
 */
export async function getAssistantThreadState(sessionId: string) {
  const checkpointer = await getCheckpointer()
  const dummyModel = createChatModel({
    sdkType: 'openai',
    modelName: 'gpt-4',
    apiKey: 'dummy',
    baseUrl: 'http://localhost',
  })
  const stateReader = createAgent({
    model: dummyModel,
    checkpointer,
  })
  return stateReader.getState({
    configurable: { thread_id: sessionId },
  })
}
```

- [ ] **Step 3: 修改 `server/services/workflow/agents/index.ts`**

移除 Task 6 的占位 stub，改为 barrel export：
```typescript
export * from './caseMainAgent'
export * from './moduleAgent'
export * from './assistantAgent'
// 注意：若不同文件间函数名冲突，改为显式 re-export
```

- [ ] **Step 4: 集成测试（不连真实模型，mock createChatModel）**

创建 `tests/server/assistant/assistantAgent.integration.test.ts`：

```typescript
import { describe, it, expect, vi, beforeAll } from 'vitest'

describe('runAssistantChat - 集成', () => {
  it('从 assistantMain 节点读取配置并返回 SSE stream', async () => {
    // 依赖 Task 2 seed 的 assistantMain 节点已存在
    const { runAssistantChat } = await import('~~/server/services/workflow/agents/assistantAgent')
    const user = await createTestUser()
    const sessionId = `integ-${Date.now()}`
    await prisma.caseSessions.create({
      data: { sessionId, scope: 'assistant', userId: user.id, caseId: null, type: 1 },
    })
    const stream = await runAssistantChat(sessionId, '你好', {
      userId: user.id,
      thinking: false,
    })
    expect(stream).toBeInstanceOf(ReadableStream)
    // 若有预算跑真实模型：读一条 chunk 验证非空；否则只验证 stream 对象形态
  })

  it('assistantMain 节点不存在时抛错', async () => {
    const { runAssistantChat } = await import('~~/server/services/workflow/agents/assistantAgent')
    // mock getValidNodeConfig 抛错
    vi.doMock('~~/server/services/node/node.service', () => ({
      getValidNodeConfig: vi.fn().mockRejectedValue(new Error('node not found')),
    }))
    await expect(runAssistantChat('any', 'msg', { userId: 1 })).rejects.toThrow()
  })
})
```

- [ ] **Step 5: 运行测试**

Run: `npx vitest run tests/server/assistant/assistantAgent.integration.test.ts --reporter=verbose`
Expected: PASS（如果真实模型 API key 未配置，第一条 case 跳过或使用 `it.skipIf`）

- [ ] **Step 6: 回测 agentWorker 的 scope 分流测试**

Run: `npx vitest run tests/server/agent/agentWorker.test.ts -t "scope 分流" --reporter=verbose`
Expected: PASS（stub 已替换为真实 runAssistantChat）

- [ ] **Step 7: 提交**

```bash
git add server/services/workflow/agents/assistantAgent.ts server/services/workflow/agents/index.ts tests/server/assistant/assistantAgent.integration.test.ts
git commit -m "feat(workflow): 实现 runAssistantChat / getAssistantThreadState

- 对照 caseMainAgent 但去除 case 相关中间件
- 工具上下文不传 caseId（assistant 无案件上下文）
- 积分计费键 assistant_token 独立
- 参见 spec §5.3"
```

---

## Task 9: assistantSession Service（封装业务逻辑）

**Files:**
- Create: `server/services/assistant/assistantSession.service.ts`
- Test: `tests/server/assistant/assistantSession.service.test.ts`

- [ ] **Step 1: 实现 `assistantSession.service.ts`**

```typescript
/**
 * 通用法律助手会话 Service
 *
 * 对 DAO 的业务包装：权限校验统一从 userId 参数入口；提供标题自动生成辅助。
 */

import {
  createAssistantSessionDAO,
  getAssistantSessionDAO,
  listAssistantSessionsDAO,
  renameAssistantSessionDAO,
  softDeleteAssistantSessionDAO,
} from './assistantSession.dao'
import type { CreateAssistantSessionInput } from './types'
import { createChatModel } from '../node/chatModelFactory'
import { getValidNodeConfig } from '../node/node.service'

export async function createAssistantSessionService(userId: number, title?: string) {
  return createAssistantSessionDAO({ userId, title })
}

export async function getAssistantSessionService(sessionId: string, userId: number) {
  return getAssistantSessionDAO(sessionId, userId)
}

export async function listAssistantSessionsService(userId: number, page = 1, pageSize = 20) {
  return listAssistantSessionsDAO({ userId, page, pageSize })
}

export async function renameAssistantSessionService(
  sessionId: string,
  userId: number,
  title: string,
) {
  return renameAssistantSessionDAO({ sessionId, userId, title })
}

export async function softDeleteAssistantSessionService(sessionId: string, userId: number) {
  return softDeleteAssistantSessionDAO(sessionId, userId)
}

/**
 * 基于首条消息与首条回复异步生成 ≤20 字标题，写回 session.title。
 * 失败时吞异常并记录日志（非核心路径）。
 */
export async function generateSessionTitleAsync(
  sessionId: string,
  userId: number,
  firstUserMessage: string,
  firstAssistantReply: string,
): Promise<void> {
  try {
    const session = await getAssistantSessionDAO(sessionId, userId)
    if (!session || session.title) return  // 已有标题不覆盖

    const config = await getValidNodeConfig('assistantMain', '通用法律助手主Agent')
    const activeApiKey = config.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) return

    const model = createChatModel({
      sdkType: config.modelSdkType,
      modelName: config.modelName,
      apiKey: activeApiKey.apiKey,
      baseUrl: config.modelProviderBaseUrl,
      temperature: 0.3,
      streaming: false,
    })

    const prompt = `根据以下对话的第一轮用户问题与 AI 回答，生成不超过 20 个字的中文标题，只输出标题文本，不加引号、标点或额外说明。

用户：${firstUserMessage.slice(0, 500)}
AI：${firstAssistantReply.slice(0, 500)}`

    const res = await model.invoke(prompt)
    const title = String(res.content ?? '').trim().replace(/[\r\n"'「」]/g, '').slice(0, 20)
    if (title) {
      await renameAssistantSessionDAO({ sessionId, userId, title })
    }
  }
  catch (err) {
    logger.warn('自动生成会话标题失败', { sessionId, err: String(err) })
  }
}
```

- [ ] **Step 2: 写简单测试验证 service 转发 DAO + 标题生成不抛异常**

```typescript
// tests/server/assistant/assistantSession.service.test.ts
import { describe, it, expect, vi } from 'vitest'
import {
  createAssistantSessionService,
  generateSessionTitleAsync,
} from '~~/server/services/assistant/assistantSession.service'

describe('assistantSession.service', () => {
  it('createAssistantSessionService 返回新会话', async () => {
    const user = await createTestUser()
    const session = await createAssistantSessionService(user.id)
    expect(session.userId).toBe(user.id)
    expect(session.scope).toBe('assistant')
  })

  it('generateSessionTitleAsync 失败不抛出', async () => {
    // 不准备 modelApiKeys，函数应吞异常
    await expect(generateSessionTitleAsync('not-exist', 99999, 'u', 'a')).resolves.not.toThrow()
  })

  it('已有 title 不被覆盖', async () => {
    const user = await createTestUser()
    const session = await createAssistantSessionService(user.id, '手动设置')
    await generateSessionTitleAsync(session.sessionId, user.id, 'q', 'a')
    const row = await prisma.caseSessions.findFirst({ where: { sessionId: session.sessionId } })
    expect(row?.title).toBe('手动设置')
  })
})
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/server/assistant/assistantSession.service.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add server/services/assistant/assistantSession.service.ts tests/server/assistant/assistantSession.service.test.ts
git commit -m "feat(assistant): 新增 assistantSession.service 封装与标题生成

- 对 DAO 的 service 级包装
- generateSessionTitleAsync 在首轮对话后异步调模型生成 ≤20 字标题
- 失败吞异常不影响主路径"
```

---

## Task 10: API · Sessions CRUD（5 个端点）

**Files:**
- Create: `server/api/v1/assistant/sessions.get.ts`
- Create: `server/api/v1/assistant/sessions.post.ts`
- Create: `server/api/v1/assistant/sessions/[id].get.ts`
- Create: `server/api/v1/assistant/sessions/[id].patch.ts`
- Create: `server/api/v1/assistant/sessions/[id].delete.ts`

**参考规范：** spec §5.6.1-3

- [ ] **Step 1: 创建 `sessions.get.ts`（会话列表）**

```typescript
import { z } from 'zod'
import { listAssistantSessionsService } from '~~/server/services/assistant/assistantSession.service'

const QuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const parsed = QuerySchema.safeParse(getQuery(event))
  if (!parsed.success) return resError(event, 400, parsed.error.issues[0].message)

  const result = await listAssistantSessionsService(user.id, parsed.data.page, parsed.data.pageSize)
  return resSuccess(event, '获取成功', result)
})
```

- [ ] **Step 2: 创建 `sessions.post.ts`（新建会话）**

```typescript
import {
  createAssistantSessionService,
} from '~~/server/services/assistant/assistantSession.service'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const session = await createAssistantSessionService(user.id)
  return resSuccess(event, '创建成功', {
    sessionId: session.sessionId,
    title: session.title,
  })
})
```

- [ ] **Step 3: 创建 `sessions/[id].get.ts`（单会话详情，含消息历史）**

```typescript
import {
  getAssistantSessionService,
} from '~~/server/services/assistant/assistantSession.service'
import { getAssistantThreadState } from '~~/server/services/workflow/agents/assistantAgent'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) return resError(event, 400, '缺少 sessionId')

  const session = await getAssistantSessionService(sessionId, user.id)
  if (!session) return resError(event, 404, '会话不存在或无权访问')

  // 从 checkpointer 读消息历史（若需要）
  let messages: unknown[] = []
  try {
    const state = await getAssistantThreadState(sessionId)
    messages = (state?.values as any)?.messages ?? []
  }
  catch (err) {
    logger.warn('读取会话消息历史失败', { sessionId, err: String(err) })
  }

  return resSuccess(event, '获取成功', {
    session: {
      sessionId: session.sessionId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    messages,
  })
})
```

- [ ] **Step 4: 创建 `sessions/[id].patch.ts`（重命名）**

```typescript
import { z } from 'zod'
import { renameAssistantSessionService } from '~~/server/services/assistant/assistantSession.service'

const BodySchema = z.object({ title: z.string().min(1).max(200) })

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) return resError(event, 400, '缺少 sessionId')

  const body = await readBody(event)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return resError(event, 400, parsed.error.issues[0].message)

  const result = await renameAssistantSessionService(sessionId, user.id, parsed.data.title)
  if (!result.success) return resError(event, 404, result.error ?? '操作失败')

  return resSuccess(event, '更新成功', { sessionId, title: parsed.data.title })
})
```

- [ ] **Step 5: 创建 `sessions/[id].delete.ts`（软删）**

```typescript
import { softDeleteAssistantSessionService } from '~~/server/services/assistant/assistantSession.service'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) return resError(event, 400, '缺少 sessionId')

  const result = await softDeleteAssistantSessionService(sessionId, user.id)
  if (!result.success) return resError(event, 404, result.error ?? '操作失败')

  return resSuccess(event, '删除成功', { sessionId })
})
```

- [ ] **Step 6: 写 API 集成测试**

创建 `tests/server/assistant/sessions.api.test.ts`，使用项目现有的 API 测试 helper（若无则用 `$fetch` 直调服务）覆盖：
- POST 创建成功返回 sessionId
- GET 列表只返回当前用户的 assistant session
- PATCH 修改 title
- DELETE 软删后列表不再返回
- 跨用户操作返回 401/404

- [ ] **Step 7: 运行测试**

Run: `npx vitest run tests/server/assistant --reporter=verbose`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add server/api/v1/assistant/sessions.get.ts server/api/v1/assistant/sessions.post.ts server/api/v1/assistant/sessions/ tests/server/assistant/sessions.api.test.ts
git commit -m "feat(assistant): 新增会话 CRUD API

- GET /api/v1/assistant/sessions 分页列表
- POST /api/v1/assistant/sessions 新建
- GET /api/v1/assistant/sessions/:id 单会话 + 消息历史
- PATCH /api/v1/assistant/sessions/:id 重命名
- DELETE /api/v1/assistant/sessions/:id 软删
- 参见 spec §5.6.1-3"
```

---

## Task 11: API · `/api/v1/assistant/chat.post.ts` SSE（复用 case chat 6 分支）

**Files:**
- Create: `server/api/v1/assistant/chat.post.ts`
- Reference: `server/api/v1/case/analysis/chat.post.ts`（参考结构，复用 6 分支范式）
- Test: `tests/server/assistant/chat.post.integration.test.ts`

**参考规范：** spec §5.5, §5.6.4

- [ ] **Step 1: 阅读 case chat.post.ts 完整结构**

Run: `cat /Users/daixin/work/dev/LexSeek/LexSeek/server/api/v1/case/analysis/chat.post.ts`

重点关注 6 个分支的判定条件（activeRun RUNNING/INTERRUPTED、latestRun 重放、command resume）。

- [ ] **Step 2: 实现 `chat.post.ts`**

```typescript
import { z } from 'zod'
import {
  findActiveRunBySessionIdDAO,
  findLatestRunBySessionIdDAO,
} from '~~/server/services/agent/agentRun.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { shouldRejectMessage } from '~~/server/services/agent/agentRun.service'
import { getAssistantSessionService } from '~~/server/services/assistant/assistantSession.service'
import { checkPointsService } from '~~/server/services/point/pointConsumption.service'
import { createSseStream } from '~~/server/services/sse/sseStream'  // 若实际文件名不同以现状为准

const BodySchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().optional(),
  command: z.unknown().optional(),
  thinking: z.boolean().optional().default(true),
})

export default defineEventHandler(async (event) => {
  // 1. 鉴权
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  // 2. 参数校验
  const body = await readBody(event)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return resError(event, 400, parsed.error.issues[0].message)
  const { sessionId, message, command, thinking } = parsed.data

  // 3. scope 校验 + 鉴权（必须 scope=assistant 且归属当前用户）
  const session = await getAssistantSessionService(sessionId, user.id)
  if (!session) return resError(event, 404, '会话不存在或无权访问')

  // 4. 积分门控（错误不兜底，让 Nitro 默认 handler 返回 500）
  const check = await checkPointsService(user.id, 'assistant_token', 1)
  if (!check.sufficient) {
    return resError(event, 402, `积分不足（可用 ${check.available}）`)
  }

  // 5. 6 分支路由（对齐 case chat.post）
  const activeRun = await findActiveRunBySessionIdDAO(sessionId)
  let runId: string
  let latestRunStatus: string | undefined

  if (activeRun) {
    if (message && shouldRejectMessage(activeRun.status, true)) {
      return resError(event, 429, '请等待当前分析完成')
    }
    if (message && (activeRun.status === 'interrupted' || activeRun.status === 'pending')) {
      // 活跃 run + 新消息 + 非 RUNNING：入队新 run（resume 路径）
      const result = await enqueueRunService({
        sessionId,
        threadId: sessionId,
        userId: user.id,
        caseId: null,
        input: { message, command, thinking },
      })
      if ('error' in result) return resError(event, 429, result.error)
      runId = result.runId
    }
    else {
      // 活跃 run + 无新消息：重连订阅
      runId = activeRun.id
    }
  }
  else {
    if (!message && !command) {
      // 无活跃 run + 无消息无 command：尝试从最新 run 重放
      const latestRun = await findLatestRunBySessionIdDAO(sessionId)
      if (latestRun) {
        runId = latestRun.id
        latestRunStatus = latestRun.status
      }
      else {
        return resError(event, 400, '消息不能为空')
      }
    }
    else {
      // 无活跃 run + 有消息/有 command：入队新 run
      try {
        const result = await enqueueRunService({
          sessionId,
          threadId: sessionId,
          userId: user.id,
          caseId: null,
          input: { message, command, thinking },
        })
        if ('error' in result) return resError(event, 429, result.error)
        runId = result.runId
      }
      catch (err: any) {
        // P2002：并发竞态，另一路已入队；回查活跃 run 订阅
        if (err?.code === 'P2002') {
          const raceActive = await findActiveRunBySessionIdDAO(sessionId)
          if (raceActive) {
            runId = raceActive.id
          }
          else {
            throw err
          }
        }
        else {
          throw err
        }
      }
    }
  }

  // 6. 设置 SSE 响应头
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  // 7. 订阅 run 的 SSE 流（复用 case 域的 createSseStream 或等价工具）
  return createSseStream({ runId, event, latestRunStatus })
})
```

**重要**：`createSseStream` 的实际 API 请以项目现有封装为准（参考 case chat.post.ts 第 215 行之后）。如果 case chat.post 是内联实现 SSE stream，则把那段代码抽成 `server/services/sse/assistantSseStream.ts` 并在这里调用。

- [ ] **Step 3: 集成测试覆盖 6 分支**

创建 `tests/server/assistant/chat.post.integration.test.ts`，针对 spec §5.6.4 的 6 种场景各写一条测试：
- 活跃 RUNNING + 新消息 → 429
- 活跃 INTERRUPTED + 新消息 → 入队新 run
- 活跃 + 无新消息 → 复用 runId 订阅
- 无活跃 + 有消息 → 入队
- 无活跃 + 无消息无 command → 从 latest run 重放
- 无活跃 + 有 command → 入队（command 携带）

并发双发测试：
```typescript
it('并发双发同一 sessionId 只一个入队成功', async () => {
  const user = await createTestUser()
  const session = await createAssistantSessionService(user.id)
  // 模拟认证 context
  const [r1, r2] = await Promise.all([
    $fetch('/api/v1/assistant/chat', { method: 'POST', body: { sessionId: session.sessionId, message: 'a' } }),
    $fetch('/api/v1/assistant/chat', { method: 'POST', body: { sessionId: session.sessionId, message: 'b' } }),
  ])
  // 其中之一成功，另一个复用 runId 或返回 429
  // 数据库中只应有 1 条 status=pending 的 run
  const runs = await prisma.agentRuns.findMany({
    where: { sessionId: session.sessionId, status: { in: ['pending', 'running'] } },
  })
  expect(runs.length).toBe(1)
})
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/assistant/chat.post.integration.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/api/v1/assistant/chat.post.ts tests/server/assistant/chat.post.integration.test.ts
git commit -m "feat(assistant): 新增 /api/v1/assistant/chat SSE 接口

- 复用 case chat.post 的 6 分支范式
- 积分前置门控（assistant_token）
- P2002 竞态兜底
- 参见 spec §5.6.4"
```

---

## Task 12: API · 取消运行 `/api/v1/assistant/runs/cancel/[runId].post.ts`

**Files:**
- Create: `server/api/v1/assistant/runs/cancel/[runId].post.ts`

**参考规范：** spec §5.6.5

- [ ] **Step 1: 读 case 域取消实现**

Run: `cat /Users/daixin/work/dev/LexSeek/LexSeek/server/api/v1/case/analysis/runs/cancel/[runId].post.ts`

- [ ] **Step 2: 实现 assistant 版取消**

```typescript
import { cancelRunService } from '~~/server/services/agent/agentRun.service'
import { findActiveRunBySessionIdDAO } from '~~/server/services/agent/agentRun.dao'

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const runId = getRouterParam(event, 'runId')
  if (!runId) return resError(event, 400, '缺少 runId')

  // 鉴权：该 run 必须属于当前用户的 assistant session
  const run = await prisma.agentRuns.findUnique({ where: { id: runId } })
  if (!run) return resError(event, 404, 'run 不存在')
  if (run.userId !== user.id) return resError(event, 403, '无权操作')

  // scope 校验：对应 session 必须 scope=assistant
  const session = await prisma.caseSessions.findUnique({
    where: { sessionId: run.sessionId },
    select: { scope: true },
  })
  if (session?.scope !== 'assistant') {
    return resError(event, 403, '非 assistant 会话，请走案件取消接口')
  }

  await cancelRunService(runId)
  return resSuccess(event, '取消成功', { cancelled: true })
})
```

- [ ] **Step 3: 简单冒烟测试**

```typescript
// 加入 sessions.api.test.ts 或单独文件
it('取消 assistant run', async () => {
  const user = await createTestUser()
  const session = await createAssistantSessionService(user.id)
  const run = await createAgentRunDAO({
    sessionId: session.sessionId,
    threadId: session.sessionId,
    userId: user.id,
    caseId: null,
    input: { message: 'x' },
  })
  const res = await $fetch(`/api/v1/assistant/runs/cancel/${run.id}`, {
    method: 'POST',
    // mock auth context with user.id
  })
  expect((res as any).data.cancelled).toBe(true)
})
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/server/assistant --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/api/v1/assistant/runs/
git commit -m "feat(assistant): 新增 /api/v1/assistant/runs/cancel/:runId

- 复用 case 域 cancelRunService
- 校验 run 归属当前用户 + scope=assistant
- 参见 spec §5.6.5"
```

---

## Task 13: 前端 · `useAssistantChat` composable

**Files:**
- Create: `app/composables/useAssistantChat.ts`
- Reference: `app/composables/useXiaosuoChat.ts`、`app/composables/useStreamChat.ts`

**参考规范：** spec §8.3.1

- [ ] **Step 1: 读 useXiaosuoChat 与 useStreamChat 了解现有 API**

Run:
```bash
cat /Users/daixin/work/dev/LexSeek/LexSeek/app/composables/useXiaosuoChat.ts
cat /Users/daixin/work/dev/LexSeek/LexSeek/app/composables/useStreamChat.ts | head -80
```

- [ ] **Step 2: 实现 `useAssistantChat`**

```typescript
import type { Ref } from 'vue'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'

/**
 * 通用法律助手对话 composable。
 *
 * 基于 useStreamChat，URL 指向 /api/v1/assistant/chat。
 * 提供与 useXiaosuoChat 对齐的接口以便 UI 层复用 AiChat。
 */
export function useAssistantChat(sessionId: Ref<string | null>) {
  const messages = ref<any[]>([])
  const loading = ref(false)
  const isInterrupted = ref(false)

  // 根据 useStreamChat 的实际 API 调整调用；这里按 spec 给出的伪代码写
  const { send, stop, reconnect } = useStreamChat({
    url: '/api/v1/assistant/chat',
    sessionId,
    onMessage(msg) {
      messages.value = [...messages.value, msg]
    },
    onInterrupt() {
      isInterrupted.value = true
    },
    onDone() {
      loading.value = false
    },
    onError(err) {
      logger?.warn?.('assistantChat error', err)
      loading.value = false
    },
  })

  async function sendMessage(input: AiPromptSubmitData) {
    if (!sessionId.value) return
    loading.value = true
    isInterrupted.value = false
    await send({
      message: input.text,
      thinking: input.thinking,
    })
  }

  async function loadHistory() {
    if (!sessionId.value) return
    const res = await useApiFetch<{ session: any; messages: any[] }>(
      `/api/v1/assistant/sessions/${sessionId.value}`,
    )
    if (res?.messages) {
      messages.value = res.messages
    }
  }

  return {
    messages,
    loading,
    isInterrupted,
    sendMessage,
    stop,
    reconnect,
    loadHistory,
  }
}
```

**注意**：`useStreamChat` 的真实签名请以现有实现为准，此处参考 spec 写法。若字段名不同，适配即可。

- [ ] **Step 3: 提交**

```bash
git add app/composables/useAssistantChat.ts
git commit -m "feat(assistant): 新增 useAssistantChat composable

- 基于 useStreamChat，url=/api/v1/assistant/chat
- 提供 sendMessage / loadHistory / stop / reconnect 等方法
- 参见 spec §8.3.1"
```

---

## Task 14: 前端 · `<AssistantSessionList>` 组件

**Files:**
- Create: `app/components/assistant/AssistantSessionList.vue`

**参考规范：** spec §8.3.2

- [ ] **Step 1: 实现组件**

```vue
<script setup lang="ts">
import type { AssistantSession } from '#shared/types/assistant'
import { PlusIcon, Trash2Icon, PencilIcon } from 'lucide-vue-next'

const selectedId = defineModel<string | null>('selectedId')

const sessions = ref<AssistantSession[]>([])
const loading = ref(false)

async function loadSessions() {
  loading.value = true
  try {
    const res = await useApiFetch<{ list: AssistantSession[] }>('/api/v1/assistant/sessions')
    if (res) sessions.value = res.list
  }
  finally {
    loading.value = false
  }
}

async function createSession() {
  const res = await useApiFetch<{ sessionId: string; title: string | null }>(
    '/api/v1/assistant/sessions',
    { method: 'POST', body: {} },
  )
  if (res) {
    selectedId.value = res.sessionId
    await loadSessions()
  }
}

async function renameSession(s: AssistantSession) {
  const newTitle = window.prompt('重命名会话', s.title ?? '未命名对话')
  if (newTitle == null || newTitle.trim() === s.title) return
  await useApiFetch(`/api/v1/assistant/sessions/${s.sessionId}`, {
    method: 'PATCH',
    body: { title: newTitle.trim() },
  })
  await loadSessions()
}

async function deleteSession(s: AssistantSession) {
  if (!window.confirm(`确定删除"${s.title ?? '未命名对话'}"？`)) return
  await useApiFetch(`/api/v1/assistant/sessions/${s.sessionId}`, { method: 'DELETE' })
  if (selectedId.value === s.sessionId) selectedId.value = null
  await loadSessions()
}

onMounted(loadSessions)

defineExpose({ refresh: loadSessions })
</script>

<template>
  <div class="flex h-full flex-col border-r">
    <div class="p-3 border-b">
      <Button class="w-full justify-start gap-2" size="sm" @click="createSession">
        <PlusIcon class="size-4" />
        新对话
      </Button>
    </div>
    <div class="flex-1 overflow-y-auto">
      <div v-if="loading" class="p-4 text-sm text-muted-foreground">加载中...</div>
      <div v-else-if="sessions.length === 0" class="p-4 text-sm text-muted-foreground">
        暂无会话，点击上方「新对话」开始
      </div>
      <ul v-else>
        <li
          v-for="s in sessions"
          :key="s.sessionId"
          class="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent"
          :class="{ 'bg-accent': selectedId === s.sessionId }"
          @click="selectedId = s.sessionId"
        >
          <span class="flex-1 truncate text-sm">{{ s.title ?? '未命名对话' }}</span>
          <button
            class="opacity-0 group-hover:opacity-100 size-6 hover:bg-background rounded flex items-center justify-center"
            title="重命名"
            @click.stop="renameSession(s)"
          >
            <PencilIcon class="size-3" />
          </button>
          <button
            class="opacity-0 group-hover:opacity-100 size-6 hover:bg-background rounded flex items-center justify-center"
            title="删除"
            @click.stop="deleteSession(s)"
          >
            <Trash2Icon class="size-3" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 提交**

```bash
git add app/components/assistant/AssistantSessionList.vue
git commit -m "feat(assistant): 新增 AssistantSessionList 组件

- 显示当前用户 assistant 会话列表
- 支持新建 / 重命名 / 删除 / 选中
- 参见 spec §8.3.2"
```

---

## Task 15: 前端 · 对话页 + WIP 占位页

**Files:**
- Create: `app/pages/dashboard/assistant/chat.vue`
- Create: `app/pages/dashboard/assistant/contract.vue`（WIP 占位）
- Create: `app/pages/dashboard/assistant/document.vue`（WIP 占位）

**参考规范：** spec §8.1, §8.2, §8.5

- [ ] **Step 1: 实现 `chat.vue`**

```vue
<script setup lang="ts">
import { MessageSquareIcon } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard-layout',
  title: '法律助手 · 对话',
  icon: 'MessageSquare',
})

const route = useRoute()
const router = useRouter()
const sessionId = ref<string | null>(
  typeof route.query.sid === 'string' ? route.query.sid : null,
)

// URL 同步
watch(sessionId, (sid) => {
  router.replace({ query: { ...route.query, sid: sid ?? undefined } })
})

const {
  messages,
  loading,
  isInterrupted,
  sendMessage,
  stop,
  loadHistory,
} = useAssistantChat(sessionId)

watch(sessionId, async (sid) => {
  if (sid) await loadHistory()
  else messages.value = []
})

if (sessionId.value) loadHistory()
</script>

<template>
  <div class="flex h-[calc(100vh-4rem)]">
    <AssistantSessionList v-model:selected-id="sessionId" class="w-64 shrink-0" />
    <div class="flex-1 flex flex-col">
      <div v-if="!sessionId" class="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <MessageSquareIcon class="size-16 mb-4 opacity-50" />
        <p class="text-lg">选择左侧会话或点击「新对话」开始</p>
      </div>
      <AiChat
        v-else
        :messages="messages"
        :loading="loading"
        :is-interrupted="isInterrupted"
        :show-header="false"
        prompt-placeholder="输入你的法律问题..."
        class="flex-1"
        @submit="sendMessage"
        @stop="stop"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 2: 实现 `contract.vue` 与 `document.vue` WIP 占位页**

```vue
<!-- app/pages/dashboard/assistant/contract.vue -->
<script setup lang="ts">
import { HardHatIcon } from 'lucide-vue-next'

definePageMeta({
  layout: 'dashboard-layout',
  title: '法律助手 · 合同审查',
  icon: 'FileSearch',
})
</script>

<template>
  <div class="flex flex-col items-center justify-center h-[calc(100vh-4rem)] text-muted-foreground">
    <HardHatIcon class="size-16 mb-4 opacity-50" />
    <p class="text-xl font-medium">合同审查功能正在建设中</p>
    <p class="mt-2 text-sm">敬请期待第二期上线</p>
  </div>
</template>
```

`document.vue` 同构（改标题 `法律助手 · 文书生成`、文案 `文书生成功能正在建设中 / 第三期`）。

- [ ] **Step 3: 浏览器验证**

启动 dev server：`bun dev`
访问 `/dashboard/assistant/chat`：
- 左侧显示"暂无会话"
- 点「新对话」创建成功
- 右侧输入框可用
- 发消息 → 看到流式响应

访问 `/dashboard/assistant/contract`、`/dashboard/assistant/document`：看到 WIP 占位。

- [ ] **Step 4: 提交**

```bash
git add app/pages/dashboard/assistant/
git commit -m "feat(assistant): 新增对话页与 WIP 占位页

- /dashboard/assistant/chat 完整对话页（会话列表 + AiChat）
- /dashboard/assistant/contract /document 占位页
- URL query sid 同步当前会话
- 参见 spec §8.1, §8.2"
```

---

## Task 16: 侧边栏 RBAC 菜单注册

**Files:**
- Modify: RBAC 路由配置文件（项目内位置需通过 grep 确定）

- [ ] **Step 1: 找到菜单/RBAC 路由注册方式**

Run:
```bash
grep -rn "dashboard/cases\|dashboard/tools\|currentRoleRouters" /Users/daixin/work/dev/LexSeek/LexSeek/app/components/dashboard/navMain.vue /Users/daixin/work/dev/LexSeek/LexSeek/server/services/rbac/ 2>/dev/null | head -20
```

定位：
- 现有路由是在 DB 表（`routers`）还是代码常量
- 是否需要 admin 后台添加角色权限
- 菜单图标字段名

- [ ] **Step 2: 注册 3 条新路由**

按现有机制把以下 3 条加入路由表（可能是 seed 脚本、可能是 admin UI，按项目现状操作）：

| path | title | icon | parentId | priority |
|---|---|---|---|---|
| `/dashboard/assistant/chat` | 法律助手 · 对话 | MessageSquare | null（或"法律助手"父项下）| 10 |
| `/dashboard/assistant/contract` | 法律助手 · 合同审查 | FileSearch | 同上 | 20 |
| `/dashboard/assistant/document` | 法律助手 · 文书生成 | FileText | 同上 | 30 |

若 RBAC 支持父子菜单，建议父菜单 `/dashboard/assistant`（无实际页面，只做分组）。

给所有现有角色授权访问这三条路由（至少"普通用户"角色需要访问）。

- [ ] **Step 3: 浏览器验证**

登录后侧边栏能看到"法律助手 · 对话"菜单项，点击跳到对话页。

- [ ] **Step 4: 提交**

```bash
git add <修改的 RBAC 配置文件>
git commit -m "feat(rbac): 注册法律助手三级菜单路由

- /dashboard/assistant/chat（第一期可用）
- /dashboard/assistant/contract（第二期，WIP 占位）
- /dashboard/assistant/document（第三期，WIP 占位）
- 默认对普通用户角色可见"
```

---

## Task 17: 首条消息后异步生成会话标题

**Files:**
- Modify: `server/services/agent/agentWorker.ts`（或 assistantAgent 完成回调处）

- [ ] **Step 1: 找 SSE stream 完成的钩子**

`runAssistantChat` 返回的是 ReadableStream；stream 消费到 done 后的动作在 agentWorker 的 `executeRun` 中处理（参考 case 域）。

Run: `grep -n "completedAt\|status.*completed" /Users/daixin/work/dev/LexSeek/LexSeek/server/services/agent/agentWorker.ts | head -10`

- [ ] **Step 2: 在 assistant run 完成时触发标题生成**

在 agentWorker 的 run 完成分支加入：

```typescript
// 现有代码：run 标记 completed 之后
if (session.scope === 'assistant' && !session.title) {
  // 异步生成，不阻塞
  const state = await getAssistantThreadState(run.sessionId).catch(() => null)
  const msgs = (state?.values as any)?.messages ?? []
  const firstUser = msgs.find((m: any) => m.type === 'human' || m._getType?.() === 'human')?.content
  const firstAI = msgs.find((m: any) => m.type === 'ai' || m._getType?.() === 'ai')?.content
  if (firstUser && firstAI) {
    void generateSessionTitleAsync(
      run.sessionId,
      session.userId!,
      String(firstUser),
      String(firstAI),
    )
  }
}
```

（实际实现根据 LangGraph message 结构调整字段读取方式）

- [ ] **Step 3: 冒烟测试**

手动在浏览器发一条消息，等待 run 完成后刷新会话列表：看到 title 被填充。

- [ ] **Step 4: 提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "feat(assistant): 首条对话完成后异步生成会话标题

- 在 run 完成钩子中检测 scope=assistant + title 为空
- 调 generateSessionTitleAsync 非阻塞生成 ≤20 字标题
- 失败吞异常不影响主路径
- 参见 spec §5.6.1"
```

---

## Task 18: 端到端测试 & 回归

**Files:**
- 全量 vitest 回归
- 手动 E2E 浏览器验证

- [ ] **Step 1: 跑全量 server 端测试**

Run: `npx vitest run tests/server --reporter=verbose`
Expected: 全部 PASS；若有历史 flaky 测试，确认与本次改动无关。

- [ ] **Step 2: 跑全量 app 端测试（如存在）**

Run: `npx vitest run tests/app --reporter=verbose`
Expected: 全部 PASS

- [ ] **Step 3: TypeScript 全量检查**

Run: `npx nuxi typecheck`
Expected: 无错误

- [ ] **Step 4: 启动 dev server 手动 E2E**

Run: `bun dev`

按以下顺序走一遍：
1. 登录
2. 侧边栏看到"法律助手 · 对话"菜单，点击
3. 左侧显示"暂无会话"
4. 点"新对话" → 右侧变可输入
5. 输入"什么是《民法典》"发送 → 看到流式响应
6. 等待回复完成
7. 刷新列表 → 看到新会话（含自动生成的标题）
8. 右键会话 → 重命名为"测试 Q1" → 保存 → 刷新
9. 删除该会话 → 消失
10. 验证积分余额有扣减

如全部通过，进入 Step 5。

- [ ] **Step 5: case 域冒烟（确保没 break）**

1. 打开一个已有 case 进入详情页
2. 在案件对话入口发一条消息 → 应正常响应
3. 查看初始化分析页面 → 应正常工作

若 case 域有问题，排查 Task 3/4/5/6 的改造是否影响到 case 域（TS 编译通过不代表运行正常）。

- [ ] **Step 6: 部署前验证**

```sql
-- 验证 seed
SELECT COUNT(*) FROM nodes WHERE name='assistantMain';                          -- = 1
SELECT COUNT(*) FROM prompts WHERE name='assistantMain_system' AND status=1;    -- = 1
SELECT COUNT(*) FROM point_consumption_rules WHERE item_key='assistant_token';  -- ≥ 1

-- 验证 schema
\d case_sessions  -- 应看到 scope / user_id / title 字段，case_id 为可空
\d agent_runs    -- case_id 应为可空
```

- [ ] **Step 7: 提交 E2E 冒烟报告**

```bash
# 若无代码改动只是测试/验证，可不提交；若修复了测试，提交修复
git status
```

---

## 完成标准

第一期完成当且仅当：
- [ ] 所有 Task 1-18 的 Step 全部打钩
- [ ] `npx vitest run tests/server` 全绿
- [ ] `npx nuxi typecheck` 无错误
- [ ] 手动 E2E 全流程通过
- [ ] 部署前验证 SQL 全部返回预期值
- [ ] case 域冒烟无回归

---

## 相关 Skills（实施时参考）

- @superpowers:test-driven-development - 每个 Task 都是"写失败测试 → 跑失败 → 实现 → 跑通过 → 提交"节奏
- @superpowers:verification-before-completion - 声称 Task 完成前必须跑测试看实际输出，不靠推测
- @superpowers:systematic-debugging - 测试失败时先定位根因，不要为了让测试通过而改测试
- @simplify - 每个 Task 实施完可用此技能审查代码质量

---

## 第二期与第三期的预留锚点（本计划不实施，仅提示）

- nodes.assistantMain.tools 字段在第二期追加 `reviewContract`、第三期追加 `draftDocument`
- `/dashboard/assistant/contract` 和 `/dashboard/assistant/document` 的 WIP 占位页在对应期替换为实际实现
- `InterruptType` 枚举在第二期新增 `AWAITING_STANCE`
- `pointConsumptionRules` 在第二/三期追加 `contract_review_token`、`document_draft_token`

详见 spec §9.2（第二期）与 §9.3（第三期）。
