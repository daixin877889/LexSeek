# 任务进度 UX 优化实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化分析页面任务进度列表的视觉反馈和交互体验

**Architecture:** 扩展 QueueItemIndicator 组件支持三态（pending/in_progress/completed），在分析页面新增排序 computed 和自动滚动逻辑

**Tech Stack:** Vue 3, Tailwind CSS v4, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-24-task-progress-ux-design.md`

---

### Task 1: QueueItemIndicator 三态支持

**Files:**
- Modify: `app/components/ai-elements/queue/QueueItemIndicator.vue`

- [ ] **Step 1: 扩展 props 接口，新增 `status` prop**

新增 `status` optional prop，添加 `resolvedStatus` computed 处理向后兼容：

```vue
<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface QueueItemIndicatorProps {
  completed?: boolean
  status?: 'pending' | 'in_progress' | 'completed'
  class?: HTMLAttributes['class']
}

const props = withDefaults(
  defineProps<QueueItemIndicatorProps>(),
  {
    completed: false,
  },
)

const resolvedStatus = computed(() =>
  props.status ?? (props.completed ? 'completed' : 'pending')
)
</script>
```

- [ ] **Step 2: 更新模板，基于 resolvedStatus 切换样式**

```vue
<template>
  <span
    :class="
      cn(
        'mt-0.5 inline-block size-2.5 rounded-full border',
        resolvedStatus === 'in_progress'
          ? 'border-green-500 bg-green-500 animate-pulse'
          : resolvedStatus === 'completed'
            ? 'border-muted-foreground/20 bg-muted-foreground/10'
            : 'border-muted-foreground/50',
        props.class,
      )
    "
  />
</template>
```

- [ ] **Step 3: 提交**

```bash
git add app/components/ai-elements/queue/QueueItemIndicator.vue
git commit -m "feat(ui): QueueItemIndicator 支持三态样式（pending/in_progress/completed）"
```

---

### Task 2: 分析页面排序、滚动和模板更新

**Files:**
- Modify: `app/pages/dashboard/analysis/[sessionId].vue`

- [ ] **Step 1: 新增 `sortedTodos` computed**

在 `allTodos` 定义之后（约第 153 行后）添加：

```typescript
const statusOrder: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 }

const sortedTodos = computed(() =>
  [...allTodos].sort((a, b) =>
    (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1)
  )
)
```

- [ ] **Step 2: 新增自动滚动 watcher**

在现有的 `watch(() => allTodos.length, ...)` 之后添加：

```typescript
watch(allTodos, () => {
  nextTick(() => {
    const el = todoListRef.value
    if (el && el.scrollHeight > 0) {
      el.scrollTop = el.scrollHeight
    }
  })
}, { deep: true })
```

- [ ] **Step 3: 更新模板，使用 `sortedTodos` 渲染并传入 `status` prop**

将模板中第 91 行的 `v-for="todo in allTodos"` 改为 `v-for="todo in sortedTodos"`，
将 `QueueItemIndicator` 和 `QueueItemContent` 的 prop 更新：

```vue
<AiElementsQueueItem v-for="todo in sortedTodos" :key="todo.id">
  <AiElementsQueueItemContent :completed="todo.status === 'completed'">
    <AiElementsQueueItemIndicator :status="todo.status" />
    {{ todo.title }}
  </AiElementsQueueItemContent>
</AiElementsQueueItem>
```

- [ ] **Step 4: 提交**

```bash
git add app/pages/dashboard/analysis/[sessionId].vue
git commit -m "feat(analysis): 任务进度三段式排序、自动滚动和状态图标优化"
```

---

### Task 3: 验证

- [ ] **Step 1: 类型检查**

```bash
npx nuxi typecheck
```

Expected: 无类型错误

- [ ] **Step 2: 手动验证**

启动开发服务器 `bun dev`，进入分析页面触发 AI 分析，观察：
1. `in_progress` 任务显示绿色脉冲圆点
2. `completed` 任务排在底部，`in_progress` 排最前
3. 任务状态变化时列表自动滚动到底部
