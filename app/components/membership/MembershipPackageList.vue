<template>
    <!-- 套餐列表 -->
    <div>
        <h3 class="text-lg font-medium mb-4">会员套餐</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div v-for="plan in productList" :key="plan.id"
                class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer relative"
                :class="{ 'border-primary': selectedPlanLevel === plan.name }" @click="emit('select', plan)">
                <div class="flex justify-between items-start mb-2">
                    <h4 class="font-semibold">{{ plan.name }}</h4>
                    <!-- 免费用户显示购买按钮 -->
                    <Button v-if="isFreeUser" size="sm" :disabled="!agreeToAgreement" @click.stop="emit('buy', plan)"
                        class="absolute top-2 right-2">
                        购买
                    </Button>
                    <!-- 限购商品显示购买按钮（不能升级） -->
                    <Button v-else-if="isLimitedPurchasePlan(plan)" size="sm" :disabled="!agreeToAgreement"
                        @click.stop="emit('buy', plan)" class="absolute top-2 right-2">
                        购买
                    </Button>
                    <!-- 付费用户显示升级按钮 -->
                    <Button v-else-if="canUpgradeToPlan(plan)" size="sm" :disabled="!agreeToAgreement"
                        @click.stop="emit('upgrade', plan)" class="absolute top-2 right-2">
                        升级
                    </Button>
                </div>
                <p class="text-2xl font-bold mb-2">
                    <template v-if="plan.defaultDuration === 1">
                        ¥{{ plan.priceMonthly }}/月
                        <span v-if="plan.originalPriceMonthly && plan.originalPriceMonthly > plan.priceMonthly"
                            class="text-base line-through text-muted-foreground ml-2">
                            ¥{{ plan.originalPriceMonthly }}
                        </span>
                    </template>
                    <template v-else>
                        ¥{{ plan.priceYearly }}/年
                        <span v-if="plan.originalPriceYearly && plan.originalPriceYearly > plan.priceYearly"
                            class="text-base line-through text-muted-foreground ml-2">
                            ¥{{ plan.originalPriceYearly }}
                        </span>
                    </template>
                </p>
                <p class="text-sm text-muted-foreground mb-2">赠送{{ plan.giftPoint }}积分</p>
                <p class="text-xs text-muted-foreground">{{ plan.description }}</p>
            </div>
        </div>

        <!-- 购买协议复选框 -->
        <div class="border-t pt-4 mt-4">
            <div class="flex items-start space-x-2">
                <Checkbox id="package-agreement" v-model="localAgreed" class="mt-1" />
                <label for="package-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                    购买即代表您同意
                    <NuxtLink to="/purchase-agreement" target="_blank"
                        class="text-primary hover:text-primary/80 font-bold">
                        《LexSeek（法索 AI）服务购买协议》
                    </NuxtLink>
                </label>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
// 类型定义
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

interface MembershipLevel {
    id: number;
    name: string;
    sortOrder: number;
}

// 定义 props
const props = defineProps<{
    productList: MembershipPlan[];
    selectedPlanLevel: string;
    currentMembership: {
        levelName: string;
        levelId: number;
    };
    membershipLevels: MembershipLevel[];
    isFreeUser: boolean;
    agreeToAgreement?: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    select: [plan: MembershipPlan];
    buy: [plan: MembershipPlan];
    upgrade: [plan: MembershipPlan];
    'update:agreeToAgreement': [value: boolean];
}>();

// 本地协议勾选状态（使用 computed 实现双向绑定，避免循环更新）
const localAgreed = computed({
    get: () => props.agreeToAgreement ?? true,
    set: (val) => emit('update:agreeToAgreement', val),
});

// 判断是否是限购商品（有购买限制且级别高于当前）
const isLimitedPurchasePlan = (plan: MembershipPlan): boolean => {
    if (props.isFreeUser) return false;
    if (!plan.purchaseLimit || plan.purchaseLimit <= 0) return false;

    const currentLevel = props.membershipLevels.find(
        (l) => l.id === props.currentMembership.levelId
    );
    const targetLevel = props.membershipLevels.find((l) => l.id === plan.levelId);

    if (!currentLevel || !targetLevel) return false;
    // 限购商品且级别高于当前，显示购买按钮
    return targetLevel.sortOrder > currentLevel.sortOrder;
};

// 判断是否可以升级到某个套餐
const canUpgradeToPlan = (plan: MembershipPlan): boolean => {
    if (props.isFreeUser) return false;
    if (props.currentMembership.levelName === plan.name) return false;
    if (isHighestLevel(props.currentMembership.levelId)) return false;

    // 有购买限制的商品不能作为升级目标（如新手促销套餐）
    if (plan.purchaseLimit && plan.purchaseLimit > 0) return false;

    const currentLevel = props.membershipLevels.find(
        (l) => l.id === props.currentMembership.levelId
    );
    const targetLevel = props.membershipLevels.find((l) => l.id === plan.levelId);

    if (!currentLevel || !targetLevel) return false;
    return targetLevel.sortOrder > currentLevel.sortOrder;
};

// 判断是否是最高级别
const isHighestLevel = (levelId: number): boolean => {
    if (props.membershipLevels.length === 0) return false;
    const maxSortOrder = Math.max(...props.membershipLevels.map((l) => l.sortOrder));
    const currentLevel = props.membershipLevels.find((l) => l.id === levelId);
    return currentLevel ? currentLevel.sortOrder >= maxSortOrder : false;
};
</script>
