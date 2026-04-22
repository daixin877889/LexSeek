<script setup lang="ts">
/**
 * 合同审查清单管理页
 *
 * 左侧：合同类型 Tab（6 项 + 各启用数）
 * 右侧：要点列表（按 code 自然序）+ 新增/编辑抽屉
 *
 * v1 不含拖拽排序和硬删除。
 *
 * **Feature: contract-review-playbook (M7)**
 */
import { CONTRACT_TYPE_OPTIONS, STANCE_PREFERENCE_LABEL, RISK_LEVEL_LABEL } from '#shared/types/contract'
import type { StancePreference, RiskLevel } from '#shared/types/contract'
import { toast } from 'vue-sonner'

definePageMeta({
    layout: 'admin-layout',
    title: '审查清单管理',
})

interface Playbook {
    id: number
    contractType: string
    code: string
    title: string
    defaultLevel: RiskLevel
    stancePreference: StancePreference
    checkContent: string
    legalBasis: string | null
    suggestion: string | null
    enabled: boolean
    createdAt: string
    updatedAt: string
}

// 排除"其他"类型（spec §1.2 不配清单）
const TYPES = CONTRACT_TYPE_OPTIONS.filter(t => t !== '其他')

const activeType = ref<string>(TYPES[0]!)
const rawList = ref<Playbook[]>([])
const loading = ref(false)
const searchQ = ref('')
const enabledFilter = ref<'all' | 'on' | 'off'>('all')

// 前端二次过滤（enabled + q）
const list = computed(() => {
    return rawList.value.filter((p) => {
        if (enabledFilter.value === 'on' && !p.enabled) return false
        if (enabledFilter.value === 'off' && p.enabled) return false
        if (searchQ.value && !p.title.includes(searchQ.value)) return false
        return true
    })
})

// 各类型启用数（左侧 Tab 徽章）
const typeCounts = ref<Record<string, number>>({})

async function loadList() {
    loading.value = true
    try {
        const res = await useApiFetch<{ list: Playbook[]; total: number }>(
            `/api/v1/admin/contract-playbooks?contractType=${encodeURIComponent(activeType.value)}`,
        )
        if (res?.list) rawList.value = res.list
    } finally {
        loading.value = false
    }
}

async function loadCounts() {
    const res = await useApiFetch<{ list: Playbook[] }>(
        '/api/v1/admin/contract-playbooks?enabled=true',
    )
    if (res?.list) {
        const counts: Record<string, number> = {}
        for (const p of res.list) counts[p.contractType] = (counts[p.contractType] ?? 0) + 1
        typeCounts.value = counts
    }
}

// 编辑抽屉状态
const drawerOpen = ref(false)
const editing = ref<Partial<Playbook>>({})
const isEdit = computed(() => !!editing.value.id)

function openCreate() {
    editing.value = {
        contractType: activeType.value,
        defaultLevel: 'medium',
        stancePreference: 'balanced',
        enabled: true,
    }
    drawerOpen.value = true
}

function openEdit(p: Playbook) {
    editing.value = { ...p }
    drawerOpen.value = true
}

async function saveDrawer() {
    if (!editing.value.title || !editing.value.checkContent) {
        toast.error('标题和检查内容必填')
        return
    }
    if (!isEdit.value && !editing.value.code) {
        toast.error('code 必填')
        return
    }
    const path = isEdit.value
        ? `/api/v1/admin/contract-playbooks/${editing.value.id}`
        : '/api/v1/admin/contract-playbooks'
    const res = await useApiFetch<Playbook>(path, {
        method: isEdit.value ? 'PATCH' : 'POST',
        body: editing.value,
    })
    if (res) {
        toast.success(isEdit.value ? '已更新' : '已新增')
        drawerOpen.value = false
        await Promise.all([loadList(), loadCounts()])
    }
}

async function toggleEnabled(p: Playbook) {
    const res = await useApiFetch<Playbook>(`/api/v1/admin/contract-playbooks/${p.id}`, {
        method: 'PATCH',
        body: { enabled: !p.enabled },
    })
    if (res) {
        toast.success(p.enabled ? '已停用' : '已启用')
        await Promise.all([loadList(), loadCounts()])
    }
}

watch(activeType, loadList)

onMounted(async () => {
    await Promise.all([loadList(), loadCounts()])
})
</script>

