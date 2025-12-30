<template>
    <!-- 购买流程组件：集成认证弹框和支付二维码弹框 -->

    <!-- 认证弹框 -->
    <AuthModal v-model:open="showAuthModal" :default-tab="authModalTab" title="登录或注册" description="请登录或注册以继续购买"
        @success="handleAuthSuccess" @cancel="handleAuthCancel" />

    <!-- 支付二维码弹框 -->
    <MembershipQRCodeDialog v-model:open="showQRCodeDialog" :qr-code-url="qrCodeUrl" :loading="paymentLoading"
        :paid="paymentPaid" @close="closeQRCodeDialog" />
</template>

<script lang="ts" setup>
import { PaymentChannel, PaymentMethod, DurationUnit } from "#shared/types/payment";

// Props
const props = defineProps<{
    /** 是否显示认证弹框 */
    showAuthModal?: boolean;
    /** 认证弹框默认 Tab */
    authModalTab?: 'login' | 'register';
    /** 是否显示支付二维码弹框 */
    showQRCodeDialog?: boolean;
    /** 支付二维码 URL */
    qrCodeUrl?: string;
    /** 支付加载状态 */
    paymentLoading?: boolean;
    /** 是否已支付 */
    paymentPaid?: boolean;
}>();

// Emits
const emit = defineEmits<{
    /** 更新认证弹框状态 */
    'update:showAuthModal': [value: boolean];
    /** 更新支付弹框状态 */
    'update:showQRCodeDialog': [value: boolean];
    /** 认证成功 */
    authSuccess: [];
    /** 认证取消 */
    authCancel: [];
    /** 关闭支付弹框 */
    closeQRCode: [];
}>();

// 双向绑定
const showAuthModal = computed({
    get: () => props.showAuthModal ?? false,
    set: (value) => emit('update:showAuthModal', value),
});

const authModalTab = computed(() => props.authModalTab ?? 'login');

const showQRCodeDialog = computed({
    get: () => props.showQRCodeDialog ?? false,
    set: (value) => emit('update:showQRCodeDialog', value),
});

const qrCodeUrl = computed(() => props.qrCodeUrl ?? '');
const paymentLoading = computed(() => props.paymentLoading ?? false);
const paymentPaid = computed(() => props.paymentPaid ?? false);

/**
 * 认证成功回调
 */
const handleAuthSuccess = () => {
    emit('authSuccess');
};

/**
 * 认证取消回调
 */
const handleAuthCancel = () => {
    emit('authCancel');
};

/**
 * 关闭二维码弹框
 */
const closeQRCodeDialog = () => {
    emit('closeQRCode');
};
</script>
