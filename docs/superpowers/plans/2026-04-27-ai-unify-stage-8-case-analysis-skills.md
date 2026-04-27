# 阶段 8 · 案件初分接 Skills + 提示词改造（实施计划 v3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**：把案件初分 7 个分析模块（概要/大事记/请求权/判决趋势/案由/抗辩/证据）的工作说明书直接换成"按方法手册做事"的版本（已现成放在 `.deepagents/skills/<手册名>/提示词.md`）；底层把每个模块手写的 ReAct 循环替换成复用平台中间件管道；案件初分入口接到标准 vertical 工厂；顺路把小索 / 模块对话内部"摆出所有手册"的全局开关都删掉，改用"按节点查绑定关系"的标准做法。

**核心动作**：
- 7 个分析模块的工作说明**直接覆盖**为方法手册版（不留旧版、不并存）
- 每个分析模块绑 1 本同名手册；小索绑全部 14 本手册；模块对话沿用其分析节点的 1 本手册关联
- 7 个分析模块的"已升级"标记位（`nodes.use_skills_as_logic`）切到 true 仅作记录
- 数据库改动只动种子文件 `prisma/seeds/seedData.sql` + Lead 同步落到 dev / testing 库；生产库由用户处理（不建迁移文件——按 `.claude/rules/database.md` 规则数据型变更不走 prisma migrate）

**Tech Stack**：LangChain `createAgent` / LangGraph StateGraph / `agent-platform/middleware/skills.ts buildSkillsMiddlewareForNode` / `agent-platform/skills/filesystemBackendCache.ts` / Prisma `nodes.use_skills_as_logic`（已就绪）+ `node_skills`（已就绪）。

---

## 0. 决策落定（v3）

| 议题 | 落定方案 |
|---|---|
| 老说明 vs 新说明共存 | **直接覆盖**现有 prompts.content，不留旧版；不引入 prompts.type='system_skills_logic' |
| 改造哪几个模块 | 7 个全部（除前置数据校验 caseInfoCheck 不参与） |
| 数据落地方式 | 改种子文件 `seedData.sql` + Lead 同步跑到 dev / testing 库；不建迁移文件 |
| 模块对话 skill 加载 | 顺路改成"只加载当前对话模块对应的手册"（删 moduleAgent.ts 模块级 skillsMw 单例）|
| 小索 skill 加载 | 顺路把"摆所有手册"的全局开关删掉（删 caseMainAgent.ts 模块级 skillsMw 单例 + 整段 dead 函数 runCaseChat）；DB 给小索节点绑全部 14 本手册保功能不退化 |
| `useSkillsAsLogic` 字段语义 | 仅作产品标记位，代码不读取（NodeConfig 类型不含此字段，符合现状）|
| 质量验证 | 用户人工抽样；自动化评分留待后续 |

---

## 1. 现状（已逐文件核对真实代码）

### 1.1 案件初分调度链路

```
POST /api/v1/case/init-analysis           ← server/api/v1/case/init-analysis.post.ts
  → enqueueRunService(scope=CASE, type=ANALYSIS, selectedModules)
  → agentWorker.executeRun                 ← server/services/agent/agentWorker.ts:207
    → agentRegistry.dispatch({scope=CASE, type=ANALYSIS})
      → registerLegacyRunners.ts (legacy)  ← Task 3 删除
        → startCaseAnalysisV2              ← caseAnalysisV2.executor.ts
          → getCaseAnalysisWorkflow        ← caseAnalysisV2.workflow.ts:556
            → 主图 StateGraph 7 个 analysis 节点顺序串联
              → 每个节点 createAnalysisNode 内部步骤 5a-5c：手写 inner ReAct
                                            ↑ Task 1/2 替换为复用平台中间件管道
```

### 1.2 7 个分析模块完整对应

| 节点 ID | 节点名 | 中文标题 | 对应 SKILL | 提示词.md 行数 | 旧 prompt 长度 | seedData 中 prompt id | seedData 行号 |
|---|---|---|---|---|---|---|---|
| 6 | summary | 生成案件概要 | anjian-gaiyao | 187 | 1487 字 | 7 | 1244 |
| 7 | chronicle | 提取案件大事记 | anjian-dashiji | 140 | 632 字 | 8 | 1278 |
| 8 | claim | 预分析案件请求权 | qingqiuquan-jichu | 204 | 3672 字 | 9 | 1294 |
| 9 | trend | 判决趋势预测 | panjue-qushi | 248 | 10845 字 | 10 | 1440 |
| 10 | cause | 预选案由 | anyou-xuanze | 259 | 1706 字 | 11 | 1685 |
| 11 | defense | 抗辩分析 | kangbian-fenxi | 384 | 2298 字 | 12 | 1749 |
| 12 | evidence | 证据清单预梳理 | zhengju-celue | 297 | 4519 字 | 13 | 1839 |

`caseInfoCheck`（id=1）是初分前置数据校验，不进主图分析循环，**不在阶段 8 改造范围**。

### 1.3 小索（caseMain）现状与改造

- **当前形态**：`server/services/workflow/agents/caseMainAgent.ts` 含 `runCaseChat` 函数（line 75）+ 模块级 `skillsMiddleware` 单例（line 43-46）"摆出所有 14 本手册"
- **真实路径**：小索实际通过 `server/agents/case-main/agent.config.ts` 走 `defineDomainAgent({ agentType: 'createAgent' })` → `runtime.ts:runDomainAgent`，按节点 node_skills 自动构造 skillsMw
- **`runCaseChat` 是死代码**：grep 确认无任何非测试调用方
- **DB 现状**：`node_skills` 表中 caseMain（node_id=5）行数 = **0**——一直在吃旧函数的"硬塞所有手册"
- **改造**：
  1. 删除 `runCaseChat` 整段函数（line 75-225 范围）+ 模块级 skillsMw 单例（line 28-46 范围）+ `createSkillsMiddleware / FilesystemBackend` 的 import
  2. **保留** `getChatThreadState`（line 228）：`agentWorker.ts:304` 仍在用
  3. DB 给 caseMain 节点关联**全部 14 本手册**（保功能不退化）

### 1.4 模块对话（case-module）现状与改造

- **当前形态**：`server/services/workflow/agents/moduleAgent.ts:42-46` 模块级 skillsMw 单例"摆出所有手册"
- **真实路径**：模块对话通过 `server/agents/case-module/agent.config.ts` 走 stateGraph vertical → 委托 `runModuleChat(moduleAgent.ts:68)`，**`getValidNodeConfig(moduleName)` 加载的就是分析节点的配置**（trend/chronicle 等）
- **改造**：删模块级 skillsMw 单例，改用 `buildSkillsMiddlewareForNode(nodeConfig.id)` 按节点动态构造——自动满足"只加载对应手册"

### 1.5 已就绪基础设施（无需重建）

- `server/services/agent-platform/middleware/skills.ts:19` `buildSkillsMiddlewareForNode(nodeId)` 按节点动态构造 skillsMw
- `server/services/agent-platform/skills/filesystemBackendCache.ts:13` 共享 backend 缓存
- `server/services/agent-platform/factory/runtime.ts:343` `runStateGraphAgent` stateGraph vertical 路径（合同审查阶段 4 用过）
- `server/agents/case-module/agent.config.ts` stateGraph vertical 样板
- 4 个 skill 工具：`readSkillFile.tool.ts / writeSkillFile.tool.ts / runSkillScript.tool.ts / runSkillCommand.tool.ts`，均 `export function createTool(context: ToolContext, ...)`
- `prisma/models/node.prisma:50-54` `nodes.use_skills_as_logic` 列已应用
- `prisma/models/skill.prisma` skills + node_skills 表已应用
- `.deepagents/skills/` 14 个手册全部就绪：7 个中文分析手册 + `docx / pptx / minimax-pdf / minimax-xlsx / evidence-defense / litigation-visualization / legal-document-writer`
- `server/plugins/skill-sync.ts` 启动时扫描入库 skills 表（无需手动 seed）

### 1.6 测试影响面

