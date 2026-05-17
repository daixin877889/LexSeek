<template>
    <!-- 条文类型徽章 -->
    <span :class="typeClass">
        {{ typeName }}
    </span>
</template>

<script setup lang="ts">
import type { ArticleType } from '#shared/types/legal'
import { getAdminLegalArticleTypeBadgeClass } from '~/utils/adminBrandStyles'

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

/** 类型名称 */
const typeName = computed(() => typeNameMap[props.type] || props.type)

/** 类型样式类 */
const typeClass = computed(() => {
    const baseClass = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium'
    return `${baseClass} ${getAdminLegalArticleTypeBadgeClass(props.type)}`
})
</script>
