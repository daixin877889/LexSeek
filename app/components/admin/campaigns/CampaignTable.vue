<template>
    <!-- 桌面端营销活动表格 -->
    <div class="bg-card rounded-lg border overflow-hidden hidden md:block">
        <div class="overflow-x-auto">
            <table class="w-full">
                <thead>
                    <tr class="border-b bg-muted/50">
                        <th class="px-4 py-3 text-left text-sm font-medium">活动名称</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">类型</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">奖励内容</th>
                        <th class="px-4 py-3 text-left text-sm font-medium">活动时间</th>
                        <th class="px-4 py-3 text-center text-sm font-medium">状态</th>
                        <th class="px-4 py-3 text-center text-sm font-medium w-32">操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="campaign in campaigns" :key="campaign.id"
                        class="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                        <td class="px-4 py-3">
                            <div class="font-medium">{{ campaign.name }}</div>
                            <div v-if="campaign.remark" class="text-xs text-muted-foreground truncate max-w-48">
                                {{ campaign.remark }}
                            </div>
                        </td>
                        <td class="px-4 py-3">
                            <Badge :variant="getTypeVariant(campaign.type)">
                                {{ getTypeName(campaign.type) }}
                            </Badge>
                        </td>
                        <td class="px-4 py-3 text-sm">
                            <div v-if="campaign.levelName">
                                会员: {{ campaign.levelName }}
                                <span v-if="campaign.duration">({{ campaign.duration }}天)</span>
                            </div>
                            <div v-if="campaign.giftPoint">积分: {{ campaign.giftPoint }}</div>
                            <span v-if="!campaign.levelName && !campaign.giftPoint">-</span>
                        </td>
                        <td class="px-4 py-3 text-sm">
                            <div>开始: {{ campaign.startAt }}</div>
                            <div>结束: {{ campaign.endAt || '长期有效' }}</div>
                        </td>
                        <td class="px-4 py-3 text-center">
                            <Badge :variant="campaign.status === 1 ? 'default' : 'outline'">
                                {{ campaign.status === 1 ? '启用' : '禁用' }}
                            </Badge>
                        </td>
                        <td class="px-4 py-3 text-center">
                            <div class="flex items-center justify-center gap-1">
                                <Button variant="ghost" size="sm" @click="$emit('edit', campaign)">
                                    <Pencil class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" @click="$emit('toggle-status', campaign)">
                                    <component :is="campaign.status === 1 ? Pause : Play" class="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" @click="$emit('delete', campaign)">
                                    <Trash2 class="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Pencil, Trash2, Play, Pause } from 'lucide-vue-next'
import type { CampaignInfo } from '#shared/types/campaign'

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

// 获取类型样式
const getTypeVariant = (type: number) => {
    const variants: Record<number, 'default' | 'secondary' | 'outline'> = { 1: 'default', 2: 'secondary', 3: 'outline' }
    return variants[type] || 'default'
}
</script>
