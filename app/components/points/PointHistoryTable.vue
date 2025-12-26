<template>
    <!-- 桌面端表格视图 -->
    <div class="border rounded-lg overflow-hidden hidden md:block">
        <table class="w-full">
            <thead>
                <tr class="border-b bg-muted/50">
                    <th class="px-4 py-3 text-left text-sm font-medium">积分来源</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">积分数量</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">已使用积分</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">剩余积分</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">有效期</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">是否可用</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">备注</th>
                </tr>
            </thead>
            <tbody>
                <!-- 加载中 -->
                <tr v-if="loading">
                    <td colspan="8" class="px-4 py-8 text-center">
                        <div class="flex items-center justify-center">
                            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                            <span class="ml-2 text-muted-foreground">加载中...</span>
                        </div>
                    </td>
                </tr>
                <!-- 空状态 -->
                <tr v-else-if="list.length === 0">
                    <td colspan="8" class="px-4 py-8 text-center text-muted-foreground">暂无积分获取记录</td>
                </tr>
                <!-- 数据列表 -->
                <template v-else>
                    <tr v-for="record in list" :key="record.id" class="border-b last:border-b-0 hover:bg-muted/30">
                        <td class="px-4 py-3 text-sm">{{ record.sourceTypeName }}</td>
                        <td class="px-4 py-3 text-sm">{{ record.pointAmount }}</td>
                        <td class="px-4 py-3 text-sm">{{ record.used }}</td>
                        <td class="px-4 py-3 text-sm">{{ record.remaining }}</td>
                        <td class="px-4 py-3 text-sm">
                            {{ dayjs(record.effectiveAt).format("YYYY年MM月DD日") }} -
                            {{ dayjs(record.expiredAt).format("YYYY年MM月DD日") }}
                        </td>
                        <td class="px-4 py-3 text-sm">
                            <span v-if="record.status === 1"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                            <span v-else-if="record.status === 2"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">已结算</span>
                            <span v-else-if="record.status === 3"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                        </td>
                        <td class="px-4 py-3 text-sm">
                            <span v-if="isAvailable(record)"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">可用</span>
                            <span v-else-if="isNotEffective(record)"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">未生效</span>
                            <span v-else
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-400">已过期</span>
                        </td>
                        <td class="px-4 py-3 text-sm">{{ record.remark || "-" }}</td>
                    </tr>
                </template>
            </tbody>
        </table>
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
