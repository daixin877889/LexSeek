# 前端 SSE 流自动重连机制设计

- **创建日期**：2026-05-09
- **作者**：戴鑫 + Claude (brainstorming)
- **目标读者**：前端 / 全栈开发者
- **关联线上现象**：案件分析页第 4 步出现"分析中断：network error"（spinner 卡住，红色 banner，提示重新分析），但后端 Worker 实际仍在跑或已跑完。

---

## 1. 背景与问题

### 1.1 后端架构（不动）

- HTTP API（Nitro）入队 `agentRuns` → 立即返回 SSE 流
- AgentWorker（独立任务循环）消费 PENDING run、执行 LangGraph、把事件写入 Redis Pub/Sub + Redis Stream（保留 7 天），状态按 step 持久化到 PostgresSaver（`langgraph` schema）
- SSE 端点（`server/services/sse/agentSseStream.ts`）订阅 Redis 转发给前端；`req.on('close')` 仅取消该端点的 Redis 订阅，**不影响 Worker**
- Worker 真正会停的入口：`cancelRunService` 通过 Redis pub `run_cancel:<runId>` 通知；除此之外只看自身超时、shutdown、心跳丢失

**结论**：后端"任务可恢复"基础设施完整（checkpoint replay + Redis Stream 补发 + active run 重连），前端只要"换条 TCP 重新订阅"就能续上。

### 1.2 前端现状（待改）

- 统一底层：`app/composables/useStreamChat.ts` 是所有 SSE 业务（通用问答 / 合同审查 / 文档起草 / 案件分析对话 / 案件初始化分析）的共同入口（直接用或经 `app/composables/agent-platform/useDomainAgentSession.ts` 包装）
- `useStreamChat.ts:408-417` 的 `onError` 一收到 fetch / 流错误就 `runStatus='failed' + runError`，不重试
- 已有但未自动调用的 `reconnect()` 方法：`useStreamChat.ts:508-514`
- **完全没有** `online` / `offline` / `visibilitychange` 监听
- store 中**没有持久化** runId（不需要新增；后端 active run 重连依赖的是 sessionId，已经在 thread 里）

### 1.3 拍板结论（brainstorming 已确认）

| 决策点 | 结论 |
|---|---|
| 重连过程用户感知 | **无感自愈**：界面继续 loading，重连耗尽才报错 |
| 失败到上限后"重新分析"按钮语义 | **续跑优先**：先查后端状态，可续则续，无活跃 run 才从头跑 |
| 改造层级 | **底层一刀切**：改 `useStreamChat`，5 个 vertical 同步受益 |

---

## 2. 改动范围

