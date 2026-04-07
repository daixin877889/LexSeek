# 对话式代理架构重构：deepagents → LangGraph createAgent

## 概述

将对话式聊天代理（`analysis/chat`）从 `deepagents` SDK 迁移到 LangGraph 原生 `createAgent`，实现主代理+子代理的动态路由架构，同时将积分扣减从按模块计费改为按 Token 计费。

## 目标

1. **完全移除 `deepagents` SDK 依赖**：替换 `caseAgent.ts`、`main.ts`、`extractInfo.ts` 中所有 deepagents 用法
2. **主代理+子代理动态路由**：主代理（`caseMain` 节点）接收用户消息，根据意图分发给子代理（`nodes` 表 `type=analysis/document` 的节点）
3. **按 Token 扣费**：复用 `pointConsumptionMiddleware`，主代理和子代理独立按 token 消耗扣费
4. **代码迁移**：逻辑从 `server/services/agent/` 移至 `server/services/workflow/agents/`

## 约束

- caseAnalysisV2 LangGraph workflow 完全不动
- 现有 SSE/Redis 事件管道（`agentEventBridge`、`agentWorker`）完全复用
- `agentRun.dao.ts`、`agentRun.service.ts` 等基础设施层不变
- 返回格式与现有 `caseAgent.ts` 的 `ReadableStream<Uint8Array>` SSE 格式兼容

## 架构设计

### 整体流程

```
用户发送消息
  ↓
chat.post.ts → enqueueRunService() → Redis 通知
  ↓
agentWorker.ts → executeRun() → 调用新的 runCaseChat()
  ↓
caseMainAgent.ts
  ├── 1. 从 DB 加载 caseMain 节点配置 (getNodeConfigService('caseMain'))
  ├── 2. 从 DB 加载所有 analysis/document 节点 (getNodeConfigsByTypes)
  ├── 3. 为每个子节点生成 tool (subAgentToolFactory)
  ├── 4. 加载主代理通用工具 (search_law, search_case_materials 等)
  ├── 5. createAgent({ model, tools, prompt, checkpointer, middleware })
  └── 6. agent.stream() → ReadableStream<SSE> → Worker 解析 → Redis 发布
```

### 文件结构

```
server/services/workflow/agents/
├── caseMainAgent.ts          # 主代理创建和执行
├── subAgentToolFactory.ts    # 子代理工具动态生成
└── index.ts                  # 统一导出
```

### 子代理工具工厂（subAgentToolFactory.ts）

每个 `type=analysis/document` 的节点动态生成一个 `async generator tool`：

```typescript
async function createSubAgentTools(
  nodeConfigs: NodeConfig[],
  context: { sessionId: string; userId: number; caseId: number; checkpointer: BaseCheckpointSaver }
): Promise<StructuredTool[]>
```

**每个子代理工具的内部流程：**

1. 从 `NodeConfig` 提取模型配置 → `createChatModel()`
2. 从 `NodeConfig` 提取工具列表 → `getToolInstancesService()`
3. 从 `NodeConfig` 提取系统提示词 → `prompts.find(p => p.type === 'system' && p.status === 1)`
4. 创建子代理 → `createAgent({ model, tools, prompt, checkpointer, middleware, name })`
5. 使用 async generator 流式执行 → `yield` 每个 token 产生 `on_tool_event`
6. 返回最终结果字符串

**工具签名：**
```typescript
{
  name: `ask_${config.name}_expert`,
  description: config.title || config.description,
  schema: z.object({ question: z.string() })
}
```

### 主代理（caseMainAgent.ts）

**入口函数签名（与现有 caseAgent.ts 兼容）：**

```typescript
export async function runCaseChat(
  sessionId: string,
  message: string,
  options: { userId: number; caseId: number; command?: string }
): Promise<ReadableStream<Uint8Array>>
```

**内部步骤：**

1. 获取主代理配置：`getNodeConfigService('caseMain')`（`type=agent`）
2. 验证配置完整性：`validateNodeConfig()`
3. 创建主代理模型：`createChatModel()` + API Key 轮转
4. 获取所有子代理节点：`getNodeConfigsByTypes(['analysis', 'document'])`
5. 生成子代理工具：`createSubAgentTools(nodeConfigs, context)`
6. 加载主代理通用工具：`getToolInstancesService(mainConfig.tools, toolContext)`
7. 合并工具列表：`[...通用工具, ...子代理工具]`
8. 创建主代理：
   ```typescript
   createAgent({
     model,
     tools: allTools,
     prompt: systemPrompt,
     checkpointer,
     name: 'caseMain',
     middleware: [
       pointConsumptionMiddleware(userId, 'case_analysis_token'),
     ],
   })
   ```
9. 流式执行：
   ```typescript
   agent.stream(
     { messages: [{ role: 'user', content: message }] },
     {
       configurable: { thread_id: sessionId },
       streamMode: ['values', 'messages', 'updates'],
       version: 'v2',
       subgraphs: true,
       encoding: 'text/event-stream',
     }
   )
   ```

### 消息流持久化

