<template>
    <!-- 移动端卡片视图（上拉加载） -->
    <div class="md:hidden">
        <!-- 刷新按钮 -->
        <div class="flex justify-end mb-3">
            <Button variant="ghost" size="sm" :disabled="refreshing || loading" @click="emit('refresh')">
                <RefreshCwIcon class="w-4 h-4 mr-1" :class="{ 'animate-spin': refreshing }" />
                {{ refreshing ? '刷新中...' : '刷新' }}
            </Button>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && !refreshing && list.length === 0"
            class="text-center py-8 text-muted-foreground border rounded-lg">
            暂无积分获取记录
        </div>

        <!-- 数据列表 -->
        <div v-else class="space-y-4">
            <div v-for="record in list" :key="record.id" class="border rounded-lg p-4 space-y-3">
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
                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">已结算</span>
                        <span v-else-if="record.status === 3"
                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                        <!-- 可用状态标签（已结算或已作废的不显示） -->
                        <template v-if="record.status === 1">
                            <span v-if="isAvailable(record)"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">可用</span>
                            <span v-else-if="isNotEffective(record)"
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">未生效</span>
                            <span v-else
                                class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-400">已过期</span>
                        </template>
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
                    <p>{{ formatDateChinese(record.effectiveAt).split(' ')[0] }} -
                        {{ formatDateChinese(record.expiredAt).split(' ')[0] }}</p>
                </div>
                <!-- 备注 -->
                <div v-if="record.remark" class="text-sm">
                    <p class="text-muted-foreground mb-1">备注</p>
                    <p>{{ record.remark }}</p>
                </div>
            </div>
        </div>

        <!-- 上拉加载触发器 -->
        <div ref="loadMoreTriggerRef" class="py-4 text-center">
            <div v-if="loading" class="flex items-center justify-center">
                <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mr-2"></div>
                <span class="text-sm text-muted-foreground">加载中...</span>
            </div>
            <div v-else-if="!hasMore && list.length > 0" class="text-sm text-muted-foreground">
                没有更多了
            </div>
            <div v-else-if="hasMore && list.length > 0" class="text-sm text-muted-foreground">
                上拉加载更多
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { RefreshCwIcon } from "lucide-vue-next";
import { useIntersectionObserver } from "@vueuse/core";
import type { PointHistoryRecord } from "#shared/types/point.types";

// ==================== Props ====================

interface Props {
    /** 记录列表 */
    list: PointHistoryRecord[];
    /** 是否加载中 */
    loading?: boolean;
    /** 是否正在刷新 */
    refreshing?: boolean;
    /** 是否还有更多数据 */
    hasMore?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    loading: false,
    refreshing: false,
    hasMore: true,
});

// ==================== Emits ====================

const emit = defineEmits<{
    /** 加载更多 */
    (e: "loadMore"): void;
    /** 下拉刷新 */
    (e: "refresh"): void;
}>();

// ==================== Composables ====================

// 使用格式化工具
const { formatDateChinese } = useFormatters()

// 使用积分状态工具
const { isAvailable, isNotEffective } = usePointStatus()

// ==================== 状态 ====================

const loadMoreTriggerRef = ref<HTMLElement | null>(null);

// ==================== 使用 IntersectionObserver 检测底部元素 ====================

useIntersectionObserver(
    loadMoreTriggerRef,
    (entries) => {
        const entry = entries[0];
        // 当底部元素进入视口且满足加载条件时触发加载
        if (entry?.isIntersecting && !props.loading && props.hasMore && props.list.length > 0) {
            emit("loadMore");
        }
    },
    {
        // 提前 100px 触发
        rootMargin: "100px",
    }
);
</script>
