# createAgent → createDeepAgent 迁移设计

## 概述

将小索（caseMainAgent）和模块对话（moduleAgent）从 LangGraph 原生 `createAgent`（`langchain` 包）迁移到 `createDeepAgent`（`deepagents` 包），获得标准 skills 能力、内置规划工具、子代理上下文隔离和自动摘要等能力。

**初始化分析工作流（`caseAnalysisV2.workflow.ts`）不动。**

## 迁移动机

1. **Skills 能力**（核心诱因）：deepagent 原生支持 skills 系统（`.deepagents/skills/` 目录下的 `SKILL.md`），可为 Agent 注入领域知识
2. **内置规划**：`write_todos` 工具自动进行任务分解和进度追踪
3. **子代理隔离**：内置 `SubAgentMiddleware` 替代手写 `subAgentToolFactory`，上下文自动隔离
4. **上下文管理**：内置 filesystem 工具 + `summarizationMiddleware`，大结果自动卸载到文件

## 依赖兼容性

| 依赖 | 项目当前版本 | deepagents v1.9.0 要求 | 状态 |
|------|------------|----------------------|------|
| `langchain` | ^1.3.1 | ^1.3.1 | ✅ 一致 |
| `@langchain/core` | ^1.1.39 | ^1.1.38 | ✅ 兼容 |
| `@langchain/langgraph` | ^1.2.8 | ^1.2.8 | ✅ 一致 |
| `zod` | ^4.2.1 | ^4.3.6 | ⚠️ 需升级 |

**新增依赖**：`deepagents@^1.9.0`

## 约束

- `caseAnalysisV2.workflow.ts`（StateGraph 工作流）完全不动
- 业务中间件（积分扣减、材料上下文注入、结果持久化）保持不变
- 现有 SSE/Redis 事件管道完全复用
- 返回格式与现有 `ReadableStream<Uint8Array>` SSE 格式兼容
- `caseAnalysis.ts`（Workflow 内的 Agent 工厂）继续使用 `createAgent`

## 架构设计

### 影响范围

```
迁移到 createDeepAgent:
├── server/services/workflow/agents/caseMainAgent.ts    ← 小索主代理
├── server/services/workflow/agents/moduleAgent.ts       ← 模块对话代理
└── server/services/workflow/agents/subAgentToolFactory.ts ← 可能被替代

不受影响:
├── server/services/workflow/caseAnalysisV2.workflow.ts  ← 初始化工作流
├── server/services/workflow/agents/caseAnalysis.ts      ← 工作流内 Agent 工厂
├── server/services/workflow/middleware/*                 ← 所有业务中间件
├── server/services/workflow/tools/*                      ← 所有工具定义
├── server/services/agent/*                               ← Worker/DAO/事件桥
└── server/api/v1/case/analysis/*                         ← API 端点
```

### 小索主代理（caseMainAgent.ts）迁移

**Before**:
```typescript
import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'

const agent: ReactAgent = createAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools: allTools,   // 通用工具 + subAgentToolFactory 生成的子代理工具
    middleware: [
        pointConsumptionMiddleware(...),
        caseProcessMaterialMiddleware(...),
        caseMaterialContextMiddleware(...),
        summarizationMiddleware({...}),
        safetyTrimMiddleware({...}),
    ],
})
```

**After**:
```typescript
import { createDeepAgent, type DeepAgent } from 'deepagents'

const agent: DeepAgent = await createDeepAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools: directTools,  // 仅通用工具（search_law, search_case_materials 等）
    subagents: subAgentConfigs,  // deepagent 内置子代理机制
    skills: ['/skills/'],  // skills 目录
    middleware: [
        // 业务中间件保留
        pointConsumptionMiddleware(...),
        caseProcessMaterialMiddleware(...),
        caseMaterialContextMiddleware(...),
        // safetyTrimMiddleware 保留作为兜底
        safetyTrimMiddleware({...}),
    ],
    // deepagent 内置：todoListMiddleware, FilesystemMiddleware, SubAgentMiddleware, summarizationMiddleware
})
```

**关键变化**：
1. `summarizationMiddleware` → deepagent 内置，移除手动挂载
2. `subAgentToolFactory` → 改用 `subagents` 参数声明式配置
3. 新增 `skills` 参数加载领域知识
4. 返回类型从 `ReactAgent` 变为 `DeepAgent`（继承自 `ReactAgent`，所有 LangGraph 操作兼容）

### 子代理配置转换

