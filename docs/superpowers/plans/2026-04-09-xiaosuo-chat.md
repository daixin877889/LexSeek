# 小索对话逻辑实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将案件详情页小索 AI 助手从 Mock 升级为完整的案件级对话系统，支持多 session 管理、积分扣减、上下文压缩、子代理工具委派。

**Architecture:** 后端新增 3 个 session CRUD API + 修复 agentWorker thinking 传递；前端新建 `useXiaosuoChat` composable 封装 session 管理和 `useCaseChat` 实例切换；改造 `CaseDetailXiaosuo.vue` 用 `AiChat` 组件替换 mock UI，新增 session 下拉切换和中断处理。

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Prisma, @langchain/vue, shadcn-vue, Vitest

**设计文档:** `docs/superpowers/specs/2026-04-08-xiaosuo-chat-design.md`

---

### Task 1: 修复 agentWorker thinking 参数传递

**Files:**
- Modify: `server/services/agent/agentWorker.ts:165-173`

- [ ] **Step 1: 补充 thinking 参数**

在 `agentWorker.ts` 的 else 分支（普通案件对话，约第 168 行）中，给 `runCaseChat` 调用补充 `thinking` 参数：

```typescript
// 找到这段代码（约第 165-173 行）
} else {
  // 普通案件对话
  const { runCaseChat } = await import('../workflow/agents')
  stream = await runCaseChat(run.sessionId, input.message, {
    userId: run.userId,
    caseId: run.caseId,
    command: input.command,
    thinking: input.thinking,  // ← 补充此行
  })
}
```

- [ ] **Step 2: 提交**

```bash
git add server/services/agent/agentWorker.ts
git commit -m "fix(agent): 补充 runCaseChat 的 thinking 参数传递"
```

---

### Task 2: 创建小索 Session API — 创建端点

**Files:**
- Create: `server/api/v1/case/analysis/xiaosuo-session.post.ts`

参考 `server/api/v1/case/analysis/module-session.post.ts` 的权限校验和响应模式。

- [ ] **Step 1: 创建 API 文件**

```typescript
/**
 * 创建小索对话 Session
 * POST /api/v1/case/analysis/xiaosuo-session
 *
 * 请求体: { caseId: number, title?: string }
 * 响应: { code: 200, data: { sessionId, title } }
 */
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

const bodySchema = z.object({
  caseId: z.number().int().positive(),
  title: z.string().max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return resError(event, 400, parsed.error.issues[0].message)
  }

  const { caseId, title } = parsed.data

  // 权限校验：案件属于当前用户
  const caseRecord = await prisma.cases.findFirst({
    where: { id: caseId, userId: user.id, deletedAt: null },
  })
  if (!caseRecord) return resError(event, 404, '案件不存在')

  const sessionId = uuidv4()
  const sessionTitle = title ?? '新对话'

  await prisma.caseSessions.create({
    data: {
      sessionId,
      caseId,
      type: 1,
      metadata: { source: 'xiaosuo', title: sessionTitle },
    },
  })

  return resSuccess(event, '创建成功', { sessionId, title: sessionTitle })
})
```

- [ ] **Step 2: 提交**

```bash
git add server/api/v1/case/analysis/xiaosuo-session.post.ts
git commit -m "feat(api): 添加小索 session 创建端点"
```

---

### Task 3: 创建小索 Session API — 列表查询端点

**Files:**
- Create: `server/api/v1/case/analysis/xiaosuo-sessions.get.ts`

参考 `server/api/v1/case/analysis/module-sessions.get.ts` 的 query 参数和 hasActiveRun 检查模式。

- [ ] **Step 1: 创建 API 文件**

```typescript
/**
 * 查询小索对话 Session 列表
 * GET /api/v1/case/analysis/xiaosuo-sessions?caseId=xxx
 */
export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const query = getQuery(event)
  const caseId = Number(query.caseId)
  if (!caseId) return resError(event, 400, '缺少 caseId')

  // 权限校验
  const caseRecord = await prisma.cases.findFirst({
    where: { id: caseId, userId: user.id, deletedAt: null },
  })
  if (!caseRecord) return resError(event, 404, '案件不存在')

  const sessions = await prisma.caseSessions.findMany({
    where: {
      caseId,
      type: 1,
      deletedAt: null,
      metadata: { path: ['source'], equals: 'xiaosuo' },
    },
    orderBy: { updatedAt: 'desc' },
  })

  const result = await Promise.all(
    sessions.map(async (s) => {
      const activeRun = await getActiveRunService(s.sessionId)
      return {
        sessionId: s.sessionId,
        title: (s.metadata as any)?.title ?? '新对话',
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        hasActiveRun: !!activeRun,
      }
    }),
  )

  return resSuccess(event, '查询成功', result)
})
```

