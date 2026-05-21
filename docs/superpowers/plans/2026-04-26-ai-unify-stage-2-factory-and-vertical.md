# AI 基建统一改造 · 阶段 2：Agent 工厂化 + 业务 Vertical 整理 + Skills 入网

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 在 `server/services/agent-platform/` 建立"通用 AI 平台库"，提供 `defineDomainAgent` 工厂 + 中间件管道 + skillsMiddleware 自动挂载 + 4 个 skill 工具自动跟随；把 5 个业务（case-main / case-module / legal-assistant / document / contract）改造为 vertical 目录形态，每个 vertical 用 `defineDomainAgent` 注册到 AgentRegistry；后台增加 skills 管理 + 节点编辑加 skills 多选 UI。

**Architecture:** 整体策略是**渐进搬迁 + re-export 兼容**——先在 agent-platform 建新版本，旧路径保留 re-export 一段时间避免大爆炸式改动；业务 vertical 用 `defineDomainAgent({ scope, nodeName, middlewares, tools, hooks })` 表达，工厂内部统一处理节点加载、prompt 渲染、skills 挂载、SSE 流构造；阶段 2 完成后阶段 1 注册的 6 个 legacy runner 全部下线，由 vertical 自动注册。

**Tech Stack:** TypeScript · Vitest · Prisma 6 · Nitro plugin · @langchain/langgraph · langchain · deepagents · gray-matter

**Spec 来源:** `docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md` §3 §4 §6 阶段 2

**前置条件:** 阶段 1 已完成（tag `ai-unify-stage-1-done`）。

---

## File Structure 总览

### 新建目录

```
server/services/agent-platform/
├── factory/
│   ├── defineDomainAgent.ts           # 业务定义入口
│   └── runtime.ts                      # 内部组装
├── registry/                           # 阶段 1 已有（含 agentRegistry / types / registerLegacyRunners）
├── skills/                             # 阶段 1 已有（skillSync.dao/service）
│   └── filesystemBackendCache.ts      # 新增
├── middleware/                         # 阶段 2 新增 + 迁移
│   ├── messageIntegrity.ts
│   ├── scopeGuard.ts
│   ├── toolCallLimit.ts
│   ├── pointConsumption.ts
│   ├── summarization.ts
│   ├── safetyTrim.ts
│   ├── audit.ts
│   ├── skills.ts                       # 新增：包装 deepagents createSkillsMiddleware
│   ├── buildMiddlewareStack.ts
│   └── types.ts
├── tools/                              # 阶段 2 新增 + 迁移
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
│   ├── workspace.ts
│   ├── invokeNodeJson.ts               # 新增：从 contract/utils/ 提到这里
│   ├── types.ts
│   └── index.ts
├── nodeConfig/
│   ├── loader.ts                       # 内部缓存层
│   └── promptRenderer.ts
├── context/                            # 迁自 workflow/context/
├── state/                              # 迁自 workflow/state/
├── sse/
│   ├── eventBridge.ts                  # re-export server/services/agent/agentEventBridge
│   └── streamBuilder.ts                # re-export server/services/sse/agentSseStream
├── checkpointer.ts                     # re-export
├── modelFactory.ts                     # re-export node/chatModelFactory
├── threadState.ts                      # re-export workflow/agents/threadState
├── subAgent/
│   └── subAgentToolFactory.ts          # 迁自 workflow/agents/
└── types.ts                            # 重新导出 SessionScope/SessionType 等

server/agents/                          # 业务 vertical 根目录
├── case-main/
│   ├── agent.config.ts
│   ├── middleware/
│   │   ├── caseMaterialContext.middleware.ts
│   │   └── caseProcessMaterial.middleware.ts
│   └── tools/                          # 业务私有工具（如有）
├── case-module/
│   ├── agent.config.ts
│   ├── middleware/
│   │   ├── moduleContext.middleware.ts
│   │   └── analysisResultPersistence.middleware.ts
│   └── tools/
├── legal-assistant/
│   ├── agent.config.ts
│   └── service.ts                      # assistantSession.dao 重新组织
├── document/
│   ├── agent.config.ts
│   ├── middleware/
│   │   └── draftResultPersistence.middleware.ts
│   ├── service.ts                      # 迁自 server/services/assistant/document/
│   ├── dao.ts
│   └── tools/                          # 迁自 server/services/assistant/document/
└── contract/
    ├── agent.config.ts
    ├── middleware/
    │   └── reviewResultPersistence.middleware.ts
    ├── service.ts                      # 迁自 server/services/assistant/contract/
    ├── dao.ts
    ├── docx/                            # 业务私有 docx 处理
    ├── fonts/
    ├── utils/
    └── tools/
        └── parseAndAskStance.tool.ts
```

### 后台 UI 新增

