<template>
    <!-- 法律类型徽章 -->
    <span :class="typeClass">
        {{ typeName }}
    </span>
</template>

<script setup lang="ts">
import type { LegalType } from '#shared/types/legal'

// 定义 props
const props = defineProps<{
    type: LegalType
}>()

/** 类型名称映射 */
const typeNameMap: Record<string, string> = {
    law: '法律',
    regulation: '行政法规',
    judicial_interp: '司法解释',
    guideline: '指导意见',
}

/** 类型样式映射 */
const typeClassMap: Record<string, string> = {
    law: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    regulation: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    judicial_interp: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    guideline: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
}

/** 类型名称 */
const typeName = computed(() => typeNameMap[props.type] || props.type)

/** 类型样式类 */
const typeClass = computed(() => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
    return `${baseClass} ${typeClassMap[props.type] || typeClassMap.guideline}`
})
</script>
