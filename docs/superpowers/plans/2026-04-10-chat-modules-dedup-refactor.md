# 三模块基础设施统一重构实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 init-analysis、案件分析页、模块对话、小索对话框四个消费方统一到同一套基础设施（Session DAO / useStreamChat / useChatSessionManager / ChatWindowShell / InterruptHandler），消除约 920 行重复代码。

**Architecture:** 自底向上 5 Phase 渐进重构。Phase 1 后端 Session DAO → Phase 2 前端 Composable 基类 → Phase 3 UI 外壳组件 → Phase 4 init-analysis 对齐 → Phase 5 遗留系统清理。每个 Phase 对应独立 PR，可回滚。

**Tech Stack:** TypeScript, Vue 3, Nuxt 4, Tailwind v4, shadcn-vue, Prisma, Redis (`server/lib/redis.ts`), `@langchain/vue@0.4.5` (useStream + FetchStreamTransport，走 `useStreamCustom` 路径), Vitest

**Spec:** `docs/superpowers/specs/2026-04-10-chat-modules-dedup-refactor-design.md` v1.2

**关键技术约束:**
- `@langchain/vue` 的 `useStreamCustom` 返回 ES6 getter（非 Ref/ComputedRef），`isLoading`/`error` 是 shallowRef
- `interruptComputed` 只依赖 `isLoading`（`stream.custom.js:49-52` 已知 bug），**必须从 `stream.values.__interrupt__` 读取**
- 服务端函数（`prisma`/`resSuccess`/`resError`/`getActiveRunService` 等）为 Nuxt 自动导入，无需 import
- 前端 composable（`useApiFetch`/`useCaseChat` 等）为 Nuxt 自动导入
- 测试使用 `npx vitest run`（非 `bun test`）
- 类型检查使用 `npx nuxi typecheck`（非 `tsc`）

---

## 文件结构总览

### 新增文件

| 文件 | 职责 | PR |
|---|---|---|
| `server/services/case/session.dao.ts` | Session CRUD DAO 抽象（5 个公共函数） | #1 |
| `server/api/v1/case/analysis/module-session/[sessionId].delete.ts` | 模块对话 session 删除 | #1 |
| `server/api/v1/case/analysis/session/[sessionId]/rename.patch.ts` | 通用 session 重命名 | #1 |
| `tests/server/case/session.dao.test.ts` | Session DAO 单元测试 | #1 |
| `app/composables/useStreamChat.ts` | 泛型流管理底层（绕过 interrupt 响应式 bug） | #2 |
| `app/composables/useChatSessionManager.ts` | 多 session 管理基类 | #2 |
| `app/composables/useStopActiveRun.ts` | 双重取消公共函数 | #2 |
| `app/components/case/interrupt/InterruptHandler.vue` | 统一中断调度器（4 种类型框架，insufficient_points 立即实现） | #2 |
| `app/components/case/ChatWindowShell.vue` | 窗口外壳组件（全屏/小窗/Sheet） | #3 |
| `app/components/case/SessionListPopover.vue` | Session 列表组件（小索+模块对话共用） | #3 |

### 改造文件

| 文件 | 当前行数 | 改造内容 | PR |
|---|---|---|---|
| `server/api/v1/case/analysis/xiaosuo-sessions.get.ts` | 43 | 委托给 DAO | #1 |
| `server/api/v1/case/analysis/module-sessions.get.ts` | 45 | 委托给 DAO | #1 |
| `server/api/v1/case/analysis/xiaosuo-session.post.ts` | 48 | 委托给 DAO | #1 |
| `server/api/v1/case/analysis/module-session.post.ts` | 88 | 委托给 DAO + 去除幂等事务 | #1 |
| `app/composables/useCaseChat.ts` | 98 | 基于 useStreamChat 重写 | #2 |
| `app/composables/useXiaosuoChat.ts` | 212 | 薄包装 useChatSessionManager | #2 |
| `app/composables/useModuleChatManager.ts` | 231 | 保留特有逻辑 + 委托基类 | #2 |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | 288 | 使用 ChatWindowShell + SessionListPopover | #3 |
| `app/components/case/AnalysisModuleChat.vue` | 132 | 使用 ChatWindowShell + SessionListPopover | #3 |
| `app/components/case/AnalysisModuleChatBar.vue` | 30 | 多 session 模式适配 | #3 |
| `app/composables/useInitAnalysis.ts` | 322 | 底层替换为 useStreamChat | #4 |
| `app/pages/dashboard/cases/init-analysis/[sessionId].vue` | 299 | 使用 InterruptHandler | #4 |
| `app/pages/dashboard/analysis/[sessionId].vue` | 240 | 使用 useStreamChat + InterruptHandler | #4 |

---

## PR #1: Phase 1 — 后端 Session DAO 抽象

### Task 1: Session DAO — 查询函数

**Files:**
- Create: `server/services/case/session.dao.ts`
- Create: `tests/server/case/session.dao.test.ts`

- [ ] **Step 1: 编写 validateCaseOwnershipDAO + listSessionsWithActiveRunDAO 测试**

> 参考 spec Section 3.1 的接口定义。Mock prisma/getActiveRunService（Nuxt 自动导入的全局变量），使用 `vi.fn()` 在 globalThis 上注入。参考项目已有的测试文件 `tests/server/case/case.dao.test.ts` 了解 mock 模式。

