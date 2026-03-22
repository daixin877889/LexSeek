# 案件分析模块重构设计

> 日期：2026-03-22
> 状态：待评审
> 范围：核心案件分析流程（不含登录/计费 Agent 集成）

## 1. 背景与目标

### 1.1 现状问题

当前项目中案件分析模块存在**两套并行的 Agent 架构**：

1. **LangGraph 工作流** (`caseAnalysis.workflow.ts`) — 完整的 StateGraph，包含 5 个节点（materialProcess、caseInfoCheck、extractInfo、moduleSelect、analysisTask），中断通过节点内部 `interrupt()` 调用实现
2. **DeepAgent 主代理** (`agent/main.ts`) — 独立的流式对话代理

两套架构未完全整合，增加了维护复杂度。前端使用 ai-sdk (Vercel) 做流管理，与 LangChain 生态缺乏原生集成。

### 1.2 设计目标

- **统一架构**：用 Deep Agents SDK 作为唯一的 Agent 框架
- **多轮对话**：支持首次引导分析 + 后续自由对话，而非固定工作流管道
- **前端原生集成**：切换到 `@langchain/vue` 的 useStream，保留 ai-element-vue 做 UI 渲染
- **长期记忆**：使用 Deep Agents 的 CompositeBackend + PostgresStore 实现跨会话记忆
- **可扩展**：预留登录/计费 Agent 集成的扩展点

### 1.3 技术选型依据

| 维度 | 选择 | 理由 |
|------|------|------|
| Agent 框架 | Deep Agents SDK | 原生多轮对话、子代理委派、长期记忆、上下文自动管理 |
| 前端流管理 | @langchain/vue useStream | Vue 原生 composable，内置中断/子代理/分支/线程支持 |
| 前端 UI | ai-element-vue | 成熟的 AI 交互组件库，避免自建 UI |
| 部署模式 | 嵌入 Nuxt Server | 无额外服务，使用 FetchStreamTransport 连接 |
| 追踪 | LangSmith | Deep Agents 自动继承 LangGraph 的追踪能力 |

