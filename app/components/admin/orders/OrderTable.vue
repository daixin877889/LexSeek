<template>
    <div class="hidden md:block border rounded-md overflow-x-auto">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>订单号</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>商品</TableHead>
                    <TableHead>金额</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow v-for="o in orders" :key="o.id" class="cursor-pointer hover:bg-muted/50"
                    @click="emit('open', o)">
                    <TableCell class="font-mono text-xs">{{ o.orderNo }}</TableCell>
                    <TableCell>
                        <div class="text-sm">{{ o.user?.phone ?? '-' }}</div>
                        <div class="text-xs text-muted-foreground">{{ o.user?.name ?? '-' }}</div>
                    </TableCell>
                    <TableCell>{{ o.product?.name ?? '-' }}</TableCell>
                    <TableCell>¥{{ Number(o.amount).toFixed(2) }}</TableCell>
                    <TableCell>{{ OrderTypeText[o.orderType as keyof typeof OrderTypeText] ?? o.orderType }}</TableCell>
                    <TableCell>
                        <StatusBadge :status="o.status" :text-map="OrderStatusText" :variant-map="OrderStatusVariant" />
                    </TableCell>
                    <TableCell class="text-xs">{{ formatDate(o.createdAt) }}</TableCell>
                </TableRow>
            </TableBody>
        </Table>
    </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import { OrderStatusVariant, OrderStatusText, OrderTypeText } from '#shared/types/payment'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'

defineProps<{ orders: any[] }>()
const emit = defineEmits<{ open: [order: any] }>()

function formatDate(d: Date | string) {
    return dayjs(d).format('YYYY-MM-DD HH:mm')
}
</script>
