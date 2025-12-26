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
            暂无积分获取记录
        </div>
        <!-- 数据列表 -->
        <div v-else v-for="record in list" :key="record.id" class="border rounded-lg p-4 space-y-3">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-medium text-sm mb-1">{{ record.sourceTypeName }}</h3>
                    <p class="text-lg font-bold text-primary">{{ record.pointAmount }} 积分</p>
                </div>
                <div class="flex flex-col gap-1">
                    <!-- 状态标签 -->
                    <span v-if="record.status === 1"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                    <span v-else-if="record.status === 2"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">已结算</span>
                    <span v-else-if="record.status === 3"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                    <!-- 可用状态标签 -->
                    <span v-if="isAvailable(record)"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">可用</span>
                    <span v-else-if="isNotEffective(record)"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">未生效</span>
                    <span v-else
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-400">已过期</span>
                </div>
            </div>
            <!-- 使用情况 -->
            <div class="grid grid-cols-2 gap-2 text-sm">
                <div>
                    <p class="text-muted-foreground">已使用</p>
                    <p class="font-medium">{{ record.used }}</p>
                </div>
                <div>
                    <p class="text-muted-foreground">剩余</p>
                    <p class="font-medium">{{ record.remaining }}</p>
                </div>
            </div>
            <!-- 有效期 -->
            <div class="text-sm">
                <p class="text-muted-foreground mb-1">有效期</p>
                <p>{{ dayjs(record.effectiveAt).format("YYYY年MM月DD日") }} -
                    {{ dayjs(record.expiredAt).format("YYYY年MM月DD日") }}</p>
            </div>
            <!-- 备注 -->
            <div v-if="record.remark" class="text-sm">
                <p class="text-muted-foreground mb-1">备注</p>
                <p>{{ record.remark }}</p>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import dayjs from "dayjs";

// ==================== 类型定义 ====================

/** 积分获取记录 */
interface PointHistoryRecord {
    id: number;
    sourceType: number;
    sourceTypeName: string;
    pointAmount: number;
    used: number;
    remaining: number;
    effectiveAt: string;
    expiredAt: string;
    status: number;
    remark?: string;
}

// ==================== Props ====================

interface Props {
    /** 记录列表 */
    list: PointHistoryRecord[];
    /** 是否加载中 */
    loading?: boolean;
}

defineProps<Props>();

// ==================== 工具方法 ====================

/**
 * 判断积分记录是否可用
 */
const isAvailable = (record: PointHistoryRecord): boolean => {
    const now = new Date();
    const effectiveAt = new Date(record.effectiveAt);
    const expiredAt = new Date(record.expiredAt);
    return effectiveAt < now && expiredAt > now;
};

/**
 * 判断积分记录是否未生效
 */
const isNotEffective = (record: PointHistoryRecord): boolean => {
    const now = new Date();
    const effectiveAt = new Date(record.effectiveAt);
    return effectiveAt > now;
};
</script>
