# 案件创建功能实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现案件手动创建、AI 对话创建以及初始化分析工作流，包含完整的前后端逻辑。

**Architecture:** 前端新增创建页面（手动表单 + AI 对话）和初始化分析页面（模块选择 + Pipeline 进度）。后端新增初始化分析 LangGraph 工作流（循环节点串行执行 7 个分析 Agent）和提取 Agent API。复用现有 SSE + Redis 事件推送、OSS 上传、积分扣减中间件。

**Tech Stack:** Nuxt 4, Vue 3, ai-elements-vue, shadcn-vue, LangGraph, LangChain, Prisma, PostgreSQL, Redis

**Spec:** `docs/superpowers/specs/2026-03-26-case-creation-design.md`

---

## 文件结构

### 新建文件

```
# 数据模型
prisma/migrations/XXXXXX_add_case_session_type/migration.sql

# 后端 - 工作流
server/services/workflow/initAnalysis.workflow.ts    # 初始化分析 LangGraph 工作流
server/services/workflow/initAnalysis.state.ts       # 工作流 State 定义

# 后端 - API
server/api/v1/case/init-analysis.post.ts             # 初始化分析 SSE 端点
server/api/v1/case/init-analysis/status/[caseId].get.ts  # 分析状态查询
server/api/v1/case/extract.post.ts                   # AI 提取 Agent SSE 端点

# 后端 - 服务
server/services/case/initAnalysis.service.ts         # 初始化分析业务逻辑

# 前端 - 页面
app/pages/dashboard/cases/create.vue                 # 创建案件页
app/pages/dashboard/cases/init-analysis/[caseId].vue # 初始化分析页

# 前端 - 组件
app/components/caseCreation/ModeSelector.vue         # 模式选择卡片
app/components/caseCreation/ManualForm.vue           # 手动创建表单
app/components/caseCreation/AiChat.vue               # AI 对话创建
app/components/caseCreation/ExtractedInfoCard.vue    # 提取信息确认卡片
app/components/caseCreation/MaterialUploader.vue     # 材料拖拽上传
app/components/caseCreation/PartyInput.vue           # 当事人动态输入组
app/components/initAnalysis/ModuleSelector.vue       # 分析模块选择
app/components/initAnalysis/PipelineProgress.vue     # 进度条
app/components/initAnalysis/ModuleResult.vue         # 模块结果展示
app/components/initAnalysis/InsufficientPointsCard.vue # 积分不足购买卡片

# 前端 - Composables
app/composables/useCaseCreation.ts                   # 创建状态管理
app/composables/useInitAnalysis.ts                   # 初始化分析状态管理

# 共享类型
shared/types/initAnalysis.ts                         # 初始化分析相关类型

# 测试
tests/server/case/initAnalysis.service.test.ts
tests/server/case/initAnalysis.workflow.test.ts
tests/server/case/extract.api.test.ts
```

### 修改文件

```
prisma/models/case.prisma                            # caseSessions 新增 type 字段
app/pages/dashboard/cases.vue                        # 新增「创建案件」按钮
shared/types/case.ts                                 # 新增 ExtractedCaseInfo 类型
```

---

## Task 1: 数据模型变更

**Files:**
- Modify: `prisma/models/case.prisma`
- Test: 通过 `bun run prisma:generate` 和 `bun run prisma:migrate` 验证

- [ ] **Step 1: 修改 caseSessions 模型，新增 type 字段**

在 `prisma/models/case.prisma` 的 `caseSessions` 模型中，在 `status` 字段后新增：

```prisma
  /// 会话类型：1-普通对话，2-初始化分析
  type      Int       @default(1)
```

并在索引部分新增：

```prisma
  @@index([type], map: "idx_case_sessions_type")
```

- [ ] **Step 2: 生成 Prisma 客户端并创建迁移**

```bash
bun run prisma:generate
bun run prisma:migrate -- --name add_case_session_type
```

Expected: 迁移成功，新增 `type` 列，默认值为 1

- [ ] **Step 3: 验证/创建 nodes 表种子数据**

确保 nodes 表中存在以下 8 个节点配置（通过 Prisma Studio 或 seed 脚本）：

| name | title | type |
|------|-------|------|
| extract_info | 信息提取 | extraction |
| summary | 生成案件概要 | analysis |
| chronicle | 提取案件大事记 | analysis |
| claim | 预分析案件请求权 | analysis |
| trend | 判决趋势预测 | analysis |
| cause | 预选案由 | analysis |
| defense | 抗辩分析及应对策略预测 | analysis |
| evidence | 证据清单预梳理 | analysis |

每个节点需配置：modelId（关联可用模型）、至少一条 status=1 的 system prompt、tools（可选）、outputSchema（extract_info 必须配置以支持结构化输出）。

如果部分节点已存在，跳过。如果不存在，创建 seed 文件 `prisma/seeds/initAnalysisNodes.ts` 添加种子数据，并通过 `bun run prisma:seed` 执行。

- [ ] **Step 4: Commit**

---

## Task 2: 共享类型定义

**Files:**
- Modify: `shared/types/case.ts`
- Create: `shared/types/initAnalysis.ts`

- [ ] **Step 1: 在 shared/types/case.ts 中新增 ExtractedCaseInfo**

在现有 `ExtractedCaseInfo` 接口附近确认是否已存在（现有工作流的 state.ts 中有引用），如果不在 `shared/types/case.ts` 中则添加：

```typescript
export interface ExtractedCaseInfo {
  title: string
  plaintiff: string[]
  defendant: string[]
  caseType: string
  summary: string
}
```