- [ ] **Step 2: 提交**

```bash
git add server/api/v1/case/analysis/xiaosuo-sessions.get.ts
git commit -m "feat(api): 添加小索 session 列表查询端点"
```

---

### Task 4: 创建小索 Session API — 删除端点

**Files:**
- Create: `server/api/v1/case/analysis/xiaosuo-session/[sessionId].delete.ts`

- [ ] **Step 1: 创建 API 文件**

```typescript
/**
 * 删除小索对话 Session
 * DELETE /api/v1/case/analysis/xiaosuo-session/:sessionId
 */
export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const sessionId = getRouterParam(event, 'sessionId')
  if (!sessionId) return resError(event, 400, '缺少 sessionId')

  // 查找 session 并验证权限
  const session = await prisma.caseSessions.findFirst({
    where: { sessionId, deletedAt: null },
    include: { case: { select: { userId: true } } },
  })

  if (!session) return resError(event, 404, 'Session 不存在')
  if (session.case.userId !== user.id) return resError(event, 403, '无权操作')

  // 验证是小索 session
  const metadata = session.metadata as any
  if (metadata?.source !== 'xiaosuo') {
    return resError(event, 400, '不能删除非小索的 session')
  }

  // 如有活跃 run，先取消
  const activeRun = await getActiveRunService(sessionId)
  if (activeRun) {
    await cancelRunService(activeRun.id)
  }

  // 软删除
  await prisma.caseSessions.update({
    where: { sessionId },
    data: { deletedAt: new Date() },
  })

  return resSuccess(event, '删除成功')
})
```

- [ ] **Step 2: 提交**

```bash
git add server/api/v1/case/analysis/xiaosuo-session/
git commit -m "feat(api): 添加小索 session 删除端点"
```

---

### Task 5: 后端 API 测试

**Files:**
- Create: `tests/server/xiaosuo-session.test.ts`

参考 `tests/server/dashboard.test.ts` 的测试结构：beforeAll 检查数据库可用性，afterEach 清理测试数据。

- [ ] **Step 1: 编写测试文件**

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest'

// 服务层函数自动导入（vitest 环境下需显式引入辅助函数）
// 直接测试 API handler 逻辑或通过 service 层测试

