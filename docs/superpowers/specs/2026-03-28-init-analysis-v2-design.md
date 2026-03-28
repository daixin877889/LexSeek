# 初始化分析工作流切换 + UI 重构设计

## 概述

将案件初始化分析从 `initAnalysis.executor.ts`（固定串行模块工作流）切换到 `caseAnalysisV2.workflow.ts`（动态模块加载 + 条件边跳过），并将分析页面改为 AiChat 左右分栏布局。

## 目标

- 后端：Worker 执行 init-analysis 时调用 `getCaseAnalysisWorkflow()` 替代 `startInitAnalysis()`
- 前端：init-analysis 页面改为 AiChat 双面板（左消息流 + 右案件信息/分析结果）
- 保留模块选择步骤和顶部固定状态栏
- 不显示 prompt 输入框

---

## 后端：工作流切换

### 架构差异说明

**模块间上下文传递**：旧工作流通过 `contextPrompt` 显式注入前置模块结果到后续模块。v2 工作流中各模块独立执行，通过 `caseMaterialContextMiddleware` 注入案件材料上下文，不依赖前置模块结果。这是有意的架构变更——每个分析模块基于原始案件材料独立分析，而非依赖前一个模块的输出。

**completedResults**：旧 executor 的 `startInitAnalysis` 虽然定义了 `completedResults` 参数，但实际未传给 `workflow.stream()`，不影响切换。

### 改动点

**`server/services/agent/agentWorker.ts`（~114-161行）**

当前：`session.type === 2` 时调用 `startInitAnalysis()`
改为：调用新的 `startCaseAnalysisV2()` 封装函数

**新增 `server/services/workflow/caseAnalysisV2.executor.ts`**

封装 `getCaseAnalysisWorkflow()` 的调用，返回 SSE ReadableStream：

```typescript
export async function startCaseAnalysisV2(params: {
  sessionId: string
  userId: number
  caseId: number
  selectedModules: string[]
  command?: unknown  // 支持 resume（积分中断等）
}): Promise<ReadableStream> {
  const workflow = await getCaseAnalysisWorkflow()

  if (params.command) {
    const { Command } = await import('@langchain/langgraph')
    return workflow.stream(
      new Command({ resume: params.command }),
      {
        configurable: { thread_id: params.sessionId },
        streamMode: ['values', 'messages', 'updates'],
        subgraphs: true,
        encoding: 'text/event-stream',
        version: 'v2',
      },
    )
  }

  return workflow.stream(
    {
      sessionId: params.sessionId,
      userId: params.userId,
      caseId: params.caseId,
      selectedModules: params.selectedModules,
    },
    {
      configurable: { thread_id: params.sessionId },
      streamMode: ['values', 'messages', 'updates'],
      subgraphs: true,
      encoding: 'text/event-stream',
      version: 'v2',
    },
  )
}
```

### init-analysis.post.ts

需要小幅调整：resume 分支中不再传 `completedResults`（v2 不使用），其余入队逻辑不变。

### State 差异与前端适配策略

| 字段 | initAnalysis.executor | caseAnalysisV2.workflow |
|------|----------------------|------------------------|
| `messages` | concat reducer | MessagesValue |
| `selectedModules` | ✅ | ✅ |
| `result` | ✅ Record<string, string> | ❌ 无此字段 |
| `lastExecutedModule` | ✅ | ❌ 无此字段 |
| `failedModules` | ✅ | ❌ 无此字段 |
| `llmCalls` | ❌ | ✅ ReducedValue |

**前端模块状态追踪方案**：

`useStream`（@langchain/vue）返回 `values`（state snapshot）、`messages`、`isLoading`，**不直接暴露 updates 事件**。

由于 v2 state 缺少 `result`/`lastExecutedModule`/`failedModules`，前端需要改用以下策略：

1. **检测当前执行模块**：监听 `stream.messages` 变化。v2 工作流每个模块节点执行时会产生 `AIMessage`，通过 `messages` 的增量变化和节点执行顺序（`selectedModules` 列表）推断当前模块。
2. **检测模块完成**：`caseAnalysisAgent` 的 `analysisResultPersistenceMiddleware` 会将结果写入 `caseAnalyses` 表。前端在检测到消息增量时，轮询 `GET /api/v1/case/init-analysis-status/[caseId]` 获取各模块的持久化状态。
3. **检测模块失败**：v2 的 `createAnalysisNode` 在 catch 中返回 `{ messages: [] }`（空消息），前端通过 init-analysis-status API 的模块 status=FAILED 判断。
4. **整体完成检测**：`stream.isLoading` 变为 false 且无中断时，表示工作流结束。

### 中断处理

v2 工作流本身无中断点，但 `caseAnalysisAgent` 内部的 `pointConsumptionMiddleware` 可能触发积分不足中断。`startCaseAnalysisV2` 支持 `command` 参数以恢复中断。

### 节点命名变化

旧工作流节点名带 `Node` 后缀（如 `summaryNode`），v2 直接使用模块名（如 `summary`）。前端无硬编码旧节点名，不受影响。

---

