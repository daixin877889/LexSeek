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

**新增依赖**：`deepagents@^1.9.0`、`langsmith@>=0.5.15`（deepagents peerDependency）

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

// createDeepAgent 是同步函数，直接返回 DeepAgent
const agent: DeepAgent = createDeepAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools: directTools,  // 仅通用工具（search_law, search_case_materials 等）
    subagents: subAgentConfigs,  // deepagent 内置子代理机制
    skills: ['/skills/'],  // skills 目录
    backend: (config) => new StoreBackend(config),  // 限制 filesystem 在 PostgresStore 内
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

// createDeepAgent 是同步函数
const agent: DeepAgent = createDeepAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    tools: allTools,  // 节点工具 + saveAnalysisResult
    skills: ['/skills/'],
    backend: (config) => new StoreBackend(config),
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

deepagent 的 filesystem 工具需要配置 backend。对于本项目，**必须使用 `StoreBackend`**（复用现有 PostgresStore），以确保 filesystem 操作限制在 PostgresStore 内，不触及真实服务器文件系统：

```typescript
import { StoreBackend } from 'deepagents'

const agent = createDeepAgent({
    backend: (config) => new StoreBackend(config),
    store: getStore(),   // 复用现有 PostgresStore 单例
    // ...
})
```

这样 filesystem 操作（大结果卸载、context 文件读写）持久化在 PostgresStore 中，与现有检查点存储统一。

### 内置工具安全性评估（Critical）

deepagent 自动挂载的内置工具存在安全风险，**必须通过 backend 策略限制**：

| 内置工具 | 风险 | StoreBackend 下的行为 |
|---------|------|---------------------|
| `execute`（shell 执行）| **高** - 服务器 shell 访问 | ⚠️ **需验证是否被禁用**。如果 StoreBackend 不禁用 execute，则为**阻断性问题** |
| `write_file` / `edit_file` | 中 - 可能写服务器文件 | ✅ 操作限制在 PostgresStore namespace 内 |
| `read_file` | 中 - 可能读敏感文件 | ✅ 只能读 PostgresStore 中的数据 |
| `ls` / `glob` / `grep` | 低 - 可能暴露文件结构 | ✅ 只能查询 PostgresStore 中的数据 |
| `write_todos` | 无 | ✅ 状态存储在 agent state 中 |
| `task`（subagent） | 无 | ✅ 使用配置的 subagents |

**PoC 验证项**：必须在最小化 PoC 中验证 `StoreBackend` 下 `execute` 工具是否被自动禁用。如果未被禁用，需要寻找禁用特定内置工具的 API 或考虑自定义 backend。

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

**子代理 interrupt 冒泡（需 PoC 验证）**：
当子代理的中间件（如 `pointConsumptionMiddleware`）在子代理内部触发 `interrupt()` 时，需要验证：
1. 这个 interrupt 是否冒泡到主代理？（deepagent 的 `task` 工具如何处理子代理的 `GraphInterrupt`）
2. `agentWorker.ts` 中的 interrupt 检测逻辑（`tasks[-1].interrupts`）在 subgraph 场景下是否正确工作
3. 如果冒泡不正确，备选方案：子代理不挂载 `pointConsumptionMiddleware`，改为工具函数内手动检查积分

### getChatThreadState 函数迁移

当前 `caseMainAgent.ts` 中的 `getChatThreadState` 使用 `createAgent`（不带 middleware）创建最小实例读取 checkpoint state。迁移后，`DeepAgent` 的 state schema 因内置中间件扩展了字段（`todos`、`_summarizationSessionId` 等）。

