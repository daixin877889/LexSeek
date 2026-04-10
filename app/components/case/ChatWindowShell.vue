<script lang="ts" setup>
/**
 * 聊天窗口外壳组件
 *
 * 封装三种窗口形态：
 * 1. 桌面全屏：fixed inset-0 z-50
 * 2. 桌面小窗：fixed + useDraggableResize（可拖拽缩放）
 * 3. 移动端 Sheet：Sheet side="bottom" h-dvh
 *
 * 通过 slots 暴露内容区域，消费方只需关注业务逻辑。
 */
import { Minimize2, Maximize2, X } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'

const props = withDefaults(defineProps<{
  /** 窗口标题 */
  title: string
  /** 标题栏图标（img src 或 null） */
  icon?: string | null
  /** 是否显示关闭按钮 */
  showClose?: boolean
  /** 是否显示全屏切换按钮 */
  showFullscreen?: boolean
  /** 是否启用拖拽 */
  draggable?: boolean
  /** 是否启用缩放 */
  resizable?: boolean
  /** 小窗初始宽度 */
  initialWidth?: number
  /** 小窗初始高度 */
  initialHeight?: number
  /** 小窗位置偏移（多窗口错开） */
  positionOffset?: { x: number; y: number }
}>(), {
  icon: null,
  showClose: true,
  showFullscreen: true,
  draggable: true,
  resizable: true,
  initialWidth: 380,
  initialHeight: 500,
  positionOffset: () => ({ x: 0, y: 0 }),
})

const isOpen = defineModel<boolean>('open', { default: false })
const isFullscreen = defineModel<boolean>('fullscreen', { default: false })

const isMobile = useMediaQuery('(max-width: 767px)')

// 拖拽和缩放（小窗模式）
const windowZIndex = ref(40)
const { style: windowStyle, onDragStart, onEdgeDetect, onResizeStart, cursor, isInteracting, reset }
  = useDraggableResize({
    initialWidth: props.initialWidth,
    initialHeight: props.initialHeight,
    minWidth: 300,
    minHeight: 350,
    positionOffset: props.positionOffset,
    zIndex: windowZIndex,
  })

const containerStyle = computed(() => ({
  ...windowStyle.value,
  cursor: cursor.value,
}))

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

function close() {
  isOpen.value = false
}

// 关闭时重置位置
watch(isOpen, (open) => {
  if (!open) {
    isFullscreen.value = false
    reset()
  }
})
</script>

<template>
  <!-- 桌面端 -->
  <template v-if="!isMobile">
    <!-- 全屏模式 -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="isOpen && isFullscreen" class="fixed inset-0 z-50 bg-background flex flex-col">
        <!-- 全屏标题栏 -->
        <div class="shrink-0 h-12 flex items-center justify-between px-4 border-b bg-muted/30">
          <div class="flex items-center gap-2 min-w-0">
            <img v-if="icon" :src="icon" class="size-4 shrink-0" :alt="title" />
            <slot name="titlebar-left">
              <span class="text-sm font-medium truncate">{{ title }}</span>
            </slot>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <slot name="titlebar-right" />
            <Button v-if="showFullscreen" variant="ghost" size="icon" class="size-8" @click="toggleFullscreen">
              <Minimize2 class="size-4" />
            </Button>
            <Button v-if="showClose" variant="ghost" size="icon" class="size-8" @click="close">
              <X class="size-4" />
            </Button>
          </div>
        </div>
        <!-- 内容区 -->
        <div class="flex-1 overflow-hidden">
          <slot />
        </div>
      </div>
    </Transition>

    <!-- 小窗模式（可拖拽、可缩放） -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen && !isFullscreen"
        class="fixed bg-background border rounded-xl shadow-xl flex flex-col overflow-hidden"
        :class="{ 'select-none': isInteracting }"
        :style="containerStyle"
        @pointermove="resizable ? onEdgeDetect($event) : undefined"
        @pointerdown="resizable ? onResizeStart($event) : undefined"
      >
        <!-- 小窗标题栏（可拖拽） -->
        <div
          class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30"
          :class="draggable ? 'cursor-grab active:cursor-grabbing' : ''"
          @pointerdown="draggable ? onDragStart($event) : undefined"
        >
          <div class="flex items-center gap-2 min-w-0">
            <img v-if="icon" :src="icon" class="size-3.5 shrink-0" :alt="title" />
            <slot name="titlebar-left">
              <span class="text-xs font-medium truncate">{{ title }}</span>
            </slot>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <slot name="titlebar-right" />
            <Button v-if="showFullscreen" variant="ghost" size="icon" class="size-6" @click="toggleFullscreen">
              <Maximize2 class="size-3" />
            </Button>
            <Button v-if="showClose" variant="ghost" size="icon" class="size-6" @click="close">
              <X class="size-3.5" />
            </Button>
          </div>
        </div>
        <!-- 内容区 -->
        <div class="flex-1 overflow-hidden">
          <slot />
        </div>
      </div>
    </Transition>
  </template>

  <!-- 移动端：底部 Sheet -->
  <Sheet v-else v-model:open="isOpen">
    <SheetContent side="bottom" class="h-dvh flex flex-col p-0">
      <SheetHeader class="shrink-0 px-4 pt-4 pb-2">
        <SheetTitle class="flex items-center justify-between text-sm">
          <div class="flex items-center gap-2 min-w-0">
            <img v-if="icon" :src="icon" class="size-4 shrink-0" :alt="title" />
            <slot name="titlebar-left">
              <span class="font-medium truncate">{{ title }}</span>
            </slot>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <slot name="titlebar-right" />
          </div>
        </SheetTitle>
      </SheetHeader>
      <div class="flex-1 overflow-hidden">
        <slot />
      </div>
    </SheetContent>
  </Sheet>
</template>
