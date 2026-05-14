<template>
    <div class="space-y-4">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-semibold">LPR 利率</h1>
                <p class="text-muted-foreground text-sm">央行每月 20 日公布；办案利息工具引用此表 1Y / 5Y 数据</p>
            </div>
            <div class="flex gap-2">
                <Button variant="outline" :disabled="syncing" @click="onSync">
                    <RefreshCw class="w-4 h-4 mr-1" :class="syncing && 'animate-spin'" />
                    {{ syncing ? '同步中' : '立即同步' }}
                </Button>
                <Button @click="openCreate">
                    <Plus class="w-4 h-4 mr-1" />新增
                </Button>
            </div>
        </div>

        <Alert v-if="syncResult" :variant="syncResult.success ? 'default' : 'destructive'" class="relative pr-10">
            <CheckCircle2 v-if="syncResult.success" class="text-emerald-600" />
            <XCircle v-else />
            <AlertTitle>{{ syncResult.success ? '同步成功' : '同步失败' }}</AlertTitle>
            <AlertDescription>{{ syncResult.message }}</AlertDescription>
            <button type="button"
                class="absolute right-2 top-2 p-1 rounded-md hover:bg-muted text-muted-foreground"
                @click="syncResult = null">
                <X class="w-4 h-4" />
            </button>
        </Alert>

        <div class="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>生效日</TableHead>
                        <TableHead>1 年期 (%)</TableHead>
                        <TableHead>5 年期以上 (%)</TableHead>
                        <TableHead>备注</TableHead>
                        <TableHead class="text-center">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="row in rows" :key="row.id">
                        <TableCell>{{ row.date }}</TableCell>
                        <TableCell>{{ row.oneYear.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.fiveYear.toFixed(2) }}</TableCell>
                        <TableCell class="text-muted-foreground">{{ row.remark || '—' }}</TableCell>
                        <TableCell class="text-center space-x-2">
                            <Button variant="ghost" size="sm" @click="openEdit(row)">编辑</Button>
                            <Button variant="ghost" size="sm" class="text-destructive"
                                @click="confirmDelete(row)">删除</Button>
                        </TableCell>
                    </TableRow>
                    <TableRow v-if="rows.length === 0">
                        <TableCell colspan="5" class="text-center text-muted-foreground py-8">暂无数据</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>

        <LPRFormDialog v-model:open="dialogOpen" :model="editing" @saved="loadList" />
    </div>
</template>

<script setup lang="ts">
import { Button } from '~/components/ui/button'
import { Alert, AlertTitle, AlertDescription } from '~/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Plus, RefreshCw, CheckCircle2, XCircle, X } from 'lucide-vue-next'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'
import LPRFormDialog from '~/components/admin/rates/LPRFormDialog.vue'
import type { LPRRate } from '#shared/types/tools'

definePageMeta({ layout: 'admin-layout', title: 'LPR 利率' })

interface Row extends LPRRate { id: number; remark?: string }

const rows = ref<Row[]>([])
const dialogOpen = ref(false)
const editing = ref<Row | null>(null)
const syncing = ref(false)
const syncResult = ref<{ success: boolean; message: string } | null>(null)
const alertDialog = useAlertDialogStore()

async function loadList() {
    const data = await useApiFetch<Row[]>('/api/v1/admin/rates/lpr', { method: 'GET' })
    rows.value = data ?? []
}

async function onSync() {
    syncing.value = true
    syncResult.value = null
    try {
        const result = await useApiFetch<{ fetched: number; inserted: number }>(
            '/api/v1/admin/rates/lpr/sync',
            { method: 'POST' },
        )
        if (result) {
            syncResult.value = {
                success: true,
                message: result.inserted > 0
                    ? `拉取到 ${result.fetched} 条 LPR 记录，新增 ${result.inserted} 条`
                    : `拉取到 ${result.fetched} 条 LPR 记录，无新增`,
            }
            await loadList()
        } else {
            syncResult.value = { success: false, message: '同步失败，请稍后重试' }
        }
    } catch (err) {
        syncResult.value = {
            success: false,
            message: err instanceof Error ? err.message : '同步失败',
        }
    } finally {
        syncing.value = false
    }
}

function openCreate() {
    editing.value = null
    dialogOpen.value = true
}

function openEdit(row: Row) {
    editing.value = { ...row }
    dialogOpen.value = true
}

function confirmDelete(row: Row) {
    alertDialog.showErrorDialog({
        title: '删除 LPR 记录',
        message: `确认删除 ${row.date} 的 LPR 数据（1Y=${row.oneYear}%, 5Y=${row.fiveYear}%）？`,
        confirmText: '确认删除',
        onConfirm: async () => {
            await useApiFetch(`/api/v1/admin/rates/lpr/${row.id}`, { method: 'DELETE' })
            await loadList()
        },
    })
}

onMounted(loadList)
</script>
