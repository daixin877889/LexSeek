# createAgent → createDeepAgent 迁移设计

## 概述

将小索（caseMainAgent）和模块对话（moduleAgent）从 LangGraph 原生 `createAgent`（`langchain` 包）迁移到 `createDeepAgent`（`deepagents` 包），获得标准 Skills 能力（含脚本执行）、内置规划工具、子代理上下文隔离和自动摘要等能力。

**初始化分析工作流（`caseAnalysisV2.workflow.ts`）不动。**

## 迁移动机

1. **Skills + 脚本执行**（核心诱因）：deepagent 原生支持 [Agent Skills 规范](https://agentskills.io/specification)，Skill 可包含可执行脚本（`scripts/` 目录），Agent 通过 `execute` 工具运行。已验证：法律检索 Skill（`lexseek.cjs`）可被成功调用
2. **内置规划**：`write_todos` 工具自动进行任务分解和进度追踪
3. **子代理隔离**：内置 `SubAgentMiddleware` 替代手写 `subAgentToolFactory`，上下文自动隔离
4. **上下文管理**：内置 `summarizationMiddleware`，大结果自动卸载

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

### Backend 策略：StoreBackend + 自定义 execute 工具

#### 多用户隔离问题

LexSeek 是多用户系统，多个用户可能并发运行 Agent。deepagent 的 backend 决定了文件操作的隔离性：

| Backend | 文件隔离 | execute 工具 | 多用户安全 |
|---------|---------|-------------|-----------|
| `LocalShellBackend` | ❌ 共享文件系统 | ✅ 有 | ❌ 跨用户污染 |
| `StoreBackend` | ✅ per-thread 隔离在 PostgresStore | ❌ 没有 | ✅ 天然安全 |

**方案**：使用 `StoreBackend`（文件操作天然隔离）+ 自定义白名单 `execute` 工具（仅允许执行 skills 目录下的脚本）。

#### 自定义 execute 工具实现

```typescript
import { tool } from 'langchain'
import { execFile } from 'node:child_process'
import { z } from 'zod'

const SKILLS_SCRIPTS_DIR = '/app/.deepagents/skills'

/**
 * 受限的脚本执行工具，仅允许运行 skills 目录下的脚本
 * 替代 deepagent 内置的 execute 工具（StoreBackend 下不可用）
 */
const runSkillScript = tool(
    async ({ command }) => {
        // 白名单校验：只允许执行 skills 目录下的脚本
        const allowedPrefix = `node ${SKILLS_SCRIPTS_DIR}/`
        if (!command.startsWith(allowedPrefix)) {
            return `Error: 只允许执行 ${SKILLS_SCRIPTS_DIR} 目录下的脚本`
        }

        const args = command.replace('node ', '').split(' ')
        return new Promise((resolve) => {
            execFile('node', args, {
                timeout: 30_000,
                env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' },
            }, (err, stdout, stderr) => {
                resolve(err ? `Error: ${stderr || err.message}` : stdout)
            })
        })
    },
    {
        name: 'execute',
        description: '在沙箱环境中执行 skill 脚本命令',
        schema: z.object({
            command: z.string().describe('要执行的命令，格式: node <script_path> [args]'),
        }),
    }
)
```

**安全保障**：
- 白名单路径校验：仅 `/app/.deepagents/skills/` 下的脚本可执行
- 不继承宿主环境变量（`inheritEnv: false` 语义）
- 30 秒超时
- Docker 容器本身作为外层隔离

**注意**：自定义 `execute` 工具名称与 deepagent 内置 `execute` 冲突。由于 `StoreBackend` 不提供 `execute`，deepagent 不会注册内置版本（`isSandboxBackend` 检查会返回 false），所以自定义版本可以安全注册。需要在 PoC 中验证此行为。

### 小索主代理（caseMainAgent.ts）迁移

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
        caseProcessMaterialMiddleware(...),
        caseMaterialContextMiddleware(...),
        summarizationMiddleware({...}),
        safetyTrimMiddleware({...}),
    ],
})
```

**After**:
```typescript
import { createDeepAgent, StoreBackend, type DeepAgent } from 'deepagents'

