<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">产品管理</h1>
                    <p class="text-muted-foreground text-sm">管理售卖的产品，包括会员和积分商品</p>
                </div>
                <Button @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增产品
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="typeFilter">
                    <SelectTrigger class="w-full md:w-40">
                        <SelectValue placeholder="产品类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="1">会员商品</SelectItem>
                        <SelectItem value="2">积分商品</SelectItem>
                    </SelectContent>
                </Select>
                <Select v-model="statusFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="1">上架</SelectItem>
                        <SelectItem value="0">下架</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline" @click="handleSearch">
                    <Search class="h-4 w-4 mr-2" />
                    筛选
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!products.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Package class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无产品</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增产品</p>
            </div>

            <!-- 产品列表 -->
            <template v-else>
                <!-- 桌面端表格 -->
                <AdminProductsProductTable :products="products" @edit="formDialogRef?.openEdit($event)"
                    @toggle-status="handleToggleStatus" @delete="handleDelete" />

                <!-- 移动端卡片 -->
                <AdminProductsProductMobile :products="products" @edit="formDialogRef?.openEdit($event)"
                    @toggle-status="handleToggleStatus" @delete="handleDelete" />

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 创建/编辑对话框 -->
        <AdminProductsProductFormDialog ref="formDialogRef" :membership-levels="membershipLevels"
            @success="loadProducts" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除产品「{{ selectedProduct?.name }}」吗？此操作不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmDelete" :disabled="deleting">
                        <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                        确认删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
</template>

<script setup lang="ts">
import { Search, Plus, Loader2, Package } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ProductInfo } from '#shared/types/product'
import AdminProductsProductFormDialog from '~/components/admin/products/ProductFormDialog.vue'
import AdminProductsProductMobile from '~/components/admin/products/ProductMobile.vue'
import AdminProductsProductTable from '~/components/admin/products/ProductTable.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import type { membershipLevels, products } from '~~/generated/prisma/client'

definePageMeta({ layout: 'admin-layout', title: '产品管理' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/products/ProductFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const products = ref<ProductInfo[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const typeFilter = ref('all')
const statusFilter = ref('all')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedProduct = ref<ProductInfo | null>(null)

// 会员级别列表
const membershipLevels = ref<Array<{ id: number; name: string }>>([])

// 加载会员级别
const loadMembershipLevels = async () => {
    const data = await useApiFetch<Array<{ id: number; name: string }>>('/api/v1/memberships/levels')
    if (data) membershipLevels.value = data
}

// 加载产品列表
const loadProducts = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (typeFilter.value !== 'all') params.type = parseInt(typeFilter.value)
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)

        const data = await useApiFetch<{ items: ProductInfo[]; total: number }>('/api/v1/admin/products', { query: params })
        if (data) {
            products.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadProducts()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadProducts()
}

// 切换状态
const handleToggleStatus = async (product: ProductInfo) => {
    const result = await useApiFetch(`/api/v1/admin/products/status/${product.id}`, { method: 'PATCH' })
    if (result) {
        toast.success('状态已更新')
        loadProducts()
    }
}

// 删除产品
const handleDelete = (product: ProductInfo) => {
    selectedProduct.value = product
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedProduct.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/products/${selectedProduct.value.id}`, { method: 'DELETE' })
        if (result) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadProducts()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadMembershipLevels()
    loadProducts()
})
</script>
