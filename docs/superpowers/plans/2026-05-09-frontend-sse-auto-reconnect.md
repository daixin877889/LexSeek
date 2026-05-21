# 前端 SSE 自动重连机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有走 `useStreamChat` 的 SSE 业务（通用问答 / 合同审查 / 文档起草 / 案件分析对话 / 案件初始化分析）在网络抖动时无感自愈，重连耗尽后给出友好失败提示并支持"续跑优先"的重新分析。

**Architecture:** 在 `useStreamChat` 底层一刀切：`onError` 接入"指数退避调度器（5 次 / 1·2·4·8·16s + ±20% jitter）"，监听 `online` / `visibilitychange` 主动唤醒；`isLoading` 由 `coverIsLoading` computed 在重连等待期间兜底维持 true；耗尽后置 `runStatus='failed'` + 友好文案。`useInitAnalysisRuntime` 新增 `restartAnalysis()`：先查后端状态决定续跑 (`stream.submit(undefined)`) 还是重起 (`startAnalysis()`)，不调 cancel API。后端基础设施（Redis Stream replay + PostgresSaver checkpoint + active run 重连）已就位，本次不动。

**Tech Stack:** Vue 3 Composition API + `@langchain/vue@0.4.7` (`useStream` / `FetchStreamTransport`) + `@langchain/langgraph-sdk@1.8.10` + `@vueuse/core@14.1.0` (`useEventListener` / `useDocumentVisibility`) + Vitest（`environment: 'nuxt'` 基于 jsdom）。

