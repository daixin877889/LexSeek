<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex items-center gap-4">
                <Button variant="ghost" size="icon" @click="navigateTo('/admin/legal-main')">
                    <ArrowLeft class="h-4 w-4" />
                </Button>
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">编辑法律法规</h1>
                    <p class="text-muted-foreground text-sm">修改法律法规信息</p>
                </div>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 表单 -->
            <LegalMainForm v-else-if="legalData" :initial-data="legalData" @submit="handleSubmit"
                @cancel="navigateTo('/admin/legal-main')" @full-update="handleFullUpdate" />

            <!-- 错误状态 -->
            <div v-else class="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle class="h-12 w-12 text-destructive mb-4" />
                <h3 class="text-lg font-medium mb-1">加载失败</h3>
                <p class="text-muted-foreground text-sm mb-4">无法加载法律法规数据</p>
                <Button @click="navigateTo('/admin/legal-main')">
                    返回列表
                </Button>
            </div>
        </div>
    </NuxtLayout>
</template>

<script setup lang="ts">
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { LegalMainInfo, UpdateLegalMainRequest } from '#shared/types/legal'

definePageMeta({
    layout: false,
    title: "编辑法律法规",
})

const route = useRoute()
const legalId = route.params.id as string

/** 动态面包屑标题（与面包屑组件共享） */
const dynamicBreadcrumbTitle = useState<string | null>('breadcrumb-dynamic-title', () => null)

/** 加载状态 */
const loading = ref(true)

/** 法律法规数据 */
const legalData = ref<LegalMainInfo | null>(null)

/** 加载法律法规详情 */
const loadLegalData = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<LegalMainInfo>(`/api/v1/admin/legal-main/${legalId}`)
        if (data) {
            legalData.value = data
            // 设置动态面包屑标题
            dynamicBreadcrumbTitle.value = data.name
        }
    } finally {
        loading.value = false
    }
}

/** 提交表单 */
const handleSubmit = async (data: UpdateLegalMainRequest) => {
    const result = await useApiFetch(`/api/v1/admin/legal-main/${legalId}`, {
        method: 'PUT',
        body: data,
    })

    if (result) {
        toast.success('更新成功')
        navigateTo('/admin/legal-main')
    }
}

/** 处理全量更新 */
const handleFullUpdate = () => {
    navigateTo(`/admin/legal-main/full-update/${legalId}`)
}

// 初始加载
onMounted(() => {
    loadLegalData()
})

// 页面离开时清除动态标题
onUnmounted(() => {
    dynamicBreadcrumbTitle.value = null
})
</script>
