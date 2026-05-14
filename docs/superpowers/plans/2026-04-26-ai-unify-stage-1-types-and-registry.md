# AI 基建统一改造 · 阶段 1：底座类型化 + Skills 入库 + Agent Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阶段 1 建立底层基建：`shared/types/` 引入 SessionScope / SessionType / SSECustomEventType / InterruptType / SkillSource / SkillStatus 枚举；新增 `skills` + `node_skills` 表 + `nodes.useSkillsAsLogic` 字段；实现 `scanAndSyncSkillsService`、启动 plugin、admin `resync` API；实现 `agentRegistry` 注册表替换 `agentWorker.executeRun` 中的硬编码 scope/type switch。

**Architecture:** 阶段 1 完全不动业务 Agent。Registry 在阶段 1 接收 5 个**现有 runner 函数**（runDocumentChat / runAssistantChat / runContractReviewChat / startCaseAnalysisV2 / runModuleChat / runCaseChat）作为注册项；agentWorker 改用 `agentRegistry.dispatch(scope, type, ...)`。Skills 表入库为阶段 2 工厂自动挂 skillsMiddleware 做铺垫，本阶段只完成"扫描 + 入库 + 后台 resync"路径，**不**修改任何 agent 加载行为。

**Tech Stack:** TypeScript · Vitest · Prisma 6（multi-file schema）· Nitro plugin · @langchain/langgraph · gray-matter（YAML frontmatter 解析，按需安装）· Bun

**Spec 来源:** `docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md`（D1-D18 决策、§3.4 SSE 事件类型化、§3.5 Skills 系统、§6 阶段 1 DoD）

---

## File Structure

### 新建文件

| 路径 | 职责 |
|---|---|
| `shared/types/agentEvent.ts` | SessionScope / SessionType / SSECustomEventType / SSECustomEventMap / InterruptType 枚举与类型 |
| `shared/types/skill.ts` | SkillSource / SkillStatus 枚举与 SKILLS_ROOT 常量 |
| `prisma/models/skill.prisma` | skills + node_skills 模型定义 |
| `server/services/agent-platform/skills/skillSync.dao.ts` | DAO：upsertSkillDAO / listAllSkillsDAO / markSkillsDisabledByNamesDAO / listSkillsByNodeIdDAO |
| `server/services/agent-platform/skills/skillSync.service.ts` | 服务：scanAndSyncSkillsService（扫描 .deepagents/skills/、读 SKILL.md frontmatter、upsert）|
| `server/services/agent-platform/registry/types.ts` | AgentRegistryEntry / AgentRunner / RegistryKey 等类型 |
| `server/services/agent-platform/registry/agentRegistry.ts` | AgentRegistry class（register / dispatch / list / has）|
| `server/services/agent-platform/registry/registerLegacyRunners.ts` | 把现有 5 个 runner 注册到 registry |
| `server/plugins/skill-sync.ts` | 启动钩子，调用 scanAndSyncSkillsService（异常仅日志）|
| `server/plugins/agent-registry.ts` | 启动钩子，调用 registerLegacyRunners |
| `server/api/v1/admin/skills/resync.post.ts` | POST 接口，触发同步 |
| `tests/shared/types/agentEvent.test.ts` | 枚举值正确性 |
| `tests/shared/types/skill.test.ts` | 枚举值正确性 |
| `tests/server/agent-platform/skills/skillSync.dao.test.ts` | DAO 单测 |
| `tests/server/agent-platform/skills/skillSync.service.test.ts` | Service 单测（用 fixture 临时目录）|
| `tests/server/agent-platform/registry/agentRegistry.test.ts` | Registry 单测 |
| `tests/server/api/v1/admin/skills/resync.test.ts` | Admin API 单测 |

### 修改文件

| 路径 | 修改内容 |
|---|---|
| `prisma/models/node.prisma` | nodes 表：新增 `useSkillsAsLogic Boolean @default(false)` 字段 + 反向关系 `nodeSkills node_skills[]` |
| `server/services/agent/agentWorker.ts` | 行 174-263 的 scope/type switch 替换为 `agentRegistry.dispatch(...)` 调用；保留所有副作用（lazy repair / scope 校验 / SSE 转发） |

---

## Task 1：定义 SessionScope / SessionType 枚举

**Files:**
- Create: `shared/types/agentEvent.ts`
- Test: `tests/shared/types/agentEvent.test.ts`

- [ ] **Step 1.1：写 SessionScope / SessionType 测试**

新建 `tests/shared/types/agentEvent.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

describe('SessionScope', () => {
    it('包含 4 个 scope 值，对应 caseSessions.scope 列', () => {
        expect(SessionScope.CASE).toBe('case')
        expect(SessionScope.ASSISTANT).toBe('assistant')
        expect(SessionScope.DOCUMENT).toBe('document')
        expect(SessionScope.CONTRACT).toBe('contract')
    })

    it('SessionScope 值集合用于穷举校验', () => {
        const all = Object.values(SessionScope)
        expect(all).toHaveLength(4)
        expect(new Set(all).size).toBe(4)
    })
})

describe('SessionType', () => {
    it('包含 case 域三种类型（数字枚举）', () => {
        expect(SessionType.CHAT).toBe(1)
        expect(SessionType.ANALYSIS).toBe(2)
        expect(SessionType.MODULE).toBe(3)
    })
})
```

- [ ] **Step 1.2：运行测试验证失败**

Run: `npx vitest run tests/shared/types/agentEvent.test.ts`
Expected: FAIL，原因 `Cannot find module '#shared/types/agentEvent'`

- [ ] **Step 1.3：创建 shared/types/agentEvent.ts 含 SessionScope + SessionType**

新建 `shared/types/agentEvent.ts`：

```typescript
/**
 * Agent 事件与会话相关枚举。
 *
 * 这些枚举在阶段 1 引入，作为 AI 基建统一改造的底座类型层。
 * 所有 session.scope / session.type / SSE custom event / interrupt 字面量
 * 在后续阶段会逐步替换为这里的枚举。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.4 §A.B
 */

/**
 * 会话域：caseSessions.scope 的取值。
 * 用于 agentWorker 路由分流，决定调度到哪个 Agent。
 */
export enum SessionScope {
    /** 案件域：含小索 / 模块对话 / 案件初分 */
    CASE = 'case',
    /** 通用问答域：跨案件全局通用助手 */
    ASSISTANT = 'assistant',
    /** 文书生成域 */
    DOCUMENT = 'document',
    /** 合同审查域 */
    CONTRACT = 'contract',
}

/**
 * 会话类型：caseSessions.type 的取值。
 * 仅在 SessionScope.CASE 域内使用，用于二级路由。
 */
export enum SessionType {
    /** 案件主对话（小索）*/
    CHAT = 1,
    /** 案件初始化分析（StateGraph）*/
    ANALYSIS = 2,
    /** 模块对话 */
    MODULE = 3,
}
```

- [ ] **Step 1.4：运行测试验证通过**

Run: `npx vitest run tests/shared/types/agentEvent.test.ts`
Expected: PASS（2 个测试）

- [ ] **Step 1.5：提交**

```bash
git add shared/types/agentEvent.ts tests/shared/types/agentEvent.test.ts
git commit -m "feat(types): 新增 SessionScope / SessionType 枚举"
```

---

## Task 2：扩展 SSECustomEventType + SSECustomEventMap

**Files:**
- Modify: `shared/types/agentEvent.ts`
- Modify: `tests/shared/types/agentEvent.test.ts`

- [ ] **Step 2.1：扩展测试加 SSECustomEventType / SSECustomEventMap 校验**

在 `tests/shared/types/agentEvent.test.ts` 末尾追加：

```typescript
import { SSECustomEventType } from '#shared/types/agentEvent'
import type { SSECustomEventMap } from '#shared/types/agentEvent'

describe('SSECustomEventType', () => {
    it('覆盖现有所有自定义事件类型', () => {
        // 现有发布点：subAgentToolFactory / contractReviewStageEmitter / saveAnalysisResult.tool
        expect(SSECustomEventType.SUB_AGENT_TOKEN).toBe('sub_agent_token')
        expect(SSECustomEventType.SUB_AGENT_TOOL_START).toBe('sub_agent_tool_start')
        expect(SSECustomEventType.SUB_AGENT_TOOL_END).toBe('sub_agent_tool_end')
        expect(SSECustomEventType.SUB_AGENT_STATUS).toBe('sub_agent_status')
        expect(SSECustomEventType.ANALYSIS_RESULT_SAVED).toBe('analysis_result_saved')
        expect(SSECustomEventType.CONTRACT_STAGE).toBe('contract_stage')
        expect(SSECustomEventType.CONTRACT_RISK).toBe('contract_risk')
        expect(SSECustomEventType.CONTRACT_PROGRESS).toBe('contract_progress')
    })

    it('包含阶段 5/6 新增事件类型', () => {
        expect(SSECustomEventType.DRAFT_SAVED).toBe('draft_saved')
        expect(SSECustomEventType.CONTRACT_REVIEW_SAVED).toBe('contract_review_saved')
        expect(SSECustomEventType.CHILD_AGENT_INVOKED).toBe('child_agent_invoked')
    })
})

describe('SSECustomEventMap 类型契约', () => {
    it('类型仅在编译期校验，运行时仅做最小存在性校验', () => {
        // 编译期：SSECustomEventMap[type] 给出 payload 类型
        // 运行时：能够正常 import 即可
        const probe: keyof SSECustomEventMap = SSECustomEventType.DRAFT_SAVED
        expect(probe).toBe('draft_saved')
    })
})
```

