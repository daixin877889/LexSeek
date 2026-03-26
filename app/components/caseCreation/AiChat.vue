<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- 对话消息列表 -->
    <div class="flex-1 min-h-0">
      <ClientOnly>
        <AiElementsConversation class="h-full">
          <AiElementsConversationContent>
            <!-- 空状态 -->
            <AiElementsConversationEmptyState
              v-if="messages.length === 0 && !isLoading"
              title="AI 智能创建案件"
              description="描述您的案件情况或上传案件材料，AI 将自动提取关键信息"
            />

            <!-- 消息列表 -->
            <template v-for="(msg, index) in messages" :key="msg.id">
              <!-- 用户消息 -->
              <AiElementsMessage v-if="msg.role === 'user'" from="user" class="max-w-full">
                <AiElementsMessageContent>
                  {{ msg.content }}
                  <!-- 材料附件提示 -->
                  <div v-if="msg.materials && msg.materials.length > 0" class="mt-2 flex flex-wrap gap-1.5">
                    <Badge v-for="m in msg.materials" :key="m.ossFileId" variant="outline" class="text-xs">
                      <PaperclipIcon class="size-3 mr-1" />
                      {{ m.name }}
                    </Badge>
                  </div>
                </AiElementsMessageContent>
              </AiElementsMessage>

              <!-- AI 消息 -->
              <AiElementsMessage v-else from="assistant" class="max-w-full">
                <AiElementsMessageContent>
                  <AiElementsMessageResponse v-if="msg.content" :content="msg.content" />

                  <!-- 提取结果卡片 -->
                  <CaseCreationExtractedInfoCard
                    v-if="msg.extractedInfo"
                    :extracted-info="msg.extractedInfo"
                    :case-types="caseTypes"
                    :is-submitting="isSubmitting"
                    @confirm="emit('confirm', $event)"
                  />
                </AiElementsMessageContent>
              </AiElementsMessage>
            </template>

            <!-- 加载状态 -->
            <AiElementsMessage v-if="isLoading" from="assistant" class="max-w-full">
              <AiElementsMessageContent>
                <div class="flex items-center gap-2 text-muted-foreground">
                  <Loader2Icon class="size-4 animate-spin" />
                  <span class="text-sm">AI 正在分析中...</span>
                </div>
              </AiElementsMessageContent>
            </AiElementsMessage>
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

    <!-- 底部输入区域 -->
    <div class="shrink-0 border-t bg-background">
      <CaseAnalysisPromptInput
        ref="promptInputRef"
        v-model:thinking="thinkingEnabled"
        placeholder="描述您的案件情况，或上传案件材料..."
        submit-label="提取信息"
        :loading="isLoading"
        :disabled="isLoading"
        :enable-watcher="false"
        :min-rows="2"
        :max-rows="6"
        @submit="handlePromptSubmit"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Loader2Icon, PaperclipIcon } from 'lucide-vue-next'
import type { ExtractedCaseInfo, CaseTypeOption, PromptSubmitData, CaseMaterialParam } from '#shared/types/case'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  extractedInfo?: ExtractedCaseInfo
  materials?: CaseMaterialParam[]
}

defineProps<{
  caseTypes: CaseTypeOption[]
  isSubmitting: boolean
}>()

const emit = defineEmits<{
  confirm: [params: {
    caseTypeId: number
    title?: string
    plaintiff?: Array<{ name: string }>
    defendant?: Array<{ name: string }>
    content?: string
  }]
}>()

const messages = ref<ChatMessage[]>([])
const isLoading = ref(false)
const thinkingEnabled = ref(false)
const promptInputRef = ref<{ reset: () => void } | null>(null)
let messageCounter = 0

function nextMessageId(): string {
  return `msg_${++messageCounter}`
}

async function handlePromptSubmit(data: PromptSubmitData) {
  const text = data.text?.trim() || ''
  const materials = data.materials ?? []

  if (!text && materials.length === 0) return
  if (isLoading.value) return

  // 构建用户消息显示文本
  const displayText = text || `已上传 ${materials.length} 份材料`

  messages.value = [
    ...messages.value,
    {
      id: nextMessageId(),
      role: 'user',
      content: displayText,
      materials: materials.length > 0 ? materials : undefined,
    },
  ]

  promptInputRef.value?.reset()
  isLoading.value = true

  try {
    const body: Record<string, unknown> = { message: text }
    if (materials.length > 0) {
      body.materials = materials
    }

    const responseData = await useApiFetch<{
      message: string
      extractedInfo?: ExtractedCaseInfo
    }>('/api/v1/case/extract', {
      method: 'POST',
      body,
    })

    if (responseData) {
      messages.value = [
        ...messages.value,
        {
          id: nextMessageId(),
          role: 'assistant',
          content: responseData.message || '已为您提取案件信息，请确认以下内容：',
          extractedInfo: responseData.extractedInfo,
        },
      ]
    }
  }
  catch {
    messages.value = [
      ...messages.value,
      {
        id: nextMessageId(),
        role: 'assistant',
        content: '抱歉，提取信息时出现错误，请重试。',
      },
    ]
  }
  finally {
    isLoading.value = false
  }
}
</script>
