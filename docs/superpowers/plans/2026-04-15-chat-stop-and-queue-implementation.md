# 小索/模块对话停止按钮与消息队列实施清单

**Goal:** 修复停止按钮失灵 + 引入 5 条 FIFO 消息队列，双端（小索 + 模块对话）通过共享基类一次生效。前端纯增量改动，零后端侵入；总代码改动约 800-1000 行（含测试），核心 composable 改动约 200 行。

**Spec:** `docs/superpowers/specs/2026-04-15-chat-stop-and-queue-design.md`（v5 已收敛，2026-04-16）

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + Tailwind v4 + shadcn-vue + @langchain/vue + vue-sonner + nanoid + BroadcastChannel + Web Locks API

**TDD：本计划严格遵守"先测试后实现"，每个 Phase 测试与实现成对出现。**

**不在本次范围**（明确边界，与 Spec §11.3 / §2.2 一致）：
- 后端 `agentWorker.ts` 的 partial AIMessage 持久化（受限于 LangGraph step-level checkpoint，spec §8.2 已确认接受现状）
- `useStreamChat.ts` 的 `onError` 写 runStatus 优化（spec §8.1 #1 列为 v5 已知边界）
- `useCaseChat.ts` 的 sendMessage 签名扩展（files 字段）
- `app/components/ai-elements/queue/*` 源码修改（保持"不改第三方生成组件"原则）
- 队列跨设备 / localStorage 持久化、CRDT 跨 tab 合并
- 拖拽重排 / 编辑 / 内容合并

---

## 前置

- [ ] **确认设计文档已审核通过**：`docs/superpowers/specs/2026-04-15-chat-stop-and-queue-design.md`（v5）
- [ ] **创建工作分支**：`git checkout -b feat/chat-stop-and-queue`
- [ ] **记录测试基线**：`npx vitest run` 记录当前通过/失败数（基线对照用）
- [ ] **类型基线**：`npx nuxi typecheck` 记录当前是否有类型错误
- [ ] **必读文档**：阅读 spec 的 §4.1（bug 定位）/ §4.5（文件结构）/ §5.2（派发器核心）/ §5.7（跨标签协议）/ §8.1（错误场景）/ §8.3（防御性原则）

---

## Phase 1：纯函数层 + 类型与常量（无响应式依赖）

**目标：** 把队列的所有"无副作用、可纯单测"的逻辑沉淀到 `chatQueueActions.ts`，作为后续 dispatcher 和 manager 的基石。

### 1.1 先写单测（TDD RED）

**File:** `tests/app/components/ai/composables/chatQueueActions.test.ts`（新建）

```typescript
import { describe, it, expect } from 'vitest'
import {
  enqueueAction,
  removeAction,
  clearAction,
  pauseAction,
  resumeAction,
  QUEUE_MAX_SIZE,
  type QueueItem,
} from '~/composables/chatQueueActions'

function makeItem(text = '测试'): QueueItem {
  return {
    id: Math.random().toString(36).slice(2),
    text,
    thinking: false,
    enqueuedAt: Date.now(),
  }
}

describe('chatQueueActions / enqueueAction', () => {
  it('队列未满时添加成功', () => {
    const before = new Map<string, QueueItem[]>([['sess-a', []]])
    const { next, ok } = enqueueAction(before, 'sess-a', makeItem('你好'))
    expect(ok).toBe(true)
    expect(next.get('sess-a')).toHaveLength(1)
    expect(before.get('sess-a')).toHaveLength(0) // 旧 Map 未被 mutate
  })

  it('队列满时返回 false 且 Map 不变', () => {
    const full = new Map([['sess-a', Array.from({ length: QUEUE_MAX_SIZE }, () => makeItem())]])
    const { next, ok } = enqueueAction(full, 'sess-a', makeItem('第六'))
    expect(ok).toBe(false)
    expect(next).toBe(full)
  })

  it('未存在 session 自动创建空队列', () => {
    const before = new Map<string, QueueItem[]>()
    const { next, ok } = enqueueAction(before, 'new-sess', makeItem('首条'))
    expect(ok).toBe(true)
    expect(next.get('new-sess')).toHaveLength(1)
  })

  it('不同 session 相互隔离', () => {
    const before = new Map([['sess-a', [makeItem('A')]]])
    const { next } = enqueueAction(before, 'sess-b', makeItem('B'))
    expect(next.get('sess-a')).toHaveLength(1)
    expect(next.get('sess-b')).toHaveLength(1)
  })
})

describe('chatQueueActions / removeAction', () => {
  it('按 id 删除', () => {
    const a = makeItem('a')
    const b = makeItem('b')
    const before = new Map([['sess-a', [a, b]]])
    const next = removeAction(before, 'sess-a', a.id)
    expect(next.get('sess-a')).toEqual([b])
  })

  it('id 不存在不报错且 Map 不变', () => {
    const before = new Map([['sess-a', [makeItem('a')]]])
    const next = removeAction(before, 'sess-a', 'not-exist')
    expect(next.get('sess-a')).toHaveLength(1)
  })
})

describe('chatQueueActions / clearAction', () => {
  it('只清当前 session', () => {
    const before = new Map([
      ['sess-a', [makeItem('a')]],
      ['sess-b', [makeItem('b')]],
    ])
    const next = clearAction(before, 'sess-a')
    expect(next.get('sess-a')).toEqual([])
    expect(next.get('sess-b')).toHaveLength(1)
  })
})

describe('chatQueueActions / pauseAction & resumeAction', () => {
  it('pauseAction 写入原因', () => {
    const before = new Map<string, 'stopped' | 'failed'>()
    const next = pauseAction(before, 'sess-a', 'stopped')
    expect(next.get('sess-a')).toBe('stopped')
  })

  it('resumeAction 从 Map 中删除暂停标记', () => {
    const before = new Map<string, 'stopped' | 'failed'>([['sess-a', 'failed']])
    const next = resumeAction(before, 'sess-a')
    expect(next.has('sess-a')).toBe(false)
  })
})
```

运行：`npx vitest run tests/app/components/ai/composables/chatQueueActions.test.ts` → **应全部 RED**（找不到模块）。

### 1.2 实现纯函数与类型（GREEN）

**File:** `app/composables/chatQueueActions.ts`（新建）