## 2. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    前端 (Vue 3)                      │
│  @langchain/vue useStream + ai-element-vue          │
│  ┌──────────┐  ┌──────────┐  ┌─────────────────┐   │
│  │Conversation│ │中断交互   │  │任务队列/工具UI  │   │
│  └──────────┘  └──────────┘  └─────────────────┘   │
│         ↕ FetchStreamTransport (SSE)                │
├─────────────────────────────────────────────────────┤
│              Nuxt Server (Nitro) API                │
│  POST /api/v1/case/analysis/chat                    │
├─────────────────────────────────────────────────────┤
│            DeepAgent (主对话代理)                     │
│  ┌─────────────────────────────────────────────┐    │
│  │ System Prompt (NodeConfig: caseMain)         │    │
│  │ = 法律分析助手角色 + 提示词防火墙 + 引导指令  │    │
│  ├─────────────────────────────────────────────┤    │
│  │ 工具集:                                     │    │
│  │  • process_materials   (材料检查与处理)      │    │
│  │  • extract_case_info   (案件信息提取)        │    │
│  │  • search_case_materials (材料语义检索)      │    │
│  │  • search_law          (法律条文检索)        │    │
│  │  • reserve_points      (积分预扣)           │    │
│  │  • confirm_points      (积分确认实扣)        │    │
│  │  • rollback_points     (积分回滚)           │    │
│  ├─────────────────────────────────────────────┤    │
│  │ 子代理 (按 NodeConfig priority 串行执行):    │    │
│  │  • summary    — 生成案件概要                 │    │
│  │  • chronicle  — 提取案件大事记               │    │
│  │  • claim      — 预分析案件请求权             │    │
│  │  • trend      — 判决趋势预测                │    │
│  │  • cause      — 预选案由                    │    │
│  │  • defense    — 抗辩分析及应对策略预测       │    │
│  │  • evidence   — 证据清单预梳理               │    │
│  ├─────────────────────────────────────────────┤    │
│  │ 长期记忆: CompositeBackend                  │    │
│  │  StateBackend (短期) + StoreBackend (长期)   │    │
│  │  PostgresStore 持久化                       │    │
│  ├─────────────────────────────────────────────┤    │
│  │ Checkpointer: PostgresSaver (复用现有)       │    │
│  └─────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────┤
│  复用层:                                            │
│  chatModelFactory │ NodeConfig │ PromptService       │
│  ToolRegistry     │ PostgresSaver                    │
├─────────────────────────────────────────────────────┤
│  PostgreSQL + pgvector                              │
│  案件数据 │ 材料嵌入 │ 检查点 │ 长期记忆              │
└─────────────────────────────────────────────────────┘
```

## 3. 对话流程设计

### 3.1 核心理念

整个案件分析是**多轮对话式交互**，不是固定管道：

- 首次分析有引导流程（材料处理→案情检查→信息提取→模块选择→分析执行）
- 引导流程通过 System Prompt 指令驱动，由 DeepAgent 自主执行
- 分析完成后用户可继续自由对话：追问、追加分析、讨论结果
- 所有交互共享同一个 thread，上下文自动保持

### 3.2 首次分析引导流程

```
用户: [上传材料/输入案情]
  │
  ├─ 主代理内部: 提示词防火墙检查
  │   ├─ 非法律需求 → 友好拒绝
  │   ├─ 提示词攻击 → 拒绝服务
  │   └─ 合法需求 → 继续
  │
  ├─ 调用工具: process_materials(caseId)
  │   └─ 检查材料状态、触发识别/嵌入、评估 token 量
  │       ├─ 全量提供: totalTokens < threshold，直接在上下文携带
  │       └─ 摘要模式: 提供材料列表+摘要，按需用工具检索
  │
  ├─ 调用工具: extract_case_info(materials)
  │   └─ 返回结构化信息 {title, plaintiff, defendant, ...}
  │   └─ interruptOn → 用户确认/修改基础信息
  │
  ├─ 主代理输出模块列表 + 积分消耗信息（System Prompt 驱动）
  │   └─ 调用 interrupt() → 用户选择分析模块
  │
  ├─ 判断材料是否满足最低分析标准
  │   ├─ 不足 → 引导补充，但提供"直接分析"选项
  │   └─ 充足 → 继续
  │
  ├─ 调用工具: reserve_points(modules)
  │   └─ 预扣积分（用户选择即代表接受）
  │
  └─ 按优先级串行委派子代理执行分析（Deep Agents SDK 内置子代理委派机制）
      ├─ 委派 summary 子代理
      ├─ 委派 chronicle 子代理
      ├─ 委派 claim 子代理
      └─ ... 流式输出进度和结果
          ├─ 成功 → confirm_points(batchId, itemId)
          └─ 失败 → rollback_points(batchId, itemId)
```

### 3.3 后续多轮对话

```
用户: "帮我深入分析一下抗辩策略"
  └─ 主代理: 加载长期记忆 → 委派 defense 子代理

用户: "能不能帮我生成一份起诉状？"
  └─ 主代理: 识别文书生成任务 → 委派对应子代理（后续扩展）

用户: "我又上传了几份新证据"
  └─ 主代理: 调用 process_materials → 更新材料 → 可重新分析

用户: "之前分析的请求权部分需要修改吗？"
  └─ 主代理: 从长期记忆加载历史分析结果 → 讨论
```

### 3.4 提示词防火墙

双层防护机制：

**第一层：API 端点验证**（在 Agent 处理前）

- 输入长度限制（单次消息最大 10,000 字符）
- 关键词黑名单过滤（`system prompt`、`ignore previous`、`忽略之前的指令` 等注入模式）
- 请求频率限制（同一用户每分钟最多 10 次请求）

**第二层：System Prompt 内嵌规则**

1. **意图识别**：检测用户输入是否为法律相关需求
2. **攻击防护**：拒绝套取系统提示词、配置等敏感信息的请求
3. **友好拒绝**：非法律需求返回礼貌提示，引导用户回到正确使用场景

## 4. 服务端设计

### 4.1 DeepAgent 创建

```typescript
// server/services/agent/caseAgent.ts

