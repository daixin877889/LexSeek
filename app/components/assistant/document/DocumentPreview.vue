<script setup lang="ts">
/**
 * 文书预览组件（M4 占位版）
 *
 * - M4 阶段：显示"导出 .docx"按钮，由 DocumentDraftPanel 触发 onExport
 * - M5 阶段：补 docx-preview + TreeWalker 实时预览
 */
defineProps<{
    templateBuffer?: ArrayBuffer | null
    values: Record<string, string | null>
    disabled?: boolean
}>()

const emit = defineEmits<{ export: [] }>()

function handleExport() {
    emit('export')
}
</script>

<template>
    <div class="rounded-lg border bg-muted/10 p-6 flex flex-col items-center justify-center min-h-[160px] gap-3">
        <FileTextIcon class="size-10 text-muted-foreground/60" />
        <p class="text-sm text-muted-foreground">准备就绪，可导出 .docx 文书</p>
        <Button :disabled="disabled" @click="handleExport">
            <DownloadIcon class="size-4 mr-2" />
            导出 .docx
        </Button>
    </div>
</template>
