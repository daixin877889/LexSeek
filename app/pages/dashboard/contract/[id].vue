<script setup lang="ts">
/**
 * 合同审查详情（/dashboard/contract/:id）
 *
 * 顶级路由，从 /dashboard/assistant/contract?reviewId=X 迁移而来。
 * 仅承载 ContractReviewPanel + reviewId 传入；组件内部负责取数、SSE 续订、所有子视图渲染。
 */
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
</script>

<template>
    <div class="h-full min-h-0">
        <AssistantContractReviewPanel :review-id="reviewId" />
    </div>
</template>
