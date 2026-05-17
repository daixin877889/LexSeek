<template>
    <!-- 桌面端营销活动表格 -->
    <div class="hidden overflow-hidden rounded-lg border bg-card md:block">
        <div class="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow class="bg-muted/50 hover:bg-muted/50">
                        <TableHead class="px-4 py-3">活动名称</TableHead>
                        <TableHead class="px-4 py-3">类型</TableHead>
                        <TableHead class="px-4 py-3">奖励内容</TableHead>
                        <TableHead class="px-4 py-3">活动时间</TableHead>
                        <TableHead class="px-4 py-3 text-center">状态</TableHead>
                        <TableHead class="w-32 px-4 py-3 text-center">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="campaign in campaigns" :key="campaign.id" class="hover:bg-muted/30">
                        <TableCell class="px-4 py-3">
                            <div class="font-medium">{{ campaign.name }}</div>
                            <div v-if="campaign.remark" class="text-xs text-muted-foreground truncate max-w-48">
                                {{ campaign.remark }}
                            </div>
                        </TableCell>
                        <TableCell class="px-4 py-3">
                            <Badge variant="outline" :class="getAdminCampaignTypeBadgeClass(campaign.type)">
                                {{ getTypeName(campaign.type) }}
                            </Badge>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-sm">
                            <div v-if="campaign.levelName">
                                会员: {{ campaign.levelName }}
                                <span v-if="campaign.duration">({{ campaign.duration }}天)</span>
                            </div>
                            <div v-if="campaign.giftPoint">积分: {{ campaign.giftPoint }}</div>
                            <span v-if="!campaign.levelName && !campaign.giftPoint">-</span>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-sm">
                            <div>开始: {{ campaign.startAt }}</div>
                            <div>结束: {{ campaign.endAt || '长期有效' }}</div>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-center">
                            <Badge variant="outline" :class="getAdminStatusBadgeClass(campaign.status === 1)">
                                {{ campaign.status === 1 ? '启用' : '禁用' }}
                            </Badge>
                        </TableCell>
                        <TableCell class="px-4 py-3 text-center">
                            <div class="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="sm" :class="adminBrandFocusClass" aria-label="编辑活动"
                                    @click="$emit('edit', campaign)">
                                    <Pencil class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" :class="adminBrandFocusClass"
                                    :aria-label="campaign.status === 1 ? '禁用活动' : '启用活动'"
                                    @click="$emit('toggle-status', campaign)">
                                    <component :is="campaign.status === 1 ? Pause : Play" class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm"
                                    :class="['text-destructive hover:text-destructive', adminBrandFocusClass]"
                                    aria-label="删除活动" @click="$emit('delete', campaign)">
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
import { Pencil, Trash2, Play, Pause } from 'lucide-vue-next'
import type { CampaignInfo } from '#shared/types/campaign'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import {
    adminBrandFocusClass,
    getAdminCampaignTypeBadgeClass,
    getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

// 定义 props
defineProps<{
    campaigns: CampaignInfo[]
}>()

// 定义事件
defineEmits<{
    edit: [campaign: CampaignInfo]
    'toggle-status': [campaign: CampaignInfo]
    delete: [campaign: CampaignInfo]
}>()

// 获取类型名称
const getTypeName = (type: number) => {
    const names: Record<number, string> = { 1: '注册赠送', 2: '邀请奖励', 3: '活动奖励' }
    return names[type] || '未知'
}

</script>