测试场景：
- `validateCaseOwnershipDAO`：案件属于用户返回记录、不属于返回 null
- `listSessionsWithActiveRunDAO`：返回带 hasActiveRun 标记的列表、权限校验失败返回 null、支持 metadataFilter、支持 orderBy

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/case/session.dao.test.ts --reporter=verbose`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 validateCaseOwnershipDAO + listSessionsWithActiveRunDAO**

> 实现参考 spec Section 3.1。关键：`prisma`/`getActiveRunService` 是 Nuxt 自动导入，不需要 import。使用 `export async function xxxDAO()` 命名规范（项目规范：DAO 后缀）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/case/session.dao.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/case/session.dao.ts tests/server/case/session.dao.test.ts
git commit -m "$(cat <<'EOF'
feat(dao): 新增 Session DAO 查询函数

- validateCaseOwnershipDAO: 公共权限校验
- listSessionsWithActiveRunDAO: session 列表 + activeRun 标记
EOF
)"
```

---

### Task 2: Session DAO — 变更函数

**Files:**
- Modify: `server/services/case/session.dao.ts`
- Modify: `tests/server/case/session.dao.test.ts`

- [ ] **Step 1: 编写 createSessionDAO / softDeleteSessionDAO / renameSessionDAO 测试**

测试场景：
- `createSessionDAO`：
  - 无 dedupeKey 直接创建
  - 有 dedupeKey + 锁获取成功 → 创建
  - 有 dedupeKey + 锁已存在 → 返回最近 session（isNew=false）
  - Redis 不可用 → 降级直接创建（日志 warn）
  - 案件不属于用户 → 返回 null
- `softDeleteSessionDAO`：
  - 正常软删除
  - 有 activeRun 先取消再删除
  - 类型不匹配返回错误
  - session 不存在返回错误
- `renameSessionDAO`：
  - 正常重命名（验证 $queryRaw 调用）
  - session 不存在返回错误

> Mock Redis：`vi.mock('~/server/lib/redis', () => ({ getRedisClient: () => mockRedis }))`
> Mock uuid：`vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }))`

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/server/case/session.dao.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: 实现三个函数**

> 参考 spec Section 3.1 的接口和逻辑。关键实现细节：
> - `createSessionDAO`：Redis `SET key EX ttl NX`（通过 `getRedisClient()` 获取 client），key 前缀 `session_dedupe:`（与 `session_state:` 区分）
> - `softDeleteSessionDAO`：`session.type in allowedTypes` 校验（用 type 而非 metadata.source）
> - `renameSessionDAO`：`prisma.$queryRaw` + PostgreSQL `jsonb_set` 原子更新

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/server/case/session.dao.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/services/case/session.dao.ts tests/server/case/session.dao.test.ts
git commit -m "$(cat <<'EOF'
feat(dao): 新增 Session DAO 变更函数

- createSessionDAO: Redis 并发防重 + 降级
- softDeleteSessionDAO: 公共软删除 + 类型校验 + activeRun 取消
- renameSessionDAO: jsonb_set 原子更新
EOF
)"
```

---

### Task 3: 瘦化现有 4 个 Session API

**Files:**
- Modify: `server/api/v1/case/analysis/xiaosuo-sessions.get.ts`
- Modify: `server/api/v1/case/analysis/module-sessions.get.ts`
- Modify: `server/api/v1/case/analysis/xiaosuo-session.post.ts`
- Modify: `server/api/v1/case/analysis/module-session.post.ts`

- [ ] **Step 1: 瘦化 xiaosuo-sessions.get.ts**

读取当前文件（43 行），替换为 ~15 行：参数校验 → `listSessionsWithActiveRunDAO({ caseId, userId, type: 1, metadataFilter: {path:['source'], equals:'xiaosuo'} })` → 响应映射（提取 title/createdAt/updatedAt/hasActiveRun）。

> 参考 spec Section 3.2。import DAO 函数：`import { listSessionsWithActiveRunDAO } from '~/server/services/case/session.dao'`

- [ ] **Step 2: 瘦化 module-sessions.get.ts**

读取当前文件（45 行），替换为 ~20 行：参数校验 → `listSessionsWithActiveRunDAO({ caseId, userId, type: 3 })` → 响应映射（提取 moduleName/nodeId/title/hasActiveRun/createdAt/updatedAt）。

- [ ] **Step 3: 瘦化 xiaosuo-session.post.ts**

读取当前文件（48 行），替换为 ~20 行：zod 参数校验 → `createSessionDAO({ caseId, userId, type: 1, metadata: {source:'xiaosuo', title}, dedupeKey })` → 返回 sessionId + title。

- [ ] **Step 4: 瘦化 module-session.post.ts**

读取当前文件（88 行），替换为 ~30 行：**删除 Serializable 事务 + P2002 回退**，改为 `createSessionDAO` + dedupeKey。保留 `getNodeByNameService(moduleName)` 调用。标题格式 `模块名-YYMMDDHHmm`（使用 `INIT_ANALYSIS_MODULES` 查找中文名）。

> 关键变更：模块对话改为多 session，不再需要"每案件每模块最多一个 session"的幂等约束。

- [ ] **Step 5: 运行现有测试确认无回归**

Run: `npx vitest run tests/server --reporter=verbose`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add server/api/v1/case/analysis/xiaosuo-sessions.get.ts \
    server/api/v1/case/analysis/module-sessions.get.ts \
    server/api/v1/case/analysis/xiaosuo-session.post.ts \
    server/api/v1/case/analysis/module-session.post.ts
git commit -m "$(cat <<'EOF'
refactor(api): 瘦化 4 个 Session API，委托给 Session DAO

- xiaosuo-sessions.get: 43 → ~15 行
- module-sessions.get: 45 → ~20 行
- xiaosuo-session.post: 48 → ~20 行
- module-session.post: 88 → ~30 行（去除 Serializable 事务）
EOF
)"
```

---

### Task 4: 新增 Delete + Rename API

**Files:**
- Create: `server/api/v1/case/analysis/module-session/[sessionId].delete.ts`
- Create: `server/api/v1/case/analysis/session/[sessionId]/rename.patch.ts`

- [ ] **Step 1: 创建 module-session delete API**