`grep -rn caseAnalysisV2 tests/` → 无命中。改造只需做 helper 单测 + dev smoke。

---

## 2. File Structure

新建：
- `server/agents/case-analysis/agent.config.ts` — vertical 入口（runStateGraph）
- `server/agents/case-analysis/runAnalysisSubAgent.ts` — 抽出的分析子图 runner（按节点构造 createAgent + 中间件 + skillsMw）
- `server/agents/case-analysis/__tests__/runAnalysisSubAgent.test.ts` — 单元测试

修改：
- `server/services/workflow/caseAnalysisV2.workflow.ts` — `createAnalysisNode` 内步骤 5a/5b 改调 `runAnalysisSubAgent`；保留步骤 5c（token 计算）+ 5d（持久化）+ 步骤 6（扣费）
- `server/services/workflow/agents/moduleAgent.ts` — 删模块级 skillsMw 单例（line 32-46），改用 `buildSkillsMiddlewareForNode`
- `server/services/workflow/agents/caseMainAgent.ts` — 删 `runCaseChat` 函数 + 模块级 skillsMw 单例 + 相关 deepagents import；保留 `getChatThreadState`
- `server/services/workflow/agents/index.ts` — 删除 `runCaseChat` 的 re-export，保留 `getChatThreadState`
- `server/plugins/agents-load.ts` — 加 `caseAnalysisAgent` import；删 `registerLegacyRunners()` 调用 + import
- `prisma/seeds/seedData.sql` — 7 个分析模块 prompt content **直接覆盖**为提示词.md 全文；末尾追加 14 行 caseMain skill 绑定 + 7 行分析模块 skill 绑定 + 7 行 nodes use_skills_as_logic = true UPDATE

删除：
- `server/services/agent-platform/registry/registerLegacyRunners.ts`
- `server/services/workflow/agents/caseAnalysis.ts` — 阶段 2/3 残留 orphan（`caseAnalysisAgent` 函数无任何非测试 import）

数据库（Lead 同步跑 SQL 到 dev / testing 库；生产库由用户处理）：
- `UPDATE prompts SET content = ... WHERE id IN (7,8,9,10,11,12,13)` — 7 行分析模块工作说明内容覆盖
- `INSERT INTO node_skills` — 14 行小索绑定（node_id=5）+ 7 行分析模块绑定（node_id 6-12）
- `UPDATE nodes SET use_skills_as_logic = true WHERE name IN ('summary','chronicle','claim','trend','cause','defense','evidence')`

---

## 3. 任务拆解（每步 2-5 分钟）

### Task 1：抽出 `runAnalysisSubAgent` helper

**Files**：
- Create: `server/agents/case-analysis/runAnalysisSubAgent.ts`
- Create: `server/agents/case-analysis/__tests__/runAnalysisSubAgent.test.ts`

**设计原则**：仅替换原 caseAnalysisV2.workflow.ts 步骤 5a（model + tools 创建）+ 步骤 5b（lastMsg 提取）；**不替换** 步骤 1-4（DB 状态机）+ 步骤 5c（token 计算）+ 步骤 5d（持久化）+ 步骤 6（积分扣减）—— 这些主图职责仍由 `createAnalysisNode` 自己执行。

**故意不挂的中间件**：
- `pointConsumption`（主图步骤 6 自己扣费，避免双扣）
- `analysisResultPersistence`（主图步骤 5d 自己持久化，避免双写）

**实际挂载的中间件**（按 priority）：
1. `messageIntegrity` (1)
2. `scopeGuard` (5)
3. `toolCallLimit` ×N (7+)
4. `summarization` (40)
5. `safetyTrim` (50)
6. `skills`（节点关联了手册时，60）
7. `audit` (100)

**完整代码**：

```typescript
// server/agents/case-analysis/runAnalysisSubAgent.ts
/**
 * 案件初分分析子图 runner。
 *
 * 替换 caseAnalysisV2.workflow.ts createAnalysisNode 内步骤 5a/5b 的手写 inner ReAct，
 * 复用 agent-platform 中间件管道（含 skillsMiddleware + 4 skill 工具自动跟随）。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §6 阶段 8
 */

import { createAgent, summarizationMiddleware } from 'langchain'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'

import { getNodeConfigCached } from '~~/server/services/agent-platform/nodeConfig/loader'
import { renderSystemPrompt } from '~~/server/services/agent-platform/nodeConfig/promptRenderer'
import { createChatModel } from '~~/server/services/agent-platform/modelFactory'
import { getToolInstancesService } from '~~/server/services/agent-platform/tools/index'
import { buildSkillsMiddlewareForNode } from '~~/server/services/agent-platform/middleware/skills'
import { resolveContextWindow } from '~~/server/services/agent-platform/context/messageCompressor'
import { buildSystemPromptForAgent } from '~~/server/services/agent-platform/context/moduleContextBuilder'

import {
    buildMiddlewareStack,
    MIDDLEWARE_PRIORITY,
    MIDDLEWARE_NAMES,
    safetyTrimMiddleware,
    createMessageIntegrityMiddleware,
    createScopeGuardMiddleware,
    createAuditMiddleware,
    createToolCallLimitMiddlewares,
} from '~~/server/services/agent-platform/middleware/index'

import { createTool as createReadSkillFileTool } from '~~/server/services/agent-platform/tools/readSkillFile.tool'
import { createTool as createWriteSkillFileTool } from '~~/server/services/agent-platform/tools/writeSkillFile.tool'
import { createTool as createRunSkillScriptTool } from '~~/server/services/agent-platform/tools/runSkillScript.tool'
import { createTool as createRunSkillCommandTool } from '~~/server/services/agent-platform/tools/runSkillCommand.tool'

import type { ToolContext } from '~~/server/services/agent-platform/tools/types'

export interface RunAnalysisSubAgentParams {
    /** 节点名 = analysis_type，如 'trend' */
    agentName: string
    /** 模块标题（中文）*/
    moduleTitle: string
    userId: number
    caseId: number
    sessionId: string
    runId: string
    thinking: boolean
    signal?: AbortSignal
}

export interface RunAnalysisSubAgentResult {
    /** 完整响应消息列表（含中间 tool_use / tool_result）*/
    messages: any[]
    /** AI 最终回答的纯文本聚合 */
    resultText: string
    /** 节点 nodes.id（主图持久化时需要）*/
    nodeId: number
}

export async function runAnalysisSubAgent(
    params: RunAnalysisSubAgentParams,
): Promise<RunAnalysisSubAgentResult> {
    const { agentName, moduleTitle, userId, caseId, sessionId, runId, thinking, signal } = params

    const nodeConfig = await getNodeConfigCached(agentName)
    if (!nodeConfig) throw new Error(`案件初分节点 ${agentName} 未找到`)

    const activeApiKey = nodeConfig.modelApiKeys.find(k => k.status === 1)
    if (!activeApiKey) throw new Error(`案件初分节点 ${agentName} 没有可用的 API 密钥`)

    const model = createChatModel({
        sdkType: nodeConfig.modelSdkType,
        modelName: nodeConfig.modelName,
        apiKey: activeApiKey.apiKey,
        baseUrl: nodeConfig.modelProviderBaseUrl,
        temperature: 0.7,
        streaming: true,
        thinking,
        maxTokens: nodeConfig.modelMaxOutputTokens,
    })

    // 沿用现有 renderSystemPrompt（不引入 byStyle 渲染器，prompts 表只留一条）
    const roleAndFlowTemplate = renderSystemPrompt(nodeConfig, { caseId, moduleName: agentName })

    // 5 段式 prompt 一站式构建（保留 prompt cache 命中能力，与 moduleAgent 用法一致）
    const { systemMessage, plainText: plainTextPrompt } = await buildSystemPromptForAgent(
        nodeConfig.modelSdkType,
        { caseId, agentName, userQuery: '', roleAndFlowTemplate },
    )

    const { triggerTokens, maxTokens, maxOutputTokens } = resolveContextWindow(
        nodeConfig.modelContextWindow,
        nodeConfig.modelMaxOutputTokens,
    )

    const skillsMw = await buildSkillsMiddlewareForNode(nodeConfig.id)

    const toolContext: ToolContext = { userId, caseId, sessionId, runId }

    const nodeTools = nodeConfig.tools.length > 0
        ? getToolInstancesService(nodeConfig.tools, toolContext)
        : []

    const skillTools: StructuredToolInterface[] = skillsMw
        ? [
            createReadSkillFileTool(toolContext),
            createWriteSkillFileTool(toolContext),
            createRunSkillScriptTool(toolContext),
            createRunSkillCommandTool(toolContext),
        ]
        : []

    // 按 name 去重（节点 tools JSON 若与 skill 工具同名时业务节点 tools 胜出）
    const toolsByName = new Map<string, StructuredToolInterface>()
    for (const t of [...nodeTools, ...skillTools]) toolsByName.set(t.name, t)
    const tools = Array.from(toolsByName.values())

    const middlewareItems = [
        {
            middleware: createMessageIntegrityMiddleware(),
            priority: MIDDLEWARE_PRIORITY.MESSAGE_INTEGRITY,
            name: MIDDLEWARE_NAMES.MESSAGE_INTEGRITY,
        },
        {
            middleware: createScopeGuardMiddleware(),
            priority: MIDDLEWARE_PRIORITY.SCOPE_GUARD,
            name: MIDDLEWARE_NAMES.SCOPE_GUARD,
        },
        ...createToolCallLimitMiddlewares().map((mw, i) => ({
            middleware: mw,
            priority: MIDDLEWARE_PRIORITY.TOOL_CALL_LIMIT + i,
            name: `${MIDDLEWARE_NAMES.TOOL_CALL_LIMIT}_${i}`,
        })),
        {
            middleware: summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
            priority: MIDDLEWARE_PRIORITY.SUMMARIZATION,
            name: MIDDLEWARE_NAMES.SUMMARIZATION,
        },
        {
            middleware: safetyTrimMiddleware({ model, maxTokens, systemPrompt: plainTextPrompt, maxOutputTokens }),
            priority: MIDDLEWARE_PRIORITY.SAFETY_TRIM,
            name: MIDDLEWARE_NAMES.SAFETY_TRIM,
        },
        {
            middleware: createAuditMiddleware(),
            priority: MIDDLEWARE_PRIORITY.AUDIT,
            name: MIDDLEWARE_NAMES.AUDIT,
        },
    ]
    if (skillsMw) {
        middlewareItems.push({
            middleware: skillsMw,
            priority: MIDDLEWARE_PRIORITY.SKILLS_DISCOVERY,
            name: MIDDLEWARE_NAMES.SKILLS_DISCOVERY,
        })
    }
    const middleware = buildMiddlewareStack(middlewareItems)

    // 子图每次主图节点调用一次性 invoke，不需要 checkpointer / store
    const agent = createAgent({ model, systemPrompt: systemMessage, tools, middleware })

    const initialMessages = [
        new HumanMessage(`现在请开始"${moduleTitle}"分析。`),
    ]

    logger.info('[runAnalysisSubAgent] 启动', {
        agentName, nodeId: nodeConfig.id,
        hasSkillsMw: !!skillsMw,
        nodeToolsCount: nodeTools.length,
        skillToolsCount: skillTools.length,
    })

    const response = await agent.invoke(
        { messages: initialMessages },
        { recursionLimit: 1000, signal },
    )

    const responseMessages = response.messages ?? []
    const lastMsg = responseMessages[responseMessages.length - 1]
    let resultText = ''
    if (lastMsg && typeof lastMsg.content === 'string') {
        resultText = lastMsg.content
    } else if (lastMsg && Array.isArray(lastMsg.content)) {
        resultText = lastMsg.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n')
    }

    return { messages: responseMessages, resultText, nodeId: nodeConfig.id }
}
```

