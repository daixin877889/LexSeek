<template>
    <!-- 移动端卡片视图 -->
    <div class="md:hidden space-y-4">
        <!-- 空状态 -->
        <div v-if="list.length === 0" class="text-center py-12 text-muted-foreground border-dashed border-2 rounded-xl bg-muted/20">
            暂无案件记录
        </div>

        <!-- 案件卡片列表 -->
        <div v-else v-for="item in list" :key="item.id"
            class="bg-card border rounded-xl p-5 space-y-4 hover:shadow-lg transition-all active:scale-[0.98]">
            <!-- 头部：标题和演示标签 -->
            <div class="space-y-2">
                <div class="flex items-start justify-between gap-3">
                    <NuxtLink :to="`/case/analysis/${item.id}`"
                        class="font-bold text-base text-foreground leading-tight line-clamp-2">
                        {{ item.title }}
                    </NuxtLink>
                    <UiBadge v-if="item.isDemo" variant="secondary" class="rounded-md h-5 text-[10px] px-1.5 font-normal bg-orange-100 text-orange-700 border-orange-200 shrink-0">
                        演示
                    </UiBadge>
                </div>
            </div>

            <!-- 详情信息 -->
            <div class="grid grid-cols-2 gap-3 py-1">
                <div class="flex items-center text-xs text-muted-foreground">
                    <Tag class="h-3.5 w-3.5 mr-1.5 opacity-60" />
                    <span class="truncate">{{ getCaseTypeName(item.caseTypeId) }}</span>
                </div>
                <div class="flex items-center text-xs text-muted-foreground">
                    <Calendar class="h-3.5 w-3.5 mr-1.5 opacity-60" />
                    <span>{{ formatDate(item.createdAt) }}</span>
                </div>
            </div>

            <!-- 状态和操作 -->
            <div class="flex items-center justify-between pt-4 border-t border-border/50">
                <UiBadge :class="getStatusBadgeClass(item.status)" variant="outline" class="rounded-md border-transparent px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    {{ getStatusText(item.status) }}
                </UiBadge>
                
                <div class="flex items-center gap-2">
                    <Button variant="ghost" size="icon" class="h-9 w-9 rounded-full text-destructive/50"
                        @click="emit('delete', item.id)">
                        <Trash2 class="h-3.5 w-3.5" />
                    </Button>
                    <NuxtLink :to="`/case/analysis/${item.id}`">
                        <Button variant="outline" size="sm" class="h-9 px-4 rounded-full text-muted-foreground hover:text-primary">
                            <Eye class="h-3.5 w-3.5 mr-1.5" />
                            查看
                        </Button>
                    </NuxtLink>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Eye, Trash2, Tag, Calendar } from "lucide-vue-next";

// ==================== 类型定义 ====================

interface CaseItem {
    id: number;
    title: string;
    caseTypeId: number;
    status: number;
    isDemo: boolean;
    createdAt: string;
}

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

const getCaseTypeName = (typeId: number): string => {
    const type = props.caseTypes.find((t) => t.id === typeId);
    return type?.name ?? "未知类型";
};

const getStatusText = (status: number): string => {
    switch (status) {
        case 1: return "进行中";
        case 2: return "已完成";
        case 3: return "已关闭";
        default: return "未知";
    }
};

/**
 * 获取状态 Badge 的颜色类
 */
const getStatusBadgeClass = (status: number): string => {
    switch (status) {
        case 1: // 进行中 - 蓝色
            return "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400";
        case 2: // 已完成 - 绿色/主色
            return "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary";
        case 3: // 已关闭 - 灰色
            return "bg-muted text-muted-foreground dark:bg-muted/50";
        default:
            return "bg-muted text-muted-foreground";
    }
};
</script>
