<template>
    <div class="article-sort-tree">
        <!-- 加载状态 -->
        <div v-if="loading" class="flex justify-center py-8">
            <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
        </div>

        <!-- 空状态 -->
        <div v-else-if="!treeData.length" class="text-center py-8 text-muted-foreground">
            暂无条文数据
        </div>

        <!-- 排序树 -->
        <div v-else class="space-y-1">
            <VueDraggable v-model="treeData" :animation="200" handle=".drag-handle" ghost-class="opacity-50"
                @end="handleDragEnd">
                <template v-for="node in treeData" :key="node.id">
                    <LegalSortTreeItem :node="node" :expanded-keys="expandedKeys" :loading-keys="loadingKeys"
                        @toggle="handleToggle" @children-sort="handleChildrenSort" />
                </template>
            </VueDraggable>
        </div>
    </div>
</template>

<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'
import type { SortTreeNode, ArticleType } from '#shared/types/legal'

/** Props */
const props = defineProps<{
    legalId: string
}>()

/** Emits */
const emit = defineEmits<{
    change: [items: { id: string; order: number }[]]
}>()

/** 树数据 */
const treeData = ref<SortTreeNode[]>([])

/** 加载状态 */
const loading = ref(false)

/** 已展开的节点 */
const expandedKeys = ref<Set<string>>(new Set())

/** 正在加载子节点的节点 */
const loadingKeys = ref<Set<string>>(new Set())

/** 加载顶层节点 */
const loadTopLevel = async () => {
    loading.value = true
    try {
        const data = await useApiFetch<SortTreeNode[]>('/api/v1/admin/legal-articles/sort-tree', {
            query: { legalId: props.legalId },
        })
        if (data) {
            treeData.value = data
        }
    } finally {
        loading.value = false
    }
}

/** 加载子节点 */
const loadChildren = async (node: SortTreeNode): Promise<SortTreeNode[]> => {
    const data = await useApiFetch<SortTreeNode[]>('/api/v1/admin/legal-articles/sort-tree', {
        query: {
            legalId: props.legalId,
            parentPath: node.pathKey,
            parentType: node.type,
        },
    })
    return data || []
}

/** 切换展开/折叠 */
const handleToggle = async (node: SortTreeNode) => {
    const key = node.id

    if (expandedKeys.value.has(key)) {
        // 折叠
        expandedKeys.value.delete(key)
        expandedKeys.value = new Set(expandedKeys.value)
    } else {
        // 展开，需要加载子节点
        if (node.childCount > 0 && !node.children?.length) {
            loadingKeys.value.add(key)
            loadingKeys.value = new Set(loadingKeys.value)

            try {
                const children = await loadChildren(node)
                node.children = children
            } finally {
                loadingKeys.value.delete(key)
                loadingKeys.value = new Set(loadingKeys.value)
            }
        }

        expandedKeys.value.add(key)
        expandedKeys.value = new Set(expandedKeys.value)
    }
}

/** 处理顶层拖拽结束 */
const handleDragEnd = () => {
    // 更新排序序号
    const items = treeData.value.map((node, index) => ({
        id: node.id,
        order: index + 1,
    }))
    emit('change', items)
}

/** 处理子节点排序变化 */
const handleChildrenSort = (parentNode: SortTreeNode, children: SortTreeNode[]) => {
    // 更新父节点的 children
    parentNode.children = children

    // 生成排序更新项
    const items = children.map((node, index) => ({
        id: node.id,
        order: index + 1,
    }))
    emit('change', items)
}

// 初始加载
onMounted(() => {
    loadTopLevel()
})

// 暴露刷新方法
defineExpose({
    refresh: loadTopLevel,
})
</script>
