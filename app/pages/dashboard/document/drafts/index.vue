<script setup lang="ts">
const router = useRouter()
/**
 * /dashboard/document/drafts 中间路由占位页
 *
 * 该路径仅作为 `/dashboard/document/drafts/:id` 的中间段存在，无独立页面语义。
 * 定义本页主要为避免 Vue Router 在面包屑解析时对中间段抛出
 * `No match found for location with path "/dashboard/document/drafts"` 警告。
 *
 * 用户直接访问时静默重定向回文书生成首页。
 */
definePageMeta({
    layout: 'dashboard-layout',
    title: '编辑器',
})
onMounted(() => {

    router.back()
})
</script>

<template>
    <div />
</template>
