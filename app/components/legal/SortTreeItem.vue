<template>
    <div class="sort-tree-item">
        <!-- 节点行 -->
        <div :class="[
            'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
            'hover:bg-muted/50',
            getNodeBgClass(node.type),
        ]" :style="{ marginLeft: `${node.depth * 24}px` }">
            <!-- 拖拽手柄 -->
            <div class="drag-handle cursor-grab active:cursor-grabbing p-1 -ml-1 rounded hover:bg-muted">
                <GripVertical class="h-4 w-4 text-muted-foreground" />
            </div>

            <!-- 展开/折叠按钮 -->
            <button v-if="node.childCount > 0" class="p-0.5 rounded hover:bg-muted transition-colors"
                :disabled="loadingKeys.has(node.id)" @click.stop="$emit('toggle', node)">
                <Loader2 v-if="loadingKeys.has(node.id)" class="h-4 w-4 animate-spin text-muted-foreground" />
                <ChevronDown v-else-if="expandedKeys.has(node.id)" class="h-4 w-4 text-primary" />
                <ChevronRight v-else class="h-4 w-4 text-muted-foreground" />
            </button>
            <div v-else class="w-5" />

            <!-- 类型标签 -->
            <span :class="getTypeClass(node.type)">
                {{ getTypeName(node.type) }}
            </span>

            <!-- 标题 -->
            <span class="flex-1 text-sm truncate" :class="getTitleClass(node.type)">
                {{ node.title }}
            </span>

            <!-- 子节点数量 -->
            <span v-if="node.childCount > 0" class="text-xs text-muted-foreground">
                {{ node.childCount }} 项
            </span>
        </div>

        <!-- 子节点列表（可拖拽） -->
        <div v-if="expandedKeys.has(node.id) && node.children?.length" class="mt-1">
            <VueDraggable :model-value="node.children" :animation="200" handle=".drag-handle" ghost-class="opacity-50"
                @update:model-value="handleChildrenUpdate">
                <template v-for="child in node.children" :key="child.id">
                    <LegalSortTreeItem :node="child" :expanded-keys="expandedKeys" :loading-keys="loadingKeys"
                        @toggle="$emit('toggle', $event)"
                        @children-sort="(parent, children) => $emit('children-sort', parent, children)" />
                </template>
            </VueDraggable>
        </div>
    </div>
</template>

<script setup lang="ts">
import { GripVertical, ChevronRight, ChevronDown, Loader2 } from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'
import type { SortTreeNode, ArticleType } from '#shared/types/legal'

/** Props */
const props = defineProps<{
    node: SortTreeNode
    expandedKeys: Set<string>
    loadingKeys: Set<string>
}>()

/** Emits */
const emit = defineEmits<{
    toggle: [node: SortTreeNode]
    'children-sort': [parent: SortTreeNode, children: SortTreeNode[]]
}>()

/** 获取类型名称 */
const getTypeName = (type: ArticleType): string => {
    const typeMap: Record<string, string> = {
        notice: '通知',
        header: '头部',
        footer: '尾部',
        annex: '附件',
        l1: '编',
        l2: '分编',
        l3: '章',
        l4: '节',
        l5: '条',
    }
    return typeMap[type] || type
}

/** 获取类型样式 */
const getTypeClass = (type: ArticleType): string => {
    const baseClass = 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0'
    const typeClasses: Record<string, string> = {
        l1: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
        l2: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        l3: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
        l4: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
        l5: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    }
    return `${baseClass} ${typeClasses[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'}`
}

/** 获取标题样式 */
const getTitleClass = (type: ArticleType): string => {
    const classes: Record<string, string> = {
        l1: 'font-bold',
        l2: 'font-semibold',
        l3: 'font-medium',
        l4: 'font-medium text-muted-foreground',
        l5: '',
    }
    return classes[type] || 'text-muted-foreground'
}

/** 获取节点背景样式 */
const getNodeBgClass = (type: ArticleType): string => {
    const classes: Record<string, string> = {
        l1: 'bg-red-50/30 dark:bg-red-950/10',
        l2: 'bg-green-50/20 dark:bg-green-950/10',
        l3: 'bg-orange-50/20 dark:bg-orange-950/10',
        l4: 'bg-purple-50/10 dark:bg-purple-950/5',
        l5: 'bg-background',
    }
    return classes[type] || 'bg-background'
}

/** 处理子节点更新 */
const handleChildrenUpdate = (newChildren: SortTreeNode[]) => {
    emit('children-sort', props.node, newChildren)
}
</script>
