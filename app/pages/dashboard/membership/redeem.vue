<template>
  <div class="w-full bg-card rounded-lg border p-6">
    <!-- 标题 -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold">兑换会员</h2>
    </div>

    <div class="grid grid-cols-1 gap-4">
      <!-- 输入兑换码区域 -->
      <RedeemCodeInput v-model:code="redemptionCode" :loading="redemptionLoading" @check="checkRedemptionCode" />

      <!-- 兑换码信息区域 -->
      <RedeemCodeInfo :code-info="redemptionCodeInfo" :loading="redemptionLoading" @redeem="redeemMembership" />
    </div>

    <!-- 兑换历史记录 -->
    <div class="mt-12">
      <h3 class="text-lg font-medium mb-4">兑换记录</h3>

      <!-- 桌面端表格 -->
      <RedeemHistoryTable :list="redemptionHistory" :loading="historyLoading" />

      <!-- 移动端卡片 -->
      <RedeemHistoryMobile :list="redemptionHistory" :loading="historyLoading" />

      <!-- 分页 -->
      <GeneralPagination v-if="pagination.total > pagination.pageSize" v-model:current-page="currentPage"
        :page-size="pagination.pageSize" :total="pagination.total" class="mt-4" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { type RedemptionCodeInfo, type RedemptionRecordInfo } from "#shared/types/redemption";

// 页面元信息
definePageMeta({
  layout: "dashboard-layout",
  title: "兑换会员",
});

// ==================== 类型定义 ====================

/** 兑换记录响应 */
interface RedemptionHistoryResponse {
  list: RedemptionRecordInfo[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== 状态定义 ====================

// 兑换码输入
const redemptionCode = ref("");
const redemptionLoading = ref(false);
const redemptionCodeInfo = ref<RedemptionCodeInfo | null>(null);

// 分页参数
const currentPage = ref(1);
const pageSize = 10;

// 使用 useApi 获取兑换记录（支持 SSR）
const { data: historyData, status: historyStatus, refresh: refreshHistory } = await useApi<RedemptionHistoryResponse>(
  "/api/v1/redemption-codes/me",
  {
    query: computed(() => ({
      page: currentPage.value,
      pageSize,
    })),
    watch: [currentPage],
  }
);

// 计算属性：兑换记录列表
const redemptionHistory = computed(() => historyData.value?.list || []);

// 计算属性：是否加载中
const historyLoading = computed(() => historyStatus.value === "pending");

// 计算属性：分页信息
const pagination = computed(() => ({
  page: historyData.value?.page || 1,
  pageSize: historyData.value?.pageSize || 10,
  total: historyData.value?.total || 0,
}));

// ==================== 方法定义 ====================

/**
 * 检查兑换码
 */
const checkRedemptionCode = async (code: string) => {
  redemptionLoading.value = true;
  redemptionCodeInfo.value = null;

  try {
    const data = await useApiFetch<RedemptionCodeInfo>("/api/v1/redemption-codes/info", {
      query: { code },
      showError: true,
    });

    if (data) {
      redemptionCodeInfo.value = data;
    }
  } catch (error) {
    logger.error("检查兑换码失败:", error);
  } finally {
    redemptionLoading.value = false;
  }
};

/**
 * 确认兑换会员
 */
const redeemMembership = async () => {
  if (!redemptionCode.value.trim()) return;

  redemptionLoading.value = true;
  try {
    const result = await useApiFetch("/api/v1/redemption-codes/redeem", {
      method: "POST",
      body: { code: redemptionCode.value.trim() },
      showError: true,
    });

    // 检查返回值，只有成功才执行后续操作
    if (result) {
      toast.success("兑换成功");

      // 重置状态
      redemptionCode.value = "";
      redemptionCodeInfo.value = null;

      // 刷新兑换记录
      await refreshHistory();
    }
  } catch (error) {
    logger.error("兑换失败:", error);
  } finally {
    redemptionLoading.value = false;
  }
};
</script>
