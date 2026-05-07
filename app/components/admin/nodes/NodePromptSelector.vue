<template>
    <!-- "+ 添加" 嵌套选择对话框（带 type chip 筛选） -->
    <Dialog v-model:open="open">
        <DialogContent
            class="w-full! h-full! max-w-none! max-h-none! md:w-[70vw]! md:max-h-[80vh]! flex flex-col rounded-non!e md:rounded-lg!"
            :class="contentClass"
            :overlay-class="overlayClass"
            @interactOutside="(e) => e.preventDefault()"
        >
            <DialogHeader class="shrink-0">
                <DialogTitle>从提示词库添加</DialogTitle>
                <DialogDescription>
                    勾选要挂到当前节点的提示词，已挂载的不会出现在列表中。可按类型分组筛选。
                </DialogDescription>
            </DialogHeader>

            <!-- type 筛选 chip -->
            <div class="flex flex-wrap gap-2 shrink-0 mt-2">
                <button
                    v-for="chip in TYPE_CHIPS"
                    :key="chip.value"
                    type="button"
                    class="px-3 py-1 rounded-full border text-xs cursor-pointer transition"
                    :class="typeFilter === chip.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background hover:bg-muted border-input'"
                    @click="typeFilter = chip.value"
                >
                    {{ chip.label }}
                    <span class="ml-1 opacity-60">{{ typeCounts[chip.value] }}</span>
                </button>
            </div>

            <!-- 搜索框 -->
            <div class="relative shrink-0 mt-2">
                <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input v-model="search" placeholder="按名称 / 标题 / 类型 搜索" class="pl-8" />
            </div>

            <!-- 已选 chip -->
            <div v-if="selected.size" class="flex flex-wrap gap-2 shrink-0">
                <Badge
                    v-for="p in selectedItems"
                    :key="p.id"
                    variant="secondary"
                    class="cursor-pointer"
                    @click="toggle(p.id)"
                >
                    {{ p.title || p.name }}
                    <X class="h-3 w-3 ml-1" />
                </Badge>
            </div>

            <!-- 列表区 -->
            <div class="flex-1 min-h-0 border rounded-md overflow-y-auto">
                <div v-if="loading" class="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    <Loader2 class="h-4 w-4 mr-2 animate-spin" />
                    加载提示词列表...
                </div>
                <div v-else-if="filtered.length === 0"
                    class="p-8 text-center text-sm text-muted-foreground">
                    没有可添加的提示词（已挂载的不会显示）
                </div>
                <div
                    v-for="p in filtered"
                    :key="p.id"
                    class="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50 border-b last:border-b-0"
                    @click="toggle(p.id)"
                >
                    <!-- 勾选框 -->
                    <div
                        class="size-4 shrink-0 mt-0.5 flex items-center justify-center rounded border"
                        :class="selected.has(p.id) ? 'bg-primary border-primary text-primary-foreground' : 'border-input'"
                    >
                        <Check v-if="selected.has(p.id)" class="size-3" />
                    </div>

                    <!-- 信息 -->
                    <div class="flex-1 min-w-0">
                        <div class="font-medium text-sm truncate">{{ p.title || p.name }}</div>
                        <div class="text-xs text-muted-foreground font-mono truncate">
                            {{ p.name }} · {{ p.version }} · 已被 {{ p.referencedByCount }} 个节点引用
                        </div>
                    </div>

                    <!-- 类型 / 状态 -->
                    <Badge variant="outline" class="shrink-0">
                        {{ getPromptTypeLabel(p.type) }}
                    </Badge>
                    <Badge :variant="p.status === 1 ? 'default' : 'secondary'" class="shrink-0">
                        {{ p.status === 1 ? '生效' : '未生效' }}
                    </Badge>
                </div>
            </div>

            <DialogFooter class="shrink-0">
                <Button variant="outline" @click="open = false">取消</Button>
                <Button :disabled="selected.size === 0" @click="onConfirm">
                    添加 {{ selected.size }} 项
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Check, Loader2, Search, X } from 'lucide-vue-next'
import type { NodePromptRef, PromptType } from '#shared/types/node'
import { useApiFetch } from '~/composables/useApiFetch'

/** 后端 GET /admin/prompts 返回的列表条目类型（不带 displayOrder，挂到节点时再分配） */
interface PromptListItem {
    id: number
    name: string
    title: string | null
    type: string
    status: number
    version: string
    referencedByCount: number
}

/** type chip 筛选可选值（'all' = 不筛选） */
type TypeFilter = 'all' | PromptType