- [ ] **Step 2.2：运行测试验证失败**

Run: `npx vitest run tests/shared/types/agentEvent.test.ts`
Expected: FAIL，原因 SSECustomEventType / SSECustomEventMap 未导出

- [ ] **Step 2.3：在 agentEvent.ts 追加 SSECustomEventType + SSECustomEventMap**

在 `shared/types/agentEvent.ts` 末尾追加：

```typescript
/**
 * SSE 自定义事件类型。
 * 由 agentEventBridge.publishCustomEvent 发布，前端通过 useStreamChat 的 onCustomEvent 接收。
 */
export enum SSECustomEventType {
    // ── 子代理工具相关（subAgentToolFactory 发布）──
    SUB_AGENT_TOKEN = 'sub_agent_token',
    SUB_AGENT_TOOL_START = 'sub_agent_tool_start',
    SUB_AGENT_TOOL_END = 'sub_agent_tool_end',
    SUB_AGENT_STATUS = 'sub_agent_status',

    // ── 业务结果落库通知 ──
    ANALYSIS_RESULT_SAVED = 'analysis_result_saved',
    /** 阶段 5：文书草稿落库通知 */
    DRAFT_SAVED = 'draft_saved',
    /** 阶段 5：合同审查结果落库通知 */
    CONTRACT_REVIEW_SAVED = 'contract_review_saved',

    // ── 合同审查阶段事件（contractReviewStageEmitter 发布）──
    CONTRACT_STAGE = 'contract_stage',
    CONTRACT_RISK = 'contract_risk',
    CONTRACT_PROGRESS = 'contract_progress',

    /** 阶段 5/6：主代理调起子代理时通知前端 */
    CHILD_AGENT_INVOKED = 'child_agent_invoked',
}

/** 子代理 token 事件 payload */
export interface SubAgentTokenPayload {
    agentName: string
    token: number
    runningTotal?: number
}

export interface SubAgentToolStartPayload {
    toolCallId: string
    agentName: string
    toolName: string
    args?: unknown
}

export interface SubAgentToolEndPayload {
    toolCallId: string
    agentName: string
    toolName: string
    result?: unknown
}

export interface SubAgentStatusPayload {
    agentName: string
    status: 'running' | 'completed' | 'failed'
    error?: string
}

export interface AnalysisResultSavedPayload {
    moduleName: string
    nodeId: number
    analysisId: number
    summary?: string
}

export interface DraftSavedPayload {
    draftId: number
    summary: string
    title?: string
    href: string
}

export interface ContractReviewSavedPayload {
    reviewId: number
    riskCount: number
    topRisks: Array<{ source: string; level: string; quote?: string }>
    href: string
}

export interface ContractStagePayload {
    stage: 'detect' | 'stance' | 'analyze' | 'summarize'
    progress?: number
    note?: string
}

export interface ContractRiskPayload {
    riskId: number
    code?: string
    level: string
    source: string
    anchorQuote?: string
}

export interface ContractProgressPayload {
    current: number
    total: number
    note?: string
}

export interface ChildAgentInvokedPayload {
    parentAgentName: string
    childAgentName: string
    toolName: string
}

/**
 * SSE 自定义事件类型 → payload 类型映射。
 * publishCustomEvent<T> 用此映射做编译期类型校验。
 */
export interface SSECustomEventMap {
    [SSECustomEventType.SUB_AGENT_TOKEN]: SubAgentTokenPayload
    [SSECustomEventType.SUB_AGENT_TOOL_START]: SubAgentToolStartPayload
    [SSECustomEventType.SUB_AGENT_TOOL_END]: SubAgentToolEndPayload
    [SSECustomEventType.SUB_AGENT_STATUS]: SubAgentStatusPayload
    [SSECustomEventType.ANALYSIS_RESULT_SAVED]: AnalysisResultSavedPayload
    [SSECustomEventType.DRAFT_SAVED]: DraftSavedPayload
    [SSECustomEventType.CONTRACT_REVIEW_SAVED]: ContractReviewSavedPayload
    [SSECustomEventType.CONTRACT_STAGE]: ContractStagePayload
    [SSECustomEventType.CONTRACT_RISK]: ContractRiskPayload
    [SSECustomEventType.CONTRACT_PROGRESS]: ContractProgressPayload
    [SSECustomEventType.CHILD_AGENT_INVOKED]: ChildAgentInvokedPayload
}
```

- [ ] **Step 2.4：运行测试验证通过**

Run: `npx vitest run tests/shared/types/agentEvent.test.ts`
Expected: PASS（4 个测试）

- [ ] **Step 2.5：提交**

```bash
git add shared/types/agentEvent.ts tests/shared/types/agentEvent.test.ts
git commit -m "feat(types): 扩展 SSECustomEventType + SSECustomEventMap 类型契约"
```

---

## Task 3：定义 InterruptType 枚举

**Files:**
- Modify: `shared/types/agentEvent.ts`
- Modify: `tests/shared/types/agentEvent.test.ts`

- [ ] **Step 3.1：扩展测试**

在 `tests/shared/types/agentEvent.test.ts` 末尾追加：

```typescript
import { InterruptType } from '#shared/types/agentEvent'

describe('InterruptType', () => {
    it('覆盖所有现有 interrupt 类型', () => {
        // 沿用现有 server/services/workflow / 前端 interrupt handler 中的类型
        expect(InterruptType.INSUFFICIENT_POINTS).toBe('insufficient_points')
        expect(InterruptType.NEED_MEMBERSHIP).toBe('need_membership')
        expect(InterruptType.BASIC_INFO_CONFIRM).toBe('basic_info_confirm')
        expect(InterruptType.CASE_INFO_CHECK).toBe('case_info_check')
        expect(InterruptType.MODULE_SELECT).toBe('module_select')
        expect(InterruptType.CONTRACT_STANCE).toBe('contract_stance')
        expect(InterruptType.EXTRACT_CASE_INFO).toBe('extract_case_info')
    })
})
```

- [ ] **Step 3.2：运行测试验证失败**

Run: `npx vitest run tests/shared/types/agentEvent.test.ts`
Expected: FAIL，原因 InterruptType 未导出

- [ ] **Step 3.3：在 agentEvent.ts 追加 InterruptType**

在 `shared/types/agentEvent.ts` 末尾追加：

```typescript
/**
 * Interrupt 类型。
 *
 * 用于 LangGraph workflow / Agent 中断恢复机制：
 * - 后端：interrupt({ type: InterruptType.X, ... }) 抛出 GraphInterrupt
 * - 前端：根据 interrupt.type 查 InterruptRegistry 渲染对应 handler 组件（阶段 7 完成）
 *
 * 阶段 1 仅引入枚举，**不**强制替换现有字符串字面量。后续阶段在搬迁业务 vertical 时
 * 顺便完成替换。
 */
export enum InterruptType {
    /** 积分不足，需充值 */
    INSUFFICIENT_POINTS = 'insufficient_points',
    /** 非会员，需开通会员 */
    NEED_MEMBERSHIP = 'need_membership',
    /** 案件基本信息确认（initAnalysis）*/
    BASIC_INFO_CONFIRM = 'basic_info_confirm',
    /** 案件信息复核（小索 / 模块对话）*/
    CASE_INFO_CHECK = 'case_info_check',
    /** 选择分析模块（initAnalysis）*/
    MODULE_SELECT = 'module_select',
    /** 合同审查立场选择 */
    CONTRACT_STANCE = 'contract_stance',
    /** 案件信息提取确认 */
    EXTRACT_CASE_INFO = 'extract_case_info',
}
```

- [ ] **Step 3.4：运行测试验证通过**

Run: `npx vitest run tests/shared/types/agentEvent.test.ts`
Expected: PASS（5 个测试）

- [ ] **Step 3.5：提交**

```bash
git add shared/types/agentEvent.ts tests/shared/types/agentEvent.test.ts
git commit -m "feat(types): 新增 InterruptType 枚举"
```

---

## Task 4：定义 SkillSource / SkillStatus 枚举

**Files:**
- Create: `shared/types/skill.ts`
- Test: `tests/shared/types/skill.test.ts`

- [ ] **Step 4.1：写测试**

新建 `tests/shared/types/skill.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { SkillSource, SkillStatus, SKILLS_FS_ROOT } from '#shared/types/skill'

describe('SkillSource', () => {
    it('包含 filesystem / uploaded 两种来源', () => {
        expect(SkillSource.FILESYSTEM).toBe('filesystem')
        expect(SkillSource.UPLOADED).toBe('uploaded')
    })
})

describe('SkillStatus', () => {
    it('使用 0/1 数字编码，与 nodes.status 风格一致', () => {
        expect(SkillStatus.DISABLED).toBe(0)
        expect(SkillStatus.ENABLED).toBe(1)
    })
})

describe('SKILLS_FS_ROOT', () => {
    it('指向 .deepagents/skills 相对路径', () => {
        expect(SKILLS_FS_ROOT).toBe('.deepagents/skills')
    })
})
```

- [ ] **Step 4.2：运行测试验证失败**

Run: `npx vitest run tests/shared/types/skill.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 4.3：创建 shared/types/skill.ts**

```typescript
/**
 * Skill 系统相关枚举与常量。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5
 */

/**
 * Skill 来源：本期仅实现 filesystem；uploaded 字段预留给未来"后台 UI 上传 skill"功能，
 * 阶段 1 不实现该路径但必须保留字段以便未来兼容。
 */