```
server/api/v1/admin/skills/
├── index.get.ts                        # 列出所有 skill
├── [name]/                             # 启停单个 skill
│   └── status.patch.ts
└── resync.post.ts                      # 阶段 1 已有

server/api/v1/admin/nodes/
└── [id]/
    └── skills.patch.ts                 # 更新节点关联的 skills

app/components/admin/skills/
├── SkillList.vue                       # 列表 + 重新扫描按钮
└── SkillEnableSwitch.vue

app/components/admin/nodes/
└── NodeSkillSelector.vue               # 节点编辑页"启用的 Skills"chip 多选

app/pages/admin/skills/
└── index.vue
```

---

## Task 列表

阶段 2 共 22 个 task。按风险与依赖分组：

| # | 任务 | 工程量 | 依赖 |
|---|---|---|---|
| 1 | 新建 agent-platform 目录骨架 + types.ts re-export | 30min | 无 |
| 2 | 通用中间件迁到 agent-platform/middleware/（保留旧 re-export） | 2-3h | T1 |
| 3 | 通用工具迁到 agent-platform/tools/（保留旧 re-export） | 2-3h | T1 |
| 4 | utils/promptRenderer + context/ + state/ + checkpointer 迁移 | 1-2h | T1 |
| 5 | sse 双桥 + chatModelFactory + threadState re-export | 30min | T1 |
| 6 | invokeNodeJson 从 contract/utils/ 提到平台库 | 1h | T3 |
| 7 | NodeConfig loader 加缓存层 + resync 失效 | 1-2h | T1 |
| 8 | filesystemBackendCache + skillsMiddleware 包装 | 2-3h | T1 |
| 9 | subAgentToolFactory 迁到 agent-platform/subAgent/ | 1h | T1 |
| 10 | defineDomainAgent 类型定义 + 工厂主体 | 3-4h | T2-T9 |
| 11 | runtime.ts 实现（中间件栈 + skills 挂载 + 工具自动跟随 + SSE 构造） | 4-6h | T10 |
| 12 | 工厂集成测试（mock LLM 跑通 5 个 scope） | 3-4h | T11 |
| 13 | case-main vertical（agent.config.ts + 中间件迁移） | 3-4h | T11 |
| 14 | case-module vertical | 3-4h | T11 |
| 15 | legal-assistant vertical | 2-3h | T11 |
| 16 | document vertical（含 service/dao/tools 大量搬迁） | 4-6h | T11 |
| 17 | contract vertical（含 docx/fonts/utils/playbook 等大量搬迁 + buildMiddlewareStack 强制使用） | 6-8h | T11 |
| 18 | 删除 registerLegacyRunners + plugin（vertical 自动注册接管） | 1h | T13-T17 |
| 19 | Admin skills CRUD API（list/status patch/resync 已有） | 2-3h | T1 |
| 20 | Admin nodes 关联 skills API（patch） | 1-2h | T1 |
| 21 | 后台 UI（skill 列表 + 节点编辑 chip 多选） | 4-6h | T19/T20 |
| 22 | 阶段 2 全量回归 + tag | 1-2h | 全部 |

**关键里程碑：**
- T1-T9 完成：平台库基础设施就绪，业务代码无变化
- T10-T12 完成：defineDomainAgent 工厂可用，但还没业务用它
- T13-T17 完成：5 业务全部用 vertical 形态运行，agent-platform/ 与 server/agents/ 是新主线
- T18 完成：registerLegacyRunners 下线，agentRegistry 完全由 vertical 驱动
- T19-T21 完成：后台 UI 上线，运营可在线管理 skill
- T22 完成：阶段 2 收尾

---

## Task 1：新建 agent-platform 目录骨架 + types.ts re-export

**Files:**
- Create: `server/services/agent-platform/types.ts`
- Create: `server/services/agent-platform/index.ts`

- [ ] **Step 1.1**：在已有的 `server/services/agent-platform/` 下新建 `types.ts`，re-export 阶段 1 已有的所有类型：

```typescript
// server/services/agent-platform/types.ts
/**
 * Agent Platform 类型层统一出口
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §3.1
 */

// 路由 + 事件 + interrupt 枚举
export {
    SessionScope,
    SessionType,
    SSECustomEventType,
    InterruptType,
} from '#shared/types/agentEvent'

export type {
    SSECustomEventMap,
    SubAgentTokenPayload,
    SubAgentToolStartPayload,
    SubAgentToolEndPayload,
    SubAgentStatusPayload,
    AnalysisResultSavedPayload,
    DraftSavedPayload,
    ContractReviewSavedPayload,
    ContractStagePayload,
    ContractRiskPayload,
    ContractProgressPayload,
    ChildAgentInvokedPayload,
} from '#shared/types/agentEvent'

// Skills
export { SkillSource, SkillStatus, SKILLS_FS_ROOT } from '#shared/types/skill'
export type { SkillFrontmatter } from '#shared/types/skill'

// Registry
export { AgentRegistry, agentRegistry } from './registry/agentRegistry'
export type {
    AgentRunner,
    AgentRunnerContext,
    AgentRegistryEntry,
    SessionRouteKey,
} from './registry/types'
```

