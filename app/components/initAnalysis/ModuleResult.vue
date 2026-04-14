<template>
  <!-- 只渲染非 idle 状态的模块 -->
  <div v-if="state.status !== 'idle'" :id="`module-${module.name}`" class="scroll-mt-20">
    <!-- 模块标题行 -->
    <div class="flex items-center gap-3 mb-3">
      <component :is="getModuleIcon(module.icon)" class="size-5 text-muted-foreground" />
      <h3 class="text-base font-semibold flex-1">{{ module.title }}</h3>
      <Badge :variant="badgeVariant">{{ statusText }}</Badge>
    </div>

    <!-- 消息流：复用 ai-elements 消息组件，与 analysis/[sessionId] 一致 -->
    <div class="pl-8 space-y-3">
      <!-- 有消息列表时：完整渲染推理 + 工具调用 + 文本 -->
      <template v-if="messages.length > 0">
        <template v-for="(message, msgIndex) in messages" :key="msgIndex">
          <AiElementsMessage
            v-if="isAIMessage(message)"
            from="assistant"
            class="max-w-full"
          >
            <AiElementsMessageContent>
              <!-- 推理内容 -->
              <AiElementsReasoning
                v-if="getReasoningText(message)"
                :is-streaming="state.status === 'streaming' && msgIndex === messages.length - 1"
              >
                <AiElementsReasoningTrigger />
                <AiElementsReasoningContent
                  :content="getReasoningText(message)"
                />
              </AiElementsReasoning>

              <!-- 工具调用 -->
              <AiToolRenderer
                v-for="tc in getToolCallsForMessage(message)"
                :key="tc.call.id"
                :tool-call="{
                  id: tc.call.id,
                  name: tc.call.name,
                  args: tc.call.args,
                  result: tc.result?.content,
                  state: tc.state,
                }"
              />

              <!-- 文本内容 -->
              <AiElementsMessageResponse
                v-if="getMessageText(message)"
                :content="getMessageText(message)"
              />
            </AiElementsMessageContent>
          </AiElementsMessage>
        </template>

        <!-- 流式脉动指示器 -->
        <div v-if="state.status === 'streaming'" class="flex items-center gap-2 pl-2">
          <span class="inline-block size-2 rounded-full bg-primary animate-pulse" />
          <span class="text-xs text-muted-foreground">正在分析...</span>
        </div>
      </template>

      <!-- 没有消息时的 fallback：使用 content 字段渲染（页面刷新恢复场景） -->
      <div v-else-if="state.content" class="prose prose-sm max-w-none dark:prose-invert">
        <AiElementsMessageResponse :content="state.content" mode="static" />
      </div>

      <!-- 失败 -->
      <div v-if="state.status === 'failed'" class="space-y-3">
        <Alert variant="destructive">
          <AlertDescription>{{ state.error || '模块执行失败' }}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" @click="emit('retry', module.name)">
          <RefreshCwIcon class="size-3.5 mr-1.5" />
          重试
        </Button>
      </div>
    </div>

    <!-- 分隔线 -->
    <Separator class="mt-6" />
  </div>
</template>

<script lang="ts" setup>
import { RefreshCwIcon } from 'lucide-vue-next'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import type { AIMessage as AIMessageType } from '@langchain/core/messages'
import { getModuleIcon } from '~/utils/moduleIcons'
import { extractThinking } from '~/components/ai/composables/useMessageParser'
import type { InitAnalysisModule, ModuleRunState } from '#shared/types/initAnalysis'

const props = defineProps<{
  module: InitAnalysisModule
  state: ModuleRunState
  /** 该模块的消息列表（从 useInitAnalysis.getModuleMessageList 获取） */
  messages: any[]
}>()

const emit = defineEmits<{
  retry: [moduleName: string]
}>()

// ==================== 消息处理（复用 analysis/[sessionId].vue 的模式） ====================

function isAIMessage(msg: any): boolean {
  return AIMessage.isInstance(msg) || msg?.type === 'ai' || msg?.role === 'assistant'
}

/** 检索类工具：调用时不显示模型的推理/思考和文本内容 */
const SEARCH_TOOL_NAMES = new Set(['search_law', 'search_case_materials'])

/** 判断消息是否为纯检索工具调用 */
function isSearchOnlyMessage(message: any): boolean {
  const toolCalls = message.tool_calls ?? []
  return toolCalls.length > 0 && toolCalls.every((tc: any) => SEARCH_TOOL_NAMES.has(tc.name))
}

function getMessageText(message: any): string {
  // 检索类工具调用不显示文本内容
  if (isSearchOnlyMessage(message)) return ''
  if (message.text) return message.text
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('')
  }
  return ''
}

// 检索类工具调用不显示推理过程和文本内容
function getReasoningText(message: any): string {
  if (isSearchOnlyMessage(message)) return ''
  return extractThinking(message as AIMessageType, false) ?? ''
}

type ToolState = 'input-available' | 'output-available' | 'output-error'

const toolResultsMap = computed(() => {
  const map = new Map<string, any>()
  for (const msg of props.messages) {
    if (ToolMessage.isInstance(msg) || msg?.type === 'tool') {
      map.set(msg.tool_call_id, msg)
    }
  }
  return map
})

function getToolCallsForMessage(message: any) {
  const toolCalls = message.tool_calls ?? []
  if (toolCalls.length === 0) return []

  return toolCalls.map((tc: any) => {
    const result = toolResultsMap.value.get(tc.id ?? '')
    const hasError = result && result.status === 'error'
    return {
      call: { id: tc.id ?? '', name: tc.name, args: tc.args as Record<string, unknown> },
      result,
      state: (hasError ? 'output-error' : result ? 'output-available' : 'input-available') as ToolState,
    }
  })
}

// ==================== 状态文案 ====================

const statusText = computed(() => {
  switch (props.state.status) {
    case 'streaming': return '执行中'
    case 'complete': return '已完成'
    case 'failed': return '失败'
    default: return '等待中'
  }
})

const badgeVariant = computed<'default' | 'secondary' | 'destructive' | 'outline'>(() => {
  switch (props.state.status) {
    case 'streaming': return 'default'
    case 'complete': return 'secondary'
    case 'failed': return 'destructive'
    default: return 'outline'
  }
})
</script>