```typescript
/**
 * 聊天消息队列纯函数与类型定义
 *
 * 零响应式依赖，100% 可单元测试。
 * 所有函数遵守 immutability：返回新 Map，不 mutate 入参。
 *
 * 详见 spec §4.3 / §4.5 / §5.3。
 */

import type { OssFileItem } from '~/store/file'

export interface QueueItem {
  /** nanoid()，仅用于 UI key 和删除定位 */
  id: string
  /** 原始用户输入文本 */
  text: string
  /**
   * 前瞻性字段：当前两个对话场景均 enable-file-upload=false，
   * 队列结构先行支持，实际派发时暂不传递（详见 spec §5.6）
   */
  files?: OssFileItem[]
  /** 入队时的"深度思考"开关状态 */
  thinking: boolean
  /** Date.now()，用于排序与跨标签同步的时序校验 */
  enqueuedAt: number
}

export type QueuePauseReason = 'stopped' | 'failed' | null

/** 队列容量上限（spec §3 决策） */
export const QUEUE_MAX_SIZE = 5

// ─────────────────────────────────────────────────
// 纯函数：所有操作返回新 Map
// ─────────────────────────────────────────────────

export interface EnqueueResult {
  next: Map<string, QueueItem[]>
  ok: boolean
}

/**
 * 入队：未满时返回新 Map + ok=true，已满时返回原 Map + ok=false
 */
export function enqueueAction(
  current: Map<string, QueueItem[]>,
  sessionId: string,
  item: QueueItem,
): EnqueueResult {
  const existing = current.get(sessionId) ?? []
  if (existing.length >= QUEUE_MAX_SIZE) {
    return { next: current, ok: false }
  }
  const next = new Map(current)
  next.set(sessionId, [...existing, item])
  return { next, ok: true }
}

/**
 * 按 id 删除单条；id 不存在时静默返回新 Map
 */
export function removeAction(
  current: Map<string, QueueItem[]>,
  sessionId: string,
  itemId: string,
): Map<string, QueueItem[]> {
  const existing = current.get(sessionId) ?? []
  const filtered = existing.filter(i => i.id !== itemId)
  const next = new Map(current)
  next.set(sessionId, filtered)
  return next
}

/**
 * 清空指定 session 队列
 */
export function clearAction(
  current: Map<string, QueueItem[]>,
  sessionId: string,
): Map<string, QueueItem[]> {
  const next = new Map(current)
  next.set(sessionId, [])
  return next
}

/**
 * 设置暂停原因
 */
export function pauseAction(
  current: Map<string, Exclude<QueuePauseReason, null>>,
  sessionId: string,
  reason: Exclude<QueuePauseReason, null>,
): Map<string, Exclude<QueuePauseReason, null>> {
  const next = new Map(current)
  next.set(sessionId, reason)
  return next
}

/**
 * 清除暂停标记（统一使用 delete 而非 set null，与 isQueuePaused 的宽松比较 `!= null` 配合）
 */
export function resumeAction(
  current: Map<string, Exclude<QueuePauseReason, null>>,
  sessionId: string,
): Map<string, Exclude<QueuePauseReason, null>> {
  const next = new Map(current)
  next.delete(sessionId)
  return next
}
```

### 1.3 验证 + 提交

```bash
npx vitest run tests/app/components/ai/composables/chatQueueActions.test.ts  # 应全部 GREEN
npx nuxi typecheck                                                            # 无类型错误

git add app/composables/chatQueueActions.ts \
        tests/app/components/ai/composables/chatQueueActions.test.ts
git commit -m "feat(chat): 新增队列纯函数层 chatQueueActions"
```

---

## Phase 2：跨标签事件类型 + 测试 mock 基础设施

**目标：** 扩展现有 `useCrossTabEvents.ts` 增加两个事件类型；新建可被未来其他跨标签功能复用的 BroadcastChannel + Web Locks mock 工具。

### 2.1 扩展 `CrossTabEvents` interface

**File:** `app/composables/useCrossTabEvents.ts`

在文件中找到 `CrossTabEvents` interface 定义（约 line 20-40），新增两个事件：

```typescript
import type { QueueItem, QueuePauseReason } from './chatQueueActions'

export interface CrossTabEvents {
  // ... 已有的 4 个事件保持不变 ...

  /** 队列状态完整快照（mutate 后广播） */
  'chat-queue:sync': {
    sessionId: string
    /** 发送方 tab 标识，接收方用于自回过滤 */
    tabId: string
    /** 完整队列快照 */
    queue: QueueItem[]
    pauseReason: QueuePauseReason
    /** performance.now() + Math.random()，双因子避免毫秒级碰撞 */
    version: number
  }

  /** 新 tab 打开 session 时请求状态 */
  'chat-queue:hello': {
    sessionId: string
    tabId: string
  }
}
```

### 2.2 新建测试 mock 基础设施

**File:** `tests/app/utils/crossTabMocks.ts`（新建）

完整代码见 spec §9.6。关键点：
- `stubBroadcastChannel()`：用 listeners Map 模拟 pub/sub，支持 `onmessage` setter（与 `useCrossTabEvents.ts:61` 实际使用模式一致）
- `stubNavigatorLocks()`：用 Set 模拟分布式锁，支持 `ifAvailable` 选项

```typescript
import { vi } from 'vitest'

/**
 * 建立 BroadcastChannel 的手工 pub/sub 实现
 *
 * 注意：useCrossTabEvents.ts 用 `ch.onmessage = fn` setter 模式，
 * 本 mock 用 setter 累加 listeners，与现有代码兼容。
 */
export function stubBroadcastChannel() {
  const listeners = new Map<string, Set<(ev: MessageEvent) => void>>()
  class MockChannel {
    constructor(public name: string) {
      if (!listeners.has(name)) listeners.set(name, new Set())
    }
    postMessage(data: unknown) {
      // 异步派发模拟 BroadcastChannel 的真实行为
      queueMicrotask(() => {
        listeners.get(this.name)?.forEach(fn => fn({ data } as MessageEvent))
      })
    }
    set onmessage(fn: (ev: MessageEvent) => void) {
      listeners.get(this.name)?.add(fn)
    }
    close() { /* no-op */ }
  }
  vi.stubGlobal('BroadcastChannel', MockChannel)
  return () => { listeners.clear(); vi.unstubAllGlobals() }
}

/**
 * 建立 navigator.locks 的简单串行实现
 *
 * 支持 ifAvailable: true 时返回 null（与 Web Locks API 行为一致）。
 */
export function stubNavigatorLocks() {
  const held = new Set<string>()
  vi.stubGlobal('navigator', {
    locks: {
      async request(
        name: string,
        opts: { ifAvailable?: boolean; mode?: string },
        cb: (lock: unknown) => Promise<void>,
      ) {
        if (held.has(name)) {
          if (opts.ifAvailable) return cb(null)
          throw new Error('lock held')
        }
        held.add(name)
        try { await cb({}) } finally { held.delete(name) }
      },
    },
  })
  return () => { held.clear(); vi.unstubAllGlobals() }
}
```

### 2.3 验证 + 提交

```bash
npx nuxi typecheck                                              # CrossTabEvents 类型扩展无误
git add app/composables/useCrossTabEvents.ts \
        tests/app/utils/crossTabMocks.ts
git commit -m "feat(cross-tab): 新增 chat-queue 事件类型与 mock 基础设施"
```

---

## Phase 3：派发器 + Manager 队列状态 + 集成测试

**目标：** 这是本次改动的核心。把队列状态、跨标签同步、派发逻辑全部接入 `useChatSessionManager`，并通过集成测试覆盖 reconnect 假边沿、interrupted 不派发、跨标签互斥等关键场景。

> ⚠️ **本 Phase 内代码相互依赖较强，建议作为单个 commit 完成后再写测试。但 TDD 仍要求先写测试骨架再写实现 —— 推荐顺序：先写 3.1 测试骨架（vi.mock + 描述 it 块） → 写 3.2/3.3 实现 → 让测试跑通 → 补 cross-tab 测试。**

### 3.1 集成测试骨架（TDD RED）

