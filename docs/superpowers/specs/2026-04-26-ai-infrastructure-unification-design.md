# AI 基建统一改造（设计文档）

- **日期**：2026-04-26
- **作者**：戴鑫（产品定位）+ Claude（架构设计）
- **背景头脑风暴会话**：本文档基于 2026-04-26 全程 brainstorming 产出，所有产品决策点均经用户确认
- **范围**：把 LexSeek 当前 6 个 AI 业务（小索 / 案件初始化分析 / 模块对话 / 通用问答 / 文书生成 / 合同审查）统一到一套通用 AI 平台基建上；启用业务互调能力；Skills 系统从模块单例改为按节点配置驱动并入库管理
- **不涉及**：用户记忆机制（通用问答未来规划，下个迭代）；模块对话 → 文书生成 协作链路；skills 上传 API（数据模型预留 source 字段，本期不实现）；skills 在线编辑（文件系统为权威源）；合同审查 docx 处理代码迁到 docx skill（下个迭代）

---

## 0. 总览一张图

```
┌──────────────────────────────────────────────────────────────────────┐
│  第 1 层 · 用户界面（基本不动）                                       │
│  小索浮窗 · 模块对话 · 通用问答页 · 案件初分页 · 文书生成页 · 合同工作台│
└──────────────┬───────────────────────────────────────────────────────┘
               │ HTTP/SSE
┌──────────────▼───────────────────────────────────────────────────────┐
│  第 2 层 · 业务 vertical（新组织：每个 AI 业务一个独立目录）           │
│  server/agents/case-main/                                             │
│  server/agents/case-module/                                           │
│  server/agents/case-analysis/   (StateGraph 特例)                     │
│  server/agents/legal-assistant/                                       │
│  server/agents/document/                                              │
│  server/agents/contract/                                              │
│  内含：agent.config.ts + middleware/ + tools/ + service/dao/types     │
└──────────────┬───────────────────────────────────────────────────────┘
               │ 注册到
┌──────────────▼───────────────────────────────────────────────────────┐
│  第 3 层 · 通用 AI 平台库 server/services/agent-platform/             │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 核心运行时（每个业务必经）                                      │  │
│  │ ・defineDomainAgent 工厂                                       │  │
│  │ ・Agent Registry（scope 路由）                                 │  │
│  │ ・中间件管道 buildMiddlewareStack（含 8+ 通用中间件）           │  │
│  │ ・SSE 事件桥（类型化 publishCustomEvent / publishStreamEvent） │  │
│  │ ・检查点 + 模型工厂（沿用）                                     │  │
│  │ ・通用工具（search_law / processMaterials / 4 个 skill 工具等）│  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 扩展能力（按节点配置开启）                                      │  │
│  │ ・Skills 系统（skillsMiddleware + 4 工具 + skill 同步服务）     │  │
│  │ ・Workspace 沙箱（/tmp/skills-workspace/{sessionId}）          │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────────────────────────────┘
               │ 调用
┌──────────────▼───────────────────────────────────────────────────────┐
│  第 4 层 · 原子能力服务（基本不动）                                    │
│  retrieval/ · memory/ · material/ · point/ · legal/ · model/ · node/ │
└──────────────────────────────────────────────────────────────────────┘
```

**核心收益**：

- 加新 AI 业务：从 6-7 处目录、800-1200 行代码、3-5 天 → 1 个目录、200-400 行代码、~1 天
- 业务能力调用关系：从"全是孤岛"→"小索 / 通用问答能调起文书生成 / 合同审查"
- Skills 从模块全局单例 → 按节点配置驱动 + 入库管理 + 后台可控
- 合同审查的"游离形态"（绕过 agent.stream 的 resume 路径）回归主线
- 前端 6 个业务 composable 各写一份 → 统一 useDomainAgentSession 工厂
- session.scope / session.type / SSE event.type / interrupt.type 全部 enum 化

**关键不动**：
- 案件初始化分析保留 StateGraph 形态（流程固定可控，符合 StateGraph 设计哲学）
- 合同审查的独立工作台 UI 完全不变（只动底层）
- 用户已经熟悉的所有界面视觉

---

## 1. 关键产品决策（来自 2026-04-26 brainstorming）

| # | 决策 | 内容 |
|---|---|---|
| D1 | 改造野心 | C 档：统一 + 业务互调（详见 §6） |
| D2 | 案件初分形态 | 保留 StateGraph，底层基建尽量复用 |
| D3 | 合同审查形态 | 独立工作台 UI 完全保留，底层基建统一 |
| D4 | 互调用户体验形态 | 嵌入式 + 自定义工具卡片（沿用现状已有 16 张卡片体系） |
| D5 | 协作链路 P0 | search_law 普及（模块对话/文书/合同 三处加工具）+ 通用问答→文书/合同（无 caseId 启动） |
| D6 | 协作链路 P1 | 小索→文书/合同（带 caseId 透传）|
| D7 | 不在范围 | 模块对话→文书生成；通用问答→其他 Agent 的反向链路（避免与小索定位重叠）|
| D8 | 通用问答 vs 小索定位 | 小索=案件维度（caseId 绑定）；通用问答=全局通用（caseId=NULL，未来加用户记忆/偏好/办过案子/日程）|
| D9 | 无 caseId 启动模式 | 通用问答→文书/合同 时 caseId=NULL；用户在结果独立页通过"+ 关联案件"按钮补绑 |
| D10 | 互调执行模式 | 同步执行（工具卡片实时更新进度，复用已有 SSE 渲染）|
| D11 | 跳转协议 | URL 参数 `?from=<xiaosuo|assistant>&caseId=<optional>&sessionId=<parentSessionId>` |
| D12 | Skills 真理来源 | 文件系统为权威源（`.deepagents/skills/`），数据库做注册册 + 元数据缓存 |
| D13 | Skills 入库 | 新增 `skills` 表 + `node_skills` 关系表；管理后台 CRUD |
| D14 | 4 个 skill 工具 | 自动跟随 skills（节点关联了任意 skill 即自动注入，不需要手动配置 nodes.tools）|
| D15 | 案件初分 skills | 仅子模块（每个分析 node）配置 skills；主流程节点不配 |
| D16 | Skills 同步触发 | 启动时全量扫描 + 后台手动"重新扫描"按钮 |
| D17 | 哪些 agent 接 skills | 全部 6 个业务都接（含案件初分子模块）|
| D18 | 上线方式 | **全量发布**（产品在开发阶段，允许破坏性更新；不需要 feature flag 灰度）|

---

## 2. 第 2 层设计：业务 Vertical 目录约定

每个业务在 `server/agents/<business>/` 下，包含以下文件（按需）：

```
server/agents/<business>/
├── agent.config.ts          # defineDomainAgent 调用，必需
├── middleware/              # 业务私有中间件，可选
│   └── *.middleware.ts
├── tools/                   # 业务私有工具，可选
│   └── *.tool.ts
├── service.ts               # 业务 service，可选
├── dao.ts                   # 业务 dao，可选
└── types.ts                 # 业务私有类型，可选
```

**6 个业务对应表**（改造前位置 → 改造后 vertical）：

| 业务 | 改造前位置 | 改造后 vertical 目录 |
|---|---|---|
| 小索 | `server/services/workflow/agents/caseMainAgent.ts` | `server/agents/case-main/` |
| 模块对话 | `server/services/workflow/agents/moduleAgent.ts` | `server/agents/case-module/` |
| 案件初分 | `server/services/workflow/caseAnalysisV2.workflow.ts`<br>`caseAnalysisV2.executor.ts` | `server/agents/case-analysis/` |
| 通用问答 | `server/services/workflow/agents/assistantAgent.ts` | `server/agents/legal-assistant/` |
| 文书生成 | `server/services/workflow/agents/documentMainAgent.ts`<br>`server/services/assistant/document/**` | `server/agents/document/` |
| 合同审查 | `server/services/workflow/agents/contractReviewMainAgent.ts`<br>`server/services/assistant/contract/**` | `server/agents/contract/` |

