<script setup lang="ts">
/**
 * PDF 导出选项对话框（M6.2 Task 16）
 *
 * 用户在风险清单面板点击"导出 PDF"后弹出，二选一：
 * - 仅摘要（不含风险批注）— default
 * - 含风险批注（完整版）
 *
 * 确认后父组件拿到 includeRisks=boolean，调用 composable.onExportPdf。
 *
 * **Feature: contract-review-m6.2**
 */

defineProps<{ open: boolean }>()
const emit = defineEmits<{
    'update:open': [value: boolean]
    confirm: [includeRisks: boolean]
    cancel: []
}>()

const mode = ref<'summary' | 'full'>('summary')

function handleConfirm() {
    emit('confirm', mode.value === 'full')
    emit('update:open', false)
}

function handleCancel() {
    emit('cancel')
    emit('update:open', false)
}
</script>

<template>
    <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>导出 PDF</DialogTitle>
                <DialogDescription>选择导出内容范围</DialogDescription>
            </DialogHeader>

            <div class="space-y-3 py-2">
                <RadioGroup v-model="mode" class="flex flex-col gap-3">
                    <div class="flex items-start gap-2">
                        <RadioGroupItem id="pdf-mode-summary" value="summary" class="mt-0.5" />
                        <Label for="pdf-mode-summary" class="leading-snug font-normal cursor-pointer">
                            <div class="font-medium">仅摘要</div>
                            <div class="text-xs text-muted-foreground mt-0.5">只包含合同审查摘要，不含风险批注</div>
                        </Label>
                    </div>
                    <div class="flex items-start gap-2">
                        <RadioGroupItem id="pdf-mode-full" value="full" class="mt-0.5" />
                        <Label for="pdf-mode-full" class="leading-snug font-normal cursor-pointer">
                            <div class="font-medium">含风险批注（完整版）</div>
                            <div class="text-xs text-muted-foreground mt-0.5">包含摘要 + 所有风险条目的完整分析</div>
                        </Label>
                    </div>
                </RadioGroup>
            </div>

            <DialogFooter>
                <Button variant="outline" @click="handleCancel">取消</Button>
                <Button class="bg-gradient-brand-button text-white" @click="handleConfirm">确认</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