**Source spec:** `docs/superpowers/specs/2026-05-09-frontend-sse-auto-reconnect-design.md`

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `app/composables/useStreamChat.ts` | 改造 | 新增重连调度 / 主动唤醒 / coverIsLoading 兜底 / reset 增强 |
| `app/composables/initAnalysis/useInitAnalysisRuntime.ts` | 改造 | 新增 `restartAnalysis()` 函数并在 return 暴露 |
| `app/composables/initAnalysis/types.ts` | 改造 | `RuntimeExposed` 新增 `restartAnalysis` 字段 |
| `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | 改造 | `onRestartAnalysis` 改调 `restartAnalysis`（替换 `startAnalysis`） |
| `tests/client/composables/useStreamChat.reconnect.test.ts` | 新建 | useStreamChat 重连单元测试（覆盖 7 个用例） |
| `tests/client/composables/useInitAnalysisRuntime.restart.test.ts` | 新建 | restartAnalysis 单元测试（覆盖 4 个用例） |

每个 Task 一次提交。最后一次 Task 7 是 chrome-devtools E2E 抽样验证（不入 CI）。

---

## 共享测试基建（Task 1 创建后被 Task 1-4 复用）

`useStreamChat` 是 setup-time composable，依赖 `@langchain/vue` 的 `useStream` + `FetchStreamTransport`。本基建**对齐项目内现成模式** `tests/client/composables/useStreamChat.test.ts`：用 module-scope const + 顶层 `await import` + `Object.defineProperty` 模拟 SDK 的 ES6 getter；不用 `vi.hoisted`，vitest 4.x 现成支持。

由于 Task 4 需要验证 `useEventListener` / `useDocumentVisibility` 在 unmount 时的清理行为，本基建用 `mount(Wrapper)` 把 `useStreamChat` 包在 Vue setup 里跑（注册到组件 effect scope），与项目原 `useStreamChat.test.ts` 直接调 `buildChat()` 的差别仅此一点。

测试文件起始模板（在 Task 1 创建，后续 Task 仅追加 `it()`）：

```ts
/**
 * useStreamChat 自动重连机制测试
 *
 * **Feature: stream-chat-auto-reconnect**
 * **Validates: docs/superpowers/specs/2026-05-09-frontend-sse-auto-reconnect-design.md §3.1-§3.6**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowRef, defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

// ── mock @langchain/vue ──────────────────────────────────────────────
// 对齐项目内 useStreamChat.test.ts：useStreamCustom 返回的 values/messages 是 ES6 getter，
// 用 Object.defineProperty 模拟，让 Vue computed 可追踪到底层 shallowRef。

const captured: { options: any } = { options: null }
const mockSubmit = vi.fn()
const mockStop = vi.fn()
const mockGetMessagesMetadata = vi.fn()

const mockIsLoading = shallowRef(false)
let mockValuesRef = shallowRef<any>(null)
let mockMessagesRef: any[] = []

vi.mock('@langchain/vue', () => ({
  // 必须用普通函数（非箭头函数）才能被 new 调用
  FetchStreamTransport: vi.fn().mockImplementation(function () { return {} }),
  useStream: vi.fn((options: any) => {
    captured.options = options
    const obj: Record<string, any> = {
      isLoading: mockIsLoading,
      error: shallowRef(null),
      submit: mockSubmit,
      stop: mockStop,
      getMessagesMetadata: mockGetMessagesMetadata,
    }
    Object.defineProperty(obj, 'values', {
      get() { return mockValuesRef.value },
      enumerable: true,
    })
    Object.defineProperty(obj, 'messages', {
      get() { return mockMessagesRef },
      enumerable: true,
    })
    return obj
  }),
}))

// 动态导入：确保 mock 已注册
const { useStreamChat } = await import('~/composables/useStreamChat')

// mountChat 把 useStreamChat 包在组件 setup 里跑，让 useEventListener /
// useDocumentVisibility 正确注册到组件 effect scope（unmount 时自动清理）
function mountChat() {
  const Wrapper = defineComponent({
    setup() {
      const chat = useStreamChat({ apiUrl: '/api/v1/cases/init-analysis' })
      ;(globalThis as any).__chat = chat
      return () => h('div')
    },
  })
  return mount(Wrapper)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  captured.options = null
  mockSubmit.mockReset()
  mockSubmit.mockImplementation(async () => {})
  mockStop.mockReset()
  mockIsLoading.value = false
  mockValuesRef = shallowRef<any>(null)
  mockMessagesRef = []
  delete (globalThis as any).__chat
})

afterEach(() => {
  vi.useRealTimers()
})
```

每个 it() 内通过 `(globalThis as any).__chat` 取到 useStreamChat 返回对象做断言；通过 `captured.options.onError(err)` 触发错误路径；通过 `mockValuesRef.value = {...}` 模拟 SSE 帧到达。

---

### Task 1: 退避调度核心 + onError 接入

**Files:**
- Modify: `app/composables/useStreamChat.ts`
- Create: `tests/client/composables/useStreamChat.reconnect.test.ts`

- [ ] **Step 1: 创建测试文件并写第一个失败测试**

文件：`tests/client/composables/useStreamChat.reconnect.test.ts`

写入"共享测试基建"模板（见上文 mount/mock 部分），然后在末尾追加：

```ts
describe('useStreamChat reconnect - retry scheduling', () => {
  it('triggers retry on transport error and resubmits with undefined', async () => {
    const w = mountChat()
    await nextTick()
    expect(captured.options).not.toBeNull()

    // 触发传输层错误（SDK 抛出的"Failed to stream: 500"形态）
    captured.options!.onError!(new Error('Failed to stream: 500'))
    await nextTick()

    const chat = (globalThis as any).__chat
    expect(chat.reconnectState.isRetrying).toBe(true)
    expect(chat.reconnectState.attempts).toBe(1)

    // 推进到第 1 次重试间隔（Math.random 默认未 mock，区间 [800, 1200]）
    vi.advanceTimersByTime(1200)
    await nextTick()
    expect(mockSubmit).toHaveBeenCalledWith(undefined)

    w.unmount()
  })

  it('does NOT retry on AbortError', async () => {
    mountChat()
    await nextTick()

    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    captured.options!.onError!(abortErr)
    await nextTick()

    const chat = (globalThis as any).__chat
    expect(chat.reconnectState.isRetrying).toBe(false)
    expect(chat.reconnectState.attempts).toBe(0)
  })

  it('does NOT retry on error with message containing "aborted"', async () => {
    mountChat()
    await nextTick()

    captured.options!.onError!(new Error('The operation was aborted'))
    await nextTick()

    const chat = (globalThis as any).__chat
    expect(chat.reconnectState.isRetrying).toBe(false)
  })

  it('uses exponential backoff schedule (1/2/4/8/16s) with jitter', async () => {
    // 固定 jitter 系数为 0（Math.random=0.5 → -0.2~+0.2 中点 → 1+0=1）
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    mountChat()
    await nextTick()

    const expected = [1000, 2000, 4000, 8000, 16000]
    for (let i = 0; i < 5; i++) {
      mockSubmit.mockClear()
      captured.options!.onError!(new Error('boom'))
      await nextTick()

      // 间隔不到时不会重试
      vi.advanceTimersByTime(expected[i]! - 50)
      await nextTick()
      expect(mockSubmit).not.toHaveBeenCalled()

      vi.advanceTimersByTime(100)
      await nextTick()
      expect(mockSubmit).toHaveBeenCalledOnce()
    }
  })
})
```

- [ ] **Step 2: 跑测试见失败**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts --reporter=verbose
```

期望：4 个 it 全部失败，原因 `chat.reconnectState is undefined`（还没实现）。

- [ ] **Step 3: 在 useStreamChat 内部添加重连调度器（修改 `app/composables/useStreamChat.ts`）**

在 `useStreamChat` 函数体内部、`const transport = new FetchStreamTransport(...)` 之后、`const runStatus = ...` 之后，**新增**以下代码块（放到现有 `subThreadsMap` reactive 声明之前即可）：

```ts
    // ===== 自动重连：内部 state（@internal，仅供单测断言）=====
    const RETRY_MAX_ATTEMPTS = 5
    const RETRY_BASE_MS = 1000
    const RETRY_FACTOR = 2
    const RETRY_JITTER = 0.2

    /** @internal */
    const reconnectState = reactive({
        attempts: 0,
        isRetrying: false,
    })

    let currentRetryTimer: ReturnType<typeof setTimeout> | null = null

    function shouldRetry(error: unknown): boolean {
        if (!error || typeof error !== 'object') return false
        const err = error as { name?: string; message?: string }
        // 用户主动 stop / unmount 引发的 abort，不重连
        if (err.name === 'AbortError') return false
        if (typeof err.message === 'string' && err.message.toLowerCase().includes('aborted')) return false
        return true
    }

    function computeRetryDelay(attempt: number): number {
        const base = RETRY_BASE_MS * Math.pow(RETRY_FACTOR, attempt - 1)
        // jitter ∈ [-RETRY_JITTER, +RETRY_JITTER]
        const jitter = (Math.random() * 2 - 1) * RETRY_JITTER
        return Math.round(base * (1 + jitter))
    }

    function triggerReconnect() {
        if (currentRetryTimer) {
            clearTimeout(currentRetryTimer)
            currentRetryTimer = null
        }
        // submit(undefined) 让 SDK 拉 thread 历史并重新订阅
        // 错误会再次进入 onError，由调度器决定下一步
        s.submit(undefined).catch(() => { /* swallowed: onError handles */ })
    }

    function scheduleRetry() {
        if (reconnectState.attempts >= RETRY_MAX_ATTEMPTS) {
            // 耗尽：进入失败终态，由 Task 3 完善文案；此处先维持现状文案
            reconnectState.isRetrying = false
            runStatus.value = 'failed'
            return
        }
        reconnectState.attempts += 1
        reconnectState.isRetrying = true
        const delay = computeRetryDelay(reconnectState.attempts)
        currentRetryTimer = setTimeout(triggerReconnect, delay)
    }
