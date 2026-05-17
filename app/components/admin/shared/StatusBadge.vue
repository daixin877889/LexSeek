<template>
    <Badge :variant="variant" :class="toneClass">{{ text }}</Badge>
</template>

<script setup lang="ts" generic="T extends number | string">
import { Badge } from '~/components/ui/badge'

type Variant = 'default' | 'secondary' | 'outline' | 'destructive'

const props = defineProps<{
    /** 状态值（数字或字符串） */
    status: T
    /** 状态值 → 中文文本映射 */
    textMap: Record<string | number, string>
    /** 状态值 → variant 映射 */
    variantMap: Record<string | number, Variant>
}>()

const text = computed(() => props.textMap[props.status as any] ?? '未知')
const variant = computed<Variant>(() => props.variantMap[props.status as any] ?? 'secondary')
const toneClass = computed(() => {
    switch (text.value) {
        case '待支付':
            return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        case '已支付':
        case '支付成功':
            return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        case '已退款':
        case '支付失败':
            return 'border-destructive/25 bg-destructive/10 text-destructive dark:text-red-300'
        case '已取消':
        case '已过期':
            return 'border-border bg-muted text-muted-foreground'
        default:
            return ''
    }
})
</script>