**File:** `tests/app/components/ai/composables/useChatSessionManager.test.ts`（新建或扩展）

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'
// 相对路径引用同一 tests/ 目录下的 mock 工具（不经过 Nuxt `~` alias）
// 路径：tests/app/components/ai/composables/useChatSessionManager.test.ts
//   → ../../../utils/crossTabMocks = tests/app/utils/crossTabMocks
import { stubBroadcastChannel, stubNavigatorLocks } from '../../../utils/crossTabMocks'

// Mock useCaseChat 返回可控实例
const mockChat = {
  messages: ref<any[]>([]),
  isLoading: ref(false),
  runStatus: ref<'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'>('idle'),
  runError: ref(''),
  interruptData: ref<unknown>(null),
  sendMessage: vi.fn(),
  stopGeneration: vi.fn(),
  loadHistory: vi.fn(),
  reconnect: vi.fn(),
  resumeInterrupt: vi.fn(),  // 用于"interrupt 确认后继续派发"测试用例
}

vi.mock('~/composables/useCaseChat', () => ({ useCaseChat: () => mockChat }))

describe('useChatSessionManager / 队列派发集成测试', () => {
  let restoreBC: () => void
  let restoreLocks: () => void

  beforeEach(() => {
    // 重置 mock
    mockChat.runStatus.value = 'idle'
    mockChat.isLoading.value = false
    mockChat.interruptData.value = null
    mockChat.sendMessage.mockClear()
    restoreBC = stubBroadcastChannel()
    restoreLocks = stubNavigatorLocks()
  })

  afterEach(() => {
    restoreBC()
    restoreLocks()
  })

  // ─── happy path ───
  it('入队 1 条 + completed 应派发 1 次', async () => {
    // TODO: 待 manager 实现后填充
  })

  it('入队 2 条 + 连续 completed 应派发 2 次', async () => {
    // TODO
  })

  // ─── 守卫路径 ───
  it('runStatus → cancelled 应自动暂停队列（reason=stopped）', async () => {
    // TODO
  })

  it('runStatus → failed 应自动暂停队列（reason=failed）', async () => {
    // TODO
  })

  // ─── reconnect 假边沿（spec §5.5 / §9.3 Critical 1）───
  it('未本地 sendMessage 时 runStatus completed 不触发派发（溯源守卫）', async () => {
    // TODO：模拟 reconnect 后端补发 status_change，lastLocalSendSeq 未增长，应不派发
  })

  // ─── interrupted 不派发（spec §9.3 Critical 2）───
  it('runStatus → interrupted + interruptData 设置后 isLoading 变 false 不派发', async () => {
    // TODO
  })

  it('interrupt 恢复后 completed 正常派发下一条', async () => {
    // TODO
  })

  // ─── handleSubmit 暂停态强制入队 ───
  it('暂停态 + isLoading=false 调用 enqueueMessage 而非 sendMessage', async () => {
    // TODO
  })

  // ─── 死锁防护 ───
  it('removeQueueItem 删光最后一条自动清除暂停标记', async () => {
    // TODO
  })

  it('clearQueue 清空同时清除暂停标记', async () => {
    // TODO
  })

  // ─── session 切换 ───
  it('switchSession 后 currentQueue 切到新 session 的队列', async () => {
    // TODO
  })

  it('deleteSession 应清理 queuesBySession 和 queuePausedBy', async () => {
    // TODO
  })

  // ─── resumeQueue + currentChat null 边界 ───
  it('resumeQueue 时 currentChat=null 应不抛错且不派发', async () => {
    // TODO
  })

  // ─── 队列满 ───
  it('已有 5 条再 enqueue 应返回 false', () => {
    // TODO
  })

  // ─── 补充：§5.5 / §8.1 边界场景（第 2 轮审查新增）───

  it('loadHistory 假边沿：isLoading true→false 但 runStatus 保持 idle 不派发（§5.5）', async () => {
    // 模拟 loadHistory：isLoading 有边沿但 runStatus 未变化
    // 断言 sendMessage 未被调用（因 watch(runStatus) 未触发 completed 分支）
  })

  it('派发中组件 unmount：effectScope.stop 后 dispatcher watch 不再触发（§5.5）', async () => {
    // 用 effectScope 包裹 manager 调用，入队 1 条后 scope.stop()
    // 再设 runStatus = 'completed'，断言 sendMessage 未被调用
    // 同时断言 queuesBySession Map 在 GC 前保持不变（弱断言，仅验证 scope 清理）
  })

  it('失败后不自动重试：doDispatch 同步抛错后队头保留，下次 resumeQueue 重新派发同一条（§8.1 #10）', async () => {
    // mockChat.sendMessage.mockImplementationOnce(() => { throw new Error('fail') })
    // 入队 2 条 → completed 触发派发 → 第一次派发抛错
    // 断言 queuesBySession.get(sid).length === 2（队头仍保留）
    // 断言 queuePausedBy.get(sid) === 'failed'
    // 调用 resumeQueue → 断言同一队头被再次派发（此时 mockChat.sendMessage 已恢复）
  })

  it('删除 chip 不撤销已派发：派发 pop 队头后 removeQueueItem(旧队头id) 为 no-op（§8.2）', async () => {
    // 入队 3 条，completed 触发派发第 1 条 → 第 1 条已 pop 不在队列
    // 调用 removeQueueItem(第1条id) → 断言队列长度仍为 2（未影响剩余条目）
    // 断言不抛错、不广播无意义变化
  })
})
```

> **§9.3 规定的"interrupt 期间 isLoading 变 false"**: 已包含在 `'runStatus → interrupted + interruptData 设置后 isLoading 变 false 不派发'` 用例中（断言 interruptData 守卫生效时即便 isLoading 突变也不派发）。

运行：`npx vitest run tests/app/components/ai/composables/useChatSessionManager.test.ts` → 全部 TODO/RED。

### 3.2 实现 `useQueueDispatcher.ts`

**File:** `app/composables/useQueueDispatcher.ts`（新建）

完整代码以 spec §5.2 的代码块为准（约 190-322 行）。关键点：

- 顶部声明类型别名（注意 TS 不支持 `typeof import('...').fn` 语法，需分两行）：
  ```typescript
  import type { useCaseChat } from '~/composables/useCaseChat'
  type ChatInstance = ReturnType<typeof useCaseChat>
  ```
- `watch(deps.runStatus)`：仅 `failed/cancelled` 自动暂停；仅 `completed && prev !== 'completed' && lastLocalSendSeq > lastDispatchedSeq` 触发派发
- `maybeDispatch`：6 个守卫（暂停 / interrupt / isLoading / currentChat / 队列空 / Web Lock）
- `doDispatch`：try/catch 包裹同步抛错；catch 内 `queuePausedBy.set(sid, 'failed')` + broadcast；**先 ++lastLocalSendSeq 再 sendMessage**
- `broadcastState`：唯一的对外广播出口

> **关键不变式**（来自 spec §5.2 要点）：
> 1. dispatcher 必须在 manager setup 顶层注册（**不**进 switchSession 的 inner scope），自动绑定调用方组件的 setup scope
> 2. `lastLocalSendSeq` 在 sendMessage wrapper 和 doDispatch 内**两处**都要 `++`
> 3. listener 接收 `chat-queue:sync` 后**绝不**再调用 broadcastState

### 3.3 扩展 `useChatSessionManager.ts`

**File:** `app/composables/useChatSessionManager.ts`

按以下顺序在文件中插入改动（参照 spec §4.4 / §5.3 / §5.4 / §5.7）：

#### 3.3.1 新增 import

```typescript
import { reactive } from 'vue'
import { nanoid } from 'nanoid'
import {
  enqueueAction,
  // removeAction / clearAction 不在 manager 层使用——
  // 它们返回完整新 Map，而 manager 的 reactive(Map) 只需 .set(sid, filteredArr)
  // 触发响应式。Phase 1 的这两个函数保留作为纯逻辑单元测试用途，
  // manager 层的 removeQueueItem/clearQueue 直接用 filter/set 已满足 spec §8.3
  // 的 immutable 更新规则（spread 新数组 + reactive Map.set 而非 push mutate）。
  type QueueItem,
  type QueuePauseReason,
  QUEUE_MAX_SIZE,
} from './chatQueueActions'
import { postCrossTabEvent, useCrossTabListener } from './useCrossTabEvents'
import { useQueueDispatcher } from './useQueueDispatcher'
```

#### 3.3.2 在 setup 顶层声明队列状态（与已有的 `sessions` ref 同级）

```typescript
// ── 队列状态（per-session 隔离）──
const queuesBySession = reactive(new Map<string, QueueItem[]>())
const queuePausedBy = reactive(new Map<string, Exclude<QueuePauseReason, null>>())
const lastLocalSendSeq = ref(0)
const lastAppliedVersion = new Map<string, number>()  // 跨 tab 过期广播过滤