**业务私有中间件迁移表**：

| 中间件 | 改造前 | 改造后 |
|---|---|---|
| `caseMaterialContextMiddleware` | `workflow/middleware/caseMaterialContext.middleware.ts` | `agents/case-main/middleware/` |
| `caseProcessMaterialMiddleware` | `workflow/middleware/caseProcessMaterial.middleware.ts` | `agents/case-main/middleware/`（小索/模块对话共享，提到 `agents/_shared/case-context/`）|
| `moduleContextMiddleware` | `workflow/middleware/moduleContext.middleware.ts` | `agents/case-module/middleware/` |
| `analysisResultPersistenceMiddleware` | `workflow/middleware/analysisResultPersistence.middleware.ts` | `agents/case-module/middleware/`（仅 module 用）|
| `draftResultPersistenceMiddleware` | `workflow/middleware/draftResultPersistence.middleware.ts` | `agents/document/middleware/` |
| `reviewResultPersistenceMiddleware` | `workflow/middleware/reviewResultPersistence.middleware.ts` | `agents/contract/middleware/` |

**通用中间件保留在平台库**（`agent-platform/middleware/`）：
- `messageIntegrityMiddleware`
- `scopeGuardMiddleware`
- `toolCallLimitMiddleware`
- `pointConsumptionMiddleware`
- `summarizationMiddleware`
- `safetyTrimMiddleware`
- `auditMiddleware`
- `skillsMiddleware`（新建，包装 deepagents createSkillsMiddleware，按节点配置动态构造）

**`workflow/` 目录**经此次改造后退化为"通用平台库 + 历史兼容入口"，主要内容是 `services/workflow/agents/threadState.ts`（线程状态读取，跨业务共用）等少量真正通用的辅助；其余原本"看似通用、实则 case 域专用"的内容全部迁到对应业务 vertical 或平台库。

---

## 3. 第 3 层设计：通用 AI 平台库（server/services/agent-platform/）

### 3.1 目录结构

```
server/services/agent-platform/
├── factory/
│   ├── defineDomainAgent.ts       # 业务定义入口
│   └── runtime.ts                  # 工厂内部：节点加载/中间件组装/SSE 流构造
├── registry/
│   ├── agentRegistry.ts            # scope → factory 注册表
│   └── dispatcher.ts               # agentWorker 路由替换
├── middleware/
│   ├── messageIntegrity.ts
│   ├── scopeGuard.ts
│   ├── toolCallLimit.ts
│   ├── pointConsumption.ts
│   ├── summarization.ts
│   ├── safetyTrim.ts
│   ├── audit.ts
│   ├── skills.ts                   # 包装 deepagents createSkillsMiddleware，按 NodeConfig 动态构造
│   └── buildMiddlewareStack.ts
├── tools/
│   ├── searchLaw.tool.ts
│   ├── processMaterials.tool.ts
│   ├── reservePoints.tool.ts
│   ├── confirmPoints.tool.ts
│   ├── rollbackPoints.tool.ts
│   ├── saveAnalysisResult.tool.ts
│   ├── readSkillFile.tool.ts
│   ├── writeSkillFile.tool.ts
│   ├── runSkillScript.tool.ts
│   ├── runSkillCommand.tool.ts
│   ├── workspace.ts                # 共享 workspace 工具
│   ├── invokeNodeJson.ts           # 从 contract/utils/ 提到这里，所有结构化输出业务可用
│   └── index.ts                    # 工具注册表
├── skills/
│   ├── skillSync.service.ts        # 启动扫描 + 重新扫描
│   ├── skillSync.dao.ts
│   └── filesystemBackendCache.ts   # 按 sources hash 缓存 FilesystemBackend
├── sse/
│   ├── eventBridge.ts              # 沿用 agentEventBridge.ts，类型化包装
│   └── streamBuilder.ts            # 沿用 agentSseStream.ts
├── checkpointer.ts                 # 沿用现有 checkpointer.ts
├── modelFactory.ts                 # 沿用 chatModelFactory.ts
├── nodeConfig/
│   ├── loader.ts                   # 沿用 node.service.ts，加缓存层
│   └── promptRenderer.ts           # 沿用 promptRenderer.ts
├── subAgent/
│   └── subAgentToolFactory.ts      # 沿用现有；扩展 draft_document/review_contract 工厂方法
└── types.ts                        # SessionScope / SessionType / SSEEventType / InterruptType 等枚举
```

### 3.2 defineDomainAgent 工厂

```typescript
// server/services/agent-platform/factory/defineDomainAgent.ts

interface DomainAgentDefinition {
    /** 路由身份：session.scope 值，自动注册到 Agent Registry */
    scope: SessionScope

    /** Agent 类型：createAgent (ReactAgent) 或 stateGraph */
    type: 'createAgent' | 'stateGraph'

    /** 关联的 nodes.name；提示词、模型、工具、skills 都从此节点配置取 */
    nodeName: string

    /**
     * 业务私有中间件。会与平台库通用中间件按 priority 合并，再 buildMiddlewareStack。
     * 不允许返回与平台库同名的中间件。
     */
    customMiddlewares?: MiddlewareWithPriority[]

    /**
     * 业务私有工具。会与节点配置 tools 列表合并。
     * 跟节点 tools 重名时业务工具胜出。
     */
    customTools?: (ctx: ToolContext) => Tool[]

    /** Lifecycle hooks */
    hooks?: {
        beforeRun?: (ctx: AgentRunContext) => Promise<void>
        afterRun?: (ctx: AgentRunContext, result: AgentRunResult) => Promise<void>
    }

    /** 仅 stateGraph 类型使用：图编译函数 */
    buildGraph?: (deps: PlatformDeps) => CompiledStateGraph
}

export function defineDomainAgent(def: DomainAgentDefinition): DomainAgent {
    // 1. 类型校验、scope 唯一性校验
    // 2. 自动注册到 Agent Registry
    // 3. 返回 DomainAgent 对象（含 run 方法供 agentWorker 调用）
}
```

**工厂内部职责**（`runtime.ts`）：

1. 从 `nodeConfig.loader` 加载节点配置（含模型、工具、skills 关联）
2. `promptRenderer` 渲染 system prompt
3. 构建中间件栈：通用中间件 + 业务自定义 + skillsMiddleware（按 node_skills 关联表）
4. 加载工具：节点 nodes.tools 配置 + 业务 customTools + skills 自动跟随的 4 个 skill 工具
5. 调用 `createAgent`（来自 langchain）或 `stateGraph` 编译
6. 包装为 stream，由 `streamBuilder` 输出 SSE
7. 错误处理 + 心跳 + interrupt / resume

### 3.3 Agent Registry

```typescript
// server/services/agent-platform/registry/agentRegistry.ts

interface AgentRegistryEntry {
    scope: SessionScope
    runner: (run: AgentRun, session: CaseSession) => Promise<ReadableStream>
    description?: string
}

class AgentRegistry {
    register(entry: AgentRegistryEntry): void
    dispatch(scope: SessionScope, run: AgentRun, session: CaseSession): Promise<ReadableStream>
    list(): AgentRegistryEntry[]   // for admin / introspection
}

export const agentRegistry = new AgentRegistry()
```

`agentWorker.executeRun()`（当前位于 `server/services/agent/agentWorker.ts:175-265`）改造后：

```typescript
// 改造后大致形态
const session = await getSessionDAO(run.sessionId)
const stream = await agentRegistry.dispatch(session.scope, run, session)
// 后续 SSE 转发逻辑沿用
```

