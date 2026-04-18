<script setup lang="ts">
/**
 * 文书生成首页
 *
 * 顶部：选模板立即创建草稿并跳工作区
 * 下方：我的草稿列表（DraftList）
 *
 * 案件场景仍走 caseDetail 的 DocumentDraftPanel，本页不受影响。
 * 注：「管理我的模板」入口由 DocumentTemplatePicker 内部提供，此处不重复。
 */
definePageMeta({
    layout: 'dashboard-layout',
    title: '文书生成',
    icon: 'FileText',
})

async function handleTemplateSelect(templateId: number) {
    const result = await useApiFetch<{ draftId: number; sessionId: string }>(
        '/api/v1/assistant/document/drafts',
        { method: 'POST', body: { templateId } },
    )
    if (!result) return
    navigateTo(`/dashboard/document/drafts/${result.draftId}`)
}
</script>

<template>
    <div class="p-4 md:p-6 space-y-6">
        <header>
            <h1 class="text-2xl md:text-3xl font-bold mb-1">文书生成</h1>
            <p class="text-muted-foreground text-sm">选择模板创建草稿，或从下方继续未完成的草稿</p>
        </header>

        <section class="rounded-lg border bg-card p-4">
            <h2 class="text-lg font-semibold mb-3">新建文书</h2>
            <AssistantDocumentTemplatePicker @select="handleTemplateSelect" />
        </section>

        <AssistantDocumentDraftList />
    </div>
</template>
