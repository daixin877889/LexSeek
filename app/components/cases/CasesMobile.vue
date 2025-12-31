<template>
    <!-- 移动端卡片视图 -->
    <div class="md:hidden space-y-4">
        <!-- 空状态 -->
        <div v-if="list.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg bg-card">
            暂无案件数据
        </div>

        <!-- 案件卡片列表 -->
        <div v-else v-for="item in list" :key="item.id"
            class="bg-card border rounded-lg p-4 space-y-3 hover:shadow-md transition-shadow">
            <!-- 头部：标题和状态 -->
            <div class="flex justify-between items-start gap-2">
                <NuxtLink :to="`/dashboard/cases/${item.id}`"
                    class="font-medium text-sm hover:text-primary hover:underline line-clamp-2 flex-1">
                    {{ item.title }}
                </NuxtLink>
                <span :class="getStatusClass(item.status)" class="shrink-0">
                    {{ getStatusText(item.status) }}
                </span>
            </div>

            <!-- 案件类型 -->
            <div class="flex items-center text-sm text-muted-foreground">
                <Tag class="h-3.5 w-3.5 mr-1.5" />
                <span>{{ getCaseTypeName(item.caseTypeId) }}</span>
            </div>

            <!-- 创建时间 -->
            <div class="flex items-center text-sm text-muted-foreground">
                <Calendar class="h-3.5 w-3.5 mr-1.5" />
                <span>{{ formatDate(item.createdAt) }}</span>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center justify-end gap-2 pt-2 border-t">
                <NuxtLink :to="`/dashboard/cases/${item.id}`">
                    <Button variant="outline" size="sm" class="h-8">
                        <Eye class="h-3.5 w-3.5 mr-1" />
                        查看
                    </Button>
                </NuxtLink>
                <Button variant="outline" size="sm" class="h-8 text-destructive hover:text-destructive"
                    @click="emit('delete', item.id)">
                    <Trash2 class="h-3.5 w-3.5 mr-1" />
                    删除
                </Button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Eye, Trash2, Tag, Calendar } from "lucide-vue-next";

// ==================== 类型定义 ====================

/** 案件项 */
interface CaseItem {
    id: number;
    title: string;
    caseTypeId: number;
    status: number;
    createdAt: string;
}

/** 案件类型 */
interface CaseType {
    id: number;
    name: string;
}

// ==================== Props ====================

const props = defineProps<{
    list: CaseItem[];
    caseTypes: CaseType[];
}>();

// ==================== Emits ====================

const emit = defineEmits<{
    delete: [id: number];
}>();

// ==================== Composables ====================

const { formatDate } = useFormatters();

// ==================== 方法 ====================

/**
 * 获取案件类型名称
 */
const getCaseTypeName = (typeId: number): string => {
    const type = props.caseTypes.find((t) => t.id === typeId);
    return type?.name ?? "未知类型";
};

/**
 * 获取状态文本
 */
const getStatusText = (status: number): string => {
    switch (status) {
        case 2:
            return "已完成";
        case 1:
            return "分析中";
        case 0:
            return "待分析";
        default:
            return "未知";
    }
};

/**
 * 获取状态样式类
 */
const getStatusClass = (status: number): string => {
    const baseClass = "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium";
    switch (status) {
        case 2:
            return `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`;
        case 1:
            return `${baseClass} bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400`;
        case 0:
            return `${baseClass} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`;
        default:
            return `${baseClass} bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`;
    }
};
</script>
