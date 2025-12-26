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
            暂无积分使用记录
        </div>

        <!-- 数据列表 -->
        <div v-else class="space-y-4">
            <div v-for="usage in list" :key="usage.id" class="border rounded-lg p-4 space-y-3">
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
import dayjs from "dayjs";
import { RefreshCwIcon } from "lucide-vue-next";
import { useIntersectionObserver } from "@vueuse/core";

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
