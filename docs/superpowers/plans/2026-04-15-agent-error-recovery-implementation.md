# Agent 错误恢复和 UI 容错实施清单

**Goal:** 解决两个核心问题——①工具卡住 UI 永久 loading；②Agent 失败无前端反馈。总代码改动约 100 行。

**Spec:** `docs/superpowers/specs/2026-04-15-agent-error-recovery-design.md`

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript + @langchain/vue + vue-sonner

**不在本次范围**（明确边界）：
- 自动重连 / 心跳检测 / 自动重试
- `connectionStatus` 派生和"重新连接"按钮（Phase 2，目前无实际需求）
- 扩展 `FetchStreamTransport`
- 页面刷新状态恢复（已由 `useChatSessionManager.ts:121-126` + `useInitAnalysis.loadStatus` 现有机制覆盖）

---

## 前置

- [ ] **确认设计文档已审核通过**：`docs/superpowers/specs/2026-04-15-agent-error-recovery-design.md`
- [ ] **创建工作分支**：`git checkout -b feat/agent-error-recovery`
- [ ] **记录测试基线**：`bun run test` 记录当前通过/失败数

---

## 改动 1：工具超时兜底

### 1.1 `workspace.ts` 新增 `withTimeout` 通用函数

**File:** `server/services/workflow/tools/workspace.ts`

在文件末尾添加：

```typescript
/**
 * Promise 级兜底超时包装器
 *
 * 防止 execFile 等异步调用在极端情况下 callback 不触发导致 Promise 永远 pending。
 * 超时后立即 reject，让 agent 收到错误字符串继续推进。
 */
export function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`${label} 执行超时（${ms / 1000}s）`)),
            ms,
        )
        promise
            .then(resolve, reject)
            .finally(() => clearTimeout(timer))
    })
}
```

### 1.2 `runSkillScript.tool.ts` 用 `withTimeout` 包裹 execFile

**File:** `server/services/workflow/tools/runSkillScript.tool.ts`

修改 import：

```typescript
import { WORKSPACE_BASE, resolveWorkspaceDir, withTimeout } from './workspace'
```

修改 tool handler 的 return 语句（约 122-138 行）：

```typescript
try {
    return await withTimeout(
        new Promise<string>((done) => {
            execFile(runtimeBin, execArgs, { timeout: 30_000, cwd: scriptsDir, env: execEnv },
                (err, stdout, stderr) => {
                    // ...（原有错误处理逻辑完全保留，不变）
                })
        }),
        35_000, // 比 execFile 内置超时多 5s
        `脚本 ${scriptName}`,
    )
} catch (timeoutErr: any) {
    // 保持工具层"永远返回字符串"的约定
    return `Error: ${timeoutErr?.message ?? '执行超时'}`
}
```

### 1.3 单元测试（TDD）

**File:** `tests/server/workflow/tools/workspace.test.ts`（新建）

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout } from '../../../../server/services/workflow/tools/workspace'

describe('withTimeout 通用兜底超时', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('Promise 正常 resolve 应返回值', async () => {
    const p = new Promise<string>((resolve) => { setTimeout(() => resolve('ok'), 100) })
    const wrapped = withTimeout(p, 1000, '测试')
    await vi.advanceTimersByTimeAsync(100)
    await expect(wrapped).resolves.toBe('ok')
  })

  it('Promise 超过 ms 未完成应抛带 label 的超时错误', async () => {
    const never = new Promise<string>(() => {})
    const wrapped = withTimeout(never, 35_000, '脚本 test.cjs')
    await vi.advanceTimersByTimeAsync(35_001)
    await expect(wrapped).rejects.toThrow('脚本 test.cjs 执行超时（35s）')
  })
})
```

### 提交

```bash
bun run test tests/server/workflow/tools/workspace.test.ts
npx nuxi typecheck
git add server/services/workflow/tools/workspace.ts \
        server/services/workflow/tools/runSkillScript.tool.ts \
        tests/server/workflow/tools/workspace.test.ts