```

然后修改 `streamOptions.onError`（约第 408-417 行）：

**改前**：
```ts
        onError: (error: any) => {
            console.error('[useStreamChat] 流错误:', error)
            // spec §8.1 #1 P0 follow-up：前端 fetch 错误（网络/4xx/5xx）
            // 应本地将 runStatus 置为 'failed'，让 dispatcher 的 watch 触发暂停分支、
            // UI 层展示失败状态，避免队列卡死 + 用户无感知。
            runStatus.value = 'failed'
            runError.value = typeof error === 'string'
                ? error
                : (error?.message || '流错误')
        },
```

**改后**：
```ts
        onError: (error: any) => {
            console.error('[useStreamChat] 流错误:', error)
            // 自动重连：传输层错误（含被 SDK 包成 Error 的 HTTP 非 2xx）走退避重试，
            // AbortError 与含 aborted 字样的错误（用户 stop / unmount）走失败终态。
            if (shouldRetry(error)) {
                scheduleRetry()
                return
            }
            runStatus.value = 'failed'
            runError.value = typeof error === 'string'
                ? error
                : (error?.message || '流错误')
        },
```

最后在 `useStreamChat` 的 return 对象（约第 444-533 行）末尾追加 `reconnectState` 字段：

```ts
        // 合成工具卡片（按 parentMessageId 索引）
        // 业务方传给 useMessageParser 的第三参 / AiChat 的 extraToolCalls prop
        syntheticToolCalls,

        /** @internal 自动重连状态，仅供单测断言；业务方禁止使用 */
        reconnectState,
    }
}
```

- [ ] **Step 4: 跑测试见通过**

```bash
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts --reporter=verbose
```

期望：4 个 it 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/composables/useStreamChat.ts tests/client/composables/useStreamChat.reconnect.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): useStreamChat 接入指数退避重连调度器

- 新增 reconnectState（@internal）+ shouldRetry / computeRetryDelay / scheduleRetry / triggerReconnect
- onError 改为：传输错误走退避重试，AbortError / aborted 走失败终态
- 退避策略：5 次 1·2·4·8·16s + ±20% jitter
- 暂未做 isLoading 兜底与友好文案，由后续任务补齐
EOF
)"
```

---

### Task 2: 重连成功复位 + isLoading 兜底（coverIsLoading）

