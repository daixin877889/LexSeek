<template>
    <!-- 法律类型徽章 -->
    <span :class="typeClass">
        {{ typeName }}
    </span>
</template>

<script setup lang="ts">
import type { LegalType } from '#shared/types/legal'
import { getAdminLegalTypeBadgeClass } from '~/utils/adminBrandStyles'

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

/** 类型名称 */
const typeName = computed(() => typeNameMap[props.type] || props.type)

/** 类型样式类 */
const typeClass = computed(() => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
    return `${baseClass} ${getAdminLegalTypeBadgeClass(props.type)}`
})
</script>
