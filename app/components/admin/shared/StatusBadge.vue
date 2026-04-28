<template>
    <Badge :variant="variant">{{ text }}</Badge>
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
</script>
