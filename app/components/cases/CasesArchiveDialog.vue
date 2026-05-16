<template>
    <Dialog v-model:open="isOpen">
        <DialogContent>
            <DialogHeader>
                <div class="flex items-start gap-3.5">
                    <div class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[image:var(--tint-amber-bg)] text-[color:var(--tint-amber-fg)]">
                        <Archive class="size-5" />
                    </div>
                    <div class="space-y-1.5 text-left">
                        <DialogTitle>确认归档案件</DialogTitle>
                        <DialogDescription>归档后案件将变为只读，无法编辑、分析或写入记忆。此操作不可恢复。</DialogDescription>
                    </div>
                </div>
            </DialogHeader>
            <DialogFooter>
                <Button variant="outline" :disabled="loading" @click="isOpen = false">取消</Button>
                <Button variant="destructive" :disabled="loading" @click="handleConfirm">
                    <Loader2 v-if="loading" class="h-4 w-4 animate-spin mr-2" />
                    {{ loading ? '归档中...' : '确认归档' }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
import { Loader2, Archive } from 'lucide-vue-next'

defineProps<{
    loading?: boolean
}>()

const isOpen = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    confirm: []
}>()

function handleConfirm() {
    emit('confirm')
}
</script>