**Files:**
- Modify: `app/composables/useStreamChat.ts`
- Modify: `tests/client/composables/useStreamChat.reconnect.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `tests/client/composables/useStreamChat.reconnect.test.ts` 的 `describe('useStreamChat reconnect - retry scheduling', ...)` 块**之后**追加：

```ts
describe('useStreamChat reconnect - success reset & loading cover', () => {
  it('resets reconnectState when stream values arrive after retry', async () => {
    mountChat()
    await nextTick()
    captured.options!.onError!(new Error('Failed to stream: 500'))
    await nextTick()

    const chat = (globalThis as any).__chat
    expect(chat.reconnectState.attempts).toBe(1)
    expect(chat.reconnectState.isRetrying).toBe(true)

    // 模拟首帧 SSE 到达：触发 mockValuesRef 让 watch(() => s.values) 响应
    mockValuesRef.value = { messages: [{ id: '1', type: 'ai', content: 'hi' }] }
    await nextTick()

    expect(chat.reconnectState.attempts).toBe(0)
    expect(chat.reconnectState.isRetrying).toBe(false)
  })

  it('coverIsLoading remains true while waiting between retries', async () => {
    mountChat()
    await nextTick()

    // SDK 失败后 isLoading 会回到 false（SDK finally 行为）
    mockIsLoading.value = false
    captured.options!.onError!(new Error('boom'))
    await nextTick()

    const chat = (globalThis as any).__chat
    // 业务方读到的 isLoading 必须仍为 true（重连等待期）
    expect(chat.isLoading.value).toBe(true)
    expect(chat.reconnectState.isRetrying).toBe(true)
  })

  it('coverIsLoading falls back to false when neither SDK loading nor retrying', async () => {
    mountChat()
    await nextTick()
    const chat = (globalThis as any).__chat
    expect(chat.isLoading.value).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试见失败**

```bash
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts -t 'success reset' --reporter=verbose
```

期望：3 个新增 it 失败（reconnectState 不会复位，且 isLoading 仍是 SDK 原值）。

- [ ] **Step 3: 在 useStreamChat 加 watch 复位 + coverIsLoading**

在 `useStreamChat` 内、`const s = useStream<T>(streamOptions as any) as any` 之后、`const hasHistoryLoaded = ref(false)` 之前，**新增**：

```ts
    // 重连成功：任意一帧 SSE 数据到达即复位计数
    watch(() => s.values, (v: unknown) => {
        if (v != null && reconnectState.isRetrying) {
            reconnectState.attempts = 0
            reconnectState.isRetrying = false
            if (currentRetryTimer) {
                clearTimeout(currentRetryTimer)
                currentRetryTimer = null
            }
        }
    })

    // isLoading 兜底：SDK 在 submit 失败的 finally 一定置 false
    // （submit-coordinator.js:286），重连等待期间业务方需读到 true 才不闪 loading。
    const coverIsLoading = computed<boolean>(() => {
        const sdk = (s.isLoading as { value?: boolean }).value ?? false
        return sdk || reconnectState.isRetrying
    })
```

然后修改 return 对象中的 `isLoading` 字段（原约第 459 行 `isLoading: s.isLoading,`）为：

```ts
        isLoading: coverIsLoading,   // shallowRef → computed<boolean>，业务方原 .value 调用方式不变
```

- [ ] **Step 4: 跑测试见通过**

```bash
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts --reporter=verbose
```

期望：全部 7 个 it（4 + 3）PASS。

- [ ] **Step 5: 提交**

```bash
git add app/composables/useStreamChat.ts tests/client/composables/useStreamChat.reconnect.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): useStreamChat 重连成功复位 + isLoading 兜底

- watch s.values：首帧到达即复位 reconnectState 与 timer
- coverIsLoading computed：SDK isLoading 在 finally 置 false 的间隙由 isRetrying 兜底
- 业务方读到的 isLoading 字段从 shallowRef 改为 computed<boolean>，调用方式（.value）不变
EOF
)"
```

---

### Task 3: 重连耗尽友好文案 + reset() 增强

**Files:**
- Modify: `app/composables/useStreamChat.ts`
- Modify: `tests/client/composables/useStreamChat.reconnect.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `tests/client/composables/useStreamChat.reconnect.test.ts` 末尾追加：

```ts
describe('useStreamChat reconnect - exhaustion & reset', () => {
  it('after 5 failures sets runStatus=failed with friendly Chinese message', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // 固定 jitter
    mountChat()
    await nextTick()

    for (let i = 0; i < 5; i++) {
      captured.options!.onError!(new Error('boom'))
      await nextTick()
      // 推过本轮退避间隔触发 submit
      vi.advanceTimersByTime(1000 * Math.pow(2, i))
      await nextTick()
    }
    // 第 6 次 onError 应该判定为耗尽
    captured.options!.onError!(new Error('boom'))
    await nextTick()

    const chat = (globalThis as any).__chat
    expect(chat.runStatus.value).toBe('failed')
    expect(chat.runError.value).toBe('网络连接异常，请检查网络后重试')
    expect(chat.reconnectState.isRetrying).toBe(false)
  })

  it('reset() clears reconnectState and pending timer', async () => {
    mountChat()
    await nextTick()
    captured.options!.onError!(new Error('boom'))
    await nextTick()

    const chat = (globalThis as any).__chat
    expect(chat.reconnectState.isRetrying).toBe(true)

    chat.reset()
    expect(chat.reconnectState.attempts).toBe(0)
    expect(chat.reconnectState.isRetrying).toBe(false)
    expect(chat.runStatus.value).toBe('idle')
    expect(chat.runError.value).toBe('')

    // 推进所有 timer，submit 不应被调用（timer 已清）
    mockSubmit.mockClear()
    vi.advanceTimersByTime(60_000)
    await nextTick()
    expect(mockSubmit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试见失败**

```bash
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts -t 'exhaustion' --reporter=verbose
```

期望：2 个新增 it 失败（耗尽时文案是英文 'boom'，且 reset 不清 reconnectState）。

- [ ] **Step 3: 完善 scheduleRetry 文案 + 增强 reset**

修改 `app/composables/useStreamChat.ts` 中的 `scheduleRetry` 函数：

**改前**（Task 1 写的版本）：
```ts
    function scheduleRetry() {
        if (reconnectState.attempts >= RETRY_MAX_ATTEMPTS) {
            // 耗尽：进入失败终态，由 Task 3 完善文案；此处先维持现状文案
            reconnectState.isRetrying = false
            runStatus.value = 'failed'
            return
        }
        ...
    }
```

**改后**：
```ts
    function scheduleRetry() {
        if (reconnectState.attempts >= RETRY_MAX_ATTEMPTS) {
            reconnectState.isRetrying = false
            runStatus.value = 'failed'
            runError.value = '网络连接异常，请检查网络后重试'
            return
        }
        reconnectState.attempts += 1
        reconnectState.isRetrying = true
        const delay = computeRetryDelay(reconnectState.attempts)
        currentRetryTimer = setTimeout(triggerReconnect, delay)
    }
```

然后修改 return 对象中的 `reset` 方法（原约第 497-500 行）：

**改前**：
```ts
        reset: () => {
            runStatus.value = 'idle'
            runError.value = ''
        },
```

**改后**：
```ts
        reset: () => {
            runStatus.value = 'idle'
            runError.value = ''
            reconnectState.attempts = 0
            reconnectState.isRetrying = false
            if (currentRetryTimer) {
                clearTimeout(currentRetryTimer)
                currentRetryTimer = null
            }
        },
```

- [ ] **Step 4: 跑测试见通过**

```bash
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts --reporter=verbose
```

期望：全部 9 个 it（4 + 3 + 2）PASS。

- [ ] **Step 5: 提交**

```bash
git add app/composables/useStreamChat.ts tests/client/composables/useStreamChat.reconnect.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): useStreamChat 重连耗尽友好文案 + reset 增强

- 5 次重试都失败后 runError 改为中文 '网络连接异常，请检查网络后重试'
- reset() 同步清空 reconnectState 与 currentRetryTimer
EOF
)"
```

---

### Task 4: 主动唤醒（VueUse online + visibility）

**Files:**
- Modify: `app/composables/useStreamChat.ts`
- Modify: `tests/client/composables/useStreamChat.reconnect.test.ts`

- [ ] **Step 1: 追加失败测试**

在测试文件末尾追加：

```ts
describe('useStreamChat reconnect - active wakeup', () => {
  it('online event cancels pending retry timer and reconnects immediately', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // jitter=0
    mountChat()
    await nextTick()
    captured.options!.onError!(new Error('boom'))
    await nextTick()

    mockSubmit.mockClear()
    // 还没到 1000ms，正常状态下 submit 不会被调
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(mockSubmit).not.toHaveBeenCalled()

    // 派发 online 事件
    window.dispatchEvent(new Event('online'))
    await nextTick()

    expect(mockSubmit).toHaveBeenCalledOnce()
    expect(mockSubmit).toHaveBeenCalledWith(undefined)
  })

  it('does NOT wakeup if not currently retrying', async () => {
    mountChat()
    await nextTick()
    mockSubmit.mockClear()

    window.dispatchEvent(new Event('online'))
    await nextTick()
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it('cleans up listeners on component unmount', async () => {
    const w = mountChat()
    await nextTick()
    captured.options!.onError!(new Error('boom'))
    await nextTick()

    w.unmount()
    mockSubmit.mockClear()

    window.dispatchEvent(new Event('online'))
    await nextTick()
    expect(mockSubmit).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试见失败**

```bash
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts -t 'active wakeup' --reporter=verbose
```

期望：3 个新增 it 失败（监听器还没接）。

- [ ] **Step 3: 在 useStreamChat 顶部 import VueUse + 添加唤醒逻辑**

修改 `app/composables/useStreamChat.ts` 顶部 import 区（约第 16-23 行），追加：

```ts
import { useEventListener, useDocumentVisibility } from '@vueuse/core'
```

然后在 useStreamChat 函数体内、紧跟 Task 2 加的 `coverIsLoading` 之后，**新增**：

```ts
    // 主动唤醒：online / visibilitychange 事件下立刻取消等待并发起重连
    function wakeup() {
        if (!reconnectState.isRetrying) return
        if (currentRetryTimer) {
            clearTimeout(currentRetryTimer)
            currentRetryTimer = null
        }
        triggerReconnect()
    }

    // VueUse 自动满足 SSR 守卫与 onScopeDispose 清理
    // （SSR 下 globalThis.window === undefined，useEventListener 跳过注册）
    useEventListener(globalThis.window, 'online', wakeup)
    const visibility = useDocumentVisibility()
    watch(visibility, (v) => { if (v === 'visible') wakeup() })
```

> 说明：`useEventListener` 在 SSR / 无 `window` 环境下会自动跳过；`useDocumentVisibility` 同理。无需手写 `import.meta.client` 守卫。

- [ ] **Step 4: 跑测试见通过**

```bash
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts --reporter=verbose
```

期望：全部 12 个 it 通过。

- [ ] **Step 5: 提交**

```bash
git add app/composables/useStreamChat.ts tests/client/composables/useStreamChat.reconnect.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): useStreamChat 主动唤醒（online + visibilitychange）

- 复用 @vueuse/core 的 useEventListener 与 useDocumentVisibility
- 退避等待中收到 online 或切回 visible 立刻取消 timer 并发起重连
- 自动 SSR 守卫 + 自动 onScopeDispose 清理（无需手写 import.meta.client）
EOF
)"
```

---

### Task 5: useInitAnalysisRuntime 新增 restartAnalysis

**Files:**
- Modify: `app/composables/initAnalysis/useInitAnalysisRuntime.ts`
- Modify: `app/composables/initAnalysis/types.ts`
- Create: `tests/client/composables/useInitAnalysisRuntime.restart.test.ts`

- [ ] **Step 1: 创建测试文件**

文件：`tests/client/composables/useInitAnalysisRuntime.restart.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

// Mock useApiFetch
const mockApiFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
  useApiFetch: (...args: any[]) => mockApiFetch(...args),
}))

// Mock useStreamChat（最小返回形状，不走真实流逻辑）
const streamSubmit = vi.fn()
const streamReset = vi.fn()
vi.mock('~/composables/useStreamChat', () => ({
  useStreamChat: () => ({
    submit: streamSubmit,
    reset: streamReset,
    values: { value: undefined },
    messages: { value: [] },
    isLoading: { value: false },
    runStatus: { value: 'idle' },
    runError: { value: '' },
    interruptData: { value: null },
    syntheticToolCalls: {},
    subThreadsMap: {},
    handleAgentEvent: vi.fn(),
    getMessagesMetadata: () => ({}),
    stop: vi.fn(),
    reconnect: vi.fn(),
    loadHistory: vi.fn(),
    hasHistoryLoaded: { value: false },
  }),
}))

// 顶层 await import 对齐项目模式：保证两个 vi.mock 都已注册再加载被测模块
const { useInitAnalysisRuntime } = await import('~/composables/initAnalysis/useInitAnalysisRuntime')

function mountRuntime() {
  const Wrapper = defineComponent({
    setup() {
      const r = useInitAnalysisRuntime(ref('test-session-uuid'))
      ;(globalThis as any).__runtime = r
      return () => h('div')
    },
  })
  return mount(Wrapper)
}

beforeEach(() => {
  mockApiFetch.mockReset()
  streamSubmit.mockReset()
  streamReset.mockReset()
  delete (globalThis as any).__runtime
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useInitAnalysisRuntime.restartAnalysis', () => {
  it('on in_progress: calls stream.submit(undefined), does not start fresh', async () => {
    mountRuntime()
    const r = (globalThis as any).__runtime
    r.caseId.value = 42

    mockApiFetch.mockResolvedValueOnce({
      status: 'in_progress',
      modules: [],
      selectedModules: ['summary', 'chronicle'],
    })

    await r.restartAnalysis()
    await nextTick()

    expect(streamReset).toHaveBeenCalledOnce()
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/v1/cases/init-analysis-status/42',
      expect.objectContaining({ query: expect.any(Object) }),
    )
    expect(streamSubmit).toHaveBeenCalledWith(undefined)
    expect(r.phase.value).toBe('running')
  })

  it('on completed: submits undefined and sets phase=complete', async () => {
    mountRuntime()
    const r = (globalThis as any).__runtime
    r.caseId.value = 42

    mockApiFetch.mockResolvedValueOnce({
      status: 'completed',
      modules: [],
      selectedModules: ['summary'],
    })

    await r.restartAnalysis()
    await nextTick()

    expect(streamSubmit).toHaveBeenCalledWith(undefined)
    expect(r.phase.value).toBe('complete')
  })

  it('on not_started: falls back to startAnalysis (submit with caseId+selectedModules)', async () => {
    mountRuntime()
    const r = (globalThis as any).__runtime
    r.caseId.value = 42
    r.selectedModules.value = ['summary', 'chronicle']

    mockApiFetch.mockResolvedValueOnce({ status: 'not_started', modules: [] })

    await r.restartAnalysis()
    await nextTick()

    // startAnalysis 调 stream.submit({ caseId, selectedModules })
    expect(streamSubmit).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 42,
      selectedModules: ['summary', 'chronicle'],
    }))
  })

  it('does NOT call cancel API in any branch', async () => {
    mountRuntime()
    const r = (globalThis as any).__runtime
    r.caseId.value = 42

    mockApiFetch.mockResolvedValueOnce({ status: 'in_progress', modules: [] })
    await r.restartAnalysis()
    await nextTick()

    // 校验没有任何 cancel 路径被请求
    const calls = mockApiFetch.mock.calls.map((c: any[]) => c[0] as string)
    expect(calls.every(url => !url.includes('/cancel'))).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试见失败**

```bash
npx vitest run tests/client/composables/useInitAnalysisRuntime.restart.test.ts --reporter=verbose
```

期望：4 个 it 全部失败（restartAnalysis 不存在）。

- [ ] **Step 3: 在 useInitAnalysisRuntime 添加 restartAnalysis**

修改 `app/composables/initAnalysis/useInitAnalysisRuntime.ts`，在 `function startAnalysis() { ... }` 之后（约第 230 行）**新增**：

```ts
  async function restartAnalysis() {
    // 1. 复位 stream 错误态，让 watch(runStatus) 重新工作
    stream.reset()

    // 2. 查后端最新状态决定续跑还是重起
    const status = await useApiFetch<InitAnalysisStatusResponse>(
      `/api/v1/cases/init-analysis-status/${caseId.value}`,
      { query: { sessionId: sessionId.value } },
    )

    // 3. 决策续跑还是重起；不调 cancel API（保留 Worker 已有成果）
    if (status?.status === 'in_progress' || status?.status === 'completed') {
      phase.value = status.status === 'completed' ? 'complete' : 'running'
      refreshGlobalStatus(status)
      stream.submit(undefined)
      return
    }
    // not_started 或拿不到状态：退化为完整重启
    startAnalysis()
  }
```

然后修改函数末尾的 return（约第 266-292 行 `return { ... } satisfies RuntimeExposed & { stream: typeof stream }`），仅在 `startAnalysis,` 之后**插入一行** `restartAnalysis,`：

```ts
  return {
    phase,
    caseId,
    selectedModules,
    completedModules,
    statusModules,
    resultFromDB,
    isInitialized,
    moduleStates,
    moduleMessagesMap,
    activeModules,
    isLoading: stream.isLoading,
    runStatus: stream.runStatus,
    runError: stream.runError,
    interruptData,
    values: stream.values,
    stream,
    activeIndex,
    syncSummary,
    getModuleState,
    getModuleMessages,
    loadStatus,
    startAnalysis,
    restartAnalysis,
    resumeWorkflow,
    retryModule,
    refreshGlobalStatus,
  } satisfies RuntimeExposed & { stream: typeof stream }
}
```

> 注意：`statusModules` / `resultFromDB` 是现有字段（`types.ts:43-44` 强制要求 + `useInitAnalysisRuntime.ts:22-23` 声明 + `[sessionId].vue:276-277` 已读取），plan 仅在原 return 中**追加 `restartAnalysis,`** 一行，其它字段保持原样。

修改 `app/composables/initAnalysis/types.ts`，在 `RuntimeExposed` 接口里 `startAnalysis` 之后**新增一行**：

```ts
  startAnalysis: () => void
  restartAnalysis: () => Promise<void>
  resumeWorkflow: () => void
  retryModule: (moduleName: string) => void
```

- [ ] **Step 4: 跑测试见通过**

```bash
npx vitest run tests/client/composables/useInitAnalysisRuntime.restart.test.ts --reporter=verbose
```

期望：4 个 it 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/composables/initAnalysis/useInitAnalysisRuntime.ts app/composables/initAnalysis/types.ts tests/client/composables/useInitAnalysisRuntime.restart.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): useInitAnalysisRuntime 新增 restartAnalysis（续跑优先）

- 先调 init-analysis-status 看后端是否已有 in_progress / completed run
- 有 → stream.submit(undefined) 续订并补发历史
- 没有 → 退化为 startAnalysis 完整重启
- 全程不调 cancel API，保留 Worker 已扣积分的成果
- types.ts 同步补 restartAnalysis 字段
EOF
)"
```

---

### Task 6: [sessionId].vue 切换调用

**Files:**
- Modify: `app/pages/dashboard/cases/init-analysis/[sessionId].vue`

> 本 Task 没有新增单测——`useInitAnalysisRuntime.restart.test.ts` 已覆盖核心行为；页面层只是替换调用，由 Task 7 手动 E2E 兜底。
>
> **关键背景**（已 grep 第 294-307 行确认）：页面 `startAnalysis` 不是直接 `runtime.startAnalysis`，而是个本地 wrapper：
> ```ts
> // 把 runtime.startAnalysis / retryModule / resumeWorkflow 包一层 syncBridge.resetSignature
> function startAnalysis() {
>   syncBridge.resetSignature()
>   runtime.startAnalysis()
> }
> ```
> 所以本 Task 要在 wrapper 区**新增 `restartAnalysis` wrapper**（同样套 `syncBridge.resetSignature()`），然后 `onRestartAnalysis` 调本地 wrapper。

- [ ] **Step 1: 在 wrapper 区新增 restartAnalysis**

定位到第 294-307 行的 wrapper 区（含 `function startAnalysis() {...}`、`function retryModule(...) {...}`、`function resumeWorkflow() {...}`）。在 `function resumeWorkflow()` 之后**新增**：

```ts
// 续跑优先：runtime.restartAnalysis 内部会先查 init-analysis-status，
// 命中 in_progress / completed → stream.submit(undefined) 续订；
// 命中 not_started → 退化为 startAnalysis。
// 此处与其他 wrapper 一致，先 resetSignature 让 cross-tab 重新派发状态。
function restartAnalysis() {
  syncBridge.resetSignature()
  runtime.restartAnalysis()
}
```

- [ ] **Step 2: 替换 onRestartAnalysis 实现**

定位到第 350-354 行（`function onRestartAnalysis()`），原代码：

```ts
function onRestartAnalysis() {
  showGlobalRetry.value = false
  // 使用 startAnalysis 完整重启（不用 resumeWorkflow——那是 interrupt 恢复，不适用 FAILED）
  startAnalysis()
}
```

**改为**（注意调本地 wrapper `restartAnalysis()` 而非 `runtime.restartAnalysis()`，保持 syncBridge 一致性）：

```ts
function onRestartAnalysis() {
  showGlobalRetry.value = false
  // 续跑优先：先查后端状态，有活跃 run 续跑、否则完整重启
  // （内部不调 cancel API，避免丢弃已扣积分跑出的步骤）
  restartAnalysis()
}
```

- [ ] **Step 3: 类型检查**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
bun run typecheck 2>&1 | tail -30
```

期望：无新增类型错误（既存错误若无关本次改动，忽略）。

- [ ] **Step 4: 跑两份相关单测确保未回归**

```bash
npx vitest run tests/client/composables/useStreamChat.reconnect.test.ts tests/client/composables/useInitAnalysisRuntime.restart.test.ts --reporter=verbose
```

期望：全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add app/pages/dashboard/cases/init-analysis/[sessionId].vue
git commit -m "$(cat <<'EOF'
feat(ui): 案件初始化分析页面切到 restartAnalysis（续跑优先）

- onRestartAnalysis 改调 runtime.restartAnalysis 替代 startAnalysis
- 红色"分析中断"banner / "重新分析"按钮视觉不变
- 用户点按时若 Worker 仍在跑 / 已跑完，自动续接结果而非重跑全部步骤
EOF
)"
```

---

### Task 7: 集成与端到端验证（chrome-devtools E2E，可选不入 CI）

**Files:**
- 无需修改源码（如有截图归档可选放 `docs/superpowers/plans/assets/`）

> 本 Task 是手动 / 半自动验证，目的是确认前 6 个 Task 在真实浏览器环境的端到端表现。
> **关于"集成测试 mock 真实 SSE 流被 reader 抛错"**（spec 5.3 节）：本项目的集成测试基础设施 `tests/integration/` 默认走真实 fetch + DB，对前端浏览器侧 SSE reader 的中途断流难以从测试侧自然构造。前 6 个 Task 的单测已用 mock useStream 覆盖了完整状态机；端到端真实表现由本 Task 的 chrome-devtools E2E 兜底。如未来要补集成测试，建议放在 `tests/integration/sse-reconnect.test.ts` 用 MSW / undici interceptor 构造可控 SSE 中断；本 plan 不强制。

- [ ] **Step 1: 启动开发环境**

```bash
cd /Users/daixin/work/dev/LexSeek/LexSeek
bun dev &
```

等到日志输出 `Local: http://localhost:3000`。

