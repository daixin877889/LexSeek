<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowLeftIcon, PanelLeftIcon, PanelRightIcon, LoaderIcon } from 'lucide-vue-next'
import type { TodoItem } from './composables/useTaskQueueParser'
import type { AiPromptSubmitData } from './AiPromptInput.vue'
import type { ToolCallWithResult } from './composables/useMessageParser'
import { useMessageParser } from './composables/useMessageParser'
import AiMessageList from '~/components/ai/AiMessageList.vue'
import AiPromptInput from '~/components/ai/AiPromptInput.vue'
import AiTaskQueue from '~/components/ai/AiTaskQueue.vue'

type PanelMode = 'left' | 'right' | 'both'

interface Props {
  // 布局
  title?: string
  showHeader?: boolean
  panelMode?: PanelMode
  defaultLeftSize?: number
  minPanelSize?: number
  // 消息
  messages: any[]
  loading?: boolean
  /**
   * 工作流是否处于 interrupt 中。
   * 为 true 时，未完成的工具调用状态从"运行中"改为"已暂停"，
   * 避免用户感知 UI 卡死（参考 useMessageParser 的 isInterrupted 参数）。
   */
  isInterrupted?: boolean
  // 输入框
  showPrompt?: boolean
  promptPlaceholder?: string
  promptDisabled?: boolean
  showThinkingToggle?: boolean
  enableFileUpload?: boolean
  thinking?: boolean
  // 队列状态（透传给 AiPromptInput）
  queueLength?: number
  queueFull?: boolean
  isStopping?: boolean
  // 工具
  toolMap?: Record<string, Component>
  /**
   * 合成工具卡片：按 parentMessageId 索引，会被 concat 到匹配 AIMessage 的 toolCalls 末尾。
   * 业务方传 useStreamChat / useDomainAgentSession 暴露的 syntheticToolCalls。
   * 当前唯一场景：模块对话保存分析结果时显示"生成结果摘要"进度卡片。
   */
  extraToolCalls?: Record<string, ToolCallWithResult[]>
  // 任务队列
  showTaskQueue?: boolean
  todos?: readonly TodoItem[]
  // 文件按钮点击回调（替代默认的本地文件选择，用于接入外部材料选择弹框）
  onFileButtonClick?: () => void
}

const props = withDefaults(defineProps<Props>(), {
  title: 'AI 对话',
  showHeader: true,
  panelMode: 'both',
  defaultLeftSize: 50,
  minPanelSize: 30,
  loading: false,
  isInterrupted: false,
  showPrompt: true,
  promptPlaceholder: '输入消息...',
  promptDisabled: false,
  showThinkingToggle: true,
  enableFileUpload: true,
  thinking: true,
  showTaskQueue: false,
  isStopping: false,
})

const emit = defineEmits<{
  (e: 'submit', data: AiPromptSubmitData): void
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
  (e: 'back'): void
  (e: 'stop'): void
  (e: 'update:thinking', value: boolean): void
  (e: 'update:panelMode', value: PanelMode): void
}>()

const slots = useSlots()
const attrs = useAttrs()

// 消息解析（用于 #message-list slot 和 AiMessageList）
// 传 isInterrupted，parser 会把未完成工具标记为 input-paused，避免"运行中"假象
// 第三参 extraToolCalls：合成工具卡片（如"生成结果摘要"），按 parentMessageId 注入
const { parsedMessages } = useMessageParser(
  computed(() => props.messages),
  computed(() => props.isInterrupted),
  computed(() => props.extraToolCalls),
)

// 面板逻辑
const hasRightSlot = computed(() => !!slots['right-panel'])
const hasBackListener = computed(() => !!attrs.onBack)

const effectivePanelMode = computed(() => {
  if (!hasRightSlot.value) return 'left'
  return props.panelMode
})

const showLeftPanel = computed(() =>
  effectivePanelMode.value === 'left' || effectivePanelMode.value === 'both',
)
const showRightPanel = computed(() =>
  effectivePanelMode.value === 'right' || effectivePanelMode.value === 'both',
)
const showBothPanels = computed(() => showLeftPanel.value && showRightPanel.value)

const leftSize = computed(() =>
  effectivePanelMode.value === 'both' ? props.defaultLeftSize : 100,
)
const rightSize = computed(() =>
  effectivePanelMode.value === 'both' ? 100 - props.defaultLeftSize : 100,
)

function toggleLeftPanel() {
  const next = effectivePanelMode.value === 'both' ? 'right' : 'both'
  emit('update:panelMode', next)
}

function toggleRightPanel() {
  const next = effectivePanelMode.value === 'both' ? 'left' : 'both'
  emit('update:panelMode', next)
}

function handleSubmit(data: AiPromptSubmitData) {
  emit('submit', data)
}

// 暴露 promptInput 的 reset 方法，供父组件在入队成功后清空输入框
// addFiles / selectedFileIds 用于外部材料选择弹框与输入框联动（见 AiPromptInput defineExpose）
interface PromptInputExposed {
  reset: () => void
  addFiles: (files: unknown[]) => void
  readonly selectedFileIds: number[]
}
const promptInputRef = ref<PromptInputExposed | null>(null)

