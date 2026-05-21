<script setup lang="ts">
/**
 * 合同审查清单管理页
 *
 * 左侧：合同类型 Tab（11 大类 + 41 细分两级结构，徽章为启用数）
 * 右侧：当前细分下的要点列表（按 code 自然序）+ 新增/编辑抽屉
 *
 * v1 不含拖拽排序和硬删除。
 *
 * **Feature: contract-review-playbook (M7)**
 */
import {
    CONTRACT_TYPE_CATEGORIES,
    CATEGORY_TO_SUBTYPES,
    STANCE_PREFERENCE_LABEL,
    RISK_LEVEL_LABEL,
} from '#shared/types/contract'
import type { ContractTypeCategory, StancePreference, RiskLevel } from '#shared/types/contract'
import { toast } from 'vue-sonner'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    adminBrandFocusClass,
    adminBrandListItemFocusClass,
    adminBrandPrimaryButtonClass,
    adminBrandSelectedListItemClass,
    adminBrandSwitchClass,
    adminBrandUnselectedListItemClass,
} from '~/utils/adminBrandStyles'

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

// 一级大类 + 二级细分
const CATEGORIES = CONTRACT_TYPE_CATEGORIES
const activeCategory = ref<ContractTypeCategory>(CATEGORIES[0])
const activeType = ref<string>(CATEGORY_TO_SUBTYPES[CATEGORIES[0]][0]!)
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

// 各细分启用数（左侧 Tab 徽章），大类计数由 CATEGORY_TO_SUBTYPES 求和派生
const typeCounts = ref<Record<string, number>>({})

function categoryEnabledCount(cat: ContractTypeCategory): number {
    return CATEGORY_TO_SUBTYPES[cat].reduce((sum, sub) => sum + (typeCounts.value[sub] ?? 0), 0)
}

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

function getCategoryButtonClass(cat: ContractTypeCategory): string {
    return activeCategory.value === cat
        ? adminBrandSelectedListItemClass
        : adminBrandUnselectedListItemClass
}

function getSubtypeButtonClass(sub: string): string {
    return activeType.value === sub
        ? 'border-l-primary bg-primary/10 text-primary hover:bg-primary/15'
        : 'border-l-transparent text-muted-foreground hover:bg-muted/30'
}

watch(activeType, loadList)

// 切换大类：自动选中该大类下的第一个细分（触发 loadList）
watch(activeCategory, (cat) => {
    const subs = CATEGORY_TO_SUBTYPES[cat]
    if (subs.length && !subs.includes(activeType.value)) {
        activeType.value = subs[0]!
    }
})

onMounted(async () => {
    await Promise.all([loadList(), loadCounts()])
})
</script>

