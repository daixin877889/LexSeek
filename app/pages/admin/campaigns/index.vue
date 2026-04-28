<template>
        <div class="space-y-6">
            <!-- 页面标题 -->
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl md:text-3xl font-bold mb-1">营销活动管理</h1>
                    <p class="text-muted-foreground text-sm">管理注册赠送、邀请奖励等营销活动</p>
                </div>
                <Button @click="formDialogRef?.openCreate()">
                    <Plus class="h-4 w-4 mr-2" />
                    新增活动
                </Button>
            </div>

            <!-- 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="typeFilter">
                    <SelectTrigger class="w-full md:w-40">
                        <SelectValue placeholder="活动类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem value="1">注册赠送</SelectItem>
                        <SelectItem value="2">邀请奖励</SelectItem>
                        <SelectItem value="3">活动奖励</SelectItem>
                    </SelectContent>
                </Select>
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
                    筛选
                </Button>
            </div>

            <!-- 加载状态 -->
            <div v-if="loading" class="flex justify-center py-12">
                <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
            </div>

            <!-- 空状态 -->
            <div v-else-if="!campaigns.length" class="flex flex-col items-center justify-center py-12 text-center">
                <Megaphone class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">暂无营销活动</h3>
                <p class="text-muted-foreground text-sm">点击上方按钮新增活动</p>
            </div>

            <!-- 活动列表 -->
            <template v-else>
                <!-- 桌面端表格 -->
                <AdminCampaignsCampaignTable :campaigns="campaigns" @edit="formDialogRef?.openEdit($event)"
                    @toggle-status="handleToggleStatus" @delete="handleDelete" />

                <!-- 移动端卡片 -->
                <AdminCampaignsCampaignMobile :campaigns="campaigns" @edit="formDialogRef?.openEdit($event)"
                    @toggle-status="handleToggleStatus" @delete="handleDelete" />

                <!-- 分页 -->
                <GeneralPagination :current-page="pagination.page" :page-size="pagination.pageSize"
                    :total="pagination.total" @change="changePage" />
            </template>
        </div>

        <!-- 创建/编辑对话框 -->
        <AdminCampaignsCampaignFormDialog ref="formDialogRef" :membership-levels="membershipLevels"
            @success="loadCampaigns" />

        <!-- 删除确认对话框 -->
        <AlertDialog v-model:open="deleteDialogOpen">
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>
                        确定要删除活动「{{ selectedCampaign?.name }}」吗？此操作不可撤销。
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
import { Search, Plus, Loader2, Megaphone } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { CampaignInfo } from '#shared/types/campaign'
import AdminCampaignsCampaignFormDialog from '~/components/admin/campaigns/CampaignFormDialog.vue'
import AdminCampaignsCampaignMobile from '~/components/admin/campaigns/CampaignMobile.vue'
import AdminCampaignsCampaignTable from '~/components/admin/campaigns/CampaignTable.vue'
import GeneralPagination from '~/components/general/pagination.vue'
import { useApiFetch } from '~/composables/useApiFetch'
import type { campaigns, membershipLevels } from '~~/generated/prisma/client'

definePageMeta({ layout: 'admin-layout', title: '营销活动管理' })

// 组件引用
const formDialogRef = ref<InstanceType<typeof import('~/components/admin/campaigns/CampaignFormDialog.vue').default> | null>(null)

// 状态
const loading = ref(false)
const deleting = ref(false)
const campaigns = ref<CampaignInfo[]>([])
const pagination = ref({ page: 1, pageSize: 20, total: 0 })
const typeFilter = ref('all')
const statusFilter = ref('all')

// 删除对话框状态
const deleteDialogOpen = ref(false)
const selectedCampaign = ref<CampaignInfo | null>(null)

// 会员级别列表
const membershipLevels = ref<Array<{ id: number; name: string }>>([])

// 加载会员级别
const loadMembershipLevels = async () => {
    const data = await useApiFetch<Array<{ id: number; name: string }>>('/api/v1/memberships/levels')
    if (data) membershipLevels.value = data
}

// 加载活动列表
const loadCampaigns = async () => {
    loading.value = true
    try {
        const params: Record<string, any> = {
            page: pagination.value.page,
            pageSize: pagination.value.pageSize,
        }
        if (typeFilter.value !== 'all') params.type = parseInt(typeFilter.value)
        if (statusFilter.value !== 'all') params.status = parseInt(statusFilter.value)

        const data = await useApiFetch<{ items: CampaignInfo[]; total: number }>('/api/v1/admin/campaigns', { query: params })
        if (data) {
            campaigns.value = data.items
            pagination.value.total = data.total
        }
    } finally {
        loading.value = false
    }
}

// 筛选
const handleSearch = () => {
    pagination.value.page = 1
    loadCampaigns()
}

// 翻页
const changePage = (page: number) => {
    pagination.value.page = page
    loadCampaigns()
}

// 切换状态
const handleToggleStatus = async (campaign: CampaignInfo) => {
    const result = await useApiFetch(`/api/v1/admin/campaigns/status/${campaign.id}`, { method: 'PATCH' })
    if (result) {
        toast.success('状态已更新')
        loadCampaigns()
    }
}

// 删除活动
const handleDelete = (campaign: CampaignInfo) => {
    selectedCampaign.value = campaign
    deleteDialogOpen.value = true
}

const confirmDelete = async () => {
    if (!selectedCampaign.value) return
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/campaigns/${selectedCampaign.value.id}`, { method: 'DELETE' })
        if (result) {
            toast.success('删除成功')
            deleteDialogOpen.value = false
            loadCampaigns()
        }
    } finally {
        deleting.value = false
    }
}

onMounted(() => {
    loadMembershipLevels()
    loadCampaigns()
})
</script>