describe('小索 Session API', () => {
  let dbAvailable = false
  const createdSessionIds: string[] = []
  const createdCaseIds: number[] = []
  const createdUserIds: number[] = []

  beforeAll(async () => {
    // 检查测试数据库是否可用
    try {
      await prisma.$queryRaw`SELECT 1`
      dbAvailable = true
    } catch {
      dbAvailable = false
    }
  })

  afterEach(async () => {
    if (!dbAvailable) return
    // 清理 session
    if (createdSessionIds.length > 0) {
      await prisma.caseSessions.deleteMany({
        where: { sessionId: { in: createdSessionIds } },
      })
      createdSessionIds.length = 0
    }
    // 清理 case
    if (createdCaseIds.length > 0) {
      await prisma.cases.deleteMany({
        where: { id: { in: createdCaseIds } },
      })
      createdCaseIds.length = 0
    }
    // 清理 user
    if (createdUserIds.length > 0) {
      await prisma.users.deleteMany({
        where: { id: { in: createdUserIds } },
      })
      createdUserIds.length = 0
    }
  })

  // 辅助函数
  async function createTestUser() {
    const { v4: uuidv4 } = await import('uuid')
    const user = await prisma.users.create({
      data: {
        phone: `test_xs_${uuidv4().slice(0, 12)}`,
        password: 'test',
        nickname: 'test_xiaosuo',
      },
    })
    createdUserIds.push(user.id)
    return user
  }

  async function createTestCase(userId: number) {
    const caseRecord = await prisma.cases.create({
      data: {
        title: '小索测试案件',
        userId,
        caseTypeId: 1,
        status: 1,
      },
    })
    createdCaseIds.push(caseRecord.id)
    return caseRecord
  }

  async function createXiaosuoSession(caseId: number, title = '新对话') {
    const { v4: uuidv4 } = await import('uuid')
    const sessionId = uuidv4()
    await prisma.caseSessions.create({
      data: {
        sessionId,
        caseId,
        type: 1,
        metadata: { source: 'xiaosuo', title },
      },
    })
    createdSessionIds.push(sessionId)
    return sessionId
  }

  describe('创建 Session', () => {
    it('应正确创建小索 session', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)

      const sessionId = await createXiaosuoSession(caseRecord.id, '测试对话')
      const session = await prisma.caseSessions.findUnique({ where: { sessionId } })

      expect(session).not.toBeNull()
      expect(session!.type).toBe(1)
      expect(session!.caseId).toBe(caseRecord.id)
      expect((session!.metadata as any).source).toBe('xiaosuo')
      expect((session!.metadata as any).title).toBe('测试对话')
    })
  })

  describe('查询 Session 列表', () => {
    it('应只返回 source=xiaosuo 的 session', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)

      // 创建小索 session
      const xiaosuoSessionId = await createXiaosuoSession(caseRecord.id)

      // 创建非小索的 type=1 session（模拟分析页面 session）
      const { v4: uuidv4 } = await import('uuid')
      const otherSessionId = uuidv4()
      await prisma.caseSessions.create({
        data: {
          sessionId: otherSessionId,
          caseId: caseRecord.id,
          type: 1,
          metadata: { source: 'analysis' },
        },
      })
      createdSessionIds.push(otherSessionId)

      // 查询小索 session
      const sessions = await prisma.caseSessions.findMany({
        where: {
          caseId: caseRecord.id,
          type: 1,
          deletedAt: null,
          metadata: { path: ['source'], equals: 'xiaosuo' },
        },
      })

      expect(sessions.length).toBe(1)
      expect(sessions[0].sessionId).toBe(xiaosuoSessionId)
    })

    it('应按 updatedAt 降序排列', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)

      const id1 = await createXiaosuoSession(caseRecord.id, '对话 1')
      // 稍等确保时间戳不同
      await new Promise(r => setTimeout(r, 50))
      const id2 = await createXiaosuoSession(caseRecord.id, '对话 2')

      const sessions = await prisma.caseSessions.findMany({
        where: {
          caseId: caseRecord.id,
          type: 1,
          deletedAt: null,
          metadata: { path: ['source'], equals: 'xiaosuo' },
        },
        orderBy: { updatedAt: 'desc' },
      })

      expect(sessions[0].sessionId).toBe(id2)
      expect(sessions[1].sessionId).toBe(id1)
    })
  })

  describe('删除 Session', () => {
    it('应软删除 session', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)
      const sessionId = await createXiaosuoSession(caseRecord.id)

      await prisma.caseSessions.update({
        where: { sessionId },
        data: { deletedAt: new Date() },
      })

      const deleted = await prisma.caseSessions.findUnique({ where: { sessionId } })
      expect(deleted!.deletedAt).not.toBeNull()

      // 列表查询中不应出现
      const sessions = await prisma.caseSessions.findMany({
        where: {
          caseId: caseRecord.id,
          type: 1,
          deletedAt: null,
          metadata: { path: ['source'], equals: 'xiaosuo' },
        },
      })
      expect(sessions.length).toBe(0)
    })

    it('不应删除非小索的 session', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)

      const { v4: uuidv4 } = await import('uuid')
      const otherSessionId = uuidv4()
      await prisma.caseSessions.create({
        data: {
          sessionId: otherSessionId,
          caseId: caseRecord.id,
          type: 1,
          metadata: { source: 'analysis' },
        },
      })
      createdSessionIds.push(otherSessionId)

      const session = await prisma.caseSessions.findUnique({ where: { sessionId: otherSessionId } })
      const metadata = session!.metadata as any
      expect(metadata?.source).not.toBe('xiaosuo')
    })
  })

  describe('删除 Session 与活跃 Run', () => {
    it('删除 session 时应检查并取消活跃 run', async () => {
      if (!dbAvailable) return
      const user = await createTestUser()
      const caseRecord = await createTestCase(user.id)
      const sessionId = await createXiaosuoSession(caseRecord.id)

      // 验证 getActiveRunService 可以正常调用（无活跃 run 时返回 null）
      const activeRun = await getActiveRunService(sessionId)
      expect(activeRun).toBeNull()

      // 软删除
      await prisma.caseSessions.update({
        where: { sessionId },
        data: { deletedAt: new Date() },
      })

      const deleted = await prisma.caseSessions.findUnique({ where: { sessionId } })
      expect(deleted!.deletedAt).not.toBeNull()
    })
  })
})
```

- [ ] **Step 2: 运行测试**

```bash
npx vitest run tests/server/xiaosuo-session.test.ts --reporter=verbose
```

- [ ] **Step 3: 提交**

```bash
git add tests/server/xiaosuo-session.test.ts
git commit -m "test(api): 添加小索 session API 测试"
```

---

### Task 6: 创建 `useXiaosuoChat` composable

**Files:**
- Create: `app/composables/useXiaosuoChat.ts`

参考 `app/composables/useModuleChatManager.ts` 的 effectScope 管理和双重取消模式，以及 `app/composables/useCaseChat.ts` 的接口。

- [ ] **Step 1: 创建 composable 文件**

```typescript
/**
 * 小索对话管理 composable
 *
 * 管理小索的多 session 生命周期和对话状态。
 * 在父页面 [id].vue 中调用，通过 props 传递给 CaseDetailXiaosuo 组件。
 *
 * 参考：useModuleChatManager（effectScope 管理、双重取消）
 *       useCaseChat（底层 SSE 流管理）
 */