const props = defineProps<{
    /** 已挂在当前节点的 prompt id 列表，从可选范围中排除 */
    excludePromptIds: number[]
    /** 嵌套打开时传入更高 z-index（如 200），覆盖默认 z-50 */
    nestedZIndex?: number
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    /** 用户点击"添加 N 项"按钮：返回选中的 prompts（NodePromptRef，但 displayOrder 暂为 0，由父组件 push 时分配） */
    confirmed: [items: NodePromptRef[]]
}>()

const open = defineModel<boolean>('open', { default: false })

/** 嵌套 z-index：overlay 比 content 低 1，让 overlay 仍然挡在外层之上 */
const overlayClass = computed(() => (props.nestedZIndex ? `z-[${props.nestedZIndex - 1}]` : ''))
const contentClass = computed(() => (props.nestedZIndex ? `z-[${props.nestedZIndex}]` : ''))

/** type chip 列表（顺序与节点 tab 分组一致） */
const TYPE_CHIPS: Array<{ value: TypeFilter; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'system', label: '系统提示词' },
    { value: 'user_injection', label: '每轮隐藏注入' },
    { value: 'user', label: '用户触发消息' },
    { value: 'assistant', label: '预设助手消息' },
]

const PROMPT_TYPE_LABELS: Record<string, string> = {
    system: '系统',
    user: '用户',
    user_injection: '每轮注入',
    assistant: '助手',
}
function getPromptTypeLabel(type: string) {
    return PROMPT_TYPE_LABELS[type] ?? type
}

const allPrompts = ref<PromptListItem[]>([])
const loading = ref(false)
const search = ref('')
const selected = ref<Set<number>>(new Set())
/** 当前选中的 type chip，默认 'all'（不筛 type） */
const typeFilter = ref<TypeFilter>('all')

/** 排除已挂的（候选池） */
const candidatePool = computed(() => {
    const excludeSet = new Set(props.excludePromptIds)
    return allPrompts.value.filter(p => !excludeSet.has(p.id))
})

/** 各 type 计数（基于候选池，不受 chip / search 影响） */
const typeCounts = computed<Record<TypeFilter, number>>(() => {
    const counts: Record<TypeFilter, number> = {
        all: 0,
        system: 0,
        user_injection: 0,
        user: 0,
        assistant: 0,
    }
    for (const p of candidatePool.value) {
        counts.all++
        if (p.type === 'system' || p.type === 'user_injection' || p.type === 'user' || p.type === 'assistant') {
            counts[p.type]++
        }
    }
    return counts
})

/** 候选池 + chip 过滤 + 关键词过滤 */
const filtered = computed(() => {
    const q = search.value.trim().toLowerCase()
    return candidatePool.value.filter((p) => {
        if (typeFilter.value !== 'all' && p.type !== typeFilter.value) return false
        if (!q) return true
        const haystack = `${p.name} ${p.title ?? ''} ${p.type}`.toLowerCase()
        return haystack.includes(q)
    })
})

/** 已选 prompts（用于顶部 chip 展示） */
const selectedItems = computed(() =>
    allPrompts.value.filter(p => selected.value.has(p.id)),
)

function toggle(id: number) {
    const next = new Set(selected.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected.value = next
}

/** 拉取所有生效的 prompt（status=1）作为候选 */
async function loadPrompts() {
    loading.value = true
    try {
        // 分页拉满（pageSize 100 足够覆盖当前规模；后端最大 100）
        const data = await useApiFetch<{ items: PromptListItem[]; total: number }>(
            '/api/v1/admin/prompts',
            { query: { status: 1, pageSize: 100, page: 1 } },
        )
        allPrompts.value = data?.items ?? []
    } finally {
        loading.value = false
    }
}

/** 对话框打开时刷新数据并清空已选 / chip / 搜索 */
watch(open, async (isOpen) => {
    if (isOpen) {
        selected.value = new Set()
        search.value = ''
        typeFilter.value = 'all'
        await loadPrompts()
    }
})

/** 确认：把选中的 prompts 转成 NodePromptRef（displayOrder=0 占位，由父组件分配） */
function onConfirm() {
    const items: NodePromptRef[] = allPrompts.value
        .filter(p => selected.value.has(p.id))
        .map(p => ({
            id: p.id,
            name: p.name,
            title: p.title,
            type: p.type,
            status: p.status,
            version: p.version,
            displayOrder: 0,
            referencedByCount: p.referencedByCount,
        }))
    emit('confirmed', items)
    open.value = false
}
</script>