async function createCaseAgent(sessionId: string, options: CaseAgentOptions) {
  // 1. 从 NodeConfig 获取主代理配置
  const mainConfig = await getValidNodeConfig('caseMain')
  const model = chatModelFactory(mainConfig)
  const systemPrompt = renderPrompt(mainConfig.prompts, { caseInfo, materials })

  // 2. 获取主代理工具
  const mainTools = await getToolInstancesService(mainConfig.tools, toolContext)

  // 3. 获取所有子代理配置（按 priority 排序，type IN ('analysis','document')）
  const subagentConfigs = await getSubagentConfigs('analysis')

  // 4. 构建子代理定义
  const subagents = subagentConfigs.map(config => ({
    name: config.name,
    description: config.title,
    model: chatModelFactory(config),
    systemPrompt: renderPrompt(config.prompts, { caseInfo }),
    tools: getToolInstancesService(config.tools, toolContext),
  }))

  // 5. 创建 DeepAgent
  return createDeepAgent({
    name: 'case-analyst',
    model,
    systemPrompt,
    tools: mainTools,
    subagents,
    store: getPostgresStore(),
    checkpointer: getCheckpointer(),
    backend: (cfg) => new CompositeBackend(
      new StateBackend(cfg),
      { '/memories/': new StoreBackend(cfg) }
    ),
    // 中断机制：
    // - extract_case_info 工具通过 interruptOn 声明式中断
    // - 模块选择通过 System Prompt 指导 Agent 调用 interrupt() 实现
    interruptOn: {
      extract_case_info: { allowed_decisions: ['approve', 'edit'] },
    },
  })
}
```

### 4.2 API 端点

```typescript
// POST /api/v1/case/analysis/chat
// 统一的对话端点

interface ChatRequest {
  sessionId: string
  message?: string
  command?: Command        // 恢复中断
  materials?: number[]     // 首次提交的材料 ID 列表
}

