<template>
    <!-- 移动端产品卡片列表 -->
    <div class="md:hidden space-y-3">
        <div v-for="product in products" :key="product.id" class="bg-card rounded-lg border p-4 space-y-3">
            <div class="flex items-start justify-between">
                <div>
                    <div class="font-medium">{{ product.name }}</div>
                    <div v-if="product.description" class="text-xs text-muted-foreground">
                        {{ product.description }}
                    </div>
                </div>
                <Badge variant="outline" :class="getAdminStatusBadgeClass(product.status === 1)">
                    {{ product.status === 1 ? '上架' : '下架' }}
                </Badge>
            </div>
            <div class="flex flex-wrap gap-2">
                <Badge variant="outline" :class="getAdminProductTypeBadgeClass(product.type)">
                    {{ product.type === 1 ? '会员' : '积分' }}
                </Badge>
                <span v-if="product.levelName" class="text-sm text-muted-foreground">{{ product.levelName }}</span>
            </div>
            <div class="text-sm">
                <template v-if="product.type === 1">
                    <span v-if="product.priceMonthly">月付: ¥{{ product.priceMonthly }}</span>
                    <span v-if="product.priceMonthly && product.priceYearly"> / </span>
                    <span v-if="product.priceYearly">年付: ¥{{ product.priceYearly }}</span>
                </template>
                <template v-else>
                    <span v-if="product.unitPrice">¥{{ product.unitPrice }}/{{ product.pointAmount }}积分</span>
                </template>
            </div>
            <div class="pt-2 border-t flex gap-2">
                <Button variant="outline" size="sm" :class="['flex-1', adminBrandFocusClass]"
                    @click="$emit('edit', product)">
                    <Pencil class="h-3 w-3 mr-1" />
                    编辑
                </Button>
                <Button variant="outline" size="sm" :class="adminBrandFocusClass"
                    :aria-label="product.status === 1 ? '下架产品' : '上架产品'" @click="$emit('toggle-status', product)">
                    <component :is="product.status === 1 ? EyeOff : Eye" class="h-3 w-3" />
                </Button>
                <Button variant="outline" size="sm" :class="['text-destructive hover:text-destructive', adminBrandFocusClass]"
                    aria-label="删除产品" @click="$emit('delete', product)">
                    <Trash2 class="h-3 w-3" />
                </Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Pencil, Trash2, Eye, EyeOff } from 'lucide-vue-next'
import type { ProductInfo } from '#shared/types/product'
import {
    adminBrandFocusClass,
    getAdminProductTypeBadgeClass,
    getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

// 定义 props
defineProps<{
    products: ProductInfo[]
}>()

// 定义事件
defineEmits<{
    edit: [product: ProductInfo]
    'toggle-status': [product: ProductInfo]
    delete: [product: ProductInfo]
}>()
</script>
