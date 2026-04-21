<template>
    <div class="space-y-4">
        <!-- 统计卡片 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card v-for="card in statsCards" :key="card.key">
                <CardHeader class="pb-2">
                    <CardTitle class="text-sm text-muted-foreground">{{ card.title }}</CardTitle>
                </CardHeader>
                <CardContent>
                    <div class="text-2xl font-bold" :class="card.colorClass">{{ card.todayValue }}</div>
                    <div class="text-xs text-muted-foreground mt-1">近 7 天 {{ card.weekValue }}</div>
                </CardContent>
            </Card>
        </div>

        <!-- 筛选栏 -->
        <div class="flex flex-col md:flex-row gap-3 md:items-end">
            <div>
                <label class="text-xs text-muted-foreground">用户 ID</label>
                <Input v-model="filters.userId" type="number" class="w-32" />
            </div>
            <div>
                <label class="text-xs text-muted-foreground">工具</label>
                <Select v-model="filters.toolName">
                    <SelectTrigger class="w-48">
                        <SelectValue placeholder="全部工具" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem :value="ALL">全部</SelectItem>
                        <SelectItem v-for="name in LIMITED_TOOL_NAMES" :key="name" :value="name">{{ name }}</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div>
                <label class="text-xs text-muted-foreground">判决</label>
                <Select v-model="filters.verdict">
                    <SelectTrigger class="w-32">
                        <SelectValue placeholder="全部" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem :value="ALL">全部</SelectItem>
                        <SelectItem value="allowed">允许</SelectItem>
                        <SelectItem value="denied">拒绝</SelectItem>
                        <SelectItem value="error">错误</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <div>
                <label class="text-xs text-muted-foreground">开始日期</label>
                <GeneralDatePicker v-model="filters.from" placeholder="开始日期" clearable class="w-44" />
            </div>
            <div>
                <label class="text-xs text-muted-foreground">截止日期</label>
                <GeneralDatePicker v-model="filters.to" placeholder="截止日期" clearable class="w-44" />
            </div>
            <Button variant="outline" @click="applyFilters">搜索</Button>
            <Button variant="ghost" @click="resetFilters">重置</Button>
            <div class="flex-1" />
            <Button variant="destructive" @click="showCleanupDialog = true">清理历史</Button>
        </div>

        <!-- 表格 -->
        <div class="bg-card rounded-lg border overflow-hidden">
            <div class="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>时间</TableHead>
                            <TableHead>用户</TableHead>
                            <TableHead>工具</TableHead>
                            <TableHead>判决</TableHead>
                            <TableHead>案件 ID</TableHead>
                            <TableHead>拒绝原因</TableHead>
                            <TableHead>耗时 (ms)</TableHead>
                            <TableHead>操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow v-if="items.length === 0">
                            <TableCell colspan="8" class="text-center text-muted-foreground py-8">
                                暂无记录
                            </TableCell>
                        </TableRow>
                        <TableRow v-for="row in items" :key="row.id">
                            <TableCell class="font-mono text-xs">{{ formatTime(row.createdAt) }}</TableCell>
                            <TableCell>{{ row.userId }}</TableCell>
                            <TableCell class="font-mono text-xs">{{ row.toolName }}</TableCell>
                            <TableCell>
                                <Badge :variant="verdictVariant(row.verdict)">
                                    {{ AgentAuditVerdictText[row.verdict] }}
                                </Badge>
                            </TableCell>
                            <TableCell>{{ row.caseId ?? '-' }}</TableCell>
                            <TableCell class="max-w-xs truncate" :title="row.denyReason ?? ''">
                                {{ row.denyReason ?? '-' }}
                            </TableCell>
                            <TableCell>{{ row.latencyMs }}</TableCell>
                            <TableCell>
                                <Button size="sm" variant="ghost" @click="openDetail(row.id)">详情</Button>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </div>

        <GeneralPagination
            :current-page="page"
            :page-size="pageSize"
            :total="total"
            @change="onPageChange"
        />

        <AgentAuditDetailSheet v-model:open="detailOpen" :record-id="detailId" />
        <AgentAuditCleanupDialog v-model:open="showCleanupDialog" :total="total" @cleaned="onCleaned" />
    </div>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import AgentAuditDetailSheet from './AgentAuditDetailSheet.vue'
import AgentAuditCleanupDialog from './AgentAuditCleanupDialog.vue'
import {
    AgentAuditVerdictText,
    LIMITED_TOOL_NAMES,
    type AgentAuditRecord,
    type AgentAuditStatsPayload,
    type AgentAuditVerdict,
} from '#shared/types/agentAudit'

const ALL = '__all__'

const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<AgentAuditRecord[]>([])
const filters = reactive({ userId: '', toolName: ALL as string, verdict: ALL as string, from: '', to: '' })

const detailOpen = ref(false)
const detailId = ref<string>('')
const showCleanupDialog = ref(false)

function formatTime(iso: string) {
    return dayjs(iso).format('YYYY-MM-DD HH:mm:ss')
}
function verdictVariant(v: AgentAuditVerdict): 'default' | 'destructive' | 'secondary' {
    return v === 'allowed' ? 'default' : v === 'denied' ? 'destructive' : 'secondary'
}

function buildQuery(): Record<string, string | number> {
    const q: Record<string, string | number> = { page: page.value, pageSize: pageSize.value }
    if (filters.userId) q.userId = Number(filters.userId)
    if (filters.toolName !== ALL) q.toolName = filters.toolName
    if (filters.verdict !== ALL) q.verdict = filters.verdict
    if (filters.from) q.from = filters.from
    if (filters.to) q.to = filters.to
    return q
}

const queryParams = computed(buildQuery)
const { data: listData, refresh: refreshList } = await useApi<{ items: AgentAuditRecord[]; total: number; page: number; pageSize: number }>(
    '/api/v1/admin/agent-audit-logs',
    { query: queryParams },
)
watchEffect(() => {
    items.value = listData.value?.items ?? []
    total.value = listData.value?.total ?? 0
})

const { data: statsData } = await useApi<AgentAuditStatsPayload>('/api/v1/admin/agent-audit-logs/stats')
const statsCards = computed(() => {
    const today = statsData.value?.today ?? { allowed: 0, denied: 0, error: 0 }
    const week = statsData.value?.last7d ?? { allowed: 0, denied: 0, error: 0 }
    return [
        { key: 'allowed', title: '今日允许', todayValue: today.allowed, weekValue: week.allowed, colorClass: 'text-emerald-600' },
        { key: 'denied', title: '今日拒绝', todayValue: today.denied, weekValue: week.denied, colorClass: 'text-red-600' },
        { key: 'error', title: '今日错误', todayValue: today.error, weekValue: week.error, colorClass: 'text-amber-600' },
    ]
})

function applyFilters() {
    page.value = 1
    return refreshList()
}
function resetFilters() {
    filters.userId = ''
    filters.toolName = ALL
    filters.verdict = ALL
    filters.from = ''
    filters.to = ''
    return applyFilters()
}
function onPageChange(newPage: number) {
    page.value = newPage
    return refreshList()
}

function openDetail(id: string) {
    detailId.value = id
    detailOpen.value = true
}
async function onCleaned() {
    await refreshList()
}
</script>