- [ ] **Step 1.2**：在 `server/services/agent-platform/index.ts` 暂时只 export types：

```typescript
// server/services/agent-platform/index.ts
export * from './types'
```

- [ ] **Step 1.3**：跑 typecheck 确认无错。

```bash
npx nuxi typecheck 2>&1 | grep -E 'agent-platform|error TS' | head -10
```

- [ ] **Step 1.4**：commit。

```bash
git add server/services/agent-platform/types.ts server/services/agent-platform/index.ts
git commit -m "feat(agent-platform): 新建平台库 types 统一出口"
```

---

## Task 2：通用中间件迁到 agent-platform/middleware/

**目标:** 把 `workflow/middleware/` 下的 8 个**通用**中间件迁到 `agent-platform/middleware/`。3 个**业务私有**中间件留在原地（在 T13-T17 业务 vertical 阶段搬到 vertical/）。

**通用清单（要迁）:**
- `messageIntegrity.middleware.ts`
- `scopeGuard.middleware.ts`
- `toolCallLimit.middleware.ts`
- `pointConsumption.middleware.ts`
- `safetyTrim.middleware.ts`
- `audit.middleware.ts`
- `types.ts`（含 buildMiddlewareStack）
- `index.ts`

注：`workflow/middleware/` 中**不在通用清单**的：
- `caseMaterialContext.middleware.ts` → T13 case-main vertical
- `caseProcessMaterial.middleware.ts` → T13 case-main vertical
- `analysisResultPersistence.middleware.ts` → T14 case-module vertical
- `draftResultPersistence.middleware.ts` → T16 document vertical
- `reviewResultPersistence.middleware.ts` → T17 contract vertical
- `moduleContext.middleware.ts`（如存在）→ T14 case-module vertical

**Files:**
- Create (in agent-platform/middleware/): 8 个通用文件
- Modify: `workflow/middleware/{8 个文件}` → 改为 re-export 新路径

- [ ] **Step 2.1**：用 git mv 一个一个迁。先迁 `types.ts`：

```bash
mkdir -p server/services/agent-platform/middleware
git mv server/services/workflow/middleware/types.ts server/services/agent-platform/middleware/types.ts
```

修改 types.ts 内的 import 路径（如有相对路径），让它能从新位置正确解析。然后在原位置创建 re-export shim：

```typescript
// server/services/workflow/middleware/types.ts （shim，旧引用兼容）
export * from '~~/server/services/agent-platform/middleware/types'
```

- [ ] **Step 2.2**：依次迁其余 7 个文件，每个：
  1. `git mv`
  2. 修内部 import（如该文件 import 其他相对路径模块，都换成 `~~/server/services/agent-platform/...` 或保持 shim 位置不变）
  3. 在旧位置创建 re-export shim

注意：这些中间件 import 的内部模块（如 `./types`、`./index`）需要在新位置仍能 resolve。可能需要保留同目录的 `types.ts` 或让 import 路径改为 `~~/server/services/agent-platform/middleware/types`。

- [ ] **Step 2.3**：跑 agentWorker 单测确认引用没断：

```bash
npx vitest run tests/server/agent/agentWorker.test.ts tests/server/agent/agentWorker.lifecycle.test.ts
```

Expected: 全 PASS。

- [ ] **Step 2.4**：跑 typecheck：

```bash
npx nuxi typecheck 2>&1 | grep "error TS" | head -10
```

- [ ] **Step 2.5**：commit。

```bash
git add server/services/agent-platform/middleware/ server/services/workflow/middleware/
git commit -m "refactor(agent-platform): 通用中间件迁到 agent-platform/middleware/"
```

---

## Task 3：通用工具迁到 agent-platform/tools/

**目标:** 把 `workflow/tools/` 下的**通用工具**迁到 `agent-platform/tools/`，业务私有工具留在原地。

**通用清单（要迁）:**
- `searchLaw.tool.ts`
- `processMaterials.tool.ts`
- `reservePoints.tool.ts`
- `confirmPoints.tool.ts`
- `rollbackPoints.tool.ts`
- `saveAnalysisResult.tool.ts`
- `readSkillFile.tool.ts`
- `writeSkillFile.tool.ts`
- `runSkillScript.tool.ts`
- `runSkillCommand.tool.ts`
- `workspace.ts`
- `searchCaseMaterials.tool.ts`
- `uploadWorkspaceFile.tool.ts`
- `search_case_analysis.tool.ts`
- `search_case_memory.tool.ts`
- `update_case_memory.tool.ts`
- `write_case_memory.tool.ts`
- `types.ts`
- `index.ts`

