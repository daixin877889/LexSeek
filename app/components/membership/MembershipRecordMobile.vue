<template>
    <!-- 移动端卡片视图 -->
    <div class="md:hidden space-y-4">
        <div v-if="list.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg">
            暂无会员记录
        </div>

        <div v-else v-for="record in list" :key="record.id" class="border rounded-lg p-4 space-y-3">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-medium text-sm mb-1">{{ record.levelName }}</h3>
                    <p class="text-sm text-muted-foreground">{{ record.sourceTypeName }}</p>
                </div>
                <div class="flex items-center gap-2">
                    <!-- 未生效：status=1 且 startDate > now -->
                    <span v-if="record.status === 1 && isNotEffective(record.startDate)"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">未生效</span>
                    <span v-else-if="record.status === 1"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                    <span v-else-if="record.status === 2"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">已结算</span>
                    <span v-else-if="record.status === 0"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">已作废</span>
                    <Button v-if="record.status === 1 && !isHighestLevel(record.levelId)" size="sm"
                        @click="emit('upgrade', record)">
                        升级
                    </Button>
                </div>
            </div>

            <div class="text-sm">
                <p class="text-muted-foreground mb-1">有效期</p>
                <p>{{ formatDateOnly(record.startDate) }} - {{ formatDateOnly(record.endDate) }}</p>
            </div>

            <div class="text-sm">
                <p class="text-muted-foreground mb-1">创建时间</p>
                <p>{{ formatDate(record.createdAt) }}</p>
            </div>
        </div>
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

// 判断是否是最高级别（sortOrder 越大级别越高）
// 只考虑真正的会员级别（基础版、专业版、旗舰版），排除测试数据
const isHighestLevel = (levelId: number): boolean => {
    if (props.membershipLevels.length === 0) return false;
    // 只考虑真正的会员级别（id 为 1、2、3 或名称为基础版、专业版、旗舰版）
    const realLevels = props.membershipLevels.filter((l) =>
        l.id === 1 || l.id === 2 || l.id === 3 ||
        l.name === '基础版' || l.name === '专业版' || l.name === '旗舰版'
    );
    if (realLevels.length === 0) return false;
    // sortOrder 越大级别越高，找出最大的 sortOrder
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

// 格式化日期（仅日期，YY/MM/DD 格式）
const formatDateOnly = (dateString: string): string => {
    if (!dateString) return "—";
    return dayjs(dateString).format("YY/MM/DD");
};

// 格式化日期（含时间）
const formatDate = (dateString: string): string => {
    if (!dateString) return "—";
    return dayjs(dateString).format("YYYY年MM月DD日 HH:mm");
};
</script>
