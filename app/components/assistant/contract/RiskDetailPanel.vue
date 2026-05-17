<script setup lang="ts">
/**
 * 风险详情抽屉
 *
 * 点风险卡 / 合同正文高亮段落 / 总览要点后，覆盖整个风险清单栏的详情面板。
 * 承载原先散落在 RiskCard 内联展开区的全部详情渲染：
 * - 抽屉头：等级徽章 + 类别 + 上一条/下一条导航 + 关闭
 * - 抽屉体：状态徽章行 + 问题概述 + 分段/对照段控 + 条款差异 + 法律依据/分析/风险/建议 + 批注对话线
 * - 抽屉底：编辑 / 删除 / 标记已处理 / 标记忽略（孤立风险显示"查看原始语境"）
 *
 * 键盘：Esc 关闭，← → 切换上一条 / 下一条（输入框内不触发方向键）。
 */
import {
    XIcon, ChevronLeftIcon, ChevronRightIcon, PencilIcon, Trash2Icon,
    CheckCircle2Icon, XCircleIcon, SendIcon, MessageCircleIcon, SparklesIcon,
    Pin, TriangleAlert, ClipboardList,
} from 'lucide-vue-next'
import type {
    Risk, RiskDisplayPhaseB, RiskArchivedStatus, PlaybookSnapshot, ContractAnnotationEntity,
} from '#shared/types/contract'
import { RISK_LEVEL_LABEL } from '#shared/types/contract'
import { RISK_LEVEL_BADGE_CLASS as LEVEL_CLASS, CLIENT_REDLINE_BADGE } from '~/utils/contractRiskLevelStyle'
import AssistantContractAnnotationBubble from '~/components/assistant/contract/AnnotationBubble.vue'
import AssistantContractRiskClauseDiff from '~/components/assistant/contract/RiskClauseDiff.vue'

const props = defineProps<{
    risk: RiskDisplayPhaseB
    annotations: ContractAnnotationEntity[]
    /** 在当前风险清单展示顺序中的下标，用于上一条 / 下一条 */
    index: number
    total: number
    readOnly: boolean
    isCompleted: boolean
    /** 工作区可编辑：!isRebuilding && isCompleted（父组件算好透传） */
    editable: boolean
    currentUserId?: number | null
    isPinned: boolean
    playbookSnapshot?: PlaybookSnapshot | null
    /** 分段 / 对照布局，受控（父组件持久化） */
    layout: 'stacked' | 'inline-diff'
}>()

const emit = defineEmits<{
    close: []
    prev: []
    next: []
    'toggle-pin': [riskId: string]
    'edit-risk': [risk: Risk]
    'delete-risk': [risk: Risk]
    archive: [riskId: string, status: RiskArchivedStatus | null]
    'add-annotation': [riskId: string, content: string, parentAnnotationId?: number]
    'delete-annotation': [annotationId: number]
    'jump-to-original': [riskId: string]
    'update:layout': [layout: 'stacked' | 'inline-diff']
}>()

const ARCHIVED_STATUS_LABEL: Record<RiskArchivedStatus, string> = {
    handled: '已处理',
    ignored: '已忽略',
}

const LAYOUT_OPTIONS = [
    { k: 'stacked' as const, label: '分段' },
    { k: 'inline-diff' as const, label: '对照' },
]

const reply = ref('')
const replyFocused = ref(false)

const isOrphan = computed(() => !!props.risk.orphaned)
const archived = computed(() => !!props.risk.archivedStatus)
const canSendReply = computed(() => reply.value.trim().length > 0)

function pointByCode(code: string) {
    return props.playbookSnapshot?.points.find(p => p.code === code) ?? null
}
const matchedPoint = computed(() =>
    props.risk.matchedPointCode ? pointByCode(props.risk.matchedPointCode) : null,
)

function handleSendReply() {
    if (!canSendReply.value) return
    emit('add-annotation', props.risk.id, reply.value.trim())
    reply.value = ''
}

