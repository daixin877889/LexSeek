<script setup lang="ts">
/**
 * 法律助手 · 对话页
 *
 * 布局：左 AssistantSessionList + 右 AssistantChatPanel。
 *
 * 关键设计：
 * - URL `?sid=<sessionId>` 与当前选中会话双向同步（router.replace，不入栈）。
 * - 子组件 AssistantChatPanel 通过 `:key="sessionId"` 强制在会话切换时 remount，
 *   从而重建 useAssistantChat / useStreamChat（底层 threadId 在初始化时捕获）。
 *
 * 参见 spec §8.1, §8.2。
 */
import { MessageSquareIcon } from 'lucide-vue-next'
import type { LocationQueryRaw } from 'vue-router'

definePageMeta({
  layout: 'dashboard-layout',
  title: '法律助手 · 对话',
  icon: 'MessageSquare',
})

const route = useRoute()
const router = useRouter()

// 初始化：仅接受 string（数组/undefined 均视为空）
const initialSid = typeof route.query.sid === 'string' ? route.query.sid : null
const sessionId = ref<string | null>(initialSid)

// sessionId → URL：replace 避免污染浏览器历史
watch(sessionId, (sid) => {
  const nextQuery: LocationQueryRaw = { ...route.query }
  if (sid) nextQuery.sid = sid
  else delete nextQuery.sid
  router.replace({ query: nextQuery })
})
</script>

<template>
  <div class="flex h-[calc(100vh-4rem)]">
    <AssistantSessionList v-model:selected-id="sessionId" class="w-64 shrink-0" />

    <div class="flex-1 flex flex-col min-w-0">
      <div
        v-if="!sessionId"
        class="flex-1 flex flex-col items-center justify-center text-muted-foreground"
      >
        <MessageSquareIcon class="size-16 mb-4 opacity-50" />
        <p class="text-lg">选择左侧会话或点击「新对话」开始</p>
      </div>

      <!-- 用 sessionId 作 key 强制 remount，重建 useAssistantChat 实例 -->
      <AssistantChatPanel
        v-else
        :key="sessionId"
        :session-id="sessionId"
        class="flex-1 min-h-0"
      />
    </div>
  </div>
</template>
