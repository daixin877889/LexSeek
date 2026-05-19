<template>
    <!-- 桌面端兑换码表格 -->
    <div class="hidden overflow-hidden rounded-lg border bg-card md:block">
        <div class="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow class="bg-muted/50 hover:bg-muted/50">
                        <TableHead class="w-12 px-4 py-3">
                            <Checkbox :model-value="isAllSelected" :class="adminBrandCheckboxClass"
                                @update:model-value="$emit('toggle-select-all', $event)" />
                        </TableHead>
                        <TableHead class="px-4 py-3">兑换码</TableHead>
                        <TableHead class="px-4 py-3">类型</TableHead>
                        <TableHead class="px-4 py-3">会员级别</TableHead>
                        <TableHead class="px-4 py-3 text-center">时长/积分</TableHead>
                        <TableHead class="px-4 py-3 text-center">状态</TableHead>
                        <TableHead class="px-4 py-3">备注</TableHead>
                        <TableHead class="px-4 py-3">创建人</TableHead>
                        <TableHead class="px-4 py-3">过期时间</TableHead>
                        <TableHead class="w-24 px-4 py-3 text-center">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="code in codes" :key="code.id" class="hover:bg-muted/30">
                        <TableCell class="px-4 py-3">
                            <Checkbox :model-value="selectedIds.includes(code.id)" :class="adminBrandCheckboxClass"
                                @update:model-value="(checked: boolean | 'indeterminate') => $emit('toggle-select', code.id, checked)" />
                        </TableCell>
                        <TableCell class="px-4 py-3 font-mono text-sm">{{ code.code }}</TableCell>
                        <TableCell class="px-4 py-3">
                            <Badge variant="outline" :class="getAdminRedemptionTypeBadgeClass(code.type)">
                                {{ code.typeName }}
                            </Badge>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-sm">{{ code.levelName || '-' }}</TableCell>
                        <TableCell class="px-4 py-3 text-center text-sm">
                            <span v-if="code.duration">{{ code.duration }}天</span>
                            <span v-if="code.duration && code.pointAmount"> / </span>
                            <span v-if="code.pointAmount">{{ code.pointAmount }}积分</span>
                            <span v-if="!code.duration && !code.pointAmount">-</span>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-center">
                            <Badge variant="outline" :class="getAdminRedemptionStatusBadgeClass(code.status)">
                                {{ code.statusName }}
                            </Badge>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-sm text-muted-foreground max-w-32 truncate"
                            :title="code.remark || ''">
                            {{ code.remark || '-' }}
                        </TableCell>
                        <TableCell class="px-4 py-3 text-sm text-muted-foreground">
                            {{ code.createdByName || '-' }}
                        </TableCell>
                        <TableCell class="px-4 py-3 text-sm text-muted-foreground">
                            {{ code.expiredAt || '永不过期' }}
                        </TableCell>
                        <TableCell class="px-4 py-3 text-center">
                            <Button v-if="code.status === 1" variant="ghost" size="sm"
                                :class="['text-destructive hover:text-destructive', adminBrandFocusClass]"
                                @click="$emit('invalidate', code)">
                                <Ban class="h-4 w-4" />
                                作废
                            </Button>
                            <span v-else class="text-muted-foreground text-sm">-</span>
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Ban } from 'lucide-vue-next'
import { Checkbox } from '@/components/ui/checkbox'
import type { RedemptionCodeAdminInfo } from '#shared/types/redemption'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
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
    isAllSelected: boolean | 'indeterminate'
}>()

// 定义事件
defineEmits<{
    'toggle-select': [id: number, checked: boolean | 'indeterminate']
    'toggle-select-all': [checked: boolean | 'indeterminate']
    invalidate: [code: RedemptionCodeAdminInfo]
}>()

</script>
