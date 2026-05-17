<script setup lang="ts">
/**
 * 单条风险卡片（纯卡片形态）
 *
 * 重做后职责收敛为「纯卡片」：等级徽章 + 类别 + 钉按钮 + 右向箭头（指示点开抽屉）、
 * 自动换行的状态徽章行、2 行截断的问题概述。点击整卡 emit focus，由父组件打开
 * 风险详情抽屉（RiskDetailPanel）承载详情与操作——本组件不再就地展开详情。
 *
 * 支持三种变体（按 risk 字段派生）：
 * - main：主清单
 * - orphaned：原文已修改、无法定位（isOrphaned 透传）
 * - external：客户外部新增（risk.source === 'external_new'）
 */
import { ChevronRightIcon, Pin, TriangleAlert, ClipboardList, CheckCircle2Icon, SparklesIcon } from 'lucide-vue-next'
import type { RiskDisplayPhaseB, RiskArchivedStatus, PlaybookSnapshot, RiskLevel } from '#shared/types/contract'
import { RISK_LEVEL_LABEL } from '#shared/types/contract'
import { RISK_LEVEL_BADGE_CLASS as LEVEL_CLASS, CLIENT_REDLINE_BADGE, RISK_ARCHIVED_STATUS_LABEL } from '~/utils/contractRiskLevelStyle'

const props = defineProps<{
    risk: RiskDisplayPhaseB
    /** 卡片视觉状态 */
    isFocused?: boolean
    isPinned?: boolean
    isHovered?: boolean
    isJustAdded?: boolean
    /** 孤立分支：原文已修改、无法定位 */
    isOrphaned?: boolean
    archivedStatus?: RiskArchivedStatus | null
    /** 未定位徽章 */
    notLocated?: boolean
    /** playbook 快照：用于显示匹配的合规检查项徽章 */
    playbookSnapshot?: PlaybookSnapshot | null
}>()

const emit = defineEmits<{
    focus: [riskId: string]
    'toggle-pin': [riskId: string]
}>()

/** 客户外部新增变体（非孤立 + source=external_new） */
const isExternal = computed(() => !props.isOrphaned && props.risk.source === 'external_new')

const matchedPointTitle = computed(() => {
    if (!props.risk.matchedPointCode) return null
    return props.playbookSnapshot?.points.find(p => p.code === props.risk.matchedPointCode)?.title ?? null
})

const showBadges = computed(() =>
    !!props.archivedStatus
    || (!!props.risk.originalClauseText && !props.isOrphaned)
    || !!props.risk.clientRedlineDecision
    || !!props.isOrphaned
    || !!props.notLocated
    || (!!matchedPointTitle.value && !props.isOrphaned),
)

/** 焦点 / 悬停态按风险等级色着色（与文档段落高亮一致） */
const LEVEL_FOCUS: Record<RiskLevel, string> = {
    high: 'bg-red-600/10 border-l-red-600 ring-2 ring-red-600/40',
    medium: 'bg-amber-600/12 border-l-amber-600 ring-2 ring-amber-600/40',
    low: 'bg-sky-500/10 border-l-sky-500 ring-2 ring-sky-500/40',
}
const LEVEL_HOVER: Record<RiskLevel, string> = {
    high: 'bg-red-600/8',
    medium: 'bg-amber-600/9',
    low: 'bg-sky-500/8',
}

/** 卡片分态着色：刚新增 > 焦点 > 钉住 > 悬停 > 孤立/外部变体 > 基线 */
const cardStateClass = computed<string>(() => {
    if (props.isJustAdded) return 'bg-yellow-400/15 border-l-border ring-2 ring-yellow-400/55'
    if (props.isFocused) return LEVEL_FOCUS[props.risk.level]
    if (props.isPinned) return 'bg-orange-500/8 border-l-orange-500'
    if (props.isHovered) return `${LEVEL_HOVER[props.risk.level]} border-l-border`
    if (props.isOrphaned) return 'bg-amber-600/5 border-l-amber-400'
    if (isExternal.value) return 'bg-orange-500/5 border-l-orange-500'
    return 'bg-card border-l-border'
})

function onCardClick() {
    emit('focus', props.risk.id)
}
</script>

<template>
    <div
        :data-risk-id="risk.id"
        :data-just-added="isJustAdded ? 'true' : 'false'"
        class="relative rounded-[9px] border border-border border-l-[3px] cursor-pointer transition-colors px-2.5 py-2.5 pl-[11px]"
        :class="[cardStateClass, { 'opacity-60': !!archivedStatus }]"
        @click="onCardClick"
    >
        <!-- 流式冒出标记 -->
        <span
            v-if="isJustAdded"
            class="absolute top-1.5 left-1.5 text-[9px] font-semibold bg-yellow-400/30 text-yellow-800 dark:text-yellow-200 px-1.5 py-px rounded"
        >刚刚</span>

        <!-- 第一行：等级徽章 + 类别 + 钉按钮 + 右向箭头 -->
        <div class="flex items-center gap-2 min-w-0">
            <span
                class="shrink-0 text-[11px] font-semibold px-1.5 py-px rounded"
                :class="LEVEL_CLASS[risk.level]"
            >{{ RISK_LEVEL_LABEL[risk.level] }}</span>
            <span class="flex-1 min-w-0 text-[13px] font-semibold truncate">{{ risk.category }}</span>
            <button
                v-if="!isOrphaned"
                type="button"
                class="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors"
                :class="isPinned
                    ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                    : 'text-muted-foreground hover:bg-muted'"
                :aria-label="isPinned ? '取消钉住' : '钉住'"
                @click.stop="emit('toggle-pin', risk.id)"
            >
                <Pin class="size-3" />
                <span v-if="isPinned">已钉</span>
            </button>
            <ChevronRightIcon class="size-3.5 shrink-0 text-muted-foreground" />
        </div>

        <!-- 第二行：状态徽章（自动换行） -->
        <div v-if="showBadges" class="flex flex-wrap gap-1 mt-1.5">
            <span
                v-if="archivedStatus"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded bg-emerald-600/12 text-emerald-700 dark:text-emerald-300"
            >
                <CheckCircle2Icon class="size-2.5" />
                {{ RISK_ARCHIVED_STATUS_LABEL[archivedStatus] }}
            </span>
            <span
                v-if="risk.originalClauseText && !isOrphaned"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded bg-primary/10 text-primary"
            >
                <SparklesIcon class="size-2.5" />
                AI 已重审
            </span>
            <span
                v-if="risk.clientRedlineDecision"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded"
                :class="CLIENT_REDLINE_BADGE[risk.clientRedlineDecision].class"
            >
                <component :is="CLIENT_REDLINE_BADGE[risk.clientRedlineDecision].icon" class="size-2.5" />
                {{ CLIENT_REDLINE_BADGE[risk.clientRedlineDecision].label }}
            </span>
            <span
                v-if="isOrphaned"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded bg-amber-600/12 text-amber-700 dark:text-amber-300"
            >
                <TriangleAlert class="size-2.5" />
                原文已修改
            </span>
            <span
                v-if="matchedPointTitle && !isOrphaned"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded bg-muted text-muted-foreground border"
            >
                <ClipboardList class="size-2.5" />
                {{ matchedPointTitle }}
            </span>
            <span
                v-if="notLocated"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-px rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
            >
                <TriangleAlert class="size-2.5" />
                未定位
            </span>
        </div>

        <!-- 问题概述（2 行截断） -->
        <div class="mt-1.5 text-xs text-muted-foreground leading-snug line-clamp-2">{{ risk.problem }}</div>
    </div>
</template>
