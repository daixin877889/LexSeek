<template>
    <!-- 积分统计卡片 -->
    <div class="bg-muted/30 rounded-lg p-4 mb-2 pt-2 pl-0">
        <div class="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <!-- 当前可用积分 -->
            <div>
                <p class="text-sm text-muted-foreground mb-2">当前可用总积分</p>
                <p class="text-3xl font-bold mb-1">{{ pointInfo.remaining }}</p>
                <p class="text-xs text-muted-foreground">可用购买积分+可用赠送积分</p>
            </div>
            <!-- 购买积分 -->
            <div>
                <p class="text-xs text-muted-foreground mb-2">可用购买积分</p>
                <p class="text-3xl font-semibold text-muted-foreground mb-1">{{ pointInfo.purchasePoint }}</p>
                <p class="text-xs text-muted-foreground">购买会员赠送或直接购买</p>
            </div>
            <!-- 赠送积分 -->
            <div>
                <p class="text-xs text-muted-foreground mb-2">可用赠送积分</p>
                <p class="text-3xl font-semibold text-muted-foreground mb-1">{{ pointInfo.otherPoint }}</p>
                <p class="text-xs text-muted-foreground">参与活动或系统赠送</p>
            </div>
            <!-- 待生效积分 -->
            <div>
                <p class="text-xs text-muted-foreground mb-2">待生效积分</p>
                <p class="text-3xl font-semibold text-muted-foreground mb-1">{{ pointInfo.pendingPoint }}</p>
                <p class="text-xs text-muted-foreground">会员生效后可用</p>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
// ==================== Props ====================

interface Props {
    /** 积分信息 */
    pointInfo: {
        pointAmount: number;
        used: number;
        remaining: number;
        purchasePoint: number;
        otherPoint: number;
        pendingPoint: number;
    };
}

defineProps<Props>();
</script>
