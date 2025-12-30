<template>
    <!-- 桌面端表格视图 -->
    <div class="border rounded-lg overflow-hidden hidden md:block">
        <table class="w-full">
            <thead>
                <tr class="border-b bg-muted/50">
                    <th class="px-4 py-3 text-left text-sm font-medium">订单号</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">商品名称</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">金额</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">时长</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">状态</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">下单时间</th>
                    <th class="px-4 py-3 text-left text-sm font-medium">操作</th>
                </tr>
            </thead>
            <tbody>
                <!-- 加载中 -->
                <tr v-if="loading">
                    <td colspan="7" class="px-4 py-8 text-center">
                        <div class="flex items-center justify-center">
                            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                            <span class="ml-2 text-muted-foreground">加载中...</span>
                        </div>
                    </td>
                </tr>
                <!-- 空状态 -->
                <tr v-else-if="list.length === 0">
                    <td colspan="7" class="px-4 py-8 text-center text-muted-foreground">
                        暂无订单记录
                    </td>
                </tr>
                <!-- 数据列表 -->
                <template v-else>
                    <tr v-for="order in list" :key="order.id" class="border-b last:border-b-0 hover:bg-muted/30">
                        <td class="px-4 py-3 text-sm font-mono">{{ order.orderNo }}</td>
                        <td class="px-4 py-3 text-sm">{{ order.productName }}</td>
                        <td class="px-4 py-3 text-sm font-medium">¥{{ formatAmount(order.amount) }}</td>
                        <td class="px-4 py-3 text-sm">{{ formatDuration(order.duration, order.durationUnit) }}</td>
                        <td class="px-4 py-3 text-sm">
                            <Badge variant="outline" :class="getStatusClass(order.status)">
                                {{ getStatusText(order.status) }}
                            </Badge>
                        </td>
                        <td class="px-4 py-3 text-sm">{{ formatDate(order.createdAt) }}</td>
                        <td class="px-4 py-3 text-sm">
                            <div class="flex gap-2">
                                <Button v-if="order.status === OrderStatus.PENDING" size="sm"
                                    @click="emit('pay', order)">
                                    支付
                                </Button>
                                <Button v-if="order.status === OrderStatus.PENDING" size="sm" variant="outline"
                                    @click="emit('cancel', order)">
                                    取消
                                </Button>
                                <Button size="sm" variant="ghost" @click="emit('detail', order)">
                                    详情
                                </Button>
                            </div>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
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
