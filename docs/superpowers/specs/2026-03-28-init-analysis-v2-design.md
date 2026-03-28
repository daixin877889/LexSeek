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
}): Promise<ReadableStream> {
  const workflow = await getCaseAnalysisWorkflow()
  const stream = await workflow.stream(
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
    }
  )
  // 转换为 SSE ReadableStream（与 initAnalysis 格式一致）
}
```

### init-analysis.post.ts 入队逻辑

保持不变。input 结构 `{ selectedModules, completedResults }` 兼容。

### State 差异

| 字段 | initAnalysis.executor | caseAnalysisV2.workflow |
|------|----------------------|------------------------|
| `messages` | concat reducer | MessagesValue |
| `selectedModules` | ✅ | ✅ |
| `result` | ✅ Record<string, string> | ❌ 无此字段 |
| `lastExecutedModule` | ✅ | ❌ 无此字段 |
| `failedModules` | ✅ | ❌ 无此字段 |
| `llmCalls` | ❌ | ✅ ReducedValue |

前端需要适配：模块状态不再从 `values.result`/`values.lastExecutedModule` 获取，改为从 SSE 事件的 `updates` 流中推断（`updates` 事件包含节点名称）。

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
  :messages="displayMessages"
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
    <AiMessageList v-else :messages="displayMessages" />
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

### useInitAnalysis 适配

**模块状态追踪改动**：

不再从 `values.result`/`values.lastExecutedModule` 获取。改为：
1. 监听 `stream` 的 `updates` 事件，从中获取节点执行信息（节点名称 = 模块名称）
2. 每个节点执行完成后，通过节点名称映射到模块状态
3. 模块分析结果由 `caseAnalysisAgent` 内部的 `analysisResultPersistenceMiddleware` 自动写入 `caseAnalyses` 表，前端通过现有 API `GET /api/v1/case/init-analysis-status/[caseId]` 查询已完成的结果，或在 `updates` 事件中检测模块完成后主动刷新

**新增右侧面板数据**：
- 案件信息通过 API `GET /api/v1/case/[caseId]` 获取
- 分析结果通过现有 `analysisResults` 状态管理

### 新增组件

**`CaseInfoCard.vue`**：显示案件基本信息（标题、类型、原被告、描述）和材料列表。材料可点击预览（复用 `DocPreviewDialog`/`AudioPreviewDialog`）。

### 保持不变

- `InitAnalysisPipelineProgress` — 模块状态栏
- `InitAnalysisModuleSelector` — 模块选择器
- `InitAnalysisModuleResult` — 模块结果渲染
- `AnalysisResults` — 分析结果面板

---

## 文件影响范围

### 后端修改

- `server/services/agent/agentWorker.ts` — 路由改为调用 caseAnalysisV2
- 新增 `server/services/workflow/caseAnalysisV2.executor.ts` — 执行封装

### 前端修改

- `app/pages/dashboard/cases/init-analysis/[sessionId].vue` — 重写为 AiChat 双面板
- `app/composables/useInitAnalysis.ts` — 适配 caseAnalysisV2 state 结构
- 新增 `app/components/initAnalysis/CaseInfoCard.vue` — 案件信息卡片

### 保持不变

- `server/api/v1/case/init-analysis.post.ts` — 入队逻辑不变
- `server/services/workflow/caseAnalysisV2.workflow.ts` — 工作流不变
- `app/components/initAnalysis/PipelineProgress.vue` — 状态栏不变
- `app/components/initAnalysis/ModuleSelector.vue` — 模块选择器不变

### 后续可删除（验证稳定后）

- `server/services/workflow/initAnalysis.executor.ts` — 旧工作流执行器
