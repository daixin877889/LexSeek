<script setup lang="ts">
/**
 * 通用问答 · 对话页（路由 /dashboard/assistant）
 *
 * 布局：左 AssistantSessionList + 右对话卡片（会话顶栏 + AssistantChatPanel）。
 *
 * - URL `?sid=<sessionId>` 与当前选中会话双向同步（router.replace 不入栈）
 * - 子组件 AssistantChatPanel 通过 `:key="sessionId"` 强制在会话切换时 remount，
 *   重建 useAssistantChat / useStreamChat（底层 threadId 在初始化时捕获）
 * - 会话顶栏的标题/创建时间取自 AssistantSessionList 暴露的 sessions；
 *   重命名 / 删除委托其 renameSession / removeSession
 *
 * 参见 spec §8.1, §8.2。
 */
import { SparklesIcon, ClockIcon, PencilIcon, Trash2Icon, CheckIcon, XIcon, MenuIcon } from 'lucide-vue-next'
import type { LocationQueryRaw } from 'vue-router'
import type { AssistantSession } from '#shared/types/assistant'
import AssistantChatPanel from '~/components/assistant/AssistantChatPanel.vue'
import AssistantSessionList from '~/components/assistant/AssistantSessionList.vue'
import IconXiaosuoIcon from '~/components/icon/XiaosuoIcon.vue'
import { useFormatters } from '~/composables/useFormatters'

definePageMeta({
    layout: 'dashboard-layout',
    title: '通用问答',
    icon: 'MessageSquare',
})

const route = useRoute()
const router = useRouter()
const { formatDate } = useFormatters()

const initialSid = typeof route.query.sid === 'string' ? route.query.sid : null
const sessionId = ref<string | null>(initialSid)

/* 会话顶栏标题内联编辑态（切换会话时复位） */
const editingTitle = ref(false)
const titleDraft = ref('')

/* 移动端会话列表抽屉开关 */
const drawerOpen = ref(false)

watch(sessionId, (sid) => {
    editingTitle.value = false
    drawerOpen.value = false
    const nextQuery: LocationQueryRaw = { ...route.query }
    if (sid) nextQuery.sid = sid
    else delete nextQuery.sid
    router.replace({ query: nextQuery })
})

const sessionListRef = ref<{
    createSession: () => Promise<void>
    refresh: () => Promise<void>
    sessions: AssistantSession[]
    renameSession: (sessionId: string, title: string) => Promise<boolean>
    removeSession: (session: AssistantSession) => void
} | null>(null)

/** 空状态"开始新对话"按钮：委托侧栏组件创建新会话 */
function startNewConversation() {
    sessionListRef.value?.createSession()
}

/**
 * run 完成后触发：worker 会在首轮对话完成后异步生成标题（spec §5.6.1），
 * 一般 ~1-2s 内落库。延迟 2.5s 再刷新侧栏列表以拿到新标题。
 */
function handleRunComplete() {
    setTimeout(() => {
        sessionListRef.value?.refresh()
    }, 2500)
}

/** 当前选中会话（用于会话顶栏展示标题 / 创建时间） */
const activeSession = computed<AssistantSession | null>(() => {
    if (!sessionId.value) return null
    return sessionListRef.value?.sessions?.find(s => s.sessionId === sessionId.value) ?? null
})

/* ── 会话顶栏：标题内联编辑 ──────────────────────────────── */
function startEditTitle() {
    titleDraft.value = activeSession.value?.title ?? ''
    editingTitle.value = true
}
function cancelEditTitle() {
    editingTitle.value = false
    titleDraft.value = ''
}
async function confirmEditTitle() {
    const sid = sessionId.value
    if (!sid) return
    const ok = await sessionListRef.value?.renameSession(sid, titleDraft.value)
    editingTitle.value = false
    if (ok) titleDraft.value = ''
}
function deleteActiveSession() {
    if (activeSession.value) sessionListRef.value?.removeSession(activeSession.value)
}
</script>