- [ ] **Step 1.1：写失败测试**

```typescript
// server/agents/case-analysis/__tests__/runAnalysisSubAgent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/agent-platform/nodeConfig/loader', () => ({
    getNodeConfigCached: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/middleware/skills', () => ({
    buildSkillsMiddlewareForNode: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/context/moduleContextBuilder', () => ({
    buildContextSegments: vi.fn(async () => ({
        roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '',
    })),
    toCachedPrompt: vi.fn(() => []),
}))
vi.mock('~~/server/services/agent-platform/modelFactory', () => {
    const mockInvoke = vi.fn(async () => ({
        messages: [{ content: 'mock 分析结果', _getType: () => 'ai' }],
    }))
    return {
        createChatModel: vi.fn(() => ({ invoke: mockInvoke, bindTools: () => ({ invoke: mockInvoke }) })),
        cachedPromptToAnthropicContent: vi.fn(() => []),
        cachedPromptToPlainText: vi.fn(() => ''),
    }
})

describe('runAnalysisSubAgent', () => {
    beforeEach(() => vi.clearAllMocks())

    it('skillsMw=null 时不注入 4 个 skill 工具，且不挂 skills middleware', async () => {
        const { runAnalysisSubAgent } = await import('../runAnalysisSubAgent')
        const { buildSkillsMiddlewareForNode } = await import(
            '~~/server/services/agent-platform/middleware/skills'
        )
        const { getNodeConfigCached } = await import(
            '~~/server/services/agent-platform/nodeConfig/loader'
        )

        ;(buildSkillsMiddlewareForNode as any).mockResolvedValue(null)
        ;(getNodeConfigCached as any).mockResolvedValue({
            id: 9, name: 'trend',
            prompts: [{ type: 'system', status: 1, content: 'sys' }],
            tools: [],
            modelSdkType: 'anthropic', modelName: 'claude',
            modelApiKeys: [{ status: 1, apiKey: 'k' }],
            modelProviderBaseUrl: '',
            modelMaxOutputTokens: 4096, modelContextWindow: 200000,
        })

        const r = await runAnalysisSubAgent({
            agentName: 'trend', moduleTitle: '判决趋势预测',
            userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: false,
        })

        expect(r.resultText).toBe('mock 分析结果')
        expect(r.nodeId).toBe(9)
    })

    it('skillsMw 非 null 时挂 skills middleware + 注入 4 个 skill 工具', async () => {
        // 验证 createAgent 入参的 tools 数 = 4 + middlewareItems 含 skillsDiscovery
    })

    it('agentName 不存在时抛错', async () => {
        const { runAnalysisSubAgent } = await import('../runAnalysisSubAgent')
        const { getNodeConfigCached } = await import(
            '~~/server/services/agent-platform/nodeConfig/loader'
        )

        ;(getNodeConfigCached as any).mockResolvedValue(null)

        await expect(
            runAnalysisSubAgent({
                agentName: 'nonexistent', moduleTitle: '',
                userId: 1, caseId: 1, sessionId: 's', runId: 'r', thinking: false,
            }),
        ).rejects.toThrow('案件初分节点 nonexistent 未找到')
    })
})
```

- [ ] **Step 1.2：跑测试确认失败**

Run: `npx vitest run server/agents/case-analysis/__tests__/runAnalysisSubAgent.test.ts`
Expected: FAIL（文件不存在）

- [ ] **Step 1.3：实现 `runAnalysisSubAgent.ts`**（按上方完整代码）

- [ ] **Step 1.4：跑测试确认通过**

Run: `npx vitest run server/agents/case-analysis/__tests__/runAnalysisSubAgent.test.ts`
Expected: PASS

- [ ] **Step 1.5：commit**

```bash
git add server/agents/case-analysis/runAnalysisSubAgent.ts \
        server/agents/case-analysis/__tests__/runAnalysisSubAgent.test.ts
git commit -m "feat(stage8): 抽出案件初分分析子图 runAnalysisSubAgent"
```

---

### Task 2：`caseAnalysisV2.workflow.ts` 切换至 `runAnalysisSubAgent`

**Files**：
- Modify: `server/services/workflow/caseAnalysisV2.workflow.ts`

