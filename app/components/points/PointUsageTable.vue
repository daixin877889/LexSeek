<template>
    <!-- 桌面端表格视图 -->
    <div class="border rounded-lg overflow-hidden hidden md:block">
        <table class="w-full">
            <thead>
                <tr class="border-b bg-muted/50">
                    <th class="px-4 py-3 text-left text-sm font-medium">使用场景</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">消耗积分</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">使用时间</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">备注</th>
                </tr>
            </thead>
            <tbody>
                <!-- 加载中 -->
                <tr v-if="loading">
                    <td colspan="5" class="px-4 py-8 text-center">
                        <div class="flex items-center justify-center">
                            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                            <span class="ml-2 text-muted-foreground">加载中...</span>
                        </div>
                    </td>
                </tr>
                <!-- 空状态 -->
                <tr v-else-if="list.length === 0">
                    <td colspan="5" class="px-4 py-8 text-center text-muted-foreground">暂无积分使用记录</td>
                </tr>
                <!-- 数据列表 -->
                <template v-else>
                    <tr v-for="usage in list" :key="usage.id" class="border-b last:border-b-0 hover:bg-muted/30">
                        <td class="px-4 py-3 text-sm">{{ usage.itemDescription }}</td>
                        <td class="px-4 py-3 text-sm">{{ usage.pointAmount }}</td>
                        <td class="px-4 py-3 text-sm">
                            <span v-if="usage.status === 0"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">异常</span>
                            <span v-else-if="usage.status === 1"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">预扣</span>
                            <span v-else-if="usage.status === 2"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">已结算</span>
                        </td>
                        <td class="px-4 py-3 text-sm">{{ dayjs(usage.createdAt).format("YYYY年MM月DD日 HH:mm") }}</td>
                        <td class="px-4 py-3 text-sm">{{ usage.remark || "-" }}</td>
                    </tr>
                </template>
            </tbody>
        </table>
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
