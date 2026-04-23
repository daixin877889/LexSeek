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
                            <CaseStatusBadge :status="item.status" />
                        </td>
                        <!-- 操作 -->
                        <td class="px-6 py-4">
                            <div
                                class="flex items-center justify-center gap-2">
                                <Button v-if="!isCaseReadOnly(item.status)" variant="ghost" size="icon"
                                    class="h-8 w-8 rounded-full hover:bg-muted"
                                    @click="handleArchive(item)" title="归档案件">
                                    <Archive class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon"
                                    :disabled="isCaseReadOnly(item.status)"
                                    :title="isCaseReadOnly(item.status) ? '归档案件不可删除' : '删除案件'"
                                    class="h-8 w-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    @click="emit('delete', item.id)">
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

        <!-- 归档确认弹框 -->
        <Dialog v-model:open="showArchiveDialog">
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>确认归档</DialogTitle>
                    <DialogDescription>归档后案件将变为只读，无法编辑、分析或写入记忆。此操作不可恢复。</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" @click="showArchiveDialog = false">取消</Button>
                    <Button variant="destructive" :disabled="archiving" @click="confirmArchive">确认归档</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </div>
</template>

<script lang="ts" setup>
import { Eye, Trash2, Archive } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { CaseStatus, isCaseReadOnly } from "#shared/types/case";

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
    archived: [id: number];
}>();

// ==================== Composables ====================

const { formatDate } = useFormatters();

// ==================== 方法 ====================

const getCaseTypeName = (typeId: number | null): string => {
    if (typeId === null) return "未知类型";
    const type = props.caseTypes.find((t) => t.id === typeId);
    return type?.name ?? "未知类型";
};

// ==================== 归档逻辑 ====================

const showArchiveDialog = ref(false);
const archiveTargetId = ref<number | null>(null);
const archiving = ref(false);

function handleArchive(item: { id: number; status: number }) {
    archiveTargetId.value = item.id;
    showArchiveDialog.value = true;
}

async function confirmArchive() {
    if (!archiveTargetId.value || archiving.value) return;
    archiving.value = true;
    try {
        const result = await useApiFetch(`/api/v1/case/${archiveTargetId.value}`, {
            method: "PATCH",
            body: { status: CaseStatus.ARCHIVED },
        });
        if (result !== null) {
            toast.success("案件已归档");
            emit("archived", archiveTargetId.value);
            showArchiveDialog.value = false;
            archiveTargetId.value = null;
        }
    } finally {
        archiving.value = false;
    }
}
</script>
