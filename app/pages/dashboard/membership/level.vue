<template>
  <div class="bg-card rounded-lg border p-6">
    <h2 class="text-xl font-semibold mb-2">会员等级</h2>

    <!-- 当前会员信息 -->
    <MembershipCurrentInfo :membership="currentMembership" @renew="openRenewalDialog" />

    <!-- Tab 导航 -->
    <Tabs :default-value="activeTab" @update:model-value="(val) => activeTab = String(val)" class="w-full">
      <TabsList class="grid w-full grid-cols-2">
        <TabsTrigger value="packages">会员套餐</TabsTrigger>
        <TabsTrigger value="records">会员记录</TabsTrigger>
      </TabsList>

      <!-- 会员套餐 Tab -->
      <TabsContent value="packages" class="mt-2">
        <div class="space-y-6">
          <!-- 套餐列表 -->
          <MembershipPackageList :product-list="productList" :selected-plan-level="selectedPlanLevel"
            :current-membership="currentMembership" :membership-levels="membershipLevels" :is-free-user="isFreeUser"
            v-model:agree-to-agreement="agreeToPurchaseAgreement" @select="selectPlan" @buy="buy"
            @upgrade="upgradeToPlan" />

          <!-- 会员权益 -->
          <MembershipBenefits :key="benefitsLevelName" :selected-level="benefitsLevelName" />
        </div>
      </TabsContent>

      <!-- 会员记录 Tab -->
      <TabsContent value="records" class="mt-6">
        <div>
          <h3 class="text-lg font-medium mb-4">会员记录</h3>

          <!-- 桌面端表格视图 -->
          <MembershipRecordTable :list="membershipHistory" :membership-levels="membershipLevels"
            @upgrade="openUpgradeDialog" />

          <!-- 移动端卡片视图 -->
          <MembershipRecordMobile :list="membershipHistory" :membership-levels="membershipLevels"
            @upgrade="openUpgradeDialog" />
        </div>
      </TabsContent>
    </Tabs>

    <!-- 支付弹框（支持扫码和 JSAPI） -->
    <MembershipQRCodeDialog v-model:open="showQRCode" :qr-code-url="qrCodeUrl" :loading="paymentLoading"
      :paid="paymentPaid" :use-jsapi="useJsapiPayment" :jsapi-params="jsapiParams" @close="closeQRCodeDialog"
      @jsapi-result="handleJsapiResult" />

    <!-- 升级弹框 -->
    <MembershipUpgradeDialog v-model:open="showUpgradeDialog" :loading="upgradeOptionsLoading" :options="upgradeOptions"
      :selected-option="selectedUpgradeOption" v-model:agree-to-agreement="agreeToPurchaseAgreement"
      @select="selectedUpgradeOption = $event" @confirm="confirmUpgrade" @close="closeUpgradeDialog" />

    <!-- 续期弹框 -->
    <MembershipRenewalDialog v-model:open="showRenewalDialog" :product-list="productList"
      v-model:agree-to-agreement="agreeToPurchaseAgreement" @buy="buy" />
  </div>
</template>

<script lang="ts" setup>
import { PaymentChannel, PaymentMethod, DurationUnit } from "#shared/types/payment";
import type { ProductInfo } from "#shared/types/product";
import type { WechatPaymentParams, WechatPaymentResult } from "~/composables/useWechatPayment";

// 页面元信息
definePageMeta({
  layout: "dashboard-layout",
  title: "我的会员",
});

// ==================== 类型定义 ====================

/** 会员套餐（与组件类型匹配） */
interface MembershipPlan {
  id: number;
  name: string;
  levelId: number;
  priceMonthly: number;
  priceYearly: number;
  originalPriceMonthly: number;
  originalPriceYearly: number;
  giftPoint: number;
  description: string;
  defaultDuration: number;
  purchaseLimit?: number | null;
}

/** 会员记录 */
interface MembershipRecord {
  id: number;
  levelId: number;
  levelName: string;
  startDate: string;
  endDate: string;
  sourceTypeName: string;
  status: number;
  createdAt: string;
}

/** 升级选项 */
interface UpgradeOption {
  levelId: number;
  levelName: string;
  upgradePrice: number;
  currentPrice: number;
  pointCompensation: number;
}

/** 会员等级 */
interface MembershipLevel {
  id: number;
  name: string;
  sortOrder: number;
}

// ==================== SSR 数据预取 ====================

// 获取当前会员信息
const { data: membershipData, refresh: refreshMembership } = await useApi<{
  levelId: number;
  levelName: string;
  expiresAt: string;
} | null>("/api/v1/memberships/me", {
  key: "membership-me",
});

