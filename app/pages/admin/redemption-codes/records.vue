<template>
    <NuxtLayout name="admin-layout">
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div>
                <h1 class="text-2xl md:text-3xl font-bold mb-1">兑换记录</h1>
                <p class="text-muted-foreground text-sm">查看用户的兑换码使用记录</p>
            </div>

            <!-- 搜索和筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Input v-model="searchCode" placeholder="搜索兑换码..." class="md:max-w-sm" @keyup.enter="handleSearch" />
                <Input v-model="searchUserKeyword" placeholder="用户名/手机号..." class="md:max-w-48"
                    @keyup.enter="handleSearch" />
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
            <div v-else-if="!records.length" class="flex flex-col items-center justify-center py-12 text-center">
                <FileText class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无兑换记录</h3>
                <p class="text-muted-foreground text-sm">还没有用户使用过兑换码</p>
            </div>

            <!-- 兑换记录列表 -->
            <template v-else>
                <!-- 桌面端表格 -->
                <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="border-b bg-muted/50">
                                    <th class="px-4 py-3 text-left text-sm font-medium">用户</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">手机号</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">兑换码</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">类型</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">会员级别</th>
                                    <th class="px-4 py-3 text-center text-sm font-medium">时长/积分</th>
                                    <th class="px-4 py-3 text-left text-sm font-medium">兑换时间</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="record in records" :key="record.id"
                                    class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                                    <td class="px-4 py-3">
                                        <div class="flex items-center gap-2">
                                            <User class="h-4 w-4 text-muted-foreground" />
                                            <span class="font-medium">{{ record.userName || '-' }}</span>
                                        </div>
                                    </td>
                                    <td class="px-4 py-3 text-sm">{{ record.userPhone }}</td>
                                    <td class="px-4 py-3 font-mono text-sm">{{ record.code }}</td>
                                    <td class="px-4 py-3">
                                        <Badge :variant="getTypeVariant(record.type)">{{ record.typeName }}</Badge>
                                    </td>
                                    <td class="px-4 py-3 text-sm">{{ record.levelName || '-' }}</td>
                                    <td class="px-4 py-3 text-center text-sm">
                                        <span v-if="record.duration">{{ record.duration }}天</span>
                                        <span v-if="record.duration && record.pointAmount"> / </span>
                                        <span v-if="record.pointAmount">{{ record.pointAmount }}积分</span>
                                        <span v-if="!record.duration && !record.pointAmount">-</span>
                                    </td>
                                    <td class="px-4 py-3 text-sm text-muted-foreground">{{ record.createdAt }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- 移动端卡片 -->
                <div class="md:hidden space-y-3">
                    <div v-for="record in records" :key="record.id" class="bg-card rounded-lg border p-4 space-y-3">
                        <div class="flex items-start justify-between">
                            <div class="flex items-center gap-2">
                                <User class="h-4 w-4 text-muted-foreground" />
                                <span class="font-medium">{{ record.userName || record.userPhone }}</span>
                            </div>
                            <Badge :variant="getTypeVariant(record.type)">{{ record.typeName }}</Badge>
                        </div>
                        <div class="text-sm text-muted-foreground">{{ record.userPhone }}</div>
                        <div class="font-mono text-sm">{{ record.code }}</div>
                        <div class="flex flex-wrap gap-2">
                            <span v-if="record.levelName" class="text-sm text-muted-foreground">{{ record.levelName
                            }}</span>
                            <span class="text-sm">
                                <span v-if="record.duration">{{ record.duration }}天</span>
                                <span v-if="record.duration && record.pointAmount"> / </span>
                                <span v-if="record.pointAmount">{{ record.pointAmount }}积分</span>
                            </span>
                        </div>
                        <div class="text-xs text-muted-foreground">兑换于 {{ record.createdAt }}</div>
                    </div>
                </div>

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>
    </NuxtLayout>
</template>

<script setup lang="ts">
import { Search, Loader2, FileText, User } from 'lucide-vue-next'
import type { RedemptionRecordAdminInfo } from '#shared/types/redemption'

definePageMeta({ layout: false, title: '兑换记录' })

// 状态
const loading = ref(false)
const records = ref<RedemptionRecordAdminInfo[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const searchCode = ref('')
const searchUserKeyword = ref('')

// 获取类型样式
const getTypeVariant = (type: number) => {
    const variants: Record<number, 'default' | 'secondary' | 'outline'> = {
        1: 'default',
        2: 'secondary',
        3: 'outline',
    }
    return variants[type] || 'default'
}

// 加载兑换记录
const loadRecords = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (searchCode.value) params.code = searchCode.value
        if (searchUserKeyword.value) params.userKeyword = searchUserKeyword.value

        const data = await useApiFetch<{
            items: RedemptionRecordAdminInfo[]
            total: number
            totalPages: number
        }>('/api/v1/admin/redemption-codes/records', { query: params })

        if (data) {
            records.value = data.items
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
    loadRecords()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadRecords()
}

onMounted(() => {
    loadRecords()
})
</script>
