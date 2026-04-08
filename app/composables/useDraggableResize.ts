/**
 * 可拖拽可缩放 composable
 *
 * 封装 pointer events 实现窗口拖拽移动和边缘 resize，
 * 用于案件详情页的模块分析对话框和小索对话框。
 *
 * 功能：
 * - 拖拽标题栏移动窗口
 * - 四边 + 四角 resize
 * - 松手后边界纠正（保证标题栏可见）
 * - 视口缩小时自动纠正
 * - 动态 z-index 支持
 */

import type { CSSProperties, Ref } from 'vue'
import { useWindowSize, watchThrottled } from '@vueuse/core'

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

/** 边缘方向标记 */
type Edge = 'top' | 'bottom' | 'left' | 'right' | null
interface ResizeDirection { vertical: Edge; horizontal: Edge }

export function useDraggableResize(options: UseDraggableResizeOptions = {}) {
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

  // ── 边缘检测 ──

  /** 检测鼠标在容器上的边缘位置 */
  function detectEdge(e: PointerEvent): ResizeDirection {
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const vertical: Edge
      = y < edgeThreshold ? 'top'
        : y > rect.height - edgeThreshold ? 'bottom'
          : null

    const horizontal: Edge
      = x < edgeThreshold ? 'left'
        : x > rect.width - edgeThreshold ? 'right'
          : null

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
    cursor.value = edgeToCursor(detectEdge(e)) || 'default'
  }

  // ── Resize ──

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
      }
      else if (edge.horizontal === 'left') {
        const proposedW = startSize.width - dx
        if (proposedW >= minWidth) {
          newW = proposedW
          newX = startPos.x + dx
        }
        else {
          newW = minWidth
          newX = startPos.x + (startSize.width - minWidth)
        }
      }

      // 垂直方向
      if (edge.vertical === 'bottom') {
        newH = Math.max(minHeight, startSize.height + dy)
      }
      else if (edge.vertical === 'top') {
        const proposedH = startSize.height - dy
        if (proposedH >= minHeight) {
          newH = proposedH
          newY = startPos.y + dy
        }
        else {
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

  // ── 拖拽 ──

  /** 边界纠正：确保标题栏在视口内 */
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
      const isTopEdge = y < edgeThreshold
      const isLeftEdge = x < edgeThreshold
      const isRightEdge = x > rect.width - edgeThreshold
      if (isTopEdge && (isLeftEdge || isRightEdge)) {
        startResize(e, {
          vertical: 'top',
          horizontal: isLeftEdge ? 'left' : 'right',
        })
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

  // 视口变化时自动纠正位置
  watchThrottled(
    [viewportW, viewportH],
    () => clampToViewport(),
    { throttle: 200 },
  )

  return {
    style,
    onDragStart,
    onEdgeDetect,
    onResizeStart,
    cursor,
    isInteracting,
    reset,
    position,
    size,
  }
}
