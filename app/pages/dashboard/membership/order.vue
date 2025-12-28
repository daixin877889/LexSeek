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
  </div>
</template>

<script lang="ts" setup>
import { OrderStatus, DurationUnit } from "#shared/types/payment";

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
const selectedOrder = ref<OrderItem | null>(null);
const cancelLoading = ref(false);

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
  // TODO: 实现支付逻辑
  toast.info(`支付订单 ${order.orderNo}`);
  showDetailDialog.value = false;
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
</script>
