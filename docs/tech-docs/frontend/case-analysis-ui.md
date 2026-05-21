# 案件分析 UI 流程

案件分析是 LexSeek 最核心的前端流程，涵盖案件创建、初始分析、分析结果展示和模块对话四个阶段，基于 LangGraph SSE 流式响应驱动。

## 整体流程

```
创建案件        初始分析           案件详情
┌─────┐     ┌──────────┐     ┌──────────┐
│ AI  │────>│ 模块选择  │────>│ 概览     │
│ 提取 │     │ 流式分析  │     │ 材料管理 │
│ 确认 │     │ 结果展示  │     │ 分析结果 │
│ 表单 │     │ 中断恢复  │     │ 模块对话 │
└─────┘     └──────────┘     │ 小索对话 │
                              └──────────┘
```

## 一、案件创建（caseCreation）

### 组件结构

```
app/components/caseCreation/
├── ManualForm.vue          # 手动创建表单
├── MaterialUploader.vue    # 材料上传组件
├── PartyInput.vue          # 原/被告输入（动态数组）
└── StanceToggleGroup.vue   # 代理立场切换（原告方 / 被告方）
```

### 核心 composable: `useCaseCreation`

位置：`app/composables/useCaseCreation.ts`

#### 状态

```typescript
const step = ref<'ai' | 'confirm'>('ai')       // 当前步骤
const isExtracting = ref(false)                   // AI 提取中
const isSubmitting = ref(false)                   // 创建提交中
const caseTypes = ref<CaseTypeOption[]>([])       // 案件类型列表
const extractedFormData = ref<ExtractedFormData>() // AI 提取的表单数据
const uploadedFiles = ref<OssFileItem[]>([])      // 上传的材料文件
```

#### 两步创建流程

1. **AI 提取阶段**（step = 'ai'）
   - 用户输入案件描述文字或/和上传材料文件
   - 调用 `extractCaseInfo(message, files)` -> `POST /api/v1/cases/extract`
   - AI 从输入中提取：案件标题、案件类型、原告、被告、案件摘要
   - 提取成功后自动跳转 `step = 'confirm'`

2. **确认修改阶段**（step = 'confirm'）
   - 显示 `ManualForm`，预填 AI 提取的信息
   - 用户可修改任何字段
   - 提交调用 `createCase(params)` -> `POST /api/v1/cases/create`
   - 成功后自动导航到初始分析页面：`/dashboard/cases/init-analysis/{sessionId}`

## 二、初始分析（initAnalysis）

### 页面

`app/pages/dashboard/cases/init-analysis/[sessionId].vue`

### 组件结构

```
app/components/initAnalysis/
├── ModuleSelector.vue        # 模块选择（7 模块多选）
├── PipelineProgress.vue      # 流水线进度条
├── ModuleResult.vue          # 单模块分析结果展示
├── CaseInfoCard.vue          # 案件信息卡片
└── InsufficientPointsCard.vue # 积分不足提示
```

### 核心 composable 体系：`composables/initAnalysis/`

初始分析早期是单文件 `useInitAnalysis.ts`，现已拆分为 `app/composables/initAnalysis/` 目录下的多个 composable：

| 文件 | 职责 |
|------|------|
| `useInitAnalysisRuntime.ts` | 流程编排核心：`phase` / `moduleStates` / `selectedModules` 状态机，接入 `useStreamChat`，提供 `loadStatus` / `startAnalysis` / `resumeWorkflow` / `retryModule` |
| `useInitAnalysisProjection.ts` | 把 runtime 状态 + DB 已生成结果投影为 UI 卡片（`mergedResult` / `allModuleCards`） |
| `useInitAnalysisSyncBridge.ts` | 跨标签页同步：广播 / 监听 `analysis:updated`、`module:generating` |
| `useInitAnalysisModules.ts` | 纯工具函数：模块状态快照计算 |
| `types.ts` | `InitAnalysisState` / `AnalysisPhase` / `RuntimeExposed` 等类型 |

页面 `[sessionId].vue` 组合 runtime + projection + syncBridge 三层。下面以 runtime 为主线说明完整生命周期。

#### 三阶段模型

```typescript
const phase = ref<'select' | 'running' | 'complete'>('select')
```

- **select**：用户选择分析模块
- **running**：流式分析进行中
- **complete**：所有模块分析完成

#### 7 个分析模块

定义在 `shared/types/initAnalysis.ts` 的 `INIT_ANALYSIS_MODULES` 常量中。每个模块在 LangGraph StateGraph 中作为独立节点串行执行。

#### 模块状态机

每个模块有四种状态：

```typescript
type ModuleStatus = 'idle' | 'streaming' | 'complete' | 'failed'
```

状态追踪通过 `moduleStates` ref 实现，根据 SSE 流中的 `values` 事件推断：

```
idle -> streaming -> complete
                  -> failed
```