- [ ] **Step 2: 创建 shared/types/initAnalysis.ts**

```typescript
/** 分析模块定义 */
export interface AnalysisModule {
  name: string
  title: string
  description: string
  icon: string
}

/** 模块执行状态 */
export type ModuleStatus = 'idle' | 'streaming' | 'complete' | 'failed' | 'interrupted'

/** 初始化分析模块固定顺序 */
export const INIT_ANALYSIS_MODULES: AnalysisModule[] = [
  { name: 'summary', title: '生成案件概要', description: '基于案件材料生成结构化案件概要', icon: 'FileText' },
  { name: 'chronicle', title: '提取案件大事记', description: '按时间线提取案件关键事件', icon: 'Calendar' },
  { name: 'claim', title: '预分析案件请求权', description: '分析案件可能的请求权基础', icon: 'Scale' },
  { name: 'trend', title: '判决趋势预测', description: '基于类案数据预测判决趋势', icon: 'TrendingUp' },
  { name: 'cause', title: '预选案由', description: '推荐适用的案由分类', icon: 'Tag' },
  { name: 'defense', title: '抗辩分析及应对策略预测', description: '预测对方抗辩策略并制定应对方案', icon: 'Shield' },
  { name: 'evidence', title: '证据清单预梳理', description: '梳理需要准备的证据清单', icon: 'ClipboardList' },
]

/** 有效模块名列表 */
export const VALID_MODULE_NAMES = INIT_ANALYSIS_MODULES.map(m => m.name)

/** 默认选中的模块 */
export const DEFAULT_SELECTED_MODULES = ['summary', 'chronicle']

/** 模块运行时状态 */
export interface ModuleRunState {
  name: string
  status: ModuleStatus
  content: string
  error?: string
}

/** SSE 事件类型 */
export type InitAnalysisEventType =
  | 'module_start'
  | 'module_streaming'
  | 'module_complete'
  | 'module_failed'
  | 'analysis_complete'
  | 'interrupt'
  | 'resume'

/** 初始化分析状态响应 */
export interface InitAnalysisStatusResponse {
  status: 'not_started' | 'in_progress' | 'completed' | 'failed'
  sessionId?: string
  modules: Array<{
    name: string
    status: 'idle' | 'complete' | 'failed'
    result?: string
  }>
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/types/
git commit -m "feat(types): 新增初始化分析相关类型定义"
```

---

## Task 3: 初始化分析后端服务

**Files:**
- Create: `server/services/case/initAnalysis.service.ts`
- Test: `tests/server/case/initAnalysis.service.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/server/case/initAnalysis.service.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 测试目标函数将在 Step 3 实现
// 这里先定义测试用例骨架

describe('initAnalysis.service', () => {
  describe('validateInitAnalysisInput', () => {
    it('应拒绝空的 selectedModules', async () => {
      // 传入空数组 → 抛出错误
    })

    it('应拒绝非法模块名', async () => {
      // 传入 ['invalid_module'] → 抛出错误
    })

    it('应接受合法模块名并按固定顺序排列', async () => {
      // 传入 ['evidence', 'summary'] → 返回 ['summary', 'evidence']
    })
  })

  describe('getInitAnalysisStatus', () => {
    it('未开始时返回 not_started', async () => {
      // 无 type=2 的 session → status: 'not_started'
    })

    it('进行中时返回 in_progress 和 sessionId', async () => {
      // 有 type=2 且 status=1 的 session → status: 'in_progress'
    })

    it('已完成时返回各模块结果', async () => {
      // 有 type=2 且 status=2 的 session + caseAnalyses → 返回结果摘要
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/server/case/initAnalysis.service.test.ts --reporter=verbose
```

Expected: FAIL - 模块未找到

- [ ] **Step 3: 实现 initAnalysis.service.ts**

创建 `server/services/case/initAnalysis.service.ts`：

```typescript
import { VALID_MODULE_NAMES, INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { InitAnalysisStatusResponse } from '#shared/types/initAnalysis'

/**
 * 验证并排序选中的模块
 * 确保模块名合法，并按固定顺序排列
 */
export function validateAndSortModules(selectedModules: string[]): string[] {
  if (!selectedModules.length) {
    throw createError({ statusCode: 400, message: '请至少选择一个分析模块' })
  }

  const invalid = selectedModules.filter(m => !VALID_MODULE_NAMES.includes(m))
  if (invalid.length) {
    throw createError({ statusCode: 400, message: `无效的分析模块: ${invalid.join(', ')}` })
  }

  // 按固定顺序排列
  return VALID_MODULE_NAMES.filter(m => selectedModules.includes(m))
}

/**
 * 获取案件的初始化分析状态
 */
export async function getInitAnalysisStatusService(
  caseId: number,
  userId: number,
): Promise<InitAnalysisStatusResponse> {
  // 验证案件权限
  const caseRecord = await prisma.cases.findFirst({
    where: { id: caseId, userId, deletedAt: null },
  })
  if (!caseRecord) {
    throw createError({ statusCode: 404, message: '案件不存在' })
  }

  // 查找初始化分析 session
  const session = await prisma.caseSessions.findFirst({
    where: { caseId, type: 2, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  if (!session) {
    return { status: 'not_started', modules: [] }
  }

  // 获取分析结果
  const analyses = await prisma.caseAnalyses.findMany({
    where: { sessionId: session.sessionId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })

  const modules = INIT_ANALYSIS_MODULES.map(m => {
    const analysis = analyses.find(a => a.analysisType === m.name)
    return {
      name: m.name,
      status: !analysis ? 'idle' as const
        : analysis.status === 2 ? 'complete' as const
        : analysis.status === 3 ? 'failed' as const
        : 'idle' as const,
      result: analysis?.analysisResult ?? undefined,
    }
  })

  const sessionStatus = session.status === 1 ? 'in_progress' as const
    : session.status === 2 ? 'completed' as const
    : 'failed' as const

  return {
    status: sessionStatus,
    sessionId: session.sessionId,
    modules,
  }
}

/**
 * 从已有的 caseAnalyses 加载已完成模块的结果
 * 用于重试失败模块时注入上下文
 */
export async function loadCompletedResultsService(
  caseId: number,
): Promise<Record<string, string>> {
  const analyses = await prisma.caseAnalyses.findMany({
    where: { caseId, status: 2, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    distinct: ['analysisType'],
  })

  const results: Record<string, string> = {}
  for (const a of analyses) {
    results[a.analysisType] = a.analysisResult ?? ''
  }
  return results
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/server/case/initAnalysis.service.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/case/initAnalysis.service.ts tests/server/case/initAnalysis.service.test.ts
git commit -m "feat(analysis): 实现初始化分析服务层"
```