**改造边界**（用步骤标记定位，不用脆弱行号）：
- `createAnalysisNode` 内**步骤 5a-5b**（line 236-417 范围）整段替换为对 `runAnalysisSubAgent` 的一次调用
- **保留**步骤 4 创建 IN_PROGRESS 记录、步骤 5c token 计算、步骤 5d 持久化、步骤 6 积分扣减、步骤 1-3 的会员/积分预检 + 错误处理

- [ ] **Step 2.1：编辑 caseAnalysisV2.workflow.ts**

新增 import：

```typescript
import { runAnalysisSubAgent } from '~~/server/agents/case-analysis/runAnalysisSubAgent'
```

把 `createAnalysisNode` 内步骤 5a-5b 整段（从"步骤 5a：执行 LLM 分析"注释到 "步骤 5b：提取结果"段末，约 line 236-417）替换为：

```typescript
                // 步骤 5：执行 LLM 分析（复用 agent-platform 中间件管道）
                const sub = await runAnalysisSubAgent({
                    agentName,
                    moduleTitle,
                    userId: state.userId,
                    caseId: state.caseId,
                    sessionId: state.sessionId,
                    runId: '',  // V2 主流程未透传 runId，留空（持久化层不依赖此字段）
                    thinking: state.thinking ?? true,
                })
                responseMessages = sub.messages
                resultText = sub.resultText
```

步骤 5c（token 计算）+ 5d（持久化）+ 步骤 6（积分扣减）保持不变。

同时删除原 imports 中已不再使用的：
- `Annotation, MessagesAnnotation`（InnerState 已删）
- `ToolNode`（手写 ReAct 已删）
- `getValidNodeConfig`（已交给 runAnalysisSubAgent 内部 getNodeConfigCached）
- `createChatModel`（已交给 sub agent）
- `getToolInstancesService`（已交给 sub agent）
- 等等——**逐个 import 核对，确保不留 unused**

- [ ] **Step 2.2：跑 typecheck + 受影响测试**

Run: `npx nuxi typecheck`
Expected: 0 新增错误（admin-layout.vue 残留 1 个不计）

Run: `npx vitest run tests/server`
Expected: 不引入新失败（接受 stage 6/7 遗留 6 个失败 + skipped 不变）

- [ ] **Step 2.3：本地 dev smoke**

```bash
DATABASE_URL='postgresql://daixin:daixin88@127.0.0.1:5432/ls_new?schema=public' bun dev
```

浏览器：进 `/dashboard/cases/init-analysis/<sessionId>` → 触发完整分析（7 模块顺序跑完）→ 0 console error。

完成后 `pkill -f 'bun.*dev'` 关停 dev server（按记忆 `feedback_kill_dev_on_finish.md`）。

- [ ] **Step 2.4：commit**

```bash
git add server/services/workflow/caseAnalysisV2.workflow.ts
git commit -m "refactor(stage8): caseAnalysisV2 内层 ReAct → runAnalysisSubAgent"
```

---

### Task 3：vertical 化 `case-analysis`（删 legacy runner，**同 commit**）

**Files**：
- Create: `server/agents/case-analysis/agent.config.ts`
- Modify: `server/plugins/agents-load.ts`
- Delete: `server/services/agent-platform/registry/registerLegacyRunners.ts`

⚠️ 这 3 个文件改动**必须同一次 commit**。`registerLegacyRunners.ts` 在 plugin 启动时注册 `(CASE, ANALYSIS)`；新 vertical 也注册同样的 (scope, type) → `agentRegistry.register` 会抛"重复注册"导致启动失败。如果只删 legacy 不加 vertical，调度时会抛"未找到 runner"。

- [ ] **Step 3.1：创建 agent.config.ts**

```typescript
// server/agents/case-analysis/agent.config.ts
/**
 * 案件初分 vertical（StateGraph 形态）
 *
 * scope=CASE / type=ANALYSIS：替代阶段 2 临时的 registerLegacyRunners.ts。
 * 保留 caseAnalysisV2.workflow.ts 的主图状态机；内层 ReAct 已在 Task 1/2 改造。
 *
 * @see docs/superpowers/specs/2026-04-26-ai-infrastructure-unification-design.md §6 阶段 8
 */

import { defineDomainAgent } from '~~/server/services/agent-platform/factory/defineDomainAgent'
import { SessionScope, SessionType } from '#shared/types/agentEvent'

export const caseAnalysisAgent = defineDomainAgent({
    scope: SessionScope.CASE,
    type: SessionType.ANALYSIS,
    agentType: 'stateGraph',
    nodeName: 'caseInfoCheck',  // priority=10 入口节点，仅供平台预加载 nodeConfig 用
    description: '案件初分（StateGraph + 7 个 analysis 子模块顺序执行）',
    runStateGraph: async (ctx) => {
        const { startCaseAnalysisV2 } = await import(
            '~~/server/services/workflow/caseAnalysisV2.executor'
        )
        if (ctx.caseId == null) {
            throw new Error(`case session ${ctx.sessionId} 缺失 caseId（数据损坏）`)
        }
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
```

- [ ] **Step 3.2：更新 agents-load.ts**

新增 import：

```typescript
import { caseAnalysisAgent } from '~~/server/agents/case-analysis/agent.config'
```

删除 import：

```typescript
// 删 import { registerLegacyRunners } from '~~/server/services/agent-platform/registry/registerLegacyRunners'
```

在 verticals 数组追加 `caseAnalysisAgent`，删除 `registerLegacyRunners()` 调用：

```typescript
const verticals = [
    caseMainAgent,
    caseModuleAgent,
    legalAssistantAgent,
    documentAgent,
    contractAgent,
    caseAnalysisAgent,  // ← 新增
]

// 删 registerLegacyRunners()

logger.info('[agents-load] 业务 vertical 已注册', {
    verticalsLoaded: verticals.length,
    registryTotal: agentRegistry.list().length,
    registryEntries: agentRegistry.list().map(e => ({
        scope: e.scope,
        type: e.type ?? 'null',
        description: e.description,
    })),
})
```

- [ ] **Step 3.3：删除 registerLegacyRunners.ts**

```bash
git rm server/services/agent-platform/registry/registerLegacyRunners.ts
```

- [ ] **Step 3.4：dev smoke**

启动 dev → 触发案件初分 → logger 应显示 `[defineDomainAgent] 注册成功 scope=case type=2 nodeName=caseInfoCheck` 而非 legacy → 7 模块跑完 → kill dev。

- [ ] **Step 3.5：commit（3 文件同 commit）**

```bash
git add server/agents/case-analysis/agent.config.ts server/plugins/agents-load.ts
git rm server/services/agent-platform/registry/registerLegacyRunners.ts
git commit -m "feat(stage8): case-analysis vertical 化，同 commit 删 legacy runner"
```

---

### Task 4：删小索死代码 `runCaseChat` + 模块级 skillsMw 单例

**Files**：
- Modify: `server/services/workflow/agents/caseMainAgent.ts`
- Modify: `server/services/workflow/agents/index.ts`

⚠️ **保留** `getChatThreadState` 函数（line 228）—— `agentWorker.ts:304` 仍在用。

- [ ] **Step 4.1：核对 runCaseChat 无业务调用方**

Run: `grep -rn 'runCaseChat\b' server tests --include='*.ts'`
Expected: 仅以下几处（注释引用 + 自己 export + 测试 import）：
- agentWorker.ts 注释
- moduleAgent.ts 注释
- caseMainAgent.ts 自己 export
- workflow/agents/index.ts re-export
- tests/server/agent/caseAgent.test.ts（测试 dummy import）
- tests/server/workflow/agents/caseMainAgent.test.ts（测试）

如有非测试的实际 import 调用（如 `await runCaseChat(...)`），暂停删除并报告 Lead。

- [ ] **Step 4.2：编辑 caseMainAgent.ts**

caseMainAgent.ts 真实行数 247 行；改造后只剩 `getChatThreadState` 函数（约 20 行）。

