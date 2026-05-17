<template>
    <!-- 移动端兑换码卡片列表 -->
    <div class="md:hidden space-y-3">
        <div v-for="code in codes" :key="code.id" class="bg-card rounded-lg border p-4 space-y-3">
            <div class="flex items-start justify-between">
                <div class="flex items-center gap-2">
                    <Checkbox :model-value="selectedIds.includes(code.id)" :class="adminBrandCheckboxClass"
                        @update:model-value="(checked: boolean | 'indeterminate') => $emit('toggle-select', code.id, checked)" />
                    <span class="font-mono text-sm">{{ code.code }}</span>
                </div>
                <Badge variant="outline" :class="getAdminRedemptionStatusBadgeClass(code.status)">
                    {{ code.statusName }}
                </Badge>
            </div>
            <div class="flex flex-wrap gap-2">
                <Badge variant="outline" :class="getAdminRedemptionTypeBadgeClass(code.type)">
                    {{ code.typeName }}
                </Badge>
                <span v-if="code.levelName" class="text-sm text-muted-foreground">{{ code.levelName }}</span>
            </div>
            <div class="text-sm text-muted-foreground">
                <span v-if="code.duration">{{ code.duration }}天</span>
                <span v-if="code.duration && code.pointAmount"> / </span>
                <span v-if="code.pointAmount">{{ code.pointAmount }}积分</span>
            </div>
            <div v-if="code.remark" class="text-xs text-muted-foreground">备注：{{ code.remark }}</div>
            <div class="text-xs text-muted-foreground">
                过期：{{ code.expiredAt || '永不过期' }} | 创建：{{ code.createdAt }}
            </div>
            <div v-if="code.status === 1" class="pt-2 border-t">
                <Button variant="outline" size="sm"
                    :class="['w-full text-destructive hover:text-destructive', adminBrandFocusClass]"
                    @click="$emit('invalidate', code)">
                    <Ban class="h-3 w-3 mr-1" />
                    作废
                </Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Ban } from 'lucide-vue-next'
import { Checkbox } from '@/components/ui/checkbox'
import type { RedemptionCodeAdminInfo } from '#shared/types/redemption'
import {
    adminBrandCheckboxClass,
    adminBrandFocusClass,
    getAdminRedemptionStatusBadgeClass,
    getAdminRedemptionTypeBadgeClass,
} from '~/utils/adminBrandStyles'

// 定义 props
defineProps<{
    codes: RedemptionCodeAdminInfo[]
    selectedIds: number[]
}>()

// 定义事件
defineEmits<{
    'toggle-select': [id: number, checked: boolean | 'indeterminate']
    invalidate: [code: RedemptionCodeAdminInfo]
}>()

</script>