参考现有 `xiaosuo-session/[sessionId].delete.ts`（40 行）的结构。改为调用 `softDeleteSessionDAO({ sessionId, userId, allowedTypes: [3] })`。约 15 行。

- [ ] **Step 2: 创建 session rename API**

通用 API（小索和模块对话共用）。zod 校验 body `{ title: z.string().min(1).max(100) }` → `renameSessionDAO({ sessionId, userId, newTitle })`。约 20 行。

- [ ] **Step 3: 运行测试 + 类型检查**

Run: `npx vitest run tests/server --reporter=verbose && npx nuxi typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add server/api/v1/case/analysis/module-session/[sessionId].delete.ts \
    server/api/v1/case/analysis/session/[sessionId]/rename.patch.ts
git commit -m "$(cat <<'EOF'
feat(api): 新增模块对话 session 删除和通用 session 重命名 API
EOF
)"
```

---

## PR #2: Phase 2 — 前端 Composable 基础层

### Task 5: useStreamChat — 泛型流管理底层

**Files:**
- Create: `app/composables/useStreamChat.ts`

- [ ] **Step 1: 创建 useStreamChat.ts**

> **CRITICAL 实现细节**（来自 @langchain/vue 源码分析）：
> - `useStreamCustom` 返回值中 `values`/`interrupt`/`messages` 是 **ES6 getter**（非 Ref）
> - `isLoading`/`error` 是 **shallowRef**
> - `interruptData` **必须从 `stream.values.__interrupt__`** 读取（`interruptComputed` 只依赖 `isLoading`，bug 在 `stream.custom.js:49-52`）
> - `computed(() => stream.values)` 能正确响应更新：getter 内部读取 `streamValues.value`（shallowRef），Vue 的 activeEffect 机制会 track 这个读取

```typescript
// app/composables/useStreamChat.ts

/**
 * 泛型流管理底层 composable
 *
 * 将 useCaseChat 和 useInitAnalysis 共同的
 * FetchStreamTransport + useStream + computed 包装 + interrupt 解包
 * 抽取为可复用的泛型 composable。
 *
 * @langchain/vue 技术细节：
 * - FetchStreamTransport 路径走 useStreamCustom（非 useStreamLGP）
 * - useStreamCustom 返回的 values/interrupt/messages 是 ES6 getter（非 Ref）
 * - getter 内部读取 shallowRef.value，外层 computed 通过 Vue activeEffect 追踪
 * - interruptComputed 只依赖 isLoading（已知 bug：stream.custom.js:49-52）
 *   → 必须从 values.__interrupt__ 读取 interrupt 数据
 */

import { useStream, FetchStreamTransport } from '@langchain/vue'
import type { BaseMessage } from '@langchain/core/messages'

export interface StreamChatOptions {
    /** SSE API 端点 */
    apiUrl: string
    /** LangGraph thread ID */
    threadId?: string
    /** 状态对象中的消息字段名（默认 'messages'） */
    messagesKey?: string
    /** 自定义事件回调 */
    onCustomEvent?: (data: any) => void
    /** 初始状态值（用于从 checkpoint 恢复） */
    initialValues?: Record<string, unknown>
}

export function useStreamChat<T = any>(options: StreamChatOptions) {
    const transport = new FetchStreamTransport({
        apiUrl: options.apiUrl,
    })

    // useStream 在 FetchStreamTransport 路径下返回的是 useStreamCustom 的结果：
    // - values/interrupt/messages: ES6 getter（非 Ref）
    // - isLoading/error: shallowRef
    const stream = useStream<T>({
        transport,
        threadId: options.threadId,
        messagesKey: options.messagesKey ?? 'messages',
        onCustomEvent: options.onCustomEvent,
        initialValues: options.initialValues as T,
        onError: (error) => {
            console.error('[useStreamChat] 流错误:', error)
        },
    })

    // 标记历史消息是否已加载
    const hasHistoryLoaded = ref(false)
    watch(() => stream.values, (values) => {
        if (values && !hasHistoryLoaded.value) {
            hasHistoryLoaded.value = true
        }
    })

    return {
        // 状态
        // computed 包装 ES6 getter → 外层 computed 能通过 getter 内部的
        // shallowRef.value 读取建立依赖（Vue activeEffect 机制）
        messages: computed((): BaseMessage[] => {
            void stream.values // 显式触发 streamValues.value 的 track
            return stream.messages as BaseMessage[]
        }),
        values: computed(() => stream.values as T | undefined),
        isLoading: stream.isLoading,   // shallowRef，直接透传
        error: stream.error,           // shallowRef，直接透传
        hasHistoryLoaded,

        /**
         * 统一 interrupt 解包（CRITICAL：绕过 Vue 响应式 bug）
         *
         * 不能用 stream.interrupt（依赖 interruptComputed，只追踪 isLoading）
         * 必须从 stream.values（依赖 streamValues shallowRef）的 __interrupt__ 读取
         *
         * 与现有 useInitAnalysis.ts:72-76 和 CaseDetailXiaosuo.vue:53-57 一致。
         * 注意：不做中断类型过滤，所有类型的中断数据都传递到消费方。
         * 类型分发由 InterruptHandler 组件承担。
         */
        interruptData: computed(() => {
            const v = stream.values as any
            if (!v?.__interrupt__?.length) return null
            const raw = v.__interrupt__
            const resolved = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : raw) : raw
            return resolved?.value ?? resolved
        }),

        // 操作
        submit: (input?: any, config?: any) => stream.submit(input, config),
        stop: () => stream.stop(),
        reconnect: () => {
            hasHistoryLoaded.value = false
            stream.submit(undefined)
        },
        loadHistory: () => {
            hasHistoryLoaded.value = false
            stream.submit(undefined)
        },
        getMessagesMetadata: (msg: any, idx?: number) =>
            stream.getMessagesMetadata(msg, idx),
    }
}
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: 提交**

```bash
git add app/composables/useStreamChat.ts
git commit -m "feat(composable): 新增 useStreamChat 泛型流管理底层（绕过 interrupt 响应式 bug）"
```

---

### Task 6: useStopActiveRun + useCaseChat 重写

**Files:**
- Create: `app/composables/useStopActiveRun.ts`
- Modify: `app/composables/useCaseChat.ts`

- [ ] **Step 1: 创建 useStopActiveRun.ts**

```typescript
// app/composables/useStopActiveRun.ts

