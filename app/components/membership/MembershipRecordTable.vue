<template>
    <!-- 桌面端表格视图 - 可展开行 -->
    <div class="border rounded-lg overflow-hidden hidden md:block">
        <table class="w-full">
            <thead>
                <tr class="border-b bg-muted/50">
                    <th class="w-10 px-2 py-3"></th>
                    <th class="px-4 py-3 text-left text-sm font-medium">会员版本</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">有效期</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">会员渠道</th>
                    <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">创建时间</th>
                    <th class="px-4 py-3 text-center text-sm font-medium">操作</th>
                </tr>
            </thead>
            <tbody>
                <!-- 空状态 -->
                <tr v-if="list.length === 0">
                    <td colspan="7" class="px-4 py-8 text-center text-muted-foreground">暂无会员记录</td>
                </tr>
                <!-- 数据列表 - 可展开行 -->
                <TooltipProvider v-else>
                    <template v-for="record in list" :key="record.id">
                        <!-- 主行 -->
                        <Tooltip>
                            <TooltipTrigger as-child>
                                <tr class="border-b hover:bg-primary/5 cursor-pointer transition-colors group"
                                    @click="toggleRow(record.id)">
                                    <!-- 展开图标 -->
                                    <td class="px-2 py-3 text-center">
                                        <div
                                            class="w-6 h-6 rounded flex items-center justify-center bg-muted/50 group-hover:bg-primary/10 transition-colors">
                                            <ChevronDownIcon v-if="expandedRows.has(record.id)"
                                                class="w-4 h-4 text-primary transition-transform" />
                                            <ChevronRightIcon v-else
                                                class="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-sm font-medium">{{ record.levelName }}</td>
                                    <td class="px-4 py-3 text-sm">{{ formatDateOnly(record.startDate) }} - {{
                                        formatDateOnly(record.endDate) }}</td>
                                    <td class="px-4 py-3 text-sm">{{ record.sourceTypeName }}</td>
                                    <td class="px-4 py-3 text-sm text-center">
                                        <!-- 未生效：status=1 且 startDate > now -->
                                        <span v-if="record.status === 1 && isNotEffective(record.startDate)"
                                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">未生效</span>
                                        <span v-else-if="record.status === 1"
                                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                                        <span v-else-if="record.status === 2"
                                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">已结算</span>
                                        <span v-else-if="record.status === 0"
                                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                                    </td>
                                    <td class="px-4 py-3 text-sm">{{ formatDate(record.createdAt) }}</td>
                                    <!-- 操作列 - 阻止点击事件冒泡 -->
                                    <td class="px-4 py-3 text-sm text-center" @click.stop>
                                        <Button v-if="record.status === 1 && !isHighestLevel(record.levelId)" size="sm"
                                            @click="emit('upgrade', record)">
                                            升级
                                        </Button>
                                        <span v-else class="text-muted-foreground">-</span>
                                    </td>
                                </tr>
                            </TooltipTrigger>
                            <!-- Tooltip 显示备注 -->
                            <TooltipContent v-if="record.remark" side="top" class="max-w-xs">
                                <div class="text-xs">
                                    <p><span class="text-muted-foreground">备注：</span>{{ record.remark }}</p>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                        <!-- 展开详情行 -->
                        <tr v-if="expandedRows.has(record.id)" class="bg-primary/5 border-b">
                            <td colspan="7" class="px-4 py-4">
                                <div class="grid grid-cols-2 gap-4 text-sm pl-8">
                                    <div>
                                        <p class="text-muted-foreground mb-1">结算时间</p>
                                        <p class="font-medium">{{ record.settlementAt ? formatDate(record.settlementAt)
                                            : '-' }}</p>
                                    </div>
                                    <div>
                                        <p class="text-muted-foreground mb-1">备注</p>
                                        <p>{{ record.remark || "-" }}</p>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </template>
                </TooltipProvider>
            </tbody>
        </table>
    </div>
</template>

<script lang="ts" setup>
import dayjs from "dayjs";
import { ChevronRightIcon, ChevronDownIcon } from "lucide-vue-next";

// ==================== 类型定义 ====================

/** 会员记录 */
interface MembershipRecord {
    id: number;
    levelId: number;
    levelName: string;
    startDate: string;
    endDate: string;
    sourceTypeName: string;
    status: number;
    createdAt: string;
    settlementAt?: string;
    remark?: string;
}

/** 会员级别 */
interface MembershipLevel {
    id: number;
    name: string;
    sortOrder: number;
}

// ==================== Props ====================

const props = defineProps<{
    list: MembershipRecord[];
    membershipLevels: MembershipLevel[];
}>();

// ==================== Emits ====================

const emit = defineEmits<{
    upgrade: [record: MembershipRecord];
}>();

// ==================== 展开状态管理 ====================

/** 已展开的行 ID 集合 */
const expandedRows = ref<Set<number>>(new Set());

/**
 * 切换行的展开/收起状态
 */
const toggleRow = (id: number) => {
    if (expandedRows.value.has(id)) {
        expandedRows.value.delete(id);
    } else {
        expandedRows.value.add(id);
    }
    // 触发响应式更新
    expandedRows.value = new Set(expandedRows.value);
};

// ==================== 工具方法 ====================

/**
 * 判断是否是最高级别（sortOrder 越大级别越高）
 * 只考虑真正的会员级别（基础版、专业版、旗舰版），排除测试数据
 */
const isHighestLevel = (levelId: number): boolean => {
    if (props.membershipLevels.length === 0) return false;
    // 只考虑真正的会员级别
    const realLevels = props.membershipLevels.filter((l) =>
        l.id === 1 || l.id === 2 || l.id === 3 ||
        l.name === '基础版' || l.name === '专业版' || l.name === '旗舰版'
    );
    if (realLevels.length === 0) return false;
    const maxSortOrder = Math.max(...realLevels.map((l) => l.sortOrder));
    const currentLevel = props.membershipLevels.find((l) => l.id === levelId);
    return currentLevel ? currentLevel.sortOrder >= maxSortOrder : false;
};

/**
 * 判断会员是否未生效（startDate > now）
 */
const isNotEffective = (startDate: string): boolean => {
    if (!startDate) return false;
    return dayjs(startDate).isAfter(dayjs());
};

/**
 * 格式化日期（仅日期，YY/MM/DD 格式）
 */
const formatDateOnly = (dateString: string): string => {
    if (!dateString) return "—";
    return dayjs(dateString).format("YY/MM/DD");
};

/**
 * 格式化日期（含时间）
 */
const formatDate = (dateString: string): string => {
    if (!dateString) return "—";
    return dayjs(dateString).format("YYYY年MM月DD日 HH:mm");
};
</script>
