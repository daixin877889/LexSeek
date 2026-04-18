<script setup lang="ts">
/**
 * 合同审查主页（路由 /dashboard/assistant/contract）
 *
 * 支持 URL query ?reviewId=xxx 从已有审查恢复。
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
</script>

<template>
    <div class="h-full min-h-0">
        <AssistantContractContractReviewPanel :review-id="reviewId" />
    </div>
</template>
