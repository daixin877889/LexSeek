<script setup lang="ts">
/**
 * 我的文书草稿列表
 *
 * 用于 /dashboard/document 首页，消费 GET /api/v1/assistant/document/drafts。
 * 后端未返回 templateName，前端 fallback 为 "模板 #ID"。
 *
 * Feature: contract-review-m1 / Task 12.1
 */
import { FileTextIcon, Loader2Icon, Trash2Icon } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

interface DraftRow {
    id: number
    templateId: number
    caseId: number | null
    status: string
    updatedAt: string
}

const { formatDate } = useFormatters()

const loading = ref(false)
const drafts = ref<DraftRow[]>([])
const pagination = ref({ page: 1, pageSize: 10, total: 0 })

async function loadDrafts() {
    loading.value = true
    try {
        const skip = (pagination.value.page - 1) * pagination.value.pageSize
        const result = await useApiFetch<{ items: DraftRow[]; total: number }>(
            '/api/v1/assistant/document/drafts',
            { query: { skip, take: pagination.value.pageSize } },
        )
        if (result) {
            drafts.value = result.items
            pagination.value.total = result.total
        }
    } finally {
        loading.value = false
    }
}

onMounted(loadDrafts)

async function handleDelete(row: DraftRow) {
    if (!confirm(`确认删除草稿「模板 #${row.templateId}」？删除后无法恢复。`)) return
    const ok = await useApiFetch(
        `/api/v1/assistant/document/drafts/${row.id}`,
        { method: 'DELETE' },
    )
    if (ok !== null) {
        toast.success('已删除')
        loadDrafts()
    }
}

function openDraft(row: DraftRow) {
    navigateTo(`/dashboard/document/drafts/${row.id}`)
}

function changePage(page: number) {
    pagination.value.page = page
    loadDrafts()
}

const STATUS_LABEL: Record<string, string> = {
    pending: '生成中',
    filling: '生成中',
    ready: '可编辑',
    exported: '已导出',
    failed: '失败',
}
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s
</script>

<template>
    <div class="space-y-3">
        <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">我的草稿</h2>
        </div>

        <!-- 加载态 -->
        <div v-if="loading" class="flex justify-center py-8">
            <Loader2Icon class="size-6 animate-spin text-muted-foreground" />
        </div>

        <!-- 空态 -->
        <div
            v-else-if="!drafts.length"
            class="flex flex-col items-center justify-center py-8 text-muted-foreground"
        >
            <FileTextIcon class="size-8 mb-2 opacity-40" />
            <p class="text-sm">还没有草稿，从上方选一个模板开始</p>
        </div>

        <!-- 列表 -->
        <div v-else class="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>模板</TableHead>
                        <TableHead class="w-[120px]">关联案件</TableHead>
                        <TableHead class="w-[100px]">状态</TableHead>
                        <TableHead class="w-[160px]">更新时间</TableHead>
                        <TableHead class="w-[140px] text-right">操作</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    <TableRow v-for="row in drafts" :key="row.id">
                        <TableCell class="font-medium">模板 #{{ row.templateId }}</TableCell>
                        <TableCell>{{ row.caseId ? `#${row.caseId}` : '—' }}</TableCell>
                        <TableCell>{{ statusLabel(row.status) }}</TableCell>
                        <TableCell class="text-sm text-muted-foreground">
                            {{ formatDate(row.updatedAt) }}
                        </TableCell>
                        <TableCell class="text-right">
                            <Button variant="ghost" size="sm" @click="openDraft(row)">进入</Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label="删除草稿"
                                @click="handleDelete(row)"
                            >
                                <Trash2Icon class="size-4" />
                            </Button>
                        </TableCell>
                    </TableRow>
                </TableBody>
            </Table>
        </div>

        <!-- 分页 -->
        <GeneralPagination
            v-if="drafts.length"
            :current-page="pagination.page"
            :page-size="pagination.pageSize"
            :total="pagination.total"
            @change="changePage"
        />
    </div>
</template>