**业务私有（不迁）:**
- `parseAndAskStance.tool.ts` → T17 contract vertical

- [ ] **Step 3.1**：mkdir + 逐文件 git mv + 改 import + 创建旧位置 shim
- [ ] **Step 3.2**：跑相关测试 + typecheck
- [ ] **Step 3.3**：commit

```bash
git commit -m "refactor(agent-platform): 通用工具迁到 agent-platform/tools/"
```

---

## Task 4：utils + context + state + checkpointer 迁移

**Files:**
- `workflow/utils/promptRenderer.ts` → `agent-platform/nodeConfig/promptRenderer.ts`（注意改名目录）
- `workflow/context/{messageCompressor,moduleContextBuilder,toolResultTruncator}.ts` → `agent-platform/context/`
- `workflow/state/storage.ts` → `agent-platform/state/storage.ts`
- `workflow/checkpointer.ts` → `agent-platform/checkpointer.ts`

每个迁完保留旧位置 re-export shim。

- [ ] **Step 4.1-4.4**：迁移 + shim 创建 + 测试 + commit

```bash
git commit -m "refactor(agent-platform): utils/context/state/checkpointer 迁到平台库"
```

---

## Task 5：SSE / model / threadState re-export

**Files:**
- Create: `agent-platform/sse/eventBridge.ts` (re-export server/services/agent/agentEventBridge)
- Create: `agent-platform/sse/streamBuilder.ts` (re-export server/services/sse/agentSseStream)
- Create: `agent-platform/modelFactory.ts` (re-export server/services/node/chatModelFactory)
- Create: `agent-platform/threadState.ts` (re-export workflow/agents/threadState)

注：本任务**不迁移文件**，只在 agent-platform 提供 re-export 入口；原文件保留原位（避免大量 import 引用全改）。未来阶段可以再决定要不要真正搬动。

- [ ] **Step 5.1-5.5**：创建 4 个 re-export 文件

```bash
git commit -m "feat(agent-platform): 新增 sse/model/threadState 平台库出口"
```

---

## Task 6：invokeNodeJson 从 contract/utils/ 提到平台库

**Files:**
- Move: `server/services/assistant/contract/utils/llmInvokeJson.ts` → `server/services/agent-platform/tools/invokeNodeJson.ts`
- 在原位置创建 re-export shim

让"节点配置 → LLM 调用 → JSON 解析 → schema 校验"这一通用模式可被任何业务复用（不只是合同）。

- [ ] **Step 6.1-6.4**：git mv + shim + 测试 + commit

```bash
git commit -m "refactor(agent-platform): invokeNodeJson 从 contract 业务代码提到平台库"
```

---

## Task 7：NodeConfig loader 加内存缓存层

**Files:**
- Create: `server/services/agent-platform/nodeConfig/loader.ts`（含缓存）
- Modify: `server/services/agent-platform/skills/skillSync.service.ts`（resync 时清缓存）
- Modify: `server/services/agent-platform/registry/agentRegistry.ts`（dispatch 走 loader 而非直接 prisma；可选）

**功能：**
- `getNodeConfigCached(nodeName: string): Promise<NodeConfig>` — 按 name 内存缓存 NodeConfig（含 model + prompts + tools + skills 关联）
- `invalidateNodeConfigCache(nodeName?: string)` — 失效单条或全量

**TTL：** 暂用"配置变更主动失效"模式（admin API 改 node 时调用 invalidate）。本任务不实现 admin invalidate hook（留 T19 节点 patch API 时做），先建好缓存机制 + 暴露 invalidate API。

- [ ] **Step 7.1**：写测试覆盖缓存命中、未命中、invalidate
- [ ] **Step 7.2-7.4**：实现 + 跑测试 + commit

```bash
git commit -m "feat(agent-platform): NodeConfig loader 加内存缓存层"
```

---

## Task 8：filesystemBackendCache + skillsMiddleware 包装

**Files:**
- Create: `server/services/agent-platform/skills/filesystemBackendCache.ts`
- Create: `server/services/agent-platform/middleware/skills.ts`

**filesystemBackendCache:**
```typescript
const cache = new Map<string, FilesystemBackend>()
export function getFilesystemBackend(sources: string[]): FilesystemBackend {
    const key = sources.sort().join(',')
    let b = cache.get(key)
    if (!b) {
        b = new FilesystemBackend({ rootDir: process.cwd(), sources })
        cache.set(key, b)
    }
    return b
}
export function invalidateBackendCache(): void {
    cache.clear()
}
```

