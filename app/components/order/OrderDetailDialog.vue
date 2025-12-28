<template>
    <!-- 订单详情弹框 -->
    <Dialog :open="open" @update:open="emit('update:open', $event)">
        <DialogContent class="sm:max-w-[500px]" @open-auto-focus.prevent>
            <DialogHeader>
                <DialogTitle>订单详情</DialogTitle>
                <DialogDescription>
                    订单号：{{ order?.orderNo }}
                </DialogDescription>
            </DialogHeader>

            <div v-if="order" class="space-y-4">
                <!-- 订单状态 -->
                <div class="flex justify-between items-center py-2 border-b">
                    <span class="text-muted-foreground">订单状态</span>
                    <Badge :variant="getStatusVariant(order.status)" :class="getStatusClass(order.status)">
                        {{ getStatusText(order.status) }}
                    </Badge>
                </div>

                <!-- 商品信息 -->
                <div class="flex justify-between items-center py-2 border-b">
                    <span class="text-muted-foreground">商品名称</span>
                    <span class="font-medium">{{ order.productName }}</span>
                </div>

                <!-- 订单金额 -->
                <div class="flex justify-between items-center py-2 border-b">
                    <span class="text-muted-foreground">订单金额</span>
                    <span class="font-medium text-primary">¥{{ order.amount.toFixed(2) }}</span>
                </div>

                <!-- 购买时长 -->
                <div class="flex justify-between items-center py-2 border-b">
                    <span class="text-muted-foreground">购买时长</span>
                    <span class="font-medium">{{ formatDuration(order.duration, order.durationUnit) }}</span>
                </div>

                <!-- 下单时间 -->
                <div class="flex justify-between items-center py-2 border-b">
                    <span class="text-muted-foreground">下单时间</span>
                    <span>{{ formatDate(order.createdAt) }}</span>
                </div>

                <!-- 支付时间（已支付时显示） -->
                <div v-if="order.paidAt" class="flex justify-between items-center py-2 border-b">
                    <span class="text-muted-foreground">支付时间</span>
                    <span>{{ formatDate(order.paidAt) }}</span>
                </div>

                <!-- 过期时间（待支付时显示） -->
                <div v-if="order.status === OrderStatus.PENDING"
                    class="flex justify-between items-center py-2 border-b">
                    <span class="text-muted-foreground">支付截止</span>
                    <span class="text-orange-600">{{ formatDate(order.expiredAt) }}</span>
                </div>

                <!-- 操作按钮 -->
                <div class="flex gap-2 pt-4">
                    <Button v-if="order.status === OrderStatus.PENDING" class="flex-1" @click="emit('pay', order)">
                        立即支付
                    </Button>
                    <Button v-if="order.status === OrderStatus.PENDING" variant="outline" class="flex-1"
                        @click="emit('cancel', order)">
                        取消订单
                    </Button>
                    <Button variant="outline" class="flex-1" @click="emit('update:open', false)">
                        关闭
                    </Button>
                </div>
            </div>
        </DialogContent>
    </Dialog>
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
    open: boolean;
    order: OrderItem | null;
}>();

// 定义 emits
const emit = defineEmits<{
    'update:open': [value: boolean];
    pay: [order: OrderItem];
    cancel: [order: OrderItem];
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
