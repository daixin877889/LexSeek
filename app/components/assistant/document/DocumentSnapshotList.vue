<script setup lang="ts">
import { SparklesIcon, HistoryIcon, InfoIcon } from 'lucide-vue-next'
import type { DocumentDraftSnapshot } from '#shared/types/document'
import { formatDate } from '~/utils/formatDate'

defineProps<{
    snapshots: DocumentDraftSnapshot[]
}>()

const emit = defineEmits<{
    viewDetail: [snapshot: DocumentDraftSnapshot]
}>()
</script>

<template>
    <div>
        <div class="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 mb-3 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <InfoIcon class="size-4 shrink-0 mt-0.5" />
            <span>最多保留 10 条快照，超出后新快照会覆盖最早的一条</span>
        </div>
        <div v-if="!snapshots.length" class="text-sm text-muted-foreground p-6 text-center">
            还没有 AI 生成或覆盖记录
        </div>
        <ul v-else class="divide-y">
            <li v-for="s in snapshots" :key="s.id" class="p-3 flex items-start gap-2">
                <SparklesIcon v-if="s.source === 'ai-extract'" class="size-4 text-primary mt-0.5" />
                <HistoryIcon v-else class="size-4 text-muted-foreground mt-0.5" />
                <div class="flex-1 min-w-0">
                    <div class="text-sm">
                        {{ s.source === 'ai-extract' ? 'AI 生成' : '覆盖前自动备份' }}
                        <span v-if="s.aiTitle" class="text-muted-foreground">· {{ s.aiTitle }}</span>
                    </div>
                    <div class="text-xs text-muted-foreground">{{ formatDate(s.createdAt, 'YYYY-MM-DD HH:mm') }}</div>
                </div>
                <Button size="sm" variant="ghost" @click="emit('viewDetail', s)">查看详情</Button>
            </li>
        </ul>
    </div>
</template>