---

## Task 4: 初始化分析 LangGraph 工作流

**Files:**
- Create: `server/services/workflow/initAnalysis.state.ts`
- Create: `server/services/workflow/initAnalysis.workflow.ts`
- Test: `tests/server/case/initAnalysis.workflow.test.ts`
- Reference: `server/services/workflow/caseAnalysis.workflow.ts`（图结构模式）, `server/services/agent/caseAnalysis.ts`（Agent 调用模式）

- [ ] **Step 1: 创建 State 定义**

创建 `server/services/workflow/initAnalysis.state.ts`：

```typescript
import { Annotation } from '@langchain/langgraph'
import { messagesStateReducer, type BaseMessage } from '@langchain/core/messages'

function replaceReducer<T>(existing: T, updated: T): T {
  return updated
}

function mergeRecordReducer(
  existing: Record<string, string>,
  updated: Record<string, string>,
): Record<string, string> {
  return { ...existing, ...updated }
}

export const InitAnalysisAnnotation = Annotation.Root({
  // 消息历史（用于 Agent 对话）
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // 标识
  userId: Annotation<number>,
  caseId: Annotation<number>,
  sessionId: Annotation<string>,

  // 模块配置
  selectedModules: Annotation<string[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  currentModuleIndex: Annotation<number>({
    reducer: replaceReducer,
    default: () => 0,
  }),

  // 结果累积（后续模块可引用前面结果）
  completedResults: Annotation<Record<string, string>>({
    reducer: mergeRecordReducer,
    default: () => ({}),
  }),
  failedModules: Annotation<Record<string, string>>({
    reducer: mergeRecordReducer,
    default: () => ({}),
  }),

  // 当前模块名（前端用于 Progress Bar）
  currentModule: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),

  // 控制
  isComplete: Annotation<boolean>({
    reducer: replaceReducer,
    default: () => false,
  }),
  error: Annotation<string | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
})

export type InitAnalysisState = typeof InitAnalysisAnnotation.State
```

- [ ] **Step 2: 创建工作流**

创建 `server/services/workflow/initAnalysis.workflow.ts`：

