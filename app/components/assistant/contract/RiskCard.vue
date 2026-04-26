<script setup lang="ts">
/**
 * 单条风险卡片（主清单 + 孤立两种形态合并）
 *
 * UI-R4：从 RiskListPanel 抽出"主风险清单卡片"和"孤立批注区卡片"两段重复 template。
 * 通过 isOrphaned 切换两种形态：
 * - 主形态：等级徽章 + 分类 + 已处置/AI 已重审/匹配条款/未定位徽章 + 钉住 + 编辑/删除/处置按钮 + 批注对话线（可发布）
 * - 孤立形态：等级徽章 + 分类 + "原文已修改"徽章 + 原锚点引文 + 条款分析/法律风险/修改建议 + 历史讨论（只读）+ "查看原始语境"按钮
 */
import {
    ChevronDownIcon, Pin, TriangleAlert, ClipboardList, CheckCircle2Icon, XCircleIcon,
    SendIcon, MessageCircleIcon, PencilIcon, Trash2Icon, SparklesIcon,
} from 'lucide-vue-next'
import type {
    Risk,
    RiskDisplayPhaseB,
    RiskArchivedStatus,
    PlaybookSnapshot,
    ContractAnnotationEntity,
} from '#shared/types/contract'
import { RISK_LEVEL_LABEL } from '#shared/types/contract'
import { RISK_LEVEL_BADGE_CLASS as LEVEL_CLASS } from '~/utils/contractRiskLevelStyle'
import AssistantContractAnnotationBubble from '~/components/assistant/contract/AnnotationBubble.vue'
import AssistantContractRiskClauseDiff from '~/components/assistant/contract/RiskClauseDiff.vue'

const props = defineProps<{
    risk: RiskDisplayPhaseB
    expanded: boolean
    annotations: ContractAnnotationEntity[]
    readOnly: boolean
    isCompleted: boolean
    /** 工作区编辑可用：!isRebuilding && isCompleted（由父组件计算后透传） */
    editable: boolean
    currentUserId?: number | null
    /** 卡片视觉状态 */
    isFocused?: boolean
    isPinned?: boolean
    isHovered?: boolean
    isJustAdded?: boolean
    /** 孤立分支：去掉处置/编辑/删除按钮，加 originalAnchorQuote 提示与"查看原始语境" */
    isOrphaned?: boolean
    archivedStatus?: RiskArchivedStatus | null
    /** 未定位徽章 */
    notLocated?: boolean
    /** playbook 快照：用于显示匹配的合规检查项 tooltip */
    playbookSnapshot?: PlaybookSnapshot | null
}>()

const emit = defineEmits<{
    toggle: [riskId: string]
    focus: [riskId: string]
    archive: [riskId: string, status: RiskArchivedStatus | null]
    addAnnotation: [riskId: string, content: string, parentAnnotationId?: number]
    deleteAnnotation: [annotationId: number]
    'jump-to-original': [riskId: string]
    togglePin: [riskId: string]
    editRisk: [risk: Risk]
    deleteRisk: [risk: Risk]
}>()

/** 已处置状态文案 */
const ARCHIVED_STATUS_LABEL: Record<RiskArchivedStatus, string> = {
    handled: '已处理',
    ignored: '已忽略',
}

const replyContent = ref('')

function pointByCode(code: string) {
    return props.playbookSnapshot?.points.find(p => p.code === code) ?? null
}

const matchedPoint = computed(() => {
    if (!props.risk.matchedPointCode) return null
    return pointByCode(props.risk.matchedPointCode)
})

const matchedPointTitle = computed(() => matchedPoint.value?.title ?? null)

function onCardClick() {
    emit('toggle', props.risk.id)
    emit('focus', props.risk.id)
}

function handleAddAnnotation() {
    const content = replyContent.value.trim()
    if (!content) return
    emit('addAnnotation', props.risk.id, content)
    replyContent.value = ''
}

function handleArchive(status: RiskArchivedStatus | null) {
    if (props.readOnly) return
    emit('archive', props.risk.id, status)
}
</script>