git commit -m "feat(tools): withTimeout 兜底超时防止工具卡住"
```

---

## 改动 2：接口扩展 + worker 传递错误信息

### 2.1 `AgentStatusEvent` 接口新增 `error` 字段

**File:** `shared/types/agentRun.ts`

```typescript
export interface AgentStatusEvent {
  type: 'status_change'
  runId: string
  sessionId: string
  status: AgentRunStatus
  error?: string  // 新增：仅 FAILED 时有值
}
```

### 2.2 `agentWorker.ts` 发布 FAILED 时传入 errorMessage

**File:** `server/services/agent/agentWorker.ts`（约 314-319 行）

```typescript
await publishStatusChange({
  type: 'status_change',
  runId: run.id,
  sessionId: run.sessionId,
  status,
  error: isCancelled ? undefined : errorMessage, // 新增
}).catch(e => logger.error('发布状态变更失败:', e))
```

### 提交

```bash
npx nuxi typecheck
git add shared/types/agentRun.ts server/services/agent/agentWorker.ts
git commit -m "feat(agent): publishStatusChange 携带 errorMessage"
```

---

## 改动 3：SSE 事件通道（两个端点）

**背景**：`useStream` 的 StreamManager 只识别 `metadata / events / updates / custom / messages / values / error` 这几类事件。后端 `status_change` 现在以 `event: status` 发送 → 被静默丢弃。改为 `event: custom` 后，前端 `onCustomEvent` 可以接收。

### 3.1 `chat.post.ts`（xiaosuo / module 对话端点）

**File:** `server/api/v1/case/analysis/chat.post.ts`

- **第 318 行**（replay 分支 else 出口）：`event: status` → `event: custom`
- **第 333 行**（实时订阅 terminal 出口）：`event: status` → `event: custom`
- **第 314、354 行**两处注释更新为："custom 通道承载 AgentCustomEvent 和 AgentStatusEvent 两类事件，消费方按 `data.type` 区分"

### 3.2 `init-analysis.post.ts`（初始化分析端点）

**File:** `server/api/v1/case/init-analysis.post.ts`

- **第 361 行**（checkpoint 兜底分支）：`event: status` → `event: custom`
- **第 377 行**（replay lastMissed 出口）：`event: status` → `event: custom`
- **第 385 行**（实时订阅 terminal 出口）：`event: status` → `event: custom`

### 提交

```bash
grep -n "event: status" server/api/v1/case/  # 应返回零匹配
npx nuxi typecheck
git add server/api/v1/case/analysis/chat.post.ts \
        server/api/v1/case/init-analysis.post.ts
git commit -m "fix(sse): status_change 事件走 event: custom 通道"
```

---

## 改动 4：前端信号拦截 + UI 反馈

### 4.1 `useStreamChat.ts` 拦截 status_change 并暴露响应式状态

**File:** `app/composables/useStreamChat.ts`

**关键架构点**：
- `useCaseChat.ts` 使用 `return { ...stream }` 自动展开 → **无需改动**
- `useChatSessionManager.ts` 选择性代理 → **需手动新增代理**（见 4.2）
- `useInitAnalysis.ts` 选择性透传 → **需手动新增透传**（见 4.3）

```typescript
import type { AgentRunStatus } from '#shared/types/agentRun'

// 在 useStreamChat 函数体内，transport 创建后、useStream 调用前
const runStatus = ref<AgentRunStatus | 'idle'>('idle')
const runError = ref<string>('')

const streamOptions: UseStreamCustomOptions<T> = {
    transport: transport as any,
    threadId: options.threadId,
    messagesKey: options.messagesKey ?? 'messages',
    // 变更点：拦截 status_change，其他事件透传
    onCustomEvent: (data: any) => {
        if (data?.type === 'status_change') {
            runStatus.value = data.status
            if (data.status === 'failed') {
                runError.value = data.error || '执行失败'
            } else if (data.status === 'cancelled') {
                runError.value = ''  // 用户主动取消不弹 toast
            }
            return  // status_change 不透传
        }
        options.onCustomEvent?.(data)
    },
    initialValues: options.initialValues as T | undefined,
    onError: (error) => { console.error('[useStreamChat] 流错误:', error) },
}

