<template>
    <!-- 取消订单确认弹框 -->
    <AlertDialog :open="open" @update:open="emit('update:open', $event)">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>确认取消订单</AlertDialogTitle>
                <AlertDialogDescription>
                    您确定要取消订单 {{ order?.orderNo }} 吗？取消后不可恢复。
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>返回</AlertDialogCancel>
                <AlertDialogAction :disabled="loading" @click="handleConfirm">
                    <Loader2 v-if="loading" class="w-4 h-4 mr-2 animate-spin" />
                    确认取消
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>

<script lang="ts" setup>
import { Loader2 } from "lucide-vue-next";
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
    loading: boolean;
}>();

// 定义 emits
const emit = defineEmits<{
    'update:open': [value: boolean];
    confirm: [];
}>();

// 确认取消
const handleConfirm = () => {
    emit('confirm');
};
</script>