```typescript
import { createAgent, type ReactAgent } from 'langchain'
import { StateGraph } from '@langchain/langgraph'
import { InitAnalysisAnnotation, type InitAnalysisState } from './initAnalysis.state'
import { getCheckpointer, getStore } from './checkpointer'
import { getValidNodeConfig } from '../node/nodeConfig.service'
import { createChatModel } from '../node/chatModelFactory'
import { getToolInstancesService } from './tools'
import { pointConsumptionMiddleware } from './middleware/pointConsumption.middleware'
import { caseMaterialContextMiddleware } from './middleware/caseMaterialContext.middleware'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { saveAnalysisResultService, startAnalysisService } from '../case/analysis.service'
import { publishAgentEvent } from '../agent/agentEventBridge'

const EXECUTE_MODULE_NODE = 'execute_module'

/**
 * 核心执行节点：串行执行当前模块的分析 Agent
 */
async function executeModuleNode(state: InitAnalysisState): Promise<Partial<InitAnalysisState>> {
  const { selectedModules, currentModuleIndex, completedResults, userId, caseId, sessionId } = state
  const moduleName = selectedModules[currentModuleIndex]

  if (!moduleName) {
    return { isComplete: true }
  }

  // 发送 module_start 事件
  // （实际事件通过 agentEventBridge 发布，此处通过 state 更新触发前端感知）

  try {
    // 1. 加载节点配置
    const nodeConfig = await getValidNodeConfig(moduleName, `分析模块: ${moduleName}`)
    const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)
    if (!activeApiKey) {
      throw new Error(`模块 ${moduleName} 无可用 API 密钥`)
    }

    // 2. 创建模型
    const model = createChatModel({
      sdkType: nodeConfig.modelSdkType,
      modelName: nodeConfig.modelName,
      apiKey: activeApiKey.apiKey,
      baseUrl: nodeConfig.modelProviderBaseUrl,
      temperature: 0.7,
      streaming: true,
    })

    // 3. 加载工具
    const tools = nodeConfig.tools?.length > 0
      ? getToolInstancesService(nodeConfig.tools, { userId, caseId, sessionId })
      : []

    // 4. 构建系统提示（注入已完成模块结果）
    const systemPrompt = nodeConfig.prompts?.find((p: any) => p.type === 'system' && p.status === 1)?.content ?? ''
    const contextPrefix = Object.keys(completedResults).length > 0
      ? `以下是已完成的分析结果，请参考：\n\n${Object.entries(completedResults).map(([k, v]) => `### ${k}\n${v}`).join('\n\n')}\n\n---\n\n`
      : ''

    // 5. 标记分析开始
    await startAnalysisService({
      caseId,
      sessionId,
      nodeId: nodeConfig.id,
      analysisType: moduleName,
    })

    // 6. 调用 Agent（复用 caseAnalysis.ts 的完整模式）
    const [checkpointer, store] = await Promise.all([getCheckpointer(), getStore()])
    const agent: ReactAgent = createAgent({
      model,
      systemPrompt: contextPrefix + systemPrompt,
      checkpointer,
      tools,
      store,
      middleware: [
        pointConsumptionMiddleware(userId, 'case_analysis_token'),
        caseMaterialContextMiddleware(userId, caseId),
      ],
    })

    // 7. 执行并收集结果
    let result = ''
    const stream = await agent.stream(
      { messages: [new HumanMessage('请执行分析')] },
      { configurable: { thread_id: `${sessionId}_${moduleName}` }, streamMode: ['values', 'messages'] },
    )

    for await (const chunk of stream) {
      // 流式处理，结果累积
      if (chunk.messages) {
        const lastMsg = chunk.messages[chunk.messages.length - 1]
        if (lastMsg?.content && typeof lastMsg.content === 'string') {
          result = lastMsg.content
        }
      }
    }

    // 8. 保存分析结果
    await saveAnalysisResultService({
      caseId,
      sessionId,
      nodeId: nodeConfig.id,
      analysisType: moduleName,
      analysisResult: result,
      status: 2, // 已完成
    })

    return {
      currentModule: moduleName,
      currentModuleIndex: currentModuleIndex + 1,
      completedResults: { [moduleName]: result },
    }
  }
  catch (error: any) {
    // 失败不阻塞后续模块
    return {
      currentModule: moduleName,
      currentModuleIndex: currentModuleIndex + 1,
      failedModules: { [moduleName]: error.message ?? '未知错误' },
    }
  }
}

/**
 * 路由：判断是否还有下一个模块
 */
function routeAfterExecute(state: InitAnalysisState): string {
  if (state.isComplete || state.currentModuleIndex >= state.selectedModules.length) {
    return '__end__'
  }
  return EXECUTE_MODULE_NODE
}

/**
 * 获取编译后的工作流（单例）
 */
let workflowInstance: any = null

export async function getInitAnalysisWorkflow() {
  if (workflowInstance) return workflowInstance

  const checkpointer = await getCheckpointer()

  const graph = new StateGraph(InitAnalysisAnnotation)
    .addNode(EXECUTE_MODULE_NODE, executeModuleNode)
    .addEdge('__start__', EXECUTE_MODULE_NODE)
    .addConditionalEdges(EXECUTE_MODULE_NODE, routeAfterExecute, [EXECUTE_MODULE_NODE, '__end__'])

  workflowInstance = graph.compile({ checkpointer })
  return workflowInstance
}

/**
 * 启动初始化分析
 */
export async function startInitAnalysis(params: {
  caseId: number
  sessionId: string
  userId: number
  selectedModules: string[]
  completedResults?: Record<string, string>
}) {
  const workflow = await getInitAnalysisWorkflow()

  return workflow.stream(
    {
      userId: params.userId,
      caseId: params.caseId,
      sessionId: params.sessionId,
      selectedModules: params.selectedModules,
      currentModuleIndex: 0,
      completedResults: params.completedResults ?? {},
      currentModule: params.selectedModules[0],
    },
    {
      configurable: { thread_id: params.sessionId },
      streamMode: ['values', 'messages'],
    },
  )
}
```

> **注意**：以上代码是骨架，实际实现时需参考 `caseAnalysis.ts` 和 `caseAnalysis.workflow.ts` 的模式调整 Agent 创建和流式处理细节。积分不足中断（interrupt）逻辑由 `pointConsumptionMiddleware` 内部处理。

- [ ] **Step 3: 编写工作流测试**

创建 `tests/server/case/initAnalysis.workflow.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'

describe('initAnalysis.workflow', () => {
  describe('routeAfterExecute', () => {
    it('当 currentModuleIndex < selectedModules.length 时路由回 execute_module', () => {
      // ...
    })

    it('当 currentModuleIndex >= selectedModules.length 时路由到 __end__', () => {
      // ...
    })

    it('当 isComplete 为 true 时路由到 __end__', () => {
      // ...
    })
  })

  describe('executeModuleNode', () => {
    it('成功执行模块后递增 currentModuleIndex', async () => {
      // mock nodeConfig, model, agent
    })

    it('模块失败时记录到 failedModules 并继续', async () => {
      // mock agent 抛出错误
    })

    it('注入 completedResults 到系统提示', async () => {
      // 验证 systemPrompt 包含前面模块的结果
    })
  })
})
```

- [ ] **Step 4: 运行测试**

```bash
npx vitest run tests/server/case/initAnalysis.workflow.test.ts --reporter=verbose
```

- [ ] **Step 5: Commit**

