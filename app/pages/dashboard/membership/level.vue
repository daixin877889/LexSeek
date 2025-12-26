<template>
  <div class="bg-card rounded-lg border p-6">
    <h2 class="text-xl font-semibold mb-2">会员等级</h2>

    <!-- 当前会员信息 -->
    <div class="bg-muted/30 rounded-lg p-4 mb-0 pl-0">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-muted-foreground mb-2">当前会员等级</p>
          <p class="text-3xl font-bold mb-2">{{ currentMembership.levelName }}</p>
          <p class="text-sm text-muted-foreground">
            有效期至：{{ currentMembership.expiresAt }}
          </p>
        </div>
        <div class="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" @click="navigateTo('/dashboard/membership/redeem')" class="h-10 px-4 py-2">
            兑换会员
          </Button>
          <Button v-if="!isFreeUser" @click="openRenewalDialog"
            class="h-10 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
            续期
          </Button>
        </div>
      </div>
    </div>

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
          <div>
            <h3 class="text-lg font-medium mb-4">会员套餐</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div v-for="plan in productList" :key="plan.id"
                class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer relative"
                :class="{ 'border-primary': selectedPlanLevel === plan.name }" @click="selectPlan(plan)">
                <div class="flex justify-between items-start mb-2">
                  <h4 class="font-semibold">{{ plan.name }}</h4>
                  <!-- 免费用户显示购买按钮 -->
                  <Button v-if="isFreeUser" size="sm" @click.stop="buy(plan)" class="absolute top-2 right-2">
                    购买
                  </Button>
                  <!-- 付费用户显示升级按钮 -->
                  <Button v-else-if="canUpgradeToPlan(plan)" size="sm" @click.stop="upgradeToPlan(plan)"
                    class="absolute top-2 right-2">
                    升级
                  </Button>
                </div>
                <p class="text-2xl font-bold mb-2">
                  <template v-if="plan.defaultDuration === 1">
                    ¥{{ plan.priceMonthly }}/月
                    <span class="text-base line-through text-muted-foreground mr-2">{{ plan.originalPriceMonthly
                    }}/月</span>
                  </template>
                  <template v-else>
                    ¥{{ plan.priceYearly }}/年
                    <span class="text-base line-through text-muted-foreground mr-2">{{ plan.originalPriceYearly
                    }}/年</span>
                  </template>
                  <br>
                  <span class="text-base mb-2">赠送{{ plan.giftPoint }}积分</span>
                </p>
                <p class="text-xs text-muted-foreground">{{ plan.description }}</p>
              </div>
            </div>
          </div>

          <!-- 会员权益 -->
          <MembershipBenefits :key="benefitsLevelName" :selected-level="benefitsLevelName" />
        </div>
      </TabsContent>

      <!-- 会员记录 Tab -->
      <TabsContent value="records" class="mt-6">
        <div>
          <h3 class="text-lg font-medium mb-4">会员记录</h3>

          <!-- 桌面端表格视图 -->
          <div class="border rounded-lg overflow-hidden hidden md:block">
            <table class="w-full">
              <thead>
                <tr class="border-b bg-muted/50">
                  <th class="px-4 py-3 text-left text-sm font-medium">会员版本</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">有效期</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">会员渠道</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">创建时间</th>
                  <th class="px-4 py-3 text-left text-sm font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="membershipHistory.length === 0">
                  <td colspan="6" class="px-4 py-8 text-center text-muted-foreground">暂无会员记录</td>
                </tr>
                <tr v-else v-for="record in membershipHistory" :key="record.id"
                  class="border-b last:border-b-0 hover:bg-muted/30">
                  <td class="px-4 py-3 text-sm">{{ record.levelName }}</td>
                  <td class="px-4 py-3 text-sm">{{ formatDateOnly(record.startDate) }} - {{
                    formatDateOnly(record.endDate) }}</td>
                  <td class="px-4 py-3 text-sm">{{ record.sourceTypeName }}</td>
                  <td class="px-4 py-3 text-sm">
                    <span v-if="record.status === 1"
                      class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                    <span v-if="record.status === 0"
                      class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                  </td>
                  <td class="px-4 py-3 text-sm">{{ formatDate(record.createdAt) }}</td>
                  <td class="px-4 py-3 text-sm">
                    <Button v-if="record.status === 1 && !isHighestLevel(record.levelId)" size="sm"
                      @click="openUpgradeDialog(record)">
                      升级
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片视图 -->
          <div class="md:hidden space-y-4">
            <div v-if="membershipHistory.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg">
              暂无会员记录
            </div>

            <div v-else v-for="record in membershipHistory" :key="record.id" class="border rounded-lg p-4 space-y-3">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="font-medium text-sm mb-1">{{ record.levelName }}</h3>
                  <p class="text-sm text-muted-foreground">{{ record.sourceTypeName }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="record.status === 1"
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                  <span v-if="record.status === 0"
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                  <Button v-if="record.status === 1 && !isHighestLevel(record.levelId)" size="sm"
                    @click="openUpgradeDialog(record)">
                    升级
                  </Button>
                </div>
              </div>

              <div class="text-sm">
                <p class="text-muted-foreground mb-1">有效期</p>
                <p>{{ formatDateOnly(record.startDate) }} - {{ formatDateOnly(record.endDate) }}</p>
              </div>

              <div class="text-sm">
                <p class="text-muted-foreground mb-1">创建时间</p>
                <p>{{ formatDate(record.createdAt) }}</p>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>

    <!-- 二维码弹框 -->
    <Dialog :open="showQRCode" @update:open="showQRCode = false">
      <DialogContent class="sm:max-w-[425px]" @open-auto-focus.prevent>
        <DialogHeader>
          <DialogTitle>请使用微信扫码购买</DialogTitle>
          <DialogDescription>
            打开微信扫一扫，立即购买会员
          </DialogDescription>
        </DialogHeader>
        <div class="flex justify-center py-4">
          <div v-if="agreeToPurchaseAgreement" class="flex justify-center">
            <img :src="qrCodeUrl" alt="微信支付二维码" class="w-64 h-64" />
          </div>
          <div v-else
            class="flex flex-col items-center justify-center w-64 h-64 border-2 border-dashed border-muted bg-muted/10 rounded-lg">
            <div class="text-center p-4">
              <p class="text-sm text-muted-foreground mb-2">请先同意购买协议</p>
              <p class="text-xs text-muted-foreground">勾选下方协议后显示支付二维码</p>
            </div>
          </div>
        </div>

        <!-- 购买协议复选框 -->
        <div class="border-t pt-4">
          <div class="flex items-start space-x-2">
            <Checkbox id="qrcode-agreement" v-model:checked="agreeToPurchaseAgreement" class="mt-1" />
            <label for="qrcode-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
              购买即同意
              <a href="/purchase-agreement" target="_blank" class="text-primary hover:text-primary/80 font-bold">
                《LexSeek（法索 AI ）服务购买协议》
              </a>
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 升级弹框 -->
    <Dialog :open="showUpgradeDialog" @update:open="closeUpgradeDialog">
      <DialogContent class="sm:max-w-[500px]" @open-auto-focus.prevent>
        <DialogHeader>
          <DialogTitle>会员升级</DialogTitle>
          <DialogDescription>
            选择要升级到的会员级别
          </DialogDescription>
        </DialogHeader>
        <div v-if="upgradeOptionsLoading" class="py-8 text-center">
          <div class="loading">加载中...</div>
        </div>
        <div v-else-if="upgradeOptions.length > 0" class="space-y-4">
          <div v-for="option in upgradeOptions" :key="option.levelId"
            class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer"
            :class="{ 'border-primary bg-primary/5': selectedUpgradeOption?.levelId === option.levelId }"
            @click="selectedUpgradeOption = option">
            <div class="flex justify-between items-start mb-2">
              <h4 class="font-semibold">{{ option.levelName }}</h4>
              <div class="text-right">
                <p class="text-lg font-bold text-primary">¥{{ option.upgradePrice }}</p>
                <p class="text-xs text-muted-foreground">升级价格</p>
              </div>
            </div>
            <div class="text-sm text-muted-foreground">
              <p>当前价格：¥{{ option.currentPrice }}</p>
              <p v-if="option.pointCompensation > 0">积分补偿：{{ option.pointCompensation }}</p>
            </div>
          </div>

          <!-- 购买协议复选框 -->
          <div class="border-t pt-4">
            <div class="flex items-start space-x-2">
              <Checkbox id="upgrade-agreement" v-model:checked="agreeToPurchaseAgreement" class="mt-1" />
              <label for="upgrade-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                购买即同意
                <a href="/purchase-agreement" target="_blank" class="text-primary hover:text-primary/80 underline">
                  《LexSeek（法索 AI ）服务购买协议》
                </a>
              </label>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-4">
            <Button variant="outline" @click="closeUpgradeDialog(false)">取消</Button>
            <Button :disabled="!selectedUpgradeOption || !agreeToPurchaseAgreement" @click="confirmUpgrade">确认升级
            </Button>
          </div>
        </div>
        <div v-else class="py-8 text-center text-muted-foreground">
          暂无可升级的级别
        </div>
      </DialogContent>
    </Dialog>

    <!-- 续期弹框 -->
    <Dialog :open="showRenewalDialog" @update:open="showRenewalDialog = false">
      <DialogContent class="sm:max-w-[960px]" @open-auto-focus.prevent>
        <DialogHeader>
          <DialogTitle>会员续期</DialogTitle>
          <DialogDescription>
            选择要续期的会员级别
          </DialogDescription>
        </DialogHeader>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div v-for="plan in productList" :key="plan.id"
            class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer">
            <div class="flex justify-between items-start mb-2">
              <h4 class="font-semibold">{{ plan.name }}</h4>
              <Button size="sm" @click="buy(plan)" :disabled="!agreeToPurchaseAgreement">
                购买
              </Button>
            </div>
            <p class="text-2xl font-bold mb-2">
              <template v-if="plan.defaultDuration === 1">
                ¥{{ plan.priceMonthly }}/月
              </template>
              <template v-else>
                ¥{{ plan.priceYearly }}/年
              </template>
              <span class="text-sm font-bold mb-2">赠送{{ plan.giftPoint }}积分</span>
            </p>
            <p class="text-xs text-muted-foreground">{{ plan.description }}</p>
          </div>
        </div>

        <!-- 购买协议复选框 -->
        <div class="border-t pt-4 mt-4">
          <div class="flex items-start space-x-2">
            <Checkbox id="renewal-agreement" v-model:checked="agreeToPurchaseAgreement" class="mt-1" />
            <label for="renewal-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
              购买即代表您同意
              <a href="/purchase-agreement" target="_blank" class="text-primary hover:text-primary/80 font-bold">
                《LexSeek（法索 AI ）服务购买协议》
              </a>
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script lang="ts" setup>
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

// 配置 dayjs
dayjs.locale("zh-cn");

// 页面元信息
definePageMeta({
  layout: "dashboard-layout",
  title: "我的会员",
});

// ==================== 类型定义 ====================

/** 会员套餐 */
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
  defaultDuration: number; // 1: 月, 12: 年
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

// ==================== 状态定义 ====================

// Tab 状态
const activeTab = ref("packages");
const selectedPlanLevel = ref("");

// 当前会员信息（模拟数据）
const currentMembership = ref({
  levelName: "专业版",
  expiresAt: "2025-12-31",
  levelId: 2,
});

// 会员套餐列表（模拟数据）
const productList = ref<MembershipPlan[]>([
  {
    id: 1,
    name: "基础版",
    levelId: 1,
    priceMonthly: 29,
    priceYearly: 299,
    originalPriceMonthly: 39,
    originalPriceYearly: 399,
    giftPoint: 500,
    description: "适合个人用户，满足基本法律咨询需求",
    defaultDuration: 12,
  },
  {
    id: 2,
    name: "专业版",
    levelId: 2,
    priceMonthly: 59,
    priceYearly: 599,
    originalPriceMonthly: 79,
    originalPriceYearly: 799,
    giftPoint: 1000,
    description: "适合专业律师，提供完整案件分析功能",
    defaultDuration: 12,
  },
  {
    id: 3,
    name: "旗舰版",
    levelId: 3,
    priceMonthly: 99,
    priceYearly: 999,
    originalPriceMonthly: 129,
    originalPriceYearly: 1299,
    giftPoint: 2000,
    description: "适合律所团队，享受全部高级功能",
    defaultDuration: 12,
  },
]);

// 会员记录（模拟数据）
const membershipHistory = ref<MembershipRecord[]>([
  {
    id: 1,
    levelId: 2,
    levelName: "专业版",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    sourceTypeName: "购买",
    status: 1,
    createdAt: "2025-01-01T10:00:00Z",
  },
  {
    id: 2,
    levelId: 1,
    levelName: "基础版",
    startDate: "2024-01-01",
    endDate: "2024-12-31",
    sourceTypeName: "兑换",
    status: 0,
    createdAt: "2024-01-01T08:30:00Z",
  },
]);

// 会员等级列表（用于判断最高级别）
const membershipLevels = ref([
  { id: 0, name: "免费版", sortOrder: 0 },
  { id: 1, name: "基础版", sortOrder: 1 },
  { id: 2, name: "专业版", sortOrder: 2 },
  { id: 3, name: "旗舰版", sortOrder: 3 },
]);

// 弹框状态
const showQRCode = ref(false);
const qrCodeUrl = ref("");
const showUpgradeDialog = ref(false);
const showRenewalDialog = ref(false);

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
  return (
    !currentMembership.value ||
    currentMembership.value.levelName === "免费版" ||
    currentMembership.value.levelId === 0
  );
});