**Before**（subAgentToolFactory.ts 动态生成工具）:
```typescript
const subTools = await createSubAgentTools(subAgentConfigs, {
    sessionId, userId, caseId, checkpointer, store
})
// 每个工具内部创建独立的 createAgent 子代理
```

**After**（deepagent subagents 声明）:
```typescript
import type { SubAgent } from 'deepagents'

const subagents: SubAgent[] = subAgentConfigs.map(config => ({
    name: sanitizeName(config.name),
    description: config.title || config.description,
    systemPrompt: renderSystemPrompt(config),
    tools: getToolInstancesService(config.tools, toolContext),
    model: createChatModel(config),
    middleware: [
        pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
    ],
}))
```

**优势**：
- 子代理上下文自动隔离（deepagent 内置机制）
- 无需手写 tool wrapper + async generator 流式输出
- 子代理自动继承 checkpointer/store

### 模块对话代理（moduleAgent.ts）迁移

**Before**:
```typescript
import { createAgent, summarizationMiddleware, type ReactAgent } from 'langchain'

const agent: ReactAgent = createAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools: allTools,
    middleware: [
        pointConsumptionMiddleware(...),
        moduleContextMiddleware(...),
        summarizationMiddleware({...}),
        safetyTrimMiddleware({...}),
    ],
})
```

**After**:
```typescript
import { createDeepAgent, type DeepAgent } from 'deepagents'

const agent: DeepAgent = await createDeepAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools: allTools,  // 节点工具 + saveAnalysisResult
    skills: ['/skills/'],
    middleware: [
        pointConsumptionMiddleware(...),
        moduleContextMiddleware(...),
        safetyTrimMiddleware({...}),
    ],
    // deepagent 内置：todoListMiddleware, FilesystemMiddleware, summarizationMiddleware
})
```

**关键变化**：
- 与 caseMainAgent 类似：移除手动 `summarizationMiddleware`，新增 `skills`
- 模块对话无子代理，不需要 `subagents` 参数

### Skills 目录结构

```
.deepagents/
└── skills/
    ├── SKILL.md                    # 通用法律分析技能
    ├── case-analysis/
    │   └── SKILL.md                # 案件分析专用指令
    ├── legal-research/
    │   └── SKILL.md                # 法律法规检索技能
    └── material-processing/
        └── SKILL.md                # 材料处理技能
```

Skills 内容包含：
- 法律分析方法论和框架
- 案件类型识别和处理策略
- 输出格式和质量标准
- 工具使用最佳实践

### Backend 配置

deepagent 的 filesystem 工具需要配置 backend。对于本项目，推荐使用 `StoreBackend`（复用现有 PostgresStore）：

```typescript
import { StoreBackend } from 'deepagents'

const agent = await createDeepAgent({
    backend: (config) => new StoreBackend(config),
    store: getStore(),   // 复用现有 PostgresStore 单例
    // ...
})
```

这样 filesystem 操作（大结果卸载、context 文件读写）持久化在 PostgresStore 中，与现有检查点存储统一。

### 工具冲突检查

deepagent 内置工具名称：`write_todos`, `read_file`, `write_file`, `edit_file`, `ls`, `glob`, `grep`, `execute`, `task`

**与现有工具对比**：

| deepagent 内置 | 项目现有工具 | 冲突？ |
|---------------|------------|--------|
| write_todos | 无 | ✅ 无冲突 |
| read_file | 无 | ✅ 无冲突 |
| write_file | 无 | ✅ 无冲突 |
| edit_file | 无 | ✅ 无冲突 |
| ls / glob / grep | 无 | ✅ 无冲突 |
| execute | 无 | ✅ 无冲突 |
| task (subagent) | 无 | ✅ 无冲突 |

**无命名冲突**，现有工具（search_case_materials、search_law、process_materials、reserve_points 等）名称都不与 deepagent 内置工具重复。

### Interrupt 兼容性

deepagent 的 `interruptOn` 参数支持 HITL 工作流。当前项目的 interrupt 通过中间件（`pointConsumptionMiddleware` 的 `beforeAgent` 钩子）实现，不使用 `interruptOn`。

**兼容性确认**：
- 中间件内的 `interrupt()` 调用在 `DeepAgent`（继承自 `ReactAgent`）中正常工作
- `Command({ resume })` 恢复机制不受影响
- Worker 的 interrupted 状态检测逻辑不变

### 流式输出兼容性

