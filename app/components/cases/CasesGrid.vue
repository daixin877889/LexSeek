<template>
    <!-- 桌面端卡片视图 (Grid) -->
    <div class="hidden md:grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <div v-if="list.length === 0"
            class="col-span-full py-12 text-center text-muted-foreground bg-card border border-dashed rounded-2xl">
            没有找到匹配的案件记录
        </div>

        <div v-for="item in list" :key="item.id"
            class="group bg-card border rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 transition-all duration-300 flex flex-col">
            <!-- 卡片内容区 -->
            <div class="p-6 flex-1 flex flex-col">
                <!-- 顶部：状态标签 -->
                <div class="flex flex-wrap gap-2 mb-4">
                    <UiBadge :class="getStatusBadgeClass(item.status)" variant="outline"
                        class="rounded-md border-transparent px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
                        {{ getStatusText(item.status) }}
                    </UiBadge>
                    <UiBadge v-if="item.isDemo" variant="secondary"
                        class="rounded-md bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5">
                        演示
                    </UiBadge>
                </div>

                <!-- 中间：标题和ID -->
                <div class="mb-6 flex-1">
                    <NuxtLink :to="`/case/analysis/${item.id}`"
                        class="text-xl font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2 leading-tight mb-2 block">
                        {{ item.title }}
                    </NuxtLink>
                    <p class="text-[11px] font-mono text-muted-foreground/60 uppercase tracking-tighter">ID:
                        #{{ item.id }}</p>
                </div>

                <!-- 底部：详细元数据 -->
                <div class="grid grid-cols-2 gap-4 border-t border-border/50 pt-5">
                    <div class="space-y-1">
                        <p class="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-widest">案件类型</p>
                        <p class="text-sm font-medium text-foreground/80 truncate">
                            {{ getCaseTypeName(item.caseTypeId) }}
                        </p>
                    </div>
                    <div class="space-y-1">
                        <p class="text-[10px] uppercase font-bold text-muted-foreground/50 tracking-widest">创建时间</p>
                        <p class="text-sm font-medium text-muted-foreground/80">
                            {{ formatDate(item.createdAt) }}
                        </p>
                    </div>
                </div>
            </div>

            <!-- 常驻操作栏 -->
            <div class="px-6 py-4 bg-muted/30 border-t border-border/50 flex items-center justify-between mt-auto">
                <Button variant="ghost" size="icon"
                    class="h-8 w-8 rounded-full text-destructive/50 hover:text-destructive hover:bg-destructive/10 transition-all"
                    @click="emit('delete', item.id)" title="删除案件">
                    <Trash2 class="h-4 w-4" />
                </Button>
                <NuxtLink :to="`/case/analysis/${item.id}`">
                    <Button variant="link" size="sm"
                        class="h-8 p-0 text-muted-foreground hover:text-primary font-bold hover:no-underline transition-colors flex items-center gap-2 group/btn">
                        <span>立即查看</span>
                        <ArrowRight class="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-1" />
                    </Button>
                </NuxtLink>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Trash2, ArrowRight } from "lucide-vue-next";

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