// ── tabId（必须在 onMounted 内生成，避免 Nuxt useState SSR hydration 共享）──
let tabId = ''
onMounted(() => {
  tabId = nanoid()
})

// ── hello 广播：等 tabId 就绪 + session 首次就绪后再发 ──
// 不放在 onMounted 里，因为 init() 可能还没跑完、currentSessionId 仍为 null。
// 用 watch 响应式触发：首次 currentSessionId 从 null/undefined → 有值时发一次 hello。
// 后续 switchSession 不重发（hello 语义是"本 tab 新加入该 session 集合"，而非"session 切换"）。
const helloSent = new Set<string>()
watch(
  [currentSessionId, () => tabId],  // tabId 也是依赖：onMounted 赋值后触发
  ([sid, tid]) => {
    if (!sid || !tid) return
    if (helloSent.has(sid)) return
    helloSent.add(sid)
    postCrossTabEvent('chat-queue:hello', { sessionId: sid, tabId: tid })
  },
  { immediate: false },  // 不要 immediate，避免 tabId='' 时误发
)
```

> ⚠️ **为什么不用 `onMounted` 内直接发 hello**（与 spec §5.7 对齐）：`useChatSessionManager.init()` 是异步的（fetchSessions + switchSession），`onMounted` 触发时 `currentSessionId.value` 可能仍为 null。用 watch 响应 `currentSessionId` 首次置位更安全，且天然支持"init() 完成后才发"的时序。

#### 3.3.3 派生 computed

```typescript
const currentQueue = computed<QueueItem[]>(() => {
  const sid = currentSessionId.value
  if (!sid) return []
  return queuesBySession.get(sid) ?? []
})

const currentQueueLen = computed(() => currentQueue.value.length)

const isQueuePaused = computed(() => {
  const sid = currentSessionId.value
  if (!sid) return false
  // 宽松比较：null 或 undefined 都视为非暂停（spec §5.1）
  return queuePausedBy.get(sid) != null
})

const queuePauseReason = computed<QueuePauseReason>(() => {
  const sid = currentSessionId.value
  if (!sid) return null
  return queuePausedBy.get(sid) ?? null
})
```

#### 3.3.4 队列操作 API

```typescript
function enqueueMessage(text: string, files?: any[], thinking = false): boolean {
  const sid = currentSessionId.value
  if (!sid) return false
  const item: QueueItem = {
    id: nanoid(),
    text,
    files,
    thinking,
    enqueuedAt: Date.now(),
  }
  const { next, ok } = enqueueAction(queuesBySession as any, sid, item)
  if (ok) {
    // reactive Map 的 set 触发响应
    queuesBySession.set(sid, next.get(sid)!)
    broadcastState(sid)
  }
  return ok
}

function removeQueueItem(itemId: string) {
  const sid = currentSessionId.value
  if (!sid) return
  const current = queuesBySession.get(sid) ?? []
  const nextList = current.filter(i => i.id !== itemId)
  queuesBySession.set(sid, nextList)
  // 死锁防护：队列变空时自动清除暂停标记（spec §5.3 / §8.1 #17）
  if (nextList.length === 0) queuePausedBy.delete(sid)
  broadcastState(sid)
}

function clearQueue() {
  const sid = currentSessionId.value
  if (!sid) return
  queuesBySession.set(sid, [])
  queuePausedBy.delete(sid)
  broadcastState(sid)
}

function resumeQueue() {
  const sid = currentSessionId.value
  if (!sid) return
  queuePausedBy.delete(sid)
  broadcastState(sid)
  // 主动触发派发尝试（绕过 seq 守卫语义见 spec §5.4 注释）
  dispatcher.maybeDispatch()
}
```

#### 3.3.5 包装 sendMessage（自增 lastLocalSendSeq）

找到现有的 `function sendMessage(text, opts)`（约 157-159 行），改为：

```typescript
function sendMessage(text: string, opts?: { thinking?: boolean }) {
  // 用户直接发送路径：自增 seq，供 dispatcher 溯源守卫识别
  lastLocalSendSeq.value++
  currentChat.value?.sendMessage(text, opts)
}
```

#### 3.3.6 deleteSession 顺序调整

找到现有 `deleteSession`，确保以下顺序（spec §5.5 表格 + §8.1 场景 #4）：

1. delete API 调用
2. **`queuesBySession.delete(sid)` + `queuePausedBy.delete(sid)`**
3. **broadcast `chat-queue:sync` with `queue: []`** 通知其他 tab
4. `sessions.value.filter(...)` 从数组移除
5. switchSession 到下一条或 createSession

#### 3.3.7 实例化 dispatcher（必须在顶层，不进 switchSession scope）

```typescript
const dispatcher = useQueueDispatcher({
  currentSessionId,
  currentChat,
  runStatus,
  isLoading,
  interruptData,
  queuesBySession: queuesBySession as any,
  queuePausedBy: queuePausedBy as any,
  get tabId() { return tabId },  // getter 因为 tabId 在 onMounted 才赋值
  lastLocalSendSeq,
})
```

#### 3.3.8 跨标签 listener（接收方）

```typescript
useCrossTabListener('chat-queue:sync', (payload) => {
  // 守卫 1：忽略自己广播的 echo
  if (payload.tabId === tabId) return
  // 守卫 2：忽略过期广播
  const sid = payload.sessionId
  const lastV = lastAppliedVersion.get(sid) ?? 0
  if (payload.version <= lastV) return
  lastAppliedVersion.set(sid, payload.version)

  // ⚠️ 应用到本地 Map（不再调用 broadcastState，避免风暴）
  queuesBySession.set(sid, payload.queue)
  if (payload.pauseReason === null) queuePausedBy.delete(sid)
  else queuePausedBy.set(sid, payload.pauseReason)
})