## 前端：UI 重构

### 页面布局

```
┌──────────────────────────────────────────────────────────────────┐
│  [← 返回]  初始化分析                    [左面板] [右面板] [双面板] │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────┬─────────────────────────────────────┐│
│  │ 模块状态栏 (sticky)     │ 右侧面板                           ││
│  │ [概要✓][大事记⏳][…]    │                                     ││
│  │─────────────────────── │ phase=select: 案件信息 + 模块选择器  ││
│  │                        │ phase=running: 案件信息 + 分析结果   ││
│  │ AI 消息流              │ phase=complete: 案件信息 + 全部结果  ││
│  │ - 模块推理过程          │                                     ││
│  │ - 工具调用              │ 案件信息卡片:                       ││
│  │ - 流式输出              │ - 标题、类型、原被告                ││
│  │                        │ - 材料列表（可点击预览）             ││
│  │                        │                                     ││
│  │                        │ 分析结果:                           ││
│  │                        │ - 复用 AnalysisResults 组件          ││
│  │                        │ - 模块完成后动态追加                 ││
│  └────────────────────────┴─────────────────────────────────────┘│
│  无 prompt 输入框                                                │
└──────────────────────────────────────────────────────────────────┘
```

### 组件使用

```vue
<AiChat
  title="初始化分析"
  :show-prompt="false"
  :show-task-queue="false"
  :messages="streamMessages"
  @back="goBack"
>
  <template #message-list>
    <!-- 固定状态栏 -->
    <InitAnalysisPipelineProgress
      :modules="activeModules"
      :module-states="moduleStates"
      class="sticky top-0 z-10 bg-background"
    />
    <!-- phase=select: 模块选择器 -->
    <InitAnalysisModuleSelector v-if="phase === 'select'" />
    <!-- phase=running/complete: AI 消息流 -->
    <AiMessageList v-else :messages="streamMessages" />
  </template>

  <template #right-panel>
    <!-- 案件信息卡片 -->
    <CaseInfoCard :case-id="caseId" />
    <!-- 分析结果（动态追加） -->
    <CaseAnalysisResults
      v-if="analysisResults.length > 0"
      :results="analysisResults"
    />
  </template>
</AiChat>
```

`streamMessages` 来源于 `useInitAnalysis` composable 中的 `stream.messages`。

### useInitAnalysis 适配

重写模块状态追踪逻辑（详见后端 State 差异章节的前端适配策略）。

**新增右侧面板数据**：
- 案件信息通过 API `GET /api/v1/case/[caseId]` 获取
- 分析结果通过轮询 `GET /api/v1/case/init-analysis-status/[caseId]` 获取，检测到新完成的模块时更新

### 重连逻辑

页面刷新/重连时：
1. `loadStatus()` 通过 `GET /api/v1/case/init-analysis-status/[caseId]` 恢复模块状态
2. `stream.submit()` 重连 SSE 流（v2 state 字段不同，但 FetchStreamTransport 会自动获取最新 values）
3. 已完成的模块从 init-analysis-status API 获取，不依赖 stream values

### 模块列表策略

前端继续使用 `INIT_ANALYSIS_MODULES`（`shared/types/initAnalysis.ts`）硬编码列表。后端 v2 工作流虽然动态从 DB 加载模块，但只执行前端传入的 `selectedModules`。如果后台新增模块，需同步更新 `INIT_ANALYSIS_MODULES`。

### 新增组件

**`CaseInfoCard.vue`**：显示案件基本信息（标题、类型、原被告、描述）和材料列表。材料可点击预览（复用 `DocPreviewDialog`/`AudioPreviewDialog`）。

### 保持不变

- `InitAnalysisPipelineProgress` — 模块状态栏
- `InitAnalysisModuleSelector` — 模块选择器
- `AnalysisResults` — 分析结果面板

---

## 文件影响范围

### 后端修改

- `server/services/agent/agentWorker.ts` — 路由改为调用 caseAnalysisV2
- `server/api/v1/case/init-analysis.post.ts` — resume 分支去除 completedResults
- 新增 `server/services/workflow/caseAnalysisV2.executor.ts` — 执行封装（含 command/resume 支持）

### 前端修改

- `app/pages/dashboard/cases/init-analysis/[sessionId].vue` — 重写为 AiChat 双面板
- `app/composables/useInitAnalysis.ts` — 重写模块状态追踪逻辑
- 新增 `app/components/initAnalysis/CaseInfoCard.vue` — 案件信息卡片

### 保持不变

- `server/services/workflow/caseAnalysisV2.workflow.ts` — 工作流不变
- `app/components/initAnalysis/PipelineProgress.vue` — 状态栏不变
- `app/components/initAnalysis/ModuleSelector.vue` — 模块选择器不变

### 后续可删除（验证稳定后）

- `server/services/workflow/initAnalysis.executor.ts` — 旧工作流执行器
- `shared/types/initAnalysis.ts` 中的旧事件类型定义（如 `InitAnalysisEventType`）
- `server/api/v1/case/init-analysis.post.ts` 中的 `loadCompletedResultsService` 相关调用
