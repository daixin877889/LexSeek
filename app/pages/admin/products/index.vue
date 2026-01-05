<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">产品管理</h1>
                    <p class="text-muted-foreground text-sm">管理售卖的产品，包括会员和积分商品</p>
                </div>
                <Button @click="openCreateDialog">
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
                                        <div v-if="product.description"
                                            class="text-xs text-muted-foreground truncate max-w-48">
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
                                            <div v-if="product.unitPrice">¥{{ product.unitPrice }}/{{
                                                product.pointAmount }}积分</div>
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
                                            <Button variant="ghost" size="sm" @click="openEditDialog(product)">
                                                <Pencil class="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" @click="handleToggleStatus(product)">
                                                <component :is="product.status === 1 ? EyeOff : Eye" class="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" @click="handleDelete(product)">
                                                <Trash2 class="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 移动端卡片 -->
                <div class="md:hidden space-y-3">
                    <div v-for="product in products" :key="product.id" class="bg-card rounded-lg border p-4 space-y-3">
                        <div class="flex items-start justify-between">
                            <div>
                                <div class="font-medium">{{ product.name }}</div>
                                <div v-if="product.description" class="text-xs text-muted-foreground">
                                    {{ product.description }}
                                </div>
                            </div>
                            <Badge :variant="product.status === 1 ? 'default' : 'outline'">
                                {{ product.status === 1 ? '上架' : '下架' }}
                            </Badge>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <Badge :variant="product.type === 1 ? 'default' : 'secondary'">
                                {{ product.type === 1 ? '会员' : '积分' }}
                            </Badge>
                            <span v-if="product.levelName" class="text-sm text-muted-foreground">{{ product.levelName
                            }}</span>
                        </div>
                        <div class="text-sm">
                            <template v-if="product.type === 1">
                                <span v-if="product.priceMonthly">月付: ¥{{ product.priceMonthly }}</span>
                                <span v-if="product.priceMonthly && product.priceYearly"> / </span>
                                <span v-if="product.priceYearly">年付: ¥{{ product.priceYearly }}</span>
                            </template>
                            <template v-else>
                                <span v-if="product.unitPrice">¥{{ product.unitPrice }}/{{ product.pointAmount
                                }}积分</span>
                            </template>
                        </div>
                        <div class="pt-2 border-t flex gap-2">
                            <Button variant="outline" size="sm" class="flex-1" @click="openEditDialog(product)">
                                <Pencil class="h-3 w-3 mr-1" />
                                编辑
                            </Button>
                            <Button variant="outline" size="sm" @click="handleToggleStatus(product)">
                                <component :is="product.status === 1 ? EyeOff : Eye" class="h-3 w-3" />
                            </Button>
                            <Button variant="outline" size="sm" @click="handleDelete(product)">
                                <Trash2 class="h-3 w-3 text-destructive" />
                            </Button>
                        </div>
                    </div>
                </div>

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 创建/编辑对话框 -->
        <Dialog v-model:open="dialogOpen">
            <DialogContent class="max-w-lg max-h-[85vh] flex flex-col">
                <DialogHeader class="flex-shrink-0">
                    <DialogTitle>{{ isEdit ? '编辑产品' : '新增产品' }}</DialogTitle>
                    <DialogDescription>{{ isEdit ? '修改产品信息' : '创建新的产品' }}</DialogDescription>
                </DialogHeader>
                <div class="flex-1 overflow-y-auto space-y-4 py-4 px-1">
                    <div class="space-y-2">
                        <Label>产品名称 <span class="text-destructive">*</span></Label>
                        <Input v-model="form.name" placeholder="输入产品名称" />
                    </div>
                    <div class="space-y-2">
                        <Label>产品描述</Label>
                        <Input v-model="form.description" placeholder="输入产品描述" />
                    </div>
                    <div v-if="!isEdit" class="space-y-2">
                        <Label>产品类型 <span class="text-destructive">*</span></Label>
                        <Select v-model="form.type">
                            <SelectTrigger class="w-full">
                                <SelectValue placeholder="选择产品类型" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">会员商品</SelectItem>
                                <SelectItem value="2">积分商品</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <!-- 会员商品字段 -->
                    <template v-if="form.type === '1'">
                        <div class="space-y-2">
                            <Label>会员级别 <span class="text-destructive">*</span></Label>
                            <Select v-model="form.levelId">
                                <SelectTrigger class="w-full">
                                    <SelectValue placeholder="选择会员级别" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem v-for="level in membershipLevels" :key="level.id"
                                        :value="String(level.id)">
                                        {{ level.name }}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div class="space-y-2">
                            <Label>默认售卖周期 <span class="text-destructive">*</span></Label>
                            <Select v-model="form.defaultDuration">
                                <SelectTrigger class="w-full">
                                    <SelectValue placeholder="选择售卖周期" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">按月售卖</SelectItem>
                                    <SelectItem value="2">按年售卖</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <Label>月付价格</Label>
                                <Input v-model.number="form.priceMonthly" type="number" min="0" step="0.01"
                                    placeholder="0.00" />
                            </div>
                            <div class="space-y-2">
                                <Label>年付价格</Label>
                                <Input v-model.number="form.priceYearly" type="number" min="0" step="0.01"
                                    placeholder="0.00" />
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <Label>原月付价格</Label>
                                <Input v-model.number="form.originalPriceMonthly" type="number" min="0" step="0.01"
                                    placeholder="划线价" />
                            </div>
                            <div class="space-y-2">
                                <Label>原年付价格</Label>
                                <Input v-model.number="form.originalPriceYearly" type="number" min="0" step="0.01"
                                    placeholder="划线价" />
                            </div>
                        </div>
                    </template>
                    <!-- 积分商品字段 -->
                    <template v-if="form.type === '2'">
                        <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <Label>积分数量 <span class="text-destructive">*</span></Label>
                                <Input v-model.number="form.pointAmount" type="number" min="1" placeholder="积分数量" />
                            </div>
                            <div class="space-y-2">
                                <Label>单价 <span class="text-destructive">*</span></Label>
                                <Input v-model.number="form.unitPrice" type="number" min="0" step="0.01"
                                    placeholder="0.00" />
                            </div>
                        </div>
                        <div class="space-y-2">
                            <Label>原单价</Label>
                            <Input v-model.number="form.originalUnitPrice" type="number" min="0" step="0.01"
                                placeholder="划线价" />
                        </div>
                    </template>
                    <!-- 通用字段 -->
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <Label>最小购买数量</Label>
                            <Input v-model.number="form.minQuantity" type="number" min="1" placeholder="1" />
                        </div>
                        <div class="space-y-2">
                            <Label>最大购买数量</Label>
                            <Input v-model.number="form.maxQuantity" type="number" min="1" placeholder="不限" />
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <Label>赠送积分</Label>
                            <Input v-model.number="form.giftPoint" type="number" min="0" placeholder="0" />
                        </div>
                        <div class="space-y-2">
                            <Label>购买限制</Label>
                            <Input v-model.number="form.purchaseLimit" type="number" min="0" placeholder="0=不限" />
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <Label>排序值</Label>
                            <Input v-model.number="form.sortOrder" type="number" min="0" placeholder="0" />
                        </div>
                        <div class="space-y-2">
                            <Label>状态</Label>
                            <Select v-model="form.status">
                                <SelectTrigger class="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">上架</SelectItem>
                                    <SelectItem value="0">下架</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
                <DialogFooter class="flex-shrink-0">
                    <Button variant="outline" @click="dialogOpen = false">取消</Button>
                    <Button @click="handleSubmit" :disabled="submitting">
                        <Loader2 v-if="submitting" class="h-4 w-4 mr-2 animate-spin" />
                        {{ isEdit ? '保存' : '创建' }}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

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
    </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, Plus, Loader2, Package, Pencil, Trash2, Eye, EyeOff } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ProductInfo } from '#shared/types/product'

