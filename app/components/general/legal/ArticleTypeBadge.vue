<template>
    <!-- 条文类型徽章 -->
    <span :class="typeClass">
        {{ typeName }}
    </span>
</template>

<script setup lang="ts">
import type { ArticleType } from '#shared/types/legal'

// 定义 props
const props = defineProps<{
    type: ArticleType
}>()

/** 类型名称映射 */
const typeNameMap: Record<string, string> = {
    notice: '通知',
    header: '正文头部',
    footer: '正文尾部',
    annex: '附件',
    l1: '编',
    l2: '分编',
    l3: '章',
    l4: '节',
    l5: '条',
}

/** 类型样式映射 */
const typeClassMap: Record<string, string> = {
    l5: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    l4: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    l3: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    l2: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    l1: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
}

/** 类型名称 */
const typeName = computed(() => typeNameMap[props.type] || props.type)

/** 类型样式类 */
const typeClass = computed(() => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
    return `${baseClass} ${typeClassMap[props.type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'}`
})
</script>