<template>
    <!-- ============================== 孤立形态 ============================== -->
    <Card
        v-if="isOrphaned"
        :data-risk-id="risk.id"
        class="cursor-pointer relative transition-all border-l-4 border-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
        @click="onCardClick"
    >
        <CardHeader class="py-2 px-3">
            <div class="flex items-center gap-2">
                <span class="inline-block px-2 py-0.5 rounded text-xs shrink-0" :class="LEVEL_CLASS[risk.level]">{{ RISK_LEVEL_LABEL[risk.level] }}</span>
                <span class="text-sm font-medium truncate">{{ risk.category }}</span>
                <Badge variant="secondary" class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
                    <TriangleAlert class="size-2.5" />
                    原文已修改
                </Badge>
                <ChevronDownIcon class="ml-auto size-4 transition-transform shrink-0 text-muted-foreground" :class="{ 'rotate-180': expanded }" />
            </div>
            <div class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ risk.problem }}</div>
        </CardHeader>
        <CardContent v-if="expanded" class="py-2 px-3 text-sm space-y-3" @click.stop>
            <!-- 原锚点提示 -->
            <div v-if="risk.originalAnchorQuote" class="rounded-md bg-muted p-2 text-xs text-muted-foreground space-y-1">
                <div class="font-medium flex items-center gap-1">
                    <TriangleAlert class="size-3 text-amber-500" />
                    原锚点引文
                </div>
                <div class="italic line-clamp-3">{{ risk.originalAnchorQuote }}</div>
            </div>

            <div><div class="text-xs text-muted-foreground">条款分析</div><div class="whitespace-pre-wrap">{{ risk.analysis }}</div></div>
            <div><div class="text-xs text-muted-foreground">法律风险</div><div class="whitespace-pre-wrap">{{ risk.risk }}</div></div>
            <div><div class="text-xs text-muted-foreground">修改建议</div><div class="whitespace-pre-wrap">{{ risk.suggestion }}</div></div>

            <!-- 历史批注链 -->
            <div class="pt-2 border-t space-y-2">
                <div class="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <MessageCircleIcon class="size-3" />
                    历史讨论（{{ annotations.length }}）
                </div>
                <AssistantContractAnnotationBubble
                    v-for="ann in annotations"
                    :key="ann.id"
                    :annotation="ann"
                />
            </div>

            <!-- 查看原始语境按钮 -->
            <div class="pt-2 border-t">
                <Button size="sm" variant="outline" @click="emit('jump-to-original', risk.id)">
                    查看原始语境
                </Button>
            </div>
        </CardContent>
    </Card>

    <!-- ============================== 主形态 ============================== -->
    <Card
        v-else
        :data-risk-id="risk.id"
        :data-just-added="isJustAdded ? 'true' : 'false'"
        class="cursor-pointer relative transition-all"
        :class="{
            'opacity-60 grayscale-[0.2]': !!archivedStatus,
            'bg-yellow-50 dark:bg-yellow-950/40 ring-1 ring-yellow-300 dark:ring-yellow-700': isJustAdded,
            'bg-yellow-50 dark:bg-yellow-950/40 border-l-4 border-red-500 dark:border-red-400': isFocused,
            'bg-orange-50 dark:bg-orange-950/40 border-l-4 border-orange-500 dark:border-orange-400': isPinned && !isFocused,
            'bg-yellow-50 dark:bg-yellow-950/30': isHovered && !isFocused && !isPinned,
        }"
        @click="onCardClick"
    >
        <Badge
            v-if="isJustAdded"
            variant="secondary"
            class="absolute top-1 left-1 bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 text-[10px] px-1.5 py-0 shrink-0"
        >刚刚</Badge>
        <CardHeader class="py-2 px-3">
            <div class="flex items-center gap-2">
                <span class="inline-block px-2 py-0.5 rounded text-xs shrink-0" :class="LEVEL_CLASS[risk.level]">{{ RISK_LEVEL_LABEL[risk.level] }}</span>
                <span class="text-sm font-medium truncate">{{ risk.category }}</span>
                <!-- 已处置徽章 -->
                <Badge
                    v-if="archivedStatus"
                    variant="secondary"
                    class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5"
                >
                    <CheckCircle2Icon class="size-2.5" />
                    {{ ARCHIVED_STATUS_LABEL[archivedStatus] }}
                </Badge>
                <!-- AI 已重审徽章：经历过锚点迁移的风险条目 -->
                <Badge
                    v-if="risk.originalAnchorQuote"
                    variant="secondary"
                    class="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5 bg-primary/10 text-primary"
                >
                    <SparklesIcon class="size-2.5" />
                    AI 已重审
                </Badge>
                <TooltipProvider v-if="matchedPointTitle">
                    <Tooltip>
                        <TooltipTrigger as-child>
                            <Badge
                                variant="secondary"
                                class="text-[10px] px-1.5 py-0 font-normal shrink-0 gap-0.5 flex items-center cursor-help"
                                @click.stop
                            >
                                <ClipboardList class="size-2.5" />
                                {{ matchedPointTitle }}
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent class="max-w-xs text-xs space-y-1">
                            <div class="font-semibold">{{ matchedPointTitle }}</div>
                            <div v-if="matchedPoint?.checkContent">
                                <span class="text-muted-foreground">检查：</span>{{ matchedPoint.checkContent }}
                            </div>
                            <div v-if="matchedPoint?.legalBasis">
                                <span class="text-muted-foreground">法律依据：</span>{{ matchedPoint.legalBasis }}
                            </div>
                            <div v-if="matchedPoint?.suggestion">
                                <span class="text-muted-foreground">建议：</span>{{ matchedPoint.suggestion }}
                            </div>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <span
                    v-if="notLocated"
                    class="text-[10px] px-1.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 flex items-center gap-0.5 shrink-0"
                >
                    <TriangleAlert class="size-2.5" />
                    未定位
                </span>
                <button
                    class="ml-auto text-xs px-1.5 py-0.5 rounded hover:bg-muted flex items-center gap-1 shrink-0"
                    :class="{ 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-200': isPinned }"
                    :aria-label="isPinned ? '取消钉住' : '钉住'"
                    @click.stop="emit('togglePin', risk.id)"
                >
                    <Pin class="size-3" />
                    <span v-if="isPinned">已钉</span>
                </button>
                <ChevronDownIcon class="size-4 transition-transform shrink-0 text-muted-foreground" :class="{ 'rotate-180': expanded }" />
            </div>
            <div class="mt-1 text-xs text-muted-foreground line-clamp-2">{{ risk.problem }}</div>
        </CardHeader>
        <CardContent v-if="expanded" class="py-2 px-3 text-sm space-y-3" @click.stop>
            <AssistantContractRiskClauseDiff :clause-text="risk.clauseText" :suggested-clause-text="risk.suggestedClauseText" />
            <div v-if="risk.legalBasis"><div class="text-xs text-muted-foreground">法律依据</div><div>{{ risk.legalBasis }}</div></div>
            <div><div class="text-xs text-muted-foreground">条款分析</div><div class="whitespace-pre-wrap">{{ risk.analysis }}</div></div>
            <div><div class="text-xs text-muted-foreground">法律风险</div><div class="whitespace-pre-wrap">{{ risk.risk }}</div></div>
            <div><div class="text-xs text-muted-foreground">修改建议</div><div class="whitespace-pre-wrap">{{ risk.suggestion }}</div></div>

            <div class="flex gap-2 pt-2 border-t flex-wrap">
                <Button size="sm" variant="outline" :disabled="!editable || readOnly" @click="emit('editRisk', risk)">
                    <PencilIcon class="size-3 mr-1" />编辑
                </Button>
                <Button size="sm" variant="outline" class="text-destructive" :disabled="!editable || readOnly" @click="emit('deleteRisk', risk)">
                    <Trash2Icon class="size-3 mr-1" />删除
                </Button>
                <template v-if="isCompleted && !readOnly">
                    <Button
                        v-if="!archivedStatus"
                        size="sm"
                        variant="outline"
                        class="text-green-700 dark:text-green-400 border-green-300 dark:border-green-700"
                        @click="handleArchive('handled')"
                    >
                        <CheckCircle2Icon class="size-3 mr-1" />标记已处理
                    </Button>
                    <Button
                        v-if="!archivedStatus"
                        size="sm"
                        variant="outline"
                        class="text-muted-foreground"
                        @click="handleArchive('ignored')"
                    >
                        <XCircleIcon class="size-3 mr-1" />标记忽略
                    </Button>
                    <Button v-if="archivedStatus" size="sm" variant="outline" @click="handleArchive(null)">
                        撤销处置
                    </Button>
                </template>
            </div>

            <!-- 批注对话线 -->
            <div class="pt-2 border-t space-y-2">
                <div class="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <MessageCircleIcon class="size-3" />
                    批注（{{ annotations.length }}）
                </div>

                <AssistantContractAnnotationBubble
                    v-for="ann in annotations"
                    :key="ann.id"
                    :annotation="ann"
                    :can-delete="!readOnly && ann.authorType === 'lawyer' && ann.authorUserId === currentUserId"
                    @delete="emit('deleteAnnotation', $event)"
                />

                <div v-if="!readOnly && isCompleted" class="flex gap-2 mt-2">
                    <Textarea
                        v-model="replyContent"
                        placeholder="添加批注..."
                        :rows="2"
                        :maxlength="500"
                        class="text-xs flex-1"
                        :disabled="readOnly"
                        @keydown.enter.ctrl.prevent="handleAddAnnotation"
                    />
                    <Button
                        size="icon"
                        class="size-8 shrink-0 self-end"
                        :disabled="readOnly || !replyContent.trim()"
                        aria-label="发送批注"
                        @click="handleAddAnnotation"
                    >
                        <SendIcon class="size-3.5" />
                    </Button>
                </div>
                <div v-else-if="readOnly" class="text-xs text-muted-foreground italic">只读模式，无法添加批注</div>
            </div>
        </CardContent>
    </Card>
</template>
