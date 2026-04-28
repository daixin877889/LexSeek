<script setup lang="ts">
/**
 * 案件详情 - 案件记忆 Tab
 *
 * 布局对齐 CaseDetailDocuments：
 * - 顶部栏：标题 + 数量 Badge + 「+ 添加记忆」
 * - 筛选 pill：全部 / AI 主动 / AI 自动 / 用户
 * - 主体：CaseMemoryTimeline（按日分组）
 * - 底部："显示已失效的历史版本"折叠
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ChevronDownIcon, ChevronUpIcon, Loader2Icon, NotebookPenIcon, PlusIcon } from 'lucide-vue-next'
import { useCaseMemory, type MemoryFilter } from '~/composables/useCaseMemory'
import { useAlertDialogStore } from '~/store/alertDialog'
import toast from '#shared/utils/toast'
import CaseMemoryTimeline from '~/components/caseDetail/CaseMemoryTimeline.vue'
import AddMemoryDialog from '~/components/caseDetail/AddMemoryDialog.vue'

const props = defineProps<{
    caseId: number
}>()

const caseIdRef = computed(() => props.caseId)
const memory = useCaseMemory(caseIdRef)
const alertDialogStore = useAlertDialogStore()

const showAddDialog = ref(false)

const FILTER_OPTIONS: Array<{ value: MemoryFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'manual', label: 'AI 主动' },
    { value: 'auto_extract', label: 'AI 自动' },
    { value: 'manual_user', label: '用户' },
]

const validCount = computed(() => memory.memories.value.filter(m => !m.invalidatedAt).length)
const invalidatedCount = computed(() => memory.memories.value.filter(m => !!m.invalidatedAt).length)

watch(() => memory.filter.value, () => memory.load(true))
watch(() => memory.showInvalidated.value, () => memory.load(true))

onMounted(() => memory.load(true))

function handleSubmitAdd(payload: { text: string; kind: string; subjectKey?: string }, done: (ok: boolean) => void) {
    memory.add(payload as any).then(result => {
        done(!!result)
    })
}

function handleDelete(memoryId: string) {
    alertDialogStore.showErrorDialog({
        title: '删除记忆条目',
        message: '删除后该条记忆不会再被 AI 检索到。是否继续？',
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: async () => {
            const ok = await memory.remove(memoryId)
            if (ok) toast.success('已删除')
        },
    })
}
</script>

<template>
    <div class="h-full overflow-y-auto p-4 md:p-6 space-y-4">
        <!-- 顶部栏 -->
        <header class="flex items-center justify-between gap-2">
            <h2 class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider flex items-center gap-2">
                <NotebookPenIcon class="size-4" />
                案件记忆
                <Badge v-if="validCount" variant="secondary" class="font-normal px-1.5 py-0 h-4 text-[10px]">
                    {{ validCount }}
                </Badge>
            </h2>
            <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                title="添加记忆"
                @click="showAddDialog = true">
                <PlusIcon class="size-3" />
                <span class="hidden lg:inline">添加记忆</span>
            </button>
        </header>

        <!-- 筛选 pill -->
        <div class="flex items-center gap-1.5 flex-wrap">
            <button v-for="opt in FILTER_OPTIONS" :key="opt.value"
                class="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                :class="memory.filter.value === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border hover:bg-accent'"
                @click="memory.filter.value = opt.value">
                {{ opt.label }}
            </button>
        </div>

        <!-- 加载 -->
        <div v-if="memory.loading.value && memory.memories.value.length === 0" class="flex justify-center py-10">
            <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
        </div>

        <!-- 空态 -->
        <div v-else-if="validCount === 0 && !memory.showInvalidated.value"
            class="flex flex-col items-center justify-center py-14 text-muted-foreground">
            <NotebookPenIcon class="size-10 mb-2 opacity-40" />
            <p class="text-sm mb-4">本案件还没有记忆条目</p>
            <Button size="sm" class="gap-1" @click="showAddDialog = true">
                <PlusIcon class="size-4" />
                添加第一条
            </Button>
        </div>

        <!-- 时间轴 -->
        <CaseMemoryTimeline v-else
            :memories="memory.memories.value"
            :show-invalidated="memory.showInvalidated.value"
            @delete="handleDelete" />

        <!-- 加载更多 -->
        <div v-if="memory.hasMore.value && memory.memories.value.length > 0" class="flex justify-center pt-2">
            <Button variant="ghost" size="sm" :disabled="memory.loading.value" @click="memory.loadMore()">
                <Loader2Icon v-if="memory.loading.value" class="size-3 mr-1 animate-spin" />
                加载更多
            </Button>
        </div>

        <!-- 失效记录折叠 -->
        <div v-if="invalidatedCount > 0 || memory.showInvalidated.value" class="pt-3 border-t border-border/60">
            <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                @click="memory.showInvalidated.value = !memory.showInvalidated.value">
                <ChevronDownIcon v-if="!memory.showInvalidated.value" class="size-3" />
                <ChevronUpIcon v-else class="size-3" />
                {{ memory.showInvalidated.value ? '隐藏' : '显示' }}已失效的历史版本
                <span v-if="invalidatedCount" class="text-muted-foreground/60">（{{ invalidatedCount }} 条）</span>
            </button>
        </div>

        <!-- 添加 Dialog -->
        <AddMemoryDialog v-model:open="showAddDialog" @submit="handleSubmitAdd" />
    </div>
</template>