**skillsMiddleware 包装:**
```typescript
import { createSkillsMiddleware as deepagentsCreateSkillsMiddleware } from 'deepagents'
import { listSkillsByNodeIdDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'
import { getFilesystemBackend } from '~~/server/services/agent-platform/skills/filesystemBackendCache'

/**
 * 按 NodeConfig 动态构造 skillsMiddleware。
 * 若节点未关联任何 skill，返回 null（defineDomainAgent 工厂内部判断 null 跳过挂载）。
 */
export async function buildSkillsMiddlewareForNode(nodeId: number): Promise<AgentMiddleware | null> {
    const skills = await listSkillsByNodeIdDAO(nodeId)
    if (skills.length === 0) return null
    const sources = skills.map(s => s.path)
    const backend = getFilesystemBackend(sources)
    return deepagentsCreateSkillsMiddleware({ backend, sources })
}
```

- [ ] **Step 8.1**：测试覆盖 backend 缓存命中/失效 + skillsMiddleware 返回值（null vs middleware 实例）
- [ ] **Step 8.2-8.4**：实现 + 测试 + commit

```bash
git commit -m "feat(agent-platform): skillsMiddleware 按节点动态挂载 + backend 缓存"
```

---

## Task 9：subAgentToolFactory 迁到平台库

**Files:**
- Move: `server/services/workflow/agents/subAgentToolFactory.ts` → `server/services/agent-platform/subAgent/subAgentToolFactory.ts`
- 在原位置创建 re-export shim

- [ ] **Step 9.1-9.4**：git mv + shim + 测试 + commit

```bash
git commit -m "refactor(agent-platform): subAgentToolFactory 迁到平台库"
```

---

## Task 10：defineDomainAgent 类型定义

**Files:**
- Create: `server/services/agent-platform/factory/types.ts`

**核心类型:**
```typescript
import type { SessionScope, SessionType } from '#shared/types/agentEvent'
import type { MiddlewareWithPriority } from '~~/server/services/agent-platform/middleware/types'
import type { AgentRunner, AgentRunnerContext } from '~~/server/services/agent-platform/registry/types'
import type { Tool } from '@langchain/core/tools'

export type DomainAgentType = 'createAgent' | 'stateGraph'

export interface DomainAgentDefinition {
    /** 路由身份 */
    scope: SessionScope
    /** 仅 case scope 下需要 type 二级路由（其他 scope 不传） */
    type?: SessionType | null
    /** Agent 类型 */
    agentType: DomainAgentType
    /** 关联节点 nodes.name；提示词/模型/工具/skills 都从此节点读取 */
    nodeName: string
    /** 业务私有中间件（与平台通用中间件按 priority 合并） */
    customMiddlewares?: (ctx: AgentRunnerContext) => Promise<MiddlewareWithPriority[]>
    /** 业务私有工具（与节点 tools + skill 工具合并；同名以业务工具胜出） */
    customTools?: (ctx: AgentRunnerContext) => Promise<Tool[]>
    /** Lifecycle hooks */
    hooks?: {
        beforeRun?: (ctx: AgentRunnerContext) => Promise<void>
        afterRun?: (ctx: AgentRunnerContext, success: boolean) => Promise<void>
    }
    /** 仅 stateGraph 类型使用：图编译入口 */
    runStateGraph?: (ctx: AgentRunnerContext) => Promise<ReadableStream>
    /** 描述（admin/introspection 用） */
    description?: string
}

export interface DomainAgent {
    definition: DomainAgentDefinition
    runner: AgentRunner
}
```

- [ ] **Step 10.1**：写类型测试（编译期校验）
- [ ] **Step 10.2-10.4**：实现 + commit

```bash
git commit -m "feat(agent-platform): defineDomainAgent 类型定义"
```

---

## Task 11：runtime.ts 实现 + defineDomainAgent 工厂主体

**Files:**
- Create: `server/services/agent-platform/factory/runtime.ts`
- Create: `server/services/agent-platform/factory/defineDomainAgent.ts`

**runtime 主要职责:**
1. 加载 NodeConfig（走 loader 缓存）
2. 渲染 system prompt（promptRenderer）
3. 构建中间件栈（通用 + 业务私有 + skillsMiddleware 自动挂）
4. 加载工具（节点 tools + 业务 customTools + 4 个 skill 工具自动跟随，仅当节点关联 skill）
5. 区分 createAgent / stateGraph 路径，包装为 ReadableStream
6. SSE 流构造由 streamBuilder 处理

**defineDomainAgent 工厂主体:**
```typescript
import { agentRegistry } from '~~/server/services/agent-platform/registry/agentRegistry'
import type { DomainAgentDefinition, DomainAgent } from './types'
import { runDomainAgent } from './runtime'

export function defineDomainAgent(def: DomainAgentDefinition): DomainAgent {
    // 校验
    if (def.agentType === 'stateGraph' && !def.runStateGraph) {
        throw new Error(`stateGraph agent ${def.scope}/${def.nodeName} 必须提供 runStateGraph`)
    }

    // runner 实现
    const runner = async (ctx) => runDomainAgent(def, ctx)

    // 自动注册到 AgentRegistry
    agentRegistry.register({
        scope: def.scope,
        type: def.type ?? null,
        runner,
        description: def.description ?? `${def.scope}/${def.nodeName}`,
    })

    return { definition: def, runner }
}
```