/**
 * 双重取消公共函数：SSE stop + 查询 runId + 调用 cancel API。
 * 消除 useXiaosuoChat:149-168 和 useModuleChatManager:133-152 的重复。
 */
export async function stopActiveRun(sessionId: string): Promise<void> {
    try {
        const runData = await useApiFetch<{ run: { id: string } | null }>(
            `/api/v1/case/analysis/runs/current/${sessionId}`,
        )
        if (runData?.run?.id) {
            await useApiFetch(
                `/api/v1/case/analysis/runs/cancel/${runData.run.id}`,
                { method: 'POST' },
            )
        }
    }
    catch (error) {
        console.error('[stopActiveRun] 取消失败:', error)
    }
}
```

- [ ] **Step 2: 重写 useCaseChat.ts**

> 读取当前 `useCaseChat.ts`（98 行），用 useStreamChat 替换内部的 FetchStreamTransport + useStream + computed 包装。保留 sendMessage / resumeInterrupt / stopGeneration 业务方法。
>
> 关键变更：删除直接的 `import { useStream, FetchStreamTransport } from '@langchain/vue'`，改为使用 useStreamChat（Nuxt 自动导入）。

```typescript
// app/composables/useCaseChat.ts

/**
 * 案件分析对话 composable
 *
 * 基于 useStreamChat 的特化，提供 sendMessage / resumeInterrupt / stopGeneration。
 */

export interface CaseChatOptions {
    /** 会话 ID（作为 thread_id） */
    sessionId: string
    /** 自定义事件回调 */
    onCustomEvent?: (data: any) => void
}

export function useCaseChat(options: CaseChatOptions) {
    const stream = useStreamChat({
        apiUrl: '/api/v1/case/analysis/chat',
        threadId: options.sessionId,
        messagesKey: 'messages',
        onCustomEvent: options.onCustomEvent,
    })

    return {
        ...stream,

        sendMessage: (message: string, opts?: { thinking?: boolean }) => {
            stream.submit({
                messages: [{ type: 'human', content: message }],
                thinking: opts?.thinking,
            } as any)
        },

        resumeInterrupt: (data: any) => {
            stream.submit(undefined, {
                command: { resume: data },
            })
        },

        stopGeneration: () => stream.stop(),
    }
}
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 4: 提交**

```bash
git add app/composables/useStopActiveRun.ts app/composables/useCaseChat.ts
git commit -m "$(cat <<'EOF'
refactor(composable): useCaseChat 基于 useStreamChat 重写 + useStopActiveRun

- useCaseChat: 98 行 → ~35 行
- 新增 useStopActiveRun 消除双重取消重复
EOF
)"
```

---

### Task 7: useChatSessionManager — 多 session 管理基类

**Files:**
- Create: `app/composables/useChatSessionManager.ts`

- [ ] **Step 1: 创建 useChatSessionManager.ts**

> 完整代码参考 spec Section 4.4。核心模式提取自 useXiaosuoChat（effectScope + switchCounter + disposeCurrentChat）和 useModuleChatManager（stopGeneration 双重取消 + hasActiveRun 恢复）。

