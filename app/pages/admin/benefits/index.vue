<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">权益类型管理</h1>
                    <p class="text-muted-foreground text-sm">管理系统中的权益类型定义</p>
                </div>
                <Button @click="openCreateDialog">
                    <Plus class="h-4 w-4 mr-2" />
                    新增权益
                </Button>
            </div>

            <!-- 搜索和筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Input v-model="keyword" placeholder="搜索权益名称或标识码..." class="md:max-w-xs" @keyup.enter="handleSearch" />
                <Select v-model="statusFilter">
                    <SelectTrigger class="w-full md:w-32">
                        <SelectValue placeholder="状态" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="1">启用</SelectItem>
                        <SelectItem value="0">禁用</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline" @click="handleSearch">
                    <Search class="h-4 w-4 mr-2" />
                    搜索
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!benefits.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Gift class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无权益类型</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增权益类型</p>
            </div>

            <!-- 权益列表 -->
            <template v-else>
                <div class="bg-card rounded-lg border overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="border-b bg-muted/50">
                                    <th class="px-4 py-3 text-left text-sm font-medium">名称</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">标识码</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium">单位类型</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium">计算模式</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium">默认值</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium w-32">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="benefit in benefits" :key="benefit.id"
                                    class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                                    <td class="px-4 py-3">
                                        <div class="font-medium">{{ benefit.name }}</div>
                                        <div v-if="benefit.description" class="text-xs text-muted-foreground">
                                            {{ benefit.description }}
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 font-mono text-sm">{{ benefit.code }}</td>
                                    <td class="px-4 py-3 text-center text-sm">{{ benefit.unitTypeName }}</td>
                                    <td class="px-4 py-3 text-center text-sm">{{ benefit.consumptionModeName }}</td>
                                    <td class="px-4 py-3 text-center text-sm">{{ benefit.formattedDefaultValue }}</td>
                                    <td class="px-4 py-3 text-center">
                                        <Badge :variant="benefit.status === 1 ? 'default' : 'secondary'">
                                            {{ benefit.statusName }}
                                        </Badge>
                                    </td>
                                    <td class="px-4 py-3 text-center">
                                        <div class="flex items-center justify-center gap-1">
                                            <Button variant="ghost" size="sm" @click="openEditDialog(benefit)">
                                                <Pencil class="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" @click="handleToggleStatus(benefit)">
                                                <Power class="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" @click="handleDelete(benefit)">
                                                <Trash2 class="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 新增/编辑对话框 -->
        <Dialog v-model:open="dialogOpen">
            <DialogContent class="max-w-md">
                <DialogHeader>
                    <DialogTitle>{{ isEdit ? '编辑权益' : '新增权益' }}</DialogTitle>
                    <DialogDescription>{{ isEdit ? '修改权益类型信息' : '创建新的权益类型' }}</DialogDescription>
                </DialogHeader>
                <div class="space-y-4 py-4">
                    <div class="space-y-2">
                        <Label>权益名称 <span class="text-destructive">*</span></Label>
                        <Input v-model="form.name" placeholder="如：云盘空间" />
                    </div>
                    <div class="space-y-2">
                        <Label>标识码 <span class="text-destructive">*</span></Label>
                        <Input v-model="form.code" placeholder="如：storage_space" :disabled="isEdit" />
                        <p class="text-xs text-muted-foreground">只能包含小写字母、数字和下划线，以字母开头</p>
                    </div>
                    <div class="space-y-2">
                        <Label>描述</Label>
                        <Input v-model="form.description" placeholder="权益描述（可选）" />
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2">
                            <Label>单位类型 <span class="text-destructive">*</span></Label>
                            <Select v-model="form.unitType">
                                <SelectTrigger>
                                    <SelectValue placeholder="选择单位" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="byte">字节</SelectItem>
                                    <SelectItem value="count">次数</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div class="space-y-2">
                            <Label>计算模式 <span class="text-destructive">*</span></Label>
                            <Select v-model="form.consumptionMode">
                                <SelectTrigger>
                                    <SelectValue placeholder="选择模式" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="sum">累加</SelectItem>
                                    <SelectItem value="max">取最大值</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div class="space-y-2">
                        <Label>默认值 <span class="text-destructive">*</span></Label>
                        <div class="flex gap-2">
                            <Input v-model.number="defaultValueInput" type="number" min="0" class="flex-1" />
                            <Select v-model="defaultValueUnit" class="w-24" v-if="form.unitType === 'byte'">
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="B">B</SelectItem>
                                    <SelectItem value="KB">KB</SelectItem>
                                    <SelectItem value="MB">MB</SelectItem>
                                    <SelectItem value="GB">GB</SelectItem>
                                    <SelectItem value="TB">TB</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <p v-if="form.unitType === 'byte'" class="text-xs text-muted-foreground">
                            = {{ formatByteSize(computedDefaultValue) }}
                        </p>
                    </div>
                </div>
                <DialogFooter>
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
                        确定要删除权益「{{ selectedBenefit?.name }}」吗？此操作不可撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction @click="confirmDelete" :disabled="deleting"
                        class="bg-destructive text-white hover:bg-destructive/90">
                        <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                        确认删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, Plus, Loader2, Gift, Pencil, Power, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { BenefitAdminInfo } from '#shared/types/benefit'
import { formatByteSize } from '#shared/utils/unitConverision'