- [ ] **Step 2: 用 chrome-devtools MCP 模拟离线场景**

通过 chrome-devtools MCP 工具：

1. `mcp__chrome-devtools__new_page` 打开 `http://localhost:3000/dashboard/cases/init-analysis/<some-session-uuid>`（取一个已有的会话）
2. 让分析跑到第 4 步（"判决趋势预测"）开始流式输出后
3. `mcp__chrome-devtools__emulate` 切到 `offline`
4. `mcp__chrome-devtools__list_console_messages` 应看到 `[useStreamChat] 流错误: ...`
5. 等 5 秒，仍处 offline，UI 应**保持 spinner 不报错**（无感）
6. `mcp__chrome-devtools__emulate` 切回 `online`
7. `mcp__chrome-devtools__take_screenshot` 截图验证：进度无中断，最终 5 个步骤全部绿勾

- [ ] **Step 3: 跑全量测试确认未回归**

```bash
bun run test 2>&1 | tail -40
```

期望：现有所有测试 PASS（关注与 useStreamChat / initAnalysis 相关的）。

- [ ] **Step 4: 杀掉 dev server**

```bash
pkill -9 -f "nuxt.*dev" || true
```

- [ ] **Step 5: 提交（如果有 E2E 截图保留为附件）**

```bash
# 一般无源码改动，不需 commit；如需保留 E2E 截图：
# git add docs/superpowers/plans/assets/2026-05-09-sse-reconnect-e2e.png
# git commit -m "docs(plan): 附 SSE 重连 E2E 截图"
echo "Task 7 完成，无源码改动需要提交"
```