```typescript
// app/composables/useChatSessionManager.ts

/**
 * 多 session 管理基类
 *
 * 封装小索和模块对话共同的多 session 生命周期管理：
 * - effectScope 管理（每 session 独立 scope）
 * - 竞态防护（switchCounter）
 * - hasActiveRun 自动 reconnect / loadHistory
 * - stopGeneration 双重取消（SSE + Worker）
 * - init 幂等保护
 */

import { effectScope } from 'vue'
import type { EffectScope, MaybeRef } from 'vue'

export interface SessionItem {
    sessionId: string
    title: string
    createdAt: string
    updatedAt: string
    hasActiveRun: boolean
}

export interface ChatSessionManagerOptions {
    caseId: MaybeRef<number>
    listUrl: (caseId: number) => string
    createUrl: string
    deleteUrl: (sessionId: string) => string
    buildCreateBody: (caseId: number, title?: string) => Record<string, any>
    onCustomEvent?: (data: any) => void
}

export function useChatSessionManager(options: ChatSessionManagerOptions) {
    const resolvedCaseId = toRef(options.caseId)

    const sessions = ref<SessionItem[]>([])
    const currentSessionId = ref<string | null>(null)
    const isSessionLoading = ref(false)
    const initialized = ref(false)

    // effectScope 管理（参照 useXiaosuoChat:31-45）
    let currentScope: EffectScope | null = null
    const currentChat = shallowRef<ReturnType<typeof useCaseChat> | null>(null)
    let switchCounter = 0

    function disposeCurrentChat() {
        if (currentScope) {
            currentScope.stop()
            currentScope = null
            currentChat.value = null
        }
    }

    // 代理当前对话状态
    const messages = computed(() => currentChat.value?.messages.value ?? [])
    const values = computed(() => currentChat.value?.values.value)
    const isLoading = computed(() => currentChat.value?.isLoading.value ?? false)
    const interruptData = computed(() => currentChat.value?.interruptData.value)

    // ── Session CRUD ──

    async function fetchSessions() {
        const result = await useApiFetch<SessionItem[]>(
            options.listUrl(resolvedCaseId.value),
        )
        if (result) {
            sessions.value = result
        }
    }

    async function createSession(title?: string): Promise<string> {
        const result = await useApiFetch<{ sessionId: string; title: string }>(
            options.createUrl,
            {
                method: 'POST',
                body: options.buildCreateBody(resolvedCaseId.value, title),
            },
        )
        if (!result?.sessionId) throw new Error('创建 session 失败')

        sessions.value = [
            {
                sessionId: result.sessionId,
                title: result.title,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                hasActiveRun: false,
            },
            ...sessions.value,
        ]

        await switchSession(result.sessionId)
        return result.sessionId
    }

    async function switchSession(sessionId: string) {
        const currentSwitch = ++switchCounter
        disposeCurrentChat()
        currentSessionId.value = sessionId

        const newScope = effectScope()
        const newChat = newScope.run(() =>
            useCaseChat({ sessionId, onCustomEvent: options.onCustomEvent }),
        )!

        if (currentSwitch !== switchCounter) {
            newScope.stop()
            return
        }

        currentScope = newScope
        currentChat.value = newChat

        const session = sessions.value.find(s => s.sessionId === sessionId)
        if (session?.hasActiveRun) {
            currentChat.value.reconnect()
        }
        else {
            currentChat.value.loadHistory()
        }
    }

    async function deleteSession(sessionId: string) {
        await useApiFetch(options.deleteUrl(sessionId), { method: 'DELETE' })
        sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)

        if (currentSessionId.value === sessionId) {
            if (sessions.value.length > 0) {
                await switchSession(sessions.value[0]!.sessionId)
            }
            else {
                await createSession()
            }
        }
    }

    async function renameSession(sessionId: string, newTitle: string) {
        await useApiFetch(
            `/api/v1/case/analysis/session/${sessionId}/rename`,
            { method: 'PATCH', body: { title: newTitle } },
        )
        sessions.value = sessions.value.map(s =>
            s.sessionId === sessionId ? { ...s, title: newTitle } : s,
        )
    }

    // ── 消息操作 ──

    function sendMessage(text: string, opts?: { thinking?: boolean }) {
        currentChat.value?.sendMessage(text, opts)
    }

    function resumeInterrupt(data: any) {
        currentChat.value?.resumeInterrupt(data)
    }

    async function stopGeneration() {
        currentChat.value?.stopGeneration()
        const sid = currentSessionId.value
        if (sid) await stopActiveRun(sid)
    }

    // ── 初始化（幂等） ──

    async function init() {
        if (initialized.value) return
        isSessionLoading.value = true

        try {
            await fetchSessions()
            if (sessions.value.length === 0) {
                await createSession()
            }
            else {
                await switchSession(sessions.value[0]!.sessionId)
            }
            initialized.value = true
        }
        finally {
            isSessionLoading.value = false
        }
    }

    onUnmounted(() => disposeCurrentChat())

    return {
        sessions,
        currentSessionId,
        isSessionLoading,
        messages,
        values,
        isLoading,
        interruptData,
        createSession,
        switchSession,
        deleteSession,
        renameSession,
        sendMessage,
        resumeInterrupt,
        stopGeneration,
        init,
    }
}
```

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: 提交**

```bash
git add app/composables/useChatSessionManager.ts
git commit -m "feat(composable): 新增 useChatSessionManager 多 session 管理基类"
```

---

### Task 8: 重写 useXiaosuoChat + useModuleChatManager

**Files:**
- Modify: `app/composables/useXiaosuoChat.ts`
- Modify: `app/composables/useModuleChatManager.ts`

- [ ] **Step 1: 重写 useXiaosuoChat 为薄包装**

> 读取当前 useXiaosuoChat.ts（212 行），完全替换为 useChatSessionManager 的薄包装。

```typescript
// app/composables/useXiaosuoChat.ts

/**
 * 小索对话管理 composable — 基于 useChatSessionManager 的薄包装
 */
import type { MaybeRef } from 'vue'

export function useXiaosuoChat(caseId: MaybeRef<number>) {
    return useChatSessionManager({
        caseId,
        listUrl: (id) => `/api/v1/case/analysis/xiaosuo-sessions?caseId=${id}`,
        createUrl: '/api/v1/case/analysis/xiaosuo-session',
        deleteUrl: (sid) => `/api/v1/case/analysis/xiaosuo-session/${sid}`,
        buildCreateBody: (id, title) => ({ caseId: id, title }),
    })
}
```

- [ ] **Step 2: 重写 useModuleChatManager**

> 读取当前 useModuleChatManager.ts（231 行）。保留：instances dict、expandedModule/expandModule/collapseAll、activeModules computed、restoreActiveSessions。删除：effectScope 管理、stopGeneration 双重取消、hasActiveRun 分支（全部委托给 useChatSessionManager）。
>
> 关键设计：`instances: Record<string, ReturnType<typeof useChatSessionManager>>`——每模块一个 session manager，manager 内部管理该模块的多个 session。

