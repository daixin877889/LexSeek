<template>
    <!-- 法律状态徽章 -->
    <span :class="statusClass">
        {{ statusText }}
    </span>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'
import { getAdminLegalStatusBadgeClass } from '~/utils/adminBrandStyles'

// 定义 props
const props = defineProps<{
    effectiveDate?: string | null
    invalidDate?: string | null
}>()

/** 状态文本 */
const statusText = computed(() => {
    if (props.invalidDate) {
        const invalidDate = dayjs(props.invalidDate)
        if (invalidDate.isBefore(dayjs())) {
            return '已失效'
        }
    }
    if (props.effectiveDate) {
        const effectiveDate = dayjs(props.effectiveDate)
        if (effectiveDate.isAfter(dayjs())) {
            return '未生效'
        }
    }
    return '有效'
})

/** 状态样式类 */
const statusClass = computed(() => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap'
    return `${baseClass} ${getAdminLegalStatusBadgeClass(statusText.value)}`
})
</script>
