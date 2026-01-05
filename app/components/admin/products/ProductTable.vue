<template>
    <!-- 桌面端产品表格 -->
    <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
        <div class="overflow-x-auto">
            <table class="w-full">
                <thead>
                    <tr class="border-b bg-muted/50">
                        <th class="px-4 py-3 text-left text-sm font-medium">产品名称</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">类型</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">会员级别</th>
                        <th class="px-4 py-3 text-center text-sm font-medium">价格</th>
                        <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                        <th class="px-4 py-3 text-center text-sm font-medium">排序</th>
                        <th class="px-4 py-3 text-center text-sm font-medium w-32">操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="product in products" :key="product.id"
                        class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                        <td class="px-4 py-3">
                            <div class="font-medium">{{ product.name }}</div>
                            <div v-if="product.description" class="text-xs text-muted-foreground truncate max-w-48">
                                {{ product.description }}
                            </div>
                        </td>
                        <td class="px-4 py-3">
                            <Badge :variant="product.type === 1 ? 'default' : 'secondary'">
                                {{ product.type === 1 ? '会员' : '积分' }}
                            </Badge>
                        </td>
                        <td class="px-4 py-3 text-sm">{{ product.levelName || '-' }}</td>
                        <td class="px-4 py-3 text-center text-sm">
                            <template v-if="product.type === 1">
                                <div v-if="product.priceMonthly">月付: ¥{{ product.priceMonthly }}</div>
                                <div v-if="product.priceYearly">年付: ¥{{ product.priceYearly }}</div>
                            </template>
                            <template v-else>
                                <div v-if="product.unitPrice">¥{{ product.unitPrice }}/{{ product.pointAmount }}积分</div>
                            </template>
                        </td>
                        <td class="px-4 py-3 text-center">
                            <Badge :variant="product.status === 1 ? 'default' : 'outline'">
                                {{ product.status === 1 ? '上架' : '下架' }}
                            </Badge>
                        </td>
                        <td class="px-4 py-3 text-center text-sm">{{ product.sortOrder }}</td>
                        <td class="px-4 py-3 text-center">
                            <div class="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="sm" @click="$emit('edit', product)">
                                    <Pencil class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" @click="$emit('toggle-status', product)">
                                    <component :is="product.status === 1 ? EyeOff : Eye" class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" @click="$emit('delete', product)">
                                    <Trash2 class="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Pencil, Trash2, Eye, EyeOff } from 'lucide-vue-next'
import type { ProductInfo } from '#shared/types/product'

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