useCrossTabListener('chat-queue:hello', (payload) => {
  if (payload.tabId === tabId) return
  const sid = payload.sessionId
  if (queuesBySession.has(sid) || queuePausedBy.has(sid)) {
    postCrossTabEvent('chat-queue:sync', {
      sessionId: sid,
      tabId,
      queue: queuesBySession.get(sid) ?? [],
      pauseReason: queuePausedBy.get(sid) ?? null,
      version: performance.now() + Math.random(),
    })
  }
})
```

#### 3.3.9 暴露新 API

在 manager 的 return 对象中追加：

```typescript
return {
  // ... 已有字段保持不变 ...
  currentQueue,
  currentQueueLen,
  isQueuePaused,
  queuePauseReason,
  enqueueMessage,
  removeQueueItem,
  clearQueue,
  resumeQueue,
}
```

> **不暴露**：`queuesBySession` / `queuePausedBy` / `lastLocalSendSeq` / `tabId` / `dispatcher` / `lastAppliedVersion` —— 这些是内部实现细节。

### 3.4 填充 3.1 的测试用例

参照 spec §9.3 的测试用例表，逐个填充 TODO 测试体。每个用例严格按照"安排（arrange）→ 操作（act）→ 断言（assert）"模式，使用 `flushPromises()` 和 `nextTick()` 控制时序。

**关键测试代码片段**（以"reconnect 假边沿"为例）：

```typescript
it('未本地 sendMessage 时 runStatus completed 不触发派发（溯源守卫）', async () => {
  const manager = useChatSessionManager(/* setup args */)
  await manager.init()

  // 先入队，但不调用 sendMessage（模拟 tab 继承场景）
  manager.enqueueMessage('队列里的消息')
  expect(manager.currentQueue.value).toHaveLength(1)

  // 模拟 reconnect 补发 running → completed
  mockChat.runStatus.value = 'running'
  await nextTick()
  mockChat.runStatus.value = 'completed'
  await nextTick()

  // 溯源守卫：lastLocalSendSeq=0 ≤ lastDispatchedSeq=0，不派发
  expect(mockChat.sendMessage).not.toHaveBeenCalled()
  expect(manager.currentQueue.value).toHaveLength(1)
})
```

### 3.5 跨标签同步测试

**File:** `tests/app/components/ai/composables/crossTabQueue.test.ts`（新建）

参照 spec §9.6 测试用例表填充（共 10 条，含第 2 轮审查新增 1 条）：

- Tab A enqueue → Tab B 接收（`currentQueue` 包含新 item）
- Tab A remove → Tab B 接收（队列同步减少）
- Tab A pause → Tab B 接收（`isQueuePaused=true`，`queuePauseReason` 透传）
- 新 tab hello → 旧 tab 响应 sync（新 tab 收到状态并应用）
- 两 tab 同时 maybeDispatch → 只有一个拿到 Web Lock，另一个 `lock===null` 无副作用
- **持锁 tab `sendMessage` 同步抛错** → catch 分支写入 `queuePausedBy='failed'` + broadcast，队头保留
- Listener 自回过滤（`tabId === self` 的 `chat-queue:sync` 被忽略）
- 过期版本丢弃（`version <= lastApplied` 的 sync 被忽略）
- 无 `navigator.locks` 环境降级（直接执行派发，单 tab 默认路径）
- **Tab A 清空 + Tab B 派发中（§8.1 #15，第 2 轮审查新增）**：
  - Tab B 持 Web Lock 开始 doDispatch
  - Tab A 并发调用 clearQueue 并 broadcast `chat-queue:sync` with `queue: []`
  - 断言：Tab B 完成当前 sendMessage 调用（不被 Tab A 的广播打断），set 剩余 `[]`
  - 断言：Tab A 的 clearQueue 不因 Tab B 持锁而阻塞（clearQueue 本身不持锁）
  - 断言：两 tab 最终收敛到空队列 + 暂停标记清除

### 3.6 验证 + 提交

```bash
npx vitest run tests/app/components/ai/composables/useChatSessionManager.test.ts
npx vitest run tests/app/components/ai/composables/crossTabQueue.test.ts
npx nuxi typecheck

git add app/composables/useQueueDispatcher.ts \
        app/composables/useChatSessionManager.ts \
        tests/app/components/ai/composables/useChatSessionManager.test.ts \
        tests/app/components/ai/composables/crossTabQueue.test.ts
git commit -m "feat(chat): useChatSessionManager 接入消息队列与派发器"
```

---

## Phase 4：UI 组件层（AiChatQueueChips + AiPromptInput 修复）

**目标：** 实现队列 chip 组件 + 修复停止按钮三个 UI bug。

### 4.1 先写 AiChatQueueChips 组件测试（TDD RED）

**File:** `tests/app/components/ai/AiChatQueueChips.test.ts`（新建）

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatQueueChips from '~/components/ai/AiChatQueueChips.vue'
import type { QueueItem } from '~/composables/chatQueueActions'

function makeItem(text = '测试'): QueueItem {
  return { id: Math.random().toString(36).slice(2), text, thinking: false, enqueuedAt: Date.now() }
}

describe('AiChatQueueChips', () => {
  it('空队列不渲染容器', () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [], max: 5, paused: false, pauseReason: null },
    })
    expect(w.html()).toBe('<!---->')
  })

  it('2 条运行中显示"排队中 (2/5)"', () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a'), makeItem('b')], max: 5, paused: false, pauseReason: null },
    })
    expect(w.text()).toContain('排队中 (2/5)')
  })

  it('暂停 stopped 显示"已手动停止"和恢复/清空按钮', () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a')], max: 5, paused: true, pauseReason: 'stopped' },
    })
    expect(w.text()).toContain('已手动停止')
    expect(w.text()).toContain('恢复队列')
    expect(w.text()).toContain('清空')
  })

  it('暂停 failed 显示"上一条执行失败"', () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a')], max: 5, paused: true, pauseReason: 'failed' },
    })
    expect(w.text()).toContain('上一条执行失败')
  })

  it('点击 × 删除 chip 应 emit remove 携带 itemId', async () => {
    const item = makeItem('a')
    const w = mount(AiChatQueueChips, {
      props: { queue: [item], max: 5, paused: false, pauseReason: null },
    })
    await w.find('[data-testid="queue-remove"]').trigger('click')
    expect(w.emitted('remove')?.[0]).toEqual([item.id])
  })

  it('点击恢复按钮 emit resume', async () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a')], max: 5, paused: true, pauseReason: 'stopped' },
    })
    await w.find('[data-testid="queue-resume"]').trigger('click')
    expect(w.emitted('resume')).toBeTruthy()
  })

  it('点击清空按钮 emit clear', async () => {
    const w = mount(AiChatQueueChips, {
      props: { queue: [makeItem('a')], max: 5, paused: true, pauseReason: 'stopped' },
    })
    await w.find('[data-testid="queue-clear"]').trigger('click')
    expect(w.emitted('clear')).toBeTruthy()
  })

  it('thinking=true 显示 BrainIcon', () => {
    const item = { ...makeItem('a'), thinking: true }
    const w = mount(AiChatQueueChips, {
      props: { queue: [item], max: 5, paused: false, pauseReason: null },
    })
    // BrainIcon 通过 lucide-vue-next，找带特定 class 或 svg
    expect(w.find('[data-testid="queue-brain-icon"]').exists()).toBe(true)
  })
})
```

