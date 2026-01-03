<template>
    <!-- 积分支付弹框（基于通用组件，支持扫码和 JSAPI） -->
    <PaymentQRCodeDialog :open="open" :qr-code-url="qrCodeUrl" :loading="loading" :paid="paid" :use-jsapi="useJsapi"
        :jsapi-params="jsapiParams" title="请使用微信扫码购买" description="打开微信扫一扫，立即购买积分" success-description="积分已到账，感谢您的支持！"
        success-message="积分已到账" @update:open="emit('update:open', $event)" @close="emit('close')"
        @jsapi-result="emit('jsapiResult', $event)" />
</template>

<script lang="ts" setup>
import type { WechatPaymentParams, WechatPaymentResult } from "~/composables/useWechatPayment";

// 定义 props
defineProps<{
    open: boolean;
    qrCodeUrl?: string;
    loading?: boolean;
    paid?: boolean;
    /** 是否使用 JSAPI 支付 */
    useJsapi?: boolean;
    /** JSAPI 支付参数 */
    jsapiParams?: WechatPaymentParams;
}>();

// 定义 emits
const emit = defineEmits<{
    "update:open": [value: boolean];
    close: [];
    /** JSAPI 支付结果 */
    jsapiResult: [result: WechatPaymentResult];
}>();
</script>
