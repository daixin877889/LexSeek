# Agent 错误恢复和 UI 容错设计

## 概述

解决 Agent 执行全链路中的容错问题：工具卡住、执行失败、SSE 断开、页面刷新后状态丢失。

**设计原则**：
- **最小改动**：优先复用现有能力（后端 replay 机制、`useStreamChat.reconnect()`、`useChatSessionManager` 的刷新恢复逻辑）
- **手动兜底优先**：出错后显示明确的错误提示 + "重试" / "重新连接"按钮，由用户触发恢复；**不做自动重连、不做自动重试**（避免与 agent 自身判断冲突、避免复杂状态机）
- **不扩展 transport 层**：通过后端事件通道复用（`event: status` → `event: custom`）让 `useStream` 原生 `onCustomEvent` 接收状态事件，避免重写 SSE 解析
- **打通完整信号链路**：错误信息必须从 `agentWorker` 的 catch 分支一路流到用户看到的 toast，任何中间断点都会让修复失效（本方案一次性修复接口 / worker 发布 / SSE 通道 / 前端拦截 四个断点）
- **不破坏现有链路**：`useCaseChat` / `useInitAnalysis` / `useChatSessionManager` / `FetchStreamTransport` 的已有逻辑全部保持不变

目标：**每个错误场景都有明确的用户反馈和手动恢复入口**，且全程不丢失对话历史。

## 问题根因

| 场景 | 当前行为 | 根因 |
|------|---------|------|
| 工具执行卡住 | UI 永久 loading（直到整个 run 的 worker 级超时触发） | `execFile` callback 在极端情况下不触发，外层 Promise 永远 pending；worker 级兜底超时（`agentWorker.ts:119-122`，`agent.timeoutMs: 3600000`）是 run 级粒度（**1 小时**），对单个工具不够及时 |
| Agent 执行失败 | loading 停止但无提示 | **三个叠加根因**：1) 后端 `status_change` 事件以 `event: status` 发送（`chat.post.ts:318,333`、`init-analysis.post.ts:361,377,385`），`useStream` 只处理 `event: custom`，事件被静默丢弃；2) `AgentStatusEvent` 接口（`shared/types/agentRun.ts:28-33`）无 `error` 字段，`agentWorker.ts:314-319` 发布时丢失 errorMessage；3) FAILED 场景下后端正常 `break + close()`，前端表现为"SSE 正常结束"，`onError` / `s.error` 均不触发（见 `manager.js:501-511`） |
| SSE 连接中断 | 无提示、无恢复入口 | 前端未派生 `connectionStatus`、无"重新连接"按钮；且由于上一条根因，失败和真实断连在前端是两种不同的"结束状态"，必须分别处理 |
| 页面刷新后状态丢失 | （实际已解决，见下文） | xiaosuo / module 对话由 `useChatSessionManager.ts:121-126` 根据 `session.hasActiveRun` 自动选择 `reconnect()` / `loadHistory()`；初始化分析由 `useInitAnalysis.loadStatus()`（`useInitAnalysis.ts:317-423`）在页面 `onMounted` 触发独立恢复。本设计只需**补齐失败提示的信号链路**（场景 2），无需额外处理 |

## 架构设计

### 场景 1：工具执行兜底超时

**改动文件**：
- `server/services/workflow/tools/workspace.ts` — 新增 `withTimeout` 通用函数
- `server/services/workflow/tools/runSkillScript.tool.ts` — 引入 `withTimeout` 包裹 execFile Promise

**为什么还需要 tool 级超时** —— 与 worker 级超时互补：

| 层级 | 位置 | 粒度 | 触发后 |
|------|------|------|--------|
| execFile 内置 | `runSkillScript.tool.ts:123` | 单次子进程（30s） | 正常路径下 callback 被调用并返回错误 |
| **tool 级 withTimeout**（本次新增） | `runSkillScript.tool.ts` Promise 外层（35s） | 单个工具调用 | 立即抛错，agent 收到错误字符串决定下一步 |
| worker 级 timeoutMs | `agentWorker.ts:119-122`（配置见 `nuxt.config.ts:209` `agent.timeoutMs: 3600000`） | 整个 run（**1 小时**） | abort 整个 run，发布 FAILED 状态 |

只有 execFile 内置超时是**不够**的：极端情况下 callback 不触发时外层 Promise 永远 pending，agent 无法推进；worker 级超时**严重不够及时**：整个 run 要等 **1 小时**才会被 abort，这段时间内前端 UI 一直转圈，用户体验完全不可接受。**tool 级 `withTimeout` 填补这两者之间的 59 分钟空白**，在单个工具卡住后 5s 内让 agent 恢复执行。

**本次不改的相关边界**（已知但不在范围内）：

- `server/services/workflow/tools/types.ts:36-45` 的 `ToolContext` 接口**没有** `signal: AbortSignal` 字段，worker 级 abort（`agentWorker.ts:44` 的 `activeRuns: Map<string, AbortController>`）**无法透传到工具层**。这意味着 worker 取消 run 时，工具层的 `execFile` 不会被信号通知，仍需等自己的 30s/35s 超时才能退出。
- 打通 `AbortSignal` 链路需要修改 `ToolContext`、所有 `createTool` 工厂、所有工具 handler，是**独立的架构优化项**，超出本次"错误恢复"范围。若后续有用户取消时的响应性需求再单独立项。

在 `execFile` 的 Promise 外层加兜底超时，防止 callback 不触发导致 Promise 永远 pending：

```typescript
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} 执行超时（${ms / 1000}s）`)), ms)
        promise.then(resolve, reject).finally(() => clearTimeout(timer))
    })
}