// 返回: SSE 流
```

### 4.3 积分事务

复用现有 `pointConsumptionRecords` 表实现积分预扣/确认/回滚事务。该表已有 `batchId`（预扣批次 ID，UUID）和 `status`（0=无效, 1=预扣, 2=已结算）字段，天然支持事务语义。

三个工具配合实现积分事务：

| 工具 | 调用时机 | 职责 | 数据库操作 |
|------|---------|------|-----------|
| `reserve_points` | 用户选择模块后 | 按模块批量预扣积分，返回 batchId | 为每个模块创建一条 status=1 的记录，共享同一个 batchId |
| `confirm_points` | 单个子代理成功后 | 确认该模块积分实扣 | 按 batchId + itemId 定位单条记录，更新 status 为 2 |
| `rollback_points` | 子代理失败时 | 回滚该模块积分预扣 | 按 batchId + itemId 定位单条记录，更新 status 为 0，恢复余额 |

每个模块在 `pointConsumptionItems` 表中有对应的 `key`（如 `analysis_summary`、`analysis_defense`），通过 `itemId` 关联。`batchId` 标识同一次预扣操作，`itemId` 区分不同模块，实现"批次预扣、逐模块确认/回滚"。

**超时保护**：预扣记录超过 1 小时未确认/回滚的，由定时任务自动回滚（status 1 → 0），防止积分永久冻结。

### 4.4 材料处理策略

`process_materials` 工具逻辑：

1. 检查材料状态（已识别？已嵌入？）
2. 对未完成的材料触发识别/嵌入
3. 计算总 token 量
4. 决定提供模式（阈值：**32,000 tokens**，约 DeepSeek 上下文窗口的 25%）：
   - `totalTokens < 32000` → 全量提供（返回完整文本）
   - `totalTokens >= 32000` → 摘要模式（返回材料列表+摘要）
5. 摘要缓存：首次生成后存入 `caseMaterials.summary` 字段，复用时不重复提取

### 4.5 长期记忆结构

```
/memories/
├── case_{caseId}/
│   ├── basic_info.txt        — 案件基础信息
│   ├── analysis_history.txt  — 历史分析结果摘要
│   ├── key_findings.txt      — 关键发现和结论
│   └── user_preferences.txt  — 用户分析偏好
```

Agent 通过 Deep Agents SDK 内置的 `manage_memory` 工具自然地读写记忆文件（SDK 自动注入，无需在工具集中显式声明）。`/memories/` 路径自动路由到 PostgresStore 持久化。

### 4.6 NodeConfig 配置结构

现有 nodes 表 `type` 字段已有 `'analysis'`（分析模块）和 `'document'`（文书模块）两种值。重构后新增 `'agent'` 类型用于主代理，分析子代理继续使用 `'analysis'`，文书子代理继续使用 `'document'`。

```
nodes 表:
┌──────────────┬──────────┬────────────┬────────┬───────────────────────────┐
│ name         │ type     │ modelId    │priority│ tools (JSON)              │
├──────────────┼──────────┼────────────┼────────┼───────────────────────────┤
│ caseMain     │ agent    │ deepseek-1 │ 0      │ [process_materials,       │
│              │          │            │        │  extract_case_info,       │
│              │          │            │        │  search_case_materials,   │
│              │          │            │        │  search_law,              │
│              │          │            │        │  reserve_points,          │
│              │          │            │        │  confirm_points,          │
│              │          │            │        │  rollback_points]         │
├──────────────┼──────────┼────────────┼────────┼───────────────────────────┤
│ summary      │ analysis │ deepseek-1 │ 1      │ [search_case_materials,   │
│              │          │            │        │  search_law]              │
├──────────────┼──────────┼────────────┼────────┼───────────────────────────┤
│ chronicle    │ analysis │ deepseek-1 │ 2      │ [search_case_materials]   │
├──────────────┼──────────┼────────────┼────────┼───────────────────────────┤
│ claim        │ analysis │ deepseek-1 │ 3      │ [search_case_materials,   │
│              │          │            │        │  search_law]              │
├──────────────┼──────────┼────────────┼────────┼───────────────────────────┤
│ trend        │ analysis │ deepseek-1 │ 4      │ [search_case_materials,   │
│              │          │            │        │  search_law]              │
├──────────────┼──────────┼────────────┼────────┼───────────────────────────┤
│ cause        │ analysis │ deepseek-1 │ 5      │ [search_law]              │
├──────────────┼──────────┼────────────┼────────┼───────────────────────────┤
│ defense      │ analysis │ deepseek-1 │ 6      │ [search_case_materials,   │
│              │          │            │        │  search_law]              │
├──────────────┼──────────┼────────────┼────────┼───────────────────────────┤
│ evidence     │ analysis │ deepseek-1 │ 7      │ [search_case_materials]   │
└──────────────┴──────────┴────────────┴────────┴───────────────────────────┘
```

每个节点在 prompts 表中关联对应的 system prompt，定义该代理/子代理的角色和行为。

## 5. 前端设计

### 5.1 技术栈变更

```
移除:
- ai-sdk (vercel ai sdk) → 被 @langchain/vue 替代

保留:
- ai-element-vue (完整 AI 交互 UI 组件库)