definePageMeta({ layout: false, title: '产品管理' })

// 状态
const loading = ref(false)
const submitting = ref(false)
const deleting = ref(false)
const products = ref<ProductInfo[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const typeFilter = ref('all')
const statusFilter = ref('all')

// 对话框状态
const dialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const isEdit = ref(false)
const selectedProduct = ref<ProductInfo | null>(null)

// 会员级别列表
const membershipLevels = ref<Array<{ id: number; name: string }>>([])

// 表单
const form = ref({
    name: '',
    description: '',
    type: '',
    levelId: '',
    defaultDuration: '',
    priceMonthly: undefined as number | undefined,
    priceYearly: undefined as number | undefined,
    originalPriceMonthly: undefined as number | undefined,
    originalPriceYearly: undefined as number | undefined,
    unitPrice: undefined as number | undefined,
    originalUnitPrice: undefined as number | undefined,
    pointAmount: undefined as number | undefined,
    giftPoint: undefined as number | undefined,
    purchaseLimit: undefined as number | undefined,
    minQuantity: 1 as number | undefined,
    maxQuantity: undefined as number | undefined,
    sortOrder: 0,
    status: '1',
})

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

// 重置表单
const resetForm = () => {
    form.value = {
        name: '',
        description: '',
        type: '',
        levelId: '',
        defaultDuration: '',
        priceMonthly: undefined,
        priceYearly: undefined,
        originalPriceMonthly: undefined,
        originalPriceYearly: undefined,
        unitPrice: undefined,
        originalUnitPrice: undefined,
        pointAmount: undefined,
        giftPoint: undefined,
        purchaseLimit: undefined,
        minQuantity: 1,
        maxQuantity: undefined,
        sortOrder: 0,
        status: '1',
    }
}

// 打开创建对话框
const openCreateDialog = () => {
    isEdit.value = false
    resetForm()
    dialogOpen.value = true
}

// 打开编辑对话框
const openEditDialog = (product: ProductInfo) => {
    isEdit.value = true
    selectedProduct.value = product
    form.value = {
        name: product.name,
        description: product.description || '',
        type: String(product.type),
        levelId: product.levelId ? String(product.levelId) : '',
        defaultDuration: product.defaultDuration ? String(product.defaultDuration) : '',
        priceMonthly: product.priceMonthly ?? undefined,
        priceYearly: product.priceYearly ?? undefined,
        originalPriceMonthly: product.originalPriceMonthly ?? undefined,
        originalPriceYearly: product.originalPriceYearly ?? undefined,
        unitPrice: product.unitPrice ?? undefined,
        originalUnitPrice: product.originalUnitPrice ?? undefined,
        pointAmount: product.pointAmount ?? undefined,
        giftPoint: product.giftPoint ?? undefined,
        purchaseLimit: product.purchaseLimit ?? undefined,
        minQuantity: product.minQuantity ?? 1,
        maxQuantity: product.maxQuantity ?? undefined,
        sortOrder: product.sortOrder,
        status: String(product.status),
    }
    dialogOpen.value = true
}

// 提交表单
const handleSubmit = async () => {
    if (!form.value.name) {
        toast.error('请输入产品名称')
        return
    }
    if (!isEdit.value && !form.value.type) {
        toast.error('请选择产品类型')
        return
    }

    submitting.value = true
    try {
        const body: Record<string, any> = {
            name: form.value.name,
            description: form.value.description || null,
            status: parseInt(form.value.status),
            sortOrder: form.value.sortOrder || 0,
            giftPoint: form.value.giftPoint || null,
            purchaseLimit: form.value.purchaseLimit || null,
            minQuantity: form.value.minQuantity || 1,
            maxQuantity: form.value.maxQuantity || null,
        }

        if (!isEdit.value) {
            body.type = parseInt(form.value.type)
        }

        // 根据类型添加字段
        const type = isEdit.value ? selectedProduct.value?.type : parseInt(form.value.type)
        if (type === 1) {
            body.levelId = form.value.levelId ? parseInt(form.value.levelId) : null
            body.defaultDuration = form.value.defaultDuration ? parseInt(form.value.defaultDuration) : null
            body.priceMonthly = form.value.priceMonthly
            body.priceYearly = form.value.priceYearly
            body.originalPriceMonthly = form.value.originalPriceMonthly
            body.originalPriceYearly = form.value.originalPriceYearly
        } else if (type === 2) {
            body.pointAmount = form.value.pointAmount
            body.unitPrice = form.value.unitPrice
            body.originalUnitPrice = form.value.originalUnitPrice
        }

        let result
        if (isEdit.value && selectedProduct.value) {
            result = await useApiFetch(`/api/v1/admin/products/${selectedProduct.value.id}`, {
                method: 'PUT',
                body,
            })
        } else {
            result = await useApiFetch('/api/v1/admin/products', {
                method: 'POST',
                body,
            })
        }

        if (result) {
            toast.success(isEdit.value ? '保存成功' : '创建成功')
            dialogOpen.value = false
            loadProducts()
        }
    } finally {
        submitting.value = false
    }
}

// 切换状态
const handleToggleStatus = async (product: ProductInfo) => {
    const result = await useApiFetch(`/api/v1/admin/products/${product.id}/status`, { method: 'PATCH' })
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
