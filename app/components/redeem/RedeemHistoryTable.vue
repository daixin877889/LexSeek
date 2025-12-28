<template>
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
                <tr v-if="loading">
                    <td colspan="6" class="px-4 py-8 text-center">
                        <div class="flex items-center justify-center">
                            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                            <span class="ml-2 text-muted-foreground">加载中...</span>
                        </div>
                    </td>
                </tr>
                <!-- 空状态 -->
                <tr v-else-if="list.length === 0">
                    <td colspan="6" class="px-4 py-8 text-center text-muted-foreground">
                        暂无兑换记录
                    </td>
                </tr>
                <!-- 数据列表 -->
                <template v-else>
                    <tr v-for="record in list" :key="record.id" class="border-b last:border-b-0 hover:bg-muted/30">
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