```bash
git add server/services/workflow/initAnalysis.state.ts server/services/workflow/initAnalysis.workflow.ts tests/server/case/initAnalysis.workflow.test.ts
git commit -m "feat(analysis): 实现初始化分析 LangGraph 工作流"
```

---

## Task 5: 后端 API 端点

**Files:**
- Create: `server/api/v1/case/init-analysis.post.ts`
- Create: `server/api/v1/case/init-analysis/status/[caseId].get.ts`
- Create: `server/api/v1/case/extract.post.ts`
- Reference: `server/api/v1/case/analysis/chat.post.ts`（SSE 模式）, `server/api/v1/case/create.post.ts`（验证模式）

- [ ] **Step 1: 创建初始化分析 SSE 端点**

创建 `server/api/v1/case/init-analysis.post.ts`，骨架代码：

```typescript
import { z } from 'zod'
import { validateAndSortModules, loadCompletedResultsService } from '~~/server/services/case/initAnalysis.service'
import { validateCaseAccessService } from '~~/server/services/case/case.service'
import { enqueueRunService, getActiveRunService } from '~~/server/services/agent/agentRun.service'
import { replayEvents, createEventSubscription } from '~~/server/services/agent/agentEventBridge'
import { checkPointsService } from '~~/server/services/point/pointConsumption.service'
import { VALID_MODULE_NAMES } from '#shared/types/initAnalysis'
import { v7 as uuidv7 } from 'uuid'

const schema = z.object({
  caseId: z.number().int().positive(),
  selectedModules: z.array(z.string()).min(1),
})

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, '请先登录', 401)

  // 1. 解析 body（支持直连和 FetchStreamTransport 两种格式）
  const body = await readBody(event)
  // FetchStreamTransport: body.config.configurable 中包含参数
  // 直连: body 即参数
  const params = body?.config?.configurable ?? body
  const parsed = schema.safeParse(params)
  if (!parsed.success) return resError(event, parsed.error.message, 400)

  const { caseId, selectedModules: rawModules } = parsed.data

  // 2. 验证模块名并排序
  const selectedModules = validateAndSortModules(rawModules)

  // 3. 验证案件权限
  await validateCaseAccessService(caseId, user.id)

  // 4. 前置积分/会员校验
  const pointCheck = await checkPointsService(user.id, 'case_analysis_token', 100) // 最低保底
  if (!pointCheck.sufficient) {
    return resError(event, '积分不足，请先充值', 402)
  }

  // 5. 检查是否有活跃的初始化分析 session（重连逻辑）
  const existingSession = await prisma.caseSessions.findFirst({
    where: { caseId, type: 2, status: 1, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  let sessionId: string
  let runId: string
  let isReconnect = false

  if (existingSession) {
    sessionId = existingSession.sessionId
    const activeRun = await getActiveRunService(sessionId)
    if (activeRun) {
      runId = activeRun.id
      isReconnect = true
    } else {
      // session 存在但 run 已结束，创建新 run
      const result = await enqueueRunService({
        sessionId, threadId: sessionId, userId: user.id, caseId,
        input: { selectedModules },
      })
      if ('error' in result) return resError(event, result.error, 429)
      runId = result.runId
    }
  } else {
    // 6. 创建新 session + 入队 run
    sessionId = uuidv7()
    await prisma.caseSessions.create({
      data: { sessionId, caseId, type: 2, status: 1 },
    })

    // 加载已有结果（重试场景）
    const completedResults = await loadCompletedResultsService(caseId)

    const result = await enqueueRunService({
      sessionId, threadId: sessionId, userId: user.id, caseId,
      input: { selectedModules, completedResults },
    })
    if ('error' in result) return resError(event, result.error, 429)
    runId = result.runId
  }

  // 7. 建立 SSE 响应流（参考 chat.post.ts）
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const abortController = new AbortController()
  event.node.req.on('close', () => abortController.abort())

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (eventName: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // 补发缺失事件
        const missedEvents = await replayEvents(runId)
        for (const evt of missedEvents) {
          send(evt.event, evt.data)
        }

        // 检查是否已终结
        // ...

        // 订阅实时事件
        const keepaliveInterval = setInterval(() => {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }, 15_000)

        try {
          for await (const evt of createEventSubscription(runId, abortController.signal)) {
            send(evt.event, evt.data)
            // 终结状态检查 break
          }
        } finally {
          clearInterval(keepaliveInterval)
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          send('error', { message: String(err) })
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
})
```

> **关键**：Worker 端执行 `startInitAnalysis` 时，需通过 `publishAgentEvent` 发布 `module_start`、`module_streaming`、`module_complete`、`module_failed`、`analysis_complete` 等事件到 Redis，SSE 端点通过 `createEventSubscription` 订阅并推送给前端。

- [ ] **Step 2: 创建状态查询端点**

创建 `server/api/v1/case/init-analysis/status/[caseId].get.ts`：

```typescript
export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, '请先登录', 401)

  const caseId = Number(getRouterParam(event, 'caseId'))
  if (!caseId || isNaN(caseId)) return resError(event, '无效的案件ID', 400)

  const status = await getInitAnalysisStatusService(caseId, user.id)
  return resSuccess(event, '获取成功', status)
})
```

- [ ] **Step 3: 创建提取 Agent SSE 端点**

创建 `server/api/v1/case/extract.post.ts`，骨架代码：

