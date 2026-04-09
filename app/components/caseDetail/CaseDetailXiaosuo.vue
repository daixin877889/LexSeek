<script lang="ts" setup>
import { XIcon, MaximizeIcon, MinimizeIcon, PlusIcon, ChevronDownIcon, Trash2Icon } from 'lucide-vue-next'
import xiaosuoIcon from '~/assets/icon/xiaosuo.svg'
import { useMediaQuery } from '@vueuse/core'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import type { useXiaosuoChat } from '~/composables/useXiaosuoChat'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const props = defineProps<{
  xiaosuoChat: ReturnType<typeof useXiaosuoChat>
}>()

const isOpen = defineModel<boolean>({ default: false })

const isMobile = useMediaQuery('(max-width: 767px)')
const isFullscreen = ref(false)
const thinking = ref(true)
const sessionListOpen = ref(false)

// 拖拽和缩放
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

// 当前 session 标题
const currentSessionTitle = computed(() => {
  const sid = props.xiaosuoChat.currentSessionId.value
  const session = props.xiaosuoChat.sessions.value.find((s: any) => s.sessionId === sid)
  return session?.title ?? '新对话'
})

// 解包 composable 状态供模板使用（避免模板中 .value 类型推导问题）
const chatMessages = computed(() => props.xiaosuoChat.messages.value as any[])
const chatLoading = computed(() => !!props.xiaosuoChat.isLoading.value)

// 中断处理（与 [sessionId].vue 保持一致）
const interrupt = computed(() => {
  const v = props.xiaosuoChat.values.value as any
  if (!v?.__interrupt__?.length) return undefined
  return v.__interrupt__.length === 1 ? v.__interrupt__[0] : v.__interrupt__
})

const interruptData = computed(() => {
  const raw = interrupt.value
  if (!raw) return null
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === 'insufficient_points') return val
  return null
})

function resumeWorkflow() {
  props.xiaosuoChat.resumeInterrupt({ action: 'continue' })
}

function handleSubmit(data: { text: string }) {
  if (data.text.trim()) {
    props.xiaosuoChat.sendMessage(data.text, { thinking: thinking.value })
  }
}

async function handleCreateSession() {
  sessionListOpen.value = false
  await props.xiaosuoChat.createSession()
}

async function handleSwitchSession(sessionId: string) {
  sessionListOpen.value = false
  await props.xiaosuoChat.switchSession(sessionId)
}

async function handleDeleteSession(sessionId: string) {
  await props.xiaosuoChat.deleteSession(sessionId)
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
}

// 首次打开时初始化；关闭时重置全屏和窗口位置
watch(isOpen, (open) => {
  if (open) {
    props.xiaosuoChat.init()
  }
  if (!open) {
    isFullscreen.value = false
    reset()
  }
})
</script>