// 获取会员商品列表（type=1 为会员商品）
const { data: productsData } = await useApi<ProductInfo[]>("/api/v1/products", {
  key: "membership-products",
  query: { type: 1 },
});

// 获取会员等级列表
const { data: levelsData } = await useApi<MembershipLevel[]>("/api/v1/memberships/levels", {
  key: "membership-levels",
});

// 获取会员历史记录
const { data: historyData, refresh: refreshHistory } = await useApi<{
  list: MembershipRecord[];
  total: number;
}>("/api/v1/memberships/history", {
  key: "membership-history",
  query: { page: 1, pageSize: 20 },
});

// ==================== 状态定义 ====================

// Tab 状态
const activeTab = ref("packages");
const selectedPlanLevel = ref("");

// 当前会员信息（响应式）
const currentMembership = computed(() => ({
  levelId: membershipData.value?.levelId ?? 0,
  levelName: membershipData.value?.levelName ?? "免费版",
  expiresAt: membershipData.value?.expiresAt ?? "",
}));

// 会员套餐列表（响应式）
const productList = computed<MembershipPlan[]>(() => {
  if (!productsData.value) return [];
  return productsData.value.map((p) => ({
    id: p.id,
    name: p.name,
    levelId: p.levelId ?? 0,
    priceMonthly: p.priceMonthly ?? 0,
    priceYearly: p.priceYearly ?? 0,
    originalPriceMonthly: p.originalPriceMonthly ?? p.priceMonthly ?? 0,
    originalPriceYearly: p.originalPriceYearly ?? p.priceYearly ?? 0,
    giftPoint: p.giftPoint ?? 0,
    description: p.description ?? "",
    defaultDuration: p.defaultDuration ?? 2, // 默认按年购买
    purchaseLimit: p.purchaseLimit ?? null,
  }));
});

// 会员记录（响应式）
const membershipHistory = computed<MembershipRecord[]>(() => {
  return historyData.value?.list ?? [];
});

// 会员等级列表（响应式）
const membershipLevels = computed<MembershipLevel[]>(() => {
  // 添加免费版
  const levels = levelsData.value ?? [];
  if (!levels.find((l) => l.id === 0)) {
    return [{ id: 0, name: "免费版", sortOrder: 0 }, ...levels];
  }
  return levels;
});

// 弹框状态
const showQRCode = ref(false);
const qrCodeUrl = ref("");
const showUpgradeDialog = ref(false);
const showRenewalDialog = ref(false);

// 支付相关状态
const paymentLoading = ref(false);
const paymentPaid = ref(false);
const currentTransactionNo = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;

// JSAPI 支付相关状态
const { isInWechat, openId, ensureOpenId, redirectToAuth } = useWechatPayment();
const useJsapiPayment = ref(false);
const jsapiParams = ref<WechatPaymentParams | undefined>(undefined);

// 升级相关
const upgradeOptionsLoading = ref(false);
const upgradeOptions = ref<UpgradeOption[]>([]);
const selectedUpgradeOption = ref<UpgradeOption | null>(null);
const currentUpgradeRecord = ref<MembershipRecord | null>(null);

// 购买协议
const agreeToPurchaseAgreement = ref(true);

// ==================== 计算属性 ====================

/** 是否为免费用户 */
const isFreeUser = computed(() => {
  return currentMembership.value.levelId === 0 || currentMembership.value.levelName === "免费版";
});

/** 权益表格显示的级别名称 */
const benefitsLevelName = computed(() => {
  const selectedPlan = productList.value.find((p) => p.name === selectedPlanLevel.value);
  if (selectedPlan) {
    return getLevelNameByLevelId(selectedPlan.levelId);
  }
  return selectedPlanLevel.value || "免费版";
});

// ==================== 方法定义 ====================

/**
 * 根据 levelId 获取级别名称
 */
const getLevelNameByLevelId = (levelId: number | null): string => {
  if (levelId === null) return "免费版";
  const level = membershipLevels.value.find((l) => l.id === levelId);
  return level?.name ?? "免费版";
};

/**
 * 选择套餐
 */
const selectPlan = (plan: MembershipPlan) => {
  selectedPlanLevel.value = plan.name;
};

/**
 * 打开弹框前移除当前焦点（避免 aria-hidden 警告）
 */
const blurActiveElement = () => {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
};

/**
 * 购买会员
 */