/** 权益表格显示的级别名称 */
const benefitsLevelName = computed(() => {
  const selectedPlan = productList.value.find(
    (p) => p.name === selectedPlanLevel.value
  );
  if (selectedPlan && selectedPlan.levelId !== undefined) {
    return getLevelNameByLevelId(selectedPlan.levelId);
  }
  return selectedPlanLevel.value || "免费版";
});

// ==================== 方法定义 ====================

/**
 * 根据 levelId 获取级别名称
 */
const getLevelNameByLevelId = (levelId: number): string => {
  const levelMap: Record<number, string> = {
    0: "免费版",
    1: "基础版",
    2: "专业版",
    3: "旗舰版",
  };
  return levelMap[levelId] || "免费版";
};

/**
 * 选择套餐
 */
const selectPlan = (plan: MembershipPlan) => {
  selectedPlanLevel.value = plan.name;
};

/**
 * 判断是否可以升级到某个套餐
 */
const canUpgradeToPlan = (plan: MembershipPlan): boolean => {
  // 免费用户不显示升级按钮
  if (isFreeUser.value) return false;

  // 当前级别相同不显示
  if (currentMembership.value.levelName === plan.name) return false;

  // 最高级别不显示
  if (isHighestLevel(currentMembership.value.levelId)) return false;

  // 只有目标级别高于当前级别才显示
  const currentLevel = membershipLevels.value.find(
    (l) => l.id === currentMembership.value.levelId
  );
  const targetLevel = membershipLevels.value.find((l) => l.id === plan.levelId);

  if (!currentLevel || !targetLevel) return false;

  return targetLevel.sortOrder > currentLevel.sortOrder;
};