---

## 完成后操作

- [ ] **跑全量测试**

```bash
bun run test 2>&1 | tail -50
```

期望：全部 PASS（如有不相关的 KNOWN_FAILS 按 `tests/KNOWN_FAILS.md` 标注）。

- [ ] **类型检查**

```bash
bun run typecheck 2>&1 | tail -20
```

期望：无新增错误。

- [ ] **简化与回看**

跑 `simplify` 技能扫一遍本次新增/修改文件，看有无冗余分支或可合并代码。

- [ ] **更新文档（可选）**

如果改造对 `docs/tech-docs/frontend/composables.md` 或 `docs/tech-docs/patterns/sse-event-bridge.md` 有影响，补一段"自动重连机制"小节。

---

## 实施顺序与依赖

```
Task 1 (退避调度核心) → Task 2 (复位 + isLoading 兜底) → Task 3 (耗尽文案 + reset)
                                ↓
Task 4 (主动唤醒) ← 与 Task 5 并行可行
                                ↓
Task 5 (restartAnalysis) → Task 6 ([sessionId].vue) → Task 7 (E2E 验证)
```

Task 1-4 必须按顺序串行，因为同一个文件 useStreamChat.ts。Task 5 可与 Task 4 并行（不同文件）。Task 6 必须等 Task 5。Task 7 等所有完成。
