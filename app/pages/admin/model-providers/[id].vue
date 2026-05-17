<template>
        <div class="theme-brand space-y-6">
            <!-- 面包屑导航 -->
            <Breadcrumb>
                <BreadcrumbList>
                    <BreadcrumbItem>
                        <BreadcrumbLink :class="['rounded-sm', adminBrandFocusClass]" @click="navigateTo('/admin/model-providers')">
                            模型提供商
                        </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                        <BreadcrumbPage>{{ provider?.name || '详情' }}</BreadcrumbPage>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 提供商不存在 -->
            <div v-else-if="!provider" class="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">提供商不存在</h3>
                <p class="text-muted-foreground text-sm">请检查 URL 是否正确</p>
            </div>

            <!-- 提供商详情 -->
            <template v-else>
                <!-- 提供商基本信息卡片 -->
                <Card class="shadow-none">
                    <CardHeader>
                        <div class="flex justify-between items-start">
                            <div>
                                <CardTitle class="text-2xl">{{ provider.name }}</CardTitle>
                                <CardDescription class="mt-1">
                                    {{ provider.description || '暂无描述' }}
                                </CardDescription>
                            </div>
                            <Button :class="adminBrandPrimaryButtonClass" @click="editProvider">
                                <Pencil class="h-4 w-4 mr-2" />
                                编辑提供商
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <Label class="text-sm font-medium text-muted-foreground">API 基础 URL</Label>
                                <p class="text-sm mt-1 font-mono bg-muted px-2 py-1 rounded">{{ provider.baseUrl }}</p>
                            </div>
                            <div>
                                <Label class="text-sm font-medium text-muted-foreground">创建时间</Label>
                                <p class="text-sm mt-1">{{ formatDate(provider.createdAt) }}</p>
                            </div>
                            <div>
                                <Label class="text-sm font-medium text-muted-foreground">最后更新</Label>
                                <p class="text-sm mt-1">{{ formatDate(provider.updatedAt) }}</p>
                            </div>
                            <div>
                                <Label class="text-sm font-medium text-muted-foreground">提供商 ID</Label>
                                <p class="text-sm mt-1 font-mono">{{ provider.id }}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <!-- API 密钥管理区域 -->
                <ApiKeySection :provider-id="provider.id" />

                <!-- 模型管理区域 -->
                <AdminModelProvidersModelSection :provider-id="provider.id" />
            </template>
        </div>

        <!-- 编辑提供商对话框 -->
        <ProviderFormDialog ref="formDialogRef" @success="loadProvider" />
</template>

<script setup lang="ts">
import { Loader2, AlertCircle, Pencil } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { ModelProvider } from '#shared/types/model'
import dayjs from 'dayjs'

// 导入组件
import ApiKeySection from '~/components/admin/model-providers/ApiKeySection.vue'
import AdminModelProvidersModelSection from '~/components/admin/model-providers/ModelSection.vue'
import ProviderFormDialog from '~/components/admin/model-providers/ProviderFormDialog.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import { adminBrandFocusClass, adminBrandPrimaryButtonClass } from '~/utils/adminBrandStyles'

definePageMeta({ layout: 'admin-layout', title: '提供商详情' })

// 路由参数
const route = useRoute()
const providerId = computed(() => Number(route.params.id))

// 组件引用
const formDialogRef = ref<InstanceType<typeof ProviderFormDialog> | null>(null)

// 状态
const loading = ref(false)
const provider = ref<ModelProvider | null>(null)

// 格式化日期
const formatDate = (date: string | Date | null) => {
    if (!date) return '-'
    return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}

// 加载提供商详情
const loadProvider = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<ModelProvider>(`/api/v1/admin/model-providers/${providerId.value}`)
        if (data) {
            provider.value = data
        }
    } finally {
        loading.value = false
    }
}

// 编辑提供商
const editProvider = () => {
    if (provider.value) {
        formDialogRef.value?.openEdit(provider.value)
    }
}

onMounted(() => {
    loadProvider()
})
</script>