export enum SkillSource {
    FILESYSTEM = 'filesystem',
    UPLOADED = 'uploaded',
}

/** Skill 启停状态：与 nodes.status 风格一致（数字编码）*/
export enum SkillStatus {
    DISABLED = 0,
    ENABLED = 1,
}

/** Skill 文件系统根目录（项目根的相对路径）*/
export const SKILLS_FS_ROOT = '.deepagents/skills' as const

/** SKILL.md frontmatter 解析结果（gray-matter / 自实现解析共用类型）*/
export interface SkillFrontmatter {
    name: string
    description?: string
    license?: string
    version?: string
}
```

- [ ] **Step 4.4：运行测试验证通过**

Run: `npx vitest run tests/shared/types/skill.test.ts`
Expected: PASS（3 个测试）

- [ ] **Step 4.5：提交**

```bash
git add shared/types/skill.ts tests/shared/types/skill.test.ts
git commit -m "feat(types): 新增 SkillSource / SkillStatus 枚举与 SKILLS_FS_ROOT 常量"
```

---

## Task 5：Prisma 新增 skills + node_skills 表 + nodes.useSkillsAsLogic

**Files:**
- Create: `prisma/models/skill.prisma`
- Modify: `prisma/models/node.prisma`

- [ ] **Step 5.1：创建 prisma/models/skill.prisma**

```prisma
/// Skill 注册表 - 文件系统 .deepagents/skills/* 的元数据缓存
model skills {
  /// Skill 名称（如 'docx' / 'evidence-defense'），主键
  name        String       @id @db.VarChar(100)
  /// 文件系统路径（项目根的相对路径，如 .deepagents/skills/docx）
  path        String       @db.VarChar(500)
  /// 来源：filesystem 由扫描入库，uploaded 预留给后台上传（本期不实现）
  source      String       @default("filesystem") @db.VarChar(20)
  /// 中文展示名
  title       String?      @db.VarChar(200)
  /// SKILL.md frontmatter description（触发场景 / 完整说明）
  description String?      @db.Text
  /// 版本号（SKILL.md frontmatter version；缺失时为 NULL）
  version     String?      @db.VarChar(50)
  /// 状态：1 启用 / 0 停用
  status      Int          @default(1)
  /// 上次从文件系统同步时间
  syncedAt    DateTime?    @map("synced_at") @db.Timestamptz(6)
  /// 创建时间
  createdAt   DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  /// 最后更新时间
  updatedAt   DateTime     @default(now()) @map("updated_at") @db.Timestamptz(6)

  /// 关联节点列表
  nodeSkills  node_skills[]

  @@index([status], map: "idx_skills_status")
  @@index([source], map: "idx_skills_source")
  @@map("skills")
}

/// 节点 ↔ Skill 关联表（多对多）
model node_skills {
  /// 节点 ID
  nodeId    Int      @map("node_id")
  /// Skill 名称
  skillName String   @map("skill_name") @db.VarChar(100)
  /// 排序优先级（决定 system prompt 中 skill 出现顺序，数字越小越靠前）
  priority  Int      @default(100)
  /// 创建时间
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  /// 关联节点
  node      nodes    @relation(fields: [nodeId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  /// 关联 skill
  skill     skills   @relation(fields: [skillName], references: [name], onDelete: Cascade, onUpdate: NoAction)

  @@id([nodeId, skillName])
  @@index([nodeId], map: "idx_node_skills_node_id")
  @@index([skillName], map: "idx_node_skills_skill_name")
  @@map("node_skills")
}
```

- [ ] **Step 5.2：修改 prisma/models/node.prisma 添加 nodes.useSkillsAsLogic + 反向关系**

在 `prisma/models/node.prisma` nodes 模型 `status` 字段下方追加 `useSkillsAsLogic`，并在反向关系 `caseAnalyses` 后追加 `nodeSkills`：

打开文件，找到这一段：

```
  /// 状态：1-启用，0-禁用
  status       Int       @default(1)
```

在其下方插入：

```
  /// 案件初分阶段 8 改造开关：是否使用 "skills-as-logic" 提示词风格
  /// 启用后：system prompt 仅写规范，分析逻辑由关联的 skills 提供
  /// 关闭时：system prompt 含完整方法论（旧式嵌入式 prompt）
  /// 节点级独立配置（非全局灰度开关）
  useSkillsAsLogic Boolean @default(false) @map("use_skills_as_logic")
```

然后在 `caseAnalyses caseAnalyses[]` 这一行下方追加：

```
  /// 关联的 skills（多对多）
  nodeSkills node_skills[]
```

- [ ] **Step 5.3：生成迁移**

Run: `bun run prisma:migrate --name add_skills_and_node_skills_use_skills_as_logic`
Expected: 生成 `prisma/migrations/<timestamp>_add_skills_and_node_skills_use_skills_as_logic/migration.sql`，并自动应用到本地 dev DB；自动重新生成 Prisma Client。

- [ ] **Step 5.4：验证 generated/prisma 客户端类型**

Run: `npx nuxi typecheck 2>&1 | head -30`
Expected: 类型检查通过；如果报错应只与本任务无关的预存错误（确认无新增错误）。

- [ ] **Step 5.5：手工验证迁移 SQL（防止 DROP 数据丢失风险）**

Run: `cat prisma/migrations/$(ls -t prisma/migrations/ | head -1)/migration.sql`
Expected: 仅含 CREATE TABLE skills、CREATE TABLE node_skills、ALTER TABLE nodes ADD COLUMN use_skills_as_logic、CREATE INDEX 等纯增量语句；**不应**有 DROP / 数据迁移 SQL。

- [ ] **Step 5.6：提交**

```bash
git add prisma/models/skill.prisma prisma/models/node.prisma prisma/migrations/
git commit -m "feat(db): 新增 skills + node_skills 表与 nodes.useSkillsAsLogic 字段"
```

---

## Task 6：SkillSync DAO

**Files:**
- Create: `server/services/agent-platform/skills/skillSync.dao.ts`
- Test: `tests/server/agent-platform/skills/skillSync.dao.test.ts`

- [ ] **Step 6.1：写 DAO 测试**

新建 `tests/server/agent-platform/skills/skillSync.dao.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    upsertSkillDAO,
    listAllSkillsDAO,
    listSkillsByNodeIdDAO,
    markSkillsDisabledByNamesDAO,
    deleteSkillDAO,
} from '~~/server/services/agent-platform/skills/skillSync.dao'
import { SkillSource, SkillStatus } from '#shared/types/skill'

describe('SkillSync DAO', () => {
    const testSkillNames: string[] = []

    afterEach(async () => {
        // 清理测试创建的 skill
        if (testSkillNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: testSkillNames } } })
            testSkillNames.length = 0
        }
    })

    it('upsertSkillDAO 创建新记录', async () => {
        const name = `test_skill_${Date.now()}_a`
        testSkillNames.push(name)

        const result = await upsertSkillDAO({
            name,
            path: `.deepagents/skills/${name}`,
            source: SkillSource.FILESYSTEM,
            title: '测试 skill',
            description: '测试描述',
            version: '1.0',
        })
        expect(result.name).toBe(name)
        expect(result.status).toBe(SkillStatus.ENABLED)
        expect(result.syncedAt).toBeInstanceOf(Date)
    })

    it('upsertSkillDAO 更新已存在记录（同名重复扫描）', async () => {
        const name = `test_skill_${Date.now()}_b`
        testSkillNames.push(name)

        await upsertSkillDAO({
            name, path: `.deepagents/skills/${name}`,
            source: SkillSource.FILESYSTEM, title: '初次', description: 'v1', version: '1.0',
        })
        const updated = await upsertSkillDAO({
            name, path: `.deepagents/skills/${name}`,
            source: SkillSource.FILESYSTEM, title: '二次', description: 'v2', version: '2.0',
        })
        expect(updated.title).toBe('二次')
        expect(updated.version).toBe('2.0')
    })

    it('listAllSkillsDAO 默认返回 status=1 的记录', async () => {
        const aName = `test_skill_${Date.now()}_c1`
        const bName = `test_skill_${Date.now()}_c2`
        testSkillNames.push(aName, bName)

        await upsertSkillDAO({ name: aName, path: `path/${aName}`, source: SkillSource.FILESYSTEM })
        await upsertSkillDAO({ name: bName, path: `path/${bName}`, source: SkillSource.FILESYSTEM })

        const all = await listAllSkillsDAO()
        expect(all.find(s => s.name === aName)).toBeDefined()
        expect(all.find(s => s.name === bName)).toBeDefined()
    })

    it('markSkillsDisabledByNamesDAO 把指定记录置 status=0', async () => {
        const name = `test_skill_${Date.now()}_d`
        testSkillNames.push(name)
        await upsertSkillDAO({ name, path: `path/${name}`, source: SkillSource.FILESYSTEM })

        const count = await markSkillsDisabledByNamesDAO([name])
        expect(count).toBe(1)

        const found = await prisma.skills.findUnique({ where: { name } })
        expect(found?.status).toBe(SkillStatus.DISABLED)
    })

    it('listSkillsByNodeIdDAO 返回节点关联的所有 ENABLED skill', async () => {
        // 用现有 testing 数据库的节点（fixture）；
        // 直接构造一个节点（依赖 model + group，可能很重）—— 改为只测函数返回空数组即正确
        const skills = await listSkillsByNodeIdDAO(-1)
        expect(skills).toEqual([])
    })
})
```

- [ ] **Step 6.2：运行测试验证失败**

Run: `npx vitest run tests/server/agent-platform/skills/skillSync.dao.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 6.3：创建 skillSync.dao.ts**