每个业务 vertical 的 `agent.config.ts` 在 nuxt 自动 import 时被加载，触发 `defineDomainAgent` → 自动 `agentRegistry.register()`。

### 3.4 SSE 事件类型化

```typescript
// shared/types/agentEvent.ts （新建）

export enum SSECustomEventType {
    // 子代理工具
    SUB_AGENT_TOKEN = 'sub_agent_token',
    SUB_AGENT_TOOL_START = 'sub_agent_tool_start',
    SUB_AGENT_TOOL_END = 'sub_agent_tool_end',
    SUB_AGENT_STATUS = 'sub_agent_status',

    // 业务结果落库通知
    ANALYSIS_RESULT_SAVED = 'analysis_result_saved',
    DRAFT_SAVED = 'draft_saved',                  // 文书结果（新增）
    CONTRACT_REVIEW_SAVED = 'contract_review_saved',  // 合同结果（新增）

    // 合同审查阶段事件
    CONTRACT_STAGE = 'contract_stage',
    CONTRACT_RISK = 'contract_risk',
    CONTRACT_PROGRESS = 'contract_progress',

    // 业务互调
    CHILD_AGENT_INVOKED = 'child_agent_invoked',  // 主代理调起子代理
}

export interface SSECustomEventMap {
    [SSECustomEventType.SUB_AGENT_TOKEN]: { agentName: string; token: number }
    [SSECustomEventType.DRAFT_SAVED]: { draftId: number; summary: string }
    [SSECustomEventType.CONTRACT_REVIEW_SAVED]: { reviewId: number; riskCount: number; topRisks: Risk[] }
    // ...每个 event 对应一个 payload type
}
```

```typescript
// server/services/agent-platform/sse/eventBridge.ts

export async function publishCustomEvent<T extends SSECustomEventType>(
    runId: string,
    type: T,
    payload: SSECustomEventMap[T],
): Promise<void> {
    // 包装现有 publishCustomEvent，强类型
}
```

前端 `useStreamChat` 暴露 typed onCustomEvent：

```typescript
// app/composables/agent-platform/useDomainAgentSession.ts

interface CustomEventDispatcher {
    on<T extends SSECustomEventType>(
        type: T,
        handler: (payload: SSECustomEventMap[T]) => void,
    ): () => void
}
```

### 3.5 Skills 系统

#### 3.5.1 数据模型

新增两张表（`prisma/models/skill.prisma`）：

```prisma
model skills {
  name        String    @id                    /// PK，如 'docx' / 'evidence-defense'
  path        String                            /// 文件系统路径，如 '.deepagents/skills/docx'
  source      SkillSource @default(filesystem) /// 'filesystem' | 'uploaded'（预留未来上传）
  title       String                            /// 展示名（中文）
  description String?    @db.Text
  trigger     String?    @db.Text               /// SKILL.md frontmatter description（触发场景）
  status      Int        @default(1)            /// 1 启用 / 0 停用
  version     String?
  syncedAt    DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  nodeSkills  node_skills[]
}

enum SkillSource {
  filesystem
  uploaded
}

model node_skills {
  nodeId     Int
  skillName  String
  priority   Int      @default(0)        /// 决定 system prompt 里 skill 出现顺序
  createdAt  DateTime @default(now())

  node       nodes    @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  skill      skills   @relation(fields: [skillName], references: [name], onDelete: Cascade)

  @@id([nodeId, skillName])
}
```

#### 3.5.2 同步机制

```typescript
// server/services/agent-platform/skills/skillSync.service.ts

export async function scanAndSyncSkillsService(): Promise<{
    added: number
    updated: number
    removed: number
}> {
    // 1. 扫描 .deepagents/skills/* 目录
    // 2. 读取每个 SKILL.md 的 frontmatter (name/description)
    // 3. upsert 到 skills 表（source='filesystem'）
    // 4. 文件系统已删除但数据库还在的：标记 status=0
}
```

**触发时机**：
- 服务启动时（在 `server/plugins/` 中调用一次）
- 后台 `POST /api/v1/admin/skills/resync` 手动触发
- `source='uploaded'` 的记录不在扫描范围内（预留）

#### 3.5.3 FilesystemBackend 缓存

```typescript
// server/services/agent-platform/skills/filesystemBackendCache.ts

const backendCache = new Map<string, FilesystemBackend>()

export function getFilesystemBackend(sources: string[]): FilesystemBackend {
    const key = sources.sort().join(',')
    let backend = backendCache.get(key)
    if (!backend) {
        backend = new FilesystemBackend({ rootDir: process.cwd(), sources })
        backendCache.set(key, backend)
    }
    return backend
}

export function invalidateBackendCache(): void {
    backendCache.clear()  // 由 resync API 调用
}
```

#### 3.5.4 中间件构造

```typescript
// server/services/agent-platform/middleware/skills.ts

export async function buildSkillsMiddleware(nodeId: number): Promise<AgentMiddleware | null> {
    const skills = await getSkillsByNodeIdDAO(nodeId)
    if (skills.length === 0) return null

    const sources = skills.map(s => s.path)
    const backend = getFilesystemBackend(sources)
    return createSkillsMiddleware({ backend, sources })
}
```

#### 3.5.5 4 个 skill 工具自动跟随

在 `defineDomainAgent` 工厂内部：

```typescript
// 工厂内部伪码
const skillsForNode = await getSkillsByNodeIdDAO(node.id)
const tools = [...nodeTools, ...customTools]
if (skillsForNode.length > 0) {
    tools.push(
        createReadSkillFileTool(ctx),
        createWriteSkillFileTool(ctx),
        createRunSkillScriptTool(ctx),
        createRunSkillCommandTool(ctx),
    )
}
```

#### 3.5.6 各业务 skills 配置预设

后台首次部署 / 阶段验收时按下面配置（用户可后续调整）：

| Agent 节点 | 配置的 skills |
|---|---|
| caseMain（小索）| 全部 6 个：docx, pptx, minimax-pdf, minimax-xlsx, evidence-defense, litigation-visualization |
| caseModule（模块对话）| 全部 6 个（同小索）|
| assistantMain（通用问答）| 全部 6 个 |
| documentMain（文书生成）| docx |
| contractReviewMain（合同审查）| docx |
| 案件初分各分析子模块 | 按模块语义配（举例：诉讼策略→evidence-defense；证据清单→docx；案情可视化→litigation-visualization）。具体清单 §6 阶段 8 制订 |

#### 3.5.7 后台管理 UI

新增 `/admin/skills` 列表页：
- 列表：name / title / description / 状态 / 同步时间 / 关联节点数
- "重新扫描"按钮 → 触发 `POST /api/v1/admin/skills/resync`
- 单条记录"启用 / 停用"开关
- 详情页：展示 SKILL.md 渲染内容（只读，本期不支持编辑）

修改 `/admin/nodes/:id/edit` 节点编辑页：
- 在"启用的工具"区块下新增"启用的 Skills"区块
- 多选 chip 形式：列出所有 status=1 的 skills，已关联的高亮
- 提示文案："选了 skill 后，read_skill_file / write_skill_file / run_skill_script / run_skill_command 4 个工具会自动注入"
- 不在 nodes.tools 字段冗余记录这 4 个工具

### 3.6 Workspace 沙箱

沿用现有 `server/services/workflow/tools/workspace.ts` 设计（`/tmp/skills-workspace/{sessionId}/`），平移到 `server/services/agent-platform/tools/workspace.ts`，无逻辑变更。沿用的能力：
- 24h 自动清理
- sessionId 格式校验
- `withTimeout` 超时兜底

### 3.7 invokeNodeJson 通用化

`server/services/assistant/contract/utils/llmInvokeJson.ts` 上提到 `server/services/agent-platform/tools/invokeNodeJson.ts`，所有"节点配置 → LLM 调用 → JSON 解析 → schema 校验"的结构化输出业务都用它，避免重复造。