// 在 tool handler 中使用
const result = await withTimeout(
    new Promise<string>((done) => {
        execFile(runtimeBin, execArgs, { timeout: 30_000, ... }, (err, stdout, stderr) => {
            // ...
        })
    }),
    35_000,  // 比 execFile 超时多 5s 作为兜底
    `脚本 ${scriptName}`
)
```

`withTimeout` 是通用函数，所有工具都可以使用。放在 `workspace.ts` 共享模块中。

### 场景 2：Agent 执行失败的 UI 反馈

**改动文件**：
- `shared/types/agentRun.ts` — `AgentStatusEvent` 接口新增 `error?: string` 字段
- `server/services/agent/agentWorker.ts` — FAILED 发布时把 `errorMessage` 传入 `publishStatusChange`
- `server/api/v1/case/analysis/chat.post.ts` — SSE 出口把 `status_change` 从 `event: status` 改为 `event: custom`（xiaosuo / module 对话端点，2 处）
- `server/api/v1/case/init-analysis.post.ts` — 同上，初始化分析端点独立存在且有相同问题（3 处：`init-analysis.post.ts:361,377,385`）
- `app/composables/useStreamChat.ts` — 在现有 `onCustomEvent` 中识别 `status_change` 并暴露 `runStatus` / `runError`
- 对话页面组件 + 初始化分析页 — 增加错误 toast 和重试按钮（区分 failed / cancelled）

场景 2 的 UI 反馈需要修复**三个叠加的信号链路断点**，任何一个不修都无法把失败原因送到用户面前。下面按数据流向顺序说明。

**与现有 `failedModules` 机制的关系**（重要边界）：

项目已有一个**模块级部分失败**机制（`useInitAnalysis.ts:195-229` watch `stream.values.failedModules`），用于初始化分析工作流中某个模块失败但其他模块继续执行的场景（见 `caseAnalysisV2.workflow.ts:65,396,462`）。它的语义与本方案的 `runStatus: 'failed'` **完全不重叠**：

| 维度 | `failedModules`（已有，不改动） | `runStatus: 'failed'`（本方案新增） |
|------|-------------------------------|-----------------------------------|
| 层级 | LangGraph workflow state | agent worker catch 分支 |
| 语义 | 某个模块失败，但 run 整体可能 COMPLETED | 整个 run 异常中止 |
| 触发 | workflow 内部 catch，写入 state，不抛到 worker | 工作流抛出未捕获异常到 worker |
| 当前 UI | `allModuleCards` 渲染为卡片 `status: 'failed'`（不弹 toast） | 无 UI（本方案要修复） |
| 范围 | 仅初始化分析 | 所有 agent run（含对话） |

**互补而非冲突**：
- 单模块失败（常见情况）→ 只触发 `failedModules` → 卡片显示失败 → 用户可看局部细节
- 整个 run 崩溃（罕见情况，如 workflow 代码异常）→ 触发 `runStatus: 'failed'` → 顶部 toast → 用户看到全局失败原因
- 极端情况下两者可同时触发，UI 效果是"卡片显示某模块失败 + 顶部 toast 显示整体错误"，信息叠加而非重复

本方案**不改动** `failedModules` 相关代码。

#### 2.1 信号链路断点一：`AgentStatusEvent` 接口缺 `error` 字段

**现状**（`shared/types/agentRun.ts:28-33`）：

```typescript
export interface AgentStatusEvent {
  type: 'status_change'
  runId: string
  sessionId: string
  status: AgentRunStatus
  // ← 没有 error 字段
}
```

`agentWorker.ts:307-319` 已经把 `errorMessage` 写入了数据库 `agentRuns.error` 字段，**但 publishStatusChange 时没传**：

```typescript
// agentWorker.ts:301-319 现状
catch (err: any) {
  const errorMessage = err?.message ?? '未知错误'
  // ... 写数据库 ...
  await updateRunStatusDAO(run.id, status, {
    error: errorMessage,  // ← 入库
    completedAt: new Date(),
  })

  await publishStatusChange({
    type: 'status_change',
    runId: run.id,
    sessionId: run.sessionId,
    status,
    // ← 这里丢失了 errorMessage！
  })
}
```

**必须改动**：

1. 扩展接口，添加 `error?: string`：

```typescript
// shared/types/agentRun.ts
export interface AgentStatusEvent {
  type: 'status_change'
  runId: string
  sessionId: string
  status: AgentRunStatus
  error?: string  // 新增：仅 FAILED / CANCELLED 时有值
}
```

2. `agentWorker.ts:314-319` 把 `errorMessage` 一起发出去：

```typescript
await publishStatusChange({
  type: 'status_change',
  runId: run.id,
  sessionId: run.sessionId,
  status,
  error: isCancelled ? undefined : errorMessage,
}).catch(e => logger.error('发布状态变更失败:', e))
```

不修复这一点，前端最多只能显示默认的"执行失败"字样，用户无法定位是脚本超时、模型限流还是参数错误。

#### 2.2 信号链路断点二：`event: status` 事件被前端静默丢弃

`@langchain/vue` 的 `useStream` 原生支持 `onCustomEvent` 回调，但 `StreamManager.start`（`node_modules/@langchain/langgraph-sdk/dist/ui/manager.js:354-495`）的 for await 循环只识别少量事件类型：`metadata / events / updates / custom / messages / values / error`。

**两个 SSE 端点都有相同问题**（项目中有两个独立的 SSE 端点，都连到 useStreamChat）：

| 端点 | 用途 | status_change 序列化位置 |
|------|------|---------------------|
| `server/api/v1/case/analysis/chat.post.ts` | xiaosuo / module 对话（走 useCaseChat） | 第 318、333 行（replay + 实时订阅） |
| `server/api/v1/case/init-analysis.post.ts` | 初始化分析（走 useInitAnalysis） | 第 361、377、385 行（checkpoint 兜底 + replay + 实时订阅） |

两个端点都把 `status_change` 序列化为 `event: status` → **不在 `useStream` 识别列表中 → 被静默跳过**，前端永远收不到。**必须同时修复这两个文件**，否则初始化分析页仍然存在 loading 转圈无提示的问题。

**方案**：在两个端点中把 `status_change` 通过 `event: custom` 发送，前端直接复用原生 `onCustomEvent`，**不扩展 transport、不重写 SSE 解析逻辑**。

**后端改动**（两个文件对称处理）：

```typescript
// 原来（chat.post.ts 两处 + init-analysis.post.ts 三处）：
// sseData = `event: status\ndata: ${JSON.stringify(evt)}\n\n`
// 改为：
if (evt.type === 'status_change') {
    sseData = `event: custom\ndata: ${JSON.stringify(evt)}\n\n`
}
```

具体改动位置：

- `chat.post.ts:318`（replay 分支 else 出口）
- `chat.post.ts:333`（实时订阅分支 terminal 状态分支）
- `init-analysis.post.ts:361`（checkpoint 兜底分支的终结状态出口）
- `init-analysis.post.ts:377`（replay 分支 lastMissed 终结出口）
- `init-analysis.post.ts:385`（实时订阅分支 terminal 状态分支）

**关于 `event: custom` 通道的语义更新**：

`chat.post.ts:314` 和 `chat.post.ts:354` **两处**都有相同的旧注释："必须发完整事件对象（含 name 字段），前端依赖 evt.name 判断事件类型"（replay 分支和实时订阅分支各一份）。**这两处都需要同步更新**为：

> `event: custom` 通道承载两类事件：
> 1. **`AgentCustomEvent`**（`type: 'custom_event'`，有 `name` 字段）——业务自定义事件，如 `analysis_result_saved`
> 2. **`AgentStatusEvent`**（`type: 'status_change'`，无 `name` 字段）——agent 状态变更
>
> 前端消费方**必须先用 `data.type` 区分**，再处理各自字段：
> - `data.type === 'custom_event'` → 走 `data.name` 分支
> - `data.type === 'status_change'` → 走 `data.status` / `data.error` 分支

**对现有消费方的兼容性**：`app/composables/useModuleChatManager.ts:69` 现有代码 `if (eventData.name === 'analysis_result_saved')` 判断一个 `AgentStatusEvent` 对象时 `name` 为 `undefined`，**不会误触**（条件直接不成立，不抛错）。但仍需把这个注释更新清楚，避免后续维护者写出依赖 name 字段存在的代码。

#### 2.3 信号链路断点三：FAILED 在前端表现为"SSE 正常结束"而非"错误"

即使 2.1 和 2.2 修复后，也**不能依赖 `onError` 或 `s.error` 判断 FAILED**，原因从 `manager.js:345-511` 源码可以看出：

```typescript
// StreamManager.start 的关键逻辑
try {
    this.setState({ isLoading: true, error: void 0 })
    for await (const { event, data } of run) {
        if (event === "error") {            // ← 只有显式 error 事件才算错
            streamError = new StreamError(data)
            break
        }
        // ... 处理其他事件 ...
    }
    if (streamError != null) throw streamError
    // ... onSuccess ...
} catch (error) {
    this.setState({ error })                // ← 只在真实抛错时设置
    await options.onError?.(error)          // ← 只在真实抛错时触发
} finally {
    this.setState({ isLoading: false })     // ← 正常结束也会执行
    options.onFinish?.()
}
```

而 `chat.post.ts:332-335`（for 循环内的 terminal 判断 + break）的 FAILED 处理是**正常的 `break + close()`**，不是抛错：

```typescript
for await (const evt of createEventSubscription(runId, abortController.signal)) {
  if (evt.type === 'status_change' && TERMINAL_STATUSES.includes(evt.status)) {
    controller.enqueue(...)
    break  // ← 正常 break
  }
  // ...
}
// → finally 里 controller.close()
```

**结论**：FAILED 在 `useStream` 看来就是"run 正常完成"——`s.error` 不会被设置、`onError` 不会触发、`isLoading` 会从 true 自然变为 false。**区分 FAILED 与成功结束的唯一可靠信号，就是 onCustomEvent 拦截到的 `status_change` 事件**。这直接决定了场景 3 中 `connectionStatus` 的派生逻辑必须以 `runStatus` 为首要判断。

#### 2.4 前端改动：在 onCustomEvent 中识别并暴露状态

在 `app/composables/useStreamChat.ts` 现有 `onCustomEvent` 中识别 `status_change` 类型并暴露响应式状态：

```typescript
// useStreamChat.ts 顶部补充类型导入
import type { AgentRunStatus } from '#shared/types/agentRun'

