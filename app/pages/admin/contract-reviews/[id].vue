<template>
    <div class="space-y-6">
        <!-- 顶部返回 + 标题 -->
        <div class="flex items-center gap-3">
            <NuxtLink to="/admin/contract-reviews">
                <Button variant="outline" size="sm">
                    <ArrowLeft class="h-4 w-4 mr-1" />
                    返回
                </Button>
            </NuxtLink>
            <div>
                <h1 class="text-2xl font-bold">合同审查详情</h1>
                <p class="text-muted-foreground text-sm">审查 ID：{{ id }}</p>
            </div>
        </div>

        <!-- 不存在 -->
        <div v-if="!detail" class="flex flex-col items-center justify-center py-16 text-center">
            <FileX class="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium mb-1">记录不存在</h3>
            <p class="text-muted-foreground text-sm mb-4">可能已被彻底移除，或 ID 无效</p>
            <NuxtLink to="/admin/contract-reviews">
                <Button variant="outline">返回列表</Button>
            </NuxtLink>
        </div>

        <template v-else>
            <!-- 基本信息 -->
            <Card>
                <CardHeader>
                    <CardTitle class="flex items-center gap-3">
                        基本信息
                        <Badge :variant="getStatusVariant(detail.status)">
                            {{ getStatusLabel(detail.status) }}
                        </Badge>
                        <Badge v-if="detail.deletedAt" variant="destructive">已删除</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">审查 ID</dt>
                            <dd class="break-all">{{ detail.id }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">会话 ID</dt>
                            <dd class="break-all">{{ detail.sessionId }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">用户 ID</dt>
                            <dd>{{ detail.userId }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">用户昵称</dt>
                            <dd>{{ detail.userNickname ?? '—' }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">用户手机</dt>
                            <dd>{{ detail.userPhone ?? '—' }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">合同类型</dt>
                            <dd>{{ detail.contractType ?? '—' }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">甲方</dt>
                            <dd class="break-all">{{ detail.partyA ?? '—' }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">乙方</dt>
                            <dd class="break-all">{{ detail.partyB ?? '—' }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">立场</dt>
                            <dd>{{ detail.stance ?? '—' }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">原合同文件</dt>
                            <dd class="break-all">{{ detail.originalFileName ?? '—' }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">批注文件</dt>
                            <dd class="break-all">{{ detail.reviewedFileName ?? '—' }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">未保存修改</dt>
                            <dd>
                                <span v-if="detail.hasUnsavedDocxChanges" class="text-amber-600">✓ 是</span>
                                <span v-else class="text-muted-foreground">✗ 否</span>
                            </dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">创建时间</dt>
                            <dd>{{ formatDate(String(detail.createdAt)) }}</dd>
                        </div>
                        <div class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">更新时间</dt>
                            <dd>{{ formatDate(String(detail.updatedAt)) }}</dd>
                        </div>
                        <div v-if="detail.deletedAt" class="flex gap-2">
                            <dt class="text-muted-foreground w-28 shrink-0">删除时间</dt>
                            <dd>{{ formatDate(String(detail.deletedAt)) }}</dd>
                        </div>
                    </dl>
                </CardContent>
            </Card>

            <!-- 摘要 -->
            <Card>
                <CardHeader>
                    <CardTitle>审查摘要</CardTitle>
                </CardHeader>
                <CardContent>
                    <div v-if="detail.summary" class="whitespace-pre-wrap text-sm leading-relaxed">
                        {{ detail.summary }}
                    </div>
                    <div v-else class="text-sm text-muted-foreground">暂无摘要</div>
                </CardContent>
            </Card>

            <!-- 风险清单 -->
            <Card>
                <CardHeader>
                    <CardTitle>风险清单 <span class="text-muted-foreground text-sm">（只读 · {{ risks.length }} 条）</span>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div v-if="risks.length === 0" class="text-sm text-muted-foreground">暂无风险条目</div>
                    <ul v-else class="space-y-4">
                        <li v-for="(risk, idx) in risks" :key="idx"
                            class="border rounded-md p-4 space-y-2">
                            <div class="flex items-start justify-between gap-3">
                                <div class="font-medium">
                                    {{ idx + 1 }}. {{ risk.problem || risk.category || '（无标题）' }}
                                    <span v-if="risk.clauseIndex !== undefined" class="text-xs text-muted-foreground ml-1">#条款 {{ risk.clauseIndex }}</span>
                                </div>
                                <Badge v-if="risk.level" :variant="getSeverityVariant(risk.level)">
                                    {{ risk.level === 'high' ? '高' : risk.level === 'medium' ? '中' : risk.level === 'low' ? '低' : risk.level }}
                                </Badge>
                            </div>
                            <div v-if="risk.clauseText" class="text-xs bg-muted/50 rounded px-2 py-1.5 whitespace-pre-wrap">
                                <span class="text-muted-foreground">原条款：</span>{{ risk.clauseText }}
                            </div>
                            <div v-if="risk.analysis" class="text-sm text-muted-foreground whitespace-pre-wrap">
                                <span class="text-muted-foreground">分析：</span>{{ risk.analysis }}
                            </div>
                            <div v-if="risk.risk" class="text-sm whitespace-pre-wrap">
                                <span class="text-muted-foreground">风险点：</span>{{ risk.risk }}
                            </div>
                            <div v-if="risk.legalBasis" class="text-xs text-muted-foreground">
                                法律依据：{{ risk.legalBasis }}
                            </div>
                            <div v-if="risk.suggestion" class="text-sm">
                                <span class="text-muted-foreground">建议：</span>{{ risk.suggestion }}
                            </div>
                            <div v-if="risk.suggestedClauseText" class="text-xs bg-emerald-50 dark:bg-emerald-950/30 rounded px-2 py-1.5 whitespace-pre-wrap text-emerald-800 dark:text-emerald-200">
                                <span class="text-muted-foreground">建议条款：</span>{{ risk.suggestedClauseText }}
                            </div>
                        </li>
                    </ul>
                </CardContent>
            </Card>

            <!-- 页脚操作 -->
            <div v-if="!detail.deletedAt" class="flex justify-end">
                <Button variant="destructive" @click="deleteDialogOpen = true">
                    <Trash2 class="h-4 w-4 mr-2" />
                    软删除该记录
                </Button>
            </div>
        </template>
    </div>

    <!-- 删除确认 -->
    <AlertDialog v-model:open="deleteDialogOpen">
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>确认软删除该审查记录？</AlertDialogTitle>
                <AlertDialogDescription>
                    删除后用户端将不可见。记录 ID：{{ id }}。
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel :disabled="deleting">取消</AlertDialogCancel>
                <AlertDialogAction :disabled="deleting" @click="confirmDelete">
                    <Loader2 v-if="deleting" class="h-4 w-4 mr-2 animate-spin" />
                    确认删除
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
</template>

<script setup lang="ts">
import { ArrowLeft, FileX, Loader2, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AdminReviewDetail } from '~~/server/services/assistant/contract/contractReview.dao'

definePageMeta({ layout: 'admin-layout', title: '合同审查详情' })

// ─── 路由参数 ─────────────────────────────────────────────────────────────────
const route = useRoute()
const id = Number(route.params.id)

if (!Number.isInteger(id) || id <= 0) {
    // 非法 ID 直接返回列表
    await navigateTo('/admin/contract-reviews', { replace: true })
}

// ─── 风险条目类型（仅前端展示） ─────────────────────────────────────────────────
interface RiskItem {
    problem?: string
    analysis?: string
    risk?: string
    level?: string
    category?: string
    legalBasis?: string
    suggestion?: string
    suggestedClauseText?: string
    clauseIndex?: number
    clauseText?: string
}

// ─── 状态 ────────────────────────────────────────────────────────────────────
const { formatDate } = useFormatters()

const { data: detail, refresh } = await useApi<AdminReviewDetail>(
    `/api/v1/admin/contract-reviews/${id}`,
)

const deleteDialogOpen = ref(false)
const deleting = ref(false)

const risks = computed<RiskItem[]>(() => {
    const raw = detail.value?.risks
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
            problem: typeof x.problem === 'string' ? x.problem : undefined,
            analysis: typeof x.analysis === 'string' ? x.analysis : undefined,
            risk: typeof x.risk === 'string' ? x.risk : undefined,
            level: typeof x.level === 'string' ? x.level : undefined,
            category: typeof x.category === 'string' ? x.category : undefined,
            legalBasis: typeof x.legalBasis === 'string' ? x.legalBasis : undefined,
            suggestion: typeof x.suggestion === 'string' ? x.suggestion : undefined,
            suggestedClauseText: typeof x.suggestedClauseText === 'string' ? x.suggestedClauseText : undefined,
            clauseIndex: typeof x.clauseIndex === 'number' ? x.clauseIndex : undefined,
            clauseText: typeof x.clauseText === 'string' ? x.clauseText : undefined,
        }))
})

// ─── Badge 映射 ─────────────────────────────────────────────────────────────
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

const STATUS_LABEL_MAP: Record<string, string> = {
    pending: '待处理',
    reviewing: '审查中',
    awaiting_stance: '等待立场',
    completed: '已完成',
    failed: '失败',
    rebuilding: '重建中',
}

function getStatusLabel(status: string) {
    return STATUS_LABEL_MAP[status] ?? status
}

function getStatusVariant(status: string): BadgeVariant {
    if (status === 'completed') return 'default'
    if (status === 'failed') return 'destructive'
    if (status === 'reviewing' || status === 'awaiting_stance') return 'secondary'
    return 'outline'
}

function getSeverityVariant(severity: string): BadgeVariant {
    const s = severity.toLowerCase()
    if (s.includes('high') || s.includes('高')) return 'destructive'
    if (s.includes('medium') || s.includes('中')) return 'default'
    return 'secondary'
}

async function confirmDelete() {
    deleting.value = true
    try {
        const result = await useApiFetch(`/api/v1/admin/contract-reviews/${id}`, {
            method: 'DELETE',
        })
        if (result !== null) {
            toast.success('已删除')
            deleteDialogOpen.value = false
            await refresh()
        }
    } finally {
        deleting.value = false
    }
}
</script>