```
PostgreSQL Checkpointer (共享实例)
├── thread: {sessionId}                    # 主代理完整对话历史
├── thread: {sessionId}:{case_summary}     # 子代理 case_summary 对话历史
├── thread: {sessionId}:{legal_risk}       # 子代理 legal_risk 对话历史
└── ...每个子代理独立 thread，namespace 隔离
```

**多轮对话续接：** 用户下次发送消息时，主代理通过相同 `thread_id = sessionId` 恢复完整对话历史，包括之前的工具调用记录。

**刷新页面恢复：** 复用现有 Redis Stream `run_events:{runId}` 的 `replayEvents()` 机制，Worker 将所有 stream event 发布到 Redis，SSE 端点在重连时补发。

### 动态节点加载

每次调用 `runCaseChat` 时：
1. 重新从 DB 查询 `getNodeConfigsByTypes(['analysis', 'document'])`
2. 重新构建子代理工具列表
3. 重新创建 agent 实例

→ 数据库新增/修改/删除节点配置后，**下次对话自动生效，无需重启**。

### 积分按 Token 扣费

复用 `server/services/workflow/middleware/pointConsumption.middleware.ts`：

**主代理：**
- `middleware: [pointConsumptionMiddleware(userId, 'case_analysis_token')]`
- `afterModel` 钩子在每次主代理 LLM 调用后触发，按实际 token 扣费

**子代理：**
- 同样挂载 `pointConsumptionMiddleware`
- 子代理的 `afterModel` 只在子代理自身的 LLM 调用后触发

**无重复扣费保证：**
- 主代理和子代理是独立的 `createAgent` 实例，各自的 middleware 只计自己的 LLM 调用
- 主代理看到子代理的结果是工具返回值（字符串），不会触发主代理的 `afterModel`
- 只有主代理处理工具结果生成回复时才会触发主代理的 `afterModel`

**Token 消耗场景全覆盖：**

| 场景 | 主代理扣费 | 子代理扣费 |
|------|-----------|-----------|
| 用户提问，主代理直接回答 | ✅ 1次 LLM | — |
| 主代理路由到子代理 | ✅ 决策+总结 各1次 | ✅ 子代理内部N次 LLM |
| 子代理内部使用工具 | — | ✅ 每次 LLM 调用 |
| 多个子代理并行 | ✅ 决策+总结 | ✅ 每个子代理独立 |

### 流式输出

- **主代理 token 流式**：`encoding: 'text/event-stream'` → LangGraph 原生 SSE 格式
- **子代理 token 流式**：async generator tool 的 `yield` 产生 `on_tool_event`，通过 `streamMode: ['tools']` 或 `subgraphs: true` 传递到主代理的 stream
- **前端接收**：与现有 `@langchain/vue` + `FetchStreamTransport` 兼容

## 文件变更清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/services/workflow/agents/caseMainAgent.ts` | 主代理创建和执行入口 |
| `server/services/workflow/agents/subAgentToolFactory.ts` | 子代理工具动态生成工厂 |
| `server/services/workflow/agents/index.ts` | 统一导出 |

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `server/services/agent/agentWorker.ts` | `runCaseChat` import 改为从 `workflow/agents` 导入 |
| `server/services/workflow/nodes/extractInfo.ts` | 替换 `createDeepAgent` 为 `createAgent` |

### 删除文件

| 文件 | 原因 |
|------|------|
| `server/services/agent/caseAgent.ts` | 被 `workflow/agents/caseMainAgent.ts` 替代 |
| `server/services/agent/main.ts` | 遗留代码，不再使用 |
| `server/services/agent/threadState.ts` | 未使用 |

### 依赖变更

| 操作 | 包名 | 原因 |
|------|------|------|
| 移除 | `deepagents` | 全部替换为 LangGraph 原生 |

### 保持不变

- `server/services/agent/agentEventBridge.ts` — Redis 事件桥
- `server/services/agent/agentRun.dao.ts` — 运行记录 DAO
- `server/services/agent/agentRun.service.ts` — 运行服务
- `server/services/agent/agentWorker.ts`（除 import 变更外） — Worker 主循环
- `server/services/workflow/caseAnalysisV2.workflow.ts` — 结构化分析流程
- `server/services/workflow/tools/*` — 工具定义
- `server/services/workflow/middleware/*` — 中间件（直接复用）
- `server/api/v1/case/analysis/chat.post.ts` — SSE 端点（无需改动）

## 技术决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 子代理模式 | Subagent-as-Tool | 官方推荐，多轮对话友好，动态加载简单 |
| 主代理配置来源 | DB `nodes` 表 `caseMain` 节点 | 配置驱动，与现有架构一致 |
| 子代理配置来源 | DB `nodes` 表 `type=analysis/document` | 动态加载，无需重启 |
| SSE/Redis | 完全复用现有管道 | 避免重复造轮子，保持刷新恢复能力 |
| 积分扣费 | 复用 `pointConsumptionMiddleware` | 按 Token 计费，主/子代理独立计费 |
| 新代码位置 | `server/services/workflow/agents/` | 按用户要求迁移 |
