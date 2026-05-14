<template>
    <div class="space-y-4">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-semibold">央行存款基准利率</h1>
                <p class="text-muted-foreground text-sm">人民银行公布的存款基准利率，办案利息计算工具引用此表数据</p>
            </div>
            <Button @click="openCreate">
                <Plus class="w-4 h-4 mr-1" />新增
            </Button>
        </div>

        <div class="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>生效日</TableHead>
                        <TableHead>活期 (%)</TableHead>
                        <TableHead>三月 (%)</TableHead>
                        <TableHead>六月 (%)</TableHead>
                        <TableHead>一年 (%)</TableHead>
                        <TableHead>二年 (%)</TableHead>
                        <TableHead>三年 (%)</TableHead>
                        <TableHead>五年 (%)</TableHead>
                        <TableHead>备注</TableHead>
                        <TableHead class="w-[80px] text-right">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="row in rows" :key="row.id">
                        <TableCell>{{ row.date }}</TableCell>
                        <TableCell>{{ row.demand.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.threeMonths.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.sixMonths.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.oneYear.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.twoYear.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.threeYear.toFixed(2) }}</TableCell>
                        <TableCell>{{ row.fiveYear.toFixed(2) }}</TableCell>
                        <TableCell class="text-muted-foreground">{{ row.remark || '—' }}</TableCell>
                        <TableCell class="text-right">
                            <DropdownMenu>
                                <DropdownMenuTrigger as-child>
                                    <Button variant="ghost" size="icon">
                                        <MoreHorizontal class="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem @click="openEdit(row)">
                                        <Pencil class="h-4 w-4 mr-2" />
                                        编辑
                                    </DropdownMenuItem>
                                    <DropdownMenuItem class="text-destructive" @click="confirmDelete(row)">
                                        <Trash2 class="h-4 w-4 mr-2" />
                                        删除
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </TableCell>
                    </TableRow>
                    <TableRow v-if="rows.length === 0">
                        <TableCell colspan="10" class="text-center text-muted-foreground py-8">暂无数据</TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>

        <PbocDepositFormDialog v-model:open="dialogOpen" :model="editing" @saved="loadList" />
    </div>
</template>

<script setup lang="ts">
import { Button } from '~/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-vue-next'
import { useApiFetch } from '~/composables/useApiFetch'
import { useAlertDialogStore } from '~/store/alertDialog'
import PbocDepositFormDialog from '~/components/admin/rates/PbocDepositFormDialog.vue'
import type { DepositRate } from '#shared/types/tools'

definePageMeta({ layout: 'admin-layout', title: '央行存款基准利率' })

interface Row extends DepositRate { id: number; remark?: string }

const rows = ref<Row[]>([])
const dialogOpen = ref(false)
const editing = ref<Row | null>(null)
const alertDialog = useAlertDialogStore()

async function loadList() {
    const data = await useApiFetch<Row[]>('/api/v1/admin/rates/pboc-deposit', { method: 'GET' })
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
        title: '删除存款利率记录',
        message: `确认删除 ${row.date} 的 央行存款基准利率（1Y=${row.oneYear}%）？`,
        confirmText: '确认删除',
        onConfirm: async () => {
            await useApiFetch(`/api/v1/admin/rates/pboc-deposit/${row.id}`, { method: 'DELETE' })
            await loadList()
        },
    })
}

onMounted(loadList)
</script>