// 在 useStreamChat 函数体内
const runStatus = ref<AgentRunStatus | 'idle'>('idle')
const runError = ref<string>('')

const streamOptions: UseStreamCustomOptions<T> = {
    // ...
    onCustomEvent: (data: any) => {
        // 识别 status_change（通道断点二的前端侧）
        if (data?.type === 'status_change') {
            runStatus.value = data.status
            if (data.status === 'failed') {
                // 优先用后端传来的 errorMessage（断点一修复后可用）
                runError.value = data.error || '执行失败'
            } else if (data.status === 'cancelled') {
                // 用户主动取消：清空 error，UI 不弹 toast
                runError.value = ''
            }
            // interrupted / running / completed 等其他状态：
            //   - interrupted 由现有 interruptData 机制覆盖，这里只更新 runStatus
            //   - running / completed 对 UI 没有额外诉求
            //   无论哪种状态，status_change 都不需要透传给业务消费方
            return
        }
        // 其他自定义事件（如 analysis_result_saved）透传给调用方
        options.onCustomEvent?.(data)
    },
}
```

在 `useStreamChat` 返回值中暴露 `runStatus` 和 `runError` 给对话页面组件使用。

**为什么不扩展 FetchStreamTransport**：
- `FetchStreamTransport` 是 `@langchain/langgraph-sdk` 内部类，无公共扩展点，继承/包装方案需要重新实现 SSE 帧解析（事件分隔、data 拼接、注释行处理），任何偏差都会影响所有流式事件（values/messages/custom/interrupt）
- 同时影响 `useCaseChat` 和 `useInitAnalysis` 两条链路，破坏面大
- 复用 custom 通道 + 类型区分，改动集中在后端 4 个文件（类型 + worker + 两个 SSE 端点）+ 前端 1 个 composable + 2 个页面组件接入点，都是局部改动

#### 2.5 错误 Toast 和重试按钮（区分 failed / cancelled）

对话页面组件 `watch(runStatus)`，针对不同终结状态采用不同 UI 策略：

| runStatus | UI 行为 | 原因 |
|-----------|--------|------|
| `failed` | toast.error + 最后一条消息下方显示"重试"按钮 | 用户被动遇到错误，需要明确反馈和恢复入口 |
| `cancelled` | **不弹 toast**，不显示重试按钮 | 用户主动点"停止"的结果，弹失败提示反而让用户困惑 |
| `completed` | 无操作 | 正常完成 |
| `interrupted` | 由现有 `interruptData` 覆盖 | 中断卡片（如积分不足）已有完整 UI |

项目使用 `vue-sonner` 作为 toast 库（全局使用方式：页面组件 `import { toast } from 'vue-sonner'`，参考 `app/pages/dashboard/cases/index.vue:145`）：

```typescript
// 对话页面组件 / 初始化分析页组件
import { toast } from 'vue-sonner'