// createDeepAgent 是同步函数
const agent: DeepAgent = createDeepAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    backend: (config) => new StoreBackend(config),
    tools: [...directTools, runSkillScript],  // 通用工具 + 自定义 execute
    subagents: subAgentConfigs,
    skills: ['/skills/'],
    middleware: [
        pointConsumptionMiddleware(...),
        caseProcessMaterialMiddleware(...),
        caseMaterialContextMiddleware(...),
        safetyTrimMiddleware({...}),
    ],
})
```

**关键变化**：
1. `summarizationMiddleware` → deepagent 内置，移除手动挂载
2. `subAgentToolFactory` → 改用 `subagents` 参数声明式配置
3. 新增 `skills` + 自定义 `execute` 工具实现脚本执行
4. `StoreBackend` 确保多用户文件隔离
5. 返回类型从 `ReactAgent` 变为 `DeepAgent`（继承自 `ReactAgent`）

### 子代理配置转换

**Before**（subAgentToolFactory.ts 动态生成工具）:
```typescript
const subTools = await createSubAgentTools(subAgentConfigs, {
    sessionId, userId, caseId, checkpointer, store
})
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

### 模块对话代理（moduleAgent.ts）迁移

**After**:
```typescript
const agent: DeepAgent = createDeepAgent({
    model,
    systemPrompt,
    checkpointer,
    store,
    backend: (config) => new StoreBackend(config),
    tools: [...allTools, runSkillScript],
    skills: ['/skills/'],
    middleware: [
        pointConsumptionMiddleware(...),
        moduleContextMiddleware(...),
        safetyTrimMiddleware({...}),
    ],
})
```

### Skills 目录结构

```
.deepagents/
└── skills/
    └── lexseek/
        ├── SKILL.md                # 法律检索 Skill（含使用流程、案情分析规则）
        ├── scripts/
        │   ├── lexseek.cjs         # Node.js CLI（login/search）
        │   └── .env                # API Key 存储
        ├── references/
        │   ├── auth.md             # 认证文档
        │   └── legal-api.md        # API 接口文档
        └── evals/                  # Skill 评估用例
```

Skills 通过渐进式披露（Progressive Disclosure）加载：
1. **Advertise**：skill name + description 注入 system prompt（~100 tokens）
2. **Load**：Agent 用 `read_file` 读取完整 SKILL.md
3. **Read resources**：按需读取 `references/` 下的文档
4. **Execute**：通过自定义 `execute` 工具运行 `scripts/` 下的脚本

### Interrupt 兼容性

**兼容性确认**：
- 中间件内的 `interrupt()` 调用在 `DeepAgent`（继承自 `ReactAgent`）中正常工作
- `Command({ resume })` 恢复机制不受影响

**子代理 interrupt 冒泡（需 PoC 验证）**：
1. 子代理中间件 `interrupt()` 是否冒泡到主代理？
2. `agentWorker.ts` 的 interrupt 检测在 subgraph 场景下是否正确？
3. 备选：子代理不挂载 `pointConsumptionMiddleware`，工具函数内手动检查积分

### getChatThreadState 函数迁移

迁移后 `DeepAgent` 的 state schema 扩展了字段（`todos`、`_summarizationSessionId` 等）。

**方案**：改用 `checkpointer.getTuple()` 低层 API 直接读取。

### 流式输出兼容性

```typescript
agent.stream(input, {
    configurable: { thread_id: sessionId },
    streamMode: ['values', 'messages', 'updates'],
    subgraphs: true,
    encoding: 'text/event-stream',
    recursionLimit: 1000,  // 显式覆盖 deepagent 默认的 10000
})
```

## 文件变更清单

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `server/services/workflow/agents/caseMainAgent.ts` | `createAgent` → `createDeepAgent`，添加 subagents/skills/backend/runSkillScript |
| `server/services/workflow/agents/moduleAgent.ts` | `createAgent` → `createDeepAgent`，添加 skills/backend/runSkillScript |
| `package.json` | 新增 `deepagents@^1.9.0`、`langsmith@>=0.5.15`，升级 `zod@^4.3.6` |
| `Dockerfile` | 复制 `.deepagents/` 目录到镜像 |

### 可能删除

