# 可拖拽可缩放对话框设计

## 概述

将案件详情页的两个对话框（模块分析对话框 `AnalysisModuleChat` 和小索对话框 `CaseDetailXiaosuo`）从固定位置/固定尺寸改为可拖拽移动、可自由缩放的浮动窗口。仅桌面端生效，移动端保持原有 Sheet 行为不变。

## 需求

1. **拖拽移动**：通过拖拽标题栏在视口内自由移动对话框，松手后自动纠正到视口范围内
2. **自由缩放**：通过拖拽四边和四角调整对话框大小，设最小尺寸限制（宽 300px，高 350px），无最大限制
3. **全屏模式保留**：退出全屏时恢复上次的位置和尺寸
4. **位置不持久化**：每次打开对话框回到默认位置和尺寸
5. **仅桌面端**：移动端继续使用底部 Sheet

## 技术方案

纯 composable 实现（方案 A），零额外依赖。

### 核心 composable：`useDraggableResize`

**文件位置**：`app/composables/useDraggableResize.ts`

#### 接口

```typescript
interface UseDraggableResizeOptions {
  /** 初始宽度，默认 380 */
  initialWidth?: number
  /** 初始高度，默认 640 */
  initialHeight?: number
  /** 最小宽度，默认 300 */
  minWidth?: number
  /** 最小高度，默认 350 */
  minHeight?: number
  /** resize 边缘检测区域宽度，默认 6px */
  edgeThreshold?: number
}

interface UseDraggableResizeReturn {
  /** 绑定到容器的 style（width, height, left, top） */
  style: ComputedRef<CSSProperties>
  /** 标题栏 pointerdown 事件处理器 */
  onDragStart: (e: PointerEvent) => void
  /** 容器 pointermove 事件处理器（用于 cursor 切换） */
  onEdgeDetect: (e: PointerEvent) => void
  /** 容器 pointerdown 事件处理器（用于边缘 resize） */
  onResizeStart: (e: PointerEvent) => void
  /** 当前 cursor 样式 */
  cursor: Ref<string>
  /** 是否正在拖拽或 resize（用于添加 select-none） */
  isInteracting: Ref<boolean>
  /** 重置到默认位置和尺寸 */
  reset: () => void
  /** 当前位置 */
  position: Ref<{ x: number; y: number }>
  /** 当前尺寸 */
  size: Ref<{ width: number; height: number }>
}
```

#### 工作原理

1. **拖拽移动**：
   - 标题栏 `pointerdown` → 记录起始鼠标位置和容器位置
   - `pointermove`（绑定到 document）更新 `position`
   - `pointerup` 执行边界纠正：检查标题栏是否在视口内，不在则用 `requestAnimationFrame` 平滑滚回

2. **边缘 resize**：
   - 容器 `pointermove` 检测鼠标是否在边缘 6px 范围内
   - 根据位置设置对应的 cursor（`ns-resize`、`ew-resize`、`nwse-resize`、`nesw-resize`）
   - 容器 `pointerdown` 在边缘时启动 resize
   - `pointermove` 更新 `size` + `position`（左/上边缘 resize 时需要同时调整位置以保持对边不动）
   - 应用最小尺寸限制

3. **拖拽和 resize 冲突处理**：
   - 标题栏角落同时属于拖拽区和 resize 区
   - 标题栏 `pointerdown` 先检查是否在角落 resize 区域
   - 在角落 → 启动 resize；不在角落 → 启动 drag

4. **边界纠正**：松手后检查标题栏顶部是否在视口内（保证至少标题栏可见可抓取），不在则用 `requestAnimationFrame` 平滑移回

#### 定位方式

使用 `fixed` 定位 + `left`/`top`/`width`/`height`，替代当前的 `absolute` + 固定 class。原因：
- 拖拽范围是视口级别
- 边界纠正基于视口尺寸计算
- `absolute` 在可滚动的父容器中会出现定位偏移

#### 默认初始位置

打开时定位在视口右下角，具体计算：
- `x = viewport.width - width - 16`
- `y = viewport.height - height - 70`（留出底部状态栏空间）

## 组件改造

### AnalysisModuleChat.vue

**小窗模式**改为使用 `useDraggableResize`：

- 移除 `absolute bottom-14 right-0 w-[380px] h-[500px]` 固定 class
- 容器改为 `fixed z-40` + `:style="style"` 绑定位置和尺寸
- 标题栏添加 `@pointerdown="onDragStart"` + `cursor-grab active:cursor-grabbing`
- 容器添加 `@pointermove="onEdgeDetect"` + `@pointerdown="onResizeStart"` + `:style="{ cursor }"`
- 拖拽/resize 期间添加 `select-none` class 防止文字选中
- 关闭时调用 `reset()` 重置位置和尺寸
- 全屏模式不变（`fixed inset-0 z-50`）
- 退出全屏时不 reset，保持上次的 position/size

### CaseDetailXiaosuo.vue

同样应用 `useDraggableResize`：
- 小窗模式使用相同的 composable
- 悬浮按钮位置不受影响（保持 `absolute bottom-4 right-4`）
- 关闭/打开逻辑不变

### 移动端

无变更。`isMobile` 判断下仍使用 `Sheet` + `SheetContent`。

## 交互细节

### 拖拽

| 项目 | 设定 |
|------|------|
| 触发区域 | 标题栏（h-10 区域） |
| 默认 cursor | `grab` |
| 拖拽中 cursor | `grabbing` |
| 拖拽中样式 | 容器 `select-none` |
| 边界纠正 | 松手后标题栏保持在视口内 |

### Resize

| 项目 | 设定 |
|------|------|
| 检测区域 | 容器边缘 6px |
| 方向 | 四边 + 四角（共 8 个方向） |
| 最小宽度 | 300px |
| 最小高度 | 350px |
| 最大尺寸 | 无限制 |
| Cursor 映射 | 上下：`ns-resize`，左右：`ew-resize`，对角：`nwse-resize`/`nesw-resize` |

### 全屏切换

- 进入全屏：保存当前 position/size
- 退出全屏：恢复保存的 position/size
- 关闭对话框：reset() 回到默认

## 涉及文件

| 文件 | 变更类型 |
|------|---------|
| `app/composables/useDraggableResize.ts` | 新建 |
| `app/components/case/AnalysisModuleChat.vue` | 修改 |
| `app/components/caseDetail/CaseDetailXiaosuo.vue` | 修改 |

## 不涉及的文件

- `useModuleChatManager.ts` — 对话管理逻辑不变
- `useCaseChat.ts` — 对话通信逻辑不变
- `AnalysisModuleChatBar.vue` — 最小化状态条不变
- `[id].vue` — 页面挂载方式不变
- 移动端 Sheet 相关代码 — 不变