---

## 4. 前端设计：useDomainAgentSession 工厂

### 4.1 工厂 API

```typescript
// app/composables/agent-platform/useDomainAgentSession.ts

interface DomainAgentSessionOptions {
    scope: SessionScope
    apiBase: string                  // 如 '/api/v1/case/analysis' 或 '/api/v1/assistant/document'
    sessionId: ComputedRef<string | null>

    /** 业务私有工具卡片 toolMap */
    toolMap?: Record<string, Component>

    /** 业务私有 custom event 处理 */
    customEventHandlers?: Partial<{
        [K in SSECustomEventType]: (payload: SSECustomEventMap[K]) => void
    }>

    /** 业务私有 interrupt handler */
    interruptHandlers?: Record<InterruptType, Component>
}

export function useDomainAgentSession(options: DomainAgentSessionOptions) {
    // 工厂内部封装：
    // - useStreamChat 包装（apiUrl = `${apiBase}/chat`）
    // - 延迟初始化 + effectScope
    // - 历史消息加载（统一走 SSE 重放，不再用独立 GET）
    // - 队列管理
    // - interrupt 注册表分发
    // - custom event 类型化分发
}
```

### 4.2 业务 composable 收敛后形态

每个业务的 composable 简化为薄包装。例如 `useDocumentDraft` 改造后：

```typescript
// app/composables/agents/useDocumentAgent.ts
import { useDomainAgentSession } from '~/composables/agent-platform/useDomainAgentSession'
import DraftPersistenceCard from '~/components/agents/document/tools/DraftResultCard.vue'
import { SSECustomEventType, SessionScope } from '#shared/types/agentEvent'

export function useDocumentAgent(sessionId: ComputedRef<string | null>) {
    return useDomainAgentSession({
        scope: SessionScope.DOCUMENT,
        apiBase: '/api/v1/assistant/document',
        sessionId,
        toolMap: {
            draft_document: DraftPersistenceCard,
        },
        customEventHandlers: {
            [SSECustomEventType.DRAFT_SAVED]: (payload) => {
                // 业务定制：刷新本地 draft store
            },
        },
    })
}
```

6 个业务 composable 各 ~30-50 行。原来散落在多处的"延迟初始化 + effectScope + streamGeneration + 重复事件分发"逻辑全部进工厂。

### 4.3 Interrupt 注册表

```typescript
// app/composables/agent-platform/interruptRegistry.ts

export interface InterruptHandlerRegistration {
    type: InterruptType
    component: Component
}

class InterruptRegistry {
    register(type: InterruptType, component: Component): void
    resolve(type: InterruptType): Component | undefined
}

export const interruptRegistry = new InterruptRegistry()
```

收敛 `app/components/caseAnalysis/interrupts/` 与 `app/components/case/interrupt/` 两个目录：
- 删除 `caseAnalysis/interrupts/CaseInfoConfirm.vue`、`caseAnalysis/interrupts/ModuleSelector.vue`（功能重复，简单版）
- 保留 `case/interrupt/` 下完整版本
- 把这些 handler 通过 interrupt type → component 注册表统一分发
- `useDomainAgentSession` 接到 interrupt 时按 `interrupt.type` 查注册表渲染对应组件

### 4.4 工具卡片注册

沿用现有 `AiToolRenderer.vue:22-23, 62-71` 已经造好的 `toolMap` 注入机制（**当前 0 个业务在用**）。改造后所有业务 composable 通过 `toolMap` 传入业务私有工具卡片。

新增 6 张工具卡片（在 §6 阶段 5/6 实现）：
- `app/components/agents/document/tools/DraftDocumentCard.vue`（draft_document 工具）
- `app/components/agents/contract/tools/ReviewContractCard.vue`（review_contract 工具）
- `app/components/agents/case-main/tools/`（按需）
- `app/components/agents/legal-assistant/tools/`（按需）

### 4.5 前端目录组织

```
app/
├── components/
│   ├── ai/                      # 平台层 AI 包装（保留）
│   ├── ai-elements/             # Vercel ai-elements（保留）
│   ├── agents/                  # 新增：业务 vertical
│   │   ├── case-main/           # 小索专属组件 + 工具卡片
│   │   ├── case-module/
│   │   ├── case-analysis/
│   │   ├── legal-assistant/
│   │   ├── document/
│   │   └── contract/
│   └── ui/                      # shadcn-vue（保留）
├── composables/
│   ├── agent-platform/          # 新增：useDomainAgentSession 等
│   ├── agents/                  # 新增：业务 composable（薄包装）
│   │   ├── useCaseMainAgent.ts
│   │   ├── useCaseModuleAgent.ts
│   │   ├── useLegalAssistantAgent.ts
│   │   ├── useDocumentAgent.ts
│   │   └── useContractAgent.ts
│   └── （现有其他 composable 保留）
└── （其他保持）
```

废弃的旧 composable：
- `app/composables/useStreamChat.ts` 内核保留（`useDomainAgentSession` 内部仍调它），只是不再被业务直接使用
- `useCaseChat.ts` / `useAssistantChat.ts` / `useXiaosuoChat.ts` / `useChatSessionManager.ts` / `useModuleChatManager.ts` / `useDocumentDraft.ts` / `useContractReview.ts` / `useInitAnalysis.ts` 全部废弃删除（用户确认允许破坏性更新）

废弃的旧组件：
- `app/components/caseAnalysis/promptInput.vue`（与 `ai/AiPromptInput.vue` 重复）
- `app/components/caseAnalysis/interrupts/`（迁到 `case/interrupt/` 后删除）

---

## 5. 业务互调设计（A 类协作链路）

### 5.1 子代理工具实现

新增两个子代理工具，注册在平台库 `tools/` 下：

```typescript
// server/services/agent-platform/tools/draftDocument.tool.ts

const schema = z.object({
    templateName: z.string().describe('文书模板名'),
    intent: z.string().describe('用户意图描述'),
    additionalContext: z.string().optional(),
})

export const toolDefinition = {
    name: 'draft_document',
    description: '调起文书生成助手起草 [文书类型]。带 caseId 时关联到当前案件，无 caseId 时独立创建。',
    schema,
}

export function createTool(ctx: ToolContext) {
    return tool(async ({ templateName, intent, additionalContext }) => {
        // 1. 创建 documentDraft 记录（caseId 来自 ctx，可为 null）
        const draft = await createDraftService({
            userId: ctx.userId,
            caseId: ctx.caseId ?? null,
            templateName,
            sourceText: intent + (additionalContext ?? ''),
        })

        // 2. 同步执行 documentMainAgent（独立子线程，不影响主代理 thread）
        const result = await runDocumentChat({
            sessionId: draft.sessionId,
            userMessage: intent,
            // ...
        })

        // 3. 通过 publishCustomEvent 通知主代理前端"draft 已保存"
        await publishCustomEvent(ctx.runId, SSECustomEventType.DRAFT_SAVED, {
            draftId: draft.id,
            summary: extractSummary(result),
        })

        // 4. 返回给主代理 LLM 一个简短结果，便于回答用户
        return JSON.stringify({
            success: true,
            draftId: draft.id,
            summary: extractSummary(result),
            href: `/dashboard/document/drafts/${draft.id}?from=${getFromParam(ctx)}&caseId=${ctx.caseId ?? ''}&sessionId=${ctx.sessionId}`,
        })
    }, { name: toolDefinition.name, description: toolDefinition.description, schema })
}
```

`review_contract` 工具结构对称（替换 documentDraft → contractReview / runDocumentChat → runContractReviewChat / Risk 摘要）。

### 5.2 工具卡片设计

参考已有 16 张卡片的 UX，新建：

