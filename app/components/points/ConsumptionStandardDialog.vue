<template>
    <!-- 积分消耗标准弹框 -->
    <Dialog v-model:open="dialogOpen">
        <DialogContent class="sm:max-w-[800px] max-h-[80vh] flex flex-col"
            @openAutoFocus="(e: any) => e.preventDefault()">
            <DialogHeader class="shrink-0">
                <DialogTitle>积分消耗标准</DialogTitle>
                <DialogDescription>查看各功能模块的积分消耗详情</DialogDescription>
            </DialogHeader>
            <div class="py-4 overflow-y-auto flex-1">
                <!-- 使用积分消耗标准组件 -->
                <PointsConsumptionStandard />
            </div>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
// ==================== Props ====================

interface Props {
    /** 是否显示对话框 */
    open: boolean;
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
    /** 更新显示状态 */
    (e: "update:open", value: boolean): void;
}>();

// ==================== 状态 ====================

// 对话框显示状态（双向绑定）
const dialogOpen = computed({
    get: () => props.open,
    set: (value) => emit("update:open", value),
});
</script>