<template>
    <div class="flex flex-col h-full gap-4">
        <!-- 页面标题 -->
        <div>
            <h1 class="text-2xl md:text-3xl font-bold mb-1">审查清单管理</h1>
            <p class="text-muted-foreground text-sm">按合同类型维护审查要点，AI 逐条审查时会对照清单产出命中结果</p>
        </div>

        <!-- 正文：左右分栏 -->
        <div class="flex flex-1 min-h-0 border rounded-lg overflow-hidden bg-card">
        <!-- 左侧类型 Tab -->
        <div class="w-[200px] shrink-0 border-r bg-card p-2 space-y-1">
            <button
                v-for="t in TYPES"
                :key="t"
                class="w-full flex items-center justify-between px-3 py-2 rounded text-sm transition"
                :class="activeType === t ? 'bg-accent text-accent-foreground font-semibold' : 'hover:bg-muted'"
                @click="activeType = t"
            >
                <span>{{ t }}</span>
                <span class="text-xs text-muted-foreground">{{ typeCounts[t] ?? 0 }}</span>
            </button>
        </div>

        <!-- 右侧列表 -->
        <div class="flex-1 flex flex-col min-w-0">
            <div class="p-4 border-b flex items-center gap-3 bg-card">
                <Input v-model="searchQ" placeholder="按标题搜索" class="w-64" />
                <Select v-model="enabledFilter">
                    <SelectTrigger class="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部</SelectItem>
                        <SelectItem value="on">仅启用</SelectItem>
                        <SelectItem value="off">仅停用</SelectItem>
                    </SelectContent>
                </Select>
                <Button class="ml-auto" @click="openCreate">+ 新增要点</Button>
            </div>

            <div class="flex-1 overflow-auto p-4">
                <div v-if="loading" class="p-8 text-center text-muted-foreground">加载中...</div>
                <div v-else-if="!list.length" class="p-8 text-center text-muted-foreground">
                    该类型暂无要点，点击右上角"新增要点"
                </div>
                <Table v-else>
                    <TableHeader>
                        <TableRow>
                            <TableHead class="w-24">code</TableHead>
                            <TableHead>标题</TableHead>
                            <TableHead class="w-20">等级</TableHead>
                            <TableHead class="w-20">立场</TableHead>
                            <TableHead class="w-20">启用</TableHead>
                            <TableHead class="w-32">更新时间</TableHead>
                            <TableHead class="w-24">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        <TableRow v-for="p in list" :key="p.id">
                            <TableCell class="font-mono text-xs">{{ p.code }}</TableCell>
                            <TableCell>{{ p.title }}</TableCell>
                            <TableCell>{{ RISK_LEVEL_LABEL[p.defaultLevel] }}</TableCell>
                            <TableCell>{{ STANCE_PREFERENCE_LABEL[p.stancePreference] }}</TableCell>
                            <TableCell>
                                <Switch :model-value="p.enabled" @update:model-value="toggleEnabled(p)" />
                            </TableCell>
                            <TableCell class="text-xs text-muted-foreground">
                                {{ new Date(p.updatedAt).toLocaleDateString() }}
                            </TableCell>
                            <TableCell>
                                <Button size="sm" variant="outline" @click="openEdit(p)">编辑</Button>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </div>
        </div>

        <!-- 编辑抽屉 -->
        <Sheet v-model:open="drawerOpen">
            <SheetContent class="w-[520px] sm:max-w-[520px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>{{ isEdit ? '编辑要点' : '新增要点' }}</SheetTitle>
                </SheetHeader>
                <div class="space-y-4 px-6 py-4">
                    <div>
                        <Label>合同类型</Label>
                        <div class="text-sm text-muted-foreground mt-1">{{ editing.contractType }}</div>
                    </div>
                    <div v-if="!isEdit">
                        <Label>code（稳定标识，创建后不可改）</Label>
                        <Input v-model="editing.code" placeholder="如 probation；只能小写字母、数字、下划线" class="mt-1" />
                    </div>
                    <div>
                        <Label>标题</Label>
                        <Input v-model="editing.title" :maxlength="30" class="mt-1" />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <Label>默认等级</Label>
                            <Select v-model="editing.defaultLevel">
                                <SelectTrigger class="mt-1"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="high">高</SelectItem>
                                    <SelectItem value="medium">中</SelectItem>
                                    <SelectItem value="low">低</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>立场偏好</Label>
                            <Select v-model="editing.stancePreference">
                                <SelectTrigger class="mt-1"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="strict">严格</SelectItem>
                                    <SelectItem value="balanced">中性</SelectItem>
                                    <SelectItem value="lenient">宽松</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div>
                        <Label>检查内容（给 AI 的指导语）</Label>
                        <Textarea v-model="editing.checkContent" :rows="4" :maxlength="500" class="mt-1" />
                    </div>
                    <div>
                        <Label>法律依据（可选）</Label>
                        <Textarea :model-value="editing.legalBasis ?? ''" :rows="2" :maxlength="300" class="mt-1" @update:model-value="editing.legalBasis = $event ? String($event) : null" />
                    </div>
                    <div>
                        <Label>标准建议（可选）</Label>
                        <Textarea :model-value="editing.suggestion ?? ''" :rows="3" :maxlength="500" class="mt-1" @update:model-value="editing.suggestion = $event ? String($event) : null" />
                    </div>
                </div>
                <SheetFooter>
                    <Button variant="outline" @click="drawerOpen = false">取消</Button>
                    <Button @click="saveDrawer">保存</Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    </div>
</template>