### 4.2 实现 `AiChatQueueChips.vue`

**File:** `app/components/ai/AiChatQueueChips.vue`（新建）

完整代码以 spec §7.3 为准。**关键修订**（v5）：

- 文本 + Tooltip 部分**放弃**复用 `QueueItemContent`，直接用原生 `<span class="line-clamp-1 grow break-words text-muted-foreground min-w-0">`，理由见 spec §7.3 注释（reka-ui as-child 需 forward DOM ref，自定义组件默认 ref 指向实例）
- 序号 badge / 附件 badge / BrainIcon / × 删除按钮 4 项保留
- 列表项加 `data-testid="queue-remove"` / `data-testid="queue-brain-icon"` 等便于测试和 E2E 选择
- 横幅按钮加 `data-testid="queue-resume"` / `data-testid="queue-clear"`

### 4.3 修复 `AiPromptInput.vue`（spec §4.1 / §6.1-6.5）

**File:** `app/components/ai/AiPromptInput.vue`

#### 4.3.1 新增 props

约 60-90 行的 `defineProps` 中追加：

```typescript
queueLength?: number
queueFull?: boolean
```

#### 4.3.2 重写 isSubmitDisabled 拆分

约 270-281 行的 `isSubmitDisabled` 拆分为：

```typescript
const hasContent = computed(() => {
  const hasText = !!internalPromptText.value?.trim()
  const hasAttachments = props.enableFileUpload && selectedFiles.value.length > 0
  return hasText || hasAttachments
})

const isBusy = computed(() =>
  uploadingFiles.value.length > 0 || isAllRecognizing.value || props.disabled
)

/** 普通发送按钮：无内容或忙时禁用 */
const isSendDisabled = computed(() => !hasContent.value || isBusy.value)

/** 加入队列按钮：无内容、忙、或队列满时禁用 */
const isEnqueueDisabled = computed(() =>
  !hasContent.value || isBusy.value || !!props.queueFull
)
```

#### 4.3.3 按钮区域条件渲染（spec §6.1 / §6.3）

**背景说明**（避免实施者误解）：现有 `AiPromptInput.vue:136` 的 `@stop="emit('stop')"` 是**死代码**——`PromptInputSubmit.vue` 根本没有 `defineEmits<{ stop: [] }>()`，从不 emit `stop`。本次按 spec §6.4 "不改第三方 ai-elements 组件"原则，**不修** `PromptInputSubmit.vue`，而是用独立的 `<Button>` 承担停止功能。

约 134-141 行的按钮区改为：

```vue
<!-- 非 loading 态：保持原有 PromptInputSubmit（它仍承担 type=submit 的原生 form 提交） -->
<PromptInputSubmit
  v-if="!loading"
  :status="submitStatus"
  :disabled="isSendDisabled"
  size="xs"
  data-testid="send-button"
  @submit="handleSubmitFromButton"
>
  <SendHorizontal class="size-4" />
</PromptInputSubmit>

<!-- loading 态：独立的 停止 + 加入队列 双按钮（绕开 PromptInputSubmit 缺失的 stop emit） -->
<div v-else class="flex items-center gap-1">
  <Button
    type="button"
    size="xs"
    variant="ghost"
    aria-label="停止当前对话"
    data-testid="stop-button"
    @click="emit('stop')"
  >
    <SquareIcon class="size-4" />
  </Button>

  <div class="relative">
    <Button
      type="button"
      size="xs"
      :disabled="isEnqueueDisabled"
      :aria-label="`加入发送队列（当前已有 ${props.queueLength ?? 0} 条）`"
      :title="props.queueFull ? '队列已满（最多 5 条）' : undefined"
      data-testid="enqueue-button"
      @click="handleSubmitFromButton"
    >
      <SendHorizontal class="size-4" />
    </Button>
    <Badge
      v-if="(props.queueLength ?? 0) > 0"
      class="absolute -top-1 -right-1 px-1 h-4 min-w-4 text-[10px]"
      variant="secondary"
    >
      +{{ props.queueLength }}
    </Badge>
  </div>
</div>
```

**需新增的 import**（追加到现有 `lucide-vue-next` import 行）：

```typescript
// 在 AiPromptInput.vue 的 script setup 顶部
import { SquareIcon, SendHorizontal } from 'lucide-vue-next'  // SendHorizontal 通常已有，SquareIcon 新增
import { Badge } from '~/components/ui/badge'                   // Badge 通常已有（检查现有 import，若无则追加）
```

> **注意：`SendHorizontal` 在现有代码中已 import**（line 135 有 `<SendHorizontal />`），仅需追加 `SquareIcon` 即可。`Badge` 在 `@/components/ui/badge` 由 shadcn-vue 提供，需确认该组件已安装（搜 `app/components/ui/badge/` 目录），未安装则先 `npx shadcn-vue add badge`。

#### 4.3.4 测试相关的 `data-testid`

已内联在 4.3.3 的模板代码中：
- 停止按钮：`data-testid="stop-button"`
- 加入队列按钮：`data-testid="enqueue-button"`
- PromptInputSubmit：`data-testid="send-button"`

这些 ID 被 Phase 6 E2E 和 Phase 4.4 组件测试消费。

### 4.4 AiPromptInput 测试扩展

**File:** `tests/app/components/ai/AiPromptInput.test.ts`（若已存在则扩展，否则新建）

参照 spec §9.5 表格新增 9 个用例：
- loading=false 时只有发送按钮
- loading=true 输入为空 → 停止按钮可用、加入队列按钮禁用
- loading=true 输入有内容 → 两按钮都可点击
- loading=true 队列满 → 加入队列按钮禁用、tooltip
- 有队列内容显示 +N badge
- 点击停止按钮 emit stop
- 点击加入队列 emit submit
- 回车键 submit 行为不变
- isStopping=true 时停止按钮禁用（若 isStopping 通过 props 传入）

### 4.5 验证 + 提交

```bash
npx vitest run tests/app/components/ai/AiChatQueueChips.test.ts
npx vitest run tests/app/components/ai/AiPromptInput.test.ts
npx nuxi typecheck

git add app/components/ai/AiChatQueueChips.vue \
        app/components/ai/AiPromptInput.vue \
        tests/app/components/ai/AiChatQueueChips.test.ts \
        tests/app/components/ai/AiPromptInput.test.ts
git commit -m "feat(ui): 队列 chip 组件 + 修复停止按钮交互"
```

---

## Phase 5：双端集成（CaseDetailXiaosuo + AnalysisModuleChat）

**目标：** 让小索浮窗和模块对话两个 UI 入口都接入新 API。两个组件结构对称，改造内容 1:1 镜像。

### 5.1 改造 `CaseDetailXiaosuo.vue`

**File:** `app/components/caseDetail/CaseDetailXiaosuo.vue`

#### 5.1.1 新增 import

```typescript
import { toast } from 'vue-sonner'
import { QUEUE_MAX_SIZE } from '~/composables/chatQueueActions'
```

#### 5.1.2 重写 handleSubmit（约 line 59）