```typescript
// app/composables/useModuleChatManager.ts

/**
 * 模块对话管理 composable
 *
 * 每模块一个 useChatSessionManager 实例，manager 内部管理该模块的多个 session。
 */

import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'
import type { Ref } from 'vue'

export interface ModuleChatManagerOptions {
    onAnalysisSaved?: () => void
}

export function useModuleChatManager(caseId: Ref<number>, options: ModuleChatManagerOptions = {}) {
    const instances = shallowReactive<Record<string, ReturnType<typeof useChatSessionManager>>>({})
    const expandedModule = ref<string | null>(null)

    const activeModules = computed(() =>
        Object.values(instances).filter(i =>
            i.isLoading.value || (i.sessions.value.length > 0 && i.currentSessionId.value),
        ),
    )

    async function getOrCreateModuleManager(
        moduleName: string,
        moduleTitle: string,
    ): Promise<ReturnType<typeof useChatSessionManager>> {
        if (instances[moduleName]) return instances[moduleName]

        const manager = useChatSessionManager({
            caseId,
            listUrl: (id) =>
                `/api/v1/case/analysis/module-sessions?caseId=${id}&moduleName=${moduleName}`,
            createUrl: '/api/v1/case/analysis/module-session',
            deleteUrl: (sid) => `/api/v1/case/analysis/module-session/${sid}`,
            buildCreateBody: (id, title) => ({ caseId: id, moduleName, title }),
            onCustomEvent: (eventData: any) => {
                if (eventData.name === 'analysis_result_saved') {
                    options.onAnalysisSaved?.()
                }
            },
        })

        instances[moduleName] = manager
        triggerRef(expandedModule)
        return manager
    }

    function expandModule(moduleName: string) {
        expandedModule.value = moduleName
    }

    function collapseAll() {
        expandedModule.value = null
    }

    async function restoreActiveSessions() {
        const sessionsData = await useApiFetch<Array<{
            sessionId: string
            moduleName: string
            nodeId: number
            hasActiveRun: boolean
        }>>(
            `/api/v1/case/analysis/module-sessions?caseId=${caseId.value}`,
        )
        if (!sessionsData) return

        const moduleNames = new Set(sessionsData.map(s => s.moduleName))
        for (const moduleName of moduleNames) {
            const moduleDef = INIT_ANALYSIS_MODULES.find(m => m.name === moduleName)
            const title = moduleDef?.title ?? moduleName
            const manager = await getOrCreateModuleManager(moduleName, title)
            await manager.init()
        }
    }

    return {
        instances,
        getOrCreateModuleManager,
        expandModule,
        collapseAll,
        expandedModule,
        activeModules,
        restoreActiveSessions,
    }
}
```

- [ ] **Step 3: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 4: 提交**

```bash
git add app/composables/useXiaosuoChat.ts app/composables/useModuleChatManager.ts
git commit -m "$(cat <<'EOF'
refactor(composable): useXiaosuoChat + useModuleChatManager 基于基类重写

- useXiaosuoChat: 212 → ~15 行
- useModuleChatManager: 231 → ~75 行
EOF
)"
```

---

### Task 9: InterruptHandler 组件

**Files:**
- Create: `app/components/case/interrupt/InterruptHandler.vue`

- [ ] **Step 1: 创建 InterruptHandler.vue**

> 参考 spec Section 4.7 完整代码。关键点：
> - 按 InterruptType 分发（framework for 4 types，insufficient_points 立即实现）
> - 使用 InitAnalysisInsufficientPointsCard（含完整支付流程），而非 case/interrupt/InsufficientPointsHandler（旧版简陋）
> - Dialog 样式对齐 analysis/[sessionId].vue:16-31 的现有实现

参考 spec Section 4.7 写入完整组件代码。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: 提交**

```bash
git add app/components/case/interrupt/InterruptHandler.vue
git commit -m "feat(ui): 新增 InterruptHandler 统一中断调度器（4 种类型框架）"
```

---

## PR #3: Phase 3 — UI 外壳层

### Task 10: ChatWindowShell 组件

**Files:**
- Create: `app/components/case/ChatWindowShell.vue`

- [ ] **Step 1: 创建 ChatWindowShell.vue**

> 读取 `CaseDetailXiaosuo.vue`（288 行）和 `AnalysisModuleChat.vue`（132 行）的当前布局代码，提取公共结构。
>
> 三种窗口形态：
> - 桌面全屏：`fixed inset-0 z-50`
> - 桌面小窗：`fixed` + `useDraggableResize`（支持 `positionOffset` prop）
> - 移动端 Sheet：`Sheet side="bottom" class="h-dvh"`
>
> Props 参考 spec Section 5.1。Slots：`#titlebar-left`、`#titlebar-right`、`#default`。
> 内部集成 `useDraggableResize`（参考 AnalysisModuleChat.vue:26-34 的调用方式）。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: 提交**

```bash
git add app/components/case/ChatWindowShell.vue
git commit -m "feat(ui): 新增 ChatWindowShell 窗口外壳（全屏/小窗/Sheet）"
```

---

### Task 11: SessionListPopover 组件

**Files:**
- Create: `app/components/case/SessionListPopover.vue`

- [ ] **Step 1: 创建 SessionListPopover.vue**

> 提取自 CaseDetailXiaosuo.vue:120-142（Popover session 列表）。小索和模块对话共用。
> Props: `sessions: SessionItem[]`, `currentId: string | null`, `loading?: boolean`
> Emits: `select(sessionId)`, `create()`, `delete(sessionId)`, `rename(sessionId, title)`
> 内部结构：Popover → 列表（title + dayjs().fromNow()）+ 重命名（inline Input）+ 删除（确认）+ 新建按钮

- [ ] **Step 2: 提交**

```bash
git add app/components/case/SessionListPopover.vue
git commit -m "feat(ui): 新增 SessionListPopover 共享 session 列表组件"
```

---

### Task 12: 重写 CaseDetailXiaosuo + AnalysisModuleChat

**Files:**
- Modify: `app/components/caseDetail/CaseDetailXiaosuo.vue`
- Modify: `app/components/case/AnalysisModuleChat.vue`
- Modify: `app/components/case/AnalysisModuleChatBar.vue`

- [ ] **Step 1: 重写 CaseDetailXiaosuo.vue**

> 读取当前文件（288 行）。用 ChatWindowShell + SessionListPopover + InterruptHandler 替换。保留 thinking ref、handleSubmit 逻辑、悬浮按钮。
> 关键改动：
> - 删除三处 AiChat（全屏/小窗/Sheet）→ 统一由 ChatWindowShell 内的单个 AiChat 处理
> - 删除两处 Popover session 列表 → 使用 SessionListPopover
> - 删除 Dialog + InsufficientPointsCard → 使用 InterruptHandler
> - 删除 useDraggableResize 调用 → 由 ChatWindowShell 内部封装
> - 删除 interrupt/interruptData computed → 使用 xiaosuoChat.interruptData