**DraftDocumentCard.vue**（`app/components/agents/document/tools/`）：
- 状态：执行中（"正在起草..."）/ 已完成 / 失败
- 内容：文书标题 + 关联案件标签 + 字数 + 摘要（前 5 行预览）
- 操作：「查看完整草稿」（折叠展开）、「在文书页继续编辑」（跳转 `href`）

**ReviewContractCard.vue**（`app/components/agents/contract/tools/`）：
- 状态：执行中（"正在分析..."）/ 已完成 / 失败
- 内容：合同名 + 关联案件标签 + 风险点统计（高 / 中 / 低）+ Top 3 风险摘要
- 操作：「查看全部 N 个风险」、「打开合同审查工作台」（跳转 `href`）、「+ 关联到案件」（仅 caseId=NULL 时显示）

### 5.3 跳转协议落地

**前端独立页面接到 `?from=xxx`** 后：

```vue
<!-- app/pages/dashboard/document/drafts/[id].vue -->
<template>
    <!-- 顶部来源色彩条 -->
    <div v-if="from" class="from-bar">
        从 {{ fromLabel }} 带过来
        <span v-if="!caseId">· 未关联案件
            <button @click="openCaseLinker">+ 关联案件</button>
        </span>
        <button @click="returnToParent">← 返回 {{ fromLabel }}</button>
    </div>
    <!-- 原有文书编辑 UI -->
</template>

<script setup>
const route = useRoute()
const from = computed(() => route.query.from as 'xiaosuo' | 'assistant' | undefined)
const caseId = computed(() => route.query.caseId ? Number(route.query.caseId) : null)
const parentSessionId = computed(() => route.query.sessionId as string | undefined)

const fromLabel = computed(() => from.value === 'xiaosuo' ? '小索' : '通用问答')

function returnToParent() {
    if (from.value === 'xiaosuo') {
        navigateTo(`/dashboard/cases/${caseId.value}?focus=xiaosuo`)  // 携带 sessionId 恢复对话
    } else {
        navigateTo(`/dashboard/assistant?sessionId=${parentSessionId.value}`)
    }
}

async function openCaseLinker() {
    // 弹出案件选择 Dialog，确认后调 PATCH /api/v1/assistant/document/drafts/:id { caseId }
}
</script>
```

合同审查工作台 `app/pages/dashboard/contract/[id].vue` 同样接入。

### 5.4 caseId 透传链路

子代理工具的 `ctx.caseId` 来自父 Agent 的 `ToolContext`：
- 小索（caseMain）的 `ctx.caseId` 由 session.caseId 提供（非空）
- 通用问答（assistant）的 `ctx.caseId` 为 `null`（session.caseId 必为 null）

工具内部以此判断带不带 caseId。

---

## 6. 路线图（8 阶段，全量发布）

### 阶段 1 · 底座类型化

**工程量**：3-5 天（无用户感知）

**完成定义**：

- `shared/types/agentEvent.ts`：新增 `SessionScope`、`SessionType`、`SSECustomEventType`、`SSECustomEventMap`、`InterruptType` 枚举，所有现有字符串字面量用法替换为 enum
- `shared/types/skill.ts`：新增 `SkillSource`、`SkillStatus` 枚举
- `prisma/models/skill.prisma`：新增 `skills` + `node_skills` 表（migration: `add_skills_and_node_skills`）
- `server/services/agent-platform/skills/skillSync.service.ts`：实现启动扫描 + 入库
- `server/plugins/0X.skill-sync.ts`：服务启动钩子，调用 `scanAndSyncSkillsService`
- `POST /api/v1/admin/skills/resync` 接口
- `server/services/agent-platform/registry/agentRegistry.ts`：实现注册表 + dispatcher
- `agentWorker.executeRun` 改为 `agentRegistry.dispatch(session.scope, ...)`
- `npx nuxi typecheck` 全绿

**验证**：
- 启动日志显示 6 个 skill 入库（docx, pptx, evidence-defense, litigation-visualization, minimax-pdf, minimax-xlsx）
- `POST /api/v1/admin/skills/resync` 触发后能感知 skill 变化
- 现有 6 个业务 E2E 全绿（注册表分发对齐原 switch）

### 阶段 2 · Agent 工厂化 + 业务 Vertical 整理 + Skills 入网

**工程量**：2-3 周（无用户感知）

**完成定义**：

- `server/services/agent-platform/factory/defineDomainAgent.ts`：实现工厂
- 6 个业务 vertical 目录建立（含 case-analysis/ StateGraph 暂时引旧文件）
- 5 个 createAgent 业务（caseMain / caseModule / legal-assistant / document / contract）改用 `defineDomainAgent`
- 业务私有中间件迁到对应 vertical（按 §2 表格）
- `documentMainAgent` 改造时 `buildMiddlewareStack` 强制使用（修复当前 `documentMainAgent.ts:82-88` 直传数组的问题）
- 4 个 skill 工具自动跟随机制实现
- `app/components/agents/<business>/`、`app/composables/agents/`、`app/composables/agent-platform/` 目录建立（占位）
- 后台 `/admin/skills` 列表页 + "重新扫描"按钮
- `/admin/nodes/:id/edit` 节点编辑页加 "启用的 Skills" 多选 chip
- 文件搬迁：每搬一个业务跑该业务 E2E 立即验证

**验证**：
- 6 个业务全量回归 E2E 全绿
- 新建一个测试 skill 后，关联到任一节点 → 该节点 Agent 能成功使用 4 个 skill 工具
- 后台手动停用某 skill → 关联节点的 Agent 下次运行不再注入

### 阶段 3 · search_law 普及

**工程量**：2-3 天（用户可见）

**完成定义**：

- 在管理后台把 `search_law` 加到 `caseModule` / `documentMain` / `contractReviewMain` 三个节点的 nodes.tools
- 三个节点的 system prompt 末尾加"必要时引用法条，使用 search_law 工具"指令（修改 prompts 表对应记录）
- `app/components/ai/tools/LawSearchTool.vue` 在三个新场景下渲染正常（卡片中的法条引用 + 跳转法条详情）

**验证**：
- 模块对话场景：用户提"哪条法律支撑这个结论" → 回答附法条
- 文书生成场景：用户提"诉讼请求要引哪条法条" → 回答附法条
- 合同审查场景：分析风险时自动引用法条作为依据

### 阶段 4 · 合同审查接入底座

**工程量**：5-7 天（无用户感知，中等风险）

> **2026-04-27 spec 修订（C+ 方案）**：
> 原"完成定义"要求"重写 resume 路径用 LangGraph `Command.resume` + 中间件 + 工具，不再绕过 agent.stream"。该要求与 §0 总览图"案件初分保留 StateGraph 形态（流程固定可控）"自相矛盾——合同审查跟案件初分一样属于"流程固定型"业务（解析→立场→逐条款分析→总结→生成 docx），不适合 createAgent 工具循环路径。强行用 `Command.resume` 会引入二次启动开销、playbook 校验/UUID 去重/错误降级等程序化逻辑被迫塞进工具实现、逐条款 LLM 调用让 LLM 主导失去并发控制。
>
> 修订为：**保留 stateGraph 哲学，把通用职责（SSE 桥/错误处理/nodeConfig 加载）下沉到平台 stateGraph 路径**。这与"基建统一"本心一致——平台需要同时支持"工具循环"（createAgent）和"流程固定"（stateGraph）两种形态，不是把所有业务塞进 createAgent。

**完成定义**：

