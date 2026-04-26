<template>
    <!-- 筛选和搜索区域 -->
    <div class="p-4">
        <div class="flex flex-col md:flex-row items-end gap-4">
            <!-- 搜索框 -->
            <div class="flex-1 w-full">
                <label class="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 ml-1">搜索关键词</label>
                <div class="relative group">
                    <Input v-model="localTitle" type="text" placeholder="案件标题、内容关键词..." class="w-full pl-9 h-10 transition-all focus-visible:ring-primary/30" />
                    <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                </div>
            </div>

            <!-- 案件类型筛选 -->
            <div class="w-full md:w-48">
                <label class="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 ml-1">所属类型</label>
                <Select v-model="internalCaseTypeId">
                    <SelectTrigger class="w-full h-10 transition-all focus:ring-primary/30">
                        <SelectValue placeholder="全部类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">
                            <div class="flex items-center">
                                <Filter class="h-3.5 w-3.5 mr-2 opacity-70" />
                                <span>全部类型</span>
                            </div>
                        </SelectItem>
                        <SelectItem v-for="type in caseTypes" :key="type.id" :value="String(type.id)">
                            {{ type.name }}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <!-- 状态筛选 -->
            <div class="w-full md:w-40">
                <label class="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 ml-1">当前状态</label>
                <Select v-model="internalStatus">
                    <SelectTrigger class="w-full h-10 transition-all focus:ring-primary/30">
                        <SelectValue placeholder="全部状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="status in statusOptions" :key="status.value" :value="status.value">
                            {{ status.label }}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <!-- 操作按钮 -->
            <div class="flex items-center gap-2 w-full md:w-auto">
                <Button variant="outline" class="h-10 px-3 flex-1 md:flex-none border-dashed hover:border-primary hover:text-primary transition-all" @click="resetFilters" :disabled="!isDirty">
                    <RotateCcw class="h-4 w-4 mr-2" />
                    重置
                </Button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Search, Filter, RotateCcw } from "lucide-vue-next";
import { CaseStatus, CaseStatusText } from "#shared/types/case";
import type { caseTypes } from '~~/generated/prisma/client'

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
