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
                  :disabled="redemptionLoading" />
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
        <div v-if="redemptionCodeInfo.status === 1" class="bg-white dark:bg-gray-800 p-6 rounded-lg border">
          <h3 class="text-lg font-semibold mb-4">兑换码信息</h3>
          <div class="space-y-4">
            <div class="grid grid-cols-1 gap-4">
              <div class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">会员等级</span>
                <Badge variant="outline" class="font-semibold">{{ redemptionCodeInfo.levelName }}</Badge>
              </div>
              <div class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">有效期</span>
                <span class="font-semibold">{{ redemptionCodeInfo.duration }} 天</span>
              </div>
              <div class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">赠送积分</span>
                <span class="font-semibold">{{ redemptionCodeInfo.giftPoint }} 积分</span>
              </div>
              <div class="flex justify-between items-center py-2 border-b border-gray-200">
                <span class="text-muted-foreground">状态</span>
                <Badge variant="default" class="bg-green-100 text-green-800 hover:bg-green-100">
                  {{ redemptionCodeInfo.statusText }}
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
                    您确定要兑换 {{ redemptionCodeInfo.levelName }} 会员吗？兑换后不可撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction :disabled="redemptionLoading" @click="redeemMembership">
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
            <p class="text-sm text-muted-foreground mt-2">{{ redemptionCodeInfo.statusText }}</p>
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
              <th class="px-4 py-3 text-left text-sm font-medium">会员版本</th>
              <th class="px-4 py-3 text-left text-sm font-medium">有效期</th>
              <th class="px-4 py-3 text-left text-sm font-medium">赠送积分</th>
              <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
              <th class="px-4 py-3 text-left text-sm font-medium">兑换时间</th>
            </tr>
          </thead>
          <tbody>
            <!-- 加载中 -->
            <tr v-if="historyLoading">
              <td colspan="5" class="px-4 py-8 text-center">
                <div class="flex items-center justify-center">
                  <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  <span class="ml-2 text-muted-foreground">加载中...</span>
                </div>
              </td>
            </tr>
            <!-- 空状态 -->
            <tr v-else-if="redemptionHistory.length === 0">
              <td colspan="5" class="px-4 py-8 text-center text-muted-foreground">
                暂无兑换记录
              </td>
            </tr>
            <!-- 数据列表 -->
            <template v-else>
              <tr v-for="record in redemptionHistory" :key="record.id"
                class="border-b last:border-b-0 hover:bg-muted/30">
                <td class="px-4 py-3 text-sm">{{ record.levelName }}</td>
                <td class="px-4 py-3 text-sm">{{ record.startDate }} - {{ record.expiresAt }}</td>
                <td class="px-4 py-3 text-sm">{{ record.giftPoint }}</td>
                <td class="px-4 py-3 text-sm">
                  <span v-if="record.status === 1"
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                  <span v-else-if="record.status === 2"
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">已过期</span>
                  <span v-else-if="record.status === 3"
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                </td>
                <td class="px-4 py-3 text-sm">{{ formatDate(record.redeemedAt) }}</td>
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
              <h4 class="font-medium text-sm mb-1">{{ record.levelName }}</h4>
              <p class="text-xs text-muted-foreground">{{ record.startDate }} - {{ record.expiresAt }}</p>
            </div>
            <span v-if="record.status === 1"
              class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
            <span v-else-if="record.status === 2"
              class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">已过期</span>
            <span v-else-if="record.status === 3"
              class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p class="text-muted-foreground">赠送积分</p>
              <p class="font-medium">{{ record.giftPoint }}</p>
            </div>
            <div>
              <p class="text-muted-foreground">兑换时间</p>
              <p class="font-medium">{{ formatDate(record.redeemedAt) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { Loader2 } from "lucide-vue-next";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

// 配置 dayjs
dayjs.locale("zh-cn");

// 页面元信息
definePageMeta({
  layout: "dashboard-layout",
  title: "兑换会员",
});

// ==================== 类型定义 ====================

/** 兑换码信息 */
interface RedemptionCodeInfo {
  code: string;
  levelName: string;
  duration: number;
  giftPoint: number;
  status: number;
  statusText: string;
}

/** 兑换记录 */
interface RedemptionRecord {
  id: number;
  levelName: string;
  startDate: string;
  expiresAt: string;
  giftPoint: number;
  status: number;
  redeemedAt: string;
}

// ==================== 状态定义 ====================

// 兑换码输入
const redemptionCode = ref("");
const redemptionLoading = ref(false);
const redemptionCodeInfo = ref<RedemptionCodeInfo | null>(null);

// 兑换历史
const historyLoading = ref(false);
const redemptionHistory = ref<RedemptionRecord[]>([]);

// ==================== 方法定义 ====================

/**
 * 检查兑换码
 */
const checkRedemptionCode = async () => {
  if (!redemptionCode.value) return;

  redemptionLoading.value = true;
  try {
    // TODO: 替换为实际 API 调用
    await new Promise((resolve) => setTimeout(resolve, 800));

    // 模拟数据
    redemptionCodeInfo.value = {
      code: redemptionCode.value,
      levelName: "专业版会员",
      duration: 365,
      giftPoint: 1000,
      status: 1,
      statusText: "可用",
    };
  } catch (error) {
    logger.error("检查兑换码失败:", error);
    toast.error("检查兑换码失败");
  } finally {
    redemptionLoading.value = false;
  }
};

/**
 * 确认兑换会员
 */
const redeemMembership = async () => {
  if (!redemptionCode.value) return;

  redemptionLoading.value = true;
  try {
    // TODO: 替换为实际 API 调用
    await new Promise((resolve) => setTimeout(resolve, 800));

    toast.success("兑换成功");

    // 重置状态
    redemptionCode.value = "";
    redemptionCodeInfo.value = null;

    // 刷新兑换记录
    await loadRedemptionHistory();
  } catch (error) {
    logger.error("兑换失败:", error);
    toast.error("兑换失败，请稍后重试");
  } finally {
    redemptionLoading.value = false;
  }
};

/**
 * 加载兑换历史记录
 */
const loadRedemptionHistory = async () => {
  historyLoading.value = true;
  try {
    // TODO: 替换为实际 API 调用
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 模拟数据
    redemptionHistory.value = [
      {
        id: 1,
        levelName: "专业版会员",
        startDate: "2024-01-01",
        expiresAt: "2024-12-31",
        giftPoint: 1000,
        status: 1,
        redeemedAt: "2024-01-01T10:30:00Z",
      },
      {
        id: 2,
        levelName: "基础版会员",
        startDate: "2023-06-01",
        expiresAt: "2023-12-31",
        giftPoint: 500,
        status: 2,
        redeemedAt: "2023-06-01T14:20:00Z",
      },
    ];
  } catch (error) {
    logger.error("获取兑换记录失败:", error);
  } finally {
    historyLoading.value = false;
  }
};

/**
 * 格式化日期
 */
const formatDate = (dateString: string) => {
  if (!dateString) return "—";
  return dayjs(dateString).format("YYYY年MM月DD日 HH:mm");
};

// ==================== 生命周期 ====================

onMounted(() => {
  loadRedemptionHistory();
});
</script>

<style scoped>
/* 兑换会员页面样式 */
</style>