function handleArchive(status: RiskArchivedStatus | null) {
    if (props.readOnly) return
    emit('archive', props.risk.id, status)
}

function canDeleteAnnotation(ann: ContractAnnotationEntity): boolean {
    return !props.readOnly && ann.authorType === 'lawyer' && ann.authorUserId === props.currentUserId
}

/** 回复框内 ⌘/Ctrl + Enter 发送 */
function onReplyKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSendReply()
    }
}

/** Esc 关闭 + ← → 上一条 / 下一条（输入框内不触发方向键） */
function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close')
        return
    }
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.key === 'ArrowLeft' && props.index > 0) {
        e.preventDefault()
        emit('prev')
    } else if (e.key === 'ArrowRight' && props.index < props.total - 1) {
        e.preventDefault()
        emit('next')
    }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
    <div
        class="absolute inset-0 z-[6] flex flex-col bg-card rounded-lg shadow-[-8px_0_24px_-14px_rgba(0,0,0,0.22)]"
    >
        <!-- 抽屉头 -->
        <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b">
            <span class="shrink-0 px-2 py-0.5 rounded text-xs font-semibold" :class="LEVEL_CLASS[risk.level]">
                {{ RISK_LEVEL_LABEL[risk.level] }}
            </span>
            <span class="flex-1 min-w-0 text-[13.5px] font-semibold truncate">{{ risk.category }}</span>
            <div class="flex items-center gap-1 shrink-0">
                <button
                    type="button"
                    class="size-[26px] rounded-md border bg-card text-muted-foreground inline-flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"
                    :disabled="index <= 0"
                    aria-label="上一条风险"
                    title="上一条风险（← 方向键）"
                    @click="emit('prev')"
                >
                    <ChevronLeftIcon class="size-3.5" />
                </button>
                <span class="text-[11px] font-mono text-muted-foreground min-w-[38px] text-center">
                    {{ index + 1 }} / {{ total }}
                </span>
                <button
                    type="button"
                    class="size-[26px] rounded-md border bg-card text-muted-foreground inline-flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"
                    :disabled="index >= total - 1"
                    aria-label="下一条风险"
                    title="下一条风险（→ 方向键）"
                    @click="emit('next')"
                >
                    <ChevronRightIcon class="size-3.5" />
                </button>
            </div>
            <span class="w-px h-4 bg-border shrink-0" />
            <button
                type="button"
                class="size-[26px] rounded-md border bg-card text-muted-foreground inline-flex items-center justify-center hover:bg-muted shrink-0"
                aria-label="关闭详情"
                @click="emit('close')"
            >
                <XIcon class="size-3.5" />
            </button>
        </div>

        <!-- 抽屉体 -->
        <div class="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-3.5">
            <!-- 状态徽章 + 问题概述 -->
            <div>
                <div class="flex flex-wrap gap-1.5 mb-2">
                    <button
                        v-if="!isOrphan"
                        type="button"
                        class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors"
                        :class="isPinned
                            ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-transparent'
                            : 'border-border text-muted-foreground hover:bg-muted'"
                        @click="emit('toggle-pin', risk.id)"
                    >
                        <Pin class="size-2.5" />
                        {{ isPinned ? '已钉在原文' : '钉在原文' }}
                    </button>
                    <span
                        v-if="archived"
                        class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-600/12 text-emerald-700 dark:text-emerald-300"
                    >
                        <CheckCircle2Icon class="size-2.5" />
                        {{ ARCHIVED_STATUS_LABEL[risk.archivedStatus!] }}
                    </span>
                    <span
                        v-if="risk.originalClauseText && !isOrphan"
                        class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                    >
                        <SparklesIcon class="size-2.5" />
                        AI 已重审
                    </span>
                    <span
                        v-if="risk.clientRedlineDecision"
                        class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded"
                        :class="CLIENT_REDLINE_BADGE[risk.clientRedlineDecision].class"
                    >
                        <component :is="CLIENT_REDLINE_BADGE[risk.clientRedlineDecision].icon" class="size-2.5" />
                        {{ CLIENT_REDLINE_BADGE[risk.clientRedlineDecision].label }}
                    </span>
                    <span
                        v-if="isOrphan"
                        class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-600/12 text-amber-700 dark:text-amber-300"
                    >
                        <TriangleAlert class="size-2.5" />
                        原文已修改 · 无法定位
                    </span>
                    <TooltipProvider v-if="matchedPoint && !isOrphan">
                        <Tooltip>
                            <TooltipTrigger as-child>
                                <span
                                    class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border cursor-help"
                                >
                                    <ClipboardList class="size-2.5" />
                                    {{ matchedPoint.title }}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent class="max-w-xs text-xs space-y-1">
                                <div class="font-semibold">{{ matchedPoint.title }}</div>
                                <div v-if="matchedPoint.checkContent">
                                    <span class="text-muted-foreground">检查：</span>{{ matchedPoint.checkContent }}
                                </div>
                                <div v-if="matchedPoint.legalBasis">
                                    <span class="text-muted-foreground">法律依据：</span>{{ matchedPoint.legalBasis }}
                                </div>
                                <div v-if="matchedPoint.suggestion">
                                    <span class="text-muted-foreground">建议：</span>{{ matchedPoint.suggestion }}
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div class="text-[13px] leading-relaxed text-foreground">{{ risk.problem }}</div>
            </div>

            <!-- 分段 / 对照布局段控 -->
            <div v-if="!isOrphan" class="inline-flex self-start p-[3px] rounded-lg bg-muted border">
                <button
                    v-for="opt in LAYOUT_OPTIONS"
                    :key="opt.k"
                    type="button"
                    class="px-4 py-1 rounded-md text-xs font-medium transition-colors"
                    :class="layout === opt.k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
                    @click="emit('update:layout', opt.k)"
                >{{ opt.label }}</button>
            </div>

            <!-- 条款 / 差异 -->
            <div
                v-if="isOrphan && risk.originalClauseText"
                class="rounded-md bg-muted px-3 py-2.5 text-[12.5px] text-muted-foreground"
            >
                <div class="flex items-center gap-1.5 text-[11px] font-medium mb-1">
                    <TriangleAlert class="size-3 text-amber-600" />
                    原锚点引文
                </div>
                <div class="italic leading-relaxed whitespace-pre-wrap">{{ risk.originalClauseText }}</div>
            </div>
            <AssistantContractRiskClauseDiff
                v-else-if="!isOrphan"
                :mode="layout"
                :clause-text="risk.clauseText"
                :suggested-clause-text="risk.suggestedClauseText"
                :problematic-quote="risk.problematicQuote ?? null"
                :quote-char-start="risk.quoteCharStart ?? null"
                :quote-char-end="risk.quoteCharEnd ?? null"
                :clause-paragraph-index="risk.clauseParagraphIndex ?? null"
            />

            <!-- 法律依据 / 条款分析 / 法律风险 / 修改建议 -->
            <div v-if="risk.legalBasis">
                <div class="text-[11px] font-medium text-muted-foreground mb-1">法律依据</div>
                <div class="text-[12.5px] leading-relaxed whitespace-pre-wrap">{{ risk.legalBasis }}</div>
            </div>
            <div>
                <div class="text-[11px] font-medium text-muted-foreground mb-1">条款分析</div>
                <div class="text-[12.5px] leading-relaxed whitespace-pre-wrap">{{ risk.analysis }}</div>
            </div>
            <div>
                <div class="text-[11px] font-medium text-muted-foreground mb-1">法律风险</div>
                <div class="text-[12.5px] leading-relaxed whitespace-pre-wrap">{{ risk.risk }}</div>
            </div>
            <div>
                <div class="text-[11px] font-medium text-muted-foreground mb-1">修改建议</div>
                <div class="text-[12.5px] leading-relaxed whitespace-pre-wrap">{{ risk.suggestion }}</div>
            </div>

            <!-- 批注对话线 -->
            <div class="flex flex-col gap-2.5 pt-3 border-t">
                <div class="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <MessageCircleIcon class="size-3" />
                    {{ isOrphan ? '历史讨论' : '批注' }}（{{ annotations.length }}）
                </div>
                <AssistantContractAnnotationBubble
                    v-for="ann in annotations"
                    :key="ann.id"
                    :annotation="ann"
                    :can-delete="canDeleteAnnotation(ann)"
                    @delete="emit('delete-annotation', $event)"
                />
                <div
                    v-if="!isOrphan && !readOnly && isCompleted"
                    class="rounded-lg border bg-background overflow-hidden transition-colors"
                    :class="replyFocused ? 'border-primary ring-[3px] ring-primary/15' : 'border-border'"
                >
                    <textarea
                        v-model="reply"
                        :rows="2"
                        :maxlength="500"
                        placeholder="添加批注…"
                        class="block w-full box-border resize-none px-2.5 pt-2 pb-0.5 border-0 outline-none bg-transparent text-xs leading-relaxed text-foreground"
                        @focus="replyFocused = true"
                        @blur="replyFocused = false"
                        @keydown="onReplyKeydown"
                    />
                    <div class="flex items-center justify-between pl-2.5 pr-1.5 pb-1.5 pt-1">
                        <span class="text-[10.5px] text-muted-foreground">
                            {{ reply.length > 0 ? `${reply.length}/500` : '⌘/Ctrl + Enter 发送' }}
                        </span>
                        <button
                            type="button"
                            class="inline-flex items-center gap-1 h-[26px] px-3 rounded-md text-[11.5px] font-medium transition-colors"
                            :class="canSendReply
                                ? 'bg-gradient-brand-button text-white'
                                : 'bg-muted text-muted-foreground cursor-not-allowed'"
                            :disabled="!canSendReply"
                            aria-label="发送批注"
                            @click="handleSendReply"
                        >
                            <SendIcon class="size-3" />
                            发送
                        </button>
                    </div>
                </div>
                <div
                    v-else-if="readOnly && !isOrphan"
                    class="text-[11.5px] text-muted-foreground italic"
                >只读模式，无法添加批注</div>
            </div>
        </div>

        <!-- 抽屉底 · 操作 -->
        <div class="shrink-0 flex flex-wrap gap-1.5 px-3 py-2.5 border-t bg-muted/30">
            <Button
                v-if="isOrphan"
                size="sm"
                variant="outline"
                @click="emit('jump-to-original', risk.id)"
            >查看原始语境</Button>
            <template v-else>
                <Button
                    size="sm"
                    variant="outline"
                    :disabled="!editable || readOnly"
                    @click="emit('edit-risk', risk)"
                >
                    <PencilIcon class="size-3 mr-1" />编辑
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    class="text-destructive"
                    :disabled="!editable || readOnly"
                    @click="emit('delete-risk', risk)"
                >
                    <Trash2Icon class="size-3 mr-1" />删除
                </Button>
                <template v-if="!readOnly && isCompleted && !archived">
                    <Button
                        size="sm"
                        variant="outline"
                        class="text-green-700 dark:text-green-400 border-green-300 dark:border-green-700"
                        @click="handleArchive('handled')"
                    >
                        <CheckCircle2Icon class="size-3 mr-1" />标记已处理
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        class="text-muted-foreground"
                        @click="handleArchive('ignored')"
                    >
                        <XCircleIcon class="size-3 mr-1" />标记忽略
                    </Button>
                </template>
                <Button
                    v-if="!readOnly && isCompleted && archived"
                    size="sm"
                    variant="outline"
                    @click="handleArchive(null)"
                >撤销处置</Button>
            </template>
        </div>
    </div>
</template>
