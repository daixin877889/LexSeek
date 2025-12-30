<template>
    <!-- 积分支付二维码弹框（基于通用组件） -->
    <PaymentQRCodeDialog :open="open" :qr-code-url="qrCodeUrl" :loading="loading" :paid="paid" title="请使用微信扫码购买"
        description="打开微信扫一扫，立即购买积分" success-description="积分已到账，感谢您的支持！" success-message="积分已到账"
        @update:open="emit('update:open', $event)" @close="emit('close')" />
</template>

<script lang="ts" setup>
// 定义 props
defineProps<{
    open: boolean;
    qrCodeUrl: string;
    loading?: boolean;
    paid?: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    "update:open": [value: boolean];
    close: [];
}>();
</script>
