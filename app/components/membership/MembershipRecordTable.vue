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
                                    <td class="px-4 py-3 text-sm">{{ formatDateChinese(record.createdAt) }}</td>
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
                                        <p class="font-medium">{{ record.settlementAt ?
                                            formatDateChinese(record.settlementAt)
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
import { ChevronRightIcon, ChevronDownIcon } from "lucide-vue-next";
import type { MembershipRecord, MembershipLevelDisplay } from "#shared/types/membership";

// ==================== Props ====================

const props = defineProps<{
    list: MembershipRecord[];
    membershipLevels: MembershipLevelDisplay[];
}>();

// ==================== Emits ====================

const emit = defineEmits<{
    upgrade: [record: MembershipRecord];
}>();

// ==================== Composables ====================

// 使用格式化工具
const { formatDateOnly, formatDateChinese } = useFormatters()

// 使用会员状态工具
const membershipLevelsRef = computed(() => props.membershipLevels)
const { isNotEffective, isHighestLevel } = useMembershipStatus(membershipLevelsRef)

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
</script>