新增:
- @langchain/vue v0.3.0 (useStream composable)
- @langchain/core (消息类型)
```

### 5.2 分工

| 职责 | 库 |
|------|-----|
| SSE 流管理、中断处理、线程切换、子代理追踪 | `@langchain/vue` useStream |
| 对话容器、消息气泡、工具调用、任务队列、推理展示 | `ai-element-vue` |
| 中断交互表单（信息确认、模块选择） | 自定义组件 + Confirmation |
| 工具自定义 UI（法条展示、材料展示、积分展示） | 自定义组件 + Tool |

### 5.3 ai-element-vue 组件使用规划

| 组件类别 | 组件 | 用途 |
|---------|------|------|
| 对话容器 | Conversation, ConversationContent, ConversationScrollButton | 包裹整个对话界面 |
| 消息系统 | Message, MessageContent, MessageResponse, MessageAvatar, MessageActions, MessageBranch | 消息渲染、角色区分、分支 |
| 输入区域 | PromptInput, PromptInputTextarea, PromptInputSubmit, PromptInputAttachments | 智能输入框、附件上传 |
| 工具调用 | Tool, ToolHeader, ToolContent, ToolInput, ToolOutput, ToolStatusBadge | 工具执行状态（7 种状态） |
| 中断确认 | Confirmation, ConfirmationRequest, ConfirmationAccepted, ConfirmationRejected, ConfirmationActions | 确认/修改/拒绝流程 |
| 任务队列 | Queue, QueueSection, QueueItem, QueueItemIndicator, QueueItemContent | 分析任务队列和进度 |
| 思维链 | ChainOfThought, ChainOfThoughtStep | 子代理推理过程 |
| 推理过程 | Reasoning, ReasoningTrigger, ReasoningContent | AI 深度思考（可折叠） |
| 来源引用 | Sources, SourcesTrigger, SourcesContent, Source | 法条/材料来源 |
| 行内引用 | InlineCitation, InlineCitationCard | 法条行内引用 |
| 代码块 | CodeBlock, CodeBlockCopyButton | 法律条文展示 |
| 工件 | Artifact, ArtifactHeader, ArtifactContent, ArtifactActions | 分析报告/文书预览 |
| 计划 | Plan, PlanTrigger, PlanHeader, PlanContent, PlanAction | 分析执行计划 |
| 建议 | Suggestion, Suggestions | 快速分析建议 |
| 检查点 | Checkpoint, CheckpointTrigger, CheckpointIcon | 流程关键步骤标记 |
| 加载 | Loader, LoaderIcon, Shimmer | 加载状态 |

### 5.4 自定义工具 UI

#### 材料检索 (search_case_materials)

- ToolInput: 显示搜索关键词 Badge
- ToolOutput: Sources 组件展示材料片段卡片列表，每个 Source 显示材料名称和匹配文本

#### 法律检索 (search_law)

- ToolInput: legalType Badge + 搜索词
- ToolOutput: InlineCitation + InlineCitationCard 展示法条，CodeBlock 显示条文全文

#### 材料处理 (process_materials)

- ToolOutput: Queue + QueueItem 展示每个材料的处理状态和类型，底部显示提供模式（全量/摘要）

#### 积分预扣 (reserve_points)

- ToolOutput: 积分明细列表（模块名 + 扣减积分 Badge），底部 Separator + 总计/余额

#### 信息提取 (extract_case_info) — 带中断

- 使用 Confirmation 包装
- ConfirmationRequest: 可编辑的案件信息表单
- ConfirmationAccepted: 确认后的只读信息展示
- ConfirmationActions: "确认信息" / "修改后确认"

#### 模块选择 — 中断交互（非工具）

模块选择由主代理 System Prompt 驱动：Agent 输出模块列表后调用 `interrupt()` 暂停，前端展示选择界面，用户选择后通过 `Command({ resume })` 恢复。

- 使用 Confirmation 包装
- ConfirmationRequest: Suggestions 组件展示可选模块（含积分消耗、会员限制标识）
- ConfirmationActions: "开始分析"

### 5.5 分析任务执行 UI

使用 Queue + Artifact + Reasoning 组合：

- QueueSection: 每个分析任务，含 QueueItemIndicator 状态指示 + 积分 Badge
- 执行中: Reasoning 组件展示推理过程（可折叠）
- 完成: Artifact 组件展示分析结果（Markdown 渲染 + 复制/导出操作）
- 子代理内部工具调用: 嵌套 Tool 组件展示

### 5.6 组件文件结构

```
app/components/caseAnalysis/
├── ChatContainer.vue         — useStream + Conversation 集成
├── PromptInput.vue           — 适配 stream.submit 的输入组件
├── MaterialUpload.vue        — 材料上传（保留现有）
├── interrupts/
│   ├── CaseInfoConfirm.vue   — 基础信息确认（Confirmation + 表单）
│   └── ModuleSelector.vue    — 模块选择（Confirmation + Suggestions）
├── tools/
│   ├── ToolRenderer.vue      — 工具路由（按 toolName 分发到对应组件）
│   ├── MaterialSearchTool.vue — 材料检索展示
│   ├── LawSearchTool.vue     — 法条检索展示
│   ├── MaterialProcessTool.vue — 材料处理状态
│   ├── PointsReserveTool.vue — 积分扣减展示
│   └── ExtractInfoTool.vue   — 信息提取（带中断确认）
├── analysis/
│   ├── TaskQueue.vue         — 分析任务队列
│   ├── TaskProgress.vue      — 单个任务进度
│   └── TaskResult.vue        — 任务结果展示
└── shared/
    └── MarkdownRenderer.vue  — Markdown 渲染
