<script setup lang="ts">
/**
 * 合同审查工作台顶部「来源条」（阶段 5 · Task 13）
 *
 * 与 DraftSourceBar.vue 行为一致：当用户从法律助手 / 小索（阶段 6）
 * 跳转到合同工作台时，提供"返回入口对话 + 关联案件"入口。
 *
 * 详细约定参见 DraftSourceBar.vue 的注释。两个组件结构一致，
 * 先各自独立维护以适配 vertical 拆分；若后续完全无差异再抽公共。
 */
import { ArrowLeftIcon, LinkIcon, CheckCircle2Icon } from 'lucide-vue-next'

interface Props {
    /** 来源入口：'assistant' = 法律助手；'xiaosuo' = 小索（阶段 6 接入） */
    from: 'assistant' | 'xiaosuo' | string
    /** 入口对话的 session id */
    sessionId?: string | null
    /** 当前已关联案件 id；null/undefined 视为未关联 */
    caseId?: number | null
    /** 已关联案件标题；为空时退化为"案件 #id" */
    caseTitle?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
    (e: 'link'): void
    (e: 'change'): void
}>()

const sourceLabel = computed(() => {
    if (props.from === 'assistant') return '法律助手'
    if (props.from === 'xiaosuo') return '小索'
    return ''
})

const linkedLabel = computed(() => {
    if (props.caseId == null) return ''
    return props.caseTitle?.trim() || `案件 #${props.caseId}`
})

function goBackToSource() {
    if (props.from === 'assistant') {
        const target = props.sessionId
            ? `/dashboard/assistant?sid=${encodeURIComponent(props.sessionId)}`
            : '/dashboard/assistant'
        navigateTo(target)
        return
    }
    if (props.from === 'xiaosuo') {
        const target = props.sessionId
            ? `/dashboard/xiaosuo?sessionId=${encodeURIComponent(props.sessionId)}`
            : '/dashboard/xiaosuo'
        navigateTo(target)
        return
    }
}
</script>

<template>
    <div
        class="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm"
    >
        <Button
            variant="ghost"
            size="sm"
            class="-ml-1"
            @click="goBackToSource"
        >
            <ArrowLeftIcon class="size-4 mr-1" />
            返回 {{ sourceLabel }}
        </Button>

        <div v-if="caseId == null">
            <Button variant="outline" size="sm" @click="emit('link')">
                <LinkIcon class="size-4 mr-1" />
                关联案件
            </Button>
        </div>
        <div v-else class="flex items-center gap-2">
            <span
                class="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 text-emerald-700 dark:text-emerald-300 text-xs"
            >
                <CheckCircle2Icon class="size-3.5" />
                已关联 · {{ linkedLabel }}
            </span>
            <Button variant="ghost" size="sm" @click="emit('change')">
                更换
            </Button>
        </div>
    </div>
</template>