<template>
    <div class="relative isolate flex flex-1 min-h-0 gap-4 overflow-hidden p-3 sm:p-4">
        <!-- 移动端抽屉遮罩 -->
        <div
            v-if="drawerOpen"
            class="absolute inset-0 z-20 bg-black/40 lg:hidden"
            @click="drawerOpen = false"
        />

        <!-- 会话侧栏：桌面内联停靠，移动端为左侧抽屉 -->
        <div
            :class="[
                'shrink-0 absolute inset-y-3 left-3 z-30 w-72 max-w-[82vw] transition-transform duration-300 ease-out',
                'lg:static lg:z-auto lg:w-62 lg:max-w-none lg:translate-x-0 lg:transition-none',
                drawerOpen ? 'translate-x-0' : '-translate-x-[120%] lg:translate-x-0',
            ]"
        >
            <AssistantSessionList
                ref="sessionListRef"
                v-model:selected-id="sessionId"
                class="h-full"
                @select="drawerOpen = false"
            />
        </div>

        <!-- 对话卡片 -->
        <div class="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden rounded-xl border border-border bg-card">
            <template v-if="sessionId">
                <!-- 会话顶栏 -->
                <header class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3 lg:gap-3 lg:px-5">
                    <!-- 移动端：打开会话列表抽屉 -->
                    <button
                        type="button"
                        class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
                        title="会话列表"
                        @click="drawerOpen = true"
                    >
                        <MenuIcon class="size-5" />
                    </button>
                    <div class="flex min-w-0 flex-1 items-center gap-3">
                        <!-- 小索头像 -->
                        <div class="size-9 shrink-0 rounded-full bg-gradient-brand p-[2px]">
                            <div class="flex size-full items-center justify-center overflow-hidden rounded-full bg-card">
                                <IconXiaosuoIcon class="size-6" />
                            </div>
                        </div>

                        <!-- 标题 + 创建时间 -->
                        <div v-if="!editingTitle" class="min-w-0">
                            <h2 class="truncate text-[15px] font-semibold leading-tight">
                                {{ activeSession?.title ?? '未命名对话' }}
                            </h2>
                            <p class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                                <ClockIcon class="size-3 shrink-0" />
                                <span v-if="activeSession">创建于 {{ formatDate(activeSession.createdAt, 'YYYY-MM-DD HH:mm') }}</span>
                            </p>
                        </div>

                        <!-- 标题内联编辑 -->
                        <div v-else class="flex min-w-0 flex-1 items-center gap-1.5">
                            <input
                                v-model="titleDraft"
                                autofocus
                                maxlength="200"
                                aria-label="会话标题"
                                class="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                                @keyup.enter="confirmEditTitle"
                                @keyup.escape="cancelEditTitle"
                            >
                            <button
                                type="button"
                                class="flex size-7 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                                title="确认"
                                @click="confirmEditTitle"
                            >
                                <CheckIcon class="size-4" />
                            </button>
                            <button
                                type="button"
                                class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                                title="取消"
                                @click="cancelEditTitle"
                            >
                                <XIcon class="size-4" />
                            </button>
                        </div>
                    </div>

                    <!-- 操作按钮 -->
                    <div v-if="!editingTitle" class="flex shrink-0 items-center gap-0.5">
                        <button
                            type="button"
                            class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            title="编辑标题"
                            @click="startEditTitle"
                        >
                            <PencilIcon class="size-4" />
                        </button>
                        <button
                            type="button"
                            class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            title="删除会话"
                            @click="deleteActiveSession"
                        >
                            <Trash2Icon class="size-4" />
                        </button>
                    </div>
                </header>

                <!-- 会话面板：通过 key 强制 remount -->
                <AssistantChatPanel
                    :key="sessionId"
                    :session-id="sessionId"
                    class="flex-1 min-h-0"
                    @run-complete="handleRunComplete"
                />
            </template>

            <!-- 空状态：小索吉祥物 + 开始新对话 -->
            <div v-else class="flex flex-1 flex-col min-h-0">
                <!-- 移动端：打开会话列表抽屉 -->
                <div class="flex shrink-0 items-center border-b border-border px-3 py-2.5 lg:hidden">
                    <button
                        type="button"
                        class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="会话列表"
                        @click="drawerOpen = true"
                    >
                        <MenuIcon class="size-5" />
                    </button>
                </div>
                <div class="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
                    <div class="flex max-w-[480px] flex-col items-center text-center">
                        <IconXiaosuoIcon class="xiaosuo-mascot mb-[18px] size-26" />
                        <h2 class="mb-2 text-[22px] font-semibold text-foreground">
                            通用问答对话
                        </h2>
                        <p class="mb-6 text-[13.5px] leading-[1.75] text-muted-foreground">
                            遇到法律问题、需要起草思路、想快速查询法条？<br>
                            开启一轮无需创建案件的轻量对话。
                        </p>
                        <Button
                            size="lg"
                            class="gap-2 bg-gradient-brand-button text-white shadow-[0_10px_22px_-10px_rgba(30,158,237,0.5)]"
                            @click="startNewConversation"
                        >
                            <SparklesIcon class="size-4" />
                            开始新对话
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 小索吉祥物：悬浮 + hover 摇摆（关键帧定义见 tailwind.css） */
.xiaosuo-mascot {
    animation: xiaosuoFloat 3.2s ease-in-out infinite;
    transition: scale 0.3s ease;
}
.xiaosuo-mascot:hover {
    scale: 1.08;
    animation: xiaosuoWiggle 0.8s ease-in-out;
}
</style>
