<template>
    <!-- 桌面端产品表格 -->
    <div class="hidden overflow-hidden rounded-lg border bg-card md:block">
        <div class="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow class="bg-muted/50 hover:bg-muted/50">
                        <TableHead class="px-4 py-3">产品名称</TableHead>
                        <TableHead class="px-4 py-3">类型</TableHead>
                        <TableHead class="px-4 py-3">会员级别</TableHead>
                        <TableHead class="px-4 py-3 text-center">价格</TableHead>
                        <TableHead class="px-4 py-3 text-center">状态</TableHead>
                        <TableHead class="px-4 py-3 text-center">排序</TableHead>
                        <TableHead class="w-32 px-4 py-3 text-center">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="product in products" :key="product.id" class="hover:bg-muted/30">
                        <TableCell class="px-4 py-3">
                            <div class="font-medium">{{ product.name }}</div>
                            <div v-if="product.description" class="text-xs text-muted-foreground truncate max-w-48">
                                {{ product.description }}
                            </div>
                        </TableCell>
                        <TableCell class="px-4 py-3">
                            <Badge variant="outline" :class="getAdminProductTypeBadgeClass(product.type)">
                                {{ product.type === 1 ? '会员' : '积分' }}
                            </Badge>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-sm">{{ product.levelName || '-' }}</TableCell>
                        <TableCell class="px-4 py-3 text-center text-sm">
                            <template v-if="product.type === 1">
                                <div v-if="product.priceMonthly">月付: ¥{{ product.priceMonthly }}</div>
                                <div v-if="product.priceYearly">年付: ¥{{ product.priceYearly }}</div>
                            </template>
                            <template v-else>
                                <div v-if="product.unitPrice">¥{{ product.unitPrice }}/{{ product.pointAmount }}积分</div>
                            </template>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-center">
                            <Badge variant="outline" :class="getAdminStatusBadgeClass(product.status === 1)">
                                {{ product.status === 1 ? '上架' : '下架' }}
                            </Badge>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-center text-sm">{{ product.sortOrder }}</TableCell>
                        <TableCell class="px-4 py-3 text-center">
                            <div class="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="sm" :class="adminBrandFocusClass" aria-label="编辑产品"
                                    @click="$emit('edit', product)">
                                    <Pencil class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" :class="adminBrandFocusClass"
                                    :aria-label="product.status === 1 ? '下架产品' : '上架产品'"
                                    @click="$emit('toggle-status', product)">
                                    <component :is="product.status === 1 ? EyeOff : Eye" class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm"
                                    :class="['text-destructive hover:text-destructive', adminBrandFocusClass]"
                                    aria-label="删除产品" @click="$emit('delete', product)">
                                    <Trash2 class="h-4 w-4" />
                                </Button>
                            </div>
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Pencil, Trash2, Eye, EyeOff } from 'lucide-vue-next'
import type { ProductInfo } from '#shared/types/product'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
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
