<template>
    <div class="min-h-screen bg-background">
        <!-- 加载状态 -->
        <div v-if="loading" class="flex flex-col items-center justify-center min-h-[60vh]">
            <Loader2 class="w-12 h-12 animate-spin text-primary mb-4" />
            <p class="text-muted-foreground">正在准备支付...</p>
        </div>

        <!-- 商品信息和支付 -->
        <div v-else-if="product" class="max-w-lg mx-auto p-4 pt-8">
            <!-- 商品卡片 -->
            <div class="bg-card rounded-lg border p-6 mb-6">
                <h1 class="text-2xl font-bold mb-2">{{ product.name }}</h1>
                <p class="text-muted-foreground mb-4">{{ product.description }}</p>

                <div class="flex items-baseline gap-2 mb-4">
                    <span class="text-3xl font-bold text-primary">
                        ¥{{ displayPrice }}
                    </span>
                    <span v-if="(originalPrice ?? 0) > (displayPrice ?? 0)"
                        class="text-lg text-muted-foreground line-through">
                        ¥{{ originalPrice }}
                    </span>
                    <span class="text-sm text-muted-foreground">
                        /{{ durationText }}
                    </span>
                </div>

                <div v-if="(product.giftPoint ?? 0) > 0" class="text-sm text-amber-600 mb-4">
                    赠送 {{ product.giftPoint }} 积分
                </div>

                <!-- 购买协议 -->
                <div class="flex items-start space-x-2 mb-6">
                    <Checkbox id="agreement" v-model="agreedToAgreement" class="mt-1" />
                    <label for="agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                        购买即同意
                        <NuxtLink to="/purchase-agreement" target="_blank"
                            class="text-primary hover:underline font-bold">
                            《LexSeek（法索 AI）服务购买协议》
                        </NuxtLink>
                    </label>
                </div>

                <!-- 支付按钮 -->
                <Button @click="handlePay" :disabled="!agreedToAgreement || paying" class="w-full" size="lg">
                    <Loader2 v-if="paying" class="w-4 h-4 mr-2 animate-spin" />
                    {{ paying ? '正在唤起支付...' : '立即支付' }}
                </Button>
            </div>

            <!-- 返回链接 -->
            <div class="text-center">
                <NuxtLink to="/pricing" class="text-sm text-muted-foreground hover:text-primary">
                    ← 返回价格页面
                </NuxtLink>
            </div>
        </div>

        <!-- 商品不存在 -->
        <div v-else class="flex flex-col items-center justify-center min-h-[60vh]">
            <p class="text-muted-foreground mb-4">商品不存在或已下架</p>
            <NuxtLink to="/pricing" class="text-primary hover:underline">
                返回价格页面
            </NuxtLink>
        </div>

        <!-- 支付结果弹框 -->
        <PaymentQRCodeDialog v-model:open="showPaymentDialog" :loading="paymentLoading" :paid="paymentPaid"
            :use-jsapi="true" :jsapi-params="jsapiParams" success-description="感谢您的支持！" success-message="正在跳转..."
            @close="handlePaymentClose" @jsapi-result="handleJsapiResult" />

        <!-- 登录弹框 -->
        <AuthModal v-model:open="showAuthModal" default-tab="login" @success="handleAuthSuccess" />
    </div>
</template>

<script lang="ts" setup>
import { Loader2 } from "lucide-vue-next";
import { PaymentChannel, PaymentMethod, DurationUnit } from "#shared/types/payment";
import type { ProductInfo } from "#shared/types/product";
import type { WechatPaymentParams, WechatPaymentResult } from "~/composables/useWechatPayment";

// 页面元信息
definePageMeta({
    layout: "base-layout",
    title: "购买会员",
});

// 路由参数
const route = useRoute();
const productId = computed(() => Number(route.params.id));

// 微信支付 composable
const { isInWechat, ensureOpenId, redirectToAuth } = useWechatPayment();

// 认证 store
const authStore = useAuthStore();

// ==================== 状态定义 ====================
const loading = ref(true);
const product = ref<ProductInfo | null>(null);
const agreedToAgreement = ref(true);
const paying = ref(false);

// 登录弹框状态
const showAuthModal = ref(false);

// 支付弹框状态
const showPaymentDialog = ref(false);
const paymentLoading = ref(false);
const paymentPaid = ref(false);
const jsapiParams = ref<WechatPaymentParams | undefined>(undefined);
const currentTransactionNo = ref("");

// 轮询定时器
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ==================== 计算属性 ====================

/** 购买周期（新手套餐按月，其他按年） */
const durationUnit = computed(() => {
    return productId.value === 10 ? DurationUnit.MONTH : DurationUnit.YEAR;
});