`DeepAgent` 继承自 `ReactAgent`，支持完全相同的 stream 参数：

```typescript
agent.stream(input, {
    configurable: { thread_id: sessionId },
    streamMode: ['values', 'messages', 'updates'],
    subgraphs: true,
    encoding: 'text/event-stream',
    recursionLimit: 1000,
})
```

**注意**：deepagent 默认 `recursionLimit: 10000`，但我们显式设为 1000 以保持现有行为。

## 文件变更清单

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `server/services/workflow/agents/caseMainAgent.ts` | `createAgent` → `createDeepAgent`，添加 subagents/skills/backend |
| `server/services/workflow/agents/moduleAgent.ts` | `createAgent` → `createDeepAgent`，添加 skills/backend |
| `package.json` | 新增 `deepagents@^1.9.0`，升级 `zod@^4.3.6` |

### 可能删除

| 文件 | 条件 |
|------|------|
| `server/services/workflow/agents/subAgentToolFactory.ts` | 如果 deepagent 内置 subagent 机制完全覆盖需求 |

**注意**：`subAgentToolFactory.ts` 的删除需要验证 deepagent 的 subagent 机制能否满足以下需求：
1. 子代理自定义中间件（pointConsumptionMiddleware）
2. 子代理动态工具加载
3. 子代理流式输出传播到主代理
4. 子代理 interrupt 冒泡

如果有功能缺口，保留 `subAgentToolFactory.ts` 作为 fallback。

### 新增文件

| 文件 | 职责 |
|------|------|
| `.deepagents/skills/SKILL.md` | 通用法律分析 Skill 定义 |
| `.deepagents/skills/case-analysis/SKILL.md` | 案件分析专用 Skill |

### 不受影响

- `server/services/workflow/caseAnalysisV2.workflow.ts` — 初始化工作流
- `server/services/workflow/agents/caseAnalysis.ts` — 工作流内 Agent 工厂（继续用 createAgent）
- `server/services/workflow/middleware/*` — 所有业务中间件
- `server/services/workflow/tools/*` — 所有工具定义
- `server/services/agent/*` — Worker/DAO/事件桥
- `server/api/v1/case/analysis/*` — API 端点

### 依赖变更

| 操作 | 包名 | 版本 |
|------|------|------|
| 新增 | `deepagents` | ^1.9.0 |
| 升级 | `zod` | ^4.2.1 → ^4.3.6 |

## 风险评估

### 低风险
- **依赖兼容性**：deepagents 的依赖与项目完全一致
- **工具冲突**：无命名冲突
- **API 兼容**：`DeepAgent` 继承 `ReactAgent`，stream/invoke/getState 完全兼容

### 中等风险
- **子代理机制差异**：deepagent 的 subagent 通过内置 `task` 工具实现，与当前的 tool-wrapper 模式不同。需要验证：
  - 子代理中间件是否正常工作
  - interrupt 冒泡是否正确
  - 流式输出是否完整传播
- **内置工具副作用**：deepagent 自动挂载 filesystem、todoList 工具。需确保：
  - 这些工具不干扰现有业务流程
  - LLM 不会过度使用这些工具（通过 systemPrompt 引导）

### 高风险
- **zod 升级**：从 ^4.2.1 升级到 ^4.3.6，需全项目验证兼容性
- **summarization 行为变化**：deepagent 内置的 summarizationMiddleware 配置可能与现有参数不同，需要验证摘要触发阈值和行为

## 迁移步骤

1. **依赖安装**：`bun add deepagents@^1.9.0` + `bun add zod@^4.3.6`
2. **Skills 目录创建**：建立 `.deepagents/skills/` 结构
3. **caseMainAgent 迁移**：改用 createDeepAgent，配置 subagents
4. **moduleAgent 迁移**：改用 createDeepAgent
5. **验证 subAgentToolFactory 可替代性**：测试 deepagent subagent 机制
6. **集成测试**：SSE 流式输出、interrupt/resume、多轮对话
7. **性能基准**：对比迁移前后 token 消耗和响应延迟

## 参考资料

- [deepagentsjs GitHub](https://github.com/langchain-ai/deepagentsjs)
- [deepagents npm](https://www.npmjs.com/package/deepagents)
- [Skills 文档](https://docs.langchain.com/oss/javascript/deepagents/skills)
- [createDeepAgent API](https://deepwiki.com/langchain-ai/deepagentsjs/4-createdeepagent-api)
- [Customize Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/customization)