watch(runStatus, (status) => {
    if (status === 'failed') {
        toast.error(`分析失败：${runError.value}`)
        showRetryButton.value = true
    }
    // cancelled 静默处理，不需要写代码
})

async function onRetry() {
    // 重试 = 重新 submit 用户最后一条消息
    const lastUserMsg = messages.value.findLast(m => m._getType?.() === 'human')
    if (!lastUserMsg) return
    showRetryButton.value = false
    await submit({ messages: [lastUserMsg] })
}
```

**初始化分析页的重试方式**：该页面没有"用户最后一条消息"的概念，本方案要求：
- `runStatus === 'failed'` 时 toast 提示
- 根据 `useInitAnalysis.phase` 选择恢复入口：
  - `phase === 'running'` → 显示"继续分析"按钮（`resumeWorkflow()`）或针对失败模块的"重试"按钮（`retryModule(moduleName)`）
  - `phase === 'complete'` → 理论上不会出现 failed（run 已完成），不处理
  - `phase === 'select'` → 尚未启动 stream，不会收到 status_change，不需要处理
- 具体按钮文案和布局由初始化分析页自行决定，本方案只保证 `runStatus` / `runError` 信号可用

```
执行失败时的 UI：
┌─────────────────────────────────────┐
│  ⚠️ 分析失败：脚本 lexseek.cjs 执行超时（35s） │
│  [重试]                              │
└─────────────────────────────────────┘
```

#### 2.6 错误恢复边界

本方案**不在本次实施中引入后端自动重试**（如"工具超时等 3s 自动重试 1 次"等逻辑），原因：

1. **LangGraph 的 `recursionLimit` 不是错误重试机制**——它是防止死循环的上限，与工具失败后是否重试无关
2. **prebuilt react agent 收到工具错误字符串后，由模型自行决定下一步**（重新调用、换工具、向用户报错）——这是已有能力，无需在 worker 层额外包一层
3. 在 worker 层硬编码"等待 3s 再重试"会与 agent 的判断冲突，且难以与用户手动重试协调

如后续出现特定类型错误需要统一兜底重试，应在 **tool 层内部**（单个 tool 的 handler 里判断错误码并自重试）而非 worker 层实现。

### 场景 3：SSE 连接中断和手动重连

**改动文件**：
- `app/composables/useStreamChat.ts` — 暴露 `connectionStatus` 响应式状态
- 对话页面组件（xiaosuo / module） — 增加连接状态提示条和"重新连接"按钮
- 初始化分析页（`init-analysis/[sessionId].vue`） — 同样接入 `connectionStatus` 显示"重新连接"按钮

**设计原则**：**不做自动重连、不做心跳检测**。原因：

1. 浏览器 fetch streaming 在 TCP 断开时本就会抛错，触发 `useStream` 的 `onError` 回调（见 `orchestrator-custom.js:345`），已经覆盖绝大多数断连场景
2. 后端 `chat.post.ts` 已有 keepalive 机制，代理层通常也有 keep-alive；单纯"TCP 活着但后端 stall"的情况极少，为此引入心跳检测会带来持续的 setInterval 开销和状态竞态
3. 文档前版推荐的"重新创建 useStream 实例"方案会破坏 `useCaseChat` / `useInitAnalysis` 调用方持有的响应式引用，改动面大且回报低
4. 后端 `replayEvents` + `createEventSubscription` 已就绪，**用户点一次"重新连接"按钮 = `stream.submit(undefined)` = 后端自动 replay 补发错过的事件**，语义和自动重连完全等价

#### 3.1 连接状态暴露

`connectionStatus` 必须**同时考虑 agent 层（`runStatus`）和传输层（`s.error`）两种失败**，原因来自场景 2.3：FAILED 在 `useStream` 看来是"正常结束"，`s.error` 不会被设置。单独依赖 `s.error` 会漏掉所有 FAILED 场景。

```typescript
// useStreamChat.ts 中派生
const connectionStatus = computed<'idle' | 'streaming' | 'failed' | 'disconnected'>(() => {
    // 优先级 1：agent 层失败（来自 2.4 的 runStatus 拦截）
    if (runStatus.value === 'failed') return 'failed'
    // 优先级 2：传输层断开（浏览器 fetch 抛错，触发 onError 设置 s.error）
    if (s.error) return 'disconnected'
    // 优先级 3：正在流式输出
    if (s.isLoading) return 'streaming'
    // 其他：空闲（idle / completed / cancelled / interrupted 都归入此类）
    return 'idle'
})
```

**两种失败状态对应不同 UI**：

| connectionStatus | 含义 | UI 处理 | 恢复动作 |
|-----------------|------|--------|---------|
| `failed` | agent 执行失败（脚本超时、模型限流等） | 错误 toast + "重试"按钮 | 重发用户最后一条消息（见场景 2.5） |
| `disconnected` | SSE 传输层断开（TCP 断连、网络抖动） | 灰色横幅 + "重新连接"按钮 | `reconnect()` = `s.submit(undefined)` + 后端 replay |

两者都不能误用对方的恢复动作：
- 传输层断开时如果"重发消息" → 会创建一个新 run，原 run 的历史输出丢失
- agent 失败时如果"重新连接" → 只会 replay 到已完成的 FAILED 状态，不会真正重试

在 `useStreamChat` 返回值中暴露 `connectionStatus`、`runStatus`、`runError` 三个派生状态，供对话页面组件使用。

#### 3.2 复用现有 reconnect()

`useStreamChat.ts:89-92` 已有 `reconnect()` 方法，**无需改动**：

```typescript
// useStreamChat.ts:89-96 现状
reconnect: () => {
    hasHistoryLoaded.value = false
    s.submit(undefined)
},
loadHistory: () => {
    hasHistoryLoaded.value = false
    s.submit(undefined)
},
```

**两者实现完全相同**（重置 `hasHistoryLoaded` + 调 `s.submit(undefined)`），区别只在语义：
- `reconnect` 用于"活跃 run 断开后补发" —— 后端走 `replayEvents(runId)` 分支
- `loadHistory` 用于"无活跃 run 时加载历史" —— 后端走 checkpoint 分支

具体走哪条分支由后端 `chat.post.ts` / `init-analysis.post.ts` 根据 `getActiveRunService` 自动路由，前端两个方法等价。

对话页面组件在"重新连接"按钮点击事件中直接调用 `reconnect()` 即可。**`hasHistoryLoaded` 字段目前仅 `useStreamChat` 内部使用**（全局搜索无其他消费方），重置 false 不会引入副作用。本方案不改动 `reconnect` 的实现。

#### 3.3 连接状态 UI（仅 `disconnected` 分支）

`failed` 分支的 UI 已在场景 2.5 处理。本节只负责 `disconnected`：

```
传输层断开时（connectionStatus === 'disconnected'）：
┌─────────────────────────────────────┐
│  ⚠️ 连接已断开                       │
│  [重新连接]                          │
└─────────────────────────────────────┘
```

"重新连接"按钮点击 → 调用 `useStreamChat.reconnect()` → 内部 `s.submit(undefined)` → 后端 `replayEvents` 补发缺失事件。

**不做的事**：
- ❌ 不做 60s 心跳超时检测（依赖浏览器 fetch 层的错误事件即可）
- ❌ 不做指数退避自动重连（用户手动触发更可控）
- ❌ 不做"重新创建 useStream 实例"（会破坏上层响应式引用）

### 场景 4：页面刷新后状态恢复（已由现有机制覆盖，无需改动）

**结论**：本场景**无需任何新代码**。项目中**两条独立的对话链路都已有各自的刷新恢复机制**，本设计不对它们做任何修改。

**两条恢复路径**：

| 对话类型 | 恢复机制 | 代码位置 | 触发时机 |
|---------|--------|---------|---------|
| **xiaosuo / module 对话** | `useChatSessionManager` 根据 session 列表的 `hasActiveRun` 字段自动选择 `reconnect()` / `loadHistory()` | `useChatSessionManager.ts:121-126` | 切换/打开 session 时 |
| **初始化分析（init-analysis）** | `useInitAnalysis.loadStatus()` 查询 `init-analysis-status` 接口，根据 `status.status` 分支恢复 `moduleStates`，最后调用 `stream.submit(undefined)` 触发 SSE 重连 | `useInitAnalysis.ts:317-423`，由 `app/pages/dashboard/cases/init-analysis/[sessionId].vue:303` 在 `onMounted` 中调用 | 页面挂载时 |

**两条路径的终点都是 `stream.submit(undefined)`**（内部等价于 `reconnect`），都会走到对应 SSE 端点的 `replayEvents` 分支，让 Redis Stream 补发错过的事件。区别只在于判断"是否需要重连"的字段来源不同（一个用 `hasActiveRun`，一个用 `init-analysis-status` 接口返回的 `status`）。

**与场景 2 的信号打通自动生效**：

刷新后如果真有一个 RUNNING 的 run，两条路径都会触发 replay 分支，后端把 Redis Stream 中的事件（含 `status_change`）依次补发。场景 2 修复后（接口新增 error 字段 + 两个 SSE 端点走 custom 通道 + useStreamChat 拦截），**如果这个 run 在刷新前已经失败但前端还没收到 FAILED 事件**，补发的 `status_change` 会让 `runStatus` 正确变为 `failed`，toast 自动弹出。**这条路径对两种对话类型都自动生效，不需要额外代码**。

**被早期版本误判为"需要新增"的改动**（全部否决）：

| 早期方案 | 否决原因 |
|---------|---------|
| 新增 `/api/v1/case/analysis/runs/latest` API | `useChatSessionManager` 不需要这个接口，通过 session 列表的 `hasActiveRun` 字段即可判断；`useInitAnalysis` 也不需要，它用独立的 `init-analysis-status` 接口 |
| 对话页面组件 `onMounted` 查询 `runs/current` 并触发 reconnect | 会与 `useChatSessionManager` / `useInitAnalysis.loadStatus()` 的自动逻辑重复触发 reconnect，导致 run_events Stream 被读两次 |
| `switch(latestRun.status)` 四路分支处理 | `completed` 无需处理，`failed` 由场景 2 在 replay 时自动触发，`interrupted` 已由 `interruptData` 覆盖 |

**已知边界**（不处理）：

1. 如果最新 run 已经是 FAILED 且用户**过了很久**才刷新页面：
   - xiaosuo / module：`hasActiveRun` 为 false → 走 `loadHistory()` 分支，此时不会 replay status_change 事件，前端不会显示历史失败 toast
   - init-analysis：`useInitAnalysis.loadStatus()` 只在 `init-analysis-status.status` 为 `in_progress` / `completed` 时调 `stream.submit(undefined)`（`useInitAnalysis.ts:380-420`），如果上次 run 是 FAILED 且 status API 返回其他状态，恢复流程不执行，前端不会展示历史失败信息
   - 两种链路都**不会刷新后仍显示全局 toast**。这是可接受的——失败状态是一次性的，用户想重试直接发新消息或重新开始分析即可
2. `useInitAnalysis` 的 `stream.isLoading` watch（`useInitAnalysis.ts:308-313`）目前**只做跨标签广播**，没有 FAILED 分支处理。场景 2 修复后，init-analysis 页面需要额外 `watch(runStatus)`（由 `useStreamChat` 暴露）接入失败提示 UI——这是**本次必做**的前端改动（已列入场景 2 的改动文件清单）。

## 文件变更清单

### 修改文件

| 文件 | 变更内容 |
|------|---------|
| `server/services/workflow/tools/workspace.ts` | 新增 `withTimeout<T>(promise, ms, label)` 通用函数 |
| `server/services/workflow/tools/runSkillScript.tool.ts` | 用 `withTimeout` 包裹 execFile Promise，35s 兜底（填补 execFile 内置超时 30s 与 worker 级 1 小时超时之间的空白） |
| `shared/types/agentRun.ts` | `AgentStatusEvent` 接口新增 `error?: string` 字段（仅 FAILED / CANCELLED 时有值） |
| `server/services/agent/agentWorker.ts` | catch 分支中 `publishStatusChange` 调用传入 `error: isCancelled ? undefined : errorMessage`，把失败原因送出 Redis |
| `server/api/v1/case/analysis/chat.post.ts` | replay 和实时订阅分支中，把 `status_change` 事件序列化从 `event: status` 改为 `event: custom`（第 318、333 行，两处改行）；同时更新第 314、354 行两处 `event: custom` 通道注释：承载 `AgentCustomEvent` 和 `AgentStatusEvent` 两类事件，消费方须先按 `data.type` 区分 |
| `server/api/v1/case/init-analysis.post.ts` | 同上逻辑，把 `status_change` 事件从 `event: status` 改为 `event: custom`（第 361、377、385 行，三处）。**必须与 chat.post.ts 同步修改**，否则初始化分析页的 FAILED 事件仍会被 useStream 静默丢弃 |
| `app/composables/useStreamChat.ts` | 在 `onCustomEvent` 中识别 `data.type === 'status_change'`，暴露 `runStatus` / `runError` / `connectionStatus` 三个响应式状态；其他 custom 事件透传给上层 |
| 对话页面组件（`app/pages/dashboard/cases/[id].vue` + `app/components/case/AnalysisModuleChat*.vue`） | `watch(runStatus)`：failed → 错误 toast + "重试"按钮（重发用户最后一条消息）；cancelled → 静默；`watch(connectionStatus)`：disconnected → 显示"重新连接"按钮（调用 `useStreamChat.reconnect()`） |
| 初始化分析页（`app/pages/dashboard/cases/init-analysis/[sessionId].vue`） | `watch(runStatus)`：failed → 错误 toast + 恢复入口（`phase === 'running'` 时根据情况调 `resumeWorkflow()` 或 `retryModule(moduleName)`）；cancelled → 静默；传输层断连提示同上 |

### 新增文件

**无**。本方案全部复用现有 API 和 composable 能力。

### 不受影响（明确不改动）

- `server/services/agent/agentEventBridge.ts` — `publishStatusChange` / `replayEvents` / `createEventSubscription` 全部复用，仅事件 payload 多带一个 `error` 字段（透传无感知）
- `server/api/v1/case/analysis/runs/current/[sessionId].get.ts` — 不调用、不修改
- `server/services/workflow/tools/types.ts` — `ToolContext` 接口不扩展 `signal` 字段，abort 信号透传到工具层是独立优化项，不在本次范围
- `app/composables/useChatSessionManager.ts` — xiaosuo / module 对话的刷新恢复逻辑已实现（`hasActiveRun → reconnect() / loadHistory()`），本设计不触碰
- `app/composables/useInitAnalysis.ts` 的 `loadStatus()` / `startAnalysis()` / `resumeWorkflow()` / `retryModule()` 等核心方法 — 初始化分析页的恢复逻辑已实现，本设计只在页面组件层新增 `watch(runStatus)` 接入失败提示 UI，不改动 composable 本身
- `server/services/workflow/caseAnalysisV2.workflow.ts` 的 `failedModules` 机制 — 模块级部分失败逻辑保持原样，与本方案的 `runStatus: failed` 语义互补
- `app/composables/useCaseChat.ts` / `app/composables/useModuleChatManager.ts` — 通过 `useStreamChat` 自动获得新增状态，不需要改动
- checkpoint 机制 / `getThreadValuesService` — 重试时自然从 checkpoint 恢复
- 现有 interrupt 处理（积分不足等）— 由 `interruptData` 覆盖，保持不变
- `FetchStreamTransport` — 不扩展、不继承、不包装

## 风险评估

### 低风险
- `withTimeout` 兜底超时不影响正常执行（35s > execFile 的 30s）
- `runStatus` / `runError` / `connectionStatus` 是新增派生状态，不影响现有逻辑
- `AgentStatusEvent` 新增 `error?: string` 字段为可选字段，现有消费方（Redis / Stream 序列化）不会出错
- "重试"按钮本质上是重新 submit 消息，与用户手动输入等价
- "重新连接"按钮调用 `useStreamChat.reconnect()`（已存在的方法），内部 `s.submit(undefined)` 触发后端 replay

### 需要验证的点

1. **两个 SSE 端点的 `event: status` 改动必须同步完成**：
   - `chat.post.ts` 和 `init-analysis.post.ts` 是两个独立端点，改动**必须同时进行**
   - 如果只改一个，另一个对话链路的 FAILED 仍会被 useStream 静默丢弃
   - 项目内全局搜索 `event: status` / `EventSource` 确认没有其他消费方
   - 初步排查：只有 `useStream` 走 FetchStreamTransport 路径消费这两个端点
2. **`useModuleChatManager.ts:69` 兼容性确认**：
   - 现有代码 `if (eventData.name === 'analysis_result_saved')` 收到 `AgentStatusEvent` 对象（无 `name` 字段）时不会误触，但需在 code review 时再次确认
3. **`onCustomEvent` 透传顺序**：
   - `useStreamChat.ts` 在 `onCustomEvent` 拦截 `status_change` 时必须透传其他 custom 事件，不能覆盖 `options.onCustomEvent`
4. **cancelled 静默的准确性**：
   - 需确认 `agentWorker.ts:303` 的 `isCancelled = errorMessage.includes('cancelled') || errorMessage.includes('aborted')` 判断覆盖了所有"用户主动取消"的路径（前端 `stop()`、API `cancelRunService`、SSE abort 等）
5. **reconnect 已完成 run 的状态持久化**：
   - 如果 run 已 FAILED 后用户点"重新连接"，`chat.post.ts` 会走"无活跃 run + 无消息"分支发 checkpoint 后 return，**不会重新发送 status_change**
   - 前端 `runError` 保留之前的值不变（不会被清空）→ UI 表现与预期一致
6. **Redis Stream 补发 status_change 的时序**：
   - replay 分支（`chat.post.ts:318` 的 else 出口、`init-analysis.post.ts:377` 的 lastMissed 出口）会补发**所有** status_change（包括中间 RUNNING）
   - 实时订阅分支（`chat.post.ts:333`、`init-analysis.post.ts:385`）只发 TERMINAL 状态的 status_change
   - 前端 `onCustomEvent` 拦截逻辑对两种路径都生效；首次连接期间 RUNNING 事件收不到是已知行为，本方案不处理
7. **`event: custom` 通道语义契约更新**：
   - 原注释"必须发完整事件对象（含 name 字段），前端依赖 evt.name 判断事件类型"必须同步更新为"承载 AgentCustomEvent 和 AgentStatusEvent 两类事件，按 `data.type` 区分"
   - 更新后任何新增 custom 事件类型需遵守此契约
8. **`failedModules` 与 `runStatus` 在同一次刷新中同时出现的可能性**：
   - 虽然语义上互补（模块级部分失败 vs run 整体失败），但极端情况下 workflow 代码可能在写入 `failedModules` 后仍抛出未捕获异常到 worker 层
   - 此时前端同时收到 `failedModules`（卡片显示）和 `runStatus: 'failed'`（顶部 toast），UI 效果是叠加而非重复，属于可接受的行为
   - 实施时需 review `caseAnalysisV2.workflow.ts` 的 catch 分支确认不会这样双发
9. **`useInitAnalysis` 的 `stream.isLoading` watch 不处理 FAILED 分支**：
   - 当前 `useInitAnalysis.ts:308-313` 只做跨标签广播，没有错误 UI 处理
   - 初始化分析页组件必须 `watch(runStatus)` 接入 toast，否则场景 2 的信号链路打通对 init-analysis 无效

### 明确放弃的方案（及放弃原因）

- ❌ 扩展 / 继承 / 包装 `FetchStreamTransport` — 需重写 SSE 解析，破坏面大
- ❌ 心跳超时 setInterval 轮询 — 依赖浏览器 fetch 错误事件已足够
- ❌ 指数退避自动重连 — 手动按钮更可控
- ❌ 重新创建 useStream 实例 — 会破坏 `useCaseChat` / `useInitAnalysis` 上层响应式引用
- ❌ 新增 `runs/latest` API — 场景 4 两条链路（xiaosuo/module 用 `useChatSessionManager`、init-analysis 用 `useInitAnalysis.loadStatus()`）都已覆盖
- ❌ 在对话页面 `onMounted` 中查询 `runs/current` 并触发 reconnect — 与现有恢复逻辑重复，会导致 run_events Stream 被读两次
- ❌ 后端 agentWorker 自动重试 — 与 agent 自身判断冲突，误解了 recursionLimit
- ❌ 使用 `s.error` 判断 FAILED — FAILED 在前端表现为"正常结束"，`s.error` 只在传输层错误时设置
- ❌ 扩展 `ToolContext` 接口增加 `signal: AbortSignal` 字段 — 架构级改动，超出"错误恢复"范围，留作独立优化项
- ❌ 改动 `failedModules` 机制 — 与 `runStatus: failed` 语义互补不冲突，保持不变

## 实施步骤

按优先级分三个阶段，Phase 1 必做，Phase 2/3 观察实际问题后再决定。

### Phase 1（必做 — 核心兜底和失败反馈信号链路）

**后端（6 处改动）**：

1. `shared/types/agentRun.ts` — `AgentStatusEvent` 接口新增 `error?: string` 字段
2. `server/services/agent/agentWorker.ts:314-319` — `publishStatusChange` 调用传入 `error: isCancelled ? undefined : errorMessage`
3. `server/api/v1/case/analysis/chat.post.ts` — `status_change` 事件 SSE 出口标签从 `event: status` 改为 `event: custom`（第 318 行 replay 分支 + 第 333 行实时订阅分支，共两处改行）；同步更新第 314 行和第 354 行两处 custom_event 注释，说明 custom 通道承载 `AgentCustomEvent` 和 `AgentStatusEvent` 两类事件
4. `server/api/v1/case/init-analysis.post.ts` — **与第 3 步对称处理**：三处 `event: status` 改为 `event: custom`（第 361 行 checkpoint 兜底出口 + 第 377 行 replay lastMissed 出口 + 第 385 行实时订阅 terminal 出口）
5. `server/services/workflow/tools/workspace.ts` — 新增 `withTimeout<T>(promise, ms, label)` 通用函数
6. `server/services/workflow/tools/runSkillScript.tool.ts:122-138` — 用 `withTimeout` 包裹 execFile Promise（35s 兜底，比 execFile 的 30s 多 5s）

**前端（3 处改动）**：

7. `app/composables/useStreamChat.ts` — 在 `onCustomEvent` 中识别 `data.type === 'status_change'`，区分 failed / cancelled 分别处理；暴露 `runStatus` / `runError` 响应式状态；其他 custom 事件透传给上层
8. 对话页面组件（xiaosuo / module） — `import { toast } from 'vue-sonner'`；`watch(runStatus)`：failed 弹 toast + 显示"重试"按钮（重发用户最后一条消息）；cancelled 静默
9. 初始化分析页（`app/pages/dashboard/cases/init-analysis/[sessionId].vue`） — `import { toast } from 'vue-sonner'`；`watch(runStatus)`：failed 弹 toast + 根据 `phase` 显示对应操作入口（running 阶段 → `resumeWorkflow()` 或单模块 `retryModule(name)`；complete 阶段不可能出现 failed）；cancelled 静默。**注意** select 阶段尚未启动 stream，不会收到 status_change 事件，无需处理

**端到端验证**：

10. **xiaosuo / module 工具卡住场景**：脚本 sleep 60s → 35s 后 `withTimeout` 抛错 → agent 收到错误决定重试或报错 → 若 agent 最终 FAILED → agentWorker `publishStatusChange` 携带 errorMessage → `chat.post.ts` 走 custom 通道 → useStreamChat 拦截 → 对话页面弹 toast + 重试按钮 → 点击重试 → 成功
11. **init-analysis 失败场景**：workflow 内部代码异常 → agentWorker catch → FAILED → `init-analysis.post.ts` 走 custom 通道 → useStreamChat 拦截 → 初始化分析页弹 toast → 点击 `resumeWorkflow()` 或 `retryModule(name)` → 继续执行 → 成功
12. **手动取消场景**：用户点"停止" → agentWorker 收到 AbortError → CANCELLED 状态 → `publishStatusChange` 无 error → 前端 `runStatus` 变 cancelled → 不弹 toast（两种对话类型分别验证）
13. **场景 4 打通验证 A（xiaosuo / module）**：在 run 运行中主动刷新页面 → `useChatSessionManager` 根据 `hasActiveRun` 调 `reconnect()` → 后端 replay 分支补发历史事件（含 status_change）→ 若已失败 → 前端自动弹 toast
14. **场景 4 打通验证 B（init-analysis）**：在分析运行中刷新页面 → `useInitAnalysis.loadStatus()` 查 init-analysis-status → 发现 in_progress → 调 `stream.submit(undefined)` → 后端 replay → 若已失败 → 前端自动弹 toast

### Phase 2（按需 — 传输层断连提示）

15. `app/composables/useStreamChat.ts` — 暴露 `connectionStatus` 派生状态（依赖 Phase 1 的 `runStatus`）
16. 对话页面组件 + 初始化分析页 — `watch(connectionStatus)`：disconnected 显示"重新连接"按钮（调用 `useStreamChat.reconnect()`）

**说明**：场景 4 的页面刷新恢复**不在 Phase 2**，已由现有 `useChatSessionManager` / `useInitAnalysis.loadStatus()` 覆盖。

### Phase 3（暂不实施 — 仅在实际出现问题时考虑）

- 心跳检测（仅在真实遇到"TCP 活着但 SSE stall"场景时才引入）
- 自动重连指数退避（仅在用户反馈手动点击不便时才引入）
- 工具层内部自重试（仅对特定错误码，且必须在单个 tool handler 内，不放 worker 层）
- 刷新后展示历史失败原因（仅当用户明确要求时，扩展 session 列表接口返回 `lastRunError`）
