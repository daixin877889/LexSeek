<script setup lang="ts">
/**
 * 合同审查详情（/dashboard/contract/:id）
 *
 * 顶级路由，从 /dashboard/assistant/contract?reviewId=X 迁移而来。
 * 主体是 ContractReviewPanel（管 review 取数、SSE 续订、子视图渲染）。
 *
 * 阶段 5 Task 13 增量：当 ?from=assistant&sessionId=xxx 跳入时，
 * 顶部插入「来源条」（返回助手 + 关联案件）。
 * 关联状态用本 page 自身维护的 caseId（独立调 GET /reviews/:id 拿初始值，
 * PATCH 后从接口返回值更新），与 ContractReviewPanel 内部状态解耦。
 */
import AssistantContractReviewPanel from '~/components/assistant/contract/ContractReviewPanel.vue'
import AgentsContractReviewSourceBar from '~/components/agents/contract/ReviewSourceBar.vue'
import CasesCaseLinkerDialog from '~/components/cases/CaseLinkerDialog.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useCaseLinker } from '~/composables/useCaseLinker'

definePageMeta({
    layout: 'dashboard-layout',
    title: '合同审查',
    icon: 'FileSearch',
})

const route = useRoute()
const reviewId = computed(() => {
    const v = route.params.id
    const n = Number(Array.isArray(v) ? v[0] : v)
    return Number.isInteger(n) && n > 0 ? n : null
})

// ========== 阶段 5 Task 13：顶部「来源条」 ==========
const fromSource = computed(() => {
    const f = route.query.from
    if (typeof f !== 'string') return ''
    if (f === 'assistant' || f === 'xiaosuo') return f
    return ''
})
const sourceSessionId = computed(() => {
    const sid = route.query.sessionId
    return typeof sid === 'string' ? sid : null
})
const showSourceBar = computed(() => fromSource.value !== '')

// 关联案件状态：page 自己维护，与 ContractReviewPanel 内部解耦
const linkedCaseId = ref<number | null>(null)
const caseTitle = ref<string | null>(null)

interface ReviewDetailResponse {
    review: {
        id: number
        caseId?: number | null
    }
}

/** 拉一次 review 拿 caseId（GET 接口阶段 5 已加 caseId 字段） */
async function loadCaseId() {
    if (!reviewId.value) {
        linkedCaseId.value = null
        return
    }
    const data = await useApiFetch<ReviewDetailResponse>(
        `/api/v1/assistant/contract/reviews/${reviewId.value}`,
        { showError: false } as any,
    )
    linkedCaseId.value = data?.review?.caseId ?? null
    await refreshCaseTitle()
}

async function refreshCaseTitle() {
    if (linkedCaseId.value == null) {
        caseTitle.value = null
        return
    }
    const data = await useApiFetch<{ items: Array<{ id: number; title: string }> }>(
        '/api/v1/cases/active',
        { query: { limit: 200 }, showError: false } as any,
    )
    caseTitle.value = data?.items?.find(c => c.id === linkedCaseId.value)?.title ?? null
}

watch(reviewId, () => { void loadCaseId() }, { immediate: true })

const {
    dialogOpen: caseLinkerOpen,
    openLinker: openCaseLinker,
    linkCase: confirmLinkCase,
} = useCaseLinker({
    variant: 'contract',
    entityId: reviewId,
    onLinked: async (caseId) => {
        linkedCaseId.value = caseId
        await refreshCaseTitle()
    },
})
</script>

<template>
    <div class="h-full min-h-0 flex flex-col">
        <!-- 阶段 5 Task 13：顶部来源条（仅当从法律助手 / 小索 跳入时显示） -->
        <div v-if="showSourceBar" class="px-4 pt-3">
            <AgentsContractReviewSourceBar
                :from="fromSource"
                :session-id="sourceSessionId"
                :case-id="linkedCaseId"
                :case-title="caseTitle"
                @link="openCaseLinker"
                @change="openCaseLinker"
            />
        </div>

        <div class="flex-1 min-h-0">
            <AssistantContractReviewPanel :review-id="reviewId" />
        </div>

        <!-- 关联案件 Dialog（来源条触发） -->
        <CasesCaseLinkerDialog
            v-model:open="caseLinkerOpen"
            :current-case-id="linkedCaseId"
            :on-confirm="confirmLinkCase"
        />
    </div>
</template>