- 平台 `runStateGraphAgent`（factory/runtime.ts）实现：为 `agentType: 'stateGraph'` 业务提供统一职责（SSE 事件桥注入、nodeConfig 加载缓存、错误兜底上报、签名 ctx）
- `defineDomainAgent` 工厂的 `stateGraph` 路径改为调用 `runStateGraphAgent(def, ctx)`，不再裸调 `def.runStateGraph(ctx)`
- `server/agents/contract/agent.config.ts` 接收平台注入的 ctx（`emitContractReviewEvent` 不再自己造，用工厂的 customEventEmitter）
- `server/services/workflow/agents/contractReviewMainAgent.ts` 中重复的 nodeConfig/chatModel/checkpointer 加载下沉到平台
- 合同审查接入 docx skill（添加 node_skills 关联）— 仅主节点 `contractReviewMain`（id=18），子节点 invokeNodeJson 不挂 skill
- 合同审查独立工作台 UI 完全不变
- **不重写** resume 分支的核心流程（runAnalyzeLoop / summarizeOverview / persistRisksAndCreateV1Snapshot / runAnnotateAndUpload 保留现有实现）
- **不引入** Command.resume（前端 stream.reset()+submit() + 后端独立 enqueue 模式保留）

**验证**：
- 全功能 E2E：上传合同 → 解析 → 立场选择 interrupt → resume → 风险列表 → 编辑 → 导出 docx
- 改造前后 SSE 事件序列**100% 一致**（前端契约）
- `useContractReview` composable 不动（C+ 方案不强求前端工厂收敛，留给阶段 7）
- 合同审查 4 个测试文件（streaming/contextSegments/playbook/stage）回归全 PASS
- 新增平台 stateGraph 路径单测（runStateGraphAgent ctx 注入正确性）

### 阶段 5 · 通用问答 → 文书 / 合同（无 caseId）

**工程量**：1-2 周（用户可见）

**完成定义**：

- `server/services/agent-platform/tools/draftDocument.tool.ts` + `reviewContract.tool.ts` 实现
- 两工具注册到工具注册表
- 通用问答节点配置（assistantMain）的 nodes.tools 加 `draft_document` 和 `review_contract`
- 通用问答节点配置接入全部 6 个 skills
- `app/components/agents/document/tools/DraftDocumentCard.vue` 实现
- `app/components/agents/contract/tools/ReviewContractCard.vue` 实现
- 跳转协议落地：`?from=&caseId=&sessionId=`
- 文书页 + 合同工作台顶部"来源色彩条 + 返回链接 + 关联案件按钮"
- `PATCH /api/v1/assistant/document/drafts/:id { caseId }` 接口
- `PATCH /api/v1/assistant/contract/reviews/:id { caseId }` 接口

**验证**：
- E2E 1：通用问答输入"帮我起草起诉状" → 工具卡片"已完成" → 跳文书页 → "+关联案件"成功
- E2E 2：通用问答输入"审一下这份合同"（拖入 docx） → 工具卡片含 Top 风险 → 跳工作台 → "+关联案件"成功
- 验证返回链接能回到通用问答并继续对话

### 阶段 6 · 小索 → 文书 / 合同（带 caseId）

**工程量**：1 周（用户可见）

**完成定义**：

- caseMain 节点配置加 `draft_document` 和 `review_contract`
- caseId 透传（小索的 ToolContext.caseId 非空时自动带入）
- 文书生成接入 docx skill（修补"docx skill 本是为文书造的，但文书没接"的产品缺位）
- 文书页 + 合同工作台识别 from=xiaosuo + caseId 不为空时不显示"+ 关联案件"按钮
- 复用阶段 5 的工具卡片

**验证**：
- E2E：小索浮窗输入"起草起诉状" → 卡片显示"关联案件: 王××离婚案" → 跳转文书页带 caseId
- 验证文书在 documentDrafts.caseId 字段正确

### 阶段 7 · 前端复用收敛

**工程量**：1-2 周（无用户感知；可与 5/6 并行）

**完成定义**：

- `useDomainAgentSession` 工厂实现完整
- 6 个业务 composable 收敛为薄包装（30-50 行）
- 删除：`useCaseChat.ts` / `useAssistantChat.ts` / `useXiaosuoChat.ts` / `useChatSessionManager.ts` / `useModuleChatManager.ts` / `useDocumentDraft.ts` / `useContractReview.ts` / `useInitAnalysis.ts`（破坏性更新允许）
- Interrupt 注册表实现 + `case/interrupt/` 各 handler 注册
- 删除 `app/components/caseAnalysis/interrupts/` 目录（功能并入 `case/interrupt/`）
- 删除 `app/components/caseAnalysis/promptInput.vue`（功能由 `ai/AiPromptInput.vue` 提供）
- `app/components/ai-elements/model-selector/` 目录评估：当前无人使用，删除或保留按 reviewer 决定（plan 阶段定）
- SSE custom event 类型化分发器在工厂内置

**验证**：
- 前端单元测试通过
- 6 个业务页面 smoke 全绿
- 对照表：旧 composable 每个职责都能在新 hook 中找到对应

### 阶段 8 · 案件初分接 Skills + 提示词改造

**工程量**：1 周（无用户感知；提示词改造可能影响输出质量，需对比测试）

**完成定义**：

- `server/agents/case-analysis/` 完成（StateGraph 形态保留）
- StateGraph 各分析子模块（每个 nodes.type='analysis' 节点）支持 skills 配置
- 各分析子模块的 ReAct 子图共享 `agent-platform/middleware/` 的中间件管道（含 skillsMiddleware）
- 提示词改造："只写规范，不写做事方法"——分析方法论转移到对应 skill
- 3-5 个分析模块配上 skills（建议清单：诉讼策略 → evidence-defense；证据清单 → docx；案情可视化 → litigation-visualization；其他模块按业务判断）
- 节点配置加 `useSkillsAsLogic` 字段（boolean，nodes 表新增列）作为节点级提示词风格选择：每个节点独立选用「skills-as-logic」风格还是「传统嵌入式 prompt」风格。此字段不是灰度开关，而是允许提示词改造按节点颗粒度推进——阶段 8 验收时把 3-5 个核心分析模块切到 true，其他先保 false，后续迭代逐步推进

**验证**：
- 案件初分全 E2E：多模块顺序执行 + 中断 + 充值恢复 + 完成
- 抽样 5-10 个真实案件做对比测试，新提示词 + skills 输出质量不退化
- StateGraph 内部中间件挂载正确（通过测试用例验证 skillsMiddleware 在每个分析子图都生效）

---

## 7. 风险与缓解

| 风险 | 级别 | 描述 | 缓解 |
|---|---|---|---|
| 合同审查 resume 重写行为差异 | 高 | 现 resume 路径绕过 agent.stream 直接调 runAnalyzeLoop / summarizeOverview，重写为 Command.resume 后中间件执行时机 / 流式事件序列可能存在差异 | 阶段 4 单独 1-2 周回归；对比改造前后 SSE 事件录像；保留旧 resume 函数 1 个迭代作为对照（仅用于 bug 排查，不进生产路径） |
| skills 按节点动态加载性能开销 | 中 | 现 skillsMiddleware 是模块级单例，所有 agent 共用一个 FilesystemBackend；改成按节点构造后会增加扫描成本 | FilesystemBackend 按 sources 列表 hash 缓存（同一组 skills 共用 backend）；node_skills 关系做内存缓存 + resync 时清失效 |
| 案件初分提示词改造影响输出质量 | 中 | "只写规范，逻辑放 skill" 改造后部分原本固化在 prompt 里的方法论转移到 skill，可能写不全导致退化 | 阶段 8 抽样测试 5-10 个真实案件对比新旧两种风格的输出质量；nodes.useSkillsAsLogic 字段允许逐节点迁移（不是"灰度开关"），某节点出现质量退化时可单独把该节点切回 false |
| 业务 vertical 文件搬迁误差 | 中 | 阶段 2 涉及大量文件移动，可能漏迁 / 引用更新错 / 测试 mock 路径失效 | 每搬一个业务立即跑该业务 E2E；不用 sed 批量替换（按 CLAUDE.md 全局规则）；搬迁前留 git commit 锚点便于对比 |
| 子代理工具同步执行阻塞主对话 | 低 | draft_document / review_contract 同步执行（30 秒-2 分钟），用户主对话期间被阻塞 | 工具卡片实时显示进度（"分析中..."/"起草中..."）；超过 60 秒未完成时卡片显示"耗时较长，预计还需 X 秒"提示；保留主对话框消息发送能力（虽然主代理被阻塞，但用户仍可输入下条消息排队等待） |
| 节点配置 DB 完全驱动后丢配置 | 中 | 改造后所有 NodeConfig 完全靠 DB 驱动，节点配置缺失时业务不能工作 | 启动时 seed 6 个核心节点的初始配置（caseMain / caseModule / assistantMain / documentMain / contractReviewMain + 案件初分各分析模块）；管理后台节点删除时校验"是否被业务 vertical 引用" |

