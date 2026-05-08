<script setup lang="ts">
/**
 * 合同审查详情（/dashboard/contract/:id）
 *
 * 主体是 ContractReviewPanel；当 ?from=assistant&sessionId=xxx 跳入时，顶部插入
 * 「来源条」让用户回跳。关联案件状态由本 page 自维护（独立 GET 拿初始值，PATCH
 * 后从接口返回值更新），与 ContractReviewPanel 内部解耦避免双向同步。
 */
import AssistantContractReviewPanel from '~/components/assistant/contract/ContractReviewPanel.vue'
import AgentsContractReviewSourceBar from '~/components/agents/contract/ReviewSourceBar.vue'
import CasesCaseLinkerDialog from '~/components/cases/CaseLinkerDialog.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { useCaseLinker } from '~/composables/useCaseLinker'
import { usePageSourceBar } from '~/composables/usePageSourceBar'

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

// 关联案件状态：page 自己维护，与 ContractReviewPanel 内部解耦
const linkedCaseId = ref<number | null>(null)

const { fromSource, sourceSessionId, showSourceBar, caseTitle } = usePageSourceBar({ caseId: linkedCaseId })

interface ReviewDetailResponse {
    review: {
        id: number
        caseId?: number | null
    }
}

/** 拉一次 review 拿 caseId（usePageSourceBar 内 watch caseId 会自动 refreshCaseTitle） */
async function loadCaseId() {
    if (!reviewId.value) {
        linkedCaseId.value = null
        return
    }
    const data = await useApiFetch<ReviewDetailResponse>(
        `/api/v1/assistant/contract/reviews/${reviewId.value}`,
        { showError: false },
    )
    linkedCaseId.value = data?.review?.caseId ?? null
}

watch(reviewId, () => { void loadCaseId() }, { immediate: true })

const {
    dialogOpen: caseLinkerOpen,
    openLinker: openCaseLinker,
    linkCase: confirmLinkCase,
} = useCaseLinker({
    variant: 'contract',
    entityId: reviewId,
    onLinked: (caseId) => {
        // usePageSourceBar 内 watch caseId 会自动 refreshCaseTitle
        linkedCaseId.value = caseId
    },
})
</script>

<template>
    <div class="h-full min-h-0 flex flex-col">
        <!-- 顶部来源条仅当从法律助手 / 小索跳入时显示 -->
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