**方案**：`getChatThreadState` 改为使用 `checkpointer.getTuple()` 低层 API 直接读取，避免创建 agent 实例。或创建一个使用相同 `createDeepAgent` 配置的只读实例。

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
| `server/services/workflow/agents/caseMainAgent.ts` | `createAgent` → `createDeepAgent`，添加 subagents/skills/backend；`getChatThreadState` 改用低层 API |
| `server/services/workflow/agents/moduleAgent.ts` | `createAgent` → `createDeepAgent`，添加 skills/backend |
| `package.json` | 新增 `deepagents@^1.9.0`、`langsmith@>=0.5.15`，升级 `zod@^4.3.6` |

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
| 新增 | `langsmith` | >=0.5.15（peerDependency） |
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
  - 验证方案：`npx vitest run` 全量测试 + `npx nuxi typecheck` 类型检查
  - 注意 Prisma 已将 zod 作为 inline 依赖打包（commit `b10e1ac`），需确认是否受影响
- **summarization 行为变化**：deepagent 内置的 summarizationMiddleware 配置可能与现有参数不同
  - 当前配置：`trigger: [{ tokens: contextWindow * 0.6 }]`，下限 30k
  - 需在 PoC 中验证 deepagent 的 `computeSummarizationDefaults` 自动阈值是否一致
  - 如果不一致，可禁用内置 summarization 并继续手动挂载
- **内置工具安全性**：`execute` 工具在生产环境的服务器上运行是严重安全隐患
  - 必须验证 `StoreBackend` 是否自动禁用 `execute`
  - 如果未禁用，这是**迁移阻断项**

## 迁移步骤

### Phase 0：最小化 PoC（阻断性验证）

在开始正式迁移前，必须先验证以下阻断性问题：

1. **`execute` 工具安全性**：创建最小 `createDeepAgent` + `StoreBackend` 实例，检查 `execute` 工具是否被禁用
2. **SSE 格式兼容性**：验证 `encoding: 'text/event-stream'` 在 deepagent 内置中间件栈下输出格式正确
3. **Interrupt 冒泡**：验证子代理中间件 `interrupt()` 是否正确冒泡到主代理
4. **Checkpoint 兼容性**：验证旧 `createAgent` 的 checkpoint 能否被 `createDeepAgent` 加载（影响正在进行的会话）

如果任一项验证失败，需要重新评估迁移方案。

### Phase 1：依赖和基础设施

1. **依赖安装**：`bun add deepagents@^1.9.0 langsmith` + `bun add zod@^4.3.6`
2. **zod 兼容性验证**：`npx vitest run` + `npx nuxi typecheck`
3. **Skills 目录创建**：建立 `.deepagents/skills/` 结构
4. **Skills 部署配置**：确保 `.deepagents/skills/` 在 Nuxt 构建后可被读取（可能需要 `nitro.externals` 配置，或改用 StoreBackend 内存 skills）

### Phase 2：moduleAgent 迁移（先简单后复杂）

5. **moduleAgent 迁移**：改用 createDeepAgent（无子代理，改动最小）
6. **集成测试**：SSE 流式输出、interrupt/resume、多轮对话
7. **验证通过后合并**

### Phase 3：caseMainAgent 迁移

8. **caseMainAgent 迁移**：改用 createDeepAgent，配置 subagents
9. **getChatThreadState 适配**：改用 checkpointer 低层 API 或 DeepAgent 实例
10. **验证 subAgentToolFactory 可替代性**：测试 deepagent subagent 机制
11. **集成测试**：完整功能回归
12. **性能基准**：对比迁移前后首次响应延迟、单轮对话 token 消耗增幅

### 回滚策略

- 每个 Phase 独立分支，可单独回滚
- 保留 `subAgentToolFactory.ts` 作为 fallback 直到 Phase 3 验证通过
- 如果 deepagent 的内置行为不可控，随时可以退回 `createAgent` + 手动挂载 deepagent 中间件的方案（deepagent 的 middleware 可独立使用）

## 参考资料

- [deepagentsjs GitHub](https://github.com/langchain-ai/deepagentsjs)
- [deepagents npm](https://www.npmjs.com/package/deepagents)
- [Skills 文档 - LangChain Docs](https://docs.langchain.com/oss/javascript/deepagents/skills)
- [Customize Deep Agents - LangChain Docs](https://docs.langchain.com/oss/javascript/deepagents/customization)
- [Deep Agents Overview - LangChain Docs](https://docs.langchain.com/oss/javascript/deepagents/overview)