### 2.1 改动文件

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `app/composables/useStreamChat.ts` | 改造 | 主战场：替换 `onError`、新增重试调度器、新增网络/可见性监听 |
| `app/composables/initAnalysis/useInitAnalysisRuntime.ts` | 改造 | 新增 `restartAnalysis()` 函数实现"续跑优先"，替换原 `startAnalysis()` 在重连耗尽场景的调用 |
| `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | 改造 | "重新分析"按钮 handler 改调 `restartAnalysis()`（仅一行） |
| `tests/client/composables/useStreamChat.reconnect.test.ts` | 新增 | 单元测试 |
| `tests/client/composables/initAnalysisRuntime.restart.test.ts` | 新增 | restartAnalysis 单元测试 |

### 2.2 不改动

- 后端任何文件（基础设施已就位）
- `app/composables/agent-platform/useDomainAgentSession.ts`（透明受益）
- 其他 4 个 vertical 的 runtime / 页面（透明受益）
- `useStreamChat` 现有公开 API 形状不破坏：`messages` / `values` / `isLoading` / `runStatus` / `runError` / `submit` / `stop` / `reconnect` / `loadHistory` / `subThreadsMap` / `syntheticToolCalls` / `interruptData` / `getMessagesMetadata` / `handleAgentEvent` / `reset` / `hasHistoryLoaded` 全部保留
- 红色"分析中断"banner / "重新分析"按钮的视觉（`[sessionId].vue:35`）

**新增的内部 state（标 `@internal`，仅供单测断言，不算公开 API）**：

- `reconnectState`（`reactive`）：`{ attempts: number; isRetrying: boolean }`
- export 出去但 JSDoc 标 `@internal`，业务方禁止读取/写入

> 不再需要 `userStopped` flag —— `submit-coordinator.js:200` 已在 `abort.signal.aborted` 时直接 `return` 跳过 `onError`，stop() 路径天然不会触发重连。
> 不再需要 `nextDelayMs` 字段 —— 退避间隔由公式确定，调试时可从 `attempts` 现算。

### 2.3 非目标（明确不在本设计范围）

- 不引入"用户切换网络环境的轻量提示"toast / banner（因选了"无感自愈"）
- 不持久化"正在进行的 runId" 到 localStorage（后端 active run 检测已够用）
- 不改后端 SSE 端点 / Worker / Redis Stream 配置
- 不改"重新分析"按钮的视觉
- 不改其他 vertical 的"停止/取消"按钮行为（与本设计无关）

---

## 3. 详细设计

### 3.1 触发条件（什么样的错误重连）

**关键事实**（已读 SDK 源码核对）：`@langchain/langgraph-sdk` 1.8.10 的 `FetchStreamTransport.stream` 对所有非 2xx 响应都 `throw new Error('Failed to stream: ' + statusText)`，**无 status 字段**。所以前端无法可靠区分 4xx / 5xx，只能区分"传输层错误 vs 用户主动 abort vs 业务终态"。

| 错误来源 | 是否重连 | 判定方式 |
|---|---|---|
| `fetch` 抛异常（网络断、DNS 失败、TLS、CORS） | ✅ | onError 触发，且不属于下列例外 |
| `Failed to stream: <statusText>`（SDK 包装的 HTTP 非 2xx） | ✅ | 同上——无法精细区分 4xx/5xx，统一重试，让退避上限兜底"持续 4xx 也不会无限刷" |
| ReadableStream 读到一半中断 | ✅ | onError 触发 |
| 用户主动 `stop()` 触发的 abort | ❌ | SDK 在 `abort.signal.aborted` 时已跳过 onError；额外用 `error.name === 'AbortError'` 或 message 含 `'aborted'` 防御 |
| 后端 SSE 推送的 `status_change=failed`（业务终态） | ❌ | 走 `onCustomEvent` 现有 `runStatus='failed'` 分支，**不进 onError**，自然不重连 |

**判定函数**（实际在 `useStreamChat.ts` 内）：

```ts
function shouldRetry(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { name?: string; message?: string }
  // 用户主动 stop / unmount 引发的 abort，不重连
  if (err.name === 'AbortError') return false
  if (typeof err.message === 'string' && err.message.toLowerCase().includes('aborted')) return false
  return true
}
```

> 401 重连解决不了——但即便重连也只是再被打回，5 次后耗尽进 failed 终态，不会"刷屏"。简化的代价仅是"账号过期场景下多浪费 31s 才提示用户"——可接受。如果未来 401 在 SSE 端点出现成普遍现象，再补 `useApiFetch` 那种 401 全局拦截即可。

### 3.2 退避策略

- **次数上限**：5 次
- **基础间隔**：1s / 2s / 4s / 8s / 16s（指数退避，base=1000ms，factor=2）
- **抖动**：每次实际等待时间 = `base * (2 ** (attempt - 1)) * (1 + random(-0.2, 0.2))`，避免雷鸣群
- **总最大等待**：约 31s ± 6s，超过后认为彻底失败
- **状态变量**：`reconnectState: { attempts: number; isRetrying: boolean }`，`reactive`，主要供测试 / 调试，**不暴露给业务 UI**

### 3.3 主动唤醒（不傻等）

**复用项目已装的 `@vueuse/core@14.1.0`**（自带 SSR 守卫与自动清理，比手写 `window.addEventListener + onScopeDispose` 更稳）：

```ts
import { useEventListener, useDocumentVisibility } from '@vueuse/core'

const wakeup = () => {
  if (!reconnectState.isRetrying) return
  if (currentRetryTimer) clearTimeout(currentRetryTimer)
  triggerReconnect()
}

// SSR 期间 useEventListener 自动跳过；客户端 onScopeDispose 自动清理
useEventListener(globalThis.window, 'online', wakeup)

