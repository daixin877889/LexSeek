<template>
    <div class="theme-brand space-y-6">
        <!-- 页面标题 -->
        <div>
            <h1 class="text-2xl md:text-3xl font-bold mb-1">节点权限配置</h1>
            <p class="text-muted-foreground text-sm">配置不同会员级别可访问的分析节点</p>
        </div>

        <!-- 加载状态 -->
        <div v-if="loading" class="flex justify-center py-12">
            <Loader2 class="h-10 w-10 animate-spin text-muted-foreground" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="!matrix.levels.length || !matrix.nodes.length"
            class="flex flex-col items-center justify-center py-12 text-center">
            <Shield class="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 class="text-lg font-medium mb-1">暂无数据</h3>
            <p class="text-muted-foreground text-sm">请先创建会员级别和分析节点</p>
        </div>

        <!-- 权限配置 -->
        <template v-else>
            <!-- 会员级别选择 + 筛选 -->
            <div class="flex flex-col md:flex-row gap-4">
                <Select v-model="selectedLevelId">
                    <SelectTrigger :class="['w-full md:w-48', adminBrandFocusClass]">
                        <SelectValue placeholder="选择会员级别" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem v-for="level in matrix.levels" :key="level.id" :value="String(level.id)">
                            {{ level.name }}
                        </SelectItem>
                    </SelectContent>
                </Select>

                <Select v-model="typeFilter">
                    <SelectTrigger :class="['w-full md:w-40', adminBrandFocusClass]">
                        <SelectValue placeholder="节点类型" />
                    </SelectTrigger>
                    <SelectContent class="theme-brand">
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem v-for="(label, value) in NodeTypeLabels" :key="value" :value="String(value)">
                            {{ label }}
                        </SelectItem>
                    </SelectContent>
                </Select>

                <div class="flex-1">
                    <Input v-model="keyword" placeholder="搜索节点名称/标题..." :class="['w-full md:w-64', adminBrandFocusClass]" />
                </div>

                <div class="flex gap-2">
                    <Button variant="outline" size="sm" :class="adminBrandFocusClass" @click="handleSelectAll"
                        :disabled="!selectedLevelId || batchUpdating">
                        <CheckSquare class="h-4 w-4 mr-1" />
                        全选
                    </Button>
                    <Button variant="outline" size="sm" :class="adminBrandFocusClass" @click="handleDeselectAll"
                        :disabled="!selectedLevelId || batchUpdating">
                        <Square class="h-4 w-4 mr-1" />
                        全不选
                    </Button>
                </div>
            </div>

            <!-- 统计信息 -->
            <div v-if="selectedLevelId" class="flex items-center gap-4 text-sm text-muted-foreground">
                <span>已授权: {{ accessCount }} / {{ filteredNodes.length }} 个节点</span>
                <span class="text-xs">（点击节点行或复选框切换权限，修改自动保存）</span>
            </div>

            <!-- 节点列表 -->
            <div v-if="selectedLevelId" class="bg-card rounded-lg border">
                <div v-if="!filteredNodes.length" class="flex flex-col items-center justify-center py-12 text-center">
                    <Search class="h-8 w-8 text-muted-foreground/50 mb-2" />
                    <p class="text-muted-foreground text-sm">没有匹配的节点</p>
                </div>

                <div v-else class="divide-y">
                    <div v-for="node in filteredNodes" :key="node.nodeId"
                        class="flex cursor-pointer items-center justify-between border-l-2 px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-inset"
                        :class="[
                            node.hasAccess ? adminBrandSelectedListItemClass : adminBrandUnselectedListItemClass,
                            { 'cursor-not-allowed opacity-70': isNodeUpdating(node.nodeId) },
                        ]"
                        role="button"
                        tabindex="0"
                        :aria-pressed="node.hasAccess"
                        :aria-disabled="isNodeUpdating(node.nodeId)"
                        @click="handleNodeItemToggle(node)"
                        @keydown.enter.prevent="handleNodeItemToggle(node)"
                        @keydown.space.prevent="handleNodeItemToggle(node)">
                        <div class="flex items-center gap-3 flex-1 min-w-0">
                            <Checkbox :model-value="node.hasAccess"
                                :disabled="isNodeUpdating(node.nodeId)"
                                :class="adminBrandCheckboxClass"
                                @click.stop
                                @keydown.stop
                                @update:model-value="(checked: boolean | 'indeterminate') => handleToggleAccess(node.nodeId, !!checked)" />
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="font-medium truncate">{{ node.nodeTitle || node.nodeName }}</span>
                                    <Badge variant="outline" class="text-xs shrink-0" :style="getAdminNodeTypeBadgeStyle(node.nodeType)">
                                        {{ NodeTypeLabels[node.nodeType as keyof typeof NodeTypeLabels] || node.nodeType }}
                                    </Badge>
                                </div>
                                <p class="text-xs text-muted-foreground font-mono truncate">{{ node.nodeName }}</p>
                            </div>
                        </div>
                        <div class="shrink-0 ml-4">
                            <Badge variant="outline" class="text-xs" :class="getAdminStatusBadgeClass(node.hasAccess)">
                                {{ node.hasAccess ? '已授权' : '未授权' }}
                            </Badge>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 未选择会员级别提示 -->
            <div v-else class="flex flex-col items-center justify-center py-12 text-center bg-card rounded-lg border">
                <Users class="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 class="text-lg font-medium mb-1">请选择会员级别</h3>
                <p class="text-muted-foreground text-sm">选择一个会员级别后，可配置其节点访问权限</p>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { Loader2, Shield, CheckSquare, Square, Search, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { NodeTypeLabels } from '#shared/types/node'
import { useApiFetch } from '~/composables/useApiFetch'
import {
    adminBrandCheckboxClass,
    adminBrandFocusClass,
    adminBrandSelectedListItemClass,
    adminBrandUnselectedListItemClass,
    getAdminNodeTypeBadgeStyle,
    getAdminStatusBadgeClass,
} from '~/utils/adminBrandStyles'

definePageMeta({ layout: 'admin-layout', title: '节点权限配置' })

// 权限矩阵数据类型
interface AccessMatrix {
    levels: { id: number; name: string; sortOrder: number }[]
    nodes: { id: number; name: string; title: string | null; type: string; groupId: number | null }[]
    matrix: {
        levelId: number
        levelName: string
        sortOrder: number
        nodes: {
            nodeId: number
            nodeName: string
            nodeTitle: string | null
            nodeType: string
            hasAccess: boolean
        }[]
    }[]
}

type AccessNode = AccessMatrix['matrix'][number]['nodes'][number]

// 状态
const loading = ref(false)
const batchUpdating = ref(false)
const updating = ref<Record<string, boolean>>({})
const matrix = ref<AccessMatrix>({
    levels: [],
    nodes: [],
    matrix: [],
})
const selectedLevelId = ref('')
const typeFilter = ref('all')
const keyword = ref('')

// 当前选中级别的节点列表
const currentLevelNodes = computed(() => {
    if (!selectedLevelId.value) return []
    const levelMatrix = matrix.value.matrix.find((l) => l.levelId === parseInt(selectedLevelId.value))
    return levelMatrix?.nodes || []
})

// 筛选后的节点列表
const filteredNodes = computed(() => {
    let nodes = currentLevelNodes.value

    // 类型筛选
    if (typeFilter.value !== 'all') {
        nodes = nodes.filter((n) => n.nodeType === typeFilter.value)
    }

    // 关键词搜索
    if (keyword.value) {
        const kw = keyword.value.toLowerCase()
        nodes = nodes.filter(
            (n) =>
                n.nodeName.toLowerCase().includes(kw) ||
                (n.nodeTitle && n.nodeTitle.toLowerCase().includes(kw))
        )
    }

    return nodes
})

// 已授权数量
const accessCount = computed(() => {
    return filteredNodes.value.filter((n) => n.hasAccess).length
})

const getAccessKey = (nodeId: number) => `${selectedLevelId.value}-${nodeId}`

const isNodeUpdating = (nodeId: number) => Boolean(updating.value[getAccessKey(nodeId)])

// 加载权限矩阵
const loadMatrix = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<AccessMatrix>('/api/v1/admin/access/matrix')
        if (data) {
            matrix.value = data
            // 默认选中第一个会员级别
            const firstLevel = data.levels[0]
            if (firstLevel && !selectedLevelId.value) {
                selectedLevelId.value = String(firstLevel.id)
            }
        }
    } finally {
        loading.value = false
    }
}