**删除**：
- line 28: `import { createSkillsMiddleware, FilesystemBackend } from 'deepagents'`
- line 29-33: 5 个 skillTool createTool import
- line 9: `HumanMessage` from `@langchain/core/messages`
- line 10: `StructuredToolInterface` from `@langchain/core/tools`
- line 11: `BaseCallbackHandler` from `@langchain/core/callbacks/base`
- line 12: `Command` from `@langchain/langgraph`
- line 14: `getValidNodeConfig, getNodeConfigsByTypes` from `../../node/node.service`
- line 16: `getToolInstancesService` from `../tools`
- line 17: `createSubAgentTools` from `./subAgentToolFactory`
- line 18: `renderSystemPrompt` from `../utils/promptRenderer`
- line 19: `buildSystemPromptForAgent` from `../context/moduleContextBuilder`
- line 20-27: 7 个 middleware import（createAuditMiddleware / createMessageIntegrityMiddleware / createScopeGuardMiddleware / pointConsumptionMiddleware / caseProcessMaterialMiddleware / safetyTrimMiddleware）
- line 34: `resolveContextWindow` from `../context/messageCompressor`
- line 8 中的 `summarizationMiddleware, type ReactAgent`（保留 `createAgent`）
- line 13 中的 `getStore`（保留 `getCheckpointer`）
- line 36-39: `CASE_MAIN_NODE_NAME / SUB_AGENT_NODE_TYPES` 常量（仅 runCaseChat 用）
- line 42-46: 模块级 `skillsMiddleware` 单例
- line 48-74: `CaseAgentOptions` interface（仅 runCaseChat 用）
- line 75-227: `runCaseChat` 函数整段

**保留**：
- line 8: `import { createAgent } from 'langchain'`
- line 13: `import { getCheckpointer } from '../checkpointer'`
- line 15: `import { createChatModel } from '../../node/chatModelFactory'`
- line 228 起：`getChatThreadState` 函数完整保留（agentWorker.ts:304 仍在调用）

**最终文件结构**（约 25 行）：
```typescript
/**
 * 案件主代理（已死代码 runCaseChat 删除，仅保留 getChatThreadState 给 agentWorker 读取 thread state）
 */
import { createAgent } from 'langchain'
import { getCheckpointer } from '../checkpointer'
import { createChatModel } from '../../node/chatModelFactory'

export async function getChatThreadState(sessionId: string) {
    const checkpointer = await getCheckpointer()
    const dummyModel = createChatModel({
        sdkType: 'openai',
        modelName: 'gpt-4',
        apiKey: 'dummy',
        baseUrl: 'http://localhost',
    })
    const stateReader = createAgent({ model: dummyModel, checkpointer })
    return stateReader.getState({ configurable: { thread_id: sessionId } })
}
```

- [ ] **Step 4.3：编辑 workflow/agents/index.ts**

删除 `runCaseChat` 的 re-export，保留 `getChatThreadState`：

```typescript
// 改前：export { runCaseChat, getChatThreadState } from './caseMainAgent'
// 改后：
export { getChatThreadState } from './caseMainAgent'
```

- [ ] **Step 4.4：处理依赖 runCaseChat 的测试**

跑 `npx vitest run tests/server/workflow/agents/caseMainAgent.test.ts tests/server/agent/caseAgent.test.ts` → 失败：runCaseChat is not a function。

按 stage 7 处置遗留旧 composable 测试的同款做法：在测试文件 `describe.skip` 标注 + 写注释"runCaseChat 已删（stage 8），保留测试文件作回归保护"——不删测试文件。

- [ ] **Step 4.5：跑 typecheck 全检**

Run: `npx nuxi typecheck`
Expected: 0 新增错误

- [ ] **Step 4.6：dev smoke**

启动 dev → 进任意案件 `/dashboard/cases/<id>` → 和小索发一条消息 → 验证：
- 回应正常（小索走 case-main vertical → runtime.ts，不依赖 runCaseChat）
- logger 显示 `[defineDomainAgent] 创建 agent ... hasSkillsMw=true skillToolsCount=4`（前提是已完成 Task 7 数据落地——若 Task 7 未做，此处 skillsMw 为 false）

→ kill dev。

- [ ] **Step 4.7：commit**

```bash
git add server/services/workflow/agents/caseMainAgent.ts \
        server/services/workflow/agents/index.ts \
        tests/server/workflow/agents/caseMainAgent.test.ts \
        tests/server/agent/caseAgent.test.ts
git commit -m "chore(stage8): 删小索死代码 runCaseChat + 模块级 skillsMw 单例"
```

---

### Task 5：删孤儿文件 `caseAnalysis.ts`

**Files**：
- Delete: `server/services/workflow/agents/caseAnalysis.ts`

- [ ] **Step 5.1：核对无 import 引用**

Run: `grep -rn "from.*workflow/agents/caseAnalysis['\"]" server tests --include='*.ts'`
Expected: 无输出（已确认）

Run: `grep -rn '\bcaseAnalysisAgent\b' server tests --include='*.ts'`
Expected: 仅 server/agents/case-analysis/agent.config.ts（Task 3 新建的 vertical 同名 export，不冲突——属于不同模块路径）

- [ ] **Step 5.2：删除**

```bash
git rm server/services/workflow/agents/caseAnalysis.ts
```

- [ ] **Step 5.3：跑 typecheck**

Run: `npx nuxi typecheck`
Expected: 0 新增错误

- [ ] **Step 5.4：commit**

```bash
git commit -m "chore(stage8): 删除 orphan caseAnalysis.ts"
```

---

### Task 6：moduleAgent 改用 buildSkillsMiddlewareForNode

> 此改造让"模块对话只加载当前对话的分析模块对应的手册"自动生效——moduleAgent 已按 moduleName 加载分析节点配置，按节点动态构造 skillsMw 后自然按节点过滤。

**Files**：
- Modify: `server/services/workflow/agents/moduleAgent.ts`

- [ ] **Step 6.1：删除模块级 skillsMw 单例 + 相关 imports**

删除内容：
- import `createSkillsMiddleware, FilesystemBackend` from 'deepagents'（line 32）
- 模块级 `skillsMiddleware` 单例（line 42-46，含注释）

新增 import：

```typescript
import { buildSkillsMiddlewareForNode } from '~~/server/services/agent-platform/middleware/skills'
```

- [ ] **Step 6.2：在 runModuleChat 函数体内动态构造**

在 nodeConfig 加载后（约 line 80 后）新增：

```typescript
const skillsMw = await buildSkillsMiddlewareForNode(nodeConfig.id)
```

把 4 skill 工具注入改为条件挂载（line 117-128 范围）：

```typescript
const skillTools = skillsMw
    ? [
        createReadSkillFileTool(toolContext),
        createWriteSkillFileTool(toolContext),
        createRunSkillScriptTool(toolContext),
        createRunSkillCommandTool(toolContext),
        createUploadWorkspaceFileTool(toolContext),  // case-module 业务专属，保留
    ]
    : [createUploadWorkspaceFileTool(toolContext)]   // 即使无 skill 也保留 uploadWorkspace
```

middleware 数组（line 155-173 范围）改为条件挂载 skillsMw：

```typescript
middleware: [
    createMessageIntegrityMiddleware(),
    createScopeGuardMiddleware(),
    pointConsumptionMiddleware(userId, 'case_analysis_token', sessionId),
    summarizationMiddleware({ model, trigger: [{ tokens: triggerTokens }] }),
    safetyTrimMiddleware({ model, maxTokens, systemPrompt: plainTextPrompt, maxOutputTokens }),
    ...(skillsMw ? [skillsMw] : []),
    createAuditMiddleware(),
],
```

- [ ] **Step 6.3：跑 case-module 已有测试**

Run: `npx vitest run tests/server/services/workflow/agents/moduleAgent.test.ts`
Expected: 不引入新失败

- [ ] **Step 6.4：dev smoke（先不验证 skill 数量，等 Task 7 数据落地后再回归验证）**

启动 dev → 进 `/dashboard/cases/<id>` → 打开任一模块对话 → 发一条消息 → logger 应显示 `nodeId=<模块id> skillsCount=0 hasSkillsMw=false`（Task 7 前 DB 还没绑 skill）→ 回应正常 → kill dev。

