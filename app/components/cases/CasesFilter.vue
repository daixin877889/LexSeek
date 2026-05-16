<template>
    <!-- 紧凑筛选栏：搜索 + 类型 + 状态 + 重置 -->
    <div class="flex flex-wrap items-center gap-2.5">
        <!-- 搜索框 -->
        <div class="relative min-w-[180px] flex-1">
            <Search
                class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="localTitle" type="text" placeholder="搜索案件标题、内容关键词…"
                class="h-9 w-full pl-9" />
        </div>

        <!-- 案件类型筛选 -->
        <Select v-model="internalCaseTypeId">
            <SelectTrigger class="h-9 w-[148px]">
                <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem v-for="type in caseTypes" :key="type.id" :value="String(type.id)">
                    {{ type.name }}
                </SelectItem>
            </SelectContent>
        </Select>

        <!-- 状态筛选 -->
        <Select v-model="internalStatus">
            <SelectTrigger class="h-9 w-[128px]">
                <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem v-for="status in statusOptions" :key="status.value" :value="status.value">
                    {{ status.label }}
                </SelectItem>
            </SelectContent>
        </Select>

        <!-- 重置（有筛选时才出现） -->
        <Button v-if="isDirty" variant="ghost" size="sm"
            class="h-9 text-muted-foreground hover:text-foreground" @click="resetFilters">
            <RotateCcw class="mr-1.5 size-3.5" />
            重置
        </Button>
    </div>
</template>

<script lang="ts" setup>
import { Search, RotateCcw } from "lucide-vue-next";
import { CaseStatus, CaseStatusText } from "#shared/types/case";

// ==================== 类型定义 ====================

/** 案件类型 */
interface CaseType {
    id: number;
    name: string;
}

// ==================== Props ====================

defineProps<{
    caseTypes: CaseType[];
}>();

// ==================== Model ====================

const localCaseTypeId = defineModel<string>("caseTypeId", { default: "" });
const localStatus = defineModel<string>("status", { default: "" });
const localTitle = defineModel<string>("title", { default: "" });

// ==================== 逻辑处理 ====================

/** 是否已进行过筛选 */
const isDirty = computed(() => {
    return localCaseTypeId.value !== "" || localStatus.value !== "" || localTitle.value !== "";
});

/** 重置筛选 */
const resetFilters = () => {
    localCaseTypeId.value = "";
    localStatus.value = "";
    localTitle.value = "";
};

// ==================== 内部状态（处理 Select 不能用空字符串的问题） ====================

// 案件类型：内部用 "all" 表示全部，外部用空字符串
const internalCaseTypeId = computed({
    get: () => localCaseTypeId.value || "all",
    set: (val) => {
        localCaseTypeId.value = val === "all" ? "" : val;
    },
});

// 状态：内部用 "all" 表示全部，外部用空字符串
const internalStatus = computed({
    get: () => localStatus.value || "all",
    set: (val) => {
        localStatus.value = val === "all" ? "" : val;
    },
});

// ==================== 状态选项 ====================

// 状态值：从 CaseStatusText 动态生成（排除 ARCHIVED，归档案件通过专门入口查看）
const statusOptions = [
    { value: "all", label: "全部状态" },
    ...Object.entries(CaseStatusText)
        .filter(([key]) => Number(key) !== CaseStatus.ARCHIVED)
        .map(([key, label]) => ({ value: key, label })),
];
</script>
