<template>
  <div class="w-full bg-card rounded-lg border p-6">
    <!-- 标题 -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold">我的订单</h2>
    </div>

    <!-- 状态筛选 -->
    <div class="mb-4">
      <Tabs :default-value="statusFilter" @update:model-value="handleStatusChange">
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="pending">待支付</TabsTrigger>
          <TabsTrigger value="paid">已支付</TabsTrigger>
          <TabsTrigger value="cancelled">已取消</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    <!-- 桌面端表格 -->
    <OrderTable :list="orderList" :loading="orderLoading" @pay="handlePay" @cancel="openCancelDialog"
      @detail="openDetailDialog" />

    <!-- 移动端卡片 -->
    <OrderMobile :list="orderList" :loading="orderLoading" @pay="handlePay" @cancel="openCancelDialog"
      @detail="openDetailDialog" />

    <!-- 分页 -->
    <GeneralPagination v-if="pagination.total > pagination.pageSize" v-model:current-page="currentPage"
      :page-size="pagination.pageSize" :total="pagination.total" class="mt-4" />

    <!-- 订单详情弹框 -->
    <OrderDetailDialog v-model:open="showDetailDialog" :order="selectedOrder" @pay="handlePay"
      @cancel="openCancelDialog" />

    <!-- 取消订单确认弹框 -->
    <OrderCancelDialog v-model:open="showCancelDialog" :order="selectedOrder" :loading="cancelLoading"
      @confirm="handleCancelOrder" />

    <!-- 支付二维码弹框 -->
    <PaymentQRCodeDialog v-model:open="showQRCodeDialog" :qr-code-url="qrCodeUrl" :loading="paymentLoading"
      :paid="paymentPaid" @close="closeQRCodeDialog" />
  </div>
</template>

<script lang="ts" setup>
import { OrderStatus, DurationUnit, PaymentChannel, PaymentMethod } from "#shared/types/payment";

// 页面元信息
definePageMeta({
  layout: "dashboard-layout",
  title: "我的订单",
});

// ==================== 类型定义 ====================

/** 订单项 */
interface OrderItem {
  id: number;
  orderNo: string;
  productName: string;
  productType: number;
  amount: number;
  duration: number;
  durationUnit: DurationUnit;
  status: OrderStatus;
  paidAt: string | null;
  expiredAt: string;
  createdAt: string;
}

/** 支付响应 */
interface PaymentResponse {
  orderNo: string;
  transactionNo: string;
  amount: number;
  codeUrl: string;
  h5Url: string;
}

/** 订单列表响应 */
interface OrderListResponse {
  list: OrderItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== 状态定义 ====================

// 筛选状态
const statusFilter = ref("all");

// 分页参数
const currentPage = ref(1);
const pageSize = 10;

// 计算状态参数
const statusParam = computed(() => {
  const statusMap: Record<string, number | undefined> = {
    all: undefined,
    pending: OrderStatus.PENDING,
    paid: OrderStatus.PAID,
    cancelled: OrderStatus.CANCELLED,
  };
  return statusMap[statusFilter.value];
});

// 使用 useApi 获取订单列表（支持 SSR）
const { data: orderData, status: orderStatus, refresh: refreshOrders, error: orderError } = await useApi<OrderListResponse>(
  "/api/v1/payments/orders",
  {
    key: "order-list",
    query: computed(() => {
      const query: Record<string, number> = {
        page: currentPage.value,
        pageSize,
      };
      // 只有当 status 有值时才添加到查询参数
      if (statusParam.value !== undefined) {
        query.status = statusParam.value;
      }
      return query;
    }),
    watch: [currentPage, statusParam],
    showError: false, // 禁用自动错误提示，避免 SSR 阶段的问题
  }
);

// 计算属性：订单列表
const orderList = computed(() => orderData.value?.list || []);

// 计算属性：是否加载中
const orderLoading = computed(() => orderStatus.value === "pending");

// 计算属性：分页信息
const pagination = computed(() => ({
  page: orderData.value?.page || 1,
  pageSize: orderData.value?.pageSize || 10,
  total: orderData.value?.total || 0,
}));

// 弹框状态
const showDetailDialog = ref(false);
const showCancelDialog = ref(false);
const showQRCodeDialog = ref(false);
const selectedOrder = ref<OrderItem | null>(null);
const cancelLoading = ref(false);

// 支付相关状态
const qrCodeUrl = ref("");
const paymentLoading = ref(false);
const paymentPaid = ref(false);
const currentTransactionNo = ref("");
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ==================== 方法定义 ====================

/**
 * 处理状态筛选变化
 */
const handleStatusChange = (value: string | number) => {
  statusFilter.value = String(value);
  currentPage.value = 1; // 重置页码
};

/**
 * 打开弹框前移除当前焦点
 */
const blurActiveElement = () => {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
};

/**
 * 打开订单详情弹框
 */
const openDetailDialog = (order: OrderItem) => {
  blurActiveElement();
  selectedOrder.value = order;
  showDetailDialog.value = true;
};

/**
 * 打开取消订单弹框
 */
const openCancelDialog = (order: OrderItem) => {
  blurActiveElement();
  selectedOrder.value = order;
  showCancelDialog.value = true;
  showDetailDialog.value = false;
};

/**
 * 处理支付
 */
const handlePay = async (order: OrderItem) => {
  showDetailDialog.value = false;
  blurActiveElement();

  // 调用支付 API
  const result = await useApiFetch<PaymentResponse>(`/api/v1/payments/orders/${order.id}/pay`, {
    method: "POST",
    body: {
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
  showQRCodeDialog.value = true;

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
      toast.success("支付成功！");

      // 刷新订单列表
      await refreshOrders();

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
  showQRCodeDialog.value = false;
  stopPollingPaymentStatus();
  currentTransactionNo.value = "";
  qrCodeUrl.value = "";
  paymentPaid.value = false;
};

/**
 * 处理取消订单
 */
const handleCancelOrder = async () => {
  if (!selectedOrder.value) return;

  cancelLoading.value = true;
  try {
    const result = await useApiFetch(`/api/v1/payments/orders/${selectedOrder.value.id}/cancel`, {
      method: "POST",
      showError: true,
    });

    if (result) {
      toast.success("订单已取消");
      showCancelDialog.value = false;
      selectedOrder.value = null;
      await refreshOrders();
    }
  } catch (error) {
    logger.error("取消订单失败:", error);
  } finally {
    cancelLoading.value = false;
  }
};

// ==================== 生命周期 ====================

// 组件卸载时清理定时器
onUnmounted(() => {
  stopPollingPaymentStatus();
});
</script>
