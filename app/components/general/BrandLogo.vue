<script setup lang="ts">
/**
 * 品牌 Logo 组件
 *
 * 统一封装 dashboard / admin / 前台 4 处 logo 渲染。
 * 设计规则（用户拍板）：
 * 1. 浅 / 暗主题视觉效果一致——固定浅色圆角盒 + 彩色 logo,**不做主题感应反相**
 *    - 浅色模式:浅盒在浅背景上隐没,但仍提供边框/阴影区分
 *    - 暗色模式:浅盒在深背景上凸显,logo 永远在浅底盒内对比清晰
 * 2. logo 用彩色版本 /logo.svg(蓝绿渐变),浅底盒确保深蓝色 #090380 部分也可见
 *
 * 历史教训:之前 4 处各自不同(有 dark:invert / 有切换 svg / 无盒 / 黑盒+dark:bg-zinc-100),
 * 暗色模式下要么颜色错乱要么对比度差。统一抽到本组件后只需在此调一处。
 */
import { computed } from 'vue'
import { cn } from '~/lib/utils'

interface Props {
    /**
     * 尺寸预设
     * - sm: 24×24 容器,16×16 logo(顶栏 / 紧凑场景)
     * - md: 32×32 容器,24×24 logo(sidebar header,默认)
     * - lg: 36×36 容器,28×28 logo(着陆页 hero 等)
     */
    size?: 'sm' | 'md' | 'lg'
    class?: string
}

const props = withDefaults(defineProps<Props>(), { size: 'md' })

const sizeClass = computed(() => {
    const map = {
        sm: { outer: 'size-6', inner: 'size-4' },
        md: { outer: 'size-8', inner: 'size-6' },
        lg: { outer: 'size-9', inner: 'size-7' },
    }
    return map[props.size]
})
</script>

<template>
    <span
        :class="cn(
            'inline-flex aspect-square shrink-0 items-center justify-center rounded-md bg-zinc-100 ring-1 ring-zinc-200/80 shadow-sm',
            sizeClass.outer,
            props.class,
        )"
    >
        <img src="/logo.svg" :class="sizeClass.inner" alt="LexSeek" />
    </span>
</template>
