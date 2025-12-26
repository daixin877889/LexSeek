<template>
    <div class="w-full">
        <!-- 标题 -->
        <div class="mb-4">
            <h3 class="text-lg font-medium">{{ displayLevel }} 权益详情</h3>
        </div>

        <!-- 表格模式（PC 端） -->
        <div class="hidden md:block border rounded-lg overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full min-w-[800px] table-with-borders">
                    <thead>
                        <tr class="border-b bg-muted/50">
                            <th class="px-4 py-3 text-left text-sm font-medium w-28">功能分类</th>
                            <th class="px-4 py-3 text-left text-sm font-medium w-60">功能名称</th>
                            <th class="px-4 py-3 text-center text-sm font-medium" :class="getColumnHighlight('免费版')">免费版
                            </th>
                            <th class="px-4 py-3 text-center text-sm font-medium" :class="getColumnHighlight('基础版')">基础版
                            </th>
                            <th class="px-4 py-3 text-center text-sm font-medium" :class="getColumnHighlight('专业版')">专业版
                            </th>
                            <th class="px-4 py-3 text-center text-sm font-medium" :class="getColumnHighlight('旗舰版')">旗舰版
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="category in benefitsData" :key="category.name">
                            <tr v-for="(feature, featureIndex) in category.features" :key="feature.name"
                                :class="featureIndex === 0 ? 'border-b bg-muted/20' : 'border-b'">
                                <td v-if="featureIndex === 0" class="px-4 py-3 text-sm font-medium"
                                    :rowspan="category.features.length">
                                    {{ category.name }}
                                </td>
                                <td class="px-4 py-3 text-sm">{{ feature.name }}</td>
                                <td v-for="level in levels" :key="level" class="px-4 py-3 text-center"
                                    :class="getColumnHighlight(level)">
                                    <template v-if="feature[level] === true">
                                        <Check class="h-4 w-4 text-green-600 mx-auto" />
                                    </template>
                                    <template v-else-if="feature[level] === false">
                                        <X class="h-4 w-4 text-red-500 mx-auto" />
                                    </template>
                                    <template v-else>
                                        {{ feature[level] }}
                                    </template>
                                </td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- 卡片模式（移动端） -->
        <div class="md:hidden space-y-6">
            <div v-for="category in benefitsData" :key="category.name" class="space-y-3">
                <h4 class="text-base font-medium text-muted-foreground">{{ category.name }}</h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div v-for="feature in category.features" :key="feature.name"
                        class="border rounded-lg p-4 transition-colors">
                        <div class="flex items-start justify-between gap-2">
                            <div class="flex-1">
                                <p class="text-sm font-medium mb-2">{{ feature.name }}</p>
                                <div class="flex items-center gap-1">
                                    <template v-if="getFeatureStatus(feature) === true">
                                        <Check class="h-4 w-4 text-green-600" />
                                        <!-- 显示具体值（如容量）或"支持" -->
                                        <span class="text-xs text-green-600">
                                            {{ getFeatureDisplayValue(feature) || '支持' }}
                                        </span>
                                    </template>
                                    <template v-else-if="getFeatureStatus(feature) === false">
                                        <X class="h-4 w-4 text-red-500" />
                                        <span class="text-xs text-red-500">不支持</span>
                                    </template>
                                    <template v-else>
                                        <span class="text-xs text-yellow-600">{{ getFeatureStatus(feature) }}</span>
                                    </template>
                                </div>
                            </div>
                            <div class="flex gap-1">
                                <div v-for="level in levels" :key="level" class="flex flex-col items-center"
                                    :title="`${level}: ${feature[level] === true ? '支持' : feature[level] === false ? '不支持' : feature[level]}`">
                                    <span class="text-[10px] text-muted-foreground mb-0.5">{{ level.replace('版', '')
                                        }}</span>
                                    <div class="w-5 h-5 rounded-full flex items-center justify-center border-2"
                                        :class="getLevelBadgeClass(feature[level], level)">
                                        <!-- 布尔 true 或非"部分"的字符串值（如容量）显示勾号 -->
                                        <Check
                                            v-if="feature[level] === true || (typeof feature[level] === 'string' && feature[level] !== '部分')"
                                            class="h-3 w-3" />
                                        <X v-else-if="feature[level] === false" class="h-3 w-3" />
                                        <span v-else class="text-[8px]">部</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 权益说明 -->
        <div class="mt-6 p-4 bg-muted/30 rounded-lg">
            <div class="text-sm text-muted-foreground space-y-2">
                <p><strong>权益说明：</strong></p>
                <p>•
                    <Check class="h-4 w-4 text-green-600 inline mr-1" /> 表示该级别支持此功能
                </p>
                <p>•
                    <X class="h-4 w-4 text-red-500 inline mr-1" /> 表示该级别不支持此功能
                </p>
                <p>• "部分" 表示该级别部分支持此功能</p>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { Check, X } from "lucide-vue-next";

// 组件属性
const props = defineProps<{
    selectedLevel?: string;
}>();

// 会员级别列表
const levels = ["免费版", "基础版", "专业版", "旗舰版"] as const;
type LevelType = (typeof levels)[number];