defineExpose({
  resetPrompt() {
    promptInputRef.value?.reset()
  },
  addFiles(files: unknown[]) {
    promptInputRef.value?.addFiles(files)
  },
  get selectedFileIds(): number[] {
    return promptInputRef.value?.selectedFileIds ?? []
  },
})
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- Header -->
    <div v-if="showHeader" class="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/30 px-4">
      <Button v-if="hasBackListener" variant="ghost" size="icon" class="size-8" @click="emit('back')">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <div class="flex-1 truncate text-base font-semibold">{{ title }}</div>

      <!-- 面板切换按钮 -->
      <template v-if="hasRightSlot">
        <Button variant="ghost" size="icon" class="size-8" :class="{ 'bg-muted': !showLeftPanel }"
          @click="toggleLeftPanel">
          <PanelLeftIcon class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" class="size-8" :class="{ 'bg-muted': !showRightPanel }"
          @click="toggleRightPanel">
          <PanelRightIcon class="size-4" />
        </Button>
      </template>

      <!-- Header actions slot -->
      <slot name="header-actions" />
    </div>

    <!-- 双面板模式 -->
    <ResizablePanelGroup v-if="showBothPanels" direction="horizontal" class="flex-1 min-h-0">
      <ResizablePanel :default-size="leftSize" :min-size="minPanelSize" class="bg-muted/20">
        <div class="flex flex-col h-full overflow-hidden">
          <div class="flex-1 min-h-0">
            <ClientOnly>
              <slot v-if="$slots['message-list']" name="message-list" :messages="parsedMessages" :loading="loading" />
              <AiMessageList v-else :messages="parsedMessages" :loading="loading" :tool-map="toolMap"
                @tool-confirm="(d) => emit('tool-confirm', d)" @tool-reject="(d) => emit('tool-reject', d)">
                <template #empty>
                  <slot name="empty" />
                </template>
              </AiMessageList>
              <template #fallback>
                <div class="flex size-full items-center justify-center">
                  <LoaderIcon class="size-6 animate-spin text-muted-foreground" />
                </div>
              </template>
            </ClientOnly>
          </div>
          <AiTaskQueue v-if="showTaskQueue && todos?.length" :todos="todos" />
          <div v-if="showPrompt" class="shrink-0 flex flex-col min-h-0">
            <slot name="prompt-actions" />
            <AiPromptInput ref="promptInputRef" :loading="loading" :disabled="promptDisabled" :placeholder="promptPlaceholder"
              :enable-file-upload="enableFileUpload" :show-thinking-toggle="showThinkingToggle" :thinking="thinking"
              :queue-length="queueLength" :queue-full="queueFull" :is-stopping="isStopping" :is-interrupted="isInterrupted"
              :on-file-button-click="onFileButtonClick"
              @submit="handleSubmit" @stop="emit('stop')" @update:thinking="(v) => emit('update:thinking', v)" />
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle with-handle />

      <ResizablePanel :default-size="rightSize" :min-size="minPanelSize">
        <slot name="right-panel" />
      </ResizablePanel>
    </ResizablePanelGroup>

    <!-- 仅左侧面板 -->
    <div v-else-if="showLeftPanel" class="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div class="flex flex-col h-full overflow-hidden">
        <div class="flex-1 min-h-0">
          <ClientOnly>
            <slot v-if="$slots['message-list']" name="message-list" :messages="parsedMessages" :loading="loading" />
            <AiMessageList v-else :messages="parsedMessages" :loading="loading" :tool-map="toolMap"
              @tool-confirm="(d) => emit('tool-confirm', d)" @tool-reject="(d) => emit('tool-reject', d)">
              <template #empty>
                <slot name="empty" />
              </template>
            </AiMessageList>
            <template #fallback>
              <div class="flex size-full items-center justify-center">
                <LoaderIcon class="size-6 animate-spin text-muted-foreground" />
              </div>
            </template>
          </ClientOnly>
        </div>
        <AiTaskQueue v-if="showTaskQueue && todos?.length" :todos="todos" />
        <div v-if="showPrompt" class="shrink-0 flex flex-col min-h-0">
          <slot name="prompt-actions" />
          <!-- 注意：仅左侧面板路径也需要 @stop，否则停止按钮事件无法冒泡到父组件 -->
          <AiPromptInput ref="promptInputRef" :loading="loading" :disabled="promptDisabled" :placeholder="promptPlaceholder"
            :enable-file-upload="enableFileUpload" :show-thinking-toggle="showThinkingToggle" :thinking="thinking"
            :queue-length="queueLength" :queue-full="queueFull" :is-stopping="isStopping" :is-interrupted="isInterrupted"
            :on-file-button-click="onFileButtonClick"
            @submit="handleSubmit" @stop="emit('stop')" @update:thinking="(v) => emit('update:thinking', v)" />
        </div>
      </div>
    </div>

    <!-- 仅右侧面板 -->
    <div v-else-if="showRightPanel" class="h-full">
      <slot name="right-panel" />
    </div>
  </div>
</template>
