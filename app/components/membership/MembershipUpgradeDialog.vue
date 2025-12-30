<template>
    <!-- 升级弹框 -->
    <Dialog :open="open" @update:open="handleOpenChange">
        <DialogContent class="sm:max-w-[560px] max-h-[85vh] flex flex-col" @open-auto-focus.prevent>
            <!-- 固定头部 -->
            <DialogHeader class="flex-shrink-0">
                <DialogTitle>会员升级</DialogTitle>
                <DialogDescription>
                    选择要升级到的会员级别
                </DialogDescription>
            </DialogHeader>

            <!-- 加载状态 -->
            <div v-if="loading" class="py-8 text-center">
                <div class="loading">加载中...</div>
            </div>

            <!-- 内容区域（可滚动） -->
            <div v-else-if="options.length > 0" class="flex flex-col flex-1 min-h-0">
                <!-- 升级选项列表（可滚动） -->
                <div class="flex-1 overflow-y-auto space-y-4 pr-1">
                    <div v-for="option in options" :key="option.levelId"
                        class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer"
                        :class="{ 'border-primary bg-primary/5': selectedOption?.levelId === option.levelId }"
                        @click="emit('select', option)">
                        <div class="flex justify-between items-start mb-3">
                            <h4 class="font-semibold text-base">{{ option.levelName }}</h4>
                            <div class="text-right">
                                <p class="text-xl font-bold text-primary">¥{{ option.upgradePrice.toFixed(2) }}</p>
                                <p class="text-xs text-muted-foreground">升级价格</p>
                            </div>
                        </div>

                        <!-- 计算逻辑展示（可折叠） -->
                        <div v-if="option.calculationDetails" class="mb-2">
                            <!-- 查看计算明细按钮 -->
                            <button type="button"
                                class="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                                @click.stop="toggleDetails(option.levelId)">
                                <span>{{ expandedDetails.has(option.levelId) ? '收起' : '查看' }}计算明细</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                                    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                                    stroke-linejoin="round"
                                    :class="{ 'rotate-180': expandedDetails.has(option.levelId) }"
                                    class="transition-transform">
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </button>

                            <!-- 计算明细内容 -->
                            <div v-if="expandedDetails.has(option.levelId)"
                                class="bg-muted/50 rounded-md p-3 text-xs space-y-1.5 mt-2">
                                <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">实付金额：</span>
                                        <span>¥{{ option.calculationDetails.paidAmount.toFixed(2) }}</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">套餐天数：</span>
                                        <span>{{ option.calculationDetails.totalDays }} 天</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">剩余天数：</span>
                                        <span>{{ option.calculationDetails.remainingDays }} 天</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">日均价值：</span>
                                        <span>¥{{ option.calculationDetails.dailyValue.toFixed(4) }}/天</span>
                                    </div>
                                </div>
                                <div class="border-t border-border/50 pt-1.5 mt-1.5">
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">当前剩余价值：</span>
                                        <span>¥{{ option.calculationDetails.originalRemainingValue.toFixed(2) }}</span>
                                    </div>
                                </div>
                                <div class="border-t border-border/50 pt-1.5 mt-1.5">
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">目标年价：</span>
                                        <span>¥{{ option.calculationDetails.targetYearlyPrice.toFixed(2) }}/年</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">目标日均价值：</span>
                                        <span>¥{{ option.calculationDetails.targetDailyValue.toFixed(4) }}/天</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">目标剩余价值：</span>
                                        <span>¥{{ option.calculationDetails.targetRemainingValue.toFixed(2) }}</span>
                                    </div>
                                </div>
                                <div class="border-t border-border/50 pt-1.5 mt-1.5 font-medium">
                                    <div class="flex justify-between text-primary">
                                        <span>升级价格 = 目标剩余价值 - 当前剩余价值</span>
                                        <span>¥{{ option.upgradePrice.toFixed(2) }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="text-sm text-muted-foreground flex justify-between">
                            <span>当前套餐年价：¥{{ option.currentPrice }}</span>
                            <span v-if="option.pointCompensation > 0" class="text-primary">
                                积分补偿：+{{ option.pointCompensation }}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- 固定底部（协议和按钮） -->
                <div class="flex-shrink-0 border-t pt-4 mt-4 space-y-4">
                    <!-- 购买协议复选框 -->
                    <div class="flex items-start space-x-2">
                        <Checkbox id="upgrade-agreement" v-model="localAgreed" class="mt-1" />
                        <label for="upgrade-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                            购买即同意
                            <a href="/purchase-agreement" target="_blank"
                                class="text-primary hover:text-primary/80 underline">
                                《LexSeek（法索 AI ）服务购买协议》
                            </a>
                        </label>
                    </div>

                    <div class="flex justify-end gap-2">
                        <Button variant="outline" @click="handleOpenChange(false)">取消</Button>
                        <Button :disabled="!selectedOption || !localAgreed" @click="emit('confirm')">确认升级
                        </Button>
                    </div>
                </div>
            </div>

            <!-- 无可升级级别 -->
            <div v-else class="py-8 text-center text-muted-foreground">
                暂无可升级的级别
            </div>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
// 计算详情类型
interface CalculationDetails {
    paidAmount: number;
    totalDays: number;
    remainingDays: number;
    dailyValue: number;
    targetYearlyPrice: number;
    targetDailyValue: number;
    originalRemainingValue: number;
    targetRemainingValue: number;
}

// 类型定义
interface UpgradeOption {
    levelId: number;
    levelName: string;
    upgradePrice: number;
    currentPrice: number;
    pointCompensation: number;
    calculationDetails?: CalculationDetails;
}

// 定义 props
const props = defineProps<{
    open: boolean;
    loading: boolean;
    options: UpgradeOption[];
    selectedOption: UpgradeOption | null;
    agreeToAgreement: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    'update:open': [value: boolean];
    'update:agreeToAgreement': [value: boolean];
    select: [option: UpgradeOption];
    confirm: [];
    close: [];
}>();

// 本地协议勾选状态（使用 computed 实现双向绑定）
const localAgreed = computed({
    get: () => props.agreeToAgreement,
    set: (val) => emit('update:agreeToAgreement', val),
});

// 记录展开的计算明细（使用 levelId 作为 key）
const expandedDetails = ref<Set<number>>(new Set());

// 切换计算明细展开/收起
const toggleDetails = (levelId: number) => {
    if (expandedDetails.value.has(levelId)) {
        expandedDetails.value.delete(levelId);
    } else {
        expandedDetails.value.add(levelId);
    }
    // 触发响应式更新
    expandedDetails.value = new Set(expandedDetails.value);
};

// 处理弹框关闭
const handleOpenChange = (open: boolean) => {
    if (!open) {
        emit('close');
        // 关闭弹框时重置展开状态
        expandedDetails.value = new Set();
    }
    emit('update:open', open);
};
</script>