```typescript
function handleSubmit(data: { text: string; files?: any[] }) {
  if (!data.text.trim() && !data.files?.length) return

  // 暂停态强制入队 + loading 期间入队（spec §5.3）
  const shouldEnqueue =
    props.xiaosuoChat.isLoading.value || props.xiaosuoChat.isQueuePaused.value

  if (shouldEnqueue) {
    const ok = props.xiaosuoChat.enqueueMessage(data.text, data.files, thinking.value)
    if (!ok) {
      toast.warning(`队列已满（最多 ${QUEUE_MAX_SIZE} 条），请等待当前对话结束或清空队列`)
    } else {
      aiPromptInputRef.value?.reset()
    }
  } else {
    props.xiaosuoChat.sendMessage(data.text, { thinking: thinking.value })
  }
}
```

#### 5.1.3 新增 handleStop 去抖（spec §6.6）

```typescript
const isStopping = ref(false)
const TERMINAL_STATUSES = new Set(['cancelled', 'completed', 'failed'] as const)

async function handleStop() {
  if (isStopping.value) return
  // 短路检查：避免 watch + immediate 时序坑
  if (TERMINAL_STATUSES.has(props.xiaosuoChat.runStatus.value as any)) return

  isStopping.value = true
  let unwatch: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    isStopping.value = false
    unwatch?.()
    if (timer) clearTimeout(timer)
    unwatch = undefined
    timer = undefined
  }
  unwatch = watch(
    () => props.xiaosuoChat.runStatus.value,
    (s) => { if (TERMINAL_STATUSES.has(s as any)) cleanup() },
  )
  timer = setTimeout(cleanup, 3000)
  try {
    await props.xiaosuoChat.stopGeneration()
  } catch (err) {
    console.error('[chat-stop] stopGeneration failed', err)
    cleanup()
  }
}
```

#### 5.1.4 模板改动

- AiPromptInput 上原 `@stop="xiaosuoChat.stopGeneration()"` 改为 `@stop="handleStop"`
- AiPromptInput 新增 props：`:queue-length="queueLen"`、`:queue-full="queueFull"`（用下方 script 中的 computed 包装，不能直接 `xiaosuoChat.currentQueueLen`——**Vue 3 模板只自动 unwrap 顶层 Ref，嵌套 props 访问不会 unwrap**，须在 script 层手动 `.value`）
- 在 `<AiChat>` 的 `<template #prompt-actions>` 中新增 `<AiChatQueueChips>`，所有响应式字段通过 computed 解引用（与现有 `chatMessages` / `runStatus` 包装模式一致）：

先在 script setup 中添加 computed 包装：

```typescript
// 响应式字段 unwrap（Vue 3 template 不自动 unwrap 嵌套 props 的 Ref）
// 与 CaseDetailXiaosuo.vue 现有的 chatMessages / runStatus 包装模式保持一致
const currentQueue = computed(() => props.xiaosuoChat.currentQueue.value)
const queueLen = computed(() => props.xiaosuoChat.currentQueueLen.value)
const queueFull = computed(() => queueLen.value >= QUEUE_MAX_SIZE)
const isQueuePaused = computed(() => props.xiaosuoChat.isQueuePaused.value)
const queuePauseReason = computed(() => props.xiaosuoChat.queuePauseReason.value)
```

然后模板：

```vue
<template #prompt-actions>
  <div v-if="showRetryButton" class="...">...</div>
  <AiChatQueueChips
    :queue="currentQueue"
    :max="QUEUE_MAX_SIZE"
    :paused="isQueuePaused"
    :pause-reason="queuePauseReason"
    @remove="(id) => props.xiaosuoChat.removeQueueItem(id)"
    @resume="() => props.xiaosuoChat.resumeQueue()"
    @clear="() => props.xiaosuoChat.clearQueue()"
  />
</template>
```

**注意事件处理**：`@remove="xiaosuoChat.removeQueueItem"` 直接绑定 composable 方法存在 `this` 指向丢失风险（Pinia/Composable 方法通常是箭头函数或不依赖 this，但安全起见包一层箭头函数）。

### 5.2 对称改造 `AnalysisModuleChat.vue`

**File:** `app/components/case/AnalysisModuleChat.vue`

把 5.1 的所有改动 1:1 复制到这个文件。注意：
- handleSubmit 在第 67 行
- @stop 绑定在第 111 行
- :enable-file-upload="false" 在第 108 行
- 把 `xiaosuoChat` 替换为 `chatInstance`（或该组件实际使用的 prop 名）

### 5.3 类型与运行验证

```bash
npx nuxi typecheck                     # 无类型错误
bun dev                                 # 启动开发服务器
# 在浏览器中点开案件详情，打开小索浮窗，简单试发送 + 入队 + 停止
```

### 5.4 提交

```bash
git add app/components/caseDetail/CaseDetailXiaosuo.vue \
        app/components/case/AnalysisModuleChat.vue
git commit -m "feat(chat): 小索与模块对话接入队列 + 停止按钮去抖"
```

---

## Phase 6：E2E 测试 + 手动验证

### 6.1 E2E 测试

**File:** `tests/e2e/xiaosuo-chat-queue.spec.ts`（新建）

完整代码以 spec §9.7 为准。关键场景：
1. 发送第一条 → 等待生成
2. 生成中输入第二条 → 点击加入队列按钮 → 队列 chip 出现
3. 点击停止 → "队列已暂停" 横幅出现
4. 点击恢复 → 队列继续派发 → 新消息出现

```bash
npx playwright test tests/e2e/xiaosuo-chat-queue.spec.ts
```

### 6.2 手动验证（上线前必做）

启动 `bun dev`，**使用 Chrome DevTools 观察 Vue 响应式状态、网络面板、Console**。

#### 验证 1：单 tab 基本流程
1. 打开案件详情，点开小索浮窗
2. 发送 "第一个问题"，等待 AI 开始流式回复
3. 在生成中输入 "第二个问题"，点击加入队列按钮（带 +1 角标）
4. 输入 "第三个问题"，点击加入队列（角标 +2）
5. **预期**：聊天窗口出现 2 条 chip，横幅显示"排队中 (2/5)"
6. 等待第一条完成 → 第二条自动派发 → 完成后第三条自动派发
7. 队列清空，UI 回到普通态

#### 验证 2：停止 + 恢复
1. 发送一条长消息，在生成中输入并加入队列 2 条
2. **点击停止按钮** → 当前生成立即中断，partial 内容仍可见
3. **预期**：横幅变为"队列已暂停（已手动停止）"，显示"恢复队列"和"清空"按钮
4. 此时输入新消息发送 → 应入队（不直接发送），因为暂停态
5. 点击"恢复队列" → 队列从队头继续派发

#### 验证 3：失败自动暂停
1. 模拟后端故障（停 worker / 断 redis）
2. 发送消息触发 failed
3. **预期**：toast 显示失败 + 横幅自动切到"队列已暂停（上一条执行失败）"

#### 验证 4：队列满
1. 在生成中连续加入队列 5 次
2. 第 6 次点击 → **预期**：toast 提示"队列已满"，输入框内容不被清空（不丢失）

#### 验证 5：暂停态死锁防护
1. 暂停态 + 队列只剩 1 条 → 点击 × 删除
2. **预期**：暂停标记自动清除，下次输入直接发送（不再入队）

#### 验证 6：删除 session 清理
1. 暂停态 + 队列有内容
2. 删除当前 session
3. 切到下一个 session
4. **预期**：被删的 session 队列彻底清理，新 session 队列为空