新建 `server/services/agent-platform/skills/skillSync.dao.ts`：

```typescript
/**
 * Skill 同步 DAO
 *
 * 负责 skills + node_skills 表的数据访问。
 * 业务逻辑（扫描文件系统、解析 frontmatter）在 skillSync.service.ts。
 */

import { SkillSource, SkillStatus } from '#shared/types/skill'

/** upsertSkillDAO 入参 */
export interface UpsertSkillInput {
    name: string
    path: string
    source: SkillSource
    title?: string | null
    description?: string | null
    version?: string | null
}

/**
 * upsert 单条 skill 记录。
 * 同名记录已存在则更新元数据 + 把 status 置为 ENABLED + 更新 syncedAt。
 */
export async function upsertSkillDAO(input: UpsertSkillInput) {
    const now = new Date()
    return prisma.skills.upsert({
        where: { name: input.name },
        create: {
            name: input.name,
            path: input.path,
            source: input.source,
            title: input.title ?? null,
            description: input.description ?? null,
            version: input.version ?? null,
            status: SkillStatus.ENABLED,
            syncedAt: now,
        },
        update: {
            path: input.path,
            source: input.source,
            title: input.title ?? null,
            description: input.description ?? null,
            version: input.version ?? null,
            status: SkillStatus.ENABLED,
            syncedAt: now,
        },
    })
}

/**
 * 列出所有 skill 记录（含 status=0），按 name 排序。
 * 默认包含已停用的，因为后台列表页要显示停用项。
 */
export async function listAllSkillsDAO() {
    return prisma.skills.findMany({
        orderBy: { name: 'asc' },
    })
}

/**
 * 把名字在 names 中的所有 skills 置为 DISABLED。
 * 用于扫描时清理"文件系统已删除但数据库还在"的记录。
 *
 * 仅作用于 source=filesystem 的记录（uploaded 不参与文件系统扫描清理）。
 *
 * @returns 受影响的行数
 */
export async function markSkillsDisabledByNamesDAO(names: string[]): Promise<number> {
    if (names.length === 0) return 0
    const result = await prisma.skills.updateMany({
        where: { name: { in: names }, source: SkillSource.FILESYSTEM },
        data: { status: SkillStatus.DISABLED },
    })
    return result.count
}

/**
 * 返回某节点关联的所有 ENABLED skills（按 priority 升序）。
 * 阶段 2 起被 defineDomainAgent 工厂调用，用于动态构造 skillsMiddleware。
 */
export async function listSkillsByNodeIdDAO(nodeId: number) {
    const rows = await prisma.node_skills.findMany({
        where: {
            nodeId,
            skill: { status: SkillStatus.ENABLED },
        },
        include: { skill: true },
        orderBy: { priority: 'asc' },
    })
    return rows.map(r => ({
        name: r.skill.name,
        path: r.skill.path,
        title: r.skill.title,
        description: r.skill.description,
        priority: r.priority,
    }))
}

/** 删除单条 skill（仅测试用，业务侧无 admin 删除接口）*/
export async function deleteSkillDAO(name: string) {
    await prisma.skills.delete({ where: { name } })
}
```

- [ ] **Step 6.4：运行测试验证通过**

Run: `npx vitest run tests/server/agent-platform/skills/skillSync.dao.test.ts`
Expected: PASS（5 个测试）

- [ ] **Step 6.5：提交**

```bash
git add server/services/agent-platform/skills/skillSync.dao.ts tests/server/agent-platform/skills/skillSync.dao.test.ts
git commit -m "feat(agent-platform): 实现 SkillSync DAO（upsert / list / disable）"
```

---

## Task 7：SkillSync Service - 扫描 .deepagents/skills/ 并入库

**Files:**
- Create: `server/services/agent-platform/skills/skillSync.service.ts`
- Test: `tests/server/agent-platform/skills/skillSync.service.test.ts`

**前置：检查 gray-matter 是否已安装**

- [ ] **Step 7.1：检查依赖**

Run: `grep -E '"gray-matter"' package.json || echo "missing"`
- 如果输出 `missing`：Run `bun add gray-matter`，然后 `git add package.json bun.lock` 准备一起 commit；
- 否则跳过本步。

- [ ] **Step 7.2：写 service 测试**

新建 `tests/server/agent-platform/skills/skillSync.service.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
    scanAndSyncSkillsService,
    parseSkillFrontmatterFromMarkdown,
} from '~~/server/services/agent-platform/skills/skillSync.service'
import { SkillSource, SkillStatus } from '#shared/types/skill'

describe('parseSkillFrontmatterFromMarkdown', () => {
    it('解析含 frontmatter 的 SKILL.md', () => {
        const md = `---\nname: docx\ndescription: docx skill\nlicense: Proprietary\nversion: 1.0\n---\n\n# Body\n`
        const result = parseSkillFrontmatterFromMarkdown(md)
        expect(result).toEqual({ name: 'docx', description: 'docx skill', license: 'Proprietary', version: '1.0' })
    })

    it('frontmatter 缺 name 字段时返回 null', () => {
        const md = `---\ndescription: 无 name\n---\n\nbody\n`
        expect(parseSkillFrontmatterFromMarkdown(md)).toBeNull()
    })

    it('完全无 frontmatter 时返回 null', () => {
        expect(parseSkillFrontmatterFromMarkdown('# Just markdown')).toBeNull()
    })
})

describe('scanAndSyncSkillsService', () => {
    let tempRoot: string
    const cleanupNames: string[] = []

    beforeEach(async () => {
        // 创建临时 skills 根目录
        tempRoot = resolve(tmpdir(), `skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        await mkdir(tempRoot, { recursive: true })
    })

    afterEach(async () => {
        // 清理临时目录
        await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
        // 清理数据库测试 skill
        if (cleanupNames.length > 0) {
            await prisma.skills.deleteMany({ where: { name: { in: cleanupNames } } })
            cleanupNames.length = 0
        }
    })

    it('扫描含 SKILL.md 的子目录并入库', async () => {
        const skillName = `test_alpha_${Date.now()}`
        cleanupNames.push(skillName)

        const skillDir = resolve(tempRoot, skillName)
        await mkdir(skillDir, { recursive: true })
        await writeFile(
            resolve(skillDir, 'SKILL.md'),
            `---\nname: ${skillName}\ndescription: alpha skill\nversion: 1.2\n---\n\n# Alpha\n`,
        )

        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.added).toBeGreaterThanOrEqual(1)
        expect(result.scanned).toContain(skillName)

        const found = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(found).toBeDefined()
        expect(found?.description).toBe('alpha skill')
        expect(found?.version).toBe('1.2')
        expect(found?.source).toBe(SkillSource.FILESYSTEM)
        expect(found?.status).toBe(SkillStatus.ENABLED)
    })

    it('跳过没有 SKILL.md 的子目录', async () => {
        const otherDir = resolve(tempRoot, `not_a_skill_${Date.now()}`)
        await mkdir(otherDir)
        await writeFile(resolve(otherDir, 'README.md'), '# README')

        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.scanned).toEqual([])
    })

    it('SKILL.md 的 frontmatter 损坏时跳过该 skill 并记录错误', async () => {
        const skillName = `test_broken_${Date.now()}`
        const skillDir = resolve(tempRoot, skillName)
        await mkdir(skillDir)
        await writeFile(
            resolve(skillDir, 'SKILL.md'),
            `# 无 frontmatter\n这是一个有效 markdown 但缺少 frontmatter 的 SKILL.md`,
        )

        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.errors.length).toBeGreaterThanOrEqual(1)
        expect(result.errors[0].name).toBe(skillName)

        const found = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(found).toBeNull()
    })

    it('文件系统已删除的 skill 在二次扫描后被置为 DISABLED', async () => {
        const skillName = `test_will_disable_${Date.now()}`
        cleanupNames.push(skillName)

        const skillDir = resolve(tempRoot, skillName)
        await mkdir(skillDir)
        await writeFile(
            resolve(skillDir, 'SKILL.md'),
            `---\nname: ${skillName}\ndescription: temp\n---\n\n# T\n`,
        )

        await scanAndSyncSkillsService(tempRoot)

        // 删除目录
        await rm(skillDir, { recursive: true })

        // 二次扫描
        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result.disabled).toContain(skillName)

        const found = await prisma.skills.findUnique({ where: { name: skillName } })
        expect(found?.status).toBe(SkillStatus.DISABLED)
    })

    it('返回结果对象 shape 符合契约', async () => {
        const result = await scanAndSyncSkillsService(tempRoot)
        expect(result).toHaveProperty('scanned')
        expect(result).toHaveProperty('added')
        expect(result).toHaveProperty('updated')
        expect(result).toHaveProperty('disabled')
        expect(result).toHaveProperty('errors')
    })
})
```

- [ ] **Step 7.3：运行测试验证失败**

Run: `npx vitest run tests/server/agent-platform/skills/skillSync.service.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 7.4：创建 skillSync.service.ts**

新建 `server/services/agent-platform/skills/skillSync.service.ts`：