const buy = async (plan: MembershipPlan) => {
  // 关闭续期弹框
  showRenewalDialog.value = false;
  blurActiveElement();

  // 根据商品的 defaultDuration 确定购买周期
  // defaultDuration: 1-按月, 2-按年
  const durationUnit = plan.defaultDuration === 1 ? DurationUnit.MONTH : DurationUnit.YEAR;

  // 判断是否使用 JSAPI 支付
  const shouldUseJsapi = isInWechat.value;

  if (shouldUseJsapi) {
    // 微信环境：确保有 OpenID
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
        productId: plan.id,
        duration: 1,
        durationUnit,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.MINI_PROGRAM,
        openid: currentOpenId,
      },
    });

    if (!result) return;

    // 设置 JSAPI 支付参数
    currentTransactionNo.value = result.transactionNo;
    useJsapiPayment.value = true;
    jsapiParams.value = result.paymentParams;
    paymentPaid.value = false;
    paymentLoading.value = false;

    // 显示支付弹框
    showQRCode.value = true;
  } else {
    // 非微信环境：使用扫码支付
    const result = await useApiFetch<{
      orderNo: string;
      transactionNo: string;
      amount: number;
      codeUrl: string;
      h5Url: string;
    }>("/api/v1/payments/create", {
      method: "POST",
      body: {
        productId: plan.id,
        duration: 1,
        durationUnit,
        paymentChannel: PaymentChannel.WECHAT,
        paymentMethod: PaymentMethod.SCAN_CODE,
      },
    });

    if (!result) return;

    // 保存支付单号，用于轮询
    currentTransactionNo.value = result.transactionNo;
    qrCodeUrl.value = result.codeUrl;
    useJsapiPayment.value = false;
    jsapiParams.value = undefined;
    paymentPaid.value = false;
    paymentLoading.value = false;

    // 显示二维码弹框
    showQRCode.value = true;

    // 开始轮询支付状态
    startPollingPaymentStatus();
  }
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

    const result = await useApiFetch<{ paid: boolean }>(
      `/api/v1/payments/query?transactionNo=${currentTransactionNo.value}&sync=true`,
      { showError: false }
    );

    if (result?.paid) {
      // 支付成功
      paymentPaid.value = true;
      stopPollingPaymentStatus();
      toast.success("支付成功！");

      // 刷新会员信息和历史记录
      await Promise.all([refreshMembership(), refreshHistory()]);

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

/**
 * 关闭二维码弹框
 */
const closeQRCodeDialog = () => {
  showQRCode.value = false;
  stopPollingPaymentStatus();
  currentTransactionNo.value = "";
  qrCodeUrl.value = "";
  paymentPaid.value = false;
  useJsapiPayment.value = false;
  jsapiParams.value = undefined;
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

      // 刷新会员信息和历史记录
      await Promise.all([refreshMembership(), refreshHistory()]);

      // 2 秒后关闭弹框
      setTimeout(() => {
        closeQRCodeDialog();
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
 * 升级到指定套餐
 */
const upgradeToPlan = async (plan: MembershipPlan) => {
  blurActiveElement();

  // 获取升级选项
  upgradeOptionsLoading.value = true;
  showUpgradeDialog.value = true;

  // 调用 API 获取升级选项
  const result = await useApiFetch<{
    currentMembership: {
      id: number;
      levelId: number;
      levelName: string;
      endDate: string;
      remainingDays: number;
    };
    options: UpgradeOption[];
  }>("/api/v1/memberships/upgrade/options", {
    showError: false,
  });

  if (!result || !result.currentMembership) {
    toast.error("获取升级选项失败");
    upgradeOptionsLoading.value = false;
    showUpgradeDialog.value = false;
    return;
  }

  // 设置当前会员记录
  currentUpgradeRecord.value = {
    id: result.currentMembership.id,
    levelId: result.currentMembership.levelId,
    levelName: result.currentMembership.levelName,
    startDate: "",
    endDate: result.currentMembership.endDate,
    sourceTypeName: "",
    status: 1,
    createdAt: "",
  };

  // 从升级选项中找到目标套餐
  const targetOption = result.options.find((opt) => opt.levelId === plan.levelId);

  if (!targetOption) {
    toast.error(`无法升级到 ${plan.name}`);
    upgradeOptionsLoading.value = false;
    showUpgradeDialog.value = false;
    return;
  }

  upgradeOptions.value = result.options;
  selectedUpgradeOption.value = targetOption;
  upgradeOptionsLoading.value = false;
};

/**
 * 打开续期弹框
 */
const openRenewalDialog = () => {
  blurActiveElement();
  showRenewalDialog.value = true;
};

/**
 * 打开升级弹框
 */
const openUpgradeDialog = async (record: MembershipRecord) => {
  blurActiveElement();
  currentUpgradeRecord.value = record;
  selectedUpgradeOption.value = null;
  upgradeOptionsLoading.value = true;
  showUpgradeDialog.value = true;

  // 调用 API 获取升级选项（传递会员记录 ID）
  const result = await useApiFetch<{
    currentMembership: {
      id: number;
      levelId: number;
      levelName: string;
      endDate: string;
      remainingDays: number;
    };
    options: UpgradeOption[];
  }>(`/api/v1/memberships/upgrade/options?membershipId=${record.id}`, {
    showError: false,
  });

  upgradeOptions.value = result?.options ?? [];

  // 默认选中最高级别（sortOrder 最大的）
  if (upgradeOptions.value.length > 0) {
    const highestOption = upgradeOptions.value.reduce((highest, current) => {
      const highestLevel = membershipLevels.value.find((l) => l.id === highest.levelId);
      const currentLevel = membershipLevels.value.find((l) => l.id === current.levelId);
      const highestSortOrder = highestLevel?.sortOrder ?? 0;
      const currentSortOrder = currentLevel?.sortOrder ?? 0;
      return currentSortOrder > highestSortOrder ? current : highest;
    });
    selectedUpgradeOption.value = highestOption;
  }

  upgradeOptionsLoading.value = false;
};

/**
 * 关闭升级弹框
 */
const closeUpgradeDialog = () => {
  showUpgradeDialog.value = false;
  selectedUpgradeOption.value = null;
  currentUpgradeRecord.value = null;
  upgradeOptions.value = [];
};

/**
 * 确认升级
 */
const confirmUpgrade = async () => {
  if (!selectedUpgradeOption.value || !currentUpgradeRecord.value) return;

  // 关闭升级弹框
  showUpgradeDialog.value = false;

  // 判断是否使用 JSAPI 支付
  const shouldUseJsapi = isInWechat.value;

  try {
    if (shouldUseJsapi) {
      // 微信环境：确保有 OpenID
      const currentOpenId = await ensureOpenId();
      if (!currentOpenId) {
        redirectToAuth();
        return;
      }

      // 创建 JSAPI 升级支付订单
      const result = await useApiFetch<{
        orderNo: string;
        transactionNo: string;
        amount: number;
        paymentParams: WechatPaymentParams;
      }>("/api/v1/memberships/upgrade/pay", {
        method: "POST",
        body: {
          targetLevelId: selectedUpgradeOption.value.levelId,
          membershipId: currentUpgradeRecord.value.id,
          paymentChannel: PaymentChannel.WECHAT,
          paymentMethod: PaymentMethod.MINI_PROGRAM,
          openid: currentOpenId,
        },
      });

      if (!result) {
        toast.error("创建升级订单失败");
        return;
      }

      currentTransactionNo.value = result.transactionNo;
      useJsapiPayment.value = true;
      jsapiParams.value = result.paymentParams;
      paymentPaid.value = false;
      paymentLoading.value = false;

      showQRCode.value = true;
    } else {
      // 非微信环境：扫码支付
      const result = await useApiFetch<{
        orderNo: string;
        transactionNo: string;
        amount: number;
        codeUrl: string;
        h5Url: string;
      }>("/api/v1/memberships/upgrade/pay", {
        method: "POST",
        body: {
          targetLevelId: selectedUpgradeOption.value.levelId,
          membershipId: currentUpgradeRecord.value.id,
          paymentChannel: PaymentChannel.WECHAT,
          paymentMethod: PaymentMethod.SCAN_CODE,
        },
      });

      if (!result) {
        toast.error("创建升级订单失败");
        return;
      }

      currentTransactionNo.value = result.transactionNo;
      qrCodeUrl.value = result.codeUrl;
      useJsapiPayment.value = false;
      jsapiParams.value = undefined;
      paymentPaid.value = false;
      paymentLoading.value = false;

      showQRCode.value = true;
      startPollingPaymentStatus();
    }
  } catch (error) {
    logger.error("升级失败：", error);
    toast.error("升级失败，请重试");
  }
};

// ==================== 生命周期 ====================

onMounted(() => {
  // 设置默认选中的套餐
  if (currentMembership.value.levelName !== "免费版" && productList.value.length > 0) {
    const matchingPlan = productList.value.find((p) => p.name === currentMembership.value.levelName);
    if (matchingPlan) {
      selectedPlanLevel.value = matchingPlan.name;
    }
  } else if (productList.value.length > 0) {
    const firstPlan = productList.value[0];
    if (firstPlan) {
      selectedPlanLevel.value = firstPlan.name;
    }
  }
});

// 组件卸载时清理定时器
onUnmounted(() => {
  stopPollingPaymentStatus();
});
</script>