```

## 6. 数据模型变更

### 6.1 表变更

| 表 | 变更 | 说明 |
|---|------|------|
| nodes | 新增 `type='agent'` | 主代理类型，现有 `'analysis'`/`'document'` 继续作为子代理类型 |
| caseMaterials | 新增 `summary` 字段 | 材料摘要缓存（Text 类型，可空） |
| LangGraph Store 表 | 自动创建 | PostgresStore 长期记忆（由 `@langchain/langgraph-checkpoint-postgres` 自动建表） |

### 6.2 积分系统复用

**不新建表**，复用现有 `pointConsumptionRecords` 表：

- `batchId` (VARCHAR 36) — 作为预扣批次标识，同一次预扣操作的多条记录共享相同的 batchId
- `status` — 0=无效(已回滚), 1=预扣, 2=已结算(已确认)
- `itemId` — 关联 `pointConsumptionItems` 表中的分析模块积分配置
- `sourceId` — 关联到 `caseAnalyses` 的记录 ID

工具映射：
- `reserve_points` → 复用现有积分扣减逻辑（按 pointRecords 过期时间升序选择），创建 status=1 的记录，生成 UUID 作为 batchId
- `confirm_points` → 按 batchId + itemId 定位单条记录，更新 status 为 2
- `rollback_points` → 按 batchId + itemId 定位单条记录，更新 status 为 0，恢复 pointRecords.remaining

### 6.3 保持不变的表

cases, caseSessions, caseAnalyses, caseMaterialEmbeddings, prompts, nodeGroups, levelNodeAccess, checkpoints 系列表, pointRecords, pointConsumptionItems, pointConsumptionRecords

## 7. 复用模块清单

| 模块 | 复用方式 | 需要的调整 |
|------|---------|-----------|
| chatModelFactory | 直接复用 | 无 |
| NodeConfig/NodeService | 复用并扩展 | 新增 `getSubagentConfigs()` 方法，按 type IN ('analysis','document') + priority 查询 |
| PromptService | 直接复用 | 无 |
| ToolRegistry | 复用并扩展 | 新增积分工具（reserve/confirm/rollback） |
| PostgresSaver | 直接复用 | 无 |
| MaterialService | 复用并扩展 | 新增摘要缓存逻辑 |
| search_case_materials 工具 | 直接复用 | 无 |
| search_law 工具 | 直接复用 | 无 |

## 8. 需要移除的代码

以下代码被新的 DeepAgent 架构替代：

```
移除:
server/services/workflow/caseAnalysis.workflow.ts  — LangGraph 工作流图
server/services/workflow/caseAnalysis.workflow.new.ts — 未完成的新工作流
server/services/workflow/state.ts                  — 工作流状态定义
server/services/workflow/nodes/*.ts                — 工作流节点（5个）
server/services/agent/main.ts                      — 旧 DeepAgent 主代理
server/api/v1/case/analysis/stream/[sessionId].post.ts — 旧流式端点
app/composables/useCaseAnalysis.ts                 — 旧 SSE 处理 composable

替换为:
server/services/agent/caseAgent.ts                 — 新 DeepAgent 创建
server/api/v1/case/analysis/chat.post.ts           — 新统一对话端点
app/composables/useCaseChat.ts                     — 基于 @langchain/vue useStream
```

## 9. 迁移策略

### 9.1 分阶段实施

采用**新旧并行 → 切换 → 清理**三阶段迁移，最大程度降低风险：

| 阶段 | 内容 | 回滚方式 |
|------|------|---------|
| Phase 1: 基础设施 | 安装依赖、Prisma migration（caseMaterials.summary 字段、caseMain 节点数据）、实现 caseAgent.ts 和新 API 端点 | 删除新代码，旧端点不受影响 |
| Phase 2: 前端适配 | 实现 useCaseChat.ts、新组件；通过路由参数 `?v=2` 切换新旧版本 | 移除路由参数回退到旧版 |
| Phase 3: 功能验证 | 内部测试新流程，修复问题 | 路由参数回退 |
| Phase 4: 切换 | 新版本设为默认，旧版本通过 `?v=1` 保留 | 路由参数回退 |
| Phase 5: 清理 | 移除旧代码、旧端点、旧 composable | Git revert 到 Phase 4 |

### 9.2 数据库迁移

- `nodes` 表新增 `type='agent'` 记录 → 标准 Prisma migration，无破坏性
- `caseMaterials` 新增 `summary` 列 → 可空字段，向后兼容
- LangGraph Store 表 → PostgresStore 自动创建，无需手动迁移
- 现有 checkpoints 表数据 → 旧会话数据保留，新会话使用新架构

### 9.3 回滚预案

每个阶段的回滚都不影响数据完整性：

- Phase 1-2 回滚：新旧代码并行存在，移除新代码即可
- Phase 4 回滚：路由参数切换回旧版，用户无感知
- 数据库回滚：新增的列和记录无需删除（可空字段，不影响旧逻辑）

## 10. 错误处理与降级

### 10.1 Agent 层错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| 模型 API 调用失败 | 重试 2 次（指数退避），仍失败则向用户报告错误并回滚已预扣积分 |
| 子代理执行超时 | 单个子代理超时限制 15 分钟，超时后跳过该模块，回滚对应积分，继续执行后续模块 |
| 材料识别/嵌入失败 | 跳过失败材料，使用已成功的材料继续分析，提示用户哪些材料处理失败 |
| 工具调用异常 | 捕获异常并返回结构化错误信息，Agent 根据错误决定重试或告知用户 |

### 10.2 前端层错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| SSE 连接断开 | useStream 自动重连，展示重连状态 |
| 中断响应超时 | 前端倒计时提示，超时后可重新提交 |
| 流式数据解析失败 | 显示原始文本作为降级展示 |

### 10.3 积分保护

- 预扣积分设置 1 小时超时自动回滚
- 每个子代理完成后立即确认/回滚对应积分，不等待全部完成
- 异常中断（服务器崩溃等）→ 定时任务扫描超时预扣记录并回滚（使用 Nitro scheduled tasks 或 node-cron 实现）

## 11. 测试策略

### 11.1 测试层次

| 层次 | 范围 | 工具 |
|------|------|------|
| 单元测试 | 工具函数、积分计算、材料处理逻辑 | Vitest |
| 集成测试 | API 端点、Agent 创建、工具注册 | Vitest + 测试数据库 |
| E2E 测试 | 完整分析流程（材料上传→分析→结果） | Vitest + LangSmith |

### 11.2 关键测试场景

- 积分预扣/确认/回滚事务完整性
- 材料全量/摘要模式切换（边界值: 32,000 tokens）
- 中断恢复（extract_case_info 工具中断 和 模块选择 interrupt() 中断）
- 子代理串行执行顺序和错误隔离
- 提示词防火墙（注入攻击、非法律需求、正常请求）
- SSE 流式输出的完整性和断线重连
- 长期记忆读写和跨会话持久化

## 12. 扩展预留

### 12.1 登录/注册 Agent 集成（未来）

主代理的 System Prompt 中预留未认证用户的引导逻辑。当 `event.context.auth` 为空时，引导用户完成注册登录。具体实现在后续迭代中设计。

### 12.2 会员/积分购买 Agent 集成（未来）

当积分不足或会员权限不够时，主代理引导用户购买。可通过新增子代理或工具实现。

### 12.3 文书生成（未来）

作为新的子代理类型添加，使用结构化输出 + Word 模板填充。在 NodeConfig 中 type='document'，排在分析子代理之后按 priority 执行。

## 13. 关键技术参考

- Deep Agents SDK: `createDeepAgent()` API
- @langchain/vue: `useStream` composable (v0.3.0)
- LangGraph Interrupt: `interrupt()` + `Command({ resume })`
- CompositeBackend: `StateBackend` + `StoreBackend` 路由
- PostgresStore: `@langchain/langgraph-checkpoint-postgres`
- ai-element-vue: https://www.ai-elements-vue.com/overview/introduction
- LangChain 文档: https://docs.langchain.com/llms.txt
