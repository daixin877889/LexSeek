<template>
  <div class="flex flex-col" style="height: calc(100vh - 48px)">
    <!-- 阶段一：模块选择 -->
    <InitAnalysisModuleSelector
      v-if="phase === 'select'"
      v-model="selectedModules"
      @start="startAnalysis"
      @skip="navigateTo(`/dashboard/cases/${caseId}`)"
    />

    <!-- 阶段二/三：分析进度（直接复用 analysis 页面的消息渲染模式） -->
    <template v-else>
      <!-- Pipeline Progress Bar -->
      <InitAnalysisPipelineProgress
        :modules="activeModules"
        :module-states="moduleStates"
        class="shrink-0"
      />

      <!-- 消息流（与 analysis/[sessionId].vue 完全一致的渲染方式） -->
      <div class="flex-1 min-h-0">
        <ClientOnly>
          <AiElementsConversation class="h-full">
            <AiElementsConversationContent>
              <!-- 空状态 -->
              <AiElementsConversationEmptyState
                v-if="displayMessages.length === 0 && !isLoading"
                title="初始化分析"
                description="选择模块并开始分析，分析过程将实时展示"
              />

              <!-- 积分不足中断卡片（顶部显示） -->
              <InitAnalysisInsufficientPointsCard
                v-if="interruptData"
                :is-member="interruptData.data?.isMember ?? false"
                :available-points="interruptData.data?.availablePoints"
                :required-points="interruptData.data?.requiredPoints"
                :reason="interruptData.data?.reason"
                @resume="resumeWorkflow"
              />

              <!-- 消息列表（与 analysis 页面完全一致） -->
              <template v-for="(message, msgIndex) in displayMessages" :key="message.id ?? msgIndex">
                <!-- 用户消息 -->
                <AiElementsMessage v-if="HumanMessage.isInstance(message)" from="user" class="max-w-full">
                  <AiElementsMessageContent>
                    {{ message.text }}
                  </AiElementsMessageContent>
                </AiElementsMessage>

                <!-- AI 消息 -->
                <AiElementsMessage v-else-if="AIMessage.isInstance(message)" from="assistant" class="max-w-full">
                  <AiElementsMessageContent>
                    <!-- 推理内容 -->
                    <AiElementsReasoning
                      v-if="getReasoningText(message)"
                      :is-streaming="isLoading && msgIndex === displayMessages.length - 1"
                    >
                      <AiElementsReasoningTrigger />
                      <AiElementsReasoningContent :content="getReasoningText(message)" />
                    </AiElementsReasoning>

                    <!-- 工具调用 -->
                    <CaseAnalysisToolsToolRenderer
                      v-for="tc in getToolCallsForMessage(message)"
                      :key="tc.call.id"
                      :tool-name="tc.call.name"
                      :input="tc.call.args"
                      :output="tc.result?.content"
                      :state="tc.state"
                    />

                    <!-- 文本内容 -->
                    <AiElementsMessageResponse v-if="message.text" :content="message.text" />
                  </AiElementsMessageContent>
                </AiElementsMessage>
              </template>

              <!-- 完成后操作 -->
              <div v-if="phase === 'complete'" class="flex justify-center py-8">
                <Button size="lg" @click="navigateTo(`/dashboard/cases/${caseId}`)">
                  进入案件详情
                </Button>
              </div>
            </AiElementsConversationContent>
            <AiElementsConversationScrollButton />
          </AiElementsConversation>

          <template #fallback>
            <div class="flex size-full items-center justify-center">
              <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
            </div>
          </template>
        </ClientOnly>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon } from 'lucide-vue-next'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

definePageMeta({
  title: '初始化分析',
  layout: 'dashboard-layout',
})

const route = useRoute()
const sessionId = computed(() => route.params.sessionId as string)

const {
  phase,
  caseId,
  selectedModules,
  moduleStates,
  activeModules,
  isLoading,
  interrupt,
  displayMessages,
  getModuleState,
  loadStatus,
  startAnalysis,
  resumeWorkflow,
  retryModule,
} = useInitAnalysis(sessionId)

// ==================== 消息处理（从 analysis/[sessionId].vue 复制） ====================

/** 提取 AIMessage 中的推理文本 */
function getReasoningText(message: any): string {
  if ('contentBlocks' in message) {
    return message.contentBlocks
      .filter((b: any) => b.type === 'reasoning')
      .map((b: any) => b.reasoning)
      .join('')
  }
  const content = message.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b.type === 'thinking')
    .map((b: any) => b.thinking)
    .join('')
}

/** LangChain tool state → AI Elements ToolUIPart state */
type ToolState = 'input-available' | 'output-available' | 'output-error'

interface ToolCallWithResult {
  call: { id: string; name: string; args: Record<string, unknown> }
  result: any
  state: ToolState
}

// 预计算 ToolMessage 索引
const toolResultsMap = computed(() => {
  const map = new Map<string, any>()
  for (const msg of displayMessages.value) {
    if (ToolMessage.isInstance(msg)) {
      map.set((msg as any).tool_call_id, msg)
    }
  }
  return map
})

function getToolCallsForMessage(message: any): ToolCallWithResult[] {
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

// LangGraph interrupt 数据
const interruptData = computed(() => {
  const raw = interrupt.value
  if (!raw) return null
  const first = Array.isArray(raw) ? raw[0] : raw
  const val = first?.value ?? first
  if (val?.type === 'insufficient_points') return val
  return null
})

onMounted(() => {
  loadStatus()
})
</script>
