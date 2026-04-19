<script setup lang="ts">
import { SparklesIcon, HistoryIcon } from 'lucide-vue-next'
import dayjs from 'dayjs'
import type { DocumentDraftSnapshot } from '#shared/types/document'

defineProps<{
    snapshots: DocumentDraftSnapshot[]
}>()

const emit = defineEmits<{
    viewDetail: [snapshot: DocumentDraftSnapshot]
}>()

function formatTime(iso: string) {
    return dayjs(iso).format('YYYY-MM-DD HH:mm')
}
</script>

<template>
    <div>
        <div class="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground mb-2">
            自动快照最多保留 10 条，新快照产生时会清理最早一条
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
                    <div class="text-xs text-muted-foreground">{{ formatTime(s.createdAt) }}</div>
                </div>
                <Button size="sm" variant="ghost" @click="emit('viewDetail', s)">查看详情</Button>
            </li>
        </ul>
    </div>
</template>