#### 验证 7：模块对话对称行为
1. 在某个分析模块的对话面板里重复验证 1-6
2. **预期**：行为完全一致

#### 验证 8：跨标签同步
1. 同一案件在 tab A、tab B 各开一份
2. 在 tab A 入队 2 条
3. **预期**：tab B 的队列 chip 同步显示
4. 在 tab A 删除 1 条 → tab B 同步减少
5. 在 tab A 暂停 → tab B 横幅同步切到暂停态
6. 在 tab B 恢复 → tab A 也恢复，且只有一个 tab 派发（Web Lock 互斥）

#### 验证 9：Session 切换队列保留
1. 在 session A 入队 3 条暂停
2. 切到 session B 发送新消息（B 队列空）
3. 切回 session A
4. **预期**：A 的 3 条队列完整保留

#### 验证 10：刷新后队列清空（spec §2.2）
1. 在 session 入队 2 条
2. 刷新页面
3. **预期**：队列清空（仅内存持久化）。partial AIMessage 也消失（spec §8.2）

#### 验证 11：停止按钮连点去抖（第 2 轮审查新增，spec §5.5 / §6.6）
1. 发送消息触发 AI 流式生成
2. **在 100ms 内连续快速点击停止按钮 5 次**（DevTools → Network 面板观察）
3. **预期**：
   - 后端 `/api/v1/.../cancel` API 只收到 1 次调用（第二次起被 `isStopping` 守卫拦截）
   - 停止按钮在点击后立即置灰、显示禁用态
   - 约 3 秒内（runStatus 切终止态或 timeout）自动恢复

### 6.3 提交

```bash
git add tests/e2e/xiaosuo-chat-queue.spec.ts
git commit -m "test(e2e): 小索对话停止按钮和队列关键路径"
```

---

## 完成检查表

### 代码完整性
- [ ] Phase 1：纯函数测试全部通过
- [ ] Phase 2：跨标签事件类型已扩展，mock 工具已就绪
- [ ] Phase 3：useChatSessionManager 集成测试全部通过（含 reconnect 假边沿、interrupted 不派发、跨标签同步）
- [ ] Phase 4：AiChatQueueChips + AiPromptInput 组件测试全部通过
- [ ] Phase 5：双端组件改造完成且对称
- [ ] Phase 6：E2E 至少 1 个场景跑通

### 静态检查
- [ ] `npx nuxi typecheck` 无新增类型错误
- [ ] `npx vitest run` 无新增失败用例
- [ ] 新建文件均小于 500 行（spec §4.5 文件结构规范）
- [ ] 所有新代码无 `console.log`（项目规则禁止）

### 手动验证
- [ ] 验证 1-10 全部通过
- [ ] Vue DevTools 可观察到 `currentQueue` / `isQueuePaused` / `runStatus` 响应式变化
- [ ] Network 面板：停止按钮触发 `/api/v1/case/analysis/stop` 调用，且重复点击只调用一次（去抖生效）
- [ ] Console：无未捕获错误、无广播风暴（cross-tab listener 不二次广播）

### 收尾
- [ ] `simplify` 技能优化本次代码改动
- [ ] PR 描述包含 spec 链接和本 plan 链接
- [ ] 提交前 squash 不必要的 fixup commit（保留 6 个 phase 的清晰边界）

---

## 改动文件清单

### 新建（9 个）

**前端核心**：
- `app/composables/chatQueueActions.ts`
- `app/composables/useQueueDispatcher.ts`
- `app/components/ai/AiChatQueueChips.vue`

**测试**：
- `tests/app/utils/crossTabMocks.ts`
- `tests/app/components/ai/composables/chatQueueActions.test.ts`
- `tests/app/components/ai/composables/useChatSessionManager.test.ts`（新建或扩展）
- `tests/app/components/ai/composables/crossTabQueue.test.ts`
- `tests/app/components/ai/AiChatQueueChips.test.ts`
- `tests/e2e/xiaosuo-chat-queue.spec.ts`

### 修改（5 个）

- `app/composables/useChatSessionManager.ts`（扩展约 150 行）
- `app/composables/useCrossTabEvents.ts`（CrossTabEvents interface 增加 2 个事件，约 15 行）
- `app/components/ai/AiPromptInput.vue`（修复 3 bug + 新增 props，约 60 行改动）
- `app/components/caseDetail/CaseDetailXiaosuo.vue`（handleSubmit + handleStop + slot 挂载，约 60 行改动）
- `app/components/case/AnalysisModuleChat.vue`（同上对称，约 60 行改动）

### 不修改（与 spec §11.3 一致）

- `app/components/ai-elements/prompt-input/PromptInputSubmit.vue`
- `app/components/ai-elements/queue/*`（含 QueueItemContent.vue —— §7.3 通过原生 span 绕开）
- `app/composables/useCaseChat.ts`
- `app/composables/useStreamChat.ts`（onError 不写 runStatus 是 v5 已知边界，spec §8.1 #1）
- `server/services/agent/*`（partial AIMessage 持久化是 v5 明确不做的范围，spec §8.2）
- 数据库 schema

---

## 风险与回滚

### 主要风险

1. **跨 tab 同步死循环**：listener 接收事件后误调 broadcastState → 无限广播。**防御**：spec §5.7 硬约束 + Phase 3.3.8 的注释 + crossTabQueue.test.ts 专项测试。
2. **派发器 watch 在 manager scope 之外注册**：dispatcher 若意外挂在 switchSession 内的 inner scope 会被 dispose。**防御**：Phase 3.3.7 在 setup 顶层实例化，禁止在 switchSession 内调用 `useQueueDispatcher`。
3. **lastLocalSendSeq 两处遗漏一处**：会导致队列死锁。**防御**：Phase 3.3.5 sendMessage wrapper + Phase 3.2 doDispatch 内 `++` 都要写齐，集成测试覆盖"派发完成 → 链式 completed → 第二条派发"。
4. **TooltipTrigger as-child + QueueItemContent 嵌套失败**：v4 设计有 bug，v5 修订为原生 span。**防御**：Phase 4.2 严格按 spec §7.3 写法，组件测试中显式断言 Tooltip 行为。

### 回滚策略

如果上线后发现严重问题：
- **整体回滚**：本 PR 全部在前端，回滚 5-9 个文件 commit 即可，不涉及数据库迁移
- **局部回滚**：可以单独回滚 Phase 5（双端集成）保留 Phase 1-4 的基础设施，相当于"功能下线但代码留作下次"

### 不可回滚的部分

- 无（完全前端改动，无数据库 migration、无外部 API 变更）

---

## 附录：phase 之间的依赖图

```
Phase 1 (chatQueueActions)
   ↓
Phase 2 (CrossTabEvents 扩展 + mock 工具)
   ↓
Phase 3 (useQueueDispatcher + useChatSessionManager 扩展) ← 核心
   ↓
Phase 4 (AiChatQueueChips + AiPromptInput 修复)
   ↓
Phase 5 (CaseDetailXiaosuo + AnalysisModuleChat 集成)
   ↓
Phase 6 (E2E + 手动验证)
```

每个 Phase 只依赖前面已 commit 的代码，可以独立回滚到上一个 Phase。