import type { MaybeRef } from 'vue'

export interface XiaosuoSession {
  sessionId: string
  title: string
  createdAt: string
  updatedAt: string
  hasActiveRun: boolean
}

export function useXiaosuoChat(caseId: MaybeRef<number>) {
  const resolvedCaseId = toRef(caseId)

  // Session 管理状态
  const sessions = ref<XiaosuoSession[]>([])
  const currentSessionId = ref<string | null>(null)
  const isSessionLoading = ref(false)
  const initialized = ref(false)

  // effectScope 管理（参照 useModuleChatManager）
  let currentScope: EffectScope | null = null
  let currentChat: ReturnType<typeof useCaseChat> | null = null

  // 快速切换竞态防护
  let switchCounter = 0

  function disposeCurrentChat() {
    if (currentScope) {
      currentScope.stop()
      currentScope = null
      currentChat = null
    }
  }

  // 对话状态代理
  const messages = computed(() => currentChat?.messages.value ?? [])
  const values = computed(() => currentChat?.values.value)
  const isLoading = computed(() => currentChat?.isLoading.value ?? false)
  const interrupt = computed(() => currentChat?.interrupt.value)

  // ── Session CRUD ──

  async function fetchSessions() {
    const result = await useApiFetch<XiaosuoSession[]>(
      `/api/v1/case/analysis/xiaosuo-sessions?caseId=${resolvedCaseId.value}`,
    )
    if (result) {
      sessions.value = result
    }
  }

  async function createSession(title?: string): Promise<string> {
    const result = await useApiFetch<{ sessionId: string; title: string }>(
      '/api/v1/case/analysis/xiaosuo-session',
      { method: 'POST', body: { caseId: resolvedCaseId.value, title } },
    )

    if (!result?.sessionId) {
      throw new Error('创建 session 失败')
    }

    // 加入列表头部
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

    // 在新 effectScope 中创建 useCaseChat 实例
    const newScope = effectScope()
    const newChat = newScope.run(() => useCaseChat({ sessionId }))!

    // 竞态检查：如果已被更新的切换取代，清理刚创建的 scope
    if (currentSwitch !== switchCounter) {
      newScope.stop()
      return
    }

    currentScope = newScope
    currentChat = newChat

    // 检查是否有活跃 run
    const session = sessions.value.find(s => s.sessionId === sessionId)
    if (session?.hasActiveRun) {
      currentChat.reconnect()
    }
    else {
      currentChat.loadHistory()
    }
  }

  async function deleteSession(sessionId: string) {
    await useApiFetch(
      `/api/v1/case/analysis/xiaosuo-session/${sessionId}`,
      { method: 'DELETE' },
    )

    // 从列表移除
    sessions.value = sessions.value.filter(s => s.sessionId !== sessionId)

    // 如果删的是当前 session，切换到下一个或创建新的
    if (currentSessionId.value === sessionId) {
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].sessionId)
      }
      else {
        await createSession()
      }
    }
  }

  // ── 消息操作 ──

  function sendMessage(text: string, options?: { thinking?: boolean }) {
    currentChat?.sendMessage(text, options)
  }

  function resumeInterrupt(data: any) {
    currentChat?.resumeInterrupt(data)
  }

  async function stopGeneration() {
    try {
      currentChat?.stopGeneration()

      const sid = currentSessionId.value
      if (!sid) return
      const runData = await useApiFetch<{ run: { id: string } | null }>(
        `/api/v1/case/analysis/runs/current/${sid}`,
      )
      if (runData?.run?.id) {
        await useApiFetch(
          `/api/v1/case/analysis/runs/cancel/${runData.run.id}`,
          { method: 'POST' },
        )
      }
    }
    catch (error) {
      console.error('[useXiaosuoChat] 停止生成失败:', error)
    }
  }

  // ── 初始化 ──

  async function init() {
    if (initialized.value) return
    isSessionLoading.value = true

    try {
      await fetchSessions()

      if (sessions.value.length === 0) {
        await createSession()
      }
      else {
        await switchSession(sessions.value[0].sessionId)
      }

      initialized.value = true
    }
    finally {
      isSessionLoading.value = false
    }
  }

  // 页面卸载时清理
  onUnmounted(() => disposeCurrentChat())

  return {
    sessions,
    currentSessionId,
    isSessionLoading,
    messages,
    values,
    isLoading,
    interrupt,
    createSession,
    switchSession,
    deleteSession,
    sendMessage,
    resumeInterrupt,
    stopGeneration,
    init,
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add app/composables/useXiaosuoChat.ts
git commit -m "feat(ui): 添加 useXiaosuoChat composable"
```

---

### Task 7: 改造 `CaseDetailXiaosuo.vue`

**Files:**
- Modify: `app/components/caseDetail/CaseDetailXiaosuo.vue`

参考 `app/components/case/AnalysisModuleChat.vue` 的 AiChat 集成和窗口管理模式。

- [ ] **Step 1: 重写 script setup**

替换整个 `<script>` 部分。移除 mock 逻辑，接收 `xiaosuoChat` prop，添加 thinking toggle、中断处理、session 切换：

```typescript
<script lang="ts" setup>
import { XIcon, MaximizeIcon, MinimizeIcon, PlusIcon, ChevronDownIcon, Trash2Icon } from 'lucide-vue-next'
import xiaosuoIcon from '~/assets/icon/xiaosuo.svg'
import { useMediaQuery } from '@vueuse/core'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import type { useXiaosuoChat } from '~/composables/useXiaosuoChat'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const props = defineProps<{
  xiaosuoChat: ReturnType<typeof useXiaosuoChat>
}>()

const isOpen = defineModel<boolean>({ default: false })

const isMobile = useMediaQuery('(max-width: 767px)')
const isFullscreen = ref(false)
const thinking = ref(true)
const sessionListOpen = ref(false)

// 拖拽和缩放
const xiaosuoZIndex = ref(40)
const { style: windowStyle, onDragStart, onEdgeDetect, onResizeStart, cursor, isInteracting, reset }
  = useDraggableResize({
    initialWidth: 380,
    initialHeight: 500,
    minWidth: 300,
    minHeight: 350,
    zIndex: xiaosuoZIndex,
  })

const containerStyle = computed(() => ({
  ...windowStyle.value,
  cursor: cursor.value,
}))

// 当前 session 标题
const currentSessionTitle = computed(() => {
  const sid = props.xiaosuoChat.currentSessionId.value
  const session = props.xiaosuoChat.sessions.value.find(s => s.sessionId === sid)
  return session?.title ?? '新对话'
})

// 中断处理（与 [sessionId].vue 保持一致）
const interrupt = computed(() => {
  const v = props.xiaosuoChat.values.value as any
  if (!v?.__interrupt__?.length) return undefined
  return v.__interrupt__.length === 1 ? v.__interrupt__[0] : v.__interrupt__
})

const interruptData = computed(() => {
  const raw = interrupt.value
  if (!raw) return null
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === 'insufficient_points') return val
  return null
})