- [ ] **Step 6.5：commit**

```bash
git add server/services/workflow/agents/moduleAgent.ts
git commit -m "refactor(stage8): moduleAgent skillsMw 单例 → buildSkillsMiddlewareForNode"
```

---

### Task 7：种子文件改 4 处 + Lead 同步落到 dev / testing 库

> 数据型变更，按 `.claude/rules/database.md`：种子数据可以变更，无需建迁移文件；用户手动落生产库。

**Files**：
- Modify: `prisma/seeds/seedData.sql`（4 处修改）
- 临时：`/tmp/stage8-build-prompts-sql.ts`（一次性脚本，不入仓库）
- 临时：`/tmp/stage8-sync-dev-testing.sql`（Lead 跑库用，不入仓库）

#### Step 7.1：写一次性脚本拼出 7 个分析模块的 prompt content

```typescript
// /tmp/stage8-build-prompts-sql.ts
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = '/Users/daixin/work/dev/LexSeek/LexSeek'

// [promptId, nodeId, nodeName, skillFolder, moduleTitleZh]
const MAPPING: Array<[number, number, string, string, string]> = [
    [7,  6,  'summary',   'anjian-gaiyao',     '案件概要'],
    [8,  7,  'chronicle', 'anjian-dashiji',    '大事记'],
    [9,  8,  'claim',     'qingqiuquan-jichu', '请求权基础'],
    [10, 9,  'trend',     'panjue-qushi',      '判决趋势预测'],
    [11, 10, 'cause',     'anyou-xuanze',      '案由选择'],
    [12, 11, 'defense',   'kangbian-fenxi',    '抗辩分析'],
    [13, 12, 'evidence',  'zhengju-celue',     '证据清单'],
]

const escapeSql = (s: string): string => s.replace(/'/g, "''")

// (a) 输出 seedData.sql 用的逐行 INSERT 替换片段（Lead 手动比对替换）
const seedReplacements: string[] = []
// (b) 输出 dev/testing 同步用的 UPDATE 语句
const updates: string[] = []

for (const [promptId, nodeId, nodeName, skill, title] of MAPPING) {
    const md = readFileSync(path.join(ROOT, '.deepagents/skills', skill, '提示词.md'), 'utf-8')
    const content = escapeSql(md)

    // 用于 dev/testing 同步
    updates.push(
        `UPDATE "public"."prompts" SET content = E'${content}', "updated_at" = NOW() WHERE id = ${promptId};`,
    )

    // 用于参考改 seedData.sql（content 部分）
    seedReplacements.push(
        `-- prompt id=${promptId} ${nodeName}_system → ${skill}/提示词.md\n` +
        `-- 在 seedData.sql 找到 VALUES (${promptId}, '${nodeName}_system', ...) 的 content 字段，\n` +
        `-- 替换为：E'${content.slice(0, 200)}...（共 ${md.length} 字符）'\n`,
    )
}

writeFileSync('/tmp/stage8-sync-dev-testing.sql', updates.join('\n\n') + '\n')
writeFileSync('/tmp/stage8-seed-replacements.txt', seedReplacements.join('\n'))

console.log('已生成：')
console.log('  /tmp/stage8-sync-dev-testing.sql  ← 同步 dev/testing 库用')
console.log('  /tmp/stage8-seed-replacements.txt ← 改 seedData.sql 的参考')
```

执行：

```bash
bun run /tmp/stage8-build-prompts-sql.ts
```

#### Step 7.2：编辑 seedData.sql 直接覆盖 7 段 prompt INSERT

⚠️ 注意：每段 prompt 的 content 是**跨多行字符串**——必须按段（整段 INSERT 语句）替换，不是逐行替换。各段跨度：

| 节点 | 起点行 | 段跨度（行数）| 替换为 `提示词.md` |
|---|---|---|---|
| summary (prompt 7)   | 1244 | 34 行  | `anjian-gaiyao/提示词.md` |
| chronicle (prompt 8) | 1278 | 16 行  | `anjian-dashiji/提示词.md` |
| claim (prompt 9)     | 1294 | 146 行 | `qingqiuquan-jichu/提示词.md` |
| trend (prompt 10)    | 1440 | 245 行 | `panjue-qushi/提示词.md` |
| cause (prompt 11)    | 1685 | 64 行  | `anyou-xuanze/提示词.md` |
| defense (prompt 12)  | 1749 | 90 行  | `kangbian-fenxi/提示词.md` |
| evidence (prompt 13) | 1839 | 214 行 | `zhengju-celue/提示词.md` |

**操作流程**（逐段 Edit，每段独立 commit-able 的替换）：

1. Lead 用 Read 工具按起点行 + 跨度精确读出每段完整 INSERT 语句
2. 用 Edit 工具的 multi-line `old_string → new_string` 替换：`old_string` = 旧 INSERT 整段；`new_string` = 新 INSERT 整段（content 字段替换为对应 `提示词.md` 全文，含必要的单引号转义双写）
3. **不用 sed**（CLAUDE.md 全局规则 + 上下文风险）
4. **不另开新 prompts 行**；type 仍保持 'system'；不引入 'system_skills_logic'

`new_string` 模板：

```sql
INSERT INTO "public"."prompts" ("id", "name", "title", "content", "variables", "version", "type", "status", "node_id", "created_at", "updated_at", "deleted_at") VALUES (<promptId>, '<nodeName>_system', '<原标题>', E'<提示词.md 全文，单引号双写>', '[]', 'v8', 'system', 1, <nodeId>, '<原 created_at>', NOW(), NULL);
```

`version` 从 'v1' 升到 'v8'（与提示词.md 的 v8 规范版对齐），`updated_at` 用 NOW()。

#### Step 7.3：seedData.sql 末尾追加阶段 8 段

在 seedData.sql 最末尾（line ~2483 后）追加：

```sql

-- ============================================================
-- 阶段 8：案件初分接 Skills + 提示词改造
-- ============================================================
-- @see docs/superpowers/plans/2026-04-27-ai-unify-stage-8-case-analysis-skills.md

-- 1) 小索（caseMain id=5）关联全部 14 本手册
-- 删除 caseMainAgent.ts 模块级 skillsMw 单例后必须显式登记，否则小索可用手册数从 14 → 0
INSERT INTO "public"."node_skills" ("node_id", "skill_name", "priority", "created_at") VALUES
    (5, 'docx',                     100, '2026-04-28 10:00:00+08'),
    (5, 'pptx',                     100, '2026-04-28 10:00:00+08'),
    (5, 'minimax-pdf',              100, '2026-04-28 10:00:00+08'),
    (5, 'minimax-xlsx',             100, '2026-04-28 10:00:00+08'),
    (5, 'evidence-defense',         100, '2026-04-28 10:00:00+08'),
    (5, 'litigation-visualization', 100, '2026-04-28 10:00:00+08'),
    (5, 'legal-document-writer',    100, '2026-04-28 10:00:00+08'),
    (5, 'anjian-gaiyao',            100, '2026-04-28 10:00:00+08'),
    (5, 'anjian-dashiji',           100, '2026-04-28 10:00:00+08'),
    (5, 'qingqiuquan-jichu',        100, '2026-04-28 10:00:00+08'),
    (5, 'panjue-qushi',             100, '2026-04-28 10:00:00+08'),
    (5, 'anyou-xuanze',             100, '2026-04-28 10:00:00+08'),
    (5, 'kangbian-fenxi',           100, '2026-04-28 10:00:00+08'),
    (5, 'zhengju-celue',            100, '2026-04-28 10:00:00+08')
ON CONFLICT ("node_id", "skill_name") DO NOTHING;

-- 2) 7 个分析模块各绑定 1 本同名中文手册
INSERT INTO "public"."node_skills" ("node_id", "skill_name", "priority", "created_at") VALUES
    (6,  'anjian-gaiyao',     100, '2026-04-28 10:00:00+08'),
    (7,  'anjian-dashiji',    100, '2026-04-28 10:00:00+08'),
    (8,  'qingqiuquan-jichu', 100, '2026-04-28 10:00:00+08'),
    (9,  'panjue-qushi',      100, '2026-04-28 10:00:00+08'),
    (10, 'anyou-xuanze',      100, '2026-04-28 10:00:00+08'),
    (11, 'kangbian-fenxi',    100, '2026-04-28 10:00:00+08'),
    (12, 'zhengju-celue',     100, '2026-04-28 10:00:00+08')
ON CONFLICT ("node_id", "skill_name") DO NOTHING;

-- 3) 7 个分析模块的"已升级"标记位切到 true（仅作记录，代码不读）
UPDATE "public"."nodes" SET use_skills_as_logic = true
WHERE name IN ('summary','chronicle','claim','trend','cause','defense','evidence')
  AND deleted_at IS NULL;
```