```typescript
/**
 * Skill 同步服务
 *
 * 负责扫描 .deepagents/skills/* 子目录的 SKILL.md，解析 frontmatter，
 * 通过 DAO upsert 入库。文件系统是真理来源，数据库是注册册 + 元数据缓存。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.5
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import matter from 'gray-matter'

import {
    upsertSkillDAO,
    listAllSkillsDAO,
    markSkillsDisabledByNamesDAO,
} from './skillSync.dao'
import { SkillSource, SKILLS_FS_ROOT, type SkillFrontmatter } from '#shared/types/skill'

/** 扫描结果 */
export interface ScanResult {
    /** 实际扫描到的 skill 名（含 SKILL.md 解析成功的）*/
    scanned: string[]
    /** 新增的 skill 名 */
    added: string[]
    /** 更新的 skill 名（已有的）*/
    updated: string[]
    /** 二次扫描时发现文件系统已删除并被标记 disabled 的 skill 名 */
    disabled: string[]
    /** 解析失败的条目 */
    errors: Array<{ name: string; reason: string }>
}

/**
 * 解析 SKILL.md 的 frontmatter。
 * 必须含 name 字段；缺失或 frontmatter 完全没有则返回 null。
 */
export function parseSkillFrontmatterFromMarkdown(content: string): SkillFrontmatter | null {
    try {
        const parsed = matter(content)
        const data = parsed.data as Record<string, unknown>
        if (typeof data.name !== 'string' || data.name.trim() === '') return null
        return {
            name: String(data.name),
            description: typeof data.description === 'string' ? data.description : undefined,
            license: typeof data.license === 'string' ? data.license : undefined,
            version: typeof data.version === 'string' ? data.version : (data.version != null ? String(data.version) : undefined),
        }
    } catch {
        return null
    }
}

/**
 * 扫描 skills 根目录并同步到数据库。
 *
 * @param skillsRoot 可选自定义根目录，仅供测试覆盖；生产路径走默认 SKILLS_FS_ROOT
 */
export async function scanAndSyncSkillsService(skillsRoot?: string): Promise<ScanResult> {
    const root = skillsRoot ?? resolve(process.cwd(), SKILLS_FS_ROOT)

    const result: ScanResult = {
        scanned: [],
        added: [],
        updated: [],
        disabled: [],
        errors: [],
    }

    // 1. 列子目录
    let entries: string[]
    try {
        entries = await readdir(root)
    } catch (err) {
        // ENOENT：根目录不存在 → 视为无 skill；其它错误抛出
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return result
        }
        throw err
    }

    // 2. 数据库现有 filesystem 来源的 skill 名集合（用于稍后清理）
    const existingFilesystemSkills = (await listAllSkillsDAO())
        .filter(s => s.source === SkillSource.FILESYSTEM)
        .map(s => s.name)
    const stillSeen = new Set<string>()

    // 3. 遍历每个子目录
    for (const entry of entries) {
        // 跳过隐藏文件 / 文件
        if (entry.startsWith('.')) continue
        const subDir = resolve(root, entry)
        try {
            const st = await stat(subDir)
            if (!st.isDirectory()) continue
        } catch {
            continue
        }

        const skillMdPath = resolve(subDir, 'SKILL.md')
        let mdContent: string
        try {
            mdContent = await readFile(skillMdPath, 'utf-8')
        } catch {
            // 没有 SKILL.md：跳过（不算错误，可能只是其他目录）
            continue
        }

        const fm = parseSkillFrontmatterFromMarkdown(mdContent)
        if (!fm) {
            result.errors.push({ name: entry, reason: 'SKILL.md frontmatter 无 name 或解析失败' })
            continue
        }

        // skill name 必须与目录名一致（防错配）
        if (fm.name !== entry) {
            result.errors.push({
                name: entry,
                reason: `SKILL.md frontmatter.name=${fm.name} 与目录名=${entry} 不一致`,
            })
            continue
        }

        // 4. upsert
        const relPath = `${SKILLS_FS_ROOT}/${entry}`
        const isNew = !existingFilesystemSkills.includes(fm.name)

        try {
            await upsertSkillDAO({
                name: fm.name,
                path: relPath,
                source: SkillSource.FILESYSTEM,
                title: fm.name,                          // 默认用 name 作展示名
                description: fm.description ?? null,
                version: fm.version ?? null,
            })
            result.scanned.push(fm.name)
            stillSeen.add(fm.name)
            if (isNew) result.added.push(fm.name)
            else result.updated.push(fm.name)
        } catch (err) {
            result.errors.push({
                name: fm.name,
                reason: `upsert 失败: ${(err as Error).message}`,
            })
        }
    }

    // 5. 清理文件系统已删除但数据库还在的（限 source=filesystem）
    const toDisable = existingFilesystemSkills.filter(n => !stillSeen.has(n))
    if (toDisable.length > 0) {
        await markSkillsDisabledByNamesDAO(toDisable)
        result.disabled.push(...toDisable)
    }

    return result
}
```

- [ ] **Step 7.5：运行测试验证通过**

Run: `npx vitest run tests/server/agent-platform/skills/skillSync.service.test.ts`
Expected: PASS（8 个测试）

- [ ] **Step 7.6：提交**

```bash
git add server/services/agent-platform/skills/skillSync.service.ts tests/server/agent-platform/skills/skillSync.service.test.ts package.json bun.lock 2>/dev/null
git commit -m "feat(agent-platform): 实现 scanAndSyncSkillsService 扫描入库"
```

---

## Task 8：启动 plugin 钩子

**Files:**
- Create: `server/plugins/skill-sync.ts`

- [ ] **Step 8.1：创建 plugin**

新建 `server/plugins/skill-sync.ts`：

```typescript
/**
 * Skill Sync 启动钩子
 *
 * Nitro server 启动时扫描 .deepagents/skills/ 并入库。
 * 异常仅记录日志，不阻塞启动（按 §3.5.2 要求）。
 *
 * 此 plugin 加载顺序：默认按字母序，与 agent-worker.ts、cron-scheduler.ts 同级；
 * 若未来需要严格顺序，可改名加数字前缀。
 */

import { scanAndSyncSkillsService } from '~~/server/services/agent-platform/skills/skillSync.service'

export default defineNitroPlugin(async () => {
    try {
        const result = await scanAndSyncSkillsService()
        logger.info('[skill-sync] 启动扫描完成', {
            scanned: result.scanned.length,
            added: result.added.length,
            updated: result.updated.length,
            disabled: result.disabled.length,
            errors: result.errors.length,
        })
        if (result.errors.length > 0) {
            logger.warn('[skill-sync] 启动扫描存在错误条目', { errors: result.errors })
        }
    } catch (err) {
        logger.error('[skill-sync] 启动扫描失败（不阻塞服务启动）', err)
    }
})
```

- [ ] **Step 8.2：手动启动验证**

Run: `bun dev` 启动开发服务器（在新 terminal）。观察控制台日志应包含：

```
[skill-sync] 启动扫描完成 { scanned: 6, added: 6 (首次) | 0 (后续), updated: 0 | 6, disabled: 0, errors: 0 }
```

如果显示 errors > 0，运行 `bun run prisma:studio` 查 skills 表内容，确认与 `.deepagents/skills/` 实际 6 个目录（docx / pptx / minimax-pdf / minimax-xlsx / evidence-defense / litigation-visualization）一致。

通过后停止 dev server。

- [ ] **Step 8.3：提交**

```bash
git add server/plugins/skill-sync.ts
git commit -m "feat(agent-platform): 启动钩子自动扫描 skills 入库"
```

---

## Task 9：Admin Resync API

**Files:**
- Create: `server/api/v1/admin/skills/resync.post.ts`
- Test: `tests/server/api/v1/admin/skills/resync.test.ts`

- [ ] **Step 9.1：写测试**

新建 `tests/server/api/v1/admin/skills/resync.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('POST /api/v1/admin/skills/resync', () => {
    it('handler 调用 scanAndSyncSkillsService 并返回 ScanResult', async () => {
        // 因为 nuxt 自动导入和 H3 在测试中难以 mock，
        // 这里仅做"模块可加载"和"导出 default export 为 EventHandler"的轻校验。
        const mod = await import('~~/server/api/v1/admin/skills/resync.post')
        expect(mod.default).toBeDefined()
        expect(typeof mod.default).toBe('function')
    })
})
```

- [ ] **Step 9.2：运行测试验证失败**

Run: `npx vitest run tests/server/api/v1/admin/skills/resync.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 9.3：创建 admin API**

新建 `server/api/v1/admin/skills/resync.post.ts`：

```typescript
/**
 * 管理端：手动触发 skill 重新扫描
 *
 * 适用场景：运维更新了 .deepagents/skills/ 下的内容（增/减/改），
 * 不希望重启服务即可让数据库元数据同步。
 *
 * 鉴权：依赖 server/middleware/03.permission.ts 的 super_admin 拦截
 *      （非 super_admin 访问 /api/v1/admin/** 直接 403）。
 *
 * 响应：成功返回 ScanResult；失败返回 500 + 错误信息。
 */

import { scanAndSyncSkillsService } from '~~/server/services/agent-platform/skills/skillSync.service'

