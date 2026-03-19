# 分析进度 UI 优化设计

## 概述

优化 `/dashboard/analysis/[sessionId]` 页面的分析进度（todo 列表）区域，实现固定高度滚动和平滑显隐动画。

## 目标文件

`app/pages/dashboard/analysis/[sessionId].vue`

## 需求

1. **固定高度滚动**：todo 列表区域固定最大高度约 200px（可显示 5-6 条），超出后内部滚动
2. **条件显隐**：无 todo 时隐藏整个进度区域，有 todo 时显示并自动展开
3. **平滑动画**：显隐过程有平滑的滑入/滑出过渡效果

## 设计

### 1. 显隐控制

用 `<Transition>` 包裹 Collapsible，配合 `v-if="Todos.length > 0"` 控制渲染。`v-if` 会在 Todos 清空时销毁组件——这是有意为之，确保新一轮分析时组件从干净状态开始。

```vue
<Transition name="slide-up">
  <Collapsible v-if="Todos.length > 0" v-model:open="showTaskList" class="shrink-0 border-t">
    ...
  </Collapsible>
</Transition>
```

### 2. 自动展开

监听 Todos 长度变化（`Todos` 是 `reactive` 数组，`.length` 可被追踪），从 0 变为 >0 时自动展开：

```typescript
watch(() => Todos.length, (newLen, oldLen) => {
  if (oldLen === 0 && newLen > 0) {
    showTaskList.value = true
  }
})
```

**交互行为**：
- 首次出现 todo 时自动展开
- 用户手动折叠后，新 todo 追加不会再自动展开（尊重用户操作）
- 多轮对话时 Todos 被清空再填充，会再次触发自动展开

### 3. 固定高度滚动

列表容器添加最大高度和滚动，新 todo 追加时自动滚动到底部：

```vue
<div ref="todoListRef" class="px-4 pb-3 max-h-[200px] overflow-y-auto">
```

自动滚动逻辑：

```typescript
const todoListRef = ref<HTMLElement | null>(null)

watch(() => Todos.length, () => {
  nextTick(() => {
    if (todoListRef.value) {
      todoListRef.value.scrollTop = todoListRef.value.scrollHeight
    }
  })
})
```

### 4. CSS 动画

使用 Vue `<Transition>` 的 JS hooks 动态获取实际高度，避免 `max-height` 硬编码导致的动画时序问题：

```typescript
function onEnter(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.overflow = 'hidden'
  htmlEl.style.height = '0'
  htmlEl.style.opacity = '0'
  // 强制 reflow
  void htmlEl.offsetHeight
  htmlEl.style.transition = 'height 0.3s ease, opacity 0.3s ease'
  htmlEl.style.height = htmlEl.scrollHeight + 'px'
  htmlEl.style.opacity = '1'
}

function onAfterEnter(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.transition = ''
  htmlEl.style.height = ''
  htmlEl.style.overflow = ''
}

function onLeave(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.overflow = 'hidden'
  htmlEl.style.height = htmlEl.scrollHeight + 'px'
  htmlEl.style.opacity = '1'
  void htmlEl.offsetHeight
  htmlEl.style.transition = 'height 0.3s ease, opacity 0.3s ease'
  htmlEl.style.height = '0'
  htmlEl.style.opacity = '0'
}

function onAfterLeave(el: Element) {
  const htmlEl = el as HTMLElement
  htmlEl.style.transition = ''
  htmlEl.style.height = ''
  htmlEl.style.overflow = ''
}
```

```vue
<Transition @enter="onEnter" @after-enter="onAfterEnter" @leave="onLeave" @after-leave="onAfterLeave">
  <Collapsible v-if="Todos.length > 0" ...>
```

## 改动范围

- 仅修改 `app/pages/dashboard/analysis/[sessionId].vue`
- 模板：Transition 包裹 Collapsible、列表容器添加 ref 和 max-h/overflow 类
- 脚本：添加 todoListRef、自动展开 watch、自动滚动 watch、Transition JS hooks
- 无额外 CSS（动画通过 JS hooks 实现）