```typescript
import { z } from 'zod'
import { getValidNodeConfig } from '~~/server/services/node/nodeConfig.service'
import { createChatModel } from '~~/server/services/node/chatModelFactory'
import { HumanMessage } from '@langchain/core/messages'

const EXTRACT_NODE_NAME = 'extract_info'

const schema = z.object({
  message: z.string().min(1),
  materials: z.array(z.object({
    ossFileId: z.number().int().positive(),
    name: z.string(),
  })).optional(),
})

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, '请先登录', 401)

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return resError(event, parsed.error.message, 400)

  const { message, materials } = parsed.data

  // 1. 加载 extract_info 节点配置（含 outputSchema 用于结构化输出）
  const nodeConfig = await getValidNodeConfig(EXTRACT_NODE_NAME, '信息提取')
  const activeApiKey = nodeConfig.modelApiKeys.find((k: any) => k.status === 1)

  // 2. 创建模型（支持结构化输出）
  const model = createChatModel({
    sdkType: nodeConfig.modelSdkType,
    modelName: nodeConfig.modelName,
    apiKey: activeApiKey.apiKey,
    baseUrl: nodeConfig.modelProviderBaseUrl,
    temperature: 0.3,  // 提取任务用低温度
    streaming: true,
  })

  // 3. 如果节点配置了 outputSchema，使用 withStructuredOutput
  const structuredModel = nodeConfig.outputSchema
    ? model.withStructuredOutput(nodeConfig.outputSchema)
    : model

  // 4. 构建提示（注入材料信息）
  const systemPrompt = nodeConfig.prompts?.find((p: any) => p.type === 'system' && p.status === 1)?.content ?? ''
  const materialContext = materials?.length
    ? `\n\n用户上传的材料：\n${materials.map(m => `- ${m.name} (ossFileId: ${m.ossFileId})`).join('\n')}`
    : ''

  // 5. 调用模型并流式返回
  // 如果使用 structuredOutput，最终结果是 ExtractedCaseInfo 对象
  // 通过 SSE 推送中间流式内容和最终结构化结果
  // SSE 事件：
  //   event: streaming, data: { content: "..." }        // 流式文本
  //   event: extracted, data: { ...ExtractedCaseInfo }   // 最终结构化结果

  // ... SSE 响应流建立（同 init-analysis.post.ts 模式）
})
```

> **关键**：`extract_info` 节点必须在 nodes 表中配置 `outputSchema`（JSON Schema 格式），对应 `ExtractedCaseInfo` 的结构。`withStructuredOutput` 确保 Agent 返回严格符合 schema 的 JSON。

- [ ] **Step 4: Commit**

```bash
git add server/api/v1/case/init-analysis.post.ts server/api/v1/case/init-analysis/ server/api/v1/case/extract.post.ts
git commit -m "feat(api): 新增初始化分析和提取 Agent API 端点"
```

---

## Task 6: 前端 - 共享组件（材料上传 + 当事人输入）

**Files:**
- Create: `app/components/caseCreation/MaterialUploader.vue`
- Create: `app/components/caseCreation/PartyInput.vue`
- Reference: `app/components/caseAnalysis/promptInput.vue`（OSS 上传模式）

- [ ] **Step 1: 创建 MaterialUploader 组件**

`app/components/caseCreation/MaterialUploader.vue`：

Props:
```typescript
interface Props {
  modelValue: OssFileItem[]  // v-model 绑定
  accept?: string
  maxFiles?: number
  maxFileSize?: number
}
```

核心功能：
- 大面积拖拽区域（使用 `useDropZone`）
- 点击上传按钮
- 文件列表展示（文件名、大小、上传进度、删除按钮）
- 复用现有 OSS 签名上传逻辑：`fileStore.getBatchPresignedUrls()` → `uploadToOSS()`
- 上传完成后 emit `update:modelValue`

参考 `promptInput.vue` 中的文件拖拽上传实现。

- [ ] **Step 2: 创建 PartyInput 组件**

`app/components/caseCreation/PartyInput.vue`：

Props:
```typescript
interface Props {
  modelValue: string[]  // v-model 绑定
  label: string         // "原告" 或 "被告"
  placeholder?: string
}
```

核心功能：
- 显示当事人列表，每项有输入框 + 删除按钮
- 底部「添加」按钮，新增空输入项
- 至少保留一个空输入项
- 使用 shadcn-vue 的 `Input` + `Button` 组件

- [ ] **Step 3: Commit**

```bash
git add app/components/caseCreation/MaterialUploader.vue app/components/caseCreation/PartyInput.vue
git commit -m "feat(ui): 创建材料上传和当事人输入组件"
```

---

## Task 7: 前端 - 创建案件页面

**Files:**
- Create: `app/pages/dashboard/cases/create.vue`
- Create: `app/components/caseCreation/ModeSelector.vue`
- Create: `app/components/caseCreation/ManualForm.vue`
- Create: `app/components/caseCreation/AiChat.vue`
- Create: `app/components/caseCreation/ExtractedInfoCard.vue`
- Create: `app/composables/useCaseCreation.ts`
- Modify: `app/pages/dashboard/cases.vue`（新增「创建案件」按钮）

- [ ] **Step 1: 创建 useCaseCreation composable**

`app/composables/useCaseCreation.ts`：

