<template>
  <div class="flex flex-col h-[600px] max-w-2xl mx-auto">
    <!-- 消息列表 -->
    <Conversation class="flex-1 overflow-hidden">
      <ConversationContent class="p-4 space-y-4">
        <!-- 欢迎消息 -->
        <div v-if="messages.length === 0" class="flex gap-3">
          <div class="shrink-0 size-8 rounded-full bg-primary/10 flex items-center justify-center">
            <SparklesIcon class="size-4 text-primary" />
          </div>
          <div class="rounded-lg bg-muted px-4 py-3 text-sm">
            请描述您的案件情况，或直接上传案件材料，我来帮您提取关键信息。
          </div>
        </div>

        <!-- 消息列表 -->
        <template v-for="msg in messages" :key="msg.id">
          <!-- 用户消息 -->
          <div v-if="msg.role === 'user'" class="flex justify-end gap-3">
            <div class="rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm max-w-[80%]">
              {{ msg.content }}
            </div>
          </div>

          <!-- AI 消息 -->
          <div v-else class="flex gap-3">
            <div class="shrink-0 size-8 rounded-full bg-primary/10 flex items-center justify-center">
              <SparklesIcon class="size-4 text-primary" />
            </div>
            <div class="flex-1 space-y-3 min-w-0">
              <div class="rounded-lg bg-muted px-4 py-3 text-sm prose prose-sm max-w-none">
                <MessageResponse :content="msg.content" />
              </div>

              <!-- 提取结果卡片 -->
              <CaseCreationExtractedInfoCard
                v-if="msg.extractedInfo"
                :extracted-info="msg.extractedInfo"
                :case-types="caseTypes"
                :is-submitting="isSubmitting"
                @confirm="emit('confirm', $event)"
              />
            </div>
          </div>
        </template>

        <!-- 加载中 -->
        <div v-if="isLoading" class="flex gap-3">
          <div class="shrink-0 size-8 rounded-full bg-primary/10 flex items-center justify-center">
            <SparklesIcon class="size-4 text-primary" />
          </div>
          <div class="rounded-lg bg-muted px-4 py-3">
            <Loader2Icon class="size-4 animate-spin text-muted-foreground" />
          </div>
        </div>
      </ConversationContent>
    </Conversation>

    <!-- 输入区域 -->
    <div class="border-t p-4">
      <form class="flex gap-2" @submit.prevent="handleSend">
        <Input
          v-model="inputText"
          placeholder="描述您的案件情况..."
          class="flex-1"
          :disabled="isLoading"
          @keydown.enter.exact.prevent="handleSend"
        />
        <Button type="submit" :disabled="!inputText.trim() || isLoading" size="icon">
          <SendHorizontalIcon class="size-4" />
        </Button>
      </form>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { SparklesIcon, Loader2Icon, SendHorizontalIcon } from 'lucide-vue-next'
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation'
import { MessageResponse } from '@/components/ai-elements/message'
import type { ExtractedCaseInfo } from '#shared/types/case'
import type { CaseTypeOption } from '#shared/types/case'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  extractedInfo?: ExtractedCaseInfo
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
const inputText = ref('')
const isLoading = ref(false)
let messageCounter = 0

function nextMessageId(): string {
  return `msg_${++messageCounter}`
}

async function handleSend() {
  const text = inputText.value.trim()
  if (!text || isLoading.value) return

  messages.value = [...messages.value, { id: nextMessageId(), role: 'user', content: text }]
  inputText.value = ''
  isLoading.value = true

  try {
    const data = await useApiFetch<{
      message: string
      extractedInfo?: ExtractedCaseInfo
    }>('/api/v1/case/extract', {
      method: 'POST',
      body: { message: text },
    })

    if (data) {
      messages.value = [
        ...messages.value,
        {
          id: nextMessageId(),
          role: 'assistant',
          content: data.message || '已为您提取案件信息，请确认以下内容：',
          extractedInfo: data.extractedInfo,
        },
      ]
    }
  }
  catch {
    messages.value = [
      ...messages.value,
      { id: nextMessageId(), role: 'assistant', content: '抱歉，提取信息时出现错误，请重试。' },
    ]
  }
  finally {
    isLoading.value = false
  }
}
</script>