<template>
    <div class="theme-brand flex flex-col h-full gap-4">
        <!-- 页面标题 -->
        <div>
            <h1 class="text-2xl md:text-3xl font-bold mb-1">审查清单管理</h1>
            <p class="text-muted-foreground text-sm">按合同类型维护审查要点，AI 逐条审查时会对照清单产出命中结果</p>
        </div>

        <!-- 正文：左右分栏 -->
        <div class="flex flex-1 min-h-0 border rounded-lg overflow-hidden bg-card">
        <!-- 左侧合同类型 Tab：一级大类 + 二级细分 -->
        <div class="w-[240px] shrink-0 border-r bg-card overflow-y-auto">
            <div class="p-2 space-y-0.5">
                <template v-for="cat in CATEGORIES" :key="cat">
                    <!-- 一级（大类） -->
                    <button
                        :class="[
                            'w-full flex items-center justify-between border-l-2 px-3 py-2 rounded text-sm transition',
                            adminBrandListItemFocusClass,
                            getCategoryButtonClass(cat),
                            activeCategory === cat ? 'font-semibold' : 'text-foreground/80',
                        ]"
                        @click="activeCategory = cat"
                    >
                        <span>{{ cat }}</span>
                        <span class="text-xs text-muted-foreground">{{ categoryEnabledCount(cat) }}</span>
                    </button>
                    <!-- 二级（细分）：仅展开当前 active 大类 -->
                    <div v-if="activeCategory === cat" class="ml-3 pl-2 border-l space-y-0.5 py-1">
                        <button
                            v-for="sub in CATEGORY_TO_SUBTYPES[cat]"
                            :key="sub"
                            :class="[
                                'w-full flex items-center justify-between border-l-2 px-2 py-1.5 rounded text-xs transition',
                                adminBrandListItemFocusClass,
                                getSubtypeButtonClass(sub),
                                activeType === sub && 'font-semibold',
                            ]"
                            @click="activeType = sub"
                        >
                            <span class="truncate">{{ sub }}</span>
                            <span class="text-xs shrink-0 ml-2">{{ typeCounts[sub] ?? 0 }}</span>
                        </button>
                    </div>
                </template>
            </div>
        </div>

        <!-- 右侧列表 -->
        <div class="flex-1 flex flex-col min-w-0">
            <div class="p-4 border-b flex items-center gap-3 bg-card">
                <Input v-model="searchQ" placeholder="按标题搜索" :class="['w-64', adminBrandFocusClass]" />
                <Select v-model="enabledFilter">
                    <SelectTrigger :class="['w-40', adminBrandFocusClass]"><SelectValue /></SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部</SelectItem>
                        <SelectItem value="on">仅启用</SelectItem>
                        <SelectItem value="off">仅停用</SelectItem>
                    </SelectContent>
                </Select>
                <Button :class="['ml-auto', adminBrandPrimaryButtonClass]" @click="openCreate">+ 新增要点</Button>
            </div>

            <div class="flex-1 overflow-auto p-4">
                <div v-if="loading" class="p-8 text-center text-muted-foreground">加载中...</div>
                <div v-else-if="!list.length" class="p-8 text-center text-muted-foreground">
                    该类型暂无要点，点击右上角"新增要点"
                </div>
                <Table v-else>
                    <TableHeader>
                        <TableRow class="bg-muted/50 hover:bg-muted/50">
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
                        <TableRow v-for="p in list" :key="p.id" class="hover:bg-muted/30">
                            <TableCell class="font-mono text-xs">{{ p.code }}</TableCell>
                            <TableCell>{{ p.title }}</TableCell>
                            <TableCell>{{ RISK_LEVEL_LABEL[p.defaultLevel] }}</TableCell>
                            <TableCell>{{ STANCE_PREFERENCE_LABEL[p.stancePreference] }}</TableCell>
                            <TableCell>
                                <Switch :model-value="p.enabled" :class="adminBrandSwitchClass"
                                    @update:model-value="toggleEnabled(p)" />
                            </TableCell>
                            <TableCell class="text-xs text-muted-foreground">
                                {{ new Date(p.updatedAt).toLocaleDateString() }}
                            </TableCell>
                            <TableCell>
                                <Button size="sm" variant="outline" :class="adminBrandFocusClass" @click="openEdit(p)">编辑</Button>
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </div>
        </div>

        <!-- 编辑抽屉 -->
        <Sheet v-model:open="drawerOpen">
            <SheetContent class="theme-brand w-[520px] sm:max-w-[520px] overflow-y-auto">
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
                        <Input v-model="editing.code" placeholder="如 probation；只能小写字母、数字、下划线"
                            :class="['mt-1', adminBrandFocusClass]" />
                    </div>
                    <div>
                        <Label>标题</Label>
                        <Input v-model="editing.title" :maxlength="30" :class="['mt-1', adminBrandFocusClass]" />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <Label>默认等级</Label>
                            <Select v-model="editing.defaultLevel">
                                <SelectTrigger :class="['mt-1', adminBrandFocusClass]"><SelectValue /></SelectTrigger>
                                <SelectContent class="theme-brand">
                                    <SelectItem value="high">高</SelectItem>
                                    <SelectItem value="medium">中</SelectItem>
                                    <SelectItem value="low">低</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>立场偏好</Label>
                            <Select v-model="editing.stancePreference">
                                <SelectTrigger :class="['mt-1', adminBrandFocusClass]"><SelectValue /></SelectTrigger>
                                <SelectContent class="theme-brand">
                                    <SelectItem value="strict">严格</SelectItem>
                                    <SelectItem value="balanced">中性</SelectItem>
                                    <SelectItem value="lenient">宽松</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div>
                        <Label>检查内容（给 AI 的指导语）</Label>
                        <Textarea v-model="editing.checkContent" :rows="4" :maxlength="500"
                            :class="['mt-1', adminBrandFocusClass]" />
                    </div>
                    <div>
                        <Label>法律依据（可选）</Label>
                        <Textarea :model-value="editing.legalBasis ?? ''" :rows="2" :maxlength="300"
                            :class="['mt-1', adminBrandFocusClass]"
                            @update:model-value="editing.legalBasis = $event ? String($event) : null" />
                    </div>
                    <div>
                        <Label>标准建议（可选）</Label>
                        <Textarea :model-value="editing.suggestion ?? ''" :rows="3" :maxlength="500"
                            :class="['mt-1', adminBrandFocusClass]"
                            @update:model-value="editing.suggestion = $event ? String($event) : null" />
                    </div>
                </div>
                <SheetFooter>
                    <Button variant="outline" :class="adminBrandFocusClass" @click="drawerOpen = false">取消</Button>
                    <Button :class="adminBrandPrimaryButtonClass" @click="saveDrawer">保存</Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    </div>
</template>
