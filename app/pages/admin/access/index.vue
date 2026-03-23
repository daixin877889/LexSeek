<template>
    <div class="space-y-6">
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
                    <SelectTrigger class="w-full md:w-48">
                        <SelectValue placeholder="选择会员级别" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem v-for="level in matrix.levels" :key="level.id" :value="String(level.id)">
                            {{ level.name }}
                        </SelectItem>
                    </SelectContent>
                </Select>

                <Select v-model="typeFilter">
                    <SelectTrigger class="w-full md:w-40">
                        <SelectValue placeholder="节点类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">全部类型</SelectItem>
                        <SelectItem v-for="(label, value) in NodeTypeLabels" :key="value" :value="value">
                            {{ label }}
                        </SelectItem>
                    </SelectContent>
                </Select>

                <div class="flex-1">
                    <Input v-model="keyword" placeholder="搜索节点名称/标题..." class="w-full md:w-64" />
                </div>

                <div class="flex gap-2">
                    <Button variant="outline" size="sm" @click="handleSelectAll"
                        :disabled="!selectedLevelId || batchUpdating">
                        <CheckSquare class="h-4 w-4 mr-1" />
                        全选
                    </Button>
                    <Button variant="outline" size="sm" @click="handleDeselectAll"
                        :disabled="!selectedLevelId || batchUpdating">
                        <Square class="h-4 w-4 mr-1" />
                        全不选
                    </Button>
                </div>
            </div>

            <!-- 统计信息 -->
            <div v-if="selectedLevelId" class="flex items-center gap-4 text-sm text-muted-foreground">
                <span>已授权: {{ accessCount }} / {{ filteredNodes.length }} 个节点</span>
                <span class="text-xs">（点击复选框切换权限，修改自动保存）</span>
            </div>

            <!-- 节点列表 -->
            <div v-if="selectedLevelId" class="bg-card rounded-lg border">
                <div v-if="!filteredNodes.length" class="flex flex-col items-center justify-center py-12 text-center">
                    <Search class="h-8 w-8 text-muted-foreground/50 mb-2" />
                    <p class="text-muted-foreground text-sm">没有匹配的节点</p>
                </div>

                <div v-else class="divide-y">
                    <div v-for="node in filteredNodes" :key="node.nodeId"
                        class="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                        <div class="flex items-center gap-3 flex-1 min-w-0">
                            <Checkbox :checked="node.hasAccess"
                                :disabled="updating[`${selectedLevelId}-${node.nodeId}`]"
                                @update:checked="(checked: boolean) => handleToggleAccess(node.nodeId, checked)" />
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="font-medium truncate">{{ node.nodeTitle || node.nodeName }}</span>
                                    <Badge :variant="NodeTypeVariants[node.nodeType as keyof typeof NodeTypeVariants] || 'default'" class="text-xs shrink-0">
                                        {{ NodeTypeLabels[node.nodeType as keyof typeof NodeTypeLabels] || node.nodeType }}
                                    </Badge>
                                </div>
                                <p class="text-xs text-muted-foreground font-mono truncate">{{ node.nodeName }}</p>
                            </div>
                        </div>
                        <div class="shrink-0 ml-4">
                            <Badge v-if="node.hasAccess" variant="default" class="text-xs">已授权</Badge>
                            <Badge v-else variant="outline" class="text-xs">未授权</Badge>
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
import { NodeTypeLabels, NodeTypeVariants } from '#shared/types/node'

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
    const key = `${levelId}-${nodeId}`
    updating.value[key] = true

    try {
        const endpoint = checked ? '/api/v1/admin/access/grant' : '/api/v1/admin/access/revoke'
        const result = await useApiFetch(endpoint, {
            method: 'POST',
            body: { levelId, nodeId },
        })

        if (result !== null) {
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

        const result = await useApiFetch('/api/v1/admin/access/batch', {
            method: 'POST',
            body: { levelId, nodeIds: allNodeIds },
        })

        if (result !== null) {
            toast.success('批量授权成功')
            loadMatrix()
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

        const result = await useApiFetch('/api/v1/admin/access/batch', {
            method: 'POST',
            body: { levelId, nodeIds: remainingNodeIds },
        })

        if (result !== null) {
            toast.success('批量撤销成功')
            loadMatrix()
        }
    } finally {
        batchUpdating.value = false
    }
}

onMounted(() => {
    loadMatrix()
})
</script>