/**
 * 判断是否是最高级别
 */
const isHighestLevel = (levelId: number): boolean => {
  if (membershipLevels.value.length === 0) return false;

  const maxSortOrder = Math.max(
    ...membershipLevels.value.map((l) => l.sortOrder)
  );
  const currentLevel = membershipLevels.value.find((l) => l.id === levelId);

  return currentLevel ? currentLevel.sortOrder >= maxSortOrder : false;
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

  // TODO: 实际购买逻辑
  toast.info(`购买 ${plan.name}，价格 ¥${plan.priceYearly}/年`);
};

/**
 * 升级到指定套餐
 */
const upgradeToPlan = async (plan: MembershipPlan) => {
  // TODO: 实际升级逻辑
  toast.info(`升级到 ${plan.name}`);
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

  // 模拟加载升级选项
  await new Promise((resolve) => setTimeout(resolve, 500));

  // 模拟升级选项数据
  upgradeOptions.value = [
    {
      levelId: 3,
      levelName: "旗舰版",
      upgradePrice: 400,
      currentPrice: 599,
      pointCompensation: 500,
    },
  ];

  upgradeOptionsLoading.value = false;
};

/**
 * 关闭升级弹框
 */
const closeUpgradeDialog = (open: boolean) => {
  if (!open) {
    showUpgradeDialog.value = false;
    selectedUpgradeOption.value = null;
    currentUpgradeRecord.value = null;
    upgradeOptions.value = [];
  }
};

/**
 * 确认升级
 */
const confirmUpgrade = async () => {
  if (!selectedUpgradeOption.value || !currentUpgradeRecord.value) return;

  // TODO: 实际升级逻辑
  toast.success(`升级到 ${selectedUpgradeOption.value.levelName} 成功`);
  closeUpgradeDialog(false);
};

/**
 * 格式化日期（仅日期）
 */
const formatDateOnly = (dateString: string): string => {
  if (!dateString) return "—";
  return dayjs(dateString).format("YYYY-MM-DD");
};

/**
 * 格式化日期（含时间）
 */
const formatDate = (dateString: string): string => {
  if (!dateString) return "—";
  return dayjs(dateString).format("YYYY年MM月DD日 HH:mm");
};

// ==================== 生命周期 ====================

onMounted(() => {
  // 设置默认选中的套餐
  if (currentMembership.value.levelName !== "免费版") {
    const matchingPlan = productList.value.find(
      (p) => p.name === currentMembership.value.levelName
    );
    if (matchingPlan) {
      selectedPlanLevel.value = matchingPlan.name;
    }
  } else {
    selectedPlanLevel.value = "免费版";
  }
});
</script>

<style scoped>
/* 会员等级页面样式 */
</style>