// 切换单个权限
const handleToggleAccess = async (nodeId: number, checked: boolean) => {
    const levelId = parseInt(selectedLevelId.value)
    const key = getAccessKey(nodeId)
    updating.value[key] = true

    try {
        const endpoint = checked ? '/api/v1/admin/access/grant' : '/api/v1/admin/access/revoke'
        const result = await useApiFetch<boolean>(endpoint, {
            method: 'POST',
            body: { levelId, nodeId },
            transform: (response) => response.success,
        })

        if (result) {
            // 更新本地状态
            const levelMatrix = matrix.value.matrix.find((l) => l.levelId === levelId)
            if (levelMatrix) {
                const nodeAccess = levelMatrix.nodes.find((n) => n.nodeId === nodeId)
                if (nodeAccess) {
                    nodeAccess.hasAccess = checked
                }
            }
        }
    } finally {
        updating.value[key] = false
    }
}

const handleNodeItemToggle = (node: AccessNode) => {
    if (!selectedLevelId.value || isNodeUpdating(node.nodeId)) return
    handleToggleAccess(node.nodeId, !node.hasAccess)
}

// 全选
const handleSelectAll = async () => {
    if (!selectedLevelId.value) return

    batchUpdating.value = true
    try {
        const levelId = parseInt(selectedLevelId.value)
        // 获取当前筛选后的所有节点ID
        const nodeIds = filteredNodes.value.map((n) => n.nodeId)

        // 获取当前已授权的节点ID
        const currentAccessIds = currentLevelNodes.value.filter((n) => n.hasAccess).map((n) => n.nodeId)

        // 合并：保留已授权的 + 新增筛选后的
        const allNodeIds = [...new Set([...currentAccessIds, ...nodeIds])]

        const result = await useApiFetch<boolean>('/api/v1/admin/access/batch', {
            method: 'POST',
            body: { levelId, nodeIds: allNodeIds },
            transform: (response) => response.success,
        })

        if (result) {
            toast.success('批量授权成功')
            await loadMatrix()
        }
    } finally {
        batchUpdating.value = false
    }
}

// 全不选
const handleDeselectAll = async () => {
    if (!selectedLevelId.value) return

    batchUpdating.value = true
    try {
        const levelId = parseInt(selectedLevelId.value)
        // 获取当前筛选后的节点ID
        const filteredNodeIds = new Set(filteredNodes.value.map((n) => n.nodeId))

        // 保留不在筛选范围内的已授权节点
        const remainingNodeIds = currentLevelNodes.value
            .filter((n) => n.hasAccess && !filteredNodeIds.has(n.nodeId))
            .map((n) => n.nodeId)

        const result = await useApiFetch<boolean>('/api/v1/admin/access/batch', {
            method: 'POST',
            body: { levelId, nodeIds: remainingNodeIds },
            transform: (response) => response.success,
        })

        if (result) {
            toast.success('批量撤销成功')
            await loadMatrix()
        }
    } finally {
        batchUpdating.value = false
    }
}

onMounted(() => {
    loadMatrix()
})
</script>
