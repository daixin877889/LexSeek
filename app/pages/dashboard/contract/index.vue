<script setup lang="ts">
/**
 * 合同审查列表页（/dashboard/contract）
 *
 * 结构：页头 → 内嵌新建审查卡片 → 审查历史（状态分段筛选 + 搜索 + 卡片列表 + 分页）。
 *
 * 交互：
 * - 新建审查：页面顶部常驻卡片（ContractCreateReviewForm），成功后跳详情。
 * - 筛选：状态分段控件即时生效；搜索框 refDebounced 300ms 防抖。
 * - 列表：卡片列表（桌面 / 移动统一），整卡跳详情，删除走全局确认弹窗。
 * - query ?new=1&caseId=X：案件详情页入口跳入；挂载后滚动到新建卡片并短暂高亮，
 *   caseId 传入表单，新建审查归属该案件。
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { FileText, Loader2, Search } from 'lucide-vue-next'
import type { ReviewListItem } from '#shared/types/contract'
import ContractCreateReviewForm from '~/components/assistant/contract/ContractCreateReviewForm.vue'
import ContractReviewCard from '~/components/assistant/contract/ContractReviewCard.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApi } from '~/composables/useApi'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'

definePageMeta({
    layout: 'dashboard-layout',
    title: '合同审查',
    icon: 'FileSearch',
})

const route = useRoute()
const router = useRouter()

// 从 query 读取归属案件
const initCaseId = computed(() => {
    const n = Number(route.query.caseId)
    return Number.isInteger(n) && n > 0 ? n : null
})

// ===== 筛选状态 =====
const formQ = ref('')
const debouncedQ = refDebounced(formQ, 300)
const formStatus = ref('all')

const STATUS_TABS = [
    { value: 'all', label: '全部' },
    { value: 'reviewing', label: '审查中' },
    { value: 'awaiting_stance', label: '等待立场' },
    { value: 'completed', label: '已完成' },
    { value: 'failed', label: '失败' },
]

// 分页
const PAGE_SIZE = 20
const page = ref(1)

// 筛选变化回到首页
watch([debouncedQ, formStatus], () => { page.value = 1 })

const listQuery = computed(() => {
    const q: Record<string, string | number> = {
        skip: (page.value - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
    }
    const qText = debouncedQ.value.trim()
    if (qText) q.q = qText
    if (formStatus.value !== 'all') q.status = formStatus.value
    return q
})

interface ListResponse {
    items: ReviewListItem[]
    total: number
    skip: number
    take: number
}

const { data, status: listStatus, refresh } = await useApi<ListResponse>(
    '/api/v1/assistant/contract/reviews',
    { query: listQuery },
)
const items = computed<ReviewListItem[]>(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)
const loading = computed(() => listStatus.value === 'pending')
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

// ===== 新建成功 → 跳详情 =====
function handleCreated(reviewId: number) {
    toast.success('已发起合同审查')
    router.push(`/dashboard/contract/${reviewId}`)
}

// ===== 删除 =====
function confirmDelete(item: ReviewListItem) {
    const alertDialogStore = useAlertDialogStore()
    alertDialogStore.showErrorDialog({
        title: '确认删除',
        message: `确定删除「${item.originalFileName ?? '未命名合同'}」？删除后无法恢复。`,
        confirmText: '确认删除',
        cancelText: '取消',
        onConfirm: async () => {
            const ok = await useApiFetch(
                `/api/v1/assistant/contract/reviews/${item.id}`,
                { method: 'DELETE' },
            )
            if (ok !== null) {
                toast.success('已删除')
                await refresh()
            }
        },
    })
}

// ===== ?new=1 → 滚动并高亮新建卡片 =====
const createCardRef = ref<HTMLElement | null>(null)
const highlightCreate = ref(false)

onMounted(async () => {
    if (route.query.new === '1') {
        await nextTick()
        createCardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        highlightCreate.value = true
        setTimeout(() => { highlightCreate.value = false }, 2000)
    }
})
</script>

<template>
    <div class="space-y-7 p-4 md:p-6">
        <!-- 页头 -->
        <header>
            <!-- <p class="text-xs font-medium uppercase tracking-[0.08em] text-primary">
                CONTRACT REVIEW · 合同审查
            </p> -->
            <h1 class="mt-2.5 text-2xl font-bold tracking-tight md:text-[28px]">合同审查</h1>
            <p class="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                一键扫描合同条款风险、缺失项与改进建议
            </p>
        </header>

        <!-- 新建审查卡片 -->
        <div ref="createCardRef" class="rounded-xl border bg-card p-5 transition-shadow duration-300"
            :class="highlightCreate ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''">
            <ContractCreateReviewForm :case-id="initCaseId" @created="handleCreated" />
        </div>

        <!-- 审查历史 -->
        <section class="space-y-4">
            <div class="flex items-baseline gap-2.5">
                <h2 class="text-lg font-semibold">审查历史</h2>
                <span class="text-sm text-muted-foreground">共 {{ total }} 份</span>
            </div>

            <!-- 筛选条 -->
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Tabs v-model="formStatus">
                    <TabsList class="w-full justify-start overflow-x-auto sm:w-auto">
                        <TabsTrigger v-for="t in STATUS_TABS" :key="t.value" :value="t.value">
                            {{ t.label }}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
                <div class="relative sm:w-60">
                    <Search class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input v-model="formQ" placeholder="搜索合同名称…" class="pl-8" />
                </div>
            </div>

            <!-- 加载中 -->
            <div v-if="loading" class="py-16 text-center text-muted-foreground">
                <Loader2 class="mx-auto mb-2 size-6 animate-spin" />
                加载中...
            </div>

            <!-- 空态 -->
            <div v-else-if="items.length === 0"
                class="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
                <FileText class="mx-auto mb-3 size-8 opacity-50" />
                <p class="text-sm">暂无合同审查记录</p>
                <p class="mt-1 text-xs">在上方卡片上传或粘贴合同，开始第一次扫描</p>
            </div>

            <!-- 列表 -->
            <template v-else>
                <div class="space-y-2.5">
                    <ContractReviewCard v-for="row in items" :key="row.id" :review="row" @delete="confirmDelete" />
                </div>
                <GeneralPagination v-if="pageCount > 1" :current-page="page" :page-size="PAGE_SIZE" :total="total"
                    @change="(p: number) => (page = p)" />
            </template>
        </section>
    </div>
</template>
