<template>
    <div class="md:hidden space-y-2">
        <Card v-for="p in payments" :key="p.id" class="cursor-pointer" @click="emit('open', p)">
            <CardContent class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-mono text-xs">{{ p.transactionNo }}</span>
                    <StatusBadge :status="p.status" :text-map="PaymentStatusText" :variant-map="PaymentStatusVariant" />
                </div>
                <div class="text-sm">
                    {{ PaymentChannelText[p.paymentChannel as keyof typeof PaymentChannelText] ?? p.paymentChannel }}
                    · ¥{{ Number(p.amount).toFixed(2) }}
                </div>
                <div class="text-xs text-muted-foreground mt-1">
                    {{ p.order?.user?.phone ?? '-' }} · {{ formatDate(p.createdAt) }}
                </div>
            </CardContent>
        </Card>
    </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import { PaymentStatusVariant, PaymentStatusText, PaymentChannelText } from '#shared/types/payment'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import { Card, CardContent } from '~/components/ui/card'

defineProps<{ payments: any[] }>()
const emit = defineEmits<{ open: [payment: any] }>()

function formatDate(d: Date | string) { return dayjs(d).format('MM-DD HH:mm') }
</script>
