<template>
    <!-- 桌面端表格视图 -->
    <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
        <div class="overflow-x-auto">
            <table class="w-full">
                <thead>
                    <tr class="border-b bg-muted/50">
                        <th class="px-4 py-3 text-left text-sm font-medium">案件标题</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">类型</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">创建时间</th>
                        <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                        <th class="px-4 py-3 text-center text-sm font-medium">操作</th>
                    </tr>
                </thead>
                <tbody>
                    <!-- 空状态 -->
                    <tr v-if="list.length === 0">
                        <td colspan="5" class="px-4 py-8 text-center text-muted-foreground">
                            暂无案件数据
                        </td>
                    </tr>
                    <!-- 数据列表 -->
                    <tr v-else v-for="item in list" :key="item.id"
                        class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                        <!-- 案件标题 -->
                        <td class="px-4 py-3">
                            <div class="flex items-center">
                                <FileText class="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
                                <NuxtLink :to="`/case/analysis/${item.id}`"
                                    class="font-medium hover:underline hover:text-primary truncate max-w-[200px]">
                                    {{ item.title }}
                                </NuxtLink>
                            </div>
                        </td>
                        <!-- 类型 -->
                        <td class="px-4 py-3 text-sm">
                            {{ getCaseTypeName(item.caseTypeId) }}
                        </td>
                        <!-- 创建时间 -->
                        <td class="px-4 py-3 text-sm text-muted-foreground">
                            {{ formatDate(item.createdAt) }}
                        </td>
                        <!-- 状态 -->
                        <td class="px-4 py-3 text-center">
                            <span :class="getStatusClass(item.status)">
                                {{ getStatusText(item.status) }}
                            </span>
                        </td>
                        <!-- 操作 -->
                        <td class="px-4 py-3 text-center">
                            <div class="flex items-center justify-center gap-2">
                                <NuxtLink :to="`/case/analysis/${item.id}`">
                                    <Button variant="ghost" size="icon" class="h-8 w-8">
                                        <Eye class="h-4 w-4" />
                                    </Button>
                                </NuxtLink>
                                <Button variant="ghost" size="icon"
                                    class="h-8 w-8 text-destructive hover:text-destructive"
                                    @click="emit('delete', item.id)">
                                    <Trash2 class="h-4 w-4" />
                                </Button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { FileText, Eye, Trash2 } from "lucide-vue-next";

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
 * 状态值：1-进行中，2-已完成，3-已关闭
 */
const getStatusText = (status: number): string => {
    switch (status) {
        case 1:
            return "进行中";
        case 2:
            return "已完成";
        case 3:
            return "已关闭";
        default:
            return "未知";
    }
};

/**
 * 获取状态样式类
 * 状态值：1-进行中，2-已完成，3-已关闭
 */
const getStatusClass = (status: number): string => {
    const baseClass = "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium";
    switch (status) {
        case 1:
            return `${baseClass} bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400`;
        case 2:
            return `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`;
        case 3:
            return `${baseClass} bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`;
        default:
            return `${baseClass} bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400`;
    }
};
</script>