---

## 8. 测试策略

### 8.1 单元测试

- `defineDomainAgent` 工厂的输入校验和输出 shape
- `agentRegistry` 的 register / dispatch / list 行为
- `buildMiddlewareStack` 排序和互斥校验（含新 skillsMiddleware）
- `publishCustomEvent<T>` 类型化契约
- 每个业务私有中间件单独单测
- `skillSync.service` 的扫描 / upsert / 状态同步
- `getFilesystemBackend` 缓存命中和失效
- skill 工具的边界（路径校验 / 工作区隔离 / 超时兜底）— 沿用现有测试

### 8.2 集成测试

- 每业务的 enqueueRun → agentWorker → registry → defineDomainAgent runner → 中间件栈 → SSE 事件流，用 mock LLM 跑通
- 子代理工具调用：caseMain 调 draft_document → documentMainAgent 同步执行 → 结果返回主代理 → 前端工具卡片更新
- skills 链路：resync → DB 入库 → defineDomainAgent 加载 → skillsMiddleware 注入 → 在 system prompt 中渲染 skill 列表
- resume 路径：interrupt → command.resume → 中间件继续 → 业务完成

### 8.3 E2E 测试（Playwright）

每阶段验收必跑：

- 小索：发起对话 → 工具调用 → search_law / search_case_materials 卡片 → interrupt（积分不足）→ 充值 → resume → 完成
- 模块对话：进入模块 → 多轮对话 → save_analysis_result → 历史可见
- 案件初分：选模块 → 启动 → 多模块顺序 → 中断 → 充值 → 完成
- 通用问答：发起对话 → "起草起诉状" → 工具卡片 → 跳文书页 → 关联案件
- 通用问答：发起对话 → "审合同" → 工具卡片 → 跳工作台 → 关联案件
- 文书生成：发起对话 → 草稿生成 → 编辑 → 保存版本 → 导出 docx
- 合同审查：上传合同 → 立场选择 interrupt → resume → 分析 → 风险编辑 → 导出
- 小索 → 文书：caseId 透传链路

**回归集**：所有现有业务 E2E 必须每阶段都跑，不能因为本阶段不涉及该业务就跳过。

---

## 9. 上线策略

**全量上线**（产品在开发阶段，允许破坏性更新；不需要 feature flag 灰度）。

**保护措施**：

- 每个阶段一个独立 PR，单独合并。每个 PR 必须配套 E2E 通过证据
- 每个阶段合并后立即创建 git tag（如 `ai-unify-stage-1-done`），便于必要时 bisect / revert
- 阶段 4（合同审查 resume 重写）和阶段 8（案件初分提示词改造）发布后专门观察 1-2 天监控（错误率、用户反馈）
- 数据库 migration 不可回滚（按 LexSeek 项目规则，迁移必须前向兼容；本次新增表无破坏性）

**回滚方式**：

- 阶段 1-2-7：基础设施改造，必要时整库 git revert 该阶段 PR
- 阶段 3：nodes.tools 配置改一行，后台改回即可
- 阶段 4：合同审查 resume 路径出问题时直接 git revert 阶段 4 PR；旧 resume 函数文件保留至下个迭代结束作为 bug 排查参考，但**不进生产路径**（无 feature flag 切换）
- 阶段 5/6：业务调用工具，节点配置移除工具 = 一键关闭（同 nodes.tools 编辑）
- 阶段 8：每个分析模块独立配置 useSkillsAsLogic；某模块出问题时单独切回 false（这是节点级配置项，不是全局回退开关）

---

## 10. 待办与开放问题（明确不在本期范围）

- skills 上传 API（数据模型预留 source 字段，下个迭代）
- skills 在线编辑 SKILL.md 内容（数据库为权威源的方向，下个迭代）
- 用户记忆机制（通用问答未来规划：偏好 / 办过的案子 / 在办的案子 / 日程）
- 模块对话 → 文书生成（按业务需求确定，本期不做）
- 合同审查 docx 处理代码迁到 docx skill（下个迭代）
- skills 按业务可见的进一步细化（如"docx 只给文书看"）— 当前默认全部 status=1 的 skill 在节点编辑时都可见，未来可加 visibility 字段
- 异步子代理调用（当前同步执行；如未来用户体验上有"主对话不阻塞"刚需再做）
- 通用问答 → 文书 / 合同的反向链路与小索定位重叠风险监控（看用户反馈，必要时调整）

---

## 附录 A：代码到新架构的映射表

### 后端

| 改造前 | 改造后 |
|---|---|
| `server/services/workflow/agents/caseMainAgent.ts` | `server/agents/case-main/agent.config.ts` |
| `server/services/workflow/agents/moduleAgent.ts` | `server/agents/case-module/agent.config.ts` |
| `server/services/workflow/caseAnalysisV2.workflow.ts` | `server/agents/case-analysis/workflow.ts`（StateGraph 形态保留）|
| `server/services/workflow/caseAnalysisV2.executor.ts` | `server/agents/case-analysis/executor.ts` |
| `server/services/workflow/agents/assistantAgent.ts` | `server/agents/legal-assistant/agent.config.ts` |
| `server/services/workflow/agents/documentMainAgent.ts` | `server/agents/document/agent.config.ts` |
| `server/services/workflow/agents/contractReviewMainAgent.ts` | `server/agents/contract/agent.config.ts` |
| `server/services/workflow/agents/subAgentToolFactory.ts` | `server/services/agent-platform/subAgent/subAgentToolFactory.ts` |
| `server/services/workflow/agents/threadState.ts` | `server/services/agent-platform/threadState.ts` |
| `server/services/workflow/checkpointer.ts` | `server/services/agent-platform/checkpointer.ts` |
| `server/services/workflow/middleware/{messageIntegrity,scopeGuard,toolCallLimit,pointConsumption,summarization,safetyTrim,audit}.middleware.ts` | `server/services/agent-platform/middleware/` |
| `server/services/workflow/middleware/{caseMaterialContext,caseProcessMaterial}.middleware.ts` | `server/agents/_shared/case-context/`（小索/模块对话共享）|
| `server/services/workflow/middleware/moduleContext.middleware.ts` | `server/agents/case-module/middleware/` |
| `server/services/workflow/middleware/analysisResultPersistence.middleware.ts` | `server/agents/case-module/middleware/` |
| `server/services/workflow/middleware/draftResultPersistence.middleware.ts` | `server/agents/document/middleware/` |
| `server/services/workflow/middleware/reviewResultPersistence.middleware.ts` | `server/agents/contract/middleware/` |
| `server/services/workflow/tools/{searchLaw,processMaterials,reservePoints,confirmPoints,rollbackPoints,saveAnalysisResult,readSkillFile,writeSkillFile,runSkillScript,runSkillCommand,workspace}.{tool.ts,ts}` | `server/services/agent-platform/tools/` |
| `server/services/workflow/utils/promptRenderer.ts` | `server/services/agent-platform/nodeConfig/promptRenderer.ts` |
| `server/services/workflow/context/{messageCompressor,moduleContextBuilder,toolResultTruncator}.ts` | `server/services/agent-platform/context/` |
| `server/services/workflow/state/storage.ts` | `server/services/agent-platform/state/storage.ts` |
| `server/services/agent/{agentWorker,agentEventBridge,agentRun.service,agentRun.dao}.ts` | `server/services/agent-platform/{agentWorker,sse/eventBridge,registry/agentRun.service,registry/agentRun.dao}.ts`（agentWorker.executeRun 内部改用 registry.dispatch）|
| `server/services/sse/agentSseStream.ts` | `server/services/agent-platform/sse/streamBuilder.ts` |
| `server/services/sse/sse.service.ts` | 保留（其他业务也用，不只是 AI）|
| `server/services/assistant/document/**` | `server/agents/document/{service,dao,...}` |
| `server/services/assistant/contract/**` | `server/agents/contract/{service,dao,docx,fonts,utils,...}` |
| `server/services/assistant/contract/utils/llmInvokeJson.ts` | `server/services/agent-platform/tools/invokeNodeJson.ts`（提为通用工具）|
| `server/services/assistant/assistantSession.dao.ts` | `server/agents/legal-assistant/dao.ts` |

