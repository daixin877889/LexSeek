<template>
    <!-- 分页导航组件 -->
    <div v-if="totalPages > 1" class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <!-- 分页信息 -->
        <div class="text-sm text-muted-foreground text-center sm:text-left">
            显示第 {{ startItem }} - {{ endItem }} 条，共 {{ total }} 条
        </div>

        <!-- 页码导航 -->
        <div class="flex items-center justify-center gap-2">
            <!-- 上一页 -->
            <Button variant="outline" size="sm" :disabled="currentPage <= 1" @click="handlePageChange(currentPage - 1)">
                <ChevronLeft class="h-4 w-4" />
            </Button>

            <!-- 页码按钮 -->
            <div class="flex items-center gap-1">
                <Button v-for="pageNum in pageNumbers" :key="pageNum"
                    :variant="pageNum === currentPage ? 'default' : 'outline'" size="sm" class="w-8"
                    @click="handlePageChange(pageNum)">
                    {{ pageNum }}
                </Button>
            </div>

            <!-- 下一页 -->
            <Button variant="outline" size="sm" :disabled="currentPage >= totalPages"
                @click="handlePageChange(currentPage + 1)">
                <ChevronRight class="h-4 w-4" />
            </Button>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { ChevronLeft, ChevronRight } from "lucide-vue-next";

// ==================== Props 定义 ====================

interface Props {
    /** 当前页码 */
    currentPage: number;
    /** 每页数量 */
    pageSize: number;
    /** 总记录数 */
    total: number;
    /** 当前页前后显示的页码数量，默认 2 */
    range?: number;
}

const props = withDefaults(defineProps<Props>(), {
    range: 2,
});

// ==================== Emits 定义 ====================

const emit = defineEmits<{
    /** 页码变化事件 */
    (e: "change", page: number): void;
    /** 支持 v-model:currentPage */
    (e: "update:currentPage", page: number): void;
}>();

// ==================== 计算属性 ====================

/** 总页数 */
const totalPages = computed(() => Math.ceil(props.total / props.pageSize));

/** 当前页起始记录序号 */
const startItem = computed(() => (props.currentPage - 1) * props.pageSize + 1);

/** 当前页结束记录序号 */
const endItem = computed(() =>
    Math.min(props.currentPage * props.pageSize, props.total)
);

/** 页码数组 */
const pageNumbers = computed(() => {
    const current = props.currentPage;
    const range = props.range;

    let start = Math.max(1, current - range);
    let end = Math.min(totalPages.value, current + range);

    // 确保显示足够的页码
    if (end - start < range * 2) {
        if (start === 1) {
            end = Math.min(totalPages.value, start + range * 2);
        } else if (end === totalPages.value) {
            start = Math.max(1, end - range * 2);
        }
    }

    const pages: number[] = [];
    for (let i = start; i <= end; i++) {
        pages.push(i);
    }
    return pages;
});

// ==================== 方法 ====================

/**
 * 处理页码变化
 */
const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages.value) return;
    emit("change", page);
    emit("update:currentPage", page);
};
</script>