| 文件 | 条件 |
|------|------|
| `server/services/workflow/agents/subAgentToolFactory.ts` | 如果 deepagent 内置 subagent 机制完全覆盖需求 |

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/services/workflow/tools/runSkillScript.tool.ts` | 白名单受限的 skill 脚本执行工具 |
| `.deepagents/skills/lexseek/SKILL.md` | 法律检索 Skill |
| `.deepagents/skills/lexseek/scripts/lexseek.cjs` | 法律检索 CLI 脚本 |
| `.deepagents/skills/lexseek/references/*.md` | Skill 参考文档 |

### 不受影响

- `server/services/workflow/caseAnalysisV2.workflow.ts` — 初始化工作流
- `server/services/workflow/agents/caseAnalysis.ts` — 工作流内 Agent 工厂
- `server/services/workflow/middleware/*` — 所有业务中间件
- `server/services/workflow/tools/*` — 现有工具定义
- `server/services/agent/*` — Worker/DAO/事件桥

### 依赖变更

| 操作 | 包名 | 版本 |
|------|------|------|
| 新增 | `deepagents` | ^1.9.0 |
| 新增 | `langsmith` | >=0.5.15（peerDependency） |
| 升级 | `zod` | ^4.2.1 → ^4.3.6 |

### Dockerfile 变更

```diff
 COPY --from=builder /app/.output ./.output

+# 复制 deepagent skills（含脚本和参考文档）
+COPY .deepagents ./.deepagents
+
 EXPOSE 3000
```

## 风险评估

### 低风险
- **依赖兼容性**：deepagents 依赖与项目完全一致
- **工具冲突**：`StoreBackend` 不注册内置 `execute`，自定义版本可安全注册
- **API 兼容**：`DeepAgent` 继承 `ReactAgent`，所有 LangGraph 操作兼容
- **多用户隔离**：`StoreBackend` 文件操作 per-thread 隔离在 PostgresStore 中

### 中等风险
- **子代理机制差异**：需验证 interrupt 冒泡、流式传播、自定义中间件
- **summarization 行为**：deepagent 内置 `summarizationMiddleware` 的触发阈值可能与现有不同
  - 当前：`trigger: [{ tokens: contextWindow * 0.6 }]`，下限 30k
  - 如不一致，禁用内置版本并继续手动挂载

### 高风险
- **zod 升级**（^4.2.1 → ^4.3.6）：全项目验证 `npx vitest run` + `npx nuxi typecheck`
- **自定义 execute 与内置 execute 冲突**：需验证 `StoreBackend` 下 deepagent 确实不注册内置版

## 迁移步骤

### Phase 0：最小化 PoC（阻断性验证）

1. **自定义 execute 注册**：验证 `StoreBackend` + 自定义 `execute` 工具名不冲突
2. **SSE 格式兼容性**：验证 `encoding: 'text/event-stream'` 在 deepagent 内置中间件栈下正常
3. **Skill 脚本执行**：验证 `StoreBackend` 下 Agent 能通过自定义 `execute` 运行 lexseek.cjs
4. **Interrupt 冒泡**：验证子代理中间件 `interrupt()` 正确冒泡到主代理
5. **Checkpoint 兼容**：验证旧 `createAgent` 的 checkpoint 能否被 `createDeepAgent` 加载

### Phase 1：依赖和基础设施

1. `bun add deepagents@^1.9.0 langsmith` + `bun add zod@^4.3.6`
2. zod 兼容性验证：`npx vitest run` + `npx nuxi typecheck`
3. 创建 `.deepagents/skills/lexseek/` 目录，迁入 Skill 文件
4. 实现 `runSkillScript.tool.ts`

### Phase 2：moduleAgent 迁移（先简单后复杂）

5. moduleAgent 改用 `createDeepAgent`（无子代理，改动最小）
6. 集成测试：SSE、interrupt/resume、多轮对话、skill 脚本调用
7. 验证通过后合并

### Phase 3：caseMainAgent 迁移

8. caseMainAgent 改用 `createDeepAgent`，配置 subagents
9. getChatThreadState 改用 `checkpointer.getTuple()`
10. 验证 subAgentToolFactory 可替代性
11. 集成测试 + 性能基准

### 回滚策略

- 每个 Phase 独立分支
- 保留 `subAgentToolFactory.ts` 直到 Phase 3 验证通过
- deepagent 的 middleware 可独立使用，随时可退回 `createAgent` + 单独挂载

## 参考资料

- [deepagentsjs GitHub](https://github.com/langchain-ai/deepagentsjs)
- [deepagents npm](https://www.npmjs.com/package/deepagents)
- [Skills 文档 - LangChain Docs](https://docs.langchain.com/oss/javascript/deepagents/skills)
- [Sandboxes 文档 - LangChain Docs](https://docs.langchain.com/oss/javascript/deepagents/sandboxes)
- [Customize Deep Agents - LangChain Docs](https://docs.langchain.com/oss/javascript/deepagents/customization)
- [Agent Skills 规范](https://agentskills.io/specification)
- [Sandbox API Reference](https://reference.langchain.com/javascript/deepagents/sandboxes)
