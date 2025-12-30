<template>
  <div class="w-full bg-card rounded-lg border p-6">
    <!-- 标题和操作按钮 -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 gap-3">
      <h2 class="text-xl font-semibold leading-none">
        我的积分
        <span class="text-xs text-muted-foreground font-normal mt-1"> (不含已过期和未生效积分) </span>
      </h2>
      <div class="flex gap-2 sm:shrink-0">
        <Button variant="outline" class="h-10 px-4 py-2 flex-1 sm:flex-initial" @click="showConsumptionStandard = true">
          积分消耗标准 </Button>
        <Button class="h-10 px-4 py-2 flex-1 sm:flex-initial" @click="showPointProducts = true"> 购买积分 </Button>
      </div>
    </div>

    <!-- 积分统计卡片 -->
    <PointsPointSummary :point-info="pointInfo" />

    <!-- Tab 切换 -->
    <div class="mb-6">
      <Tabs v-model="currentTab" class="w-full">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="history">积分获取记录</TabsTrigger>
          <TabsTrigger value="usage">积分使用记录</TabsTrigger>
        </TabsList>

        <!-- 积分获取记录 Tab -->
        <TabsContent value="history" class="mt-4">
          <!-- 桌面端表格 -->
          <PointsPointHistoryTable :list="historyList" :loading="historyLoading" />
          <!-- 移动端卡片（上拉加载） -->
          <PointsPointHistoryMobile :list="historyMobileList" :loading="historyMobileLoading"
            :refreshing="historyRefreshing" :has-more="historyHasMore" @load-more="loadMoreHistory"
            @refresh="refreshHistory" />
          <!-- 桌面端分页 -->
          <GeneralPagination v-model:current-page="historyCurrentPage" :page-size="pageSize"
            :total="historyPagination.total" class="mt-4 hidden md:flex" />
        </TabsContent>

        <!-- 积分使用记录 Tab -->
        <TabsContent value="usage" class="mt-4">
          <!-- 桌面端表格 -->
          <PointsPointUsageTable :list="usageList" :loading="usageLoading" />
          <!-- 移动端卡片（上拉加载） -->
          <PointsPointUsageMobile :list="usageMobileList" :loading="usageMobileLoading" :refreshing="usageRefreshing"
            :has-more="usageHasMore" @load-more="loadMoreUsage" @refresh="refreshUsage" />
          <!-- 桌面端分页 -->
          <GeneralPagination :current-page="usageCurrentPage" :page-size="pageSize" :total="usagePagination.total"
            class="mt-4 hidden md:flex" @change="onUsagePageChange" />
        </TabsContent>
      </Tabs>
    </div>

    <!-- 购买积分弹框 -->
    <PointsPointPurchaseDialog v-model:open="showPointProducts" :product-list="pointProductList" @buy="buyPoints" />

    <!-- 微信支付二维码弹框 -->
    <PointsPointQRCodeDialog v-model:open="showQRCode" :qr-code-url="qrCodeUrl" :loading="paymentLoading"
      :paid="paymentPaid" @close="closeQRCodeDialog" />

    <!-- 积分消耗标准弹框 -->
    <PointsConsumptionStandardDialog v-model:open="showConsumptionStandard" />
  </div>
</template>

<script lang="ts" setup>
import { PaymentChannel, PaymentMethod, DurationUnit } from "#shared/types/payment";

// 页面元信息
definePageMeta({
  layout: "dashboard-layout",
  title: "我的积分",
});

// ==================== 类型定义 ====================

/** 积分获取记录 */
interface PointHistoryRecord {
  id: number;
  sourceType: number;
  sourceTypeName: string;
  pointAmount: number;
  used: number;
  remaining: number;
  effectiveAt: string;
  expiredAt: string;
  status: number;
  remark?: string;
}

/** 积分使用记录 */
interface PointUsageRecord {
  id: number;
  itemDescription: string;
  pointAmount: number;
  status: number;
  createdAt: string;
  remark?: string;
}

/** 积分商品 */
interface PointProduct {
  id: number;
  name: string;
  unitPrice: number;
  originalUnitPrice?: number;
  pointAmount: number;
  description: string;
}

/** 分页信息 */
interface Pagination {
  total: number;
  totalPages: number;
}

// ==================== 工具方法 ====================

/**
 * 获取来源类型名称
 */
