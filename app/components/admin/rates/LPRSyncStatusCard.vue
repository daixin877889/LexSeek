<template>
    <Card>
        <CardContent class="py-4">
            <div class="flex items-center justify-between gap-4">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                        <RefreshCw class="w-4 h-4 text-primary" />
                        <span class="font-medium">LPR 数据同步</span>
                    </div>
                    <p v-if="!log" class="text-sm text-muted-foreground">
                        尚未同步过 — 点击右侧按钮立即拉取最新数据
                    </p>
                    <p v-else-if="log.status === 'success'" class="text-sm text-muted-foreground">
                        上次同步：{{ relativeTime(log.startedAt) }} ·
                        <span class="text-emerald-600">成功</span> ·
                        拉到 {{ log.fetchedCount }} 条 ·
                        本次新增 <strong class="text-foreground">{{ log.insertedCount }}</strong> 条
                    </p>
                    <p v-else-if="log.status === 'failure'" class="text-sm">
                        <span class="text-destructive">失败</span>（{{ relativeTime(log.startedAt) }}）：
                        <span class="text-muted-foreground">{{ log.errorMessage }}</span>
                    </p>
                    <p v-else class="text-sm text-muted-foreground">
                        正在同步中（{{ relativeTime(log.startedAt) }} 开始）
                    </p>
                </div>
                <Button :disabled="syncing" @click="onSync">
                    <RefreshCw class="w-4 h-4 mr-1" :class="syncing && 'animate-spin'" />
                    {{ syncing ? '同步中' : '立即同步' }}
                </Button>
            </div>
        </CardContent>
    </Card>
</template>

<script setup lang="ts">
import { Card, CardContent } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { RefreshCw } from 'lucide-vue-next'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'
import dayjs from 'dayjs'
import relativeTimePlugin from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTimePlugin)
dayjs.locale('zh-cn')

const emit = defineEmits<{ synced: [] }>()

interface SyncLog {
    id: number
    startedAt: string
    finishedAt: string | null
    status: 'running' | 'success' | 'failure'
    triggeredBy: 'auto' | 'manual'
    fetchedCount: number
    insertedCount: number
    errorMessage?: string | null
}

const log = ref<SyncLog | null>(null)
const syncing = ref(false)
const alertDialog = useAlertDialogStore()

async function loadStatus() {
    log.value = await useApiFetch<SyncLog | null>('/api/v1/admin/rates/lpr/sync-status', { method: 'GET' })
}

async function onSync() {
    syncing.value = true
    try {
        const result = await useApiFetch<{ fetched: number; inserted: number }>(
            '/api/v1/admin/rates/lpr/sync',
            { method: 'POST' },
        )
        await loadStatus()
        emit('synced')
        if (result) {
            alertDialog.showSuccessDialog({
                title: '同步成功',
                message: result.inserted > 0
                    ? `拉取到 ${result.fetched} 条 LPR 记录，新增 ${result.inserted} 条`
                    : `拉取到 ${result.fetched} 条 LPR 记录，无新增`,
                showCancel: false,
            })
        }
    } finally {
        syncing.value = false
    }
}

function relativeTime(iso: string): string {
    return dayjs(iso).fromNow()
}

onMounted(loadStatus)
</script>