- [ ] **Step 2: 重写 AnalysisModuleChat.vue**

> 读取当前文件（132 行）。同理用 ChatWindowShell + SessionListPopover + InterruptHandler 替换。
> 关键变更：
> - **新增** InterruptHandler（之前完全没有中断 UI——这是补齐功能缺失）
> - **新增** SessionListPopover（多 session 支持）
> - 传入 `positionOffset` 使窗口偏移避免与小索重叠

- [ ] **Step 3: 适配 AnalysisModuleChatBar.vue**

> 读取当前文件（30 行）。多 session 模式下确认 isLoading/isActive 数据源是否需要调整（从 ModuleChatInstance 改为 useChatSessionManager 返回值）。

- [ ] **Step 4: 类型检查 + 测试**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 5: 提交**

```bash
git add app/components/caseDetail/CaseDetailXiaosuo.vue \
    app/components/case/AnalysisModuleChat.vue \
    app/components/case/AnalysisModuleChatBar.vue
git commit -m "$(cat <<'EOF'
refactor(ui): 重写小索 + 模块对话组件，使用 ChatWindowShell

- CaseDetailXiaosuo: 288 → ~100 行
- AnalysisModuleChat: 132 → ~70 行（新增 InterruptHandler + SessionListPopover）
- AnalysisModuleChatBar: 适配多 session 模式
EOF
)"
```

---

## PR #4: Phase 4 — init-analysis 与案件分析页对齐

### Task 13: useInitAnalysis TDD 对比测试

**Files:**
- Create: `tests/server/workflow/useInitAnalysis.comparison.test.ts`

- [ ] **Step 1: 编写对比测试**

> **CRITICAL**：改造前先锁定 useInitAnalysis 的关键行为。
> 测试项（参考 spec Section 6.1 前置条件）：
>
> 1. **watch(values) 触发行为**：当 orchestrator 更新 streamValues 时，watch 回调是否正确触发
> 2. **moduleStates 推断**：给定 values.result 和 values.failedModules，验证 moduleStates 的 idle/streaming/complete/failed 转换
> 3. **mergedResult**：验证 DB 结果 + 流式结果的合并（流式优先覆盖）
> 4. **streamMessages**：验证实时消息 vs checkpoint 消息的合并（实时优先）
> 5. **interrupt 触发**：当 values.__interrupt__ 变化时，interruptData 是否正确更新
>
> 注意：这些测试是对现有行为的"快照"，用于改造后确认行为不变。

- [ ] **Step 2: 运行对比测试确认通过（改造前基线）**

Run: `npx vitest run tests/server/workflow/useInitAnalysis.comparison.test.ts --reporter=verbose`
Expected: PASS（基线通过）

- [ ] **Step 3: 提交**

```bash
git add tests/server/workflow/useInitAnalysis.comparison.test.ts
git commit -m "test(workflow): useInitAnalysis 对比测试（Phase 4 改造前基线）"
```

---

### Task 14: useInitAnalysis 底层替换 + init-analysis 页面

**Files:**
- Modify: `app/composables/useInitAnalysis.ts`
- Modify: `app/pages/dashboard/cases/init-analysis/[sessionId].vue`

- [ ] **Step 1: 改造 useInitAnalysis.ts**

> 读取当前文件（322 行）。替换点（基于最新代码核对行号）：
>
> 1. 删除 `import { useStream, FetchStreamTransport } from '@langchain/vue'`
> 2. 第 56-65 行：`reactive(useStream({...}))` → `useStreamChat<InitAnalysisState>({ apiUrl: '/api/v1/case/init-analysis', threadId: sessionId.value, messagesKey: 'messages' })`
> 3. 第 67-68 行：删除 `values = computed(...)` 和 `isLoading = computed(...)`（从 stream 直接获取）
> 4. 第 72-76 行：删除 interrupt 解包 computed（使用 `stream.interruptData`）
> 5. **所有 `stream.xxx` 直接访问改为 `stream.xxx.value`**（因为 useStreamChat 返回 ComputedRef，不再是 reactive 展开的裸值）
>    - `stream.values` → `stream.values.value`（在 watch/computed getter 中用 `stream.values.value`）
>    - `stream.isLoading` → `stream.isLoading.value`（shallowRef，已经需要 .value）
>    - `stream.messages` → `stream.messages.value`
> 6. 第 88-98 行的 `streamMessages` computed：替换 `stream.messages` → `stream.messages.value`
> 7. 第 101 行的 `watch(values, ...)` → `watch(() => stream.values.value, ...)`
>
> **保留不动的工作流特有逻辑**（约 200 行）：
> - phase 状态机、moduleStates 推断、moduleMessagesMap 分组
> - mergedResult、resultFromDB
> - startAnalysis、resumeWorkflow、retryModule

- [ ] **Step 2: 改造 init-analysis/[sessionId].vue**

> 读取当前文件（299 行）。删除 interrupt 解包 computed（约第 283-290 行）和 Dialog + InsufficientPointsCard（约第 94-108 行），替换为 InterruptHandler：
> ```vue
> <CaseInterruptInterruptHandler
>     :interrupt-data="interruptData"
>     @resume="resumeWorkflow"
> />
> ```
> 其中 `interruptData` 现在从 composable 的 `stream.interruptData` 获取。

- [ ] **Step 3: 运行对比测试确认行为不变**

Run: `npx vitest run tests/server/workflow/useInitAnalysis.comparison.test.ts --reporter=verbose`
Expected: PASS（与基线行为一致）

- [ ] **Step 4: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 5: 提交**