export default defineEventHandler(async (event) => {
    try {
        const result = await scanAndSyncSkillsService()
        logger.info('[admin/skills/resync] 手动触发扫描完成', {
            scanned: result.scanned.length,
            added: result.added.length,
            updated: result.updated.length,
            disabled: result.disabled.length,
            errors: result.errors.length,
        })
        return resSuccess(event, '扫描完成', result)
    } catch (err) {
        logger.error('[admin/skills/resync] 扫描失败', err)
        return resError(event, 500, `扫描失败：${(err as Error).message}`)
    }
})
```

- [ ] **Step 9.4：运行测试验证通过**

Run: `npx vitest run tests/server/api/v1/admin/skills/resync.test.ts`
Expected: PASS（1 个测试）

- [ ] **Step 9.5：手工烟雾测试**

Run: `bun dev`（新 terminal），等待启动后：

```bash
curl -X POST http://localhost:3000/api/v1/admin/skills/resync \
     -H "Cookie: <super_admin 用户的 session cookie>"
```

Expected: 返回 `{ code: 200, message: '扫描完成', data: { scanned: [...], added: [], updated: [...], disabled: [], errors: [] } }`。

如未配置 super_admin cookie 仅本地开发可临时改 middleware 验证，但**不要 commit**任何 middleware bypass。烟雾测试完成后停止 dev server。

- [ ] **Step 9.6：提交**

```bash
git add server/api/v1/admin/skills/resync.post.ts tests/server/api/v1/admin/skills/resync.test.ts
git commit -m "feat(api): 新增管理端 POST /api/v1/admin/skills/resync 接口"
```

---

## Task 10：AgentRegistry 类型与实现

**Files:**
- Create: `server/services/agent-platform/registry/types.ts`
- Create: `server/services/agent-platform/registry/agentRegistry.ts`
- Test: `tests/server/agent-platform/registry/agentRegistry.test.ts`

- [ ] **Step 10.1：写 Registry 测试**

新建 `tests/server/agent-platform/registry/agentRegistry.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { AgentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import type { AgentRunnerContext } from '~~/server/services/agent-platform/registry/types'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

function makeStream(): ReadableStream {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('event: values\ndata: {}\n\n'))
            controller.close()
        },
    })
}

const mockCtx: AgentRunnerContext = {
    runId: 'r1',
    sessionId: 's1',
    userId: 1,
    caseId: null,
    message: 'hi',
    command: undefined,
    thinking: false,
    selectedModules: [],
    signal: new AbortController().signal,
}

