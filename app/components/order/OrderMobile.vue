<template>
    <!-- 移动端卡片视图 -->
    <div class="md:hidden space-y-4">
        <div v-if="loading" class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span class="ml-2 text-muted-foreground">加载中...</span>
        </div>
        <div v-else-if="list.length === 0" class="text-center py-8 text-muted-foreground border rounded-lg">
            暂无订单记录
        </div>
        <div v-else v-for="order in list" :key="order.id" class="border rounded-lg p-4 space-y-3">
            <div class="flex justify-between items-start">
                <div>
                    <h4 class="font-medium text-sm mb-1">{{ order.productName }}</h4>
                    <p class="text-xs text-muted-foreground font-mono">{{ order.orderNo }}</p>
                </div>
                <Badge variant="outline" :class="getStatusClass(order.status)">
                    {{ getStatusText(order.status) }}
                </Badge>
            </div>
            <div class="grid grid-cols-2 gap-2 text-sm">
                <div>
                    <p class="text-muted-foreground">金额</p>
                    <p class="font-medium">¥{{ formatAmount(order.amount) }}</p>
                </div>
                <div>
                    <p class="text-muted-foreground">时长</p>
                    <p class="font-medium">{{ formatDuration(order.duration, order.durationUnit) }}</p>
                </div>
                <div class="col-span-2">
                    <p class="text-muted-foreground">下单时间</p>
                    <p class="font-medium">{{ formatDate(order.createdAt) }}</p>
                </div>
            </div>
            <div class="flex gap-2 pt-2 border-t">
                <Button v-if="order.status === OrderStatus.PENDING" size="sm" class="flex-1"
                    @click="emit('pay', order)">
                    支付
                </Button>
                <Button v-if="order.status === OrderStatus.PENDING" size="sm" variant="outline" class="flex-1"
                    @click="emit('cancel', order)">
                    取消
                </Button>
                <Button size="sm" variant="ghost" class="flex-1" @click="emit('detail', order)">
                    详情
                </Button>
            </div>
        </div>
    </div>
</template>

<script lang="ts" setup>
import { OrderStatus, type OrderItem } from "#shared/types/payment";

// ==================== Props ====================

defineProps<{
    list: OrderItem[];
    loading: boolean;
}>();

// ==================== Emits ====================

const emit = defineEmits<{
    pay: [order: OrderItem];
    cancel: [order: OrderItem];
    detail: [order: OrderItem];
}>();

// ==================== Composables ====================

// 使用格式化工具
const { formatDate, formatAmount } = useFormatters()

// 使用订单状态工具
const { getStatusText, getStatusClass, formatDuration } = useOrderStatus()
</script>
