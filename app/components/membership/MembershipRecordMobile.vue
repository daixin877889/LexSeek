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
                    <span v-if="record.status === 1"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">有效</span>
                    <span v-if="record.status === 0"
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
