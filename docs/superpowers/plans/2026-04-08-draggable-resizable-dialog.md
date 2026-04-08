# 可拖拽可缩放对话框实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将案件详情页的模块分析对话框和小索对话框改为可拖拽移动、可自由缩放的浮动窗口。

**Architecture:** 创建纯 composable `useDraggableResize` 封装 pointer events 实现拖拽和缩放逻辑，然后分别改造两个对话框组件的小窗模式，从固定 `absolute` 定位改为 `fixed` + 动态 style 绑定。移动端保持原有 Sheet 行为不变。

**Tech Stack:** Vue 3 Composition API, Pointer Events API, @vueuse/core (useWindowSize)

---

### Task 1: 创建 `useDraggableResize` composable — 边缘检测与 cursor 管理

**Files:**
- Create: `app/composables/useDraggableResize.ts`

这是 composable 的基础骨架，包含类型定义、状态初始化、边缘检测逻辑。

- [ ] **Step 1: 创建 composable 骨架和类型定义**

创建 `app/composables/useDraggableResize.ts`，包含：

```typescript
import type { CSSProperties, ComputedRef, Ref } from 'vue'
import { useWindowSize } from '@vueuse/core'

export interface UseDraggableResizeOptions {
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
  /** 默认位置偏移（用于多窗口错开），默认 { x: 0, y: 0 } */
  positionOffset?: { x: number; y: number }
  /** 外部传入的 z-index（用于多窗口动态层级管理） */
  zIndex?: Ref<number>
}

/** 边缘方向标记（可组合，如 top + left = 左上角） */
type Edge = 'top' | 'bottom' | 'left' | 'right' | null
type ResizeDirection = { vertical: Edge; horizontal: Edge }

export interface UseDraggableResizeReturn {
  /** 绑定到容器的 style */
  style: ComputedRef<CSSProperties>
  /** 标题栏 pointerdown */
  onDragStart: (e: PointerEvent) => void
  /** 容器 pointermove（cursor 切换） */
  onEdgeDetect: (e: PointerEvent) => void
  /** 容器 pointerdown（边缘 resize） */
  onResizeStart: (e: PointerEvent) => void
  /** 当前 cursor 样式 */
  cursor: Ref<string>
  /** 是否正在拖拽或 resize */
  isInteracting: Ref<boolean>
  /** 触发窗口激活（提升 z-index） */
  activate: () => void
  /** 重置到默认位置和尺寸 */
  reset: () => void
  /** 当前位置 */
  position: Ref<{ x: number; y: number }>
  /** 当前尺寸 */
  size: Ref<{ width: number; height: number }>
}
```

- [ ] **Step 2: 实现默认位置计算和状态初始化**

在同一文件中添加 `useDraggableResize` 函数主体：

```typescript
export function useDraggableResize(options: UseDraggableResizeOptions = {}): UseDraggableResizeReturn {
  const {
    initialWidth = 380,
    initialHeight = 640,
    minWidth = 300,
    minHeight = 350,
    edgeThreshold = 6,
    positionOffset = { x: 0, y: 0 },
    zIndex,
  } = options

  const { width: viewportW, height: viewportH } = useWindowSize()

  // 计算默认初始位置（视口右下角）
  function getDefaultPosition() {
    return {
      x: viewportW.value - initialWidth - 16 + positionOffset.x,
      y: viewportH.value - initialHeight - 70 + positionOffset.y,
    }
  }

  const position = ref(getDefaultPosition())
  const size = ref({ width: initialWidth, height: initialHeight })
  const cursor = ref('default')
  const isInteracting = ref(false)

  // 当前检测到的边缘方向
  let currentEdge: ResizeDirection = { vertical: null, horizontal: null }

  function reset() {
    position.value = getDefaultPosition()
    size.value = { width: initialWidth, height: initialHeight }
  }

  // style 计算（包含动态 z-index）
  const style = computed<CSSProperties>(() => ({
    left: `${position.value.x}px`,
    top: `${position.value.y}px`,
    width: `${size.value.width}px`,
    height: `${size.value.height}px`,
    ...(zIndex ? { zIndex: zIndex.value } : {}),
  }))

  /** 触发窗口激活（提升 z-index），由使用方在 pointerdown 时调用 */
  function activate() {
    // 由外部 z-index 管理逻辑处理，composable 只触发回调
    // 使用方通过修改 zIndex ref 来提升层级
  }

  // ... 后续步骤填充（Task 2 拖拽、Task 3 resize 的代码插入此处）
  // return 语句在 Task 3 Step 2 中补充

  // 临时 return（使文件可编译，Task 3 完成时替换为完整版本）
  return { style, onDragStart: () => {}, onEdgeDetect, onResizeStart: () => {}, cursor, isInteracting, activate, reset, position, size }
}
```