**runtime.runDomainAgent 主流程（伪码）:**
```typescript
export async function runDomainAgent(def, ctx) {
    const nodeConfig = await getNodeConfigCached(def.nodeName)
    if (!nodeConfig) throw new Error(`节点 ${def.nodeName} 未配置`)

    await def.hooks?.beforeRun?.(ctx)

    if (def.agentType === 'stateGraph') {
        return def.runStateGraph!(ctx)
    }

    // createAgent 路径
    const systemPrompt = renderSystemPrompt(nodeConfig, ctx)
    const model = await createChatModel(nodeConfig.modelId, nodeConfig.modelConfig)

    // 中间件
    const items = []
    items.push({ middleware: messageIntegrityMiddleware(), priority: MIDDLEWARE_PRIORITY.MESSAGE_INTEGRITY, name: 'messageIntegrity' })
    items.push({ middleware: scopeGuardMiddleware(def.scope), priority: MIDDLEWARE_PRIORITY.SCOPE_GUARD, name: 'scopeGuard' })
    items.push({ middleware: toolCallLimitMiddleware(), priority: MIDDLEWARE_PRIORITY.TOOL_CALL_LIMIT, name: 'toolCallLimit' })
    items.push({ middleware: pointConsumptionMiddleware(ctx.userId, def.scope, ctx.sessionId), priority: MIDDLEWARE_PRIORITY.POINT_CONSUMPTION, name: 'pointConsumption' })
    items.push({ middleware: summarizationMiddleware(...), priority: MIDDLEWARE_PRIORITY.SUMMARIZATION, name: 'summarization' })
    items.push({ middleware: safetyTrimMiddleware(...), priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM, name: 'safetyTrim' })
    items.push({ middleware: auditMiddleware(...), priority: MIDDLEWARE_PRIORITY.AUDIT, name: 'audit' })

    // skillsMiddleware（自动挂）
    const skillsMw = await buildSkillsMiddlewareForNode(nodeConfig.id)
    if (skillsMw) {
        items.push({ middleware: skillsMw, priority: MIDDLEWARE_PRIORITY.SKILLS_DISCOVERY, name: 'skillsDiscovery' })
    }

    // 业务私有
    if (def.customMiddlewares) {
        const custom = await def.customMiddlewares(ctx)
        items.push(...custom)
    }

    const middleware = buildMiddlewareStack(items)

    // 工具
    const nodeTools = await getToolInstancesService(nodeConfig.tools, ctx)
    const customTools = (await def.customTools?.(ctx)) ?? []
    const skillTools = skillsMw ? [
        createReadSkillFileTool(ctx),
        createWriteSkillFileTool(ctx),
        createRunSkillScriptTool(ctx),
        createRunSkillCommandTool(ctx),
    ] : []
    const tools = mergeToolsBy Name([...nodeTools, ...customTools, ...skillTools])

    const agent = createAgent({
        llm: model,
        prompt: systemPrompt,
        tools,
        middleware,
        checkpointer: getCheckpointer(),
    })

    const stream = agent.stream(ctx.message ? new HumanMessage(ctx.message) : undefined, {
        configurable: { thread_id: ctx.sessionId },
        signal: ctx.signal,
    })

    return wrapAgentStreamAsSSE(stream, ctx)  // 由 streamBuilder 包装
}
```

- [ ] **Step 11.1-11.5**：详细实现 + 测试 + commit

```bash
git commit -m "feat(agent-platform): defineDomainAgent 工厂 + runtime 实现"
```

---

## Task 12：工厂集成测试

**Files:**
- Create: `tests/server/agent-platform/factory/defineDomainAgent.test.ts`

**测试场景（mock LLM）：**
1. defineDomainAgent 注册到 agentRegistry
2. createAgent 路径跑通（mock LLM 返回 'hi' → 验证 SSE 流）
3. stateGraph 路径调 runStateGraph 函数
4. skillsMiddleware 仅在节点关联 skill 时挂
5. 4 个 skill 工具仅在 skillsMiddleware 挂时跟随
6. customMiddlewares + customTools 合并正确
7. hooks.beforeRun + afterRun 调用顺序
8. 节点不存在时抛错

```bash
git commit -m "test(agent-platform): defineDomainAgent 集成测试"
```

---

## Task 13：case-main vertical（小索）

**目标:** 把 caseMainAgent 改造为 vertical，业务私有中间件搬到 vertical/middleware/，旧 caseMainAgent.ts 删除。