const getSourceTypeName = (sourceType: number): string => {
  return PointRecordSourceTypeName[sourceType as keyof typeof PointRecordSourceTypeName] || "其他";
};

// ==================== 状态定义 ====================

// 当前 Tab
const currentTab = ref("history");

// 每页数量
const pageSize = 10;

// ==================== SSR 数据预取 ====================

// 积分汇总信息（SSR 预取）
const { data: pointInfoData } = await useApi<{
  pointAmount: number;
  used: number;
  remaining: number;
  purchasePoint: number;
  otherPoint: number;
  pendingPoint: number;
}>("/api/v1/points/info", {
  key: "point-info",
});

// 积分信息（响应式，确保始终返回对象）
const pointInfo = computed(() => ({
  pointAmount: pointInfoData.value?.pointAmount ?? 0,
  used: pointInfoData.value?.used ?? 0,
  remaining: pointInfoData.value?.remaining ?? 0,
  purchasePoint: pointInfoData.value?.purchasePoint ?? 0,
  otherPoint: pointInfoData.value?.otherPoint ?? 0,
  pendingPoint: pointInfoData.value?.pendingPoint ?? 0,
}));

// ==================== 积分获取记录（桌面端分页） ====================

// 积分获取记录当前页
const historyCurrentPage = ref(1);