#### SSE 流通信

通过 `useStreamChat` 消费 LangGraph 的 SSE 流：

```typescript
const stream = useStreamChat<InitAnalysisState>({
    apiUrl: '/api/v1/cases/init-analysis',
    threadId: sessionId.value,
    messagesKey: 'messages',
})
```

关键状态字段（从 `stream.values` 解构）：
- `lastExecutedModule`: 当前执行的模块名
- `result`: `Record<string, string>` 各模块结果
- `failedModules`: `Record<string, string>` 失败模块及错误信息
- `selectedModules`: 用户选择的模块列表
- `__interrupt__`: LangGraph 中断数据

#### 消息分组

每个模块有独立的消息列表，供 `ModuleResult` 渲染：

```typescript
const moduleMessagesMap = ref<Record<string, any[]>>({})
```

分组逻辑：
1. 重连恢复：一次性加载 checkpoint 中的所有消息到 `lastExecutedModule`
2. 实时流：增量添加新消息到当前执行的模块

#### 页面刷新恢复

`loadStatus()` 是初始化入口，执行以下步骤：

1. 查询 session 信息 -> 获取 `caseId` 和 session 状态
2. 查询分析状态 -> 获取各模块的完成/失败/进行中状态
3. 恢复 `moduleStates` 和 `selectedModules`
4. 重连 SSE（`stream.submit(undefined)`）从 checkpoint 加载历史消息

#### 跨标签页同步

使用 `useCrossTabEvents` 实现多标签页间的状态同步：

- **发送 `analysis:updated`**：模块完成或流关闭时广播
- **监听 `analysis:updated`**：其他标签页的分析完成时刷新状态
- **监听 `module:generating`**：案件详情页的模块对话生成状态

广播去重：通过签名比对避免 reconnect 造成的无意义广播循环。

#### 中断处理

LangGraph 支持 interrupt（如积分不足需要用户确认）。中断数据的获取绕过了 `@langchain/vue` 的已知 bug：

```typescript
// 不能用 stream.interrupt（只追踪 isLoading）
// 必须从 stream.values.__interrupt__ 读取
const interruptData = computed(() => {
    const v = s.values as any
    if (!v?.__interrupt__?.length) return null
    return resolved?.value ?? resolved
})
```

用户确认后调用 `resumeWorkflow()` 恢复执行。

## 三、分析结果展示（caseAnalysis + caseDetail）

### 案件详情页

页面：`app/pages/dashboard/cases/[id].vue`

#### 组件结构

```
app/components/caseDetail/
├── CaseDetailOverview.vue        # 案件概览（标题、类型、当事人）
├── CaseDetailMaterials.vue       # 材料列表（上传、删除、识别状态轮询）
├── CaseDetailMaterialPreview.vue # 材料预览弹框
├── CaseMaterialList.vue          # 材料列表子组件
├── CaseDetailAnalysis.vue        # 分析结果（7 模块卡片网格）
├── CaseDetailSidebar.vue         # 右侧面板（分析详情/模块对话入口）
├── CaseDetailBottomTabs.vue      # 底部标签页
├── CaseDetailContracts.vue       # 案件关联合同审查
├── CaseDetailDocuments.vue       # 案件关联文书草稿
├── CaseDetailMemory.vue          # 案件记忆面板
├── CaseMemoryTimeline.vue        # 案件记忆时间线
├── AddMemoryDialog.vue           # 新增案件记忆弹框
├── CaseDetailXiaosuo.vue         # 小索 AI 助手弹框
└── CaseExportDialog.vue          # 导出对话框
```

#### 核心 composable: `useCaseDetail`

位置：`app/composables/useCaseDetail.ts`

管理案件详情页的所有数据：

```typescript
const { data: caseInfo } = useApi<CaseDetailInfo>(() => `/api/v1/cases/${id.value}`)
const { data: materials } = useApi<CaseDetailMaterialItem[]>(() => `/api/v1/cases/${id.value}/materials`)
const { data: analysisStatus } = useApi<InitAnalysisStatusResponse>(() => `/api/v1/cases/init-analysis-status/${id.value}`)
```

派生状态：
- `allModuleCards`: 7 个模块的四态卡片（idle / in_progress / complete / failed）
- `analysisResults`: 已完成模块的结果列表
- `isInitAnalysisRunning`: init-analysis 是否正在运行
- `lockedModules`: 被 init-analysis 锁定的模块（不可单独操作）
- `showBatchButton`: 是否显示批量生成按钮（>=2 个 idle 模块）

材料管理功能：
- `addMaterials(files)`: 添加材料 + 自动触发识别轮询
- `deleteMaterials(ids)`: 批量删除材料
- `retryMaterial(id, ossFileId)`: 重试失败的识别

## 四、模块对话

### 架构

