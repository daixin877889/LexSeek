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
                        <td class="px-4 py-3 text-sm font-medium">¥{{ (order.amount ?? 0).toFixed(2) }}</td>
                        <td class="px-4 py-3 text-sm">{{ formatDuration(order.duration, order.durationUnit) }}</td>
                        <td class="px-4 py-3 text-sm">
                            <Badge :variant="getStatusVariant(order.status)" :class="getStatusClass(order.status)">
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
