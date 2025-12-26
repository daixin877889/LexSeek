<template>
    <!-- 桌面端表格视图 - 可展开行 -->
    <div class="border rounded-lg overflow-hidden hidden md:block">
        <table class="w-full">
            <thead>
                <tr class="border-b bg-muted/50">
                    <th class="w-10 px-2 py-3"></th>
                    <th class="px-4 py-3 text-left text-sm font-medium">积分来源</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">积分数量</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">剩余积分</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">是否可用</th>
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
                    <td colspan="6" class="px-4 py-8 text-center text-muted-foreground">暂无积分获取记录</td>
                </tr>
                <!-- 数据列表 - 可展开行 -->
                <TooltipProvider v-else>
                    <template v-for="record in list" :key="record.id">
                        <!-- 主行 -->
                        <Tooltip>
                            <TooltipTrigger as-child>
                                <tr class="border-b hover:bg-primary/5 cursor-pointer transition-colors group"
                                    @click="toggleRow(record.id)">
                                    <!-- 展开图标 -->
                                    <td class="px-2 py-3 text-center">
                                        <div
                                            class="w-6 h-6 rounded flex items-center justify-center bg-muted/50 group-hover:bg-primary/10 transition-colors">
                                            <ChevronDownIcon v-if="expandedRows.has(record.id)"
                                                class="w-4 h-4 text-primary transition-transform" />
                                            <ChevronRightIcon v-else
                                                class="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-sm font-medium">{{ record.sourceTypeName }}</td>
                                    <td class="px-4 py-3 text-sm">{{ record.pointAmount }}</td>
                                    <td class="px-4 py-3 text-sm">{{ record.remaining }}</td>
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
                                </tr>
                            </TooltipTrigger>
                            <!-- Tooltip 显示剩余详细内容 -->
                            <TooltipContent side="top" class="max-w-xs">
                                <div class="text-xs space-y-1">
                                    <p><span class="text-muted-foreground">已使用：</span>{{ record.used }}</p>
                                    <p><span class="text-muted-foreground">有效期：</span>{{
                                        dayjs(record.effectiveAt).format("YYYY/MM/DD") }} - {{
                                            dayjs(record.expiredAt).format("YYYY/MM/DD") }}</p>
                                    <p v-if="record.remark"><span class="text-muted-foreground">备注：</span>{{
                                        record.remark }}</p>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                        <!-- 展开详情行 -->
                        <tr v-if="expandedRows.has(record.id)" class="bg-primary/5 border-b">
                            <td colspan="6" class="px-4 py-4">
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm pl-8">
                                    <div>
                                        <p class="text-muted-foreground mb-1">已使用积分</p>
                                        <p class="font-medium">{{ record.used }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">有效期</p>
                                        <p>{{ dayjs(record.effectiveAt).format("YYYY/MM/DD") }} -
                                            {{ dayjs(record.expiredAt).format("YYYY/MM/DD") }}</p>
                                    </div>
                                    <div class="col-span-2">
                                        <p class="text-muted-foreground mb-1">备注</p>
                                        <p>{{ record.remark || "-" }}</p>
                                    </div>
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