```typescript
export function useCaseCreation() {
  const mode = ref<'select' | 'manual' | 'ai'>('select')
  const isSubmitting = ref(false)
  const caseTypes = ref<CaseType[]>([])

  // 加载案件类型
  async function loadCaseTypes() {
    const data = await useApiFetch('/api/v1/case-types')
    caseTypes.value = data?.list ?? []
  }

  // 提交创建案件
  async function createCase(params: {
    caseTypeId: number
    title?: string
    plaintiff?: string[]
    defendant?: string[]
    content?: string
    materials?: CaseMaterialParam[]
  }) {
    isSubmitting.value = true
    try {
      const data = await useApiFetch('/api/v1/case/create', {
        method: 'POST',
        body: params,
      })
      if (data?.caseId) {
        await navigateTo(`/dashboard/cases/init-analysis/${data.caseId}`)
      }
    }
    finally {
      isSubmitting.value = false
    }
  }

  return { mode, isSubmitting, caseTypes, loadCaseTypes, createCase }
}
```

- [ ] **Step 2: 创建 ModeSelector 组件**

`app/components/caseCreation/ModeSelector.vue`：

向导式引导卡片，两张大卡片：手动创建 / AI 智能创建。
- 使用 `motion-v` 做 hover 动效
- 点击后 emit `select` 事件
- 响应式：桌面端并排，移动端堆叠

- [ ] **Step 3: 创建 ManualForm 组件**

`app/components/caseCreation/ManualForm.vue`：

居中单列表单：
- 案件类型 Select（必填）
- 案件标题 Input
- PartyInput × 2（原告/被告）
- 案件描述 Textarea
- MaterialUploader
- 提交按钮

使用 shadcn-vue 的 `Select`、`Input`、`Textarea`、`Button` 组件。

- [ ] **Step 4: 创建 AiChat 组件**

`app/components/caseCreation/AiChat.vue`：

复用 ai-elements-vue 对话组件：
- `AiElementsConversation` + `AiElementsConversationContent`
- 消息列表渲染（HumanMessage / AIMessage）
- `CaseAnalysisPromptInput` 输入框
- 使用 `useStream` 连接 `POST /api/v1/case/extract`
- Agent 返回的结构化数据用 `ExtractedInfoCard` 渲染

- [ ] **Step 5: 创建 ExtractedInfoCard 组件**

`app/components/caseCreation/ExtractedInfoCard.vue`：

Props:
```typescript
interface Props {
  extractedInfo: ExtractedCaseInfo
  caseTypes: CaseType[]
}
```

嵌入对话流中的可编辑卡片：
- 案件类型下拉选择
- 案件标题可编辑
- 原告/被告列表可编辑增删（复用 PartyInput）
- 案件摘要可编辑
- 「确认并创建案件」按钮

- [ ] **Step 6: 创建 create.vue 页面**

`app/pages/dashboard/cases/create.vue`：

组装所有子组件：
- 初始态：ModeSelector
- 选择后：顶部 segmented control + ManualForm 或 AiChat
- 使用 `Transition` 做模式切换动画

- [ ] **Step 7: 修改案件列表页**

在 `app/pages/dashboard/cases.vue` 的操作区域新增「创建案件」按钮：

```vue
<Button @click="navigateTo('/dashboard/cases/create')">
  <PlusIcon class="size-4 mr-2" />
  创建案件
</Button>
```

- [ ] **Step 8: Commit**

```bash
git add app/pages/dashboard/cases/create.vue app/components/caseCreation/ app/composables/useCaseCreation.ts app/pages/dashboard/cases.vue
git commit -m "feat(ui): 实现案件创建页面（手动 + AI 对话模式）"
```

---

## Task 8: 前端 - 初始化分析页面

**Files:**
- Create: `app/pages/dashboard/cases/init-analysis/[caseId].vue`
- Create: `app/components/initAnalysis/ModuleSelector.vue`
- Create: `app/components/initAnalysis/PipelineProgress.vue`
- Create: `app/components/initAnalysis/ModuleResult.vue`
- Create: `app/components/initAnalysis/InsufficientPointsCard.vue`
- Create: `app/composables/useInitAnalysis.ts`

- [ ] **Step 1: 创建 useInitAnalysis composable**

`app/composables/useInitAnalysis.ts`：

```typescript
import type { ModuleRunState, InitAnalysisStatusResponse } from '#shared/types/initAnalysis'
import { INIT_ANALYSIS_MODULES, DEFAULT_SELECTED_MODULES } from '#shared/types/initAnalysis'

export function useInitAnalysis(caseId: Ref<number>) {
  const phase = ref<'select' | 'running' | 'complete'>('select')
  const selectedModules = ref<string[]>([...DEFAULT_SELECTED_MODULES])
  const moduleStates = reactive<Map<string, ModuleRunState>>(new Map())
  const isStarting = ref(false)
  const interrupt = ref<any>(null)

  // 加载已有状态（页面刷新恢复）
  async function loadStatus() {
    const status = await useApiFetch<InitAnalysisStatusResponse>(
      `/api/v1/case/init-analysis/status/${caseId.value}`,
    )
    if (status?.status === 'in_progress' || status?.status === 'completed') {
      phase.value = status.status === 'completed' ? 'complete' : 'running'
      // 恢复各模块状态
      for (const m of status.modules) {
        moduleStates.set(m.name, {
          name: m.name,
          status: m.status === 'complete' ? 'complete' : m.status === 'failed' ? 'failed' : 'idle',
          content: m.result ?? '',
        })
      }
    }
  }

  // 启动分析（连接 SSE）
  async function startAnalysis() { /* ... useStream 连接 */ }

  // 恢复工作流（积分不足后购买完成）
  async function resumeWorkflow() { /* ... */ }

  return {
    phase, selectedModules, moduleStates, isStarting, interrupt,
    loadStatus, startAnalysis, resumeWorkflow,
  }
}
```

- [ ] **Step 2: 创建 ModuleSelector 组件**