- [ ] **Step 3: 实现边缘检测逻辑**

添加 `detectEdge` 和 `onEdgeDetect` 函数：

```typescript
  /** 检测鼠标在容器上的边缘位置 */
  function detectEdge(e: PointerEvent): ResizeDirection {
    const el = (e.currentTarget as HTMLElement)
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const vertical: Edge =
      y < edgeThreshold ? 'top' :
      y > rect.height - edgeThreshold ? 'bottom' :
      null

    const horizontal: Edge =
      x < edgeThreshold ? 'left' :
      x > rect.width - edgeThreshold ? 'right' :
      null

    return { vertical, horizontal }
  }

  /** cursor 映射 */
  function edgeToCursor(edge: ResizeDirection): string {
    const { vertical, horizontal } = edge
    if (vertical === 'top' && horizontal === 'left') return 'nwse-resize'
    if (vertical === 'top' && horizontal === 'right') return 'nesw-resize'
    if (vertical === 'bottom' && horizontal === 'left') return 'nesw-resize'
    if (vertical === 'bottom' && horizontal === 'right') return 'nwse-resize'
    if (vertical) return 'ns-resize'
    if (horizontal) return 'ew-resize'
    return ''
  }

  function onEdgeDetect(e: PointerEvent) {
    if (isInteracting.value) return
    currentEdge = detectEdge(e)
    cursor.value = edgeToCursor(currentEdge) || 'default'
  }
```

- [ ] **Step 4: 提交**

```bash
git add app/composables/useDraggableResize.ts
git commit -m "feat(ui): 添加 useDraggableResize composable 骨架和边缘检测"
```

---

### Task 2: 实现拖拽移动逻辑

**Files:**
- Modify: `app/composables/useDraggableResize.ts`

- [ ] **Step 1: 实现拖拽移动和边界纠正**

在 `useDraggableResize` 函数中添加：

```typescript
  /** 边界纠正：确保标题栏（前 40px）在视口内 */
  function clampToViewport() {
    const titleBarHeight = 40
    const p = { ...position.value }

    // 左边界：至少显示 100px 宽度的标题栏
    if (p.x + size.value.width < 100) p.x = 100 - size.value.width
    // 右边界：左侧至少可见 100px
    if (p.x > viewportW.value - 100) p.x = viewportW.value - 100
    // 上边界：标题栏不超出视口顶部
    if (p.y < 0) p.y = 0
    // 下边界：标题栏至少在视口内
    if (p.y > viewportH.value - titleBarHeight) p.y = viewportH.value - titleBarHeight

    position.value = p
  }

  function onDragStart(e: PointerEvent) {
    // 检查是否在标题栏角落的 resize 区域（左上角或右上角）
    const el = (e.currentTarget as HTMLElement).parentElement
    if (el) {
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      // 只有同时在顶边和左/右边缘时才是角落 resize
      const isTopEdge = y < edgeThreshold
      const isLeftEdge = x < edgeThreshold
      const isRightEdge = x > rect.width - edgeThreshold
      if (isTopEdge && (isLeftEdge || isRightEdge)) {
        const cornerEdge: ResizeDirection = {
          vertical: 'top',
          horizontal: isLeftEdge ? 'left' : 'right',
        }
        startResize(e, cornerEdge)
        e.stopPropagation()
        return
      }
    }

    e.preventDefault()
    e.stopPropagation()
    isInteracting.value = true

    const startX = e.clientX
    const startY = e.clientY
    const startPos = { ...position.value }

    function onMove(ev: PointerEvent) {
      position.value = {
        x: startPos.x + (ev.clientX - startX),
        y: startPos.y + (ev.clientY - startY),
      }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      isInteracting.value = false
      clampToViewport()
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }
```

- [ ] **Step 2: 添加视口变化时的自动纠正**

```typescript
  // 视口变化时自动纠正位置
  watchThrottled(
    [viewportW, viewportH],
    () => clampToViewport(),
    { throttle: 200 },
  )
```

需要从 `@vueuse/core` 导入 `watchThrottled`：

```typescript
import { useWindowSize, watchThrottled } from '@vueuse/core'
```

- [ ] **Step 3: 提交**

```bash
git add app/composables/useDraggableResize.ts
git commit -m "feat(ui): 实现拖拽移动和边界纠正逻辑"
```

---

### Task 3: 实现 resize 逻辑

**Files:**
- Modify: `app/composables/useDraggableResize.ts`

- [ ] **Step 1: 实现 resize 启动和移动逻辑**

