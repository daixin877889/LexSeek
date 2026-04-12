<template>
    <!-- 桌面端表格视图 -->
    <div class="bg-card rounded-xl border overflow-hidden hidden md:block shadow-sm">
        <div class="overflow-x-auto">
            <table class="w-full border-collapse">
                <thead>
                    <tr class="border-b bg-muted/30">
                        <th
                            class="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                            案件信息</th>
                        <th
                            class="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                            案件类型</th>
                        <th
                            class="px-6 py-4 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                            创建时间</th>
                        <th
                            class="px-6 py-4 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                            当前状态</th>
                        <th
                            class="px-6 py-4 text-center text-xs font-bold uppercase tracking-wider text-muted-foreground/80">
                            操作</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-border/50">
                    <!-- 空状态 -->
                    <tr v-if="list.length === 0">
                        <td colspan="5" class="px-6 py-12 text-center text-muted-foreground italic">
                            没有找到匹配的案件记录
                        </td>
                    </tr>
                    <!-- 数据列表 -->
                    <tr v-else v-for="item in list" :key="item.id"
                        class="group hover:bg-muted/40 transition-all duration-200">
                        <!-- 案件标题 -->
                        <td class="px-6 py-4">
                            <div class="flex flex-col min-w-0">
                                <div class="flex items-center gap-2">
                                    <NuxtLink :to="`/dashboard/cases/${item.id}`"
                                        class="font-semibold text-foreground hover:text-primary transition-colors truncate max-w-[400px]">
                                        {{ item.title }}
                                    </NuxtLink>
                                    <Badge v-if="item.isDemo" variant="secondary"
                                        class="rounded-md h-4 text-[10px] px-1.5 font-normal bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800">
                                        演示
                                    </Badge>
                                </div>
                                <span
                                    class="text-[10px] font-mono text-muted-foreground/60 mt-1 uppercase tracking-tighter">Ref:
                                    #{{ item.id }}</span>
                            </div>
                        </td>
                        <!-- 类型 -->
                        <td class="px-6 py-4">
                            <div class="text-sm text-foreground/80 font-medium">
                                {{ getCaseTypeName(item.caseTypeId) }}
                            </div>
                        </td>
                        <!-- 创建时间 -->
                        <td class="px-6 py-4">
                            <div class="text-sm text-muted-foreground">
                                {{ formatDate(item.createdAt, 'YYYY-MM-DD') }}
                            </div>
                        </td>
                        <!-- 状态 -->
                        <td class="px-6 py-4 text-center">
                            <Badge :class="getStatusBadgeClass(item.status)" variant="outline"
                                class="rounded-md border-transparent px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
                                {{ getStatusText(item.status) }}
                            </Badge>
                        </td>
                        <!-- 操作 -->
                        <td class="px-6 py-4">
                            <div
                                class="flex items-center justify-center gap-2">
                                <Button variant="ghost" size="icon"
                                    class="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    @click="emit('delete', item.id)" title="删除案件">
                                    <Trash2 class="h-4 w-4" />
                                </Button>
                                <NuxtLink :to="`/dashboard/cases/${item.id}`">
                                    <Button variant="ghost" size="icon"
                                        class="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                                        title="查看详情">
                                        <Eye class="h-4 w-4" />
                                    </Button>
                                </NuxtLink>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Eye, Trash2 } from "lucide-vue-next";

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
