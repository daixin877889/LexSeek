<script setup lang="ts">
/**
 * 通用法律助手 · 会话列表
 *
 * 展示当前用户的 assistant 会话（scope=assistant），
 * 支持新建 / 重命名 / 软删 / 选中（v-model:selectedId）。
 *
 * - 数据接口：/api/v1/assistant/sessions (GET/POST/PATCH/DELETE)
 * - useApiFetch 自动提取 data 字段，直接使用返回值
 * - 类型参见 #shared/types/assistant
 *
 * 参见 spec §8.3.2。
 */
import {
    PlusIcon,
    Trash2Icon,
    PencilIcon,
    CheckIcon,
    XIcon,
} from 'lucide-vue-next'
import type {
    AssistantSession,
    AssistantSessionListResponse,
    CreateAssistantSessionResponse,
} from '#shared/types/assistant'

const selectedId = defineModel<string | null>('selectedId')

const sessions = ref<AssistantSession[]>([])
const loading = ref(false)
const creating = ref(false)

/** 内联重命名状态 */
const renamingId = ref<string | null>(null)
const renameInput = ref('')

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

function startRename(session: AssistantSession, e: Event) {
    e.stopPropagation()
    renamingId.value = session.sessionId
    renameInput.value = session.title ?? ''
}

function cancelRename(e?: Event) {
    e?.stopPropagation()
    renamingId.value = null
    renameInput.value = ''
}

async function confirmRename(session: AssistantSession, e: Event) {
    e.stopPropagation()
    const next = renameInput.value.trim()
    if (!next || next === (session.title ?? '')) {
        cancelRename()
        return
    }
    const res = await useApiFetch<{ sessionId: string; title: string }>(
        `/api/v1/assistant/sessions/${session.sessionId}`,
        { method: 'PATCH', body: { title: next } },
    )
    cancelRename()
    if (res) await loadSessions()
}

async function deleteSession(session: AssistantSession, e: Event) {
    e.stopPropagation()
    const label = session.title ?? '未命名对话'
    if (!window.confirm(`确定删除"${label}"？`)) return
    const res = await useApiFetch<{ sessionId: string }>(
        `/api/v1/assistant/sessions/${session.sessionId}`,
        { method: 'DELETE' },
    )
    if (res) {
        if (selectedId.value === session.sessionId) selectedId.value = null
        await loadSessions()
    }
}

function handleSelect(session: AssistantSession) {
    if (renamingId.value) return
    selectedId.value = session.sessionId
}

onMounted(loadSessions)

defineExpose({ refresh: loadSessions, createSession })
</script>

<template>
    <div class="flex h-full flex-col bg-muted/30 border-r border-border/60">
        <!-- 新对话按钮：outline 风格，与列表项区分 -->
        <div class="px-2 pt-3 pb-2">
            <Button
                variant="outline"
                size="sm"
                class="w-full justify-start gap-2 h-9 bg-background/60 hover:bg-background"
                :disabled="creating"
                @click="createSession"
            >
                <PlusIcon class="size-4 text-primary" />
                <span class="text-sm">新对话</span>
            </Button>
        </div>

        <!-- 列表区 -->
        <div class="flex-1 overflow-y-auto px-2 pb-3">
            <!-- loading 骨架 -->
            <div v-if="loading && sessions.length === 0" class="space-y-1.5 px-1 py-2">
                <div
                    v-for="i in 4"
                    :key="i"
                    class="h-8 rounded-md bg-muted/70 animate-pulse"
                />
            </div>

            <!-- 空状态：淡化提示 -->
            <div
                v-else-if="sessions.length === 0"
                class="py-10 text-center text-xs text-muted-foreground/70"
            >
                暂无会话
            </div>

            <!-- 列表 -->
            <ul v-else class="space-y-0.5">
                <li
                    v-for="s in sessions"
                    :key="s.sessionId"
                    class="group relative flex items-center gap-1 rounded-md px-2 py-2 cursor-pointer transition-colors"
                    :class="[
                        selectedId === s.sessionId
                            ? 'bg-accent text-accent-foreground'
                            : 'hover:bg-accent/60 text-foreground/80',
                    ]"
                    @click="handleSelect(s)"
                >
                    <!-- 重命名态 -->
                    <template v-if="renamingId === s.sessionId">
                        <input
                            v-model="renameInput"
                            class="flex-1 min-w-0 text-sm bg-background border border-border rounded px-2 py-0.5 outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                            autofocus
                            maxlength="200"
                            @click.stop
                            @keyup.enter="confirmRename(s, $event)"
                            @keyup.escape="cancelRename($event)"
                        >
                        <button
                            type="button"
                            class="shrink-0 size-6 rounded flex items-center justify-center text-primary hover:bg-primary/10"
                            title="确认"
                            @click="confirmRename(s, $event)"
                        >
                            <CheckIcon class="size-3.5" />
                        </button>
                        <button
                            type="button"
                            class="shrink-0 size-6 rounded flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="取消"
                            @click="cancelRename($event)"
                        >
                            <XIcon class="size-3.5" />
                        </button>
                    </template>

                    <!-- 正常态 -->
                    <template v-else>
                        <span class="flex-1 truncate text-sm">
                            {{ s.title ?? '未命名对话' }}
                        </span>
                        <button
                            type="button"
                            class="shrink-0 size-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-background hover:text-foreground transition-opacity"
                            title="重命名"
                            @click="startRename(s, $event)"
                        >
                            <PencilIcon class="size-3.5" />
                        </button>
                        <button
                            type="button"
                            class="shrink-0 size-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-opacity"
                            title="删除"
                            @click="deleteSession(s, $event)"
                        >
                            <Trash2Icon class="size-3.5" />
                        </button>
                    </template>
                </li>
            </ul>
        </div>
    </div>
</template>
