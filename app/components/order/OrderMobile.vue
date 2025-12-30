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
                <Badge :variant="getStatusVariant(order.status)" :class="getStatusClass(order.status)">
                    {{ getStatusText(order.status) }}
                </Badge>
            </div>
            <div class="grid grid-cols-2 gap-2 text-sm">
                <div>
                    <p class="text-muted-foreground">金额</p>
                    <p class="font-medium">¥{{ (order.amount ?? 0).toFixed(2) }}</p>
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
import dayjs from "dayjs";
import { OrderStatus, DurationUnit } from "#shared/types/payment";

// 类型定义
interface OrderItem {
    id: number;
    orderNo: string;
    productName: string;
    productType: number;
    amount: number;
    duration: number;
    durationUnit: DurationUnit;
    status: OrderStatus;
    paidAt: string | null;
    expiredAt: string;
    createdAt: string;
}

// 定义 props
defineProps<{
    list: OrderItem[];
    loading: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    pay: [order: OrderItem];
    cancel: [order: OrderItem];
    detail: [order: OrderItem];
}>();

// 获取状态文本
const getStatusText = (status: OrderStatus): string => {
    const statusMap: Record<OrderStatus, string> = {
        [OrderStatus.PENDING]: '待支付',
        [OrderStatus.PAID]: '已支付',
        [OrderStatus.CANCELLED]: '已取消',
        [OrderStatus.REFUNDED]: '已退款',
    };
    return statusMap[status] || '未知';
};

// 获取状态样式变体
const getStatusVariant = (status: OrderStatus): "default" | "destructive" | "outline" | "secondary" => {
    return 'outline';
};

// 获取状态样式类
const getStatusClass = (status: OrderStatus): string => {
    const classMap: Record<OrderStatus, string> = {
        [OrderStatus.PENDING]: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        [OrderStatus.PAID]: 'bg-green-100 text-green-800 border-green-200',
        [OrderStatus.CANCELLED]: 'bg-gray-100 text-gray-800 border-gray-200',
        [OrderStatus.REFUNDED]: 'bg-blue-100 text-blue-800 border-blue-200',
    };
    return classMap[status] || '';
};

// 格式化时长
const formatDuration = (duration: number, unit: DurationUnit): string => {
    if (unit === DurationUnit.MONTH) {
        return `${duration} 个月`;
    } else if (unit === DurationUnit.YEAR) {
        return `${duration} 年`;
    }
    return `${duration}`;
};

// 格式化日期
const formatDate = (dateString: string): string => {
    if (!dateString) return "—";
    return dayjs(dateString).format("YYYY-MM-DD HH:mm");
};
</script>