// 功能特性类型
interface Feature {
    name: string;
    免费版: boolean | string;
    基础版: boolean | string;
    专业版: boolean | string;
    旗舰版: boolean | string;
    [key: string]: boolean | string;
}

// 功能分类类型
interface BenefitCategory {
    name: string;
    features: Feature[];
}

// 权益数据
const benefitsData: BenefitCategory[] = [
    {
        name: "文件存储",
        features: [
            { name: "云盘空间", 免费版: "100MB", 基础版: "100MB", 专业版: "1GB", 旗舰版: "5GB" },
        ],
    },
    {
        name: "案件分析",
        features: [
            { name: "提取案件标题", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "生成案情概要", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "提取案件大事记", 免费版: false, 基础版: false, 专业版: true, 旗舰版: true },
            { name: "预分析案件请求权", 免费版: false, 基础版: false, 专业版: true, 旗舰版: true },
            { name: "法律合理性审查和判决趋势预测", 免费版: false, 基础版: false, 专业版: true, 旗舰版: true },
            { name: "预选案由", 免费版: false, 基础版: false, 专业版: true, 旗舰版: true },
            { name: "抗辩分析及策略预测", 免费版: false, 基础版: false, 专业版: true, 旗舰版: true },
            { name: "证据清单预处理", 免费版: false, 基础版: false, 专业版: true, 旗舰版: true },
        ],
    },
    {
        name: "办案工具",
        features: [
            { name: "录音智能转写", 免费版: false, 基础版: false, 专业版: true, 旗舰版: true },
            { name: "利息计算工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "诉讼费用计算工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "律师费用计算工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "延迟履行利息计算工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "银行利率查询工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "日期推算工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "赔偿计算器", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "加班计算工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "离婚财产分割工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "社保追偿工具", 免费版: true, 基础版: true, 专业版: true, 旗舰版: true },
            { name: "法律文书生成", 免费版: false, 基础版: false, 专业版: "部分", 旗舰版: true },
            { name: "案件可视化工具", 免费版: false, 基础版: false, 专业版: "部分", 旗舰版: true },
        ],
    },
];

/**
 * 获取当前选中级别的标准名称
 */
const normalizedLevel = computed((): LevelType => {
    if (!props.selectedLevel) return "免费版";

    if (levels.includes(props.selectedLevel as LevelType)) {
        return props.selectedLevel as LevelType;
    }

    for (const level of levels) {
        if (props.selectedLevel.includes(level) || level.includes(props.selectedLevel)) {
            return level;
        }
    }

    const cleanSelected = props.selectedLevel.replace(/[版会员]/g, "");
    for (const level of levels) {
        const cleanLevel = level.replace(/[版会员]/g, "");
        if (cleanSelected === cleanLevel) {
            return level;
        }
    }

    return "免费版";
});

/**
 * 计算当前选中级别的显示名称
 */
const displayLevel = computed(() => {
    return props.selectedLevel || "免费版";
});

/**
 * 根据选中的级别突出显示对应的列
 */
const getColumnHighlight = (level: string): string => {
    if (normalizedLevel.value === level) {
        return "bg-primary/5 border-primary";
    }
    return "";
};

/**
 * 获取功能在当前选中级别的支持状态
 * 字符串值（如 "100MB"、"1GB"）视为支持，"部分" 视为部分支持
 */
const getFeatureStatus = (feature: Feature): boolean | string => {
    const status = feature[normalizedLevel.value];
    // 如果是非空字符串且不是"部分"，视为支持
    if (typeof status === "string" && status !== "" && status !== "部分") {
        return true;
    }
    return status;
};

/**
 * 获取功能在当前选中级别的显示值（用于卡片显示容量等信息）
 */
const getFeatureDisplayValue = (feature: Feature): string | null => {
    const status = feature[normalizedLevel.value];
    // 如果是字符串且不是"部分"（如容量值），返回该字符串
    if (typeof status === "string" && status !== "" && status !== "部分") {
        return status;
    }
    return null;
};

/**
 * 获取级别徽章的样式类
 * 字符串值（非"部分"）视为支持，使用绿色样式
 */
const getLevelBadgeClass = (status: boolean | string, level: string): string => {
    const isSelected = normalizedLevel.value === level;
    // 字符串值（非"部分"）视为支持
    const isSupported = status === true || (typeof status === "string" && status !== "部分");

    if (isSupported) {
        return isSelected
            ? "border-green-600 bg-green-600 text-white"
            : "border-green-500 text-green-600";
    } else if (status === false) {
        return isSelected
            ? "border-red-500 bg-red-500 text-white"
            : "border-red-400 text-red-500";
    } else {
        // "部分" 支持
        return isSelected
            ? "border-yellow-500 bg-yellow-500 text-white"
            : "border-yellow-500 text-yellow-600";
    }
};
</script>

<style scoped>
.table-with-borders td,
.table-with-borders th {
    border-right: 1px solid hsl(var(--border));
}

.table-with-borders td:last-child,
.table-with-borders th:last-child {
    border-right: none;
}
</style>
