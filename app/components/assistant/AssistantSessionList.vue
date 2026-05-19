<script setup lang="ts">
/**
 * 通用问答 · 会话列表
 *
 * 展示当前用户的 assistant 会话（scope=assistant），支持新建 / 选中
 * （v-model:selectedId）/ 本地搜索。重命名与删除由对话顶栏发起，
 * 本组件通过 defineExpose 暴露 renameSession / removeSession 供其调用。
 *
 * - 数据接口：/api/v1/assistant/sessions (GET/POST/PATCH/DELETE)
 * - useApiFetch 自动提取 data 字段，直接使用返回值
 * - 类型参见 #shared/types/assistant
 *
 * 参见 spec §8.3.2。
 */
import { PlusIcon, SearchIcon, ClockIcon } from 'lucide-vue-next'
import type {
    AssistantSession,
    AssistantSessionListResponse,
    CreateAssistantSessionResponse,
} from '#shared/types/assistant'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFormatters } from '~/composables/useFormatters'
import { useAlertDialogStore } from '~/store/alertDialog'
import AssistantSessionTitle from '~/components/assistant/AssistantSessionTitle.vue'

const selectedId = defineModel<string | null>('selectedId')

/** 点选会话时通知父级（用于关闭移动端抽屉，含点选当前会话的情况） */
const emit = defineEmits<{ select: [] }>()

const { formatDateRelative } = useFormatters()

const sessions = ref<AssistantSession[]>([])
const loading = ref(false)
const creating = ref(false)

/** 会话搜索关键词（纯前端过滤） */
const search = ref('')
const filteredSessions = computed(() => {
    const q = search.value.trim()
    if (!q) return sessions.value
    return sessions.value.filter(s => (s.title ?? '未命名对话').includes(q))
})

async function loadSessions() {
    loading.value = true
    try {
        const res = await useApiFetch<AssistantSessionListResponse>(
            '/api/v1/assistant/sessions',
            { query: { pageSize: 100 } },
        )
        if (res) sessions.value = res.list ?? []
    } finally {
        loading.value = false
    }
}

async function createSession() {
    if (creating.value) return
    creating.value = true
    try {
        const res = await useApiFetch<CreateAssistantSessionResponse>(
            '/api/v1/assistant/sessions',
            { method: 'POST', body: {} },
        )
        if (res?.sessionId) {
            selectedId.value = res.sessionId
            await loadSessions()
        }
    } finally {
        creating.value = false
    }
}

/** 重命名会话（由对话顶栏调用），成功返回 true */
async function renameSession(sessionId: string, title: string): Promise<boolean> {
    const next = title.trim()
    if (!next) return false
    const res = await useApiFetch<{ sessionId: string; title: string }>(
        `/api/v1/assistant/sessions/${sessionId}`,
        { method: 'PATCH', body: { title: next } },
    )
    if (!res) return false
    await loadSessions()
    return true
}

/** 删除会话（由对话顶栏调用），带二次确认 */
function removeSession(session: AssistantSession) {
    const label = session.title ?? '未命名对话'
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '确认删除',
        message: `确定删除"${label}"？删除后无法恢复。`,
        confirmText: '确认删除',
        cancelText: '取消',
        onConfirm: async () => {
            const res = await useApiFetch<{ sessionId: string }>(
                `/api/v1/assistant/sessions/${session.sessionId}`,
                { method: 'DELETE' },
            )
            if (res) {
                if (selectedId.value === session.sessionId) selectedId.value = null
                await loadSessions()
            }
        },
    })
}

/** 选中会话；无论是否已是当前会话都 emit，便于父级关闭移动端抽屉 */
function selectSession(session: AssistantSession) {
    selectedId.value = session.sessionId
    emit('select')
}

onMounted(loadSessions)

defineExpose({ refresh: loadSessions, createSession, sessions, renameSession, removeSession })
</script>

<template>
    <div class="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
        <!-- 新会话按钮 -->
        <div class="px-3 pb-2.5 pt-3.5">
            <Button
                class="w-full gap-1.5 bg-gradient-brand-button text-white shadow-[0_8px_18px_-8px_rgba(30,158,237,0.4)]"
                :disabled="creating" @click="createSession">
                <PlusIcon class="size-4" />
                <span class="text-[13.5px] font-semibold">新会话</span>
            </Button>
        </div>

        <!-- 搜索框 -->
        <div class="px-3 pb-2.5">
            <div class="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5">
                <SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
                <input v-model="search" placeholder="搜索会话..." aria-label="搜索会话"
                    class="min-w-0 flex-1 border-none bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground">
            </div>
        </div>

        <!-- 列表区 -->
        <div class="flex-1 overflow-y-auto px-2 pb-3">
            <!-- loading 骨架 -->
            <div v-if="loading && sessions.length === 0" class="space-y-1.5 px-1 py-2">
                <div v-for="i in 5" :key="i" class="h-12 animate-pulse rounded-lg bg-muted" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="filteredSessions.length === 0" class="py-10 text-center text-xs text-muted-foreground/70">
                {{ sessions.length === 0 ? '暂无会话' : '没有匹配的会话' }}
            </div>

            <!-- 列表 -->
            <template v-else>
                <!-- <div class="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    历史会话
                </div> -->
                <ul class="space-y-0.5">
                    <li v-for="s in filteredSessions" :key="s.sessionId"
                        class="relative cursor-pointer rounded-lg px-2.5 py-2 transition-colors"
                        :class="selectedId === s.sessionId ? 'session-active' : 'hover:bg-primary/[0.08]'"
                        @click="selectSession(s)">
                        <!-- 选中态左侧品牌色条 -->
                        <span v-if="selectedId === s.sessionId" aria-hidden="true"
                            class="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-linear-to-b from-[var(--brand-mint)] via-[var(--brand-sky)] to-[var(--brand-navy)]" />
                        <p class="truncate text-[13px] leading-snug" :class="selectedId === s.sessionId
                            ? 'font-semibold text-primary'
                            : 'font-medium text-foreground'">
                            <AssistantSessionTitle :title="s.title" />
                        </p>
                        <p class="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <ClockIcon class="size-3 shrink-0" />
                            {{ formatDateRelative(s.updatedAt) }}
                        </p>
                    </li>
                </ul>
            </template>
        </div>
    </div>
</template>

<style scoped>
/* 选中会话项的品牌色横向渐隐底纹（取自设计稿） */
.session-active {
    background-image: linear-gradient(90deg,
            color-mix(in srgb, var(--brand-mint) 14%, transparent),
            color-mix(in srgb, var(--brand-sky) 12%, transparent) 60%,
            transparent);
}
</style>
