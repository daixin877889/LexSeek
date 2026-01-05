<template>
    <!-- 法律状态徽章 -->
    <span :class="statusClass">
        {{ statusText }}
    </span>
</template>

<script setup lang="ts">
import dayjs from 'dayjs'

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
    const status = statusText.value
    if (status === '有效') {
        return `${baseClass} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
    }
    if (status === '已失效') {
        return `${baseClass} bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
    }
    return `${baseClass} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400`
})
</script>
