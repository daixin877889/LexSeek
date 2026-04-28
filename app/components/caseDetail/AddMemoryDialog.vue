<script setup lang="ts">
/**
 * 案件记忆 - 用户手动添加 Dialog
 *
 * 表单：
 * - 内容（textarea，min 5 字）
 * - 类型（fact / event / decision / note）
 *
 * subject_key 不暴露给用户，由后端 caseMemorySubjectInfer 节点自动推断。
 *
 * 提交调 useCaseMemory.add()，成功 toast + 关闭。
 */
import { ref, computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import toast from '#shared/utils/toast'
import type { AddMemoryPayload } from '~/composables/useCaseMemory'
import type { MemoryKind } from '#shared/types/memory'

defineProps<{
    open: boolean
}>()

const emit = defineEmits<{
    'update:open': [value: boolean]
    submit: [payload: AddMemoryPayload, done: (ok: boolean) => void]
}>()

const text = ref('')
const kind = ref<MemoryKind>('fact')
const submitting = ref(false)

const KIND_OPTIONS: Array<{ value: MemoryKind; label: string }> = [
    { value: 'fact', label: '事实（fact）' },
    { value: 'event', label: '事件（event）' },
    { value: 'decision', label: '决策（decision）' },
    { value: 'note', label: '笔记（note）' },
]

const canSubmit = computed(() => text.value.trim().length >= 5 && !submitting.value)

function reset() {
    text.value = ''
    kind.value = 'fact'
    submitting.value = false
}

function handleClose(value: boolean) {
    if (!value) reset()
    emit('update:open', value)
}

function handleSubmit() {
    if (!canSubmit.value) return
    submitting.value = true
    const payload: AddMemoryPayload = {
        text: text.value.trim(),
        kind: kind.value,
    }
    emit('submit', payload, (ok) => {
        submitting.value = false
        if (ok) {
            toast.success('已添加')
            reset()
            emit('update:open', false)
        }
    })
}
</script>

<template>
    <Dialog :open="open" @update:open="handleClose">
        <DialogContent class="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>添加案件记忆</DialogTitle>
                <DialogDescription>
                    手动记录案件相关的关键事实。AI 会自动归类，后续对话时可检索引用。
                </DialogDescription>
            </DialogHeader>

            <div class="space-y-4 py-2">
                <div class="space-y-1.5">
                    <Label for="memory-text">内容 <span class="text-destructive">*</span></Label>
                    <Textarea id="memory-text" v-model="text"
                        placeholder="例如：原告住北京市朝阳区..."
                        class="min-h-[100px]"
                        :maxlength="500" />
                    <p class="text-[11px] text-muted-foreground">{{ text.length }}/500（至少 5 字）</p>
                </div>

                <div class="space-y-1.5">
                    <Label for="memory-kind">类型 <span class="text-destructive">*</span></Label>
                    <Select v-model="kind">
                        <SelectTrigger id="memory-kind" class="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem v-for="opt in KIND_OPTIONS" :key="opt.value" :value="opt.value">
                                {{ opt.label }}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" @click="handleClose(false)">取消</Button>
                <Button :disabled="!canSubmit" @click="handleSubmit">
                    <Loader2 v-if="submitting" class="size-4 mr-2 animate-spin" />
                    保存
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
