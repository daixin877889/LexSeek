<template>
    <Dialog v-model:open="isOpen">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>确认归档</DialogTitle>
                <DialogDescription>归档后案件将变为只读，无法编辑、分析或写入记忆。此操作不可恢复。</DialogDescription>
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
import { Loader2 } from 'lucide-vue-next'

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
