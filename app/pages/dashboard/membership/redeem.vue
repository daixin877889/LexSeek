<template>
  <div class="w-full bg-card rounded-lg border p-6">
    <!-- 标题 -->
    <div class="mb-6">
      <h2 class="text-xl font-semibold">兑换会员</h2>
    </div>

    <div class="grid grid-cols-1 gap-4">
      <!-- 输入兑换码区域 -->
      <div class="w-full">
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg border">
          <h3 class="text-lg font-semibold mb-4">输入兑换码</h3>
          <div class="space-y-4">
            <div class="grid w-full items-center gap-1.5">
              <div class="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
                <Input v-model="redemptionCode" placeholder="请输入兑换码" class="h-10 w-full mb-2 text-base"
                  :disabled="redemptionLoading" @keyup.enter="checkRedemptionCode" />
                <Button class="h-10 w-full sm:w-auto" :disabled="!redemptionCode || redemptionLoading"
                  @click="checkRedemptionCode">
                  <Loader2 v-if="redemptionLoading && !redemptionCodeInfo" class="w-4 h-4 mr-2 animate-spin" />
                  开始兑换
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 兑换码信息区域 -->
      <div class="w-full" v-if="redemptionCodeInfo">
        <!-- 有效兑换码信息 -->
        <div v-if="redemptionCodeInfo.status === RedemptionCodeStatus.ACTIVE"
          class="bg-white dark:bg-gray-800 p-6 rounded-lg border">
          <h3 class="text-lg font-semibold mb-4">兑换码信息</h3>
          <div class="space-y-4">
            <div class="grid grid-cols-1 gap-4">
              <!-- 兑换类型 -->
              <div class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">兑换类型</span>
                <Badge variant="outline" class="font-semibold">{{ getCodeTypeName(redemptionCodeInfo.type) }}</Badge>
              </div>
              <!-- 会员等级（如果有） -->
              <div v-if="redemptionCodeInfo.levelName"
                class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">会员等级</span>
                <Badge variant="outline" class="font-semibold">{{ redemptionCodeInfo.levelName }}</Badge>
              </div>
              <!-- 有效期（如果有） -->
              <div v-if="redemptionCodeInfo.duration"
                class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">会员有效期</span>
                <span class="font-semibold">{{ redemptionCodeInfo.duration }} 天</span>
              </div>
              <!-- 赠送积分（如果有） -->
              <div v-if="redemptionCodeInfo.pointAmount"
                class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">赠送积分</span>
                <span class="font-semibold">{{ redemptionCodeInfo.pointAmount }} 积分</span>
              </div>
              <!-- 过期时间（如果有） -->
              <div v-if="redemptionCodeInfo.expiredAt"
                class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">兑换码有效期至</span>
                <span class="font-semibold">{{ redemptionCodeInfo.expiredAt }}</span>
              </div>
              <!-- 状态 -->
              <div class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">状态</span>
                <Badge variant="default" class="bg-green-100 text-green-800 hover:bg-green-100">
                  可用
                </Badge>
              </div>
            </div>

            <!-- 确认兑换按钮 -->
            <AlertDialog>
              <AlertDialogTrigger as-child>
                <Button class="w-full" :disabled="redemptionLoading">确认兑换</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认兑换</AlertDialogTitle>
                  <AlertDialogDescription>
                    <span v-if="redemptionCodeInfo.levelName">
                      您确定要兑换 {{ redemptionCodeInfo.levelName }} 会员吗？
                    </span>
                    <span v-else-if="redemptionCodeInfo.pointAmount">
                      您确定要兑换 {{ redemptionCodeInfo.pointAmount }} 积分吗？
                    </span>
                    <span v-else>
                      您确定要使用此兑换码吗？
                    </span>
                    兑换后不可撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction :disabled="redemptionLoading" @click="redeemMembership">
                    <Loader2 v-if="redemptionLoading" class="w-4 h-4 mr-2 animate-spin" />
                    确认兑换
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <!-- 无效兑换码提示 -->
        <div v-else class="bg-white dark:bg-gray-800 p-6 rounded-lg border">
          <div class="text-center py-8">
            <IconsIconAlert class="mx-auto h-12 w-12 text-yellow-500 mb-4" />
            <h3 class="text-lg font-medium">无效的兑换码</h3>
            <p class="text-sm text-muted-foreground mt-2">{{ getStatusText(redemptionCodeInfo.status) }}</p>
          </div>
        </div>
      </div>

      <!-- 未输入兑换码时的提示 -->
      <div v-else class="w-full">
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg border">
          <div class="text-center py-8">
            <IconsIconInfo class="mx-auto h-12 w-12 text-primary mb-4" />
            <h3 class="text-lg font-medium">输入兑换码</h3>
            <p class="text-sm text-muted-foreground mt-2">请在上方输入您的兑换码以查看详情</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 兑换历史记录 -->
    <div class="mt-12">
      <h3 class="text-lg font-medium mb-4">兑换记录</h3>

      <!-- 桌面端表格视图 -->
      <div class="border rounded-lg overflow-hidden hidden md:block">
        <table class="w-full">
          <thead>
            <tr class="border-b bg-muted/50">
              <th class="px-4 py-3 text-left text-sm font-medium">兑换码</th>
              <th class="px-4 py-3 text-left text-sm font-medium">类型</th>
              <th class="px-4 py-3 text-left text-sm font-medium">会员等级</th>
              <th class="px-4 py-3 text-left text-sm font-medium">有效期</th>
              <th class="px-4 py-3 text-left text-sm font-medium">积分</th>
              <th class="px-4 py-3 text-left text-sm font-medium">兑换时间</th>
            </tr>
          </thead>
          <tbody>
            <!-- 加载中 -->
            <tr v-if="historyLoading">
              <td colspan="6" class="px-4 py-8 text-center">
                <div class="flex items-center justify-center">
                  <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  <span class="ml-2 text-muted-foreground">加载中...</span>
                </div>
              </td>
            </tr>
            <!-- 空状态 -->
            <tr v-else-if="redemptionHistory.length === 0">
              <td colspan="6" class="px-4 py-8 text-center text-muted-foreground">
                暂无兑换记录
              </td>
            </tr>
            <!-- 数据列表 -->
            <template v-else>
              <tr v-for="record in redemptionHistory" :key="record.id"
                class="border-b last:border-b-0 hover:bg-muted/30">
                <td class="px-4 py-3 text-sm font-mono">{{ maskCode(record.code) }}</td>
                <td class="px-4 py-3 text-sm">{{ getCodeTypeName(record.type) }}</td>
                <td class="px-4 py-3 text-sm">{{ record.levelName || '—' }}</td>
                <td class="px-4 py-3 text-sm">{{ record.duration ? `${record.duration} 天` : '—' }}</td>
                <td class="px-4 py-3 text-sm">{{ record.pointAmount || '—' }}</td>
                <td class="px-4 py-3 text-sm">{{ record.createdAt }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- 移动端卡片视图 -->
      <div class="md:hidden space-y-4">
        <div v-if="historyLoading" class="flex justify-center py-8">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          <span class="ml-2 text-muted-foreground">加载中...</span>
        </div>
        <div v-else-if="redemptionHistory.length === 0"
          class="text-center py-8 text-muted-foreground border rounded-lg">
          暂无兑换记录
        </div>
        <div v-else v-for="record in redemptionHistory" :key="record.id" class="border rounded-lg p-4 space-y-3">
          <div class="flex justify-between items-start">
            <div>
              <h4 class="font-medium text-sm mb-1">{{ getCodeTypeName(record.type) }}</h4>
              <p class="text-xs text-muted-foreground font-mono">{{ maskCode(record.code) }}</p>
            </div>
            <Badge v-if="record.levelName" variant="outline">{{ record.levelName }}</Badge>
          </div>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div v-if="record.duration">
              <p class="text-muted-foreground">有效期</p>
              <p class="font-medium">{{ record.duration }} 天</p>
            </div>
            <div v-if="record.pointAmount">
              <p class="text-muted-foreground">积分</p>
              <p class="font-medium">{{ record.pointAmount }}</p>
            </div>
            <div class="col-span-2">
              <p class="text-muted-foreground">兑换时间</p>
              <p class="font-medium">{{ record.createdAt }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="pagination.total > pagination.pageSize" class="mt-4 flex justify-center">
        <GeneralPagination :total="pagination.total" :current-page="pagination.page" :page-size="pagination.pageSize"
          @change="handlePageChange" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Loader2 } from "lucide-vue-next";
import { RedemptionCodeType, RedemptionCodeStatus, type RedemptionCodeInfo, type RedemptionRecordInfo } from "#shared/types/redemption";

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
const pageSize = ref(10);

// 兑换记录数据
const redemptionHistory = ref<RedemptionRecordInfo[]>([]);
const historyLoading = ref(false);
const pagination = ref({
  page: 1,
  pageSize: 10,
  total: 0,
});

/**
 * 获取兑换记录
 */
const fetchHistory = async () => {
  historyLoading.value = true;
  try {
    const data = await useApiFetch<RedemptionHistoryResponse>("/api/v1/redemption-codes/me", {
      query: {
        page: currentPage.value,
        pageSize: pageSize.value,
      },
    });
    if (data) {
      redemptionHistory.value = data.list || [];
      pagination.value = {
        page: data.page || 1,
        pageSize: data.pageSize || 10,
        total: data.total || 0,
      };
    }
  } catch (error) {
    logger.error("获取兑换记录失败:", error);
  } finally {
    historyLoading.value = false;
  }
};

// 刷新兑换记录的方法
const refreshHistory = () => fetchHistory();

// 页面加载时获取数据
onMounted(() => {
  fetchHistory();
});

// 监听分页变化
watch([currentPage, pageSize], () => {
  fetchHistory();
});

// ==================== 方法定义 ====================

/**
 * 获取兑换码类型名称
 */
const getCodeTypeName = (type: RedemptionCodeType): string => {
  switch (type) {
    case RedemptionCodeType.MEMBERSHIP_ONLY:
      return "会员兑换";
    case RedemptionCodeType.POINTS_ONLY:
      return "积分兑换";
    case RedemptionCodeType.MEMBERSHIP_AND_POINTS:
      return "会员+积分";
    default:
      return "未知类型";
  }
};

/**
 * 获取兑换码状态文本
 */
const getStatusText = (status: RedemptionCodeStatus): string => {
  switch (status) {
    case RedemptionCodeStatus.ACTIVE:
      return "可用";
    case RedemptionCodeStatus.USED:
      return "兑换码已被使用";
    case RedemptionCodeStatus.EXPIRED:
      return "兑换码已过期";
    case RedemptionCodeStatus.INVALID:
      return "兑换码已作废";
    default:
      return "未知状态";
  }
};

/**
 * 脱敏兑换码（显示前4位和后4位）
 */
const maskCode = (code: string): string => {
  if (code.length <= 8) return code;
  return `${code.slice(0, 4)}****${code.slice(-4)}`;
};

/**
 * 检查兑换码
 */
const checkRedemptionCode = async () => {
  if (!redemptionCode.value.trim()) {
    toast.error("请输入兑换码");
    return;
  }

  redemptionLoading.value = true;
  redemptionCodeInfo.value = null;

  try {
    const data = await useApiFetch<RedemptionCodeInfo>("/api/v1/redemption-codes/info", {
      query: { code: redemptionCode.value.trim() },
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

/**
 * 处理分页变化
 */
const handlePageChange = (page: number) => {
  currentPage.value = page;
};
</script>

<style scoped>
/* 兑换会员页面样式 */
</style>