// 切回 visible 时唤醒
const visibility = useDocumentVisibility()
watch(visibility, (v) => { if (v === 'visible') wakeup() })
```

效果：用户在地铁断网恢复 / 切回标签页时，立刻发起重连而不是等下一个退避周期。

> 不直接写 `window.addEventListener` 的两个理由：①项目惯例所有客户端 API 必须用 `import.meta.client` 守卫（`useApiFetch.ts:82`、`useColorMode.ts:14` 等），VueUse 自动等价；②不想再单独写 cleanup。

### 3.4 状态语义（"无感"的实现细节）

重连期间：

- `runStatus` **保持上一次值**（典型 `'running'`），不暴露 `'reconnecting'` 给业务方（避免业务页误判）
- **`isLoading` 必须由本 composable 兜底**——已读 `submit-coordinator.js:189-287` 确认：SDK 在 submit 失败的 catch 后 `finally` 一定置 `isLoading=false`，所以退避等待期间 SDK 的 `isLoading` 会**短暂回 false**。本 composable 顶层提供 `coverIsLoading` computed 暴露给业务方：

  ```ts
  const coverIsLoading = computed(() => s.isLoading.value || reconnectState.isRetrying)
  // 返回对象里把 isLoading 替换为 coverIsLoading（保持原字段名，业务方无感知）
  ```
- `runError` 保持上一次值（一般为空字符串）
- 已有的 `messages` / `values` **不清空**：依赖 `useStreamChat.ts:437-442` 已有的 `lastNonEmptyMessages` cache + replay 后覆盖式更新

重连成功（任意一帧 SSE 数据到达）：

- `reconnectState.attempts` 复位为 0
- `reconnectState.isRetrying = false`
- 业务方无感知

重连耗尽（5 次都失败）：

- `runStatus = 'failed'`
- `runError = '网络连接异常，请检查网络后重试'`（替换原英文 `'流错误'` 文案）
- 后续不再自动重试，等用户点"重新分析"

### 3.5 "重新分析"按钮行为（续跑优先）

新增 `useInitAnalysisRuntime.ts` 中的 `restartAnalysis()`：

```ts
async function restartAnalysis() {
  // 1. 复位 stream 错误态，让 watch(runStatus) 重新工作
  stream.reset()

  // 2. 查后端状态
  const status = await useApiFetch<InitAnalysisStatusResponse>(
    `/api/v1/cases/init-analysis-status/${caseId.value}`,
    { query: { sessionId: sessionId.value } },
  )

  // 3. 决策续跑还是重起
  if (status?.status === 'in_progress' || status?.status === 'completed') {
    // 后端有活跃或刚完成的 run → 重新订阅，让 SSE 端点走 replay/checkpoint 路径
    phase.value = status.status === 'completed' ? 'complete' : 'running'
    refreshGlobalStatus(status)
    stream.submit(undefined)
  } else {
    // 后端无活跃 run（一般是已 cancelled / 不存在）→ 重新发起
    startAnalysis()
  }
}
```

`[sessionId].vue` 把 `onRestartAnalysis()` 的实现从 `startAnalysis()` 改为 `restartAnalysis()`（仅一行）。

不调 `cancelRunService`，理由：保留后端 Worker 已经跑出的成果（积分按步扣，不该浪费）。

### 3.6 与现有 `stop()` / `cancel` 路径的关系

- `useStreamChat.ts:504-507` 的 `stop()` 是用户**主动取消**入口（"停止生成"按钮），保持原行为：本地置 `runStatus='cancelled'` + 调底层 `s.stop()`
- 用户主动 stop 时**天然不触发重连**——已读 `submit-coordinator.js:200` 确认：abort 后 SDK 直接 `return`，**根本不会调 onError**。本 composable 的 `onError` 拿到的不会是 abort
- **额外防御**：`shouldRetry()` 函数仍会拒绝 `error.name === 'AbortError'` 或 message 含 `'aborted'` 的错误（覆盖 race condition / 浏览器实现差异）
- 用户主动 `submit(...)`（重新发起或续跑）时由 `useStream` 内部 abort 旧 run 后重新创建 abort，自然走新路径；本 composable 在 onError 之外的成功路径里复位 `reconnectState.attempts = 0`
- `reset()` 公开方法不动（业务方继续用它复位 `runStatus='idle'`），但内部追加复位 `reconnectState.attempts=0; isRetrying=false`

---

## 4. 控制流

```
[fetch / stream 出错]
    ↓
[onError 拦截]
    ↓
[shouldRetry?] ─── no ──→ runStatus='failed' (现状行为)
    ↓ yes
[reconnectState.attempts < 5?] ─── no ──→ runStatus='failed' + 友好文案
    ↓ yes
[isRetrying=true; setTimeout(delay)]
    ↓ (online/visibilitychange 可提前唤醒)
[triggerReconnect()] → s.submit(undefined)  ← 利用 useStream 拉 thread 历史
    ↓
   ┌── 成功（任意一帧到达）→ attempts=0, isRetrying=false  ✅
   └── 再次失败 → attempts++ → 回到 [shouldRetry?]
