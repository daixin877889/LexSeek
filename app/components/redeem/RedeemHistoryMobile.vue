<template>
    <!-- 移动端卡片视图 -->
    <div class="md:hidden space-y-4">
        <div v-if="loading" class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span class="ml-2 text-muted-foreground">加载中...</span>
        </div>
        <div v-else-if="list.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg">
            暂无兑换记录
        </div>
        <div v-else v-for="record in list" :key="record.id" class="border rounded-lg p-4 space-y-3">
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
</template>

<script lang="ts" setup>
import { RedemptionCodeType, type RedemptionRecordInfo } from "#shared/types/redemption";

// 定义 props
defineProps<{
    list: RedemptionRecordInfo[];
    loading: boolean;
}>();

// 获取兑换码类型名称
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

// 脱敏兑换码（显示前4位和后4位）
const maskCode = (code: string): string => {
    if (code.length <= 8) return code;
    return `${code.slice(0, 4)}****${code.slice(-4)}`;
};
</script>
