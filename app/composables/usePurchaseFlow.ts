/**
 * 购买流程 Composable
 *
 * 封装会员购买的核心逻辑，支持：
 * - 登录状态检测
 * - 认证弹框控制
 * - 订单创建
 * - 支付状态轮询
 * - 微信浏览器特殊处理
 */

import { PaymentChannel, PaymentMethod, DurationUnit } from "#shared/types/payment";

/** 购买流程配置选项 */
export interface UsePurchaseFlowOptions {
    /** 购买成功回调 */
    onSuccess?: () => void;
    /** 取消购买回调 */
    onCancel?: () => void;
    /** 购买失败回调 */
    onError?: (message: string) => void;
}

/** 支付创建响应 */
interface PaymentCreateResponse {
    orderNo: string;
    transactionNo: string;
    amount: number;
    codeUrl: string;
    h5Url: string;
}

/** 支付状态查询响应 */
interface PaymentQueryResponse {
    paid: boolean;
}

/**
 * 购买流程 Composable
 */
export function usePurchaseFlow(options?: UsePurchaseFlowOptions) {
    const authStore = useAuthStore();

    // ==================== 状态定义 ====================

    /** 是否显示认证弹框 */
    const showAuthModal = ref(false);

    /** 认证弹框默认 Tab */
    const authModalTab = ref<'login' | 'register'>('login');

    /** 是否显示支付二维码弹框 */
    const showQRCodeDialog = ref(false);

    /** 支付二维码 URL */
    const qrCodeUrl = ref('');

    /** 支付加载状态 */
    const paymentLoading = ref(false);

    /** 是否已支付 */
    const paymentPaid = ref(false);

    /** 待购买的商品 ID（用于登录后继续购买） */
    const pendingProductId = ref<number | null>(null);

    /** 当前支付单号 */
    const currentTransactionNo = ref('');

    /** 轮询定时器 */
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // ==================== 核心方法 ====================

    /**
     * 发起购买
     * @param productId 商品 ID
     */
    const buy = async (productId: number) => {
        // 移除当前焦点，避免 aria-hidden 警告
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        // 微信浏览器特殊处理：跳转到专用购买页面
        if (isWeChatBrowser()) {
            window.location.href = `/dashboard/buy/${productId}`;
            return;
        }

        // 检测登录状态
        if (!authStore.isAuthenticated) {
            // 未登录：保存商品 ID，显示认证弹框
            pendingProductId.value = productId;
            showAuthModal.value = true;
            return;
        }

        // 已登录：直接创建订单
        await createPayment(productId);
    };

    /**
     * 创建支付订单
     * @param productId 商品 ID
     */
    const createPayment = async (productId: number) => {
        paymentLoading.value = true;

        // 根据产品 ID 决定购买周期
        // productId 10 是新手旗舰套餐，按月购买；其他产品按年购买
        const durationUnit = productId === 10 ? DurationUnit.MONTH : DurationUnit.YEAR;

        const result = await useApiFetch<PaymentCreateResponse>("/api/v1/payments/create", {
            method: "POST",
            body: {
                productId,
                duration: 1,
                durationUnit,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.SCAN_CODE,
            },
        });

        paymentLoading.value = false;

        if (!result) {
            options?.onError?.('创建订单失败');
            return;
        }

        // 保存支付信息
        currentTransactionNo.value = result.transactionNo;
        qrCodeUrl.value = result.codeUrl;
        paymentPaid.value = false;

        // 显示二维码弹框
        showQRCodeDialog.value = true;

        // 开始轮询支付状态
        startPollingPaymentStatus();
    };

    /**
     * 认证成功回调
     */
    const handleAuthSuccess = () => {
        showAuthModal.value = false;

        // 如果有待购买的商品，继续购买流程
        if (pendingProductId.value) {
            const productId = pendingProductId.value;
            pendingProductId.value = null;
            createPayment(productId);
        }
    };

    /**
     * 认证取消回调
     */
    const handleAuthCancel = () => {
        showAuthModal.value = false;
        pendingProductId.value = null;
        options?.onCancel?.();
    };

    /**
     * 关闭二维码弹框
     */
    const closeQRCodeDialog = () => {
        showQRCodeDialog.value = false;
        stopPollingPaymentStatus();
        currentTransactionNo.value = '';
        qrCodeUrl.value = '';
        paymentPaid.value = false;
    };

    /**
     * 开始轮询支付状态
     */
    const startPollingPaymentStatus = () => {
        // 清除之前的定时器
        stopPollingPaymentStatus();

        // 每 2 秒查询一次支付状态
        pollTimer = setInterval(async () => {
            if (!currentTransactionNo.value) {
                stopPollingPaymentStatus();
                return;
            }

            const result = await useApiFetch<PaymentQueryResponse>(
                `/api/v1/payments/query?transactionNo=${currentTransactionNo.value}&sync=true`,
                { showError: false }
            );

            if (result?.paid) {
                // 支付成功
                paymentPaid.value = true;
                stopPollingPaymentStatus();
                toast.success("支付成功！");

                // 触发成功回调
                options?.onSuccess?.();

                // 2 秒后关闭弹框
                setTimeout(() => {
                    closeQRCodeDialog();
                }, 2000);
            }
        }, 2000);
    };

    /**
     * 停止轮询支付状态
     */
    const stopPollingPaymentStatus = () => {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    // 组件卸载时清理定时器
    onUnmounted(() => {
        stopPollingPaymentStatus();
    });

    return {
        // 状态
        showAuthModal,
        authModalTab,
        showQRCodeDialog,
        qrCodeUrl,
        paymentLoading,
        paymentPaid,
        pendingProductId,
        currentTransactionNo,

        // 方法
        buy,
        handleAuthSuccess,
        handleAuthCancel,
        closeQRCodeDialog,
        startPollingPaymentStatus,
        stopPollingPaymentStatus,
    };
}
