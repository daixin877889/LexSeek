<template>
    <!-- 续期弹框 -->
    <Dialog :open="open" @update:open="emit('update:open', $event)">
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
                        <Button size="sm" @click="emit('buy', plan)" :disabled="!localAgreed">
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
                    <Checkbox id="renewal-agreement" v-model="localAgreed" class="mt-1" />
                    <label for="renewal-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                        购买即代表您同意
                        <a href="/purchase-agreement" target="_blank"
                            class="text-primary hover:text-primary/80 font-bold">
                            《LexSeek（法索 AI ）服务购买协议》
                        </a>
                    </label>
                </div>
            </div>
        </DialogContent>
    </Dialog>
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
}

// 定义 props
const props = defineProps<{
    open: boolean;
    productList: MembershipPlan[];
    agreeToAgreement: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    'update:open': [value: boolean];
    'update:agreeToAgreement': [value: boolean];
    buy: [plan: MembershipPlan];
}>();

// 本地协议勾选状态（使用 computed 实现双向绑定）
const localAgreed = computed({
    get: () => props.agreeToAgreement,
    set: (val) => emit('update:agreeToAgreement', val),
});
</script>