**Files:**
- Create: `server/agents/case-main/agent.config.ts`
- Move: `workflow/middleware/caseMaterialContext.middleware.ts` → `server/agents/case-main/middleware/caseMaterialContext.middleware.ts`
- Move: `workflow/middleware/caseProcessMaterial.middleware.ts` → `server/agents/case-main/middleware/caseProcessMaterial.middleware.ts`
- Delete: `workflow/agents/caseMainAgent.ts` 主体（保留 re-export shim 直到 T18）

**agent.config.ts 形态:**
```typescript
import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope } from '#shared/types/agentEvent'
import { caseMaterialContextMiddleware } from './middleware/caseMaterialContext.middleware'
import { caseProcessMaterialMiddleware } from './middleware/caseProcessMaterial.middleware'

export const caseMainAgent = defineDomainAgent({
    scope: SessionScope.CASE,
    type: null,                          // CASE 域默认（type=1 CHAT 走这里 fallback）
    agentType: 'createAgent',
    nodeName: 'caseMain',
    description: 'Case main chat（小索）',
    customMiddlewares: async (ctx) => [
        {
            middleware: caseProcessMaterialMiddleware(ctx.userId, ctx.caseId!),
            priority: MIDDLEWARE_PRIORITY.PROCESS_MATERIAL,
            name: 'caseProcessMaterial',
        },
        {
            middleware: caseMaterialContextMiddleware(ctx.userId, ctx.caseId!),
            priority: MIDDLEWARE_PRIORITY.MATERIAL_CONTEXT,
            name: 'caseMaterialContext',
        },
    ],
    customTools: async (ctx) => [
        // subAgentTools by createSubAgentTools(...)
    ],
})
```

- [ ] **Step 13.1-13.5**：创建 + 迁移 + 测试 + commit

```bash
git commit -m "refactor(agents): case-main vertical 接入 defineDomainAgent"
```

---

## Task 14：case-module vertical（模块对话）

类似 T13。

- Move: `workflow/middleware/moduleContext.middleware.ts`（如存在）→ `server/agents/case-module/middleware/`
- Move: `workflow/middleware/analysisResultPersistence.middleware.ts` → `server/agents/case-module/middleware/`
- Create: `server/agents/case-module/agent.config.ts`（type: SessionType.MODULE）

```bash
git commit -m "refactor(agents): case-module vertical 接入 defineDomainAgent"
```

---

## Task 15：legal-assistant vertical

- Move: `server/services/assistant/assistantSession.dao.ts` → `server/agents/legal-assistant/dao.ts`（保留 re-export）
- Create: `server/agents/legal-assistant/agent.config.ts`（scope: ASSISTANT）

```bash
git commit -m "refactor(agents): legal-assistant vertical 接入 defineDomainAgent"
```

---

## Task 16：document vertical

工程量大：含 service / dao / middleware / tools 全套搬迁。

- Move: `server/services/assistant/document/**` → `server/agents/document/{service.ts,dao.ts,...}`
- Move: `workflow/middleware/draftResultPersistence.middleware.ts` → `server/agents/document/middleware/`
- Create: `server/agents/document/agent.config.ts`

每搬一组文件保留 re-export shim 直到 T18 收尾再删。

```bash
git commit -m "refactor(agents): document vertical 接入 defineDomainAgent"
```

---

## Task 17：contract vertical（最大）

工程量最大：含 docx / fonts / utils / playbook / 大量 service/dao/tools。**这个 task 最关键的额外工作是修复 documentMainAgent 改造前 spec 里标记的 buildMiddlewareStack 未强制使用问题**——同时这次改造也必须强制 contractReviewMainAgent 使用 buildMiddlewareStack。

- Move: `server/services/assistant/contract/**` → `server/agents/contract/`（含子目录 docx/fonts/utils）
- Move: `workflow/middleware/reviewResultPersistence.middleware.ts` → `server/agents/contract/middleware/`
- Move: `workflow/tools/parseAndAskStance.tool.ts` → `server/agents/contract/tools/`
- Create: `server/agents/contract/agent.config.ts`（scope: CONTRACT）
- 修复：documentMainAgent 在 T16 完成后 + contractReviewMainAgent 在本任务都用 buildMiddlewareStack

注：合同审查 resume 路径重写**留给阶段 4**（不在阶段 2 范围）。本任务保持现有 resume 行为，仅做框架接入。

```bash
git commit -m "refactor(agents): contract vertical 接入 defineDomainAgent + 强制 buildMiddlewareStack"
```

---

## Task 18：删除 registerLegacyRunners + plugin

T13-T17 完成后，5 个 vertical 已经各自通过 `defineDomainAgent` 自动注册到 agentRegistry。registerLegacyRunners 重复注册会抛错（agentRegistry.register 重复抛错），所以必须删除。