definePageMeta({ layout: false, title: '权益类型管理' })

// 状态
const loading = ref(false)
const submitting = ref(false)
const deleting = ref(false)
const benefits = ref<BenefitAdminInfo[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const keyword = ref('')
const statusFilter = ref('all')

// 对话框状态
const dialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const isEdit = ref(false)
const selectedBenefit = ref<BenefitAdminInfo | null>(null)

// 表单数据
const form = ref({
    name: '',
    code: '',
    description: '',
    unitType: 'byte',
    consumptionMode: 'sum',
})
const defaultValueInput = ref(1)
const defaultValueUnit = ref('GB')

// 计算默认值（字节）
const computedDefaultValue = computed(() => {
    const value = defaultValueInput.value || 0
    const multipliers: Record<string, number> = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
        TB: 1024 * 1024 * 1024 * 1024,
    }
    return value * (multipliers[defaultValueUnit.value] || 1)
})

// 加载权益列表
const loadBenefits = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (keyword.value) params.keyword = keyword.value
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)

        const data = await useApiFetch<{
            items: BenefitAdminInfo[]
            total: number
            totalPages: number
        }>('/api/v1/admin/benefits', { query: params })

        if (data) {
            benefits.value = data.items
            pagination.value.total = data.total
            pagination.value.totalPages = data.totalPages
        }
    } finally {
        loading.value = false
    }
}

// 搜索
const handleSearch = () => {
    pagination.value.page = 1
    loadBenefits()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadBenefits()
}

// 打开新增对话框
const openCreateDialog = () => {
    isEdit.value = false
    selectedBenefit.value = null
    form.value = {
        name: '',
        code: '',
        description: '',
        unitType: 'byte',
        consumptionMode: 'sum',
    }
    defaultValueInput.value = 1
    defaultValueUnit.value = 'GB'
    dialogOpen.value = true
}

// 打开编辑对话框
const openEditDialog = (benefit: BenefitAdminInfo) => {
    isEdit.value = true
    selectedBenefit.value = benefit
    form.value = {
        name: benefit.name,
        code: benefit.code,
        description: benefit.description || '',
        unitType: benefit.unitType,
        consumptionMode: benefit.consumptionMode,
    }
    // 解析默认值
    const defaultBytes = BigInt(benefit.defaultValue)
    if (benefit.unitType === 'byte') {
        // 自动选择合适的单位
        if (defaultBytes >= BigInt(1024 * 1024 * 1024 * 1024)) {
            defaultValueInput.value = Number(defaultBytes / BigInt(1024 * 1024 * 1024 * 1024))
            defaultValueUnit.value = 'TB'
        } else if (defaultBytes >= BigInt(1024 * 1024 * 1024)) {
            defaultValueInput.value = Number(defaultBytes / BigInt(1024 * 1024 * 1024))
            defaultValueUnit.value = 'GB'
        } else if (defaultBytes >= BigInt(1024 * 1024)) {
            defaultValueInput.value = Number(defaultBytes / BigInt(1024 * 1024))
            defaultValueUnit.value = 'MB'
        } else if (defaultBytes >= BigInt(1024)) {
            defaultValueInput.value = Number(defaultBytes / BigInt(1024))
            defaultValueUnit.value = 'KB'
        } else {
            defaultValueInput.value = Number(defaultBytes)
            defaultValueUnit.value = 'B'
        }
    } else {
        defaultValueInput.value = Number(defaultBytes)
    }
    dialogOpen.value = true
}

// 提交表单
const handleSubmit = async () => {
    if (!form.value.name) {
        toast.error('请输入权益名称')
        return
    }
    if (!form.value.code) {
        toast.error('请输入标识码')
        return
    }
    if (!form.value.unitType) {
        toast.error('请选择单位类型')
        return
    }
    if (!form.value.consumptionMode) {
        toast.error('请选择计算模式')
        return
    }

    submitting.value = true
    try {
        const body = {
            ...form.value,
            defaultValue: computedDefaultValue.value.toString(),
        }

        if (isEdit.value && selectedBenefit.value) {
            const result = await useApiFetch(`/api/v1/admin/benefits/${selectedBenefit.value.id}`, {
                method: 'PUT',
                body,
            })
            if (result) {
                toast.success('更新成功')
                dialogOpen.value = false
                loadBenefits()
            }
        } else {
            const result = await useApiFetch('/api/v1/admin/benefits', {
                method: 'POST',
                body,
            })
            if (result) {
                toast.success('创建成功')
                dialogOpen.value = false
                loadBenefits()
            }
        }
    } finally {
        submitting.value = false
    }
}

// 切换状态
const handleToggleStatus = async (benefit: BenefitAdminInfo) => {
    const newStatus = benefit.status === 1 ? 0 : 1
    const result = await useApiFetch(`/api/v1/admin/benefits/${benefit.id}/status`, {
        method: 'PUT',
        body: { status: newStatus },
    })
    if (result) {
        toast.success(newStatus === 1 ? '已启用' : '已禁用')
        loadBenefits()
    }
}

// 删除权益
const handleDelete = (benefit: BenefitAdminInfo) => {
    selectedBenefit.value = benefit
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedBenefit.value) return

    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/benefits/${selectedBenefit.value.id}`, {
            method: 'DELETE',
        })
        if (result) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadBenefits()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadBenefits()
})
</script>