#### Step 7.4：Lead 把 SQL 同步到 dev / testing 两库

⚠️ Lead 准备一份完整 SQL（包含 prompt UPDATE + node_skills INSERT + nodes UPDATE）：

```bash
cat > /tmp/stage8-full-sync.sql <<'EOF'
-- 1) 7 行分析模块 prompts 内容覆盖（来自 stage8-build-prompts-sql.ts 输出）
-- ↓ 直接拷贝 /tmp/stage8-sync-dev-testing.sql 内容

-- 2) 14 行小索 ↔ skill 关联
INSERT INTO "public"."node_skills" ("node_id", "skill_name", "priority", "created_at") VALUES
    (5, 'docx',                     100, NOW()),
    (5, 'pptx',                     100, NOW()),
    (5, 'minimax-pdf',              100, NOW()),
    (5, 'minimax-xlsx',             100, NOW()),
    (5, 'evidence-defense',         100, NOW()),
    (5, 'litigation-visualization', 100, NOW()),
    (5, 'legal-document-writer',    100, NOW()),
    (5, 'anjian-gaiyao',            100, NOW()),
    (5, 'anjian-dashiji',           100, NOW()),
    (5, 'qingqiuquan-jichu',        100, NOW()),
    (5, 'panjue-qushi',             100, NOW()),
    (5, 'anyou-xuanze',             100, NOW()),
    (5, 'kangbian-fenxi',           100, NOW()),
    (5, 'zhengju-celue',            100, NOW())
ON CONFLICT ("node_id", "skill_name") DO NOTHING;

-- 3) 7 行分析模块 ↔ skill 关联
INSERT INTO "public"."node_skills" ("node_id", "skill_name", "priority", "created_at") VALUES
    (6,  'anjian-gaiyao',     100, NOW()),
    (7,  'anjian-dashiji',    100, NOW()),
    (8,  'qingqiuquan-jichu', 100, NOW()),
    (9,  'panjue-qushi',      100, NOW()),
    (10, 'anyou-xuanze',      100, NOW()),
    (11, 'kangbian-fenxi',    100, NOW()),
    (12, 'zhengju-celue',     100, NOW())
ON CONFLICT ("node_id", "skill_name") DO NOTHING;

-- 4) 7 行 use_skills_as_logic = true
UPDATE "public"."nodes" SET use_skills_as_logic = true
WHERE name IN ('summary','chronicle','claim','trend','cause','defense','evidence')
  AND deleted_at IS NULL;
EOF
```

跑到 dev 库：

```bash
docker cp /tmp/stage8-full-sync.sql postgres-postgres-1:/tmp/stage8-full-sync.sql
docker exec postgres-postgres-1 psql -U daixin -d ls_new -f /tmp/stage8-full-sync.sql
```

跑到 testing 库：

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new_testing -f /tmp/stage8-full-sync.sql
```

⚠️ **不操作生产库**——按用户决策"生产库由我自己处理"。

#### Step 7.5：dev 验证 SQL 落地

```bash
docker exec postgres-postgres-1 psql -U daixin -d ls_new -c "
SELECT n.name, n.use_skills_as_logic, ns.skill_name
FROM nodes n LEFT JOIN node_skills ns ON ns.node_id = n.id
WHERE n.name IN ('caseMain','summary','chronicle','claim','trend','cause','defense','evidence')
  AND n.deleted_at IS NULL
ORDER BY n.priority, ns.skill_name;
"
```

期望：
- caseMain：`use_skills_as_logic=false`，14 行 skill 关联
- 7 个分析模块：`use_skills_as_logic=true`，各 1 行 skill 关联

#### Step 7.6：commit seedData.sql

```bash
git add prisma/seeds/seedData.sql
git commit -m "feat(stage8): 7 分析模块换规范版提示词 + 小索/分析模块 skill 绑定"
```

⚠️ 一次性脚本 `/tmp/stage8-build-prompts-sql.ts` / `/tmp/stage8-full-sync.sql` 不入仓库，跑完即留在 /tmp。

---

### Task 8：dev smoke 验证全套数据生效

**Files**：无代码改动，纯运行验证

- [ ] **Step 8.1：起 dev**

```bash
DATABASE_URL='postgresql://daixin:daixin88@127.0.0.1:5432/ls_new?schema=public' bun dev
```

- [ ] **Step 8.2：案件初分 7 模块顺序跑完**

URL 示例 `/dashboard/cases/init-analysis/<sessionId>` → 默认选 7 模块全跑

期望：
- 0 console error
- 7 模块顺序完成
- 后端日志 `[runAnalysisSubAgent] hasSkillsMw=true skillToolsCount=4` 出现 7 次

- [ ] **Step 8.3：抽查 1 个模块的 LLM 调用工具链**

任挑 1 个模块（如 trend）：后端 dev 日志应能看到 `tool: read_skill_file path=.deepagents/skills/panjue-qushi/...` 出现，证明 AI 真去读手册。

- [ ] **Step 8.4：模块对话验证（D4 顺路修复）**

进 `/dashboard/cases/<id>` → 打开 trend 模块对话面板 → 发一条消息 → 后端日志应显示该模块对话 `skillsCount=1`（只挂 panjue-qushi）→ 7 个模块各开一遍验证均按 1:1 挂载。

- [ ] **Step 8.5：小索对话验证**

同一 `/dashboard/cases/<id>` 页面 → 和小索发一条"读取证据策略手册告诉我证据三性是什么"的消息 → 后端日志应显示 `nodeName=caseMain skillsCount=14 skillToolsCount=4` → AI 调 read_skill_file 读取 zhengju-celue/SKILL.md 或相关文件 → 返回内容合理。

- [ ] **Step 8.6：法律助手 / 文书 / 合同审查回归**

各打开一次发一条消息，确认未受 stage 8 改造影响。

- [ ] **Step 8.7：kill dev server**

```bash
pkill -f 'bun.*dev' || true
```

---

### Task 9：用户人工抽样验证（用户自做）

> 阶段 8 不做自动化评分。Lead 配合提供"一键切换"机制方便对比。

- [ ] **Step 9.1：Lead 准备一键切换 SQL**

放 `/tmp/stage8-toggle.sql`（不入仓库）：

```sql
-- 临时切回旧版（某模块）
UPDATE nodes SET use_skills_as_logic = false WHERE name = '<module_name>';

