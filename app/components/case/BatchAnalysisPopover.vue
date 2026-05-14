<script lang="ts" setup>
/**
 * 批量分析下拉浮层
 *
 * trigger：「+ 批量分析」按钮（始终可点开）。
 * 浮层：列出该案件所有 type=2 会话 + 底部「+ 新建批量分析」按钮。
 * 当 showBatchButton=false（所有模块已完成）时，禁用底部新建按钮、不禁用 trigger。
 *
 * 每次 open 切换为 true 时重新拉列表，保证跨 tab 新建后能看到（不需要额外订阅 cross-tab 事件）。
 */
import { PlusIcon, Loader2Icon } from 'lucide-vue-next'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { useApiFetch } from '~/composables/useApiFetch'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface InitSessionItem {
    sessionId: string
    title: string
    hasActiveRun: boolean
    updatedAt: string
}

const props = defineProps<{
    caseId: number
    showBatchButton: boolean
    isAnalysisRunning: boolean
}>()

const emit = defineEmits<{
    'open-session': [sessionId: string]
    'new-batch': []
}>()

const open = ref(false)
const sessions = ref<InitSessionItem[]>([])
const loading = ref(false)

async function loadSessions() {
    if (props.caseId <= 0) return
    loading.value = true
    const data = await useApiFetch<InitSessionItem[]>(`/api/v1/cases/analysis/init-sessions?caseId=${props.caseId}`)
    if (data)
        sessions.value = data
    loading.value = false
}

watch(open, (val) => {
    if (val) loadSessions()
})

function handleSelect(sessionId: string) {
    open.value = false
    emit('open-session', sessionId)
}

function handleNew() {
    if (!props.showBatchButton) return
    open.value = false
    emit('new-batch')
}
</script>

<template>
    <Popover v-model:open="open">
        <PopoverTrigger as-child>
            <button
                data-testid="batch-trigger"
                class="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mr-2"
                title="批量分析"
            >
                <PlusIcon class="size-3" />
                <span class="hidden lg:inline">批量分析</span>
            </button>
        </PopoverTrigger>
        <PopoverContent class="w-64 p-0 z-[70]" align="end">
            <div class="max-h-60 overflow-y-auto">
                <div v-if="loading" class="flex items-center justify-center py-4 text-muted-foreground text-xs">
                    <Loader2Icon class="size-3 animate-spin mr-1" /> 加载中
                </div>
                <div
                    v-for="s in sessions"
                    :key="s.sessionId"
                    data-testid="batch-session-item"
                    class="flex items-center gap-1 px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
                    @click="handleSelect(s.sessionId)"
                >
                    <span class="truncate flex-1">{{ s.title }}</span>
                    <span v-if="s.hasActiveRun" class="size-1.5 rounded-full bg-primary animate-pulse shrink-0" title="进行中" />
                    <span class="shrink-0 text-xs text-muted-foreground">{{ dayjs(s.updatedAt).fromNow() }}</span>
                </div>
                <div v-if="!loading && sessions.length === 0" class="px-2 py-3 text-xs text-muted-foreground">
                    暂无历史
                </div>
            </div>
            <div class="border-t p-1">
                <button
                    data-testid="batch-new"
                    class="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    :disabled="!showBatchButton"
                    :title="!showBatchButton ? '所有模块已完成，无需新建' : '新建批量分析'"
                    @click="handleNew"
                >
                    <PlusIcon class="size-3.5" />
                    新建批量分析
                </button>
            </div>
        </PopoverContent>
    </Popover>
</template>
