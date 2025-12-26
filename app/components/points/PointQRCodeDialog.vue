<template>
    <!-- 微信支付二维码弹框 -->
    <Dialog v-model:open="dialogOpen">
        <DialogContent class="sm:max-w-[425px]">
            <DialogHeader>
                <DialogTitle>请使用微信扫码购买</DialogTitle>
                <DialogDescription>打开微信扫一扫，立即购买积分</DialogDescription>
            </DialogHeader>
            <div class="flex justify-center py-4">
                <img :src="qrCodeUrl" alt="微信支付二维码" class="w-64 h-64" />
            </div>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
// ==================== Props ====================

interface Props {
    /** 是否显示对话框 */
    open: boolean;
    /** 二维码 URL */
    qrCodeUrl: string;
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
