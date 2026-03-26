<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowLeftIcon, PanelLeftIcon, PanelRightIcon } from 'lucide-vue-next'
import type { TodoItem } from './composables/useTaskQueueParser'
import type { AiPromptSubmitData } from './AiPromptInput.vue'
import { useMessageParser } from './composables/useMessageParser'

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
  // 输入框
  showPrompt?: boolean
  promptPlaceholder?: string
  promptDisabled?: boolean
  showThinkingToggle?: boolean
  enableFileUpload?: boolean
  thinking?: boolean
  // 工具
  toolMap?: Record<string, Component>
  showToolInterrupt?: boolean
  // 任务队列
  showTaskQueue?: boolean
  todos?: readonly TodoItem[]
}

const props = withDefaults(defineProps<Props>(), {
  title: 'AI 对话',
  showHeader: true,
  panelMode: 'both',
  defaultLeftSize: 50,
  minPanelSize: 30,
  loading: false,
  showPrompt: true,
  promptPlaceholder: '输入消息...',
  promptDisabled: false,
  showThinkingToggle: true,
  enableFileUpload: true,
  thinking: true,
  showToolInterrupt: true,
  showTaskQueue: false,
})

const emit = defineEmits<{
  (e: 'submit', data: AiPromptSubmitData): void
  (e: 'tool-confirm', data: { toolCallId: string; data: any }): void
  (e: 'tool-reject', data: { toolCallId: string }): void
  (e: 'back'): void
  (e: 'update:thinking', value: boolean): void
  (e: 'update:panelMode', value: PanelMode): void
}>()

const slots = useSlots()
const attrs = useAttrs()

// 消息解析
const messagesRef = ref(props.messages)
watch(() => props.messages, (v) => { messagesRef.value = v })
const { parsedMessages } = useMessageParser(messagesRef)

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

    <!-- Main content: 双面板模式 -->
    <ResizablePanelGroup v-if="showLeftPanel && showRightPanel" direction="horizontal" class="min-h-0 flex-1">
      <ResizablePanel :default-size="leftSize" :min-size="minPanelSize" class="bg-muted/20">
        <KeepAlive>
          <div key="left-panel" class="flex h-full flex-col">
            <slot v-if="$slots['message-list']" name="message-list" :messages="parsedMessages" :loading="loading" />
            <AiMessageList v-else :messages="parsedMessages" :loading="loading" :tool-map="toolMap"
              :show-tool-interrupt="showToolInterrupt" @tool-confirm="(d) => emit('tool-confirm', d)"
              @tool-reject="(d) => emit('tool-reject', d)">
              <template #empty>
                <slot name="empty" />
              </template>
            </AiMessageList>

            <AiTaskQueue v-if="showTaskQueue && todos?.length" :todos="todos" />

            <div v-if="showPrompt" class="shrink-0 border-t">
              <slot name="prompt-actions" />
              <AiPromptInput :loading="loading" :disabled="promptDisabled" :placeholder="promptPlaceholder"
                :enable-file-upload="enableFileUpload" :show-thinking-toggle="showThinkingToggle" :thinking="thinking"
                @submit="handleSubmit" @update:thinking="(v) => emit('update:thinking', v)" />
            </div>
          </div>
        </KeepAlive>
      </ResizablePanel>

      <ResizableHandle with-handle />

      <ResizablePanel :default-size="rightSize" :min-size="minPanelSize">
        <KeepAlive>
          <slot name="right-panel" />
        </KeepAlive>
      </ResizablePanel>
    </ResizablePanelGroup>

    <!-- 单面板模式 -->
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <!-- 左侧面板 -->
      <KeepAlive v-if="showLeftPanel">
        <div key="left-panel-single" class="flex h-full flex-col">
          <slot v-if="$slots['message-list']" name="message-list" :messages="parsedMessages" :loading="loading" />
          <AiMessageList v-else :messages="parsedMessages" :loading="loading" :tool-map="toolMap"
            :show-tool-interrupt="showToolInterrupt" @tool-confirm="(d) => emit('tool-confirm', d)"
            @tool-reject="(d) => emit('tool-reject', d)">
            <template #empty>
              <slot name="empty" />
            </template>
          </AiMessageList>

          <AiTaskQueue v-if="showTaskQueue && todos?.length" :todos="todos" />

          <div v-if="showPrompt" class="shrink-0 border-t">
            <slot name="prompt-actions" />
            <AiPromptInput :loading="loading" :disabled="promptDisabled" :placeholder="promptPlaceholder"
              :enable-file-upload="enableFileUpload" :show-thinking-toggle="showThinkingToggle" :thinking="thinking"
              @submit="handleSubmit" @update:thinking="(v) => emit('update:thinking', v)" />
          </div>
        </div>
      </KeepAlive>

      <!-- 右侧面板 -->
      <KeepAlive v-else-if="showRightPanel">
        <div key="right-panel-single" class="h-full">
          <slot name="right-panel" />
        </div>
      </KeepAlive>
    </div>
  </div>
</template>