<template>
  <!-- 桌面端：悬浮按钮 + 弹窗（支持小窗/全屏切换） -->
  <template v-if="!isMobile">
    <!-- 全屏模式：覆盖整个内容区 -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen && isFullscreen"
        class="fixed md:absolute inset-0 z-50 bg-background flex flex-col"
      >
        <!-- 全屏标题栏 -->
        <div class="shrink-0 h-12 flex items-center justify-between px-4 border-b bg-muted/30">
          <div class="flex items-center gap-2">
            <img :src="xiaosuoIcon" class="size-4" alt="小索" />
            <Popover v-model:open="sessionListOpen">
              <PopoverTrigger as-child>
                <button class="flex items-center gap-1 text-sm font-medium hover:text-primary transition-colors">
                  {{ currentSessionTitle }}
                  <ChevronDownIcon class="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent class="w-64 p-0" align="start">
                <div class="max-h-60 overflow-y-auto">
                  <div
                    v-for="s in xiaosuoChat.sessions.value"
                    :key="s.sessionId"
                    class="flex items-center justify-between px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                    :class="{ 'bg-muted/50': s.sessionId === xiaosuoChat.currentSessionId.value }"
                    @click="handleSwitchSession(s.sessionId)"
                  >
                    <span class="truncate flex-1">{{ s.title }}</span>
                    <span class="shrink-0 text-xs text-muted-foreground mx-1">{{ dayjs(s.updatedAt).fromNow() }}</span>
                    <button
                      class="shrink-0 ml-1 p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                      @click.stop="handleDeleteSession(s.sessionId)"
                    >
                      <Trash2Icon class="size-3" />
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="icon" class="size-8" @click="handleCreateSession">
              <PlusIcon class="size-4" />
            </Button>
            <Button variant="ghost" size="icon" class="size-8" @click="toggleFullscreen">
              <MinimizeIcon class="size-4" />
            </Button>
            <Button variant="ghost" size="icon" class="size-8" @click="isOpen = false">
              <XIcon class="size-4" />
            </Button>
          </div>
        </div>

        <!-- 对话内容 -->
        <div class="flex-1 overflow-hidden">
          <AiChat
            :messages="chatMessages"
            :loading="chatLoading"
            panel-mode="left"
            :show-header="false"
            v-model:thinking="thinking"
            :enable-file-upload="false"
            prompt-placeholder="问我任何关于案件的问题..."
            @submit="handleSubmit"
            @stop="xiaosuoChat.stopGeneration()"
          />
        </div>
      </div>
    </Transition>

    <!-- 小窗模式（可拖拽、可缩放）：独立 fixed 定位 -->
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
        @pointermove="onEdgeDetect"
        @pointerdown="onResizeStart"
      >
        <!-- 小窗标题栏（可拖拽） -->
        <div class="shrink-0 h-10 flex items-center justify-between px-3 border-b bg-muted/30
                    cursor-grab active:cursor-grabbing"
            @pointerdown="onDragStart">
          <div class="flex items-center gap-2">
            <img :src="xiaosuoIcon" class="size-3.5" alt="小索" />
            <Popover v-model:open="sessionListOpen">
              <PopoverTrigger as-child>
                <button class="flex items-center gap-1 text-xs font-medium hover:text-primary transition-colors">
                  {{ currentSessionTitle }}
                  <ChevronDownIcon class="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent class="w-56 p-0" align="start">
                <div class="max-h-48 overflow-y-auto">
                  <div
                    v-for="s in xiaosuoChat.sessions.value"
                    :key="s.sessionId"
                    class="flex items-center justify-between px-3 py-1.5 hover:bg-muted cursor-pointer text-xs"
                    :class="{ 'bg-muted/50': s.sessionId === xiaosuoChat.currentSessionId.value }"
                    @click="handleSwitchSession(s.sessionId)"
                  >
                    <span class="truncate flex-1">{{ s.title }}</span>
                    <span class="shrink-0 text-xs text-muted-foreground mx-1">{{ dayjs(s.updatedAt).fromNow() }}</span>
                    <button
                      class="shrink-0 ml-1 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive"
                      @click.stop="handleDeleteSession(s.sessionId)"
                    >
                      <Trash2Icon class="size-2.5" />
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div class="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" class="size-6" @click="handleCreateSession">
              <PlusIcon class="size-3" />
            </Button>
            <Button variant="ghost" size="icon" class="size-6" @click="toggleFullscreen">
              <MaximizeIcon class="size-3" />
            </Button>
            <Button variant="ghost" size="icon" class="size-6" @click="isOpen = false">
              <XIcon class="size-3.5" />
            </Button>
          </div>
        </div>

        <div class="flex-1 overflow-hidden">
          <AiChat
            :messages="chatMessages"
            :loading="chatLoading"
            panel-mode="left"
            :show-header="false"
            v-model:thinking="thinking"
            :enable-file-upload="false"
            prompt-placeholder="问我任何关于案件的问题..."
            @submit="handleSubmit"
            @stop="xiaosuoChat.stopGeneration()"
          />
        </div>
      </div>
    </Transition>

    <!-- 悬浮按钮：独立定位 -->
    <div class="absolute bottom-4 right-4 z-40">
      <img
        v-show="!isFullscreen"
        :src="xiaosuoIcon"
        class="size-12 cursor-pointer hover:scale-110 transition-transform drop-shadow-lg"
        alt="小索"
        @click="isOpen = !isOpen"
      />
    </div>
  </template>

  <!-- 移动端：底部 Sheet -->
  <template v-else>
    <Sheet v-model:open="isOpen">
      <SheetContent side="bottom" class="h-[90vh] flex flex-col p-0">
        <SheetHeader class="shrink-0 px-4 pt-4 pb-2">
          <SheetTitle class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <img :src="xiaosuoIcon" class="size-4" alt="小索" />
              <Popover v-model:open="sessionListOpen">
                <PopoverTrigger as-child>
                  <button class="flex items-center gap-1 font-medium hover:text-primary transition-colors">
                    {{ currentSessionTitle }}
                    <ChevronDownIcon class="size-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent class="w-64 p-0" align="start">
                  <div class="max-h-60 overflow-y-auto">
                    <div
                      v-for="s in xiaosuoChat.sessions.value"
                      :key="s.sessionId"
                      class="flex items-center justify-between px-3 py-2 hover:bg-muted cursor-pointer text-sm"
                      :class="{ 'bg-muted/50': s.sessionId === xiaosuoChat.currentSessionId.value }"
                      @click="handleSwitchSession(s.sessionId)"
                    >
                      <span class="truncate flex-1">{{ s.title }}</span>
                      <span class="shrink-0 text-xs text-muted-foreground mx-1">{{ dayjs(s.updatedAt).fromNow() }}</span>
                      <button
                        class="shrink-0 ml-1 p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                        @click.stop="handleDeleteSession(s.sessionId)"
                      >
                        <Trash2Icon class="size-3" />
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Button variant="ghost" size="icon" class="size-8" @click="handleCreateSession">
              <PlusIcon class="size-4" />
            </Button>
          </SheetTitle>
        </SheetHeader>

        <div class="flex-1 overflow-hidden">
          <AiChat
            :messages="chatMessages"
            :loading="chatLoading"
            panel-mode="left"
            :show-header="false"
            :show-thinking-toggle="false"
            :enable-file-upload="false"
            prompt-placeholder="问我任何关于案件的问题..."
            @submit="handleSubmit"
            @stop="xiaosuoChat.stopGeneration()"
          />
        </div>
      </SheetContent>
    </Sheet>
  </template>

  <!-- 积分不足弹窗 -->
  <Dialog :open="!!interruptData" @update:open="() => {}">
    <DialogContent class="sm:max-w-md">
      <InitAnalysisInsufficientPointsCard
        v-if="interruptData"
        :is-member="interruptData.data?.isMember ?? false"
        :available-points="interruptData.data?.availablePoints"
        :required-points="interruptData.data?.requiredPoints"
        :reason="interruptData.data?.reason"
        @resume="resumeWorkflow"
      />
    </DialogContent>
  </Dialog>
</template>
