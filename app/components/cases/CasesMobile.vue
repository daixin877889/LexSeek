<template>
    <!-- 移动端卡片视图 (元数据等宽两栏布局) -->
    <div class="md:hidden space-y-4">
        <!-- 空状态 -->
        <div v-if="list.length === 0" class="text-center py-12 text-muted-foreground border-dashed border-2 rounded-2xl bg-muted/20">
            暂无案件记录
        </div>

        <!-- 案件卡片列表 -->
        <div v-else v-for="item in list" :key="item.id"
            class="bg-card border rounded-2xl overflow-hidden hover:shadow-md transition-all active:scale-[0.98] flex flex-col">
            
            <!-- 卡片内容区 -->
            <div class="p-5 flex-1 space-y-4">
                <!-- 头部：标题居左，状态居右 -->
                <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0 flex-1">
                        <NuxtLink :to="`/case/analysis/${item.id}`" 
                            class="text-base font-bold text-foreground leading-snug line-clamp-2 block">
                            {{ item.title }}
                        </NuxtLink>
                        <p class="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-tighter mt-1">ID: #{{ item.id }}</p>
                    </div>
                    <div class="flex items-center gap-2 mt-1">
                        <Badge :class="getStatusBadgeClass(item.status)" variant="outline" class="rounded-md border-transparent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">
                            {{ getStatusText(item.status) }}
                        </Badge>
                        <Badge v-if="item.isDemo" variant="secondary" class="rounded-md bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 text-[9px] font-bold uppercase px-1.5 py-0 whitespace-nowrap">
                            演示
                        </Badge>
                    </div>
                </div>

                <!-- 中间：元数据等宽两栏 -->
                <div class="grid grid-cols-2 gap-4 border-t border-border/50 pt-4">
                    <div class="space-y-0.5">
                        <p class="text-[9px] uppercase font-bold text-muted-foreground/40 tracking-widest">案件类型</p>
                        <p class="text-xs text-foreground/70 truncate">{{ getCaseTypeName(item.caseTypeId) }}</p>
                    </div>
                    <div class="space-y-0.5">
                        <p class="text-[9px] uppercase font-bold text-muted-foreground/40 tracking-widest">创建时间</p>
                        <p class="text-xs text-muted-foreground/70">{{ formatDate(item.createdAt, 'YYYY-MM-DD') }}</p>
                    </div>
                </div>
            </div>

            <!-- 常驻操作栏 -->
            <div class="px-5 py-3 bg-muted/30 border-t border-border/50 flex items-center justify-between mt-auto">
                <Button variant="ghost" size="icon" 
                    class="h-9 w-9 rounded-full text-destructive/50 active:bg-destructive/10 transition-all"
                    @click="emit('delete', item.id)">
                    <Trash2 class="h-4 w-4" />
                </Button>
                <NuxtLink :to="`/case/analysis/${item.id}`">
                    <Button variant="link" size="sm" class="h-9 p-0 text-muted-foreground active:text-primary font-bold hover:no-underline transition-colors flex items-center gap-1.5 group/btn">
                        <span class="text-sm">立即查看</span>
                        <ArrowRight class="h-3.5 w-3.5 transition-transform group-active/btn:translate-x-1" />
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
    content: string | null;
    caseTypeId: number | null;
    status: number;
    isDemo: boolean;
    createdAt: string;
    updatedAt: string;
    caseType: {
        id: number;
        name: string;
    } | null;
    latestSession: {
        sessionId: string;
        status: number;
        createdAt: string;
    } | null;
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

const getCaseTypeName = (typeId: number | null): string => {
    if (typeId === null) return "未知类型";
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

const getStatusBadgeClass = (status: number): string => {
    switch (status) {
        case 1: return "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400";
        case 2: return "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary";
        case 3: return "bg-muted text-muted-foreground dark:bg-muted/50";
        default: return "bg-muted text-muted-foreground";
    }
};
</script>
