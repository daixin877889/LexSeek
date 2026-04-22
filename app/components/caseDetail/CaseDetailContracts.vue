<script setup lang="ts">
/**
 * 案件详情 - 合同审查 Tab（M6.3）
 *
 * 显示当前案件下的合同审查列表，每条可点击进入合同审查工作区，
 * 顶部提供「新建合同审查」入口跳转到 /dashboard/contract?new=1&caseId=xxx
 * （合同审查已从法律助手下独立为顶级模块）。
 *
 * 数据源：GET /api/v1/assistant/contract/reviews?caseId={caseId}&skip=0&take=50
 */
import { FileSearchIcon, PlusIcon, Loader2Icon, FileTextIcon } from 'lucide-vue-next'
import type { ReviewListItem } from '#shared/types/contract'
import { REVIEW_STATUS_LABEL } from '#shared/types/contract'

const props = defineProps<{
    caseId: number
}>()

interface ListResponse {
    items: ReviewListItem[]
    total: number
    skip: number
    take: number
}

const { formatDate } = useFormatters()

// query 用 computed 传入，useApi 追踪其变化并自动 refetch；不需要额外 watch。
const { data, pending } = await useApi<ListResponse>(
    '/api/v1/assistant/contract/reviews',
    {
        query: computed(() => ({ caseId: props.caseId, skip: 0, take: 50 })),
    },
)

const items = computed<ReviewListItem[]>(() => data.value?.items ?? [])
const total = computed(() => data.value?.total ?? 0)

function handleCreate() {
    navigateTo(`/dashboard/contract?new=1&caseId=${props.caseId}`)
}

function handleOpen(row: ReviewListItem) {
    navigateTo(`/dashboard/contract/${row.id}`)
}

/** 状态对应 badge 色调，失败红，完成绿，其他中性 */
function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (status === 'completed') return 'default'
    if (status === 'failed') return 'destructive'
    return 'secondary'
}
</script>

<template>
    <div class="h-full overflow-y-auto p-4 md:p-6 space-y-4">
        <!-- 头部：标题 + 新建按钮 -->
        <div class="flex items-center justify-between gap-3">
            <div>
                <h2 class="text-lg font-semibold flex items-center gap-2">
                    <FileSearchIcon class="size-5" />
                    合同审查
                </h2>
                <p class="text-sm text-muted-foreground mt-0.5">
                    当前案件下共 {{ total }} 份合同审查记录
                </p>
            </div>
            <Button size="sm" @click="handleCreate">
                <PlusIcon class="size-4 mr-1" />
                新建合同审查
            </Button>
        </div>

        <!-- 加载中 -->
        <div v-if="pending" class="flex justify-center py-12">
            <Loader2Icon class="size-8 animate-spin text-muted-foreground" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="items.length === 0"
            class="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-lg">
            <FileTextIcon class="size-10 text-muted-foreground/50 mb-3" />
            <h3 class="text-base font-medium mb-1">还没有合同审查</h3>
            <p class="text-sm text-muted-foreground mb-4">
                点击「新建合同审查」上传合同，AI 将按案件立场自动审查
            </p>
            <Button size="sm" @click="handleCreate">
                <PlusIcon class="size-4 mr-1" />
                新建合同审查
            </Button>
        </div>

        <!-- 列表 -->
        <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <button
                v-for="row in items"
                :key="row.id"
                class="text-left border rounded-lg p-4 bg-card hover:border-primary/50 hover:shadow-sm transition-all space-y-2"
                @click="handleOpen(row)"
            >
                <div class="flex items-start justify-between gap-2">
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-medium truncate" :title="row.originalFileName ?? ''">
                            {{ row.originalFileName || '未命名合同' }}
                        </div>
                        <div class="text-xs text-muted-foreground mt-1">
                            <template v-if="row.contractType">{{ row.contractType }} · </template>
                            {{ formatDate(String(row.createdAt)) }}
                        </div>
                    </div>
                    <Badge :variant="statusBadgeVariant(row.status)" class="shrink-0">
                        {{ REVIEW_STATUS_LABEL[row.status as keyof typeof REVIEW_STATUS_LABEL] ?? row.status }}
                    </Badge>
                </div>

                <div v-if="row.summary" class="text-xs text-muted-foreground line-clamp-2">
                    {{ row.summary }}
                </div>
            </button>
        </div>
    </div>
</template>
