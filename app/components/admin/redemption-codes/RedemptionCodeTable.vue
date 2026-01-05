<template>
    <!-- 桌面端兑换码表格 -->
    <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
        <div class="overflow-x-auto">
            <table class="w-full">
                <thead>
                    <tr class="border-b bg-muted/50">
                        <th class="px-4 py-3 text-left text-sm font-medium w-12">
                            <Checkbox :model-value="isAllSelected"
                                @update:model-value="$emit('toggle-select-all', $event)" />
                        </th>
                        <th class="px-4 py-3 text-left text-sm font-medium">兑换码</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">类型</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">会员级别</th>
                        <th class="px-4 py-3 text-center text-sm font-medium">时长/积分</th>
                        <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">备注</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">过期时间</th>
                        <th class="px-4 py-3 text-center text-sm font-medium w-24">操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="code in codes" :key="code.id"
                        class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                        <td class="px-4 py-3">
                            <Checkbox :model-value="selectedIds.includes(code.id)"
                                @update:model-value="(checked: boolean | 'indeterminate') => $emit('toggle-select', code.id, checked)" />
                        </td>
                        <td class="px-4 py-3 font-mono text-sm">{{ code.code }}</td>
                        <td class="px-4 py-3">
                            <Badge :variant="getTypeVariant(code.type)">{{ code.typeName }}</Badge>
                        </td>
                        <td class="px-4 py-3 text-sm">{{ code.levelName || '-' }}</td>
                        <td class="px-4 py-3 text-center text-sm">
                            <span v-if="code.duration">{{ code.duration }}天</span>
                            <span v-if="code.duration && code.pointAmount"> / </span>
                            <span v-if="code.pointAmount">{{ code.pointAmount }}积分</span>
                            <span v-if="!code.duration && !code.pointAmount">-</span>
                        </td>
                        <td class="px-4 py-3 text-center">
                            <Badge :variant="getStatusVariant(code.status)">{{ code.statusName }}</Badge>
                        </td>
                        <td class="px-4 py-3 text-sm text-muted-foreground max-w-32 truncate"
                            :title="code.remark || ''">
                            {{ code.remark || '-' }}
                        </td>
                        <td class="px-4 py-3 text-sm text-muted-foreground">{{ code.expiredAt || '永不过期' }}</td>
                        <td class="px-4 py-3 text-center">
                            <Button v-if="code.status === 1" variant="ghost" size="sm"
                                @click="$emit('invalidate', code)">
                                <Ban class="h-4 w-4 mr-1" />
                                作废
                            </Button>
                            <span v-else class="text-muted-foreground text-sm">-</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Ban } from 'lucide-vue-next'
import { Checkbox } from '@/components/ui/checkbox'
import type { RedemptionCodeAdminInfo } from '#shared/types/redemption'

// 定义 props
defineProps<{
    codes: RedemptionCodeAdminInfo[]
    selectedIds: number[]
    isAllSelected: boolean | 'indeterminate'
}>()

// 定义事件
defineEmits<{
    'toggle-select': [id: number, checked: boolean | 'indeterminate']
    'toggle-select-all': [checked: boolean | 'indeterminate']
    invalidate: [code: RedemptionCodeAdminInfo]
}>()

/** 获取类型样式 */
const getTypeVariant = (type: number) => {
    const variants: Record<number, 'default' | 'secondary' | 'outline'> = {
        1: 'default',
        2: 'secondary',
        3: 'outline',
    }
    return variants[type] || 'default'
}

/** 获取状态样式 */
const getStatusVariant = (status: number) => {
    const variants: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = {
        1: 'default',
        2: 'secondary',
        3: 'outline',
        4: 'destructive',
    }
    return variants[status] || 'default'
}
</script>