```

---

## 5. 测试策略

### 5.1 单元测试（`tests/client/composables/useStreamChat.reconnect.test.ts`）

覆盖矩阵（共 6 项）：

1. **触发条件**：mock `useStream` 的 `onError`，断言 `reconnectState.isRetrying` 是否变 true
   - 普通 Error / TypeError / `Error('Failed to stream: 500')` → 重试
   - `Error` with `name='AbortError'` → **不**重试
   - `Error('aborted')` → **不**重试
   - （`status_change=failed` 走 onCustomEvent 而非 onError，不需测试此路径）
2. **退避时序**：`vi.useFakeTimers()` + mock `Math.random()=0.5` 固定 jitter 为 0，断言 5 次重试间隔分别为精确 1000/2000/4000/8000/16000 ms
3. **耗尽行为**：5 次都失败 → `runStatus='failed'` + `runError='网络连接异常，请检查网络后重试'` + `reconnectState.isRetrying=false`
4. **主动唤醒**：在第 3 次重试等待中 `window.dispatchEvent(new Event('online'))` → 定时器被取消、立刻重连（断言 `Math.random` 抽样的 jitter 不影响实际触发时间）
5. **可见性唤醒**：mock `useDocumentVisibility` 返回 ref，从 `'hidden'` 切到 `'visible'` → 同上
6. **重连期间 isLoading 不掉**：mock SDK `isLoading` 在 catch 后置 false，断言 composable 暴露的 `isLoading.value === true`（来自 `coverIsLoading`）
7. **重连成功复位**：第 1 次失败、第 2 次成功 → `attempts=0`、`isRetrying=false`、`runStatus` 全程未置 `'failed'`、`messages` 不清空
8. **unmount 清理**：组件 unmount 后再 dispatch online → 不产生重连请求（验证 VueUse 的自动清理）

### 5.2 单元测试（`tests/client/composables/initAnalysisRuntime.restart.test.ts`）

1. `restartAnalysis()` + 后端返回 `status='in_progress'` → 调 `stream.submit(undefined)`，不调 `startAnalysis`
2. `restartAnalysis()` + 后端返回 `status='completed'` → 调 `stream.submit(undefined)`，phase 置 'complete'
3. `restartAnalysis()` + 后端返回 `status='not_started'` → 调 `startAnalysis`（重新提交）
4. `restartAnalysis()` 不调用 cancel API（mock cancel 接口断言未被请求）

### 5.3 集成测试（`tests/integration/`，按已有约定）

- 走真实 `init-analysis` 路径，mock 第 4 步 SSE 流被 reader 抛错 → 验证：
  - 前端自动重连后从 Redis Stream replay 拿到完整结果
  - UI 不出现"分析中断"
  - `runStatus` 最终落到 `completed`

### 5.4 E2E 验证（chrome-devtools MCP，不算 CI 必跑）

- 打开案件初始化分析页，触发 `mcp__chrome-devtools__emulate` 切到 offline → 等 3 秒 → 切回 online
- 断言：步骤进度未中断、Worker 跑完后 UI 正确收尾，无红色 banner

### 5.5 不写测试

- `online` / `visibilitychange` 在 jsdom 里能 dispatch，单测覆盖即可
- 红色 banner 视觉已在生产截图验证，不写视觉回归

---

## 6. 已知风险与权衡

| 风险 | 缓解 |
|---|---|
| `s.submit(undefined)` 拉 thread 历史可能闪一下旧 token，给用户错觉"在重新跑" | 已有 `lastNonEmptyMessages` cache 兜底；测试用例 6 验证 messages 不清空 |
| 退避总等待 ~31s，期间用户可能误以为页面卡死 | 选了"无感自愈"已接受这个权衡；若线上反馈强烈，下个版本可降到 3 次 / ~13s |
| `navigator.onLine` 在 VPN / Wi-Fi 切换场景下不可靠 | 双保险：online 不准没事，定时器照样触发；visibilitychange 是补充 |
| 重连期间用户主动点"停止"按钮 | SDK abort 后跳过 onError；`shouldRetry` 再防御 `AbortError`，不进重连分支 |
| 持续传输错误（含 5xx）不退避把后端打挂 | 5 次上限 + jitter 防雷鸣群；后端本来就有限流（API gateway 层） |
| 重连依赖后端 active run 检测；若后端已把 run 判 cancelled，重连等于傻刷 | `init-analysis.post.ts:221-232` 现状是"有活跃 run 重连，无则创建新 run"。重连只发 `submit(undefined)`，不会创建新 run；这部分行为不动 |

---

## 7. 实施阶段建议（供 writing-plans 阶段拆分）

1. **阶段 A**：`useStreamChat.ts` 内嵌重试调度器 + 网络/可见性监听（含单测 5.1）
2. **阶段 B**：`useInitAnalysisRuntime.ts` 新增 `restartAnalysis()` + `[sessionId].vue` 切换调用（含单测 5.2）
3. **阶段 C**：集成测试（5.3）
4. **阶段 D**：chrome-devtools E2E 抽样验证（5.4）

阶段 A 是基础设施，阶段 B 依赖阶段 A 的行为契约（"耗尽后置 failed + 友好文案"）。建议按 A → B → C → D 顺序实施，每阶段完成跑对应测试，最后跑全量 `bun run test`。

---

## 8. 决策记录（不再讨论的事项）

- 改造层级：useStreamChat 一刀切（不抽独立 composable，不引入 retryConfig 选项 — YAGNI）
- 触发条件：onError 一律重试（AbortError 例外）；不细分 4xx/5xx——SDK 抛的 Error 没有 status，细分是假精确
- 退避：5 次 1/2/4/8/16s + ±20% jitter
- 主动唤醒：online + visibilitychange 双监听，**复用 `@vueuse/core` 的 `useEventListener` + `useDocumentVisibility`**
- 用户感知：无感（不显示重连进度提示）；通过 `coverIsLoading` 兜底 SDK 在退避期间 `isLoading=false` 的副作用
- 失败终态：沿用红色 banner + "重新分析"按钮
- "重新分析"语义：续跑优先（先查后端状态再决定）
- 不调 cancel API（保留 Worker 成果）
- 不持久化 runId 到 localStorage（依赖后端 active run 检测）
- 不引入新的 Pinia store
- 不新增 `userStopped` flag——SDK abort 后已跳过 onError；`AbortError` name 判定作为防御兜底

## 8.5 5check 修订摘要（2026-05-09）

通过 5 维度审查发现的技术 bug + 复用基建漏，已修订（业务/架构未变）：

| 修订点 | 原 spec | 修订后 | 理由 |
|---|---|---|---|
| 4xx/5xx 区分 | 按 `error.status` 区分重连 | 一律重连，AbortError 除外 | SDK `transport.js:21` 抛的 Error 无 status 字段 |
| `userStopped` flag | 新增 | 删除 | SDK `submit-coordinator.js:200` abort 后跳过 onError |
| `nextDelayMs` 字段 | 暴露 | 删除 | 可从 attempts 现算，无暴露价值 |
| 监听器实现 | 手写 `window.addEventListener` | 改用 `useEventListener` + `useDocumentVisibility` | 项目已装 @vueuse/core 14.1.0；自带 SSR 守卫与自动清理 |
| `isLoading` 兜底 | 标"待验证" | 落实为 `coverIsLoading` computed | 已读 SDK 源码确认 SDK 在 catch finally 一定置 false |
| 单测矩阵 | 8 项含 status 区分 | 6 项不含 status 区分 | 与触发条件简化对齐 |

---

## 9. 关键代码引用（实施时锚点）

- `app/composables/useStreamChat.ts:408-417` — 当前 `onError` 实现，本设计的主战场
- `app/composables/useStreamChat.ts:437-442` — `lastNonEmptyMessages` cache（重连期间防闪）
- `app/composables/useStreamChat.ts:504-507` — 现有 `stop()`，无需改动；SDK 已通过 `abort.signal.aborted` 抑制 onError
- `app/composables/useStreamChat.ts:508-514` — 现有 `reconnect()`，可被新调度器内部复用
- `app/composables/initAnalysis/useInitAnalysisRuntime.ts:132-212` — `loadStatus` 现成的"查后端状态"逻辑，`restartAnalysis` 可复用其 fetch 调用
- `app/composables/initAnalysis/useInitAnalysisRuntime.ts:214-229` — 现有 `startAnalysis()`，作为 `restartAnalysis` 的 fallback 分支
- `app/pages/dashboard/cases/init-analysis/[sessionId].vue:336-352` — `onRestartAnalysis` handler（仅改一行调用）
- `server/api/v1/cases/init-analysis.post.ts:221-232` — 后端"已有活跃 run 重连而非新建"的现成行为（不动，仅依赖）
- `server/services/sse/agentSseStream.ts:176-217` — 后端 `replayEvents` + checkpoint fallback（不动，仅依赖）
