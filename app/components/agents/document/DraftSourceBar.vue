<script setup lang="ts">
/**
 * 文书页顶部「来源条」（阶段 5 · Task 12）
 *
 * 用途：当用户从法律助手 / 小索（阶段 6）跳转到文书工作区时，
 *      在顶部展示"返回入口对话"+「关联/已关联 案件」两个动作。
 *
 * 显示规则：
 * - 仅当 props.from 为已知入口（'assistant' / 'xiaosuo'）时渲染（外层 page 用 v-if 控制更显式）
 * - caseId 为空 → 右侧显示「+ 关联案件」按钮（点击 emit('link')）
 * - caseId 非空 → 右侧显示「已关联 · {caseTitle} [更换]」（点击 emit('change')）
 *
 * 设计要点：
 * - 纯展示组件：不调接口、不打开 Dialog、不写 query state；
 *   关联/更换的 Dialog 由父页负责（CaseLinkerDialog 由 frontend-cards 提供）
 * - 返回逻辑内置 navigateTo，因为路径生成只与 from + sessionId 有关，无业务副作用
 *
 * 阶段 6 复用：ReviewSourceBar 与本组件结构一致，先各自独立维护，后续若进一步重复再抽公共。
 */
import { ArrowLeftIcon, LinkIcon, CheckCircle2Icon } from 'lucide-vue-next'

interface Props {
    /** 来源入口：'assistant' = 法律助手；'xiaosuo' = 小索（阶段 6 接入） */
    from: 'assistant' | 'xiaosuo' | string
    /** 入口对话的 session id；assistant 走 ?sid=，xiaosuo 走 ?sessionId= */
    sessionId?: string | null
    /** 当前已关联的案件 id；null/undefined 视为未关联 */
    caseId?: number | null
    /** 已关联案件标题（用于显示）；为空时退化为"案件 #id" */
    caseTitle?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
    /** 用户点击「+ 关联案件」 */
    (e: 'link'): void
    /** 用户点击「更换」 */
    (e: 'change'): void
}>()

/** 入口标签：决定按钮文案"返回 X" */
const sourceLabel = computed(() => {
    if (props.from === 'assistant') return '法律助手'
    if (props.from === 'xiaosuo') return '小索'
    return ''
})

/** 已关联展示文案：优先用 caseTitle，缺省时退化为"案件 #id" */
const linkedLabel = computed(() => {
    if (props.caseId == null) return ''
    return props.caseTitle?.trim() || `案件 #${props.caseId}`
})

/** 返回入口对话页 */
function goBackToSource() {
    if (props.from === 'assistant') {
        const target = props.sessionId
            ? `/dashboard/assistant?sid=${encodeURIComponent(props.sessionId)}`
            : '/dashboard/assistant'
        navigateTo(target)
        return
    }
    if (props.from === 'xiaosuo') {
        // 决策 D2(A)：跳回案件详情页 + 自动展开小索浮窗 + 定位对应 session
        const base = `/dashboard/cases/${props.caseId ?? ''}`
        const params = new URLSearchParams({ focus: 'xiaosuo' })
        if (props.sessionId) params.set('xiaosuoSessionId', props.sessionId)
        navigateTo(`${base}?${params.toString()}`)
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

        <!-- 决策 D3(C)：小索路径下完全隐藏关联状态区域 -->
        <template v-if="from !== 'xiaosuo'">
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
        </template>
    </div>
</template>
