<script setup lang="ts">
/**
 * 文书生成独立页（路由 /dashboard/assistant/document）
 *
 * 独立使用场景：用户在侧栏"文书生成"菜单进入，不带 caseId。
 * 案件场景由 caseDetail 的 documents tab 复用 DocumentDraftPanel（Task 6.1）。
 */
definePageMeta({
    layout: 'dashboard-layout',
    title: '文书生成',
    icon: 'FileText',
})
</script>

<template>
    <div class="container mx-auto max-w-6xl p-4 md:p-6">
        <header class="mb-6">
            <h1 class="text-2xl font-bold mb-1">文书生成</h1>
            <p class="text-sm text-muted-foreground">
                选择模板、提供材料，AI 自动填充文书字段，一键导出 .docx
            </p>
        </header>
        <DocumentDraftPanel />
    </div>
</template>
