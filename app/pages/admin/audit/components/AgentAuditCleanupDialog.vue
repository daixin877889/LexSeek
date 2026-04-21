<template>
    <AlertDialog v-model:open="isOpen">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>确认清理审计日志</AlertDialogTitle>
                <AlertDialogDescription>
                    将硬删除指定日期之前的全部审计记录，操作不可撤销。当前总记录数 {{ total }} 条。
                </AlertDialogDescription>
            </AlertDialogHeader>

            <div class="py-2 space-y-2">
                <label class="text-sm text-muted-foreground">删除此日期之前的记录</label>
                <GeneralDatePicker v-model="beforeDate" placeholder="选择截止日期" clearable class="w-full" />
            </div>

            <AlertDialogFooter>
                <AlertDialogCancel :disabled="loading">取消</AlertDialogCancel>
                <AlertDialogAction
                    :disabled="loading || !beforeDate"
                    class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    @click="handleConfirm"
                >
                    <Loader2 v-if="loading" class="h-4 w-4 animate-spin mr-2" />
                    {{ loading ? '清理中...' : '确认删除' }}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const isOpen = defineModel<boolean>('open', { default: false })
defineProps<{ total: number }>()
const emit = defineEmits<{ cleaned: [] }>()

const beforeDate = ref('')
const loading = ref(false)

async function handleConfirm() {
    if (!beforeDate.value) return
    loading.value = true
    try {
        const resp = await useApiFetch<{ deleted: number }>('/api/v1/admin/agent-audit-logs', {
            method: 'DELETE',
            body: { beforeDate: beforeDate.value },
        })
        if (resp) {
            toast.success(`已清理 ${resp.deleted} 条记录`)
            emit('cleaned')
            isOpen.value = false
        }
    } finally {
        loading.value = false
    }
}
</script>
