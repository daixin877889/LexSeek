<template>
    <!-- 桌面端表格视图 - 可展开行 -->
    <div class="border rounded-lg overflow-hidden hidden md:block">
        <table class="w-full">
            <thead>
                <tr class="border-b bg-muted/50">
                    <th class="w-10 px-2 py-3"></th>
                    <th class="px-4 py-3 text-left text-sm font-medium">使用场景</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">消耗积分</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">使用时间</th>
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
                <!-- 数据列表 - 可展开行 -->
                <TooltipProvider v-else>
                    <template v-for="usage in list" :key="usage.id">
                        <!-- 主行 -->
                        <Tooltip>
                            <TooltipTrigger as-child>
                                <tr class="border-b hover:bg-primary/5 cursor-pointer transition-colors group"
                                    @click="toggleRow(usage.id)">
                                    <!-- 展开图标 -->
                                    <td class="px-2 py-3 text-center">
                                        <div
                                            class="w-6 h-6 rounded flex items-center justify-center bg-muted/50 group-hover:bg-primary/10 transition-colors">
                                            <ChevronDownIcon v-if="expandedRows.has(usage.id)"
                                                class="w-4 h-4 text-primary transition-transform" />
                                            <ChevronRightIcon v-else
                                                class="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-sm font-medium">{{ usage.itemDescription }}</td>
                                    <td class="px-4 py-3 text-sm text-red-600">-{{ usage.pointAmount }}</td>
                                    <td class="px-4 py-3 text-sm">
                                        <span v-if="usage.status === 0"
                                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">异常</span>
                                        <span v-else-if="usage.status === 1"
                                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">预扣</span>
                                        <span v-else-if="usage.status === 2"
                                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">已结算</span>
                                    </td>
                                    <td class="px-4 py-3 text-sm">{{ dayjs(usage.createdAt).format("YYYY/MM/DD HH:mm")
                                    }}
                                    </td>
                                </tr>
                            </TooltipTrigger>
                            <!-- Tooltip 显示备注内容 -->
                            <TooltipContent side="top" class="max-w-xs">
                                <div class="text-xs">
                                    <p><span class="text-muted-foreground">备注：</span>{{ usage.remark || "无" }}</p>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                        <!-- 展开详情行 -->
                        <tr v-if="expandedRows.has(usage.id)" class="bg-primary/5 border-b">
                            <td colspan="5" class="px-4 py-4">
                                <div class="text-sm pl-8">
                                    <p class="text-muted-foreground mb-1">备注</p>
                                    <p>{{ usage.remark || "-" }}</p>
                                </div>
                            </td>
                        </tr>
                    </template>
                </TooltipProvider>
            </tbody>
        </table>
    </div>
</template>

<script lang="ts" setup>
import dayjs from "dayjs";
import { ChevronRightIcon, ChevronDownIcon, InfoIcon } from "lucide-vue-next";

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

// ==================== 展开状态管理 ====================

/** 已展开的行 ID 集合 */
const expandedRows = ref<Set<number>>(new Set());

/**
 * 切换行的展开/收起状态
 */
const toggleRow = (id: number) => {
    if (expandedRows.value.has(id)) {
        expandedRows.value.delete(id);
    } else {
        expandedRows.value.add(id);
    }
    // 触发响应式更新
    expandedRows.value = new Set(expandedRows.value);
};
</script>
