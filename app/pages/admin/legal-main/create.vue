<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex items-center gap-4">
                <Button variant="ghost" size="icon" @click="navigateTo('/admin/legal-main')">
                    <ArrowLeft class="h-4 w-4" />
                </Button>
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">添加法律法规</h1>
                    <p class="text-muted-foreground text-sm">创建新的法律、法规或司法解释</p>
                </div>
            </div>

            <!-- 表单 -->
            <LegalMainForm @submit="handleSubmit" @cancel="navigateTo('/admin/legal-main')" />
        </div>
</template>

<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { CreateLegalMainRequest } from '#shared/types/legal'

definePageMeta({
    layout: 'admin-layout',
    title: "添加法律法规",
})

/** 提交表单 */
const handleSubmit = async (data: CreateLegalMainRequest) => {
    const result = await useApiFetch('/api/v1/admin/legal-main', {
        method: 'POST',
        body: data,
    })

    if (result) {
        toast.success('创建成功')
        navigateTo('/admin/legal-main')
    }
}
</script>
