<template>
    <div class="hidden md:block border rounded-md overflow-x-auto">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>支付单号</TableHead>
                    <TableHead>关联订单</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>渠道/方式</TableHead>
                    <TableHead>金额</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>创建时间</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow v-for="p in payments" :key="p.id" class="cursor-pointer hover:bg-muted/50"
                    @click="emit('open', p)">
                    <TableCell class="font-mono text-xs">{{ p.transactionNo }}</TableCell>
                    <TableCell class="font-mono text-xs">{{ p.order?.orderNo ?? '-' }}</TableCell>
                    <TableCell class="text-sm">{{ p.order?.user?.phone ?? '-' }}</TableCell>
                    <TableCell class="text-xs">
                        {{ PaymentChannelText[p.paymentChannel as keyof typeof PaymentChannelText] ?? p.paymentChannel }}
                        / {{ PaymentMethodText[p.paymentMethod as keyof typeof PaymentMethodText] ?? p.paymentMethod }}
                    </TableCell>
                    <TableCell>¥{{ Number(p.amount).toFixed(2) }}</TableCell>
                    <TableCell>
                        <StatusBadge :status="p.status" :text-map="PaymentStatusText" :variant-map="PaymentStatusVariant" />
                    </TableCell>
                    <TableCell class="text-xs">{{ formatDate(p.createdAt) }}</TableCell>
                </TableRow>
            </TableBody>
        </Table>
    </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import {
    PaymentStatusVariant, PaymentStatusText,
    PaymentChannelText, PaymentMethodText,
} from '#shared/types/payment'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'

defineProps<{ payments: any[] }>()
const emit = defineEmits<{ open: [payment: any] }>()

function formatDate(d: Date | string) { return dayjs(d).format('YYYY-MM-DD HH:mm') }
</script>
