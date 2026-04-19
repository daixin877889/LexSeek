<script setup lang="ts">
/**
 * 合同审查主页（路由 /dashboard/assistant/contract）
 *
 * 支持 URL query：
 * - ?reviewId=xxx 从已有审查恢复
 * - ?caseId=xxx  新建审查归属到该案件（案件详情 Tab「新建合同审查」入口）
 */
definePageMeta({
    layout: 'dashboard-layout',
    title: '合同审查',
    icon: 'FileSearch',
})

const route = useRoute()
const reviewId = computed(() => {
    const v = route.query.reviewId
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? n : null
})
const caseId = computed(() => {
    const v = route.query.caseId
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? n : null
})
</script>

<template>
    <div class="h-full min-h-0">
        <AssistantContractReviewPanel :review-id="reviewId" :case-id="caseId" />
    </div>
</template>