```bash
git add app/composables/useInitAnalysis.ts \
    app/pages/dashboard/cases/init-analysis/[sessionId].vue
git commit -m "$(cat <<'EOF'
refactor(composable): useInitAnalysis 底层替换为 useStreamChat

- 删除 reactive(useStream) + 手动 computed 包装
- 使用 stream.interruptData 统一解包（绕过 Vue 响应式 bug）
- init-analysis 页面使用 InterruptHandler 组件
- TDD 对比测试确认行为不变
EOF
)"
```

---

### Task 15: analysis/[sessionId].vue 对齐

**Files:**
- Modify: `app/pages/dashboard/analysis/[sessionId].vue`

- [ ] **Step 1: 改造 analysis/[sessionId].vue**

> 读取当前文件（240 行）。替换点：
>
> 1. 第 37 行：删除 `import { useStream, FetchStreamTransport } from "@langchain/vue"`
> 2. 第 63-74 行：`reactive(useStream({...}))` → `useStreamChat({...})`
> 3. 所有 `stream.xxx` 直接访问改为 `stream.xxx.value`（与 Task 14 相同的机械替换）
> 4. 第 156-170 行：删除 interrupt / interruptData 两个 computed
> 5. 第 15-31 行：删除 Dialog + InsufficientPointsCard → 使用 InterruptHandler
>
> **保留不动**：coerceRawMessages（第 77-95 行）、streamMessages/historyMessages/displayMessages 三层合并逻辑（第 98-147 行）、useTaskQueueParser、handleToolConfirm/handleToolReject。

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: 提交**

```bash
git add app/pages/dashboard/analysis/[sessionId].vue
git commit -m "$(cat <<'EOF'
refactor(page): analysis/[sessionId] 使用 useStreamChat + InterruptHandler
EOF
)"
```

---

## PR #5: Phase 5 — 遗留系统验证 + 清理

### Task 16: 验证并清理死代码

**Files (验证后可能删除):**
- `app/composables/useCaseAnalysis.ts` (1010 行)
- `app/components/case/InterruptConfirmation.vue`
- `app/components/case/ConversationList.vue`
- `app/components/case/AIResponse.vue`
- `server/api/v1/case/analysis/stream/[sessionId].post.ts`
- `server/api/v1/case/analysis/stream/index.post.ts`

- [ ] **Step 1: 验证死代码**

```bash
# 验证 useCaseAnalysis 函数无调用方
grep -r "useCaseAnalysis()" app/ --include="*.vue" --include="*.ts" -l

# 验证 3 个组件无引用
grep -ri "InterruptConfirmation\|CaseAIResponse\b\|CaseConversationList\b" app/ --include="*.vue" --include="*.ts" -l

# 验证 stream API 无使用
grep -r "analysis/stream" app/ --include="*.vue" --include="*.ts" -l

# 检查 Nuxt auto-import 是否可能隐式加载
grep -r "InterruptConfirmation\|ConversationList\|AIResponse" app/pages/ app/layouts/ --include="*.vue" -l
```

Expected: 所有 grep 返回空或只返回定义文件本身

- [ ] **Step 2: 删除确认后的死代码**

> **注意**：`case/interrupt/` 下的 4 个 Handler 组件（CaseInfoCheckHandler、BasicInfoConfirmHandler、ModuleSelectHandler、InsufficientPointsHandler）**不删除**——它们可被 InterruptHandler 未来扩展复用。

- [ ] **Step 3: 运行全量测试确认无回归**

Run: `npx vitest run --reporter=verbose`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add -A  # 确认删除的文件
git status  # 复核
git commit -m "$(cat <<'EOF'
chore: 清理遗留对话系统死代码

删除 useCaseAnalysis (1010 行) + InterruptConfirmation + ConversationList +
AIResponse + 旧 stream API（经验证均无活跃消费方）
EOF
)"
```

---

## 收尾

### Task 17: 全量回归 + 类型检查 + simplify

- [ ] **Step 1: 全量测试**

Run: `npx vitest run --reporter=verbose`
Expected: PASS

- [ ] **Step 2: 类型检查**

Run: `npx nuxi typecheck`
Expected: 无新增类型错误

- [ ] **Step 3: simplify 审查**

使用 `simplify` 技能审查本次改动涉及的所有文件。

- [ ] **Step 4: 最终提交（如有优化）**

```bash
git status
git add <显式列出的文件>
git commit -m "refactor: simplify — 三模块基础设施统一代码整理"
```

---

## 依赖关系

```
PR #1 (Backend DAO):
  Task 1 → Task 2 → Task 3 → Task 4
                                │
PR #2 (Frontend Composable):    │
  Task 5 → Task 6 → Task 7 → Task 8 → Task 9
                                         │
                         ┌───────────────┴──────────────┐
PR #3 (UI Shell):        │               PR #4 (init-analysis):
  Task 10 → Task 11 → Task 12             Task 13 → Task 14 → Task 15
                         │                               │
                         └───────────────┬──────────────┘
                                         │
PR #5 (Legacy Cleanup):   Task 16
                                         │
                                   Task 17 (收尾)
```

**合并顺序建议**：PR #1 → PR #2 → PR #4（最高风险优先验证）→ PR #3 → PR #5

---

## E2E 手动验收清单

每个 PR 合并前在开发环境验证：

- [ ] **小索对话框**：打开 → 新建/切换/删除 session → 重命名 → 发消息 → 流式回复 → 停止生成 → 积分不足中断恢复
- [ ] **模块对话**：重新生成 → 新建 session → 切换 → 删除旧 session → 发消息 → 中断恢复 → 状态条显示正确
- [ ] **初始化分析**：选择模块 → 开始分析 → 页面刷新恢复 → 积分不足中断 → 支付后继续
- [ ] **案件分析页**：发消息 → 流式回复 → 积分不足中断 → 恢复
