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

用 `<Transition>` 包裹 Collapsible，配合 `v-if="Todos.length > 0"` 控制渲染：

```vue
<Transition name="slide-up">
  <Collapsible v-if="Todos.length > 0" v-model:open="showTaskList" class="shrink-0 border-t">
    ...
  </Collapsible>
</Transition>
```

### 2. 自动展开

监听 Todos 长度变化，从 0 变为 >0 时自动展开：

```typescript
watch(() => Todos.length, (newLen, oldLen) => {
  if (oldLen === 0 && newLen > 0) {
    showTaskList.value = true
  }
})
```

### 3. 固定高度滚动

列表容器添加最大高度和滚动：

```vue
<div class="px-4 pb-3 max-h-[200px] overflow-y-auto">
```

### 4. CSS 动画

使用 `slide-up` transition，基于 `max-height` + `opacity`：

```css
.slide-up-enter-active,
.slide-up-leave-active {
  transition: max-height 0.3s ease, opacity 0.3s ease;
  overflow: hidden;
}

.slide-up-enter-from,
.slide-up-leave-to {
  max-height: 0;
  opacity: 0;
}

.slide-up-enter-to,
.slide-up-leave-from {
  max-height: 300px;
  opacity: 1;
}
```

## 改动范围

- 仅修改 `app/pages/dashboard/analysis/[sessionId].vue`
- 模板：3 处改动（Transition 包裹、列表容器高度）
- 脚本：1 处改动（添加 watch）
- 样式：1 处改动（添加 transition CSS）