### 前端

| 改造前 | 改造后 |
|---|---|
| `app/composables/useStreamChat.ts` | 保留为 `useDomainAgentSession` 内核 |
| `app/composables/useChatSessionManager.ts` | 删除（功能并入工厂）|
| `app/composables/useCaseChat.ts` | 删除 → `app/composables/agents/useCaseMainAgent.ts` |
| `app/composables/useAssistantChat.ts` | 删除 → `app/composables/agents/useLegalAssistantAgent.ts` |
| `app/composables/useXiaosuoChat.ts` | 删除（合并到 useCaseMainAgent）|
| `app/composables/useModuleChatManager.ts` | 删除 → `app/composables/agents/useCaseModuleAgent.ts` |
| `app/composables/useDocumentDraft.ts` | 删除 → `app/composables/agents/useDocumentAgent.ts` |
| `app/composables/useContractReview.ts` | 删除 → `app/composables/agents/useContractAgent.ts` |
| `app/composables/useInitAnalysis.ts` | 改造（使用工厂内核）→ `app/composables/agents/useCaseAnalysisAgent.ts` |
| `app/composables/initAnalysis/**` | 评估保留 / 移到 `app/composables/agents/case-analysis/` |
| `app/components/ai/**` | 保留为通用 AI 包装层 |
| `app/components/ai-elements/**` | 保留 |
| `app/components/caseAnalysis/promptInput.vue` | 删除（重复）|
| `app/components/caseAnalysis/interrupts/**` | 删除（功能并入 `case/interrupt/`）|
| `app/components/case/**` | 拆分：通用对话组件留 case-main vertical，interrupt handler 通过注册表使用 |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | 移到 `app/components/agents/case-main/CaseMainPanel.vue` |
| `app/components/case/AnalysisModuleChat.vue` | 移到 `app/components/agents/case-module/CaseModulePanel.vue` |
| `app/components/assistant/AssistantChatPanel.vue` | 移到 `app/components/agents/legal-assistant/LegalAssistantPanel.vue` |
| `app/components/assistant/document/**` | 移到 `app/components/agents/document/` |
| `app/components/assistant/contract/**` | 移到 `app/components/agents/contract/` |
| `app/components/initAnalysis/**` | 移到 `app/components/agents/case-analysis/` |
| `app/components/caseAnalysis/analysis/**` | 移到 `app/components/agents/case-analysis/` |

---

## 附录 B：枚举定义清单

```typescript
// shared/types/agentEvent.ts

export enum SessionScope {
    CASE = 'case',
    ASSISTANT = 'assistant',
    DOCUMENT = 'document',
    CONTRACT = 'contract',
}

export enum SessionType {
    CHAT = 1,           // 案件主对话（小索）
    ANALYSIS = 2,       // 案件初分（StateGraph）
    MODULE = 3,         // 模块对话
}

export enum SSECustomEventType {
    SUB_AGENT_TOKEN = 'sub_agent_token',
    SUB_AGENT_TOOL_START = 'sub_agent_tool_start',
    SUB_AGENT_TOOL_END = 'sub_agent_tool_end',
    SUB_AGENT_STATUS = 'sub_agent_status',
    ANALYSIS_RESULT_SAVED = 'analysis_result_saved',
    DRAFT_SAVED = 'draft_saved',
    CONTRACT_REVIEW_SAVED = 'contract_review_saved',
    CONTRACT_STAGE = 'contract_stage',
    CONTRACT_RISK = 'contract_risk',
    CONTRACT_PROGRESS = 'contract_progress',
    CHILD_AGENT_INVOKED = 'child_agent_invoked',
}

export enum InterruptType {
    INSUFFICIENT_POINTS = 'insufficient_points',
    NEED_MEMBERSHIP = 'need_membership',
    BASIC_INFO_CONFIRM = 'basic_info_confirm',
    CASE_INFO_CHECK = 'case_info_check',
    MODULE_SELECT = 'module_select',
    CONTRACT_STANCE = 'contract_stance',
    EXTRACT_CASE_INFO = 'extract_case_info',
    // ...沿用现有所有 interrupt 类型
}

// shared/types/skill.ts

export enum SkillSource {
    FILESYSTEM = 'filesystem',
    UPLOADED = 'uploaded',
}

export enum SkillStatus {
    DISABLED = 0,
    ENABLED = 1,
}
```

---

## 附录 C：本次设计依据的现有代码引用

为方便后续 plan 阶段对照，列出本设计核心改动点对应的现状代码位置：

- agentWorker 路由 switch：`server/services/agent/agentWorker.ts:175-265`
- 5 个 createAgent 入口：`server/services/workflow/agents/{caseMainAgent,moduleAgent,assistantAgent,documentMainAgent,contractReviewMainAgent}.ts`
- caseAnalysisV2 StateGraph：`server/services/workflow/caseAnalysisV2.workflow.ts`
- 合同审查跳过 agent.stream 的 resume 路径：`server/services/workflow/agents/contractReviewMainAgent.ts:438-530`
- documentMainAgent 未走 buildMiddlewareStack：`server/services/workflow/agents/documentMainAgent.ts:82-88`
- skillsMiddleware 模块级单例：`server/services/workflow/agents/caseMainAgent.ts:43-46`、`moduleAgent.ts:43-46`
- 4 个 skill 工具：`server/services/workflow/tools/{readSkillFile,writeSkillFile,runSkillScript,runSkillCommand}.tool.ts`
- workspace 共享：`server/services/workflow/tools/workspace.ts`
- AiToolRenderer 已就位但 0 业务用 toolMap：`app/components/ai/AiToolRenderer.vue:22-23,62-71`
- 16 张已有工具卡片：`app/components/ai/tools/*.vue`
- AiChat 5 个业务统一使用：`app/components/caseDetail/CaseDetailXiaosuo.vue:171`、`case/AnalysisModuleChat.vue:174`、`assistant/AssistantChatPanel.vue:129`、`pages/dashboard/cases/init-analysis/[sessionId].vue:2`、`pages/dashboard/document/drafts/[id].vue:598`
- 合同审查未接入 AiChat：`app/components/assistant/contract/**`、`app/pages/dashboard/contract/[id].vue`
- caseSessions 双域设计：`prisma/models/case.prisma:101-145`
- agentRuns 任务表：`prisma/models/agentRun.prisma:2-44`
- 6 个现有 skills：`.deepagents/skills/{docx,pptx,minimax-pdf,minimax-xlsx,evidence-defense,litigation-visualization}/`