每个分析模块支持独立的多轮对话，用于深入探讨该模块的分析结果。模块对话与小索对话早期由 `useModuleChatManager` / `useChatSessionManager` / `useCaseChat` / `useXiaosuoChat` 一组 composable 承担，现已统一重构到 `composables/agents/` 体系：

- 统一工厂 `app/composables/agent-platform/useDomainAgentSession.ts` 整合了原 `useChatSessionManager` + `useStreamChat`（会话管理、流处理、消息队列、跨标签同步、竞态防护），并提供 `useDomainAgentSessionPool` 做多 key 池化。
- `app/composables/agents/` 下是各业务 vertical 的薄包装。

#### 模块对话多实例: `agents/useCaseModuleAgent`

位置：`app/composables/agents/useCaseModuleAgent.ts`（替代旧 `useModuleChatManager`）

基于 `useDomainAgentSessionPool`，每个 `moduleName` 一个池化 session（`scope: 'case'`）。`getOrCreateInstance(moduleName, moduleTitle)` 返回一个 augmented factory：

```typescript
type ModuleAgentInstance = SessionFactory & {
    moduleName: string
    moduleTitle: string
    isExpanded: Ref<boolean>
    isHidden: Ref<boolean>
}
```

对外接口与旧 `useModuleChatManager` 对齐：`instances` / `activeModules` / `expandedModule` / `generatingModules` / `getOrCreateInstance` / `expandModule` / `hideModule` / `collapseAll`。支持同时展开多个模块对话，通过浮动窗口展示（使用 `useDraggableResize` 实现拖拽和缩放）。

#### 会话与流: `useDomainAgentSession`

位置：`app/composables/agent-platform/useDomainAgentSession.ts`

按 `scope` 区分业务域的统一会话工厂，封装多 session 生命周期管理的公共逻辑：
- 每个 session 一个 `effectScope`，切换时销毁旧 scope
- 竞态防护：防止快速切换导致的数据错乱
- 自动重连：`hasActiveRun` 时自动 reconnect
- 双重取消：SSE stop + 后端 cancel API（`stopActiveRun`）

### 小索 AI 助手: `agents/useCaseMainAgent`

位置：`app/composables/agents/useCaseMainAgent.ts`（替代旧 `useXiaosuoChat`）

基于 `useDomainAgentSession` 的薄包装，`scope: 'case'`、`caseId` 必填、多 session（`sessionId: 'auto'` 从后端列表自动选首个）。额外暴露 `generatingModules`——小索调起 `ask_*_expert` 子代理跑模块分析时正在生成的模块名列表，供 `[id].vue` 合并到 `module:generating` 跨标签广播。

```typescript
const xiaosuo = useCaseMainAgent(caseIdRef, {
    onAnalysisSaved: () => refreshAnalysis(),  // 子代理落库后刷新分析结果卡片
})
```

## 五、流式响应渲染

### 底层: `useStreamChat`

位置：`app/composables/useStreamChat.ts`

封装 `@langchain/vue` 的 `useStream` + `FetchStreamTransport`：

```typescript
const transport = new FetchStreamTransport({ apiUrl: options.apiUrl })
const s = useStream<T>({ transport, threadId, messagesKey })
```

关键设计：
- `messages` 使用 `computed` 包装，显式触发 `s.values` 的 track
- `interruptData` 从 `values.__interrupt__` 读取（绕过 `@langchain/vue` bug）
- `hasHistoryLoaded` 标记历史消息是否已加载
- `reconnect()` / `loadHistory()` 通过 `submit(undefined)` 触发重连

### 消息渲染

AI 消息组件位于 `app/components/ai/`，支持：
- Markdown 渲染
- 流式打字效果
- 思考过程展示（thinking）
- 工具调用可视化
- 代码块高亮

### `stopActiveRun`

位置：`app/composables/useStopActiveRun.ts`

双重取消机制：
1. 调用 `stream.stop()` 断开 SSE 连接
2. 查询当前活跃的 run ID -> 调用 cancel API 取消后端任务

## 六、关键交互模式

### 分析模块卡片

每个模块卡片有四种视觉状态：
- **idle**（灰色）：未分析，可点击触发
- **in_progress**（蓝色动画）：分析中
- **complete**（绿色勾）：已完成，可查看结果、可打开模块对话
- **failed**（红色叉）：失败，可重试

### 材料识别状态轮询

使用 `useFileRecognition` composable：
- 每 2 秒轮询一次 `/api/v1/recognition/status/{ossFileId}`
- 最大轮询 60 次（2 分钟）
- 标签页不可见时暂停轮询
- 状态：`idle -> recognizing -> success | error`

### 积分不足中断

当用户积分不足时，LangGraph 触发 interrupt：
1. 前端检测到 `interruptData` 不为 null
2. 显示 `InsufficientPointsCard` 组件
3. 用户充值后点击继续，调用 `resumeWorkflow()` 恢复分析