`app/components/initAnalysis/ModuleSelector.vue`：

模块选择网格：
- 使用 `INIT_ANALYSIS_MODULES` 渲染卡片
- 每张卡片：图标 + 标题 + 描述 + checkbox
- v-model 绑定 `selectedModules`
- 默认选中 summary + chronicle
- 底部：开始分析按钮 + 跳过链接
- 响应式：桌面端 2-3 列网格，移动端单列

- [ ] **Step 3: 创建 PipelineProgress 组件**

`app/components/initAnalysis/PipelineProgress.vue`：

Props:
```typescript
interface Props {
  modules: Array<{ name: string; title: string }>
  moduleStates: Map<string, ModuleRunState>
}
```

水平进度条：
- 每个模块一个圆角 pill，模块间连线
- 状态色：灰色(idle) / 蓝色脉动(streaming) / 绿色(complete) / 红色(failed)
- 点击 pill 滚动到对应 `#module-${name}` 锚点
- 移动端横向滚动（`overflow-x-auto`）
- `position: sticky; top: 0` 固定在顶部

- [ ] **Step 4: 创建 ModuleResult 组件**

`app/components/initAnalysis/ModuleResult.vue`：

Props:
```typescript
interface Props {
  module: AnalysisModule
  state: ModuleRunState
}
```

单个模块结果区域：
- `id="module-${module.name}"` 锚点
- 头部：模块图标 + 名称 + 状态 badge
- 内容区：
  - idle: 灰色占位
  - streaming: `AiElementsMessageResponse` 实时渲染 Markdown
  - complete: 完整 Markdown 结果
  - failed: 错误信息 + 重试按钮

- [ ] **Step 5: 创建 InsufficientPointsCard 组件**

`app/components/initAnalysis/InsufficientPointsCard.vue`：

复用现有 `InsufficientPointsHandler.vue` 的模式：
- 显示积分余额 / 所需积分
- 积分购买链接
- 会员升级入口
- 「继续分析」按钮（购买完成后点击）

- [ ] **Step 6: 创建初始化分析页面**

`app/pages/dashboard/cases/init-analysis/[caseId].vue`：

```vue
<script setup lang="ts">
const route = useRoute()
const caseId = computed(() => Number(route.params.caseId))
const { phase, selectedModules, moduleStates, ... } = useInitAnalysis(caseId)

onMounted(() => loadStatus())
</script>

<template>
  <!-- 阶段一：模块选择 -->
  <ModuleSelector v-if="phase === 'select'" v-model="selectedModules" @start="startAnalysis" />

  <!-- 阶段二：Pipeline 进度 -->
  <template v-else>
    <PipelineProgress :modules="activeModules" :module-states="moduleStates" />
    <div class="space-y-8">
      <ModuleResult
        v-for="m in activeModules"
        :key="m.name"
        :module="m"
        :state="moduleStates.get(m.name)"
      />
    </div>
    <!-- 积分不足中断 -->
    <InsufficientPointsCard v-if="interrupt" @resume="resumeWorkflow" />
    <!-- 完成后 -->
    <Button v-if="phase === 'complete'" @click="navigateTo(`/dashboard/cases/${caseId}`)">
      进入案件详情
    </Button>
  </template>
</template>
```

- [ ] **Step 7: Commit**

```bash
git add app/pages/dashboard/cases/init-analysis/ app/components/initAnalysis/ app/composables/useInitAnalysis.ts
git commit -m "feat(ui): 实现初始化分析页面（模块选择 + Pipeline 进度）"
```

---

## Task 9: 集成测试 & 类型检查

**Files:**
- All new files

- [ ] **Step 1: 运行类型检查**

```bash
npx nuxi typecheck
```

Expected: 无类型错误

- [ ] **Step 2: 运行所有新测试**

```bash
npx vitest run tests/server/case/initAnalysis --reporter=verbose
```

Expected: 全部 PASS

- [ ] **Step 3: 运行全量测试确认无回归**

```bash
npx vitest run --reporter=verbose
```

Expected: 无新增失败

- [ ] **Step 4: 修复发现的问题**

如有类型错误或测试失败，逐一修复。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: 修复集成测试和类型检查问题"
```

---

## Task 10: 代码优化 & 最终提交

- [ ] **Step 1: 运行 simplify 技能审查代码**

使用 `simplify` 技能对所有新增代码进行审查优化。

- [ ] **Step 2: 修复审查发现的问题**

- [ ] **Step 3: 最终类型检查**

```bash
npx nuxi typecheck
```

- [ ] **Step 4: 最终测试**

```bash
npx vitest run --reporter=verbose
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: 优化案件创建功能代码"
```

---

## 依赖关系

```
Task 1 (数据模型) ─┐
Task 2 (类型定义) ─┼─→ Task 3 (服务层) ─→ Task 4 (工作流) ─→ Task 5 (API)
                   │                                              │
                   └─→ Task 6 (共享组件) ─→ Task 7 (创建页面) ──┤
                                            Task 8 (分析页面) ──┤
                                                                 │
                                                                 └─→ Task 9 (集成) → Task 10 (优化)
```

- Task 1, 2 可并行
- Task 3 依赖 Task 1, 2
- Task 4 依赖 Task 3
- Task 5 依赖 Task 4
- Task 6 依赖 Task 2
- Task 7 依赖 Task 5, 6
- Task 8 依赖 Task 5, 6
- Task 7, 8 可并行
- Task 9 依赖 Task 7, 8
- Task 10 依赖 Task 9
