<script setup lang="ts">
/**
 * 品牌 Logo 组件
 *
 * 彩色渐变图标（/logo.svg）裸图直出，**不加外框**——与设计稿一致。
 * dashboard 侧边栏 / dashboard 顶栏 / admin / 营销头部 4 处共用，尺寸由 size 控制。
 */
import { computed } from 'vue'
import { cn } from '~/lib/utils'

interface Props {
    /** 尺寸预设：sm 24px / md 32px / lg 36px */
    size?: 'sm' | 'md' | 'lg'
    class?: string
}

const props = withDefaults(defineProps<Props>(), { size: 'md' })

const sizeClass = computed(() => ({ sm: 'size-6', md: 'size-8', lg: 'size-9' }[props.size]))
</script>

<template>
    <img src="/logo.svg" :class="cn('shrink-0', sizeClass, props.class)" alt="LexSeek" />
</template>
