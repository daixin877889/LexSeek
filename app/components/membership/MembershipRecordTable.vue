<template>
    <!-- 桌面端表格视图 -->
    <div class="border rounded-lg overflow-hidden hidden md:block">
        <table class="w-full">
            <thead>
                <tr class="border-b bg-muted/50">
                    <th class="px-4 py-3 text-left text-sm font-medium">会员版本</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">有效期</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">会员渠道</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">创建时间</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">操作</th>
                </tr>
            </thead>
            <tbody>
                <tr v-if="list.length === 0">
                    <td colspan="6" class="px-4 py-8 text-center text-muted-foreground">暂无会员记录</td>
                </tr>
                <tr v-else v-for="record in list" :key="record.id" class="border-b last:border-b-0 hover:bg-muted/30">
                    <td class="px-4 py-3 text-sm">{{ record.levelName }}</td>
                    <td class="px-4 py-3 text-sm">{{ formatDateOnly(record.startDate) }} - {{
                        formatDateOnly(record.endDate) }}</td>
                    <td class="px-4 py-3 text-sm">{{ record.sourceTypeName }}</td>
                    <td class="px-4 py-3 text-sm">
                        <span v-if="record.status === 1"
                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                        <span v-if="record.status === 0"
                            class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                    </td>
                    <td class="px-4 py-3 text-sm">{{ formatDate(record.createdAt) }}</td>
                    <td class="px-4 py-3 text-sm">
                        <Button v-if="record.status === 1 && !isHighestLevel(record.levelId)" size="sm"
                            @click="emit('upgrade', record)">
                            升级
                        </Button>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<script lang="ts" setup>
import dayjs from "dayjs";

// 类型定义
interface MembershipRecord {
    id: number;
    levelId: number;
    levelName: string;
    startDate: string;
    endDate: string;
    sourceTypeName: string;
    status: number;
    createdAt: string;
}

interface MembershipLevel {
    id: number;
    name: string;
    sortOrder: number;
}

// 定义 props
const props = defineProps<{
    list: MembershipRecord[];
    membershipLevels: MembershipLevel[];
}>();

// 定义 emits
const emit = defineEmits<{
    upgrade: [record: MembershipRecord];
}>();

// 判断是否是最高级别
const isHighestLevel = (levelId: number): boolean => {
    if (props.membershipLevels.length === 0) return false;
    const maxSortOrder = Math.max(...props.membershipLevels.map((l) => l.sortOrder));
    const currentLevel = props.membershipLevels.find((l) => l.id === levelId);
    return currentLevel ? currentLevel.sortOrder >= maxSortOrder : false;
};

// 格式化日期（仅日期）
const formatDateOnly = (dateString: string): string => {
    if (!dateString) return "—";
    return dayjs(dateString).format("YYYY-MM-DD");
};

// 格式化日期（含时间）
const formatDate = (dateString: string): string => {
    if (!dateString) return "—";
    return dayjs(dateString).format("YYYY年MM月DD日 HH:mm");
};
</script>
