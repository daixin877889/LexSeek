<template>
    <!-- 移动端营销活动卡片列表 -->
    <div class="md:hidden space-y-3">
        <div v-for="campaign in campaigns" :key="campaign.id" class="bg-card rounded-lg border p-4 space-y-3">
            <div class="flex items-start justify-between">
                <div>
                    <div class="font-medium">{{ campaign.name }}</div>
                    <div v-if="campaign.remark" class="text-xs text-muted-foreground">
                        {{ campaign.remark }}
                    </div>
                </div>
                <Badge variant="outline" :class="getAdminStatusBadgeClass(campaign.status === 1)">
                    {{ campaign.status === 1 ? '启用' : '禁用' }}
                </Badge>
            </div>
            <div class="flex flex-wrap gap-2">
                <Badge variant="outline" :class="getAdminCampaignTypeBadgeClass(campaign.type)">
                    {{ getTypeName(campaign.type) }}
                </Badge>
            </div>
            <div class="text-sm">
                <div v-if="campaign.levelName">
                    会员: {{ campaign.levelName }}
                    <span v-if="campaign.duration">({{ campaign.duration }}天)</span>
                </div>
                <div v-if="campaign.giftPoint">积分: {{ campaign.giftPoint }}</div>
            </div>
            <div class="text-xs text-muted-foreground">
                {{ campaign.startAt }} ~ {{ campaign.endAt || '长期有效' }}
            </div>
            <div class="pt-2 border-t flex gap-2">
                <Button variant="outline" size="sm" :class="['flex-1', adminBrandFocusClass]"
                    @click="$emit('edit', campaign)">
                    <Pencil class="h-3 w-3 mr-1" />
                    编辑
                </Button>
                <Button variant="outline" size="sm" :class="adminBrandFocusClass"
                    :aria-label="campaign.status === 1 ? '禁用活动' : '启用活动'" @click="$emit('toggle-status', campaign)">
                    <component :is="campaign.status === 1 ? Pause : Play" class="h-3 w-3" />
                </Button>
                <Button variant="outline" size="sm"
                    :class="['text-destructive hover:text-destructive', adminBrandFocusClass]"
                    aria-label="删除活动" @click="$emit('delete', campaign)">
                    <Trash2 class="h-3 w-3" />
                </Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Pencil, Trash2, Play, Pause } from 'lucide-vue-next'
import type { CampaignInfo } from '#shared/types/campaign'
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
