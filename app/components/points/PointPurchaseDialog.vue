<template>
    <!-- 购买积分弹框 -->
    <Dialog v-model:open="dialogOpen">
        <DialogContent class="sm:max-w-[600px]">
            <DialogHeader>
                <DialogTitle>购买积分</DialogTitle>
                <DialogDescription>选择合适的积分套餐，立即购买</DialogDescription>
            </DialogHeader>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div v-for="product in productList" :key="product.id"
                    class="border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer relative">
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-semibold">{{ product.name }}</h4>
                        <Button size="sm" :disabled="!agreeToAgreement" class="absolute top-2 right-2"
                            @click.stop="handleBuy(product)">
                            购买
                        </Button>
                    </div>
                    <p class="text-2xl font-bold mb-2">
                        ¥{{ product.unitPrice }}
                        <span v-if="product.originalUnitPrice && product.originalUnitPrice > product.unitPrice"
                            class="text-base line-through text-muted-foreground ml-2">
                            ¥{{ product.originalUnitPrice }}
                        </span>
                    </p>
                    <p class="text-sm text-muted-foreground mb-2">{{ product.pointAmount }}积分</p>
                    <p class="text-xs text-muted-foreground">{{ product.description }}</p>
                </div>
            </div>
            <!-- 购买协议复选框 -->
            <div class="border-t pt-4">
                <div class="flex items-start space-x-2">
                    <Checkbox id="purchase-agreement" v-model="agreeToAgreement" class="mt-1" />
                    <label for="purchase-agreement" class="text-sm text-muted-foreground leading-5 cursor-pointer">
                        购买即代表您同意
                        <NuxtLink to="/purchase-agreement" target="_blank"
                            class="text-primary font-bold hover:text-primary/80">
                            《LexSeek（法索 AI）服务购买协议》
                        </NuxtLink>
                    </label>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script lang="ts" setup>
// ==================== 类型定义 ====================

/** 积分商品 */
interface PointProduct {
    id: number;
    name: string;
    unitPrice: number;
    originalUnitPrice?: number;
    pointAmount: number;
    description: string;
}

// ==================== Props ====================

interface Props {
    /** 是否显示对话框 */
    open: boolean;
    /** 商品列表 */
    productList: PointProduct[];
}

const props = defineProps<Props>();

// ==================== Emits ====================

const emit = defineEmits<{
    /** 更新显示状态 */
    (e: "update:open", value: boolean): void;
    /** 购买事件 */
    (e: "buy", product: PointProduct): void;
}>();

// ==================== 状态 ====================

// 对话框显示状态（双向绑定）
const dialogOpen = computed({
    get: () => props.open,
    set: (value) => emit("update:open", value),
});

// 是否同意购买协议
const agreeToAgreement = ref(true);

// ==================== 方法 ====================

/**
 * 处理购买
 */
const handleBuy = (product: PointProduct) => {
    emit("buy", product);
};
</script>