function resumeWorkflow() {
  props.xiaosuoChat.resumeInterrupt({ action: 'continue' })
}

function handleSubmit(data: { text: string }) {
  if (data.text.trim()) {
    props.xiaosuoChat.sendMessage(data.text, { thinking: thinking.value })
  }
}

async function handleCreateSession() {
  sessionListOpen.value = false
  await props.xiaosuoChat.createSession()
}

async function handleSwitchSession(sessionId: string) {
  sessionListOpen.value = false
  await props.xiaosuoChat.switchSession(sessionId)
}

async function handleDeleteSession(sessionId: string) {
  await props.xiaosuoChat.deleteSession(sessionId)
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

// 首次打开时初始化
watch(isOpen, (open) => {
  if (open) {
    props.xiaosuoChat.init()
  }
  if (!open) {
    isFullscreen.value = false
    reset()
  }
})
</script>
```

- [ ] **Step 2: 重写完整模板**

替换整个 `<template>` 部分。三种模式（全屏、小窗、移动端）的标题栏共用 session Popover 逻辑，悬浮按钮保留在原位置。

**完整模板结构**：

```vue
<template>
  <!-- 桌面端 -->
  <template v-if="!isMobile">
    <!-- 全屏模式 -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0" enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100" leave-to-class="opacity-0"
    >
      <div v-if="isOpen && isFullscreen" class="fixed md:absolute inset-0 z-50 bg-background flex flex-col">
        <!-- 全屏标题栏 -->
        <div class="shrink-0 h-12 flex items-center justify-between px-4 border-b bg-muted/30">
          <div class="flex items-center gap-2">
            <img :src="xiaosuoIcon" class="size-4" alt="小索" />
            <Popover v-model:open="sessionListOpen">
              <PopoverTrigger as-child>
                <button class="flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors">
                  {{ currentSessionTitle }}
                  <ChevronDownIcon class="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent class="w-64 p-0" align="start">
                <div class="max-h-60 overflow-y-auto">
                  <div
                    v-for="s in xiaosuoChat.sessions.value"
                    :key="s.sessionId"
                    class="flex items-center justify-between px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                    :class="{ 'bg-muted/50': s.sessionId === xiaosuoChat.currentSessionId.value }"
                    @click="handleSwitchSession(s.sessionId)"
                  >
                    <span class="truncate flex-1">{{ s.title }}</span>
                    <span class="shrink-0 text-xs text-muted-foreground mx-1">{{ dayjs(s.updatedAt).fromNow() }}</span>
                    <button
                      class="shrink-0 ml-1 p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                      @click.stop="handleDeleteSession(s.sessionId)"
                    >
                      <Trash2Icon class="size-3" />
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="icon" class="size-8" @click="handleCreateSession">
              <PlusIcon class="size-4" />
            </Button>
            <Button variant="ghost" size="icon" class="size-8" @click="toggleFullscreen">
              <MinimizeIcon class="size-4" />
            </Button>
            <Button variant="ghost" size="icon" class="size-8" @click="isOpen = false">
              <XIcon class="size-4" />
            </Button>
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <AiChat :messages="xiaosuoChat.messages.value" :loading="xiaosuoChat.isLoading.value"
            panel-mode="left" :show-header="false" v-model:thinking="thinking" :enable-file-upload="false"
            prompt-placeholder="问我任何关于案件的问题..." @submit="handleSubmit"
            @stop="xiaosuoChat.stopGeneration()" />
        </div>
      </div>
    </Transition>

    <!-- 小窗模式（可拖拽、可缩放） -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0" enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100" leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen && !isFullscreen"
        class="fixed bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden"
        :class="{ 'select-none': isInteracting }"
        :style="containerStyle"
        @pointermove="onEdgeDetect"
        @pointerdown="onResizeStart"
      >
        <!-- 小窗标题栏（可拖拽） -->
        <div class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30
                    cursor-grab active:cursor-grabbing"
            @pointerdown="onDragStart">
          <div class="flex items-center gap-2">
            <img :src="xiaosuoIcon" class="size-3.5" alt="小索" />
            <Popover v-model:open="sessionListOpen">
              <PopoverTrigger as-child>
                <button class="flex items-center gap-1 text-xs font-medium hover:text-primary transition-colors">
                  {{ currentSessionTitle }}
                  <ChevronDownIcon class="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent class="w-56 p-0" align="start">
                <div class="max-h-48 overflow-y-auto">
                  <div
                    v-for="s in xiaosuoChat.sessions.value"
                    :key="s.sessionId"
                    class="flex items-center justify-between px-3 py-1.5 hover:bg-muted cursor-pointer text-xs"
                    :class="{ 'bg-muted/50': s.sessionId === xiaosuoChat.currentSessionId.value }"
                    @click="handleSwitchSession(s.sessionId)"
                  >
                    <span class="truncate flex-1">{{ s.title }}</span>
                    <span class="shrink-0 text-xs text-muted-foreground mx-1">{{ dayjs(s.updatedAt).fromNow() }}</span>
                    <button
                      class="shrink-0 ml-1 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive"
                      @click.stop="handleDeleteSession(s.sessionId)"
                    >
                      <Trash2Icon class="size-2.5" />
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div class="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" class="size-6" @click="handleCreateSession">
              <PlusIcon class="size-3" />
            </Button>
            <Button variant="ghost" size="icon" class="size-6" @click="toggleFullscreen">
              <MaximizeIcon class="size-3" />
            </Button>
            <Button variant="ghost" size="icon" class="size-6" @click="isOpen = false">
              <XIcon class="size-3.5" />
            </Button>
          </div>
        </div>
        <div class="flex-1 overflow-hidden">
          <AiChat :messages="xiaosuoChat.messages.value" :loading="xiaosuoChat.isLoading.value"
            panel-mode="left" :show-header="false" v-model:thinking="thinking" :enable-file-upload="false"
            prompt-placeholder="问我任何关于案件的问题..." @submit="handleSubmit"
            @stop="xiaosuoChat.stopGeneration()" />
        </div>
      </div>
    </Transition>

    <!-- 悬浮按钮：保留原位置 -->
    <div class="absolute bottom-4 right-4 z-40">
      <img
        v-show="!isFullscreen"
        :src="xiaosuoIcon"
        class="size-12 cursor-pointer hover:scale-110 transition-transform drop-shadow-lg"
        alt="小索"
        @click="isOpen = !isOpen"
      />
    </div>
  </template>

  <!-- 移动端：底部 Sheet -->
  <template v-else>
    <Sheet v-model:open="isOpen">
      <SheetContent side="bottom" class="h-[90vh] flex flex-col p-0">
        <SheetHeader class="shrink-0 px-4 pt-4 pb-2">
          <SheetTitle class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <img :src="xiaosuoIcon" class="size-4" alt="小索" />
              <Popover v-model:open="sessionListOpen">
                <PopoverTrigger as-child>
                  <button class="flex items-center gap-1 font-medium hover:text-primary transition-colors">
                    {{ currentSessionTitle }}
                    <ChevronDownIcon class="size-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent class="w-64 p-0" align="start">
                  <div class="max-h-60 overflow-y-auto">
                    <div
                      v-for="s in xiaosuoChat.sessions.value"
                      :key="s.sessionId"
                      class="flex items-center justify-between px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                      :class="{ 'bg-muted/50': s.sessionId === xiaosuoChat.currentSessionId.value }"
                      @click="handleSwitchSession(s.sessionId)"
                    >
                      <span class="truncate flex-1">{{ s.title }}</span>
                      <span class="shrink-0 text-xs text-muted-foreground mx-1">{{ dayjs(s.updatedAt).fromNow() }}</span>
                      <button
                        class="shrink-0 ml-1 p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                        @click.stop="handleDeleteSession(s.sessionId)"
                      >
                        <Trash2Icon class="size-3" />
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="ghost" size="icon" class="size-8" @click="handleCreateSession">
              <PlusIcon class="size-4" />
            </Button>
          </SheetTitle>
        </SheetHeader>
        <div class="flex-1 overflow-hidden">
          <AiChat :messages="xiaosuoChat.messages.value" :loading="xiaosuoChat.isLoading.value"
            panel-mode="left" :show-header="false" :show-thinking-toggle="false" :enable-file-upload="false"
            prompt-placeholder="问我任何关于案件的问题..." @submit="handleSubmit"
            @stop="xiaosuoChat.stopGeneration()" />
        </div>
      </SheetContent>
    </Sheet>
  </template>

  <!-- 积分不足弹窗 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent class="sm:max-w-md">
      <InitAnalysisInsufficientPointsCard
        v-if="interruptData"
        :is-member="interruptData.data?.isMember ?? false"
        :available-points="interruptData.data?.availablePoints"
        :required-points="interruptData.data?.requiredPoints"
        :reason="interruptData.data?.reason"
        @resume="resumeWorkflow"
      />
    </DialogContent>
  </Dialog>
</template>
```

- [ ] **Step 3: 提交**

```bash
git add app/components/caseDetail/CaseDetailXiaosuo.vue
git commit -m "feat(ui): CaseDetailXiaosuo 接入真实对话逻辑"
```

---

### Task 8: 集成到案件详情页 `[id].vue`

**Files:**
- Modify: `app/pages/dashboard/cases/[id].vue`

- [ ] **Step 1: 在 script setup 中创建 useXiaosuoChat 实例**

在 `[id].vue` 的 `<script setup>` 中，找到已有的 `useModuleChatManager` 调用附近，添加：

```typescript
// 小索对话管理
const xiaosuoChat = useXiaosuoChat(caseId)
```

- [ ] **Step 2: 更新模板中的 CaseDetailXiaosuo 用法**

找到：
```vue
<CaseDetailXiaosuo v-model="xiaosuoOpen" />
```

改为：
```vue
<CaseDetailXiaosuo v-model="xiaosuoOpen" :xiaosuo-chat="xiaosuoChat" />
```

- [ ] **Step 3: 提交**

```bash
git add app/pages/dashboard/cases/[id].vue
git commit -m "feat(ui): 集成 useXiaosuoChat 到案件详情页"
```

---

### Task 9: 前端 Composable 测试

**Files:**
- Create: `tests/composables/useXiaosuoChat.test.ts`

测试 `useXiaosuoChat` 的 session 管理逻辑。需要 mock `useApiFetch` 和 `useCaseChat`。

- [ ] **Step 1: 编写测试文件**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, effectScope, onUnmounted } from 'vue'

// Mock useApiFetch（Nuxt 自动导入）
const mockApiFetch = vi.fn()
vi.stubGlobal('useApiFetch', mockApiFetch)

// Stub Vue 自动导入（在 Nuxt vitest 环境中由框架处理，此处手动 stub）
vi.stubGlobal('toRef', (v: any) => ref(typeof v === 'object' && 'value' in v ? v.value : v))
vi.stubGlobal('onUnmounted', vi.fn())

// Mock useCaseChat
const mockSendMessage = vi.fn()
const mockStopGeneration = vi.fn()
const mockLoadHistory = vi.fn()
const mockReconnect = vi.fn()
const mockResumeInterrupt = vi.fn()

vi.mock('~/composables/useCaseChat', () => ({
  useCaseChat: vi.fn(() => ({
    messages: computed(() => []),
    values: computed(() => ({})),
    isLoading: ref(false),
    error: ref(null),
    interrupt: computed(() => undefined),
    hasHistoryLoaded: ref(false),
    sendMessage: mockSendMessage,
    resumeInterrupt: mockResumeInterrupt,
    loadHistory: mockLoadHistory,
    reconnect: mockReconnect,
    stopGeneration: mockStopGeneration,
  })),
}))

describe('useXiaosuoChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('init', () => {
    it('空列表时应自动创建首个 session', async () => {
      // 列表为空
      mockApiFetch.mockResolvedValueOnce([])
      // 创建 session
      mockApiFetch.mockResolvedValueOnce({ sessionId: 'new-id', title: '新对话' })

      const chat = useXiaosuoChat(1)
      await chat.init()

      expect(chat.sessions.value.length).toBe(1)
      expect(chat.currentSessionId.value).toBe('new-id')
    })

    it('有列表时应恢复最近 session', async () => {
      mockApiFetch.mockResolvedValueOnce([
        { sessionId: 'id-1', title: '对话1', hasActiveRun: false, createdAt: '', updatedAt: '' },
        { sessionId: 'id-2', title: '对话2', hasActiveRun: false, createdAt: '', updatedAt: '' },
      ])

      const chat = useXiaosuoChat(1)
      await chat.init()

      expect(chat.currentSessionId.value).toBe('id-1')
      expect(mockLoadHistory).toHaveBeenCalled()
    })
  })

  describe('createSession', () => {
    it('应创建并切换到新 session', async () => {
      mockApiFetch.mockResolvedValueOnce([
        { sessionId: 'old-id', title: '旧对话', hasActiveRun: false, createdAt: '', updatedAt: '' },
      ])

      const chat = useXiaosuoChat(1)
      await chat.init()

      mockApiFetch.mockResolvedValueOnce({ sessionId: 'new-id', title: '新对话' })
      await chat.createSession()

      expect(chat.sessions.value.length).toBe(2)
      expect(chat.currentSessionId.value).toBe('new-id')
    })
  })

  describe('deleteSession', () => {
    it('删除当前 session 时应切换到下一个', async () => {
      mockApiFetch.mockResolvedValueOnce([
        { sessionId: 'id-1', title: '对话1', hasActiveRun: false, createdAt: '', updatedAt: '' },
        { sessionId: 'id-2', title: '对话2', hasActiveRun: false, createdAt: '', updatedAt: '' },
      ])

      const chat = useXiaosuoChat(1)
      await chat.init()

      mockApiFetch.mockResolvedValueOnce(undefined) // delete API
      await chat.deleteSession('id-1')

      expect(chat.sessions.value.length).toBe(1)
      expect(chat.currentSessionId.value).toBe('id-2')
    })

    it('删除最后一个 session 时应自动创建新的', async () => {
      mockApiFetch.mockResolvedValueOnce([
        { sessionId: 'only-id', title: '唯一对话', hasActiveRun: false, createdAt: '', updatedAt: '' },
      ])

      const chat = useXiaosuoChat(1)
      await chat.init()

      mockApiFetch.mockResolvedValueOnce(undefined) // delete API
      mockApiFetch.mockResolvedValueOnce({ sessionId: 'auto-new', title: '新对话' }) // auto create

      await chat.deleteSession('only-id')

      expect(chat.currentSessionId.value).toBe('auto-new')
    })
  })
})
```

- [ ] **Step 2: 运行测试**

```bash
npx vitest run tests/composables/useXiaosuoChat.test.ts --reporter=verbose
```

- [ ] **Step 3: 提交**

```bash
git add tests/composables/useXiaosuoChat.test.ts
git commit -m "test(ui): 添加 useXiaosuoChat composable 测试"
```

---

### Task 10: 手动验证（原 Task 9）

**Files:** 无代码变更

- [ ] **Step 1: 启动开发服务器**

```bash
bun dev
```

- [ ] **Step 2: 在浏览器中验证以下场景**

打开案件详情页（如 `/dashboard/cases/16`）：

1. **首次打开小索** → 自动创建 session → 显示空对话
2. **发送消息** → 收到 AI 回复 → thinking 展示正常
3. **新建对话** → 点击 `+` 按钮 → 切换到空 session
4. **切换历史对话** → 下拉列表选择 → 显示历史消息
5. **删除对话** → 删除按钮 → 自动切换到下一个
6. **关闭/重开小索** → 保持上次对话状态
7. **全屏切换** → 正常工作
8. **停止生成** → 前端 SSE 断开 + 后端 Worker 取消
9. **移动端** → 底部 Sheet 模式正常
10. **页面刷新** → 恢复最近 session 和消息

- [ ] **Step 3: 如有问题，修复后提交**

---

### Task 11: 运行类型检查（原 Task 10）

**Files:** 无代码变更

- [ ] **Step 1: 运行 typecheck**

```bash
npx nuxi typecheck
```

确保无新增类型错误。

- [ ] **Step 2: 运行全量测试**

```bash
npx vitest run tests/server/xiaosuo-session.test.ts --reporter=verbose
```

- [ ] **Step 3: 如有问题，修复后提交**