添加 `startResize` 和 `onResizeStart`：

```typescript
  function startResize(e: PointerEvent, edge: ResizeDirection) {
    e.preventDefault()
    isInteracting.value = true
    cursor.value = edgeToCursor(edge)

    const startX = e.clientX
    const startY = e.clientY
    const startPos = { ...position.value }
    const startSize = { ...size.value }

    // 在 body 上设置 cursor，防止移出容器后 cursor 变回
    document.body.style.cursor = cursor.value
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY

      let newX = startPos.x
      let newY = startPos.y
      let newW = startSize.width
      let newH = startSize.height

      // 水平方向
      if (edge.horizontal === 'right') {
        newW = Math.max(minWidth, startSize.width + dx)
      } else if (edge.horizontal === 'left') {
        const proposedW = startSize.width - dx
        if (proposedW >= minWidth) {
          newW = proposedW
          newX = startPos.x + dx
        } else {
          newW = minWidth
          newX = startPos.x + (startSize.width - minWidth)
        }
      }

      // 垂直方向
      if (edge.vertical === 'bottom') {
        newH = Math.max(minHeight, startSize.height + dy)
      } else if (edge.vertical === 'top') {
        const proposedH = startSize.height - dy
        if (proposedH >= minHeight) {
          newH = proposedH
          newY = startPos.y + dy
        } else {
          newH = minHeight
          newY = startPos.y + (startSize.height - minHeight)
        }
      }

      position.value = { x: newX, y: newY }
      size.value = { width: newW, height: newH }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      isInteracting.value = false
      cursor.value = 'default'
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  function onResizeStart(e: PointerEvent) {
    const edge = detectEdge(e)
    if (!edge.vertical && !edge.horizontal) return
    startResize(e, edge)
  }
```

- [ ] **Step 2: 完成 return 语句，导出所有接口**

```typescript
  return {
    style,
    onDragStart,
    onEdgeDetect,
    onResizeStart,
    cursor,
    isInteracting,
    activate,
    reset,
    position,
    size,
  }
}
```

替换 Task 1 中的临时 return 语句。

- [ ] **Step 3: 提交**

```bash
git add app/composables/useDraggableResize.ts
git commit -m "feat(ui): 实现 resize 逻辑（四边 + 四角）"
```

---

### Task 4: 改造 AnalysisModuleChat.vue

**Files:**
- Modify: `app/components/case/AnalysisModuleChat.vue:17-88`

- [ ] **Step 1: 引入 composable 并更新 script**

在 `<script>` 中添加 composable 调用，更新关闭/全屏逻辑：

```typescript
// 现有 imports 保持不变，新增：
// z-index 动态管理：AnalysisModuleChat 用偏移位置避免与小索重叠
const moduleChatZIndex = ref(40)
const { style: windowStyle, onDragStart, onEdgeDetect, onResizeStart, cursor, isInteracting, reset }
    = useDraggableResize({
        initialWidth: 380,
        initialHeight: 640,
        minWidth: 300,
        minHeight: 350,
        positionOffset: { x: -40, y: -40 },
        zIndex: moduleChatZIndex,
    })

// 合并 style（模板中直接绑定此 computed）
const containerStyle = computed(() => ({
    ...windowStyle.value,
    cursor: cursor.value,
}))

// 修改 watch：关闭时 reset 位置
watch(isOpen, (open) => {
    if (!open) {
        isFullscreen.value = false
        reset()
    }
})
```

- [ ] **Step 2: 更新小窗模式模板**

将小窗模式的 `<Transition>` 和容器从：
```html
<Transition enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 scale-95 translate-y-2" ...>
    <div v-if="isOpen && !isFullscreen"
        class="absolute bottom-14 right-4 w-[380px] h-[640px] z-40 ...">
```

改为：
```html
<Transition enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0" enter-to-class="opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100" leave-to-class="opacity-0">
    <div v-if="isOpen && !isFullscreen"
        class="fixed bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden"
        :class="{ 'select-none': isInteracting }"
        :style="containerStyle"
        @pointermove="onEdgeDetect"
        @pointerdown="onResizeStart">
```

注意：`z-40` 改为由 `containerStyle` 中的 `zIndex` 动态控制。

- [ ] **Step 3: 更新标题栏，添加拖拽手柄**

将标题栏从：
```html
<div class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30">
```

改为：
```html
<div class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30
            cursor-grab active:cursor-grabbing"
    @pointerdown="onDragStart">
```

- [ ] **Step 4: 验证全屏模式不变**

确认全屏模式 `<div v-if="isOpen && isFullscreen" class="fixed md:absolute inset-0 z-50 ...">` 保持不变，无需修改。

