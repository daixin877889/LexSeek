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
            @select="selectPlan" @buy="buy" @upgrade="upgradeToPlan" />

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

    <!-- 二维码弹框 -->
    <MembershipQRCodeDialog v-model:open="showQRCode" :qr-code-url="qrCodeUrl"
      v-model:agree-to-agreement="agreeToPurchaseAgreement" />

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
  defaultDuration: number;
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

// 会员等级列表
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

  // TODO: 实际升级逻辑
  toast.success(`升级到 ${selectedUpgradeOption.value.levelName} 成功`);
  closeUpgradeDialog();
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
