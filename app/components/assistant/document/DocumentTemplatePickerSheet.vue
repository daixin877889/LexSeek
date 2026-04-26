<script setup lang="ts">
import AssistantDocumentTemplateBrowser from '~/components/assistant/document/TemplateBrowser.vue'
/**
 * 文书模板选择 Sheet
 *
 * 案件详情页里点「+ 新建文书」弹出：内嵌 TemplateBrowser；用户选中模板后
 * emit('select', templateId)，由父级负责 POST 创建草稿并跳转。
 *
 * 本组件仅做布局包装，无业务状态。
 */
defineProps<{
    open: boolean
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    select: [templateId: number]
}>()

function onOpenChange(v: boolean) {
    emit('update:open', v)
}

function onSelect(templateId: number) {
    emit('select', templateId)
}
</script>

<template>
    <Sheet :open="open" @update:open="onOpenChange">
        <SheetContent
            side="right"
            class="w-full sm:w-[60vw] sm:max-w-[900px] z-[70] p-0 flex flex-col"
        >
            <SheetHeader class="shrink-0 p-4 border-b">
                <SheetTitle>选择文书模板</SheetTitle>
                <SheetDescription>
                    选中模板后会自动新建草稿并跳转到编辑页
                </SheetDescription>
            </SheetHeader>
            <div class="flex-1 min-h-0 overflow-y-auto p-4">
                <AssistantDocumentTemplateBrowser @select="onSelect" />
            </div>
        </SheetContent>
    </Sheet>
</template>
