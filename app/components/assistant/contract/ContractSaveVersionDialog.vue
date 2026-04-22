<script setup lang="ts">
// 自动导入：ref/watch 不要显式 import
import { Loader2 } from 'lucide-vue-next'

const props = defineProps<{
    open: boolean
}>()
const emit = defineEmits<{
    'update:open': [value: boolean]
    'confirm': [lawyerNote: string | null]
}>()

const lawyerNote = ref('')
const submitting = ref(false)

watch(() => props.open, (v) => {
    if (!v) {
        lawyerNote.value = ''
        submitting.value = false
    }
})

async function handleConfirm() {
    submitting.value = true
    try {
        emit('confirm', lawyerNote.value.trim() || null)
    } finally {
        submitting.value = false
    }
}
</script>

<template>
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="sm:max-w-[480px]">
            <DialogHeader>
                <DialogTitle>保存新版本</DialogTitle>
            </DialogHeader>
            <div class="space-y-3 py-2">
                <p class="text-sm text-muted-foreground">
                    把当前工作区状态定格为一个不可修改的版本快照。
                </p>
                <div>
                    <Label class="text-xs">版本备注（可选）</Label>
                    <Textarea
                        v-model="lawyerNote"
                        placeholder="例如：发张三法务审阅"
                        :rows="3"
                        :maxlength="200"
                        class="mt-1"
                    />
                    <div class="text-[11px] text-muted-foreground text-right mt-1">{{ lawyerNote.length }} / 200</div>
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" @click="emit('update:open', false)">取消</Button>
                <Button :disabled="submitting" @click="handleConfirm">
                    <Loader2 v-if="submitting" class="size-4 mr-1 animate-spin" />
                    保存版本
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
