<template>
    <div class="space-y-4">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-semibold">PBOC 贷款基准利率</h1>
                <p class="text-muted-foreground text-sm">人民银行公布的贷款基准利率，办案利息计算工具引用此表数据</p>
            </div>
            <Button @click="openCreate">
                <Plus class="w-4 h-4 mr-1" />新增
            </Button>
        </div>

        <Card>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>生效日</TableHead>
                        <TableHead>六月 (%)</TableHead>
                        <TableHead>一年 (%)</TableHead>
                        <TableHead>一至五年 (%)</TableHead>
                        <TableHead>五年以上 (%)</TableHead>
                        <TableHead>备注</TableHead>
                        <TableHead class="text-right">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="row in rows" :key="row.id">
                        <TableCell>{{ row.date }}</TableCell>
                        <TableCell>{{ row.sixMonths.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.oneYear.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.oneToFiveYear.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.fiveYear.toFixed(2) }}</TableCell>
                        <TableCell class="text-muted-foreground">{{ row.remark || '—' }}</TableCell>
                        <TableCell class="text-right space-x-2">
                            <Button variant="ghost" size="sm" @click="openEdit(row)">编辑</Button>
                            <Button variant="ghost" size="sm" class="text-destructive" @click="confirmDelete(row)">删除</Button>
                        </TableCell>
                    </TableRow>
                    <TableRow v-if="rows.length === 0">
                        <TableCell colspan="7" class="text-center text-muted-foreground py-8">暂无数据</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </Card>

        <PbocLoanFormDialog v-model:open="dialogOpen" :model="editing" @saved="loadList" />
    </div>
</template>

<script setup lang="ts">
import { Card } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Plus } from 'lucide-vue-next'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'
import PbocLoanFormDialog from '~/components/admin/rates/PbocLoanFormDialog.vue'
import type { LoanRate } from '#shared/types/tools'

definePageMeta({ layout: 'admin-layout' })

interface Row extends LoanRate { id: number; remark?: string }

const rows = ref<Row[]>([])
const dialogOpen = ref(false)
const editing = ref<Row | null>(null)
const alertDialog = useAlertDialogStore()

async function loadList() {
    const data = await useApiFetch<Row[]>('/api/v1/admin/rates/pboc-loan', { method: 'GET' })
    rows.value = data ?? []
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
        title: '删除贷款利率记录',
        message: `确认删除 ${row.date} 的 PBOC 贷款基准利率数据（1Y=${row.oneYear}%）？`,
        confirmText: '确认删除',
        onConfirm: async () => {
            await useApiFetch(`/api/v1/admin/rates/pboc-loan/${row.id}`, { method: 'DELETE' })
            await loadList()
        },
    })
}

onMounted(loadList)
</script>
