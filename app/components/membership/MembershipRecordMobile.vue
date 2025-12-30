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
                <p>{{ formatDateChinese(record.createdAt) }}</p>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
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
</script>
