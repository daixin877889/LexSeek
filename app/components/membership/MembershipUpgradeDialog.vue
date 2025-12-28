<template>
    <!-- 升级弹框 -->
    <Dialog :open="open" @update:open="handleOpenChange">
        <DialogContent class="sm:max-w-[500px]" @open-auto-focus.prevent>
            <DialogHeader>
                <DialogTitle>会员升级</DialogTitle>
                <DialogDescription>
                    选择要升级到的会员级别
                </DialogDescription>
            </DialogHeader>
            <div v-if="loading" class="py-8 text-center">
                <div class="loading">加载中...</div>
            </div>
            <div v-else-if="options.length > 0" class="space-y-4">
                <div v-for="option in options" :key="option.levelId"
                    class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer"
                    :class="{ 'border-primary bg-primary/5': selectedOption?.levelId === option.levelId }"
                    @click="emit('select', option)">
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
                        <Checkbox id="upgrade-agreement" :checked="agreeToAgreement"
                            @update:checked="emit('update:agreeToAgreement', $event)" class="mt-1" />
                        <label for="upgrade-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                            购买即同意
                            <a href="/purchase-agreement" target="_blank"
                                class="text-primary hover:text-primary/80 underline">
                                《LexSeek（法索 AI ）服务购买协议》
                            </a>
                        </label>
                    </div>
                </div>

                <div class="flex justify-end gap-2 pt-4">
                    <Button variant="outline" @click="handleOpenChange(false)">取消</Button>
                    <Button :disabled="!selectedOption || !agreeToAgreement" @click="emit('confirm')">确认升级
                    </Button>
                </div>
            </div>
            <div v-else class="py-8 text-center text-muted-foreground">
                暂无可升级的级别
            </div>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
// 类型定义
interface UpgradeOption {
    levelId: number;
    levelName: string;
    upgradePrice: number;
    currentPrice: number;
    pointCompensation: number;
}

// 定义 props
defineProps<{
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

// 处理弹框关闭
const handleOpenChange = (open: boolean) => {
    if (!open) {
        emit('close');
    }
    emit('update:open', open);
};
</script>
