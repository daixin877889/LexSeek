<script setup lang="ts">
/**
 * 案件选择 Dialog（Mockup F）
 *
 * 用途：在文书页 / 合同审查页顶部"+ 关联案件"按钮触发，让用户从「我的进行中案件」中
 * 单选一个挂上 caseId（或者解绑 = null）。
 *
 * 数据源：GET /api/v1/cases/active —— 已严格过滤 owner-only + 排除 archived/deleted。
 *
 * z-index：和外层 Sheet 共存时（Sheet 默认 z-[70]）必须把 Dialog 拉到 z-[200]+，
 *         参考全局规则。组件透出 `zIndex` prop（默认 200）覆盖默认 z-50。
 *
 * 参见 阶段 5 plan §三 Mockup F + Task 9
 */
import { refDebounced } from '@vueuse/core'
import {
    Check,
    Folder,
    Info,
    Loader2,
    Search,
    X,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { useApiFetch } from '~/composables/useApiFetch'

interface ActiveCase {
    id: number
    title: string
    caseType?: string | null
}

interface ActiveCasesResponse {
    items: ActiveCase[]
}

const props = withDefaults(defineProps<{
    /** 当前已关联的案件 ID（用于打开时高亮） */
    currentCaseId?: number | null
    /**
     * 确认 callback。
     * - caseId 为 number → 关联到该案件
     * - caseId 为 null → 解绑（"不关联任何案件"）
     */
    onConfirm: (caseId: number | null) => Promise<void> | void
    /** 自定义 z-index（默认 200，用于与外层 Sheet z-[70] 共存） */
    zIndex?: number
}>(), {
    currentCaseId: null,
    zIndex: 200,
})

const open = defineModel<boolean>('open', { default: false })

const cases = ref<ActiveCase[]>([])
const loading = ref(false)
const submitting = ref(false)
const selectedId = ref<number | null>(props.currentCaseId)

const keyword = ref('')
const debouncedKeyword = refDebounced(keyword, 300)

// z-index 通过 dynamic class 注入：DialogContent 默认 z-50；Overlay 也是 z-50
const overlayClass = computed(() => `z-[${props.zIndex - 1}]`)
const contentClass = computed(() => `z-[${props.zIndex}]`)

async function fetchCases() {
    loading.value = true
    try {
        const query: Record<string, string | number> = { limit: 200 }
        const kw = debouncedKeyword.value.trim()
        if (kw) query.q = kw
        const data = await useApiFetch<ActiveCasesResponse>(
            '/api/v1/cases/active',
            { query },
        )
        cases.value = data?.items ?? []
    } catch (err) {
        const msg = err instanceof Error ? err.message : '加载案件失败'
        toast.error(msg)
        cases.value = []
    } finally {
        loading.value = false
    }
}

// 打开时初次拉数据；关键字变更也重拉（immediate=true 兼容初始 open=true 的场景）
watch(open, (val) => {
    if (val) {
        // 重置选中态到 currentCaseId
        selectedId.value = props.currentCaseId
        keyword.value = ''
        void fetchCases()
    }
}, { immediate: true })

watch(debouncedKeyword, () => {
    if (open.value) void fetchCases()
})

function selectCase(id: number) {
    if (submitting.value) return
    selectedId.value = id
}

function handleCancel() {
    if (submitting.value) return
    open.value = false
}

async function handleConfirm() {
    if (submitting.value) return
    submitting.value = true
    try {
        await props.onConfirm(selectedId.value)
        open.value = false
    } catch (err) {
        const msg = err instanceof Error ? err.message : '关联失败，请重试'
        toast.error(msg)
    } finally {
        submitting.value = false
    }
}

// 是否启用确认按钮：选中变化（含解绑：currentCaseId !== selectedId）
const confirmEnabled = computed(() => {
    if (submitting.value) return false
    return selectedId.value !== props.currentCaseId
})
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent
            :class="contentClass"
            :overlay-class="overlayClass"
            class="sm:max-w-md"
            @pointer-down-outside.prevent
        >
            <DialogHeader>
                <DialogTitle>关联到案件</DialogTitle>
                <DialogDescription>
                    选择一个进行中的案件与当前内容建立关联，便于在案件中查找。
                </DialogDescription>
            </DialogHeader>

            <!-- 搜索 -->
            <div class="relative">
                <Search class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                    v-model="keyword"
                    placeholder="搜索案件名称"
                    class="h-9 pl-8 pr-7 text-sm"
                    :disabled="submitting"
                />
                <button
                    v-if="keyword"
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="清空搜索"
                    @click="keyword = ''"
                >
                    <X class="size-3.5" />
                </button>
            </div>

            <!-- 列表 -->
            <div class="max-h-72 overflow-auto rounded-md border bg-card">
                <div v-if="loading" class="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                    <Loader2 class="size-3.5 animate-spin" />
                    加载中...
                </div>
                <div
                    v-else-if="!cases.length"
                    class="flex flex-col items-center justify-center gap-1 p-6 text-xs text-muted-foreground"
                >
                    <Folder class="size-5 opacity-40" />
                    <span v-if="keyword">没有匹配的案件</span>
                    <span v-else>暂无进行中的案件</span>
                </div>
                <ul v-else class="divide-y">
                    <li v-for="c in cases" :key="c.id">
                        <button
                            type="button"
                            :disabled="submitting"
                            :class="[
                                'flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors',
                                selectedId === c.id
                                    ? 'bg-primary/5'
                                    : 'hover:bg-muted/40',
                                submitting && 'cursor-not-allowed opacity-60',
                            ]"
                            @click="selectCase(c.id)"
                        >
                            <div
                                :class="[
                                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                                    selectedId === c.id
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-muted-foreground/40',
                                ]"
                            >
                                <Check v-if="selectedId === c.id" class="size-3" />
                            </div>
                            <div class="min-w-0 flex-1">
                                <p class="truncate text-sm text-foreground">{{ c.title }}</p>
                                <p v-if="c.caseType" class="mt-0.5 truncate text-xs text-muted-foreground">
                                    {{ c.caseType }}
                                </p>
                            </div>
                        </button>
                    </li>
                </ul>
            </div>

            <p class="flex items-center gap-1 text-xs text-muted-foreground">
                <Info class="size-3.5" />
                仅显示进行中案件（不含已归档/已删除）
            </p>

            <DialogFooter class="gap-2 sm:gap-2">
                <Button variant="outline" :disabled="submitting" @click="handleCancel">
                    取消
                </Button>
                <Button :disabled="!confirmEnabled" @click="handleConfirm">
                    <Loader2 v-if="submitting" class="mr-1 size-3.5 animate-spin" />
                    确认关联
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