-- 切到新版
UPDATE nodes SET use_skills_as_logic = true WHERE name = '<module_name>';
```

> 注：因 prompts 表只留新版 content（旧版已被覆盖），切回 false 仅标记位变化，实际跑出来的提示词还是新版。如果要真切回旧版需要 git checkout 旧 seedData.sql 重跑——这是阶段 8 的取舍代价（用户已确认）。

- [ ] **Step 9.2：用户挑 5-10 个真实案件人工对比**

由用户在 dev 环境里自行操作，可参考阶段 7 抽样验证流程。

- [ ] **Step 9.3：发现退化模块单独标记**

如有退化，Lead 协助记录改进 issue（不入 plan 范围）+ 决定是否真切回旧版（要 git revert 该模块 prompt 改动）。

---

### Task 10：阶段 8 全量回归 + tag

- [ ] **Step 10.1：跑全量 vitest**

Run: `npx vitest run`
Expected: 不引入新失败（接受 stage 6/7 遗留 6 个失败 + Task 4.4 新 skip 的 caseMainAgent / caseAgent 两套测试 + skipped 不变）

- [ ] **Step 10.2：跑 typecheck**

Run: `npx nuxi typecheck`
Expected: 0 新增错误（admin-layout.vue 残留 1 个不计）

- [ ] **Step 10.3：完整 E2E（chrome-devtools 真机）**

- `/dashboard/cases/init-analysis/[uuid]` 7 模块顺序跑完 + 中断恢复 + 充值恢复
- `/dashboard/cases/<id>` 小索浮窗 + 7 模块对话各开一遍
- `/dashboard/assistant`
- `/dashboard/document/drafts/<id>`
- `/dashboard/contract/<id>`
- 全 0 console error

- [ ] **Step 10.4：打 tag**

```bash
git tag ai-unify-stage-8-done
git push origin ai-unify-stage-8-done
```

- [ ] **Step 10.5：写 stage 8 收尾说明**

仿 `docs/superpowers/notes/2026-04-27-stage7-to-stage8-handoff.md` 写一份 `docs/superpowers/notes/2026-04-28-stage8-completion-notes.md`：列已完成、关键决策（删 runCaseChat、小索绑 14 本手册、不留旧版 prompt）、遗留 issue（Task 4.4 skip 测试待重写、stage 6/7 遗留 6 个失败、生产库 SQL 由用户处理）、阶段 8 沉淀机制（一键切换 SQL、build-prompts-sql.ts 模板）。

---

## 4. 风险与缓解

| 风险 | 级别 | 描述 | 缓解 |
|---|---|---|---|
| createAgent 子图与主图 streamMode 嵌套不兼容 | 高 | 主图 streamMode=['values','messages','updates']+subgraphs:true；子 agent 用 invoke（同步） | Task 1 设计已采用 invoke 而非 stream（与现有 inner graph.invoke 行为一致） |
| 中间件双重扣费 / 双重持久化 | 高 | 主图步骤 5d 持久化 + 步骤 6 扣分；子 agent 中间件栈故意不挂 pointConsumption / analysisResultPersistence | Task 1 注释已说明；Task 8 dev smoke 验证不双扣 |
| vertical 注册冲突导致启动失败 | 高 | legacy + 新 vertical 同时注册 (CASE, ANALYSIS) → agentRegistry.register 抛重复注册错 | Task 3 强制 3 文件同 commit；Step 3.4 dev smoke 验证 |
| 5 段式 prompt cache 失效 | 中 | 改造后若 systemContent 不再用 array 形式（Anthropic cache_control），prompt cache 命中率会跌 | Task 1 保留 cachedPromptToAnthropicContent 路径 |
| 提示词 escape 错误 | 中 | 提示词.md 含单引号 / 反斜杠 → SQL 字符串语法错 | Task 7.1 一次性脚本用 `replace(/'/g, "''")` 双写 + E'...' escape string |
| 生产库未同步 SQL | 高 | 用户手动跑生产库时遗漏 | Task 10.5 收尾说明明确"生产库 SQL 由用户处理 + 提供 /tmp/stage8-full-sync.sql 完整文件" |
| 测试库 schema 已就绪不同步 | 低 | use_skills_as_logic 列已应用（迁移 20260426064020），无 schema 变更 | 无需 prisma push |
| node_skills 外键依赖 skills 行 | 中 | fresh DB 跑 seedData 时 skills 表为空 → INSERT 外键失败 | 阶段 4/5/6 已存在同样模式（既然之前能跑通，本期沿用） |
| 提示词改造导致输出质量退化 | 高 | spec §7 风险 3 | Task 9 用户人工抽样；不留旧版 fallback 是用户已确认的取舍 |
| 删 runCaseChat 漏删依赖 import | 中 | 残留 unused import 让 typecheck 报 warning | Task 4.2 逐 import 核对 |

---

## 5. 自检清单

### 5.1 Spec 覆盖

- [x] **case-analysis 完成（StateGraph 形态保留）** → Task 3 vertical 化 + 主图保留
- [x] **各分析子模块支持 skills 配置** → Task 7 数据落地（7 模块各 1 本 skill）
- [x] **ReAct 子图共享 agent-platform 中间件管道（含 skillsMiddleware）** → Task 1/2 runAnalysisSubAgent
- [x] **提示词改造（"只写规范，不写做事方法"）** → Task 7（提示词.md 已是规范版）
- [x] **3-5 个分析模块配上 skills** → Task 7 全部 7 个（超额完成）
- [x] **节点配置加 useSkillsAsLogic 字段** → 已就绪，Task 7 切 true 仅作记录
- [x] **案件初分全 E2E：多模块顺序执行 + 中断 + 充值恢复 + 完成** → Task 10.3
- [x] **抽样 5-10 个真实案件做对比测试** → Task 9（用户自做）
- [x] **StateGraph 内部中间件挂载正确（通过测试用例验证）** → Task 1.1 单测

### 5.2 Placeholder Scan

- 所有代码块都是完整可执行内容（含 import / 函数体 / 类型）
- Task 7.2 的"逐行编辑 7 个 prompts content" 不是 placeholder，是 Task 7.1 自动生成内容的应用
- 无 "TBD" / "TODO" / "之后实现" 等占位词
- 待用户最终拍板的项已全部解决（v3 决策落定段）

### 5.3 Type Consistency

- `runAnalysisSubAgent / RunAnalysisSubAgentParams / RunAnalysisSubAgentResult` 在 Task 1 定义后 Task 2 一致引用
- `caseAnalysisAgent` 在 Task 3 定义后 agents-load.ts 直接 import 名称一致
- import 路径全部已通过 grep 核对：`createChatModel / cachedPromptToAnthropicContent / cachedPromptToPlainText` 来自 `~~/server/services/agent-platform/modelFactory`（re-export 自 chatModelFactory）；`createAgent / summarizationMiddleware` 来自 `langchain` 包；`MIDDLEWARE_PRIORITY / MIDDLEWARE_NAMES / buildMiddlewareStack` 来自 `~~/server/services/agent-platform/middleware/index`（透过 `./types` re-export）

---

## 6. 不在阶段 8 范围

- 主图 StateGraph 重写（spec §6 line 911 明确"StateGraph 形态保留"）
- 自动化 LLM-as-judge eval pipeline（用户决定后续阶段做）
- 案情可视化 / 诉讼策略等独立新模块（spec §3.5.6 line 473 仅举例，本期不新建）
- Task 4 标 skip 的 caseMainAgent.test.ts / caseAgent.test.ts 重写（保留作回归保护，后续清理）
- 节点删除时校验 vertical 引用（spec §7 风险 5）
- caseModule（agent 类型）节点的 node_skills 配置（DB 里 0 行——但模块对话用的是分析节点配置不是 caseModule，不影响功能）

---

## 7. 工程量估算

按本项目历史节奏（阶段 7：31 commit / 1.5 天）估算：

| Task | 工作量 | 是否阻塞主路径 |
|------|--------|---------------|
| 1 | 1 小时 | 是 |
| 2 | 1 小时 | 是 |
| 3 | 0.5 小时 | 是（同 commit 强约束） |
| 4 | 0.5 小时 | 否（独立路径，可与 6/7 并行） |
| 5 | 0.1 小时 | 否 |
| 6 | 0.5 小时 | 否 |
| 7 | 1 小时 | 是 |
| 8 | 0.5 小时 | 是 |
| 9 | （用户自做） | — |
| 10 | 1 小时 | 是 |

合计 Lead 工程量：5-6 小时；用户人工验证另计。

---

**计划撰写人**：Lead（Opus 4.7）
**v1**：2026-04-27（含 5 个待拍板决策点）
**v2**：2026-04-27（5 个决策已落定，转实施版；存在 7 处与现有代码不符）
**v3**：2026-04-28（按用户对齐补充：直接覆盖现有 prompt、删小索死代码 + 模块级单例、小索绑 14 本手册、Lead 同步 dev/testing 库、生产由用户处理；逐文件核对真实代码）