// 积分获取记录（SSR 预取）
const { data: historyData, status: historyStatus } = await useApi<{
  list: Array<{
    id: number;
    sourceType: number;
    pointAmount: number;
    used: number;
    remaining: number;
    effectiveAt: string;
    expiredAt: string;
    status: number;
    remark?: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}>("/api/v1/points/records", {
  key: "point-records",
  query: computed(() => ({
    page: historyCurrentPage.value,
    pageSize,
  })),
});

// 积分获取记录加载状态
const historyLoading = computed(() => historyStatus.value === "pending");

// 积分获取记录列表（转换格式）
const historyList = computed<PointHistoryRecord[]>(() => {
  if (!historyData.value?.list) return [];
  return historyData.value.list.map((item) => ({
    ...item,
    sourceTypeName: getSourceTypeName(item.sourceType),
  }));
});

// 积分获取记录分页信息
const historyPagination = computed<Pagination>(() => ({
  total: historyData.value?.total || 0,
  totalPages: Math.ceil((historyData.value?.total || 0) / pageSize),
}));

// ==================== 积分获取记录（移动端上拉加载） ====================

// 移动端累积列表
const historyMobileList = ref<PointHistoryRecord[]>([]);
// 移动端当前页
const historyMobilePage = ref(1);
// 移动端加载状态
const historyMobileLoading = ref(false);
// 移动端刷新状态
const historyRefreshing = ref(false);
// 是否还有更多数据
const historyHasMore = computed(() => {
  return historyMobileList.value.length < (historyData.value?.total || 0);
});

// 初始化移动端列表
watch(
  historyList,
  (newList) => {
    // 首次加载时同步到移动端列表
    if (historyMobilePage.value === 1 && newList.length > 0) {
      historyMobileList.value = [...newList];
    }
  },
  { immediate: true }
);

/**
 * 加载更多积分获取记录（移动端）
 */
const loadMoreHistory = async () => {
  if (historyMobileLoading.value || !historyHasMore.value) return;

  historyMobileLoading.value = true;
  historyMobilePage.value++;

  try {
    const data = await useApiFetch<{
      list: Array<{
        id: number;
        sourceType: number;
        pointAmount: number;
        used: number;
        remaining: number;
        effectiveAt: string;
        expiredAt: string;
        status: number;
        remark?: string;
      }>;
      total: number;
    }>("/api/v1/points/records", {
      query: {
        page: historyMobilePage.value,
        pageSize,
      },
    });

    if (data?.list) {
      const newRecords = data.list.map((item) => ({
        ...item,
        sourceTypeName: getSourceTypeName(item.sourceType),
      }));
      historyMobileList.value = [...historyMobileList.value, ...newRecords];
    }
  } catch (error) {
    // 加载失败，回退页码
    historyMobilePage.value--;
    logger.error("加载更多积分获取记录失败:", error);
  } finally {
    historyMobileLoading.value = false;
  }
};

/**
 * 刷新积分获取记录（移动端）
 */
const refreshHistory = async () => {
  if (historyRefreshing.value) return;

  historyRefreshing.value = true;
  historyMobilePage.value = 1;

  try {
    const data = await useApiFetch<{
      list: Array<{
        id: number;
        sourceType: number;
        pointAmount: number;
        used: number;
        remaining: number;
        effectiveAt: string;
        expiredAt: string;
        status: number;
        remark?: string;
      }>;
      total: number;
    }>("/api/v1/points/records", {
      query: {
        page: 1,
        pageSize,
      },
    });

    if (data?.list) {
      historyMobileList.value = data.list.map((item) => ({
        ...item,
        sourceTypeName: getSourceTypeName(item.sourceType),
      }));
    }
  } catch (error) {
    logger.error("刷新积分获取记录失败:", error);
  } finally {
    historyRefreshing.value = false;
  }
};

// ==================== 积分使用记录（桌面端分页） ====================

// 积分使用记录当前页
const usageCurrentPage = ref(1);

// 积分使用记录（延迟加载，切换 Tab 时才加载）
const {
  data: usageData,
  status: usageStatus,
  execute: executeUsage,
} = useApi<{
  list: Array<{
    id: number;
    pointAmount: number;
    status: number;
    createdAt: string;
    remark?: string;
    pointConsumptionItems: {
      name: string;
      description?: string;
    };
  }>;
  total: number;
  page: number;
  pageSize: number;
}>("/api/v1/points/usage", {
  key: "point-usage",
  immediate: false,
  query: computed(() => ({
    page: usageCurrentPage.value,
    pageSize,
  })),
});

// 积分使用记录加载状态
const usageLoading = computed(() => usageStatus.value === "pending");

// 积分使用记录列表（转换格式）
const usageList = computed<PointUsageRecord[]>(() => {
  if (!usageData.value?.list) return [];
  return usageData.value.list.map((item) => ({
    id: item.id,
    itemDescription: item.pointConsumptionItems?.description || item.pointConsumptionItems?.name || "未知消耗项",
    pointAmount: item.pointAmount,
    status: item.status,
    createdAt: item.createdAt,
    remark: item.remark,
  }));
});

// 积分使用记录分页信息
const usagePagination = computed<Pagination>(() => ({
  total: usageData.value?.total || 0,
  totalPages: Math.ceil((usageData.value?.total || 0) / pageSize),
}));

// ==================== 积分使用记录（移动端上拉加载） ====================

// 移动端累积列表
const usageMobileList = ref<PointUsageRecord[]>([]);
// 移动端当前页
const usageMobilePage = ref(1);
// 移动端加载状态
const usageMobileLoading = ref(false);
// 移动端刷新状态
const usageRefreshing = ref(false);
// 是否还有更多数据
const usageHasMore = computed(() => {
  return usageMobileList.value.length < (usageData.value?.total || 0);
});

// 同步桌面端数据到移动端列表
watch(
  usageList,
  (newList) => {
    // 首次加载时同步到移动端列表
    if (usageMobilePage.value === 1 && newList.length > 0) {
      usageMobileList.value = [...newList];
    }
  },
  { immediate: true }
);

/**
 * 加载更多积分使用记录（移动端）
 */
const loadMoreUsage = async () => {
  if (usageMobileLoading.value || !usageHasMore.value) return;

  usageMobileLoading.value = true;
  usageMobilePage.value++;

  try {
    const data = await useApiFetch<{
      list: Array<{
        id: number;
        pointAmount: number;
        status: number;
        createdAt: string;
        remark?: string;
        pointConsumptionItems: {
          name: string;
          description?: string;
        };
      }>;
      total: number;
    }>("/api/v1/points/usage", {
      query: {
        page: usageMobilePage.value,
        pageSize,
      },
    });

    if (data?.list) {
      const newRecords = data.list.map((item) => ({
        id: item.id,
        itemDescription: item.pointConsumptionItems?.description || item.pointConsumptionItems?.name || "未知消耗项",
        pointAmount: item.pointAmount,
        status: item.status,
        createdAt: item.createdAt,
        remark: item.remark,
      }));
      usageMobileList.value = [...usageMobileList.value, ...newRecords];
    }
  } catch (error) {
    // 加载失败，回退页码
    usageMobilePage.value--;
    logger.error("加载更多积分使用记录失败:", error);
  } finally {
    usageMobileLoading.value = false;
  }
};

/**
 * 刷新积分使用记录（移动端）
 */
const refreshUsage = async () => {
  if (usageRefreshing.value) return;

  usageRefreshing.value = true;
  usageMobilePage.value = 1;

  try {
    const data = await useApiFetch<{
      list: Array<{
        id: number;
        pointAmount: number;
        status: number;
        createdAt: string;
        remark?: string;
        pointConsumptionItems: {
          name: string;
          description?: string;
        };
      }>;
      total: number;
    }>("/api/v1/points/usage", {
      query: {
        page: 1,
        pageSize,
      },
    });

    if (data?.list) {
      usageMobileList.value = data.list.map((item) => ({
        id: item.id,
        itemDescription: item.pointConsumptionItems?.description || item.pointConsumptionItems?.name || "未知消耗项",
        pointAmount: item.pointAmount,
        status: item.status,
        createdAt: item.createdAt,
        remark: item.remark,
      }));
    }
  } catch (error) {
    logger.error("刷新积分使用记录失败:", error);
  } finally {
    usageRefreshing.value = false;
  }
};

// 弹框状态
const showPointProducts = ref(false);
const showQRCode = ref(false);
const showConsumptionStandard = ref(false);
const qrCodeUrl = ref("");

// 支付相关状态
const paymentLoading = ref(false);
const paymentPaid = ref(false);
const currentTransactionNo = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ==================== SSR 数据预取：积分商品列表 ====================

// 获取积分商品列表（type=2 为积分商品）
const { data: pointProductsData } = await useApi<
  Array<{
    id: number;
    name: string;
    unitPrice: number;
    originalUnitPrice?: number;
    pointAmount: number;
    description?: string;
  }>
>("/api/v1/products", {
  key: "point-products",
  query: { type: 2 },
});

// 积分商品列表（响应式）
const pointProductList = computed<PointProduct[]>(() => {
  if (!pointProductsData.value) return [];
  return pointProductsData.value.map((p) => ({
    id: p.id,
    name: p.name,
    unitPrice: p.unitPrice ?? 0,
    originalUnitPrice: p.originalUnitPrice,
    pointAmount: p.pointAmount ?? 0,
    description: p.description ?? "",
  }));
});

// ==================== 事件处理 ====================

/**
 * 积分使用记录分页变化（桌面端）
 */
const onUsagePageChange = async (page: number) => {
  if (page < 1 || page > usagePagination.value.totalPages) return;
  usageCurrentPage.value = page;
  await executeUsage();
};

/**
 * 购买积分
 */
const buyPoints = async (product: PointProduct) => {
  // 关闭商品列表弹框
  showPointProducts.value = false;

  // 创建订单并发起支付
  const result = await useApiFetch<{
    orderNo: string;
    transactionNo: string;
    amount: number;
    codeUrl: string;
    h5Url: string;
  }>("/api/v1/payments/create", {
    method: "POST",
    body: {
      productId: product.id,
      duration: 1, // 积分商品数量为 1
      durationUnit: DurationUnit.MONTH, // 积分商品不需要时长单位，但 API 需要
      paymentChannel: PaymentChannel.WECHAT,
      paymentMethod: PaymentMethod.SCAN_CODE,
    },
  });

  if (!result) return;

  // 保存支付单号，用于轮询
  currentTransactionNo.value = result.transactionNo;
  qrCodeUrl.value = result.codeUrl;
  paymentPaid.value = false;
  paymentLoading.value = false;

  // 显示二维码弹框
  showQRCode.value = true;

  // 开始轮询支付状态
  startPollingPaymentStatus();
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
      toast.success("支付成功！积分已到账");

      // 2 秒后关闭弹框并刷新页面
      setTimeout(() => {
        closeQRCodeDialog();
        // 刷新页面以更新积分信息
        window.location.reload();
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
};

// ==================== 监听器 ====================

// 标记使用记录是否已加载
const usageLoaded = ref(false);

// 监听 Tab 切换，加载对应数据
watch(currentTab, async (newTab) => {
  if (newTab === "usage" && !usageLoaded.value) {
    await executeUsage();
    usageLoaded.value = true;
  }
});

// 组件卸载时清理定时器
onUnmounted(() => {
  stopPollingPaymentStatus();
});
</script>
