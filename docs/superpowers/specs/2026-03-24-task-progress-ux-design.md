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

| 状态 | 样式 |
|------|------|
| `pending`（默认） | 空心灰色圆点 `border-muted-foreground/50` |
| `in_progress` | 绿色实心圆点 `border-green-500 bg-green-500 animate-pulse` |
| `completed` | 淡灰填充圆点 `border-muted-foreground/20 bg-muted-foreground/10` |

**向后兼容**：保留 `completed` boolean prop，当 `status` prop 存在时优先使用 `status`，否则 fallback 到 `completed` prop。

### 2. 三段式排序

新增 `sortedTodos` computed，排序优先级：`in_progress` (0) > `pending` (1) > `completed` (2)，同组内保持原始数组顺序（稳定排序）。

模板渲染从 `allTodos` 改为 `sortedTodos`。Badge 计数仍使用 `allTodos`（源数据）。

### 3. 自动滚动到底部

watch `allTodos`（deep），在状态变化后 `nextTick` 将 `todoListRef` 容器 `scrollTop` 设为 `scrollHeight`。

## 改动文件

| 文件 | 改动 |
|------|------|
| `app/components/ai-elements/queue/QueueItemIndicator.vue` | 新增 `status` prop，三态样式 |
| `app/pages/dashboard/analysis/[sessionId].vue` | `sortedTodos` computed + 自动滚动 + 模板更新 |