// 在 return 对象中新增：
return {
    // ... 现有字段 ...
    runStatus,
    runError,
    // ... 其他现有字段 ...
}
```

### 4.2 `useChatSessionManager.ts` 新增 computed 代理

**File:** `app/composables/useChatSessionManager.ts`

参照现有 `messages` / `values` / `isLoading` 代理模式，在约 60-65 行后新增：

```typescript
const runStatus = computed(() => currentChat.value?.runStatus.value ?? 'idle')
const runError = computed(() => currentChat.value?.runError.value ?? '')
```

在 return 对象中暴露：

```typescript
return {
    // ... 现有字段 ...
    runStatus,
    runError,
    // ...
}
```

### 4.3 `useInitAnalysis.ts` 透传新字段

**File:** `app/composables/useInitAnalysis.ts`

在 return 对象中新增：

```typescript
return {
    // ... 现有字段 ...
    runStatus: stream.runStatus,
    runError: stream.runError,
    // ... 其他现有字段（startAnalysis / resumeWorkflow / retryModule 等保持不变）...
}
```

### 4.4 对话页面（xiaosuo / module）接入 toast + 重试按钮

**File:** `app/pages/dashboard/cases/[id].vue` 或承载对话 UI 的子组件

```vue
<script setup lang="ts">
import { toast } from 'vue-sonner'
import { RefreshCw as RefreshCwIcon } from 'lucide-vue-next'

const chat = useXiaosuoChat(props.caseId)
// useChatSessionManager 已代理 runStatus / runError（见 4.2）
const { messages, runStatus, runError, sendMessage } = chat

const showRetryButton = ref(false)

watch(runStatus, (status) => {
    if (status === 'failed') {
        toast.error(`执行失败：${runError.value}`)
        showRetryButton.value = true
    } else if (status === 'running') {
        showRetryButton.value = false
    }
    // cancelled / completed / interrupted 静默（interrupted 由现有 interruptData 覆盖）
})

function onRetry() {
    const lastUser = messages.value.findLast((m: any) => m._getType?.() === 'human')
    if (!lastUser) return
    showRetryButton.value = false
    const content = typeof lastUser.content === 'string' ? lastUser.content : ''
    if (content) sendMessage(content)
}
</script>

<template>
  <!-- 在现有消息列表下方 -->
  <div v-if="showRetryButton" class="flex items-center gap-2 px-4 py-2">
    <Button size="sm" variant="outline" @click="onRetry">
      <RefreshCwIcon class="w-4 h-4 mr-1" />
      重试
    </Button>
  </div>
</template>
```

### 4.5 初始化分析页接入 toast + 重新分析按钮

**File:** `app/pages/dashboard/cases/init-analysis/[sessionId].vue`

```vue
<script setup lang="ts">
import { toast } from 'vue-sonner'
import { AlertTriangle as AlertTriangleIcon } from 'lucide-vue-next'

const {
  phase, runStatus, runError,
  startAnalysis,  // 现有函数，useInitAnalysis.ts:425-445 已实现
  // ... 其他现有字段 ...
} = useInitAnalysis(sessionId)

const showGlobalRetry = ref(false)

watch(runStatus, (status) => {
    if (status === 'failed') {
        toast.error(`分析失败：${runError.value}`)
        // 仅 running 阶段显示恢复按钮；complete 理论不会 failed；select 阶段 stream 未启动
        if (phase.value === 'running') {
            showGlobalRetry.value = true
        }
    } else if (status === 'running') {
        showGlobalRetry.value = false
    }
    // interrupted 由现有 CaseInterruptHandler 处理
})

function onRestartAnalysis() {
    showGlobalRetry.value = false
    // 使用 startAnalysis 完整重启（不用 resumeWorkflow——那是 interrupt 恢复，不适用 FAILED）
    startAnalysis()
}
</script>

