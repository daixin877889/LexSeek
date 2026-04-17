<script setup lang="ts">
/**
 * 法律助手 · 对话页（路由 /dashboard/assistant）
 *
 * 布局：左 AssistantSessionList + 右 AssistantChatPanel。
 *
 * - URL `?sid=<sessionId>` 与当前选中会话双向同步（router.replace 不入栈）
 * - 子组件 AssistantChatPanel 通过 `:key="sessionId"` 强制在会话切换时 remount，
 *   重建 useAssistantChat / useStreamChat（底层 threadId 在初始化时捕获）
 * - 根容器高度用 `calc(100vh - 3rem)`（减 dashboardLayout header h-12），
 *   避免父容器高度传递不齐导致内容挤顶
 *
 * 参见 spec §8.1, §8.2。
 */
import { MessageSquareIcon, SparklesIcon } from 'lucide-vue-next'
import type { LocationQueryRaw } from 'vue-router'

definePageMeta({
    layout: 'dashboard-layout',
    title: '法律助手',
    icon: 'MessageSquare',
})

const route = useRoute()
const router = useRouter()

const initialSid = typeof route.query.sid === 'string' ? route.query.sid : null
const sessionId = ref<string | null>(initialSid)

watch(sessionId, (sid) => {
    const nextQuery: LocationQueryRaw = { ...route.query }
    if (sid) nextQuery.sid = sid
    else delete nextQuery.sid
    router.replace({ query: nextQuery })
})

/** 空状态"开始新对话"按钮：委托侧栏组件创建新会话 */
const sessionListRef = ref<{ createSession: () => Promise<void> } | null>(null)
function startNewConversation() {
    sessionListRef.value?.createSession()
}
</script>

<template>
    <div class="flex flex-1 min-h-0 overflow-hidden bg-background">
        <AssistantSessionList
            ref="sessionListRef"
            v-model:selected-id="sessionId"
            class="w-64 shrink-0"
        />

        <div class="flex-1 flex flex-col min-w-0 min-h-0">
            <!-- 空状态：垂直居中 + 开始新对话按钮 -->
            <div
                v-if="!sessionId"
                class="flex-1 flex items-center justify-center px-6"
            >
                <div class="flex flex-col items-center gap-6 max-w-md text-center">
                    <div class="size-20 rounded-full bg-primary/10 flex items-center justify-center">
                        <MessageSquareIcon class="size-10 text-primary" />
                    </div>
                    <div class="space-y-2">
                        <h2 class="text-2xl font-semibold text-foreground">
                            法律助手对话
                        </h2>
                        <p class="text-sm text-muted-foreground leading-relaxed">
                            遇到法律问题、需要起草思路、想快速查询法条？<br>
                            开启一轮无需创建案件的轻量对话。
                        </p>
                    </div>
                    <Button
                        size="lg"
                        class="gap-2"
                        @click="startNewConversation"
                    >
                        <SparklesIcon class="size-4" />
                        开始新对话
                    </Button>
                </div>
            </div>

            <!-- 会话面板：通过 key 强制 remount -->
            <AssistantChatPanel
                v-else
                :key="sessionId"
                :session-id="sessionId"
                class="flex-1 min-h-0"
            />
        </div>
    </div>
</template>
