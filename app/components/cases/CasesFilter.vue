<template>
    <!-- 筛选和搜索区域 -->
    <div class="bg-card rounded-lg border p-4 mb-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- 案件类型筛选 -->
            <div>
                <label class="block text-sm font-medium mb-1">案件类型</label>
                <Select v-model="internalCaseTypeId">
                    <SelectTrigger class="w-full">
                        <SelectValue placeholder="选择类型..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem v-for="type in caseTypes" :key="type.id" :value="String(type.id)">
                            {{ type.name }}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <!-- 状态筛选 -->
            <div>
                <label class="block text-sm font-medium mb-1">案件状态</label>
                <Select v-model="internalStatus">
                    <SelectTrigger class="w-full">
                        <SelectValue placeholder="选择状态..." />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="status in statusOptions" :key="status.value" :value="status.value">
                            {{ status.label }}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <!-- 搜索框 -->
            <div>
                <label class="block text-sm font-medium mb-1">搜索</label>
                <div class="relative">
                    <Input v-model="localTitle" type="text" placeholder="搜索案件标题..." class="w-full pl-9" />
                    <Search class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Search } from "lucide-vue-next";

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

const statusOptions = [
    { value: "all", label: "全部状态" },
    { value: "2", label: "已完成" },
    { value: "1", label: "分析中" },
    { value: "0", label: "待分析" },
];
</script>