<template>
  <div v-if="showGlobalRetry" class="rounded-md bg-red-50 border border-red-200 p-3 flex items-center justify-between">
    <div class="flex items-center gap-2 text-sm text-red-800">
      <AlertTriangleIcon class="w-4 h-4" />
      <span>分析中断：{{ runError }}</span>
    </div>
    <Button size="sm" variant="outline" @click="onRestartAnalysis">
      重新分析
    </Button>
  </div>
</template>
```

### 提交

```bash
npx nuxi typecheck
git add app/composables/useStreamChat.ts \
        app/composables/useChatSessionManager.ts \
        app/composables/useInitAnalysis.ts \
        app/pages/dashboard/cases/[id].vue \
        app/pages/dashboard/cases/init-analysis/[sessionId].vue
git commit -m "feat(ui): 接入 runStatus 显示失败 toast 和重试按钮"
```

---

## 手动验证（上线前必做）

启动 `bun dev` 后在浏览器中验证三个核心场景。**使用 Chrome DevTools 观察 Vue 响应式状态和网络面板**。

### 验证 1：工具卡住 → 35s 兜底

1. 临时在 `.deepagents/skills/lexseek/scripts/` 下创建 `stuck.sh`：`#!/bin/bash\nsleep 40`
2. 在对话中让 agent 调用这个脚本
3. **预期**：30-40s 内看到 toast + 重试按钮（execFile 内置 30s 触发返回错误，或 `withTimeout` 35s 兜底）
4. 点击重试 → agent 重新执行 → 成功
5. 清理：`rm .deepagents/skills/lexseek/scripts/stuck.sh`

### 验证 2：手动取消 → 静默

1. 发送一条长对话消息
2. 在 isLoading 期间点击"停止"
3. **预期**：
   - 不弹 toast
   - 不显示重试按钮
   - Vue DevTools 中 `runStatus` 为 `'cancelled'`

### 验证 3：刷新恢复 → 现有机制

1. 发送对话消息，在 agent 执行中刷新浏览器
2. **预期**：`useChatSessionManager` 根据 `hasActiveRun` 自动 reconnect，流式输出继续
3. 对初始化分析页同样验证（`useInitAnalysis.loadStatus` 自动处理）

---

## 完成检查表

- [ ] Task 1 测试通过：`bun run test tests/server/workflow/tools/workspace.test.ts`
- [ ] `bun run test` 无新增失败
- [ ] `npx nuxi typecheck` 无类型错误
- [ ] `grep -n "event: status" server/api/v1/case/` 零匹配
- [ ] 三个手动验证场景全部通过
- [ ] Vue DevTools 中能观察到 `runStatus` / `runError` 响应式变化
- [ ] `simplify` 技能优化本次改动

---

## 改动文件清单

**新增（1 个）**：
- `tests/server/workflow/tools/workspace.test.ts`

**修改（9 个）**：

后端：
- `server/services/workflow/tools/workspace.ts`
- `server/services/workflow/tools/runSkillScript.tool.ts`
- `shared/types/agentRun.ts`
- `server/services/agent/agentWorker.ts`
- `server/api/v1/case/analysis/chat.post.ts`
- `server/api/v1/case/init-analysis.post.ts`

前端：
- `app/composables/useStreamChat.ts`
- `app/composables/useChatSessionManager.ts`
- `app/composables/useInitAnalysis.ts`
- `app/pages/dashboard/cases/[id].vue`（或对话子组件）
- `app/pages/dashboard/cases/init-analysis/[sessionId].vue`

**不需要改动**（通过现有透传机制自动获得新字段）：
- `app/composables/useCaseChat.ts` —— `return { ...stream }` 自动展开
- `app/composables/useXiaosuoChat.ts` —— `useChatSessionManager` 薄包装
- `app/composables/useModuleChatManager.ts` —— 内部用 `useChatSessionManager`
- `app/composables/useCaseChat.ts`
