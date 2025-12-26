<template>
    <!-- 移动端卡片视图 -->
    <div class="md:hidden space-y-4">
        <!-- 加载中 -->
        <div v-if="loading" class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span class="ml-2 text-muted-foreground">加载中...</span>
        </div>
        <!-- 空状态 -->
        <div v-else-if="list.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg">
            暂无积分使用记录
        </div>
        <!-- 数据列表 -->
        <div v-else v-for="usage in list" :key="usage.id" class="border rounded-lg p-4 space-y-3">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-medium text-sm mb-1">{{ usage.itemDescription }}</h3>
                    <p class="text-lg font-bold text-red-600">-{{ usage.pointAmount }} 积分</p>
                </div>
                <!-- 状态标签 -->
                <span v-if="usage.status === 0"
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">异常</span>
                <span v-else-if="usage.status === 1"
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">预扣</span>
                <span v-else-if="usage.status === 2"
                    class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">已结算</span>
            </div>
            <!-- 使用时间 -->
            <div class="text-sm">
                <p class="text-muted-foreground mb-1">使用时间</p>
                <p>{{ dayjs(usage.createdAt).format("YYYY年MM月DD日 HH:mm") }}</p>
            </div>
            <!-- 备注 -->
            <div v-if="usage.remark" class="text-sm">
                <p class="text-muted-foreground mb-1">备注</p>
                <p>{{ usage.remark }}</p>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import dayjs from "dayjs";

// ==================== 类型定义 ====================

/** 积分使用记录 */
interface PointUsageRecord {
    id: number;
    itemDescription: string;
    pointAmount: number;
    status: number;
    createdAt: string;
    remark?: string;
}

// ==================== Props ====================

interface Props {
    /** 记录列表 */
    list: PointUsageRecord[];
    /** 是否加载中 */
    loading?: boolean;
}

defineProps<Props>();
</script>