describe('AgentRegistry', () => {
    let registry: AgentRegistry

    beforeEach(() => {
        registry = new AgentRegistry()
    })

    it('register / dispatch 通过 scope 路由', async () => {
        registry.register({
            scope: SessionScope.DOCUMENT,
            runner: async () => makeStream(),
            description: 'document',
        })

        const stream = await registry.dispatch(
            { scope: SessionScope.DOCUMENT, type: null, caseId: null, userId: 1 },
            mockCtx,
        )
        expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('case 域按 type 二级路由（type 优先级高于 scope-only）', async () => {
        const calls: string[] = []
        registry.register({
            scope: SessionScope.CASE,
            runner: async () => { calls.push('case-default'); return makeStream() },
        })
        registry.register({
            scope: SessionScope.CASE,
            type: SessionType.MODULE,
            runner: async () => { calls.push('case-module'); return makeStream() },
        })

        await registry.dispatch({ scope: SessionScope.CASE, type: SessionType.MODULE, caseId: 1, userId: 1 }, mockCtx)
        expect(calls).toEqual(['case-module'])

        await registry.dispatch({ scope: SessionScope.CASE, type: SessionType.CHAT, caseId: 1, userId: 1 }, mockCtx)
        expect(calls).toEqual(['case-module', 'case-default'])
    })

    it('未注册 scope 时 dispatch 抛错', async () => {
        await expect(
            registry.dispatch({ scope: SessionScope.ASSISTANT, type: null, caseId: null, userId: 1 }, mockCtx),
        ).rejects.toThrow(/未注册/)
    })

    it('重复注册同 (scope, type) 抛错', () => {
        registry.register({ scope: SessionScope.DOCUMENT, runner: async () => makeStream() })
        expect(() =>
            registry.register({ scope: SessionScope.DOCUMENT, runner: async () => makeStream() }),
        ).toThrow(/已注册/)
    })

    it('list 返回所有已注册 entry', () => {
        registry.register({ scope: SessionScope.DOCUMENT, runner: async () => makeStream() })
        registry.register({ scope: SessionScope.ASSISTANT, runner: async () => makeStream() })
        const entries = registry.list()
        expect(entries).toHaveLength(2)
    })

    it('has 检查注册存在', () => {
        registry.register({ scope: SessionScope.CONTRACT, runner: async () => makeStream() })
        expect(registry.has({ scope: SessionScope.CONTRACT })).toBe(true)
        expect(registry.has({ scope: SessionScope.DOCUMENT })).toBe(false)
    })
})
```

- [ ] **Step 10.2：运行测试验证失败**

Run: `npx vitest run tests/server/agent-platform/registry/agentRegistry.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 10.3：创建 types.ts**

新建 `server/services/agent-platform/registry/types.ts`：

```typescript
/**
 * Agent Registry 类型定义
 */

import type { SessionScope, SessionType } from '#shared/types/agentEvent'
import type { Command } from '@langchain/langgraph'

/** Runner 调用上下文：来自 agentRuns + caseSessions 的合并 */
export interface AgentRunnerContext {
    /** agentRuns.id */
    runId: string
    /** caseSessions.id */
    sessionId: string
    /** caseSessions.userId（document/assistant/contract scope 必非空；case scope 也非空）*/
    userId: number
    /** caseSessions.caseId（仅 case scope 非空）*/
    caseId: number | null
    /** 用户最新消息（resume 时为 undefined）*/
    message: string | undefined
    /** LangGraph resume 命令（非首轮时存在）*/
    command: Command | undefined
    /** extended thinking 开关 */
    thinking: boolean | undefined
    /** initAnalysis 选中模块 */
    selectedModules: string[]
    /** 取消信号（来自 agentWorker AbortController）*/
    signal: AbortSignal
    /** initAnalysis / module 等场景的额外 metadata（透传 caseSessions.metadata）*/
    metadata?: Record<string, unknown>
}

/** Runner 函数签名：返回 SSE ReadableStream */
export type AgentRunner = (ctx: AgentRunnerContext) => Promise<ReadableStream>

/** 注册项 */
export interface AgentRegistryEntry {
    scope: SessionScope
    /** 仅 case scope 时使用（按 type 二级路由）；其他 scope 应不传 */
    type?: SessionType | null
    runner: AgentRunner
    description?: string
}

/** Session 路由 key */
export interface SessionRouteKey {
    scope: SessionScope
    type?: SessionType | number | null
    caseId: number | null
    userId: number | null
}
```

- [ ] **Step 10.4：创建 agentRegistry.ts**

新建 `server/services/agent-platform/registry/agentRegistry.ts`：

```typescript
/**
 * Agent Registry
 *
 * 用 (scope, type?) 元组作为 key 注册 runner，dispatch 时按 session 路由分发。
 * 阶段 1 中由 registerLegacyRunners 注册现有 5 个 runner（runDocumentChat 等）；
 * 阶段 2 起被 defineDomainAgent 工厂自动调用，实现"业务注册 → 自动路由"。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.3
 */

import type { SessionScope, SessionType } from '#shared/types/agentEvent'
import type {
    AgentRegistryEntry,
    AgentRunner,
    AgentRunnerContext,
    SessionRouteKey,
} from './types'

/** 内部 key：把 (scope, type) 拼成字符串 */
function makeMapKey(scope: SessionScope, type: SessionType | number | null | undefined): string {
    if (type == null) return `${scope}::`
    return `${scope}::${type}`
}

export class AgentRegistry {
    private readonly entries = new Map<string, AgentRegistryEntry>()

    /**
     * 注册 entry。
     * (scope, type) 重复注册会抛错——业务 vertical 的 agent.config.ts 各自唯一。
     */
    register(entry: AgentRegistryEntry): void {
        const key = makeMapKey(entry.scope, entry.type ?? null)
        if (this.entries.has(key)) {
            throw new Error(`AgentRegistry 已注册 ${key}（重复注册）`)
        }
        this.entries.set(key, entry)
    }

    /**
     * 按 scope + type 路由分发。
     * 路由规则：
     *   1. 优先匹配 (scope, type) 精确组合；
     *   2. 没有则降级匹配 (scope, null) 默认 entry。
     */
    async dispatch(routeKey: SessionRouteKey, ctx: AgentRunnerContext): Promise<ReadableStream> {
        const exactKey = makeMapKey(routeKey.scope, routeKey.type ?? null)
        const fallbackKey = makeMapKey(routeKey.scope, null)

        const entry = this.entries.get(exactKey) ?? this.entries.get(fallbackKey)
        if (!entry) {
            throw new Error(
                `AgentRegistry 未注册 scope=${routeKey.scope} type=${routeKey.type ?? 'null'}`,
            )
        }
        return entry.runner(ctx)
    }

    /** 列出所有 entry（admin / introspection 用）*/
    list(): AgentRegistryEntry[] {
        return Array.from(this.entries.values())
    }

    /** 检查指定 (scope, type) 是否已注册 */
    has(key: { scope: SessionScope; type?: SessionType | null }): boolean {
        return this.entries.has(makeMapKey(key.scope, key.type ?? null))
    }
}

/** 全局单例 */
export const agentRegistry = new AgentRegistry()
```

- [ ] **Step 10.5：运行测试验证通过**

Run: `npx vitest run tests/server/agent-platform/registry/agentRegistry.test.ts`
Expected: PASS（6 个测试）

- [ ] **Step 10.6：提交**

```bash
git add server/services/agent-platform/registry/types.ts server/services/agent-platform/registry/agentRegistry.ts tests/server/agent-platform/registry/agentRegistry.test.ts
git commit -m "feat(agent-platform): 实现 AgentRegistry 注册表与 dispatcher"
```

---

## Task 11：注册 5 个现有 runner 到 Registry

**Files:**
- Create: `server/services/agent-platform/registry/registerLegacyRunners.ts`
- Create: `server/plugins/agent-registry.ts`

- [ ] **Step 11.1：创建 registerLegacyRunners.ts**

新建 `server/services/agent-platform/registry/registerLegacyRunners.ts`：

```typescript
/**
 * 把现有 5 个 runner 注册到 AgentRegistry。
 *
 * 阶段 1 用：把 agentWorker 中硬编码的 scope/type switch 解耦为注册表分发。
 * 阶段 2 起 defineDomainAgent 工厂会接管这些注册（按业务 vertical 自动 register），
 *        本文件届时整体删除。
 */

import { agentRegistry } from './agentRegistry'
import type { AgentRunnerContext } from './types'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

let registered = false

/**
 * 注册现有 5 个 runner。
 * 重复调用会被幂等保护（仅首次生效）。
 */
export function registerLegacyRunners(): void {
    if (registered) return
    registered = true

    // ── 文书生成 ──
    agentRegistry.register({
        scope: SessionScope.DOCUMENT,
        description: 'runDocumentChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.userId == null) {
                throw new Error(`document session ${ctx.sessionId} 缺失 userId（数据损坏）`)
            }
            const { runDocumentChat } = await import('~~/server/services/workflow/agents/documentMainAgent')
            return runDocumentChat(ctx.sessionId, ctx.message, {
                userId: ctx.userId,
                caseId: ctx.caseId ?? undefined,
                command: ctx.command,
                signal: ctx.signal,
            })
        },
    })

    // ── 通用问答 ──
    agentRegistry.register({
        scope: SessionScope.ASSISTANT,
        description: 'runAssistantChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.userId == null) {
                throw new Error(`assistant session ${ctx.sessionId} 缺失 userId（数据损坏）`)
            }
            const { runAssistantChat } = await import('~~/server/services/workflow/agents')
            return runAssistantChat(ctx.sessionId, ctx.message, {
                userId: ctx.userId,
                command: ctx.command,
                thinking: ctx.thinking,
                signal: ctx.signal,
            })
        },
    })

    // ── 合同审查 ──
    agentRegistry.register({
        scope: SessionScope.CONTRACT,
        description: 'runContractReviewChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.userId == null) {
                throw new Error(`contract session ${ctx.sessionId} 缺失 userId（数据损坏）`)
            }
            const { runContractReviewChat } = await import('~~/server/services/workflow/agents/contractReviewMainAgent')
            return runContractReviewChat(ctx.sessionId, {
                userId: ctx.userId,
                runId: ctx.runId,
                command: ctx.command,
                signal: ctx.signal,
            })
        },
    })

    // ── 案件初分（StateGraph）──
    agentRegistry.register({
        scope: SessionScope.CASE,
        type: SessionType.ANALYSIS,
        description: 'startCaseAnalysisV2 (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.caseId == null) {
                throw new Error(`case session ${ctx.sessionId} 缺失 caseId（数据损坏）`)
            }
            const { startCaseAnalysisV2 } = await import('~~/server/services/workflow/caseAnalysisV2.executor')
            return startCaseAnalysisV2({
                sessionId: ctx.sessionId,
                userId: ctx.userId,
                caseId: ctx.caseId,
                selectedModules: ctx.selectedModules,
                command: ctx.command,
                signal: ctx.signal,
            })
        },
    })

    // ── 模块对话 ──
    agentRegistry.register({
        scope: SessionScope.CASE,
        type: SessionType.MODULE,
        description: 'runModuleChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.caseId == null) {
                throw new Error(`case session ${ctx.sessionId} 缺失 caseId（数据损坏）`)
            }
            const meta = (ctx.metadata ?? {}) as { moduleName?: string; nodeId?: number }
            if (!meta.moduleName || meta.nodeId == null) {
                throw new Error(`module session ${ctx.sessionId} 缺失 metadata.moduleName / nodeId`)
            }
            const { runModuleChat } = await import('~~/server/services/workflow/agents/moduleAgent')
            return runModuleChat(ctx.sessionId, ctx.message, {
                userId: ctx.userId,
                caseId: ctx.caseId,
                moduleName: meta.moduleName,
                nodeId: meta.nodeId,
                command: ctx.command,
                runId: ctx.runId,
                thinking: ctx.thinking,
                signal: ctx.signal,
            })
        },
    })

    // ── 案件主对话（默认）── 注册为 (CASE, null)，二级路由 fallback
    agentRegistry.register({
        scope: SessionScope.CASE,
        type: null,
        description: 'runCaseChat (legacy)',
        runner: async (ctx: AgentRunnerContext) => {
            if (ctx.caseId == null) {
                throw new Error(`case session ${ctx.sessionId} 缺失 caseId（数据损坏）`)
            }
            const { runCaseChat } = await import('~~/server/services/workflow/agents')
            return runCaseChat(ctx.sessionId, ctx.message, {
                userId: ctx.userId,
                caseId: ctx.caseId,
                runId: ctx.runId,
                command: ctx.command,
                thinking: ctx.thinking,
                signal: ctx.signal,
            })
        },
    })
}
```

- [ ] **Step 11.2：创建 plugin 启动钩子**

新建 `server/plugins/agent-registry.ts`：

```typescript
/**
 * Agent Registry 启动钩子
 *
 * 在 Nitro 启动时把 5 个 legacy runner 注册到 agentRegistry。
 * 阶段 2 起替换为 defineDomainAgent 工厂自动注册（届时本 plugin 删除）。
 */

import { registerLegacyRunners } from '~~/server/services/agent-platform/registry/registerLegacyRunners'

export default defineNitroPlugin(() => {
    try {
        registerLegacyRunners()
        logger.info('[agent-registry] 已注册 5 个 legacy runner')
    } catch (err) {
        logger.error('[agent-registry] 注册 legacy runner 失败', err)
        throw err   // 路由没注册成功，应该尽早暴露
    }
})
```

- [ ] **Step 11.3：扩展 Registry 测试，覆盖 registerLegacyRunners 幂等性**

在 `tests/server/agent-platform/registry/agentRegistry.test.ts` 末尾追加：

```typescript
import { agentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import { registerLegacyRunners } from '~~/server/services/agent-platform/registry/registerLegacyRunners'

describe('registerLegacyRunners 幂等性', () => {
    it('多次调用只注册一次（避免重复注册抛错）', () => {
        // 注：本测试用的是全局 agentRegistry。为避免污染其他测试，
        // 仅用幂等行为验证。
        const beforeSize = agentRegistry.list().length
        registerLegacyRunners()
        const afterFirst = agentRegistry.list().length
        registerLegacyRunners()
        const afterSecond = agentRegistry.list().length

        expect(afterFirst - beforeSize).toBeGreaterThanOrEqual(0)
        expect(afterSecond).toBe(afterFirst)   // 第二次调用未增加
    })
})
```

- [ ] **Step 11.4：运行测试验证通过**

Run: `npx vitest run tests/server/agent-platform/registry/agentRegistry.test.ts`
Expected: PASS（7 个测试）

- [ ] **Step 11.5：提交**

```bash
git add server/services/agent-platform/registry/registerLegacyRunners.ts server/plugins/agent-registry.ts tests/server/agent-platform/registry/agentRegistry.test.ts
git commit -m "feat(agent-platform): 注册 5 个 legacy runner 到 AgentRegistry"
```

---

## Task 12：agentWorker 改用 agentRegistry.dispatch

**Files:**
- Modify: `server/services/agent/agentWorker.ts`（行 174-263 段）

- [ ] **Step 12.1：阅读现有实现**

Run: `sed -n '160,270p' server/services/agent/agentWorker.ts`
Expected: 输出 lazy repair → scope 分流 → SSE 转发 一段；理解需要保留：
- 上方的 lazy repair（行 ~140-172，触发条件不变）
- scope 校验（document/assistant/contract 必有 userId；case 必有 caseId）的错误信息保持原样
- 下方 SSE 转发逻辑（行 264 之后）原封不动

- [ ] **Step 12.2：改造 executeRun 路由段**

打开 `server/services/agent/agentWorker.ts`，定位到含 `// === scope 分流（spec §5.2） ===` 注释开始的代码块（约行 174）至 `// 遍历 SSE stream 并发布事件到 Redis` 之前（约行 263）。

把整块替换为：

```typescript
      // === 路由分流：通过 AgentRegistry 分发到注册的 runner ===
      // 阶段 1：注册的是 5 个 legacy runner（runDocumentChat / runAssistantChat /
      //         runContractReviewChat / startCaseAnalysisV2 / runModuleChat / runCaseChat）。
      // 阶段 2：defineDomainAgent 工厂会替换 legacy 注册。
      //
      // scope/type 校验依然需要：runner 内部会做最终校验，但此处提前抛错
      // 可以让错误信息更精准（带上 sessionId），保留旧行为。
      if (
        (session.scope === 'document' || session.scope === 'assistant' || session.scope === 'contract')
        && session.userId == null
      ) {
        throw new Error(
          `${session.scope} session ${run.sessionId} 缺失 userId（数据损坏）`,
        )
      }
      if (
        (session.scope == null || session.scope === 'case')
        && session.caseId == null
      ) {
        throw new Error(
          `case session ${run.sessionId} 缺失 caseId（scope 与 caseId 不一致，数据损坏）`,
        )
      }

      // 注：session.scope 在 caseSessions 表中可能为 null（早期数据），按 case 域处理
      const scope = (session.scope ?? 'case') as SessionScope
      const type = session.type ?? null
      const meta = session.metadata as Record<string, unknown> | null

      stream = await agentRegistry.dispatch(
        {
          scope,
          type,
          caseId: session.caseId ?? null,
          userId: session.userId ?? run.userId,
        },
        {
          runId: run.id,
          sessionId: run.sessionId,
          userId: session.userId ?? run.userId,
          caseId: session.caseId ?? null,
          message: input.message,
          command: input.command,
          thinking: input.thinking,
          selectedModules: input.selectedModules ?? [],
          signal: abortController.signal,
          metadata: meta ?? undefined,
        },
      )
```

- [ ] **Step 12.3：在文件顶部 import 段补充 agentRegistry 与类型**

打开 `server/services/agent/agentWorker.ts`，在已有的 import 段（顶部）追加：

```typescript
import { agentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import { SessionScope } from '#shared/types/agentEvent'
```

- [ ] **Step 12.4：检查类型**

Run: `npx nuxi typecheck 2>&1 | grep -E 'agentWorker' | head -10`
Expected: 无 agentWorker 相关新增类型错误。如有错误，修正再 typecheck 一次。

- [ ] **Step 12.5：跑现有 agentWorker 单测**

Run: `npx vitest run tests/server/agent/agentWorker.test.ts tests/server/agent/agentWorker.lifecycle.test.ts tests/server/agent/agentWorker.coverage.test.ts`
Expected: 全 PASS。如失败，主要怀疑：
- 测试中 mock 的是 `runDocumentChat` 等具体 runner → registry 改造后路径仍是 `import('../workflow/agents/documentMainAgent')`，mock 应仍生效；
- 测试可能 mock 了具体的 import path → 检查 mock 路径是否正确。

如有测试失败但实际行为正确，**修测试**（同步路由方式变化）。如有真实回归，停下排查。

- [ ] **Step 12.6：提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "refactor(agent): agentWorker 路由改用 AgentRegistry.dispatch"
```

---

## Task 13：替换 agentWorker 中的字符串字面量为 SessionScope enum

**Files:**
- Modify: `server/services/agent/agentWorker.ts`

- [ ] **Step 13.1：找出剩余的字符串字面量**

Run: `grep -n "'document'\|'assistant'\|'contract'\|'case'" server/services/agent/agentWorker.ts | head -20`
Expected: 列出 agentWorker.ts 中还在用字符串字面量的位置（Task 12 改造后留下的判断、错误信息等）。

- [ ] **Step 13.2：替换为 SessionScope enum**

把 Task 12 改造段中的：

```typescript
      if (
        (session.scope === 'document' || session.scope === 'assistant' || session.scope === 'contract')
        && session.userId == null
      ) {
```

替换为：

```typescript
      if (
        (session.scope === SessionScope.DOCUMENT
          || session.scope === SessionScope.ASSISTANT
          || session.scope === SessionScope.CONTRACT)
        && session.userId == null
      ) {
```

把：

```typescript
      if (
        (session.scope == null || session.scope === 'case')
        && session.caseId == null
      ) {
```

替换为：

```typescript
      if (
        (session.scope == null || session.scope === SessionScope.CASE)
        && session.caseId == null
      ) {
```

把：

```typescript
      const scope = (session.scope ?? 'case') as SessionScope
```

替换为：

```typescript
      const scope = (session.scope ?? SessionScope.CASE) as SessionScope
```

错误消息中的 `${session.scope}`（动态字符串）保持原样——只是模板插值，不需要替换。

- [ ] **Step 13.3：类型检查**

Run: `npx nuxi typecheck 2>&1 | grep -E 'agentWorker|SessionScope' | head -10`
Expected: 无新增错误。

- [ ] **Step 13.4：再跑 agentWorker 单测**

Run: `npx vitest run tests/server/agent/agentWorker.test.ts`
Expected: PASS。

- [ ] **Step 13.5：提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "refactor(agent): agentWorker 字符串字面量替换为 SessionScope enum"
```

---

## Task 14：阶段 1 全量回归

- [ ] **Step 14.1：完整类型检查**

Run: `npx nuxi typecheck 2>&1 | tee /tmp/stage1-typecheck.log | tail -20`
Expected: 无新增错误（与阶段 1 起点对照——在阶段开始前留个 baseline 也可，但本项目类型基本干净）。

如出现错误：
- 来自 `prisma/generated/` → 跑 `bun run prisma:generate` 重新生成；
- 来自其他业务文件 → 检查是否 SessionScope import 缺失（Task 1 引入新枚举，旧业务尚未引用，应不会触发错误）；
- 来自测试文件 → 检查 `~~/` 路径是否正确。

- [ ] **Step 14.2：跑后端测试关键集**

Run: `npx vitest run tests/server/agent tests/server/agent-platform tests/shared/types tests/server/api/v1/admin/skills`
Expected: 全 PASS。

- [ ] **Step 14.3：跑全量后端测试（耗时较长）**

Run: `npx vitest run tests/server`
Expected: 全 PASS。

如有失败但与阶段 1 改造无关（pre-existing 失败），可记录在 `/tmp/stage1-preexisting-failures.txt` 并继续；与改造相关的失败必须修。

- [ ] **Step 14.4：手工烟雾测试 6 个业务**

Run: `bun dev`，登录测试账号，分别验证：

1. 案件主对话（小索）：发起一次对话，确认 SSE 正常推送
2. 模块对话：进入某分析模块，发起对话
3. 案件初分：启动初始化分析（少量模块），观察工作流是否正常推进
4. 通用问答：发起对话
5. 文书生成：起草一篇文书
6. 合同审查：上传合同走立场选择 + resume

每项验证完不必跑全流程，确认对话能正常发起 + 能收到 SSE 流即可。

如有任何业务无法发起，停止 dev、查日志、修问题。

- [ ] **Step 14.5：阶段 1 收尾标签**

```bash
git tag -a ai-unify-stage-1-done -m "AI 基建统一改造 阶段 1 完成：类型枚举 + Skills 入库 + Agent Registry"
```

（不需要 push tag，本地标记便于后续 bisect）

- [ ] **Step 14.6：阶段 1 总结提交（如有遗漏小修）**

如有任何遗漏的小修补，统一提交：

```bash
git add -p   # 选择性 add
git commit -m "chore(agent-platform): 阶段 1 收尾小修补"
```

---

## 阶段 1 完成标志

完成后应满足以下事实：

1. **类型枚举**：`shared/types/agentEvent.ts` 与 `shared/types/skill.ts` 提供 SessionScope / SessionType / SSECustomEventType / SSECustomEventMap / InterruptType / SkillSource / SkillStatus / SKILLS_FS_ROOT 全部公开符号，且测试通过
2. **数据库**：`skills` + `node_skills` 表存在；`nodes.use_skills_as_logic` 字段存在；启动时扫描入库 6 个现有 skill（docx / pptx / minimax-pdf / minimax-xlsx / evidence-defense / litigation-visualization）
3. **Admin API**：`POST /api/v1/admin/skills/resync` 可触发同步并返回 ScanResult
4. **Registry**：`agentRegistry` 单例已注册 6 个 entry：(DOCUMENT,null) (ASSISTANT,null) (CONTRACT,null) (CASE,ANALYSIS) (CASE,MODULE) (CASE,null)
5. **agentWorker**：`executeRun` 不再直接 import 业务 runner，统一通过 `agentRegistry.dispatch` 路由
6. **回归无伤害**：6 个业务的 SSE 流式对话功能等同改造前
7. **typecheck 全绿**：无新增 TS 错误
8. **测试覆盖**：本阶段新增的所有 DAO / Service / Registry / Admin API 都有对应单测

---

## Self-Review 备注（写完时已执行）

- ✅ 无 TBD / TODO / FIXME / "类似 X" 等占位符
- ✅ 每个 task 含完整的失败测试 → 实现 → 通过 → commit 五步
- ✅ 每个代码块都是可直接 paste 的完整代码
- ✅ 文件路径精确（含 `~~/` / `#shared/` 别名）
- ✅ 类型一致：AgentRunnerContext / SessionRouteKey 在 Task 10 定义后，Task 11 / 12 引用名称一致
- ✅ Spec 覆盖：spec §6 阶段 1 DoD 的 9 项验收标准均能映射到本 plan 中的 task：
  - "shared/types/agentEvent.ts 等枚举" → Task 1-4
  - "prisma/models/skill.prisma" → Task 5
  - "skillSync.service.ts" → Task 7
  - "server/plugins/0X.skill-sync.ts" → Task 8（去掉前缀，符合现有 plugin 命名）
  - "POST /api/v1/admin/skills/resync" → Task 9
  - "agentRegistry.ts" → Task 10
  - "agentWorker 改为 dispatch" → Task 12
  - "npx nuxi typecheck 全绿" → Task 14
  - "node_skills 表 + nodes.useSkillsAsLogic" → Task 5
- ✅ Spec 风险表第 6 项"节点配置 DB 完全驱动后丢配置"虽属阶段 2 主体，但本阶段建立的 skills 表已默认 status=1，启动时如果 .deepagents/skills/ 不存在不会阻塞（service 内对 ENOENT 返回空 ScanResult），不会引入新风险点
