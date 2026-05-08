<template>
    <div class="md:hidden space-y-2">
        <Card v-for="o in orders" :key="o.id" class="cursor-pointer" @click="emit('open', o)">
            <CardContent class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-mono text-xs">{{ o.orderNo }}</span>
                    <StatusBadge :status="o.status" :text-map="OrderStatusText" :variant-map="OrderStatusVariant" />
                </div>
                <div class="text-sm">{{ o.product?.name ?? '-' }} · ¥{{ Number(o.amount).toFixed(2) }}</div>
                <div class="text-xs text-muted-foreground mt-1">
                    {{ o.user?.phone ?? '-' }} · {{ formatDate(o.createdAt) }}
                </div>
            </CardContent>
        </Card>
    </div>
</template>

<script setup lang="ts">
import { OrderStatusVariant, OrderStatusText } from '#shared/types/payment'
import StatusBadge from '~/components/admin/shared/StatusBadge.vue'
import { Card, CardContent } from '~/components/ui/card'
import { useFormatters } from '~/composables/useFormatters'

defineProps<{ orders: any[] }>()
const emit = defineEmits<{ open: [order: any] }>()

const { formatDate: formatDateRaw } = useFormatters()
function formatDate(d: Date | string) { return formatDateRaw(String(d), 'MM-DD HH:mm') }
</script>
