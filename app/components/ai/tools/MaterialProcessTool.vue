<script setup lang="ts">
import type { ExtendedToolState } from '@/components/ai-elements/types'
import { CheckCircle2 as CheckCircle2Icon, Circle as CircleIcon, Loader2 as Loader2Icon, XCircle as XCircleIcon } from 'lucide-vue-next'

interface MaterialItem {
    id: number
    name: string
    status?: 'pending' | 'recognizing' | 'summarizing' | 'ready' | 'failed'
    embedded?: boolean
}

const props = defineProps<{
    toolName: string
    input?: any
    output?: any
    state: ExtendedToolState
}>()

// 处理中展开看材料状态进度，处理成功后自动收起（header summary 已显示 N/N 已完成）。
// 失败时不切换：若先前在处理中已展开则保持展开让用户立即定位失败条目；
// 历史消息加载时 state 直接进入 output-available，初始化即收起。
const isOpen = ref(false)
watch(() => props.state, (s) => {
    if (s === 'input-available') isOpen.value = true
    else if (s === 'output-available') isOpen.value = false
}, { immediate: true })

const sourceData = computed(() => {
    if (props.output != null) {
        try {
            return typeof props.output === 'string' ? JSON.parse(props.output) : props.output
        } catch { return null }
    }
    return props.input ?? null
})

const materials = computed<MaterialItem[]>(() => sourceData.value?.materials || [])

function inferStatus(m: MaterialItem): MaterialItem['status'] {
    if (m.status) return m.status
    return m.embedded ? 'ready' : 'pending'
}

const summary = computed(() => {
    const total = materials.value.length
    const ready = materials.value.filter(m => inferStatus(m) === 'ready').length
    return { total, ready }
})

function statusLabel(s: MaterialItem['status']) {
    switch (s) {
        case 'pending': return '待识别'
        case 'recognizing': return '识别中'
        case 'summarizing': return '提取摘要中'
        case 'ready': return '已完成'
        case 'failed': return '识别失败'
        default: return ''
    }
}
</script>

<template>
    <Tool v-model:open="isOpen">
        <ToolHeader title="材料处理" type="tool-process_materials" :state="state">
            <template #extra>
                <span v-if="materials.length" class="text-xs text-muted-foreground">
                    {{ summary.ready }}/{{ summary.total }} 已完成
                </span>
            </template>
        </ToolHeader>
        <ToolContent v-if="materials.length > 0">
            <div class="p-4">
                <ul class="space-y-2">
                    <li v-for="m in materials" :key="m.id" class="flex items-center gap-2 text-sm">
                        <CheckCircle2Icon
                            v-if="inferStatus(m) === 'ready'"
                            class="size-4 shrink-0 text-emerald-500"
                        />
                        <XCircleIcon
                            v-else-if="inferStatus(m) === 'failed'"
                            class="size-4 shrink-0 text-destructive"
                        />
                        <Loader2Icon
                            v-else-if="inferStatus(m) === 'recognizing' || inferStatus(m) === 'summarizing'"
                            class="size-4 shrink-0 text-blue-500 animate-spin"
                        />
                        <CircleIcon v-else class="size-4 shrink-0 text-muted-foreground/40" />
                        <span class="text-foreground line-clamp-1 break-words flex-1">{{ m.name }}</span>
                        <span
                            class="text-xs shrink-0"
                            :class="{
                                'text-muted-foreground': ['pending', 'ready'].includes(inferStatus(m) ?? ''),
                                'text-blue-500': ['recognizing', 'summarizing'].includes(inferStatus(m) ?? ''),
                                'text-destructive': inferStatus(m) === 'failed',
                            }"
                        >{{ statusLabel(inferStatus(m)) }}</span>
                    </li>
                </ul>
            </div>
        </ToolContent>
    </Tool>
</template>