- [ ] **Step 5: 提交**

```bash
git add app/components/case/AnalysisModuleChat.vue
git commit -m "feat(ui): AnalysisModuleChat 支持拖拽移动和自由缩放"
```

---

### Task 5: 改造 CaseDetailXiaosuo.vue

**Files:**
- Modify: `app/components/caseDetail/CaseDetailXiaosuo.vue:49-182`

- [ ] **Step 1: 引入 composable 并更新 script**

在 `<script>` 中添加：

```typescript
const xiaosuoZIndex = ref(40)
const { style: windowStyle, onDragStart, onEdgeDetect, onResizeStart, cursor, isInteracting, reset }
    = useDraggableResize({
        initialWidth: 380,
        initialHeight: 500,
        minWidth: 300,
        minHeight: 350,
        zIndex: xiaosuoZIndex,
    })

// 合并 style
const containerStyle = computed(() => ({
    ...windowStyle.value,
    cursor: cursor.value,
}))

// 修改 watch：关闭时 reset 位置
watch(isOpen, (open) => {
    if (!open) {
        isFullscreen.value = false
        reset()
    }
})
```

- [ ] **Step 2: 重构 DOM 结构 — 小窗从按钮容器中移出**

当前结构是小窗嵌套在悬浮按钮的 `<div class="absolute bottom-4 right-4 z-40">` 内部。需要改为平级结构。

将桌面端模板从：
```html
<div class="absolute bottom-4 right-4 z-40">
  <Transition ...>
    <div v-if="isOpen && !isFullscreen"
      class="absolute bottom-14 right-0 w-[380px] h-[500px] ...">
      <!-- 小窗内容 -->
    </div>
  </Transition>
  <img v-show="!isFullscreen" ... @click="isOpen = !isOpen" />
</div>
```

改为：
```html
<!-- 小窗模式：独立的 fixed 定位 -->
<Transition enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0" enter-to-class="opacity-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100" leave-to-class="opacity-0">
    <div v-if="isOpen && !isFullscreen"
        class="fixed bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden"
        :class="{ 'select-none': isInteracting }"
        :style="containerStyle"
        @pointermove="onEdgeDetect"
        @pointerdown="onResizeStart">
        <!-- 标题栏 -->
        <div class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30
                    cursor-grab active:cursor-grabbing"
            @pointerdown="onDragStart">
            <!-- 标题和按钮保持不变 -->
        </div>
        <!-- 消息列表和输入框保持不变 -->
    </div>
</Transition>

<!-- 悬浮按钮：独立定位 -->
<div class="absolute bottom-4 right-4 z-40">
    <img v-show="!isFullscreen" ... @click="isOpen = !isOpen" />
</div>
```

- [ ] **Step 3: 提交**

```bash
git add app/components/caseDetail/CaseDetailXiaosuo.vue
git commit -m "feat(ui): CaseDetailXiaosuo 支持拖拽移动和自由缩放"
```

---

### Task 6: 手动验证

**Files:** 无代码变更

- [ ] **Step 1: 启动开发服务器验证**

```bash
bun dev
```

在浏览器中打开案件详情页（如 `/dashboard/cases/16?tab=analysis&ai=1`），验证以下场景：

1. **模块分析对话框**：
   - 点击模块聊天按钮打开小窗 → 出现在视口右下角
   - 拖拽标题栏移动窗口 → 窗口跟随移动
   - 松手后如果超出视口 → 自动纠正回来
   - 鼠标移到窗口边缘 → cursor 变为 resize 样式
   - 拖拽边缘/角落 → 窗口大小改变，最小 300x350
   - 点击全屏 → 全屏显示
   - 退出全屏 → 恢复上次的位置和尺寸
   - 关闭窗口再打开 → 回到默认位置和尺寸

2. **小索对话框**：
   - 点击小索图标打开小窗 → 出现在视口右下角
   - 同样验证拖拽、resize、全屏切换、关闭重置

3. **移动端**（开发者工具切换为移动视口）：
   - 两个对话框仍然使用底部 Sheet，无拖拽/resize 功能

4. **浏览器窗口缩放**：
   - 拖拽对话框到某个位置 → 缩小浏览器窗口 → 对话框自动纠正到视口内

5. **双窗口同时打开**：
   - 同时打开模块分析和小索对话框 → 两个窗口位置不完全重叠（AnalysisModuleChat 偏移 -40, -40）
   - 点击/拖拽其中一个窗口 → 该窗口层级提升到最上层

- [ ] **Step 2: 提交验证完成**

如果发现问题，修复后提交。