/** 显示价格 */
const displayPrice = computed(() => {
    if (!product.value) return 0;
    return durationUnit.value === DurationUnit.MONTH
        ? product.value.priceMonthly
        : product.value.priceYearly;
});

/** 原价 */
const originalPrice = computed(() => {
    if (!product.value) return 0;
    return durationUnit.value === DurationUnit.MONTH
        ? (product.value.originalPriceMonthly ?? product.value.priceMonthly)
        : (product.value.originalPriceYearly ?? product.value.priceYearly);
});

/** 周期文本 */
const durationText = computed(() => {
    return durationUnit.value === DurationUnit.MONTH ? '月' : '年';
});

// ==================== 方法定义 ====================

/**
 * 加载商品信息
 */
const loadProduct = async () => {
    loading.value = true;

    const result = await useApiFetch<ProductInfo>(`/api/v1/products/${productId.value}`, {
        showError: false,
    });

    product.value = result;
    loading.value = false;
};

/**
 * 处理支付
 */
const handlePay = async () => {
    if (!product.value || paying.value) return;

    // 检查登录状态
    if (!authStore.isAuthenticated) {
        showAuthModal.value = true;
        return;
    }

    // 检查是否在微信浏览器中
    if (!isInWechat.value) {
        toast.error("请在微信浏览器中打开此页面");
        return;
    }

    paying.value = true;

    try {
        // 确保有 OpenID
        const currentOpenId = await ensureOpenId();
        if (!currentOpenId) {
            // 没有 OpenID，需要授权
            redirectToAuth();
            return;
        }

        // 创建 JSAPI 支付订单
        const result = await useApiFetch<{
            orderNo: string;
            transactionNo: string;
            amount: number;
            paymentParams: WechatPaymentParams;
        }>("/api/v1/payments/create", {
            method: "POST",
            body: {
                productId: productId.value,
                duration: 1,
                durationUnit: durationUnit.value,
                paymentChannel: PaymentChannel.WECHAT,
                paymentMethod: PaymentMethod.MINI_PROGRAM,
                openid: currentOpenId,
            },
        });

        if (!result) {
            paying.value = false;
            return;
        }

        // 设置支付参数
        currentTransactionNo.value = result.transactionNo;
        jsapiParams.value = result.paymentParams;
        paymentPaid.value = false;
        paymentLoading.value = false;

        // 显示支付弹框
        showPaymentDialog.value = true;
    } catch (error) {
        console.error("[buy] 创建支付订单失败:", error);
        toast.error("创建订单失败，请重试");
    } finally {
        paying.value = false;
    }
};

/**
 * 处理 JSAPI 支付结果
 */
const handleJsapiResult = async (result: WechatPaymentResult) => {
    if (result === 'ok') {
        // 支付成功，查询后端确认
        paymentLoading.value = true;

        const queryResult = await useApiFetch<{ paid: boolean }>(
            `/api/v1/payments/query?transactionNo=${currentTransactionNo.value}&sync=true`,
            { showError: false }
        );

        if (queryResult?.paid) {
            paymentPaid.value = true;
            toast.success("支付成功！");

            // 2 秒后跳转到会员页面
            setTimeout(() => {
                navigateTo("/dashboard/membership/level");
            }, 2000);
        } else {
            paymentLoading.value = false;
            toast.info("支付处理中，请稍候...");
            // 开始轮询
            startPollingPaymentStatus();
        }
    } else if (result === 'cancel') {
        toast.info("支付已取消");
    } else {
        toast.error("支付失败，请重试");
    }
};

/**
 * 开始轮询支付状态
 */
const startPollingPaymentStatus = () => {
    stopPollingPaymentStatus();

    pollTimer = setInterval(async () => {
        if (!currentTransactionNo.value) {
            stopPollingPaymentStatus();
            return;
        }

        const result = await useApiFetch<{ paid: boolean }>(
            `/api/v1/payments/query?transactionNo=${currentTransactionNo.value}&sync=true`,
            { showError: false }
        );

        if (result?.paid) {
            paymentPaid.value = true;
            stopPollingPaymentStatus();
            toast.success("支付成功！");

            setTimeout(() => {
                navigateTo("/dashboard/membership/level");
            }, 2000);
        }
    }, 2000);
};

/**
 * 停止轮询
 */
const stopPollingPaymentStatus = () => {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
};

/**
 * 关闭支付弹框
 */
const handlePaymentClose = () => {
    showPaymentDialog.value = false;
    stopPollingPaymentStatus();
    currentTransactionNo.value = "";
    jsapiParams.value = undefined;
};

/**
 * 登录成功回调
 */
const handleAuthSuccess = () => {
    showAuthModal.value = false;
    // 登录成功后继续支付流程
    handlePay();
};

// ==================== 生命周期 ====================

onMounted(() => {
    loadProduct();
});

onUnmounted(() => {
    stopPollingPaymentStatus();
});
</script>