- Delete: `server/services/agent-platform/registry/registerLegacyRunners.ts`
- Delete: `server/plugins/agent-registry.ts`
- 创建一个新的 `server/plugins/agents-load.ts` 用 import 触发各 vertical 的 agent.config.ts 自动注册

```typescript
// server/plugins/agents-load.ts
import '~~/server/agents/case-main/agent.config'
import '~~/server/agents/case-module/agent.config'
import '~~/server/agents/case-analysis/agent.config'   // 阶段 8 接入；阶段 2 阶段先用 legacy
import '~~/server/agents/legal-assistant/agent.config'
import '~~/server/agents/document/agent.config'
import '~~/server/agents/contract/agent.config'

export default defineNitroPlugin(() => {
    // import 副作用即注册；这里只 log
    logger.info('[agents-load] 业务 vertical 已注册')
})
```

注：case-analysis（StateGraph 案件初分）阶段 2 不接入；阶段 8 才会改造。所以 T18 时 case-analysis 还需要继续走 legacy registration——保留 registerLegacyRunners 的"案件初分"那一项即可。

更精细方案：T18 改 registerLegacyRunners 只保留 `(CASE, ANALYSIS) → startCaseAnalysisV2`，其他 5 个删除。然后阶段 8 完成时再删除整个 registerLegacyRunners。

```bash
git commit -m "refactor(agent-platform): registerLegacyRunners 仅保留 caseAnalysisV2，5 业务由 vertical 自动注册"
```

---

## Task 19：Admin skills CRUD API

**Files:**
- Create: `server/api/v1/admin/skills/index.get.ts`（list）
- Create: `server/api/v1/admin/skills/[name]/status.patch.ts`（启停）

(resync.post.ts 阶段 1 已有)

```bash
git commit -m "feat(api): admin skills 列表 + 启停接口"
```

---

## Task 20：Admin nodes 关联 skills API

**Files:**
- Create: `server/api/v1/admin/nodes/[id]/skills.patch.ts`
- 修改 NodeConfig loader：当节点关联的 skills 变化时，invalidate 该节点缓存

```bash
git commit -m "feat(api): admin nodes 关联 skills 接口"
```

---

## Task 21：后台 UI（skill 列表 + 节点编辑 chip 多选）

**Files (前端):**
- Create: `app/components/admin/skills/SkillList.vue`
- Create: `app/components/admin/skills/SkillEnableSwitch.vue`
- Create: `app/components/admin/nodes/NodeSkillSelector.vue`
- Create: `app/pages/admin/skills/index.vue`
- Modify: 现有 `app/components/admin/nodes/NodeFormDialog.vue` 加入 NodeSkillSelector

```bash
git commit -m "feat(admin): skill 管理 UI + 节点编辑 chip 多选"
```

---

## Task 22：阶段 2 全量回归 + tag

- typecheck 全绿
- 5 业务的现有单测全 PASS
- defineDomainAgent 集成测试 PASS
- 6 业务手工烟雾测试（与阶段 1 同样的测试集）
- skill 后台 UI 烟雾：列表加载、新建 skill 关联到节点、节点编辑 chip 多选、保存

```bash
git tag -a ai-unify-stage-2-done -m "AI 基建统一改造 阶段 2 完成：Agent 工厂化 + 业务 vertical + Skills 入网"
```

---

## 阶段 2 完成标志

1. `server/services/agent-platform/` 包含完整平台库（factory / registry / middleware / tools / nodeConfig / context / state / sse / skills）
2. `server/agents/<5 业务>/` 各自含 agent.config.ts + 私有中间件 + service/dao/tools
3. agentRegistry 由 vertical 自动注册（仅 case-analysis 仍走 legacy）
4. skills 自动按 NodeConfig 关联挂 middleware + 4 个 skill 工具自动跟随
5. 后台可在线管理 skills 和节点-skill 关联
6. typecheck 全绿
7. 5 业务行为等同阶段 1（小索/模块对话/通用问答/文书生成/合同审查）

---

## Risk & Mitigation

- **大规模文件搬迁误差**：每搬一个文件立即跑相关测试；保留 re-export shim 一段时间避免大爆炸
- **中间件挂载顺序破坏**：buildMiddlewareStack 互斥校验运行时检查；defineDomainAgent runtime 挂载顺序与现状对齐
- **NodeConfig 缓存不一致**：admin patch API 改动节点配置时强制 invalidate
- **skillsMiddleware 模块单例 vs 节点动态构造**：FilesystemBackend 按 sources 列表 hash 缓存，避免每次 createAgent 重建
- **业务 vertical 与旧 workflow re-export 共存期**：T18 收尾时统一删除 shim，确保 import 路径只有一份真理

阶段 2 设计依据：spec §3 §4 §6 阶段 2、阶段 1 的 agentRegistry 为入口。
