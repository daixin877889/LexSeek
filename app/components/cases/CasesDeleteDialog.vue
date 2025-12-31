<template>
    <!-- 删除确认弹框 -->
    <AlertDialog v-model:open="isOpen">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>确认删除案件</AlertDialogTitle>
                <AlertDialogDescription>
                    此操作将永久删除该案件及其所有分析结果，且无法恢复。是否继续？
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel :disabled="loading">取消</AlertDialogCancel>
                <AlertDialogAction @click="handleConfirm" :disabled="loading"
                    class="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    <Loader2 v-if="loading" class="h-4 w-4 animate-spin mr-2" />
                    {{ loading ? '删除中...' : '确认删除' }}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>

<script lang="ts" setup>
import { Loader2 } from "lucide-vue-next";

// ==================== Props ====================

defineProps<{
    loading?: boolean;
}>();

// ==================== Model ====================

const isOpen = defineModel<boolean>("open", { default: false });

// ==================== Emits ====================

const emit = defineEmits<{
    confirm: [];
}>();

// ==================== 方法 ====================

/**
 * 处理确认删除
 */
const handleConfirm = () => {
    emit("confirm");
};
</script>
