# 任务进度 UX 优化设计

**日期**: 2026-03-24
**范围**: `/dashboard/analysis/[sessionId]` 页面任务进度区域

## 问题

当前任务进度列表存在三个 UX 问题：
1. 已完成任务与进行中任务混排，无法快速区分当前进度
2. 新状态更新时列表不自动滚动，用户可能错过底部变化
3. `in_progress` 状态无视觉区分，与 `pending` 看起来一样

## 设计

### 1. QueueItemIndicator 三态支持

扩展 `app/components/ai-elements/queue/QueueItemIndicator.vue`，新增 `status` prop：

```typescript
interface QueueItemIndicatorProps {
  completed?: boolean           // 保留，向后兼容
  status?: 'pending' | 'in_progress' | 'completed'  // 新增，优先级高于 completed
  class?: HTMLAttributes['class']
}
```

当 `status` prop 存在时优先使用，否则 fallback 到 `completed` prop（等价于 `completed ? 'completed' : 'pending'`）。

| 状态 | 样式 |
|------|------|
| `pending`（默认） | 空心灰色圆点 `border-muted-foreground/50` |
| `in_progress` | 绿色实心圆点 `border-green-500 bg-green-500 animate-pulse` |
| `completed` | 淡灰填充圆点 `border-muted-foreground/20 bg-muted-foreground/10` |

### 2. QueueItemContent 保持不变

`QueueItemContent` 组件不修改。`in_progress` 状态使用默认文字样式（与 `pending` 相同的 `text-muted-foreground`），视觉区分全部通过 indicator 的绿色脉冲动画承载。

### 3. 三段式排序

新增 `sortedTodos` computed，排序优先级：`in_progress` (0) > `pending` (1) > `completed` (2)。依赖 V8 稳定排序（V8 7.0+ 保证），同组内保持原始数组顺序。

模板渲染从 `allTodos` 改为 `sortedTodos`。Badge 计数仍使用 `allTodos`（源数据）。

### 4. 自动滚动

watch `allTodos`（deep），当检测到有任务状态变化时，`nextTick` 后将 `todoListRef` 容器滚动到底部。

**边界情况**：
- Collapsible 折叠时 `todoListRef` 不可见，滚动操作会被跳过（检查 `scrollHeight > 0`）
- 列表 `max-h-[120px]` 较小，大部分场景可完整展示所有任务，滚动主要服务于任务数量超出可视区的场景

## 改动文件

| 文件 | 改动 |
|------|------|
| `app/components/ai-elements/queue/QueueItemIndicator.vue` | 新增 `status` prop，三态样式 |
| `app/pages/dashboard/analysis/[sessionId].vue` | `sortedTodos` computed + 自动滚动 + 模板传入 `status` prop |
