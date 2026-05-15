<script setup lang="ts">
/**
 * 单条风险新增 / 编辑对话框
 *
 * 合同审查 M5：用户手动在风险清单上做 CRUD 时调用此对话框。
 * - risk=null：新增模式（默认 level=medium，id 由前端生成 uuid）
 * - risk 非空：编辑模式（预填字段，id 保留）
 * - 前端按 RISK_SHAPE 规则挡一层：必填非空、clauseIndex ≥ 0 整数、
 *   high/medium 级别必须含 suggestedClauseText。
 *
 * **Feature: contract-review-m5**
 */
import type { Risk, RiskLevel } from '#shared/types/contract'
import { RISK_LEVEL_LABEL } from '#shared/types/contract'

const props = defineProps<{
    open: boolean
    risk: Risk | null
    /** 新增模式下由预览段落预填的原文与段落序号 */
    prefill?: { clauseText: string; clauseParagraphIndex: number } | null
}>()
const emit = defineEmits<{
    'update:open': [value: boolean]
    confirm: [payload: Risk]
    cancel: []
}>()

interface FormState {
    clauseIndex: number | string
    clauseText: string
    level: RiskLevel
    category: string
    problem: string
    legalBasis: string
    analysis: string
    suggestion: string
    suggestedClauseText: string
}

const emptyForm = (): FormState => ({
    clauseIndex: props.prefill?.clauseParagraphIndex ?? 0,
    clauseText: props.prefill?.clauseText ?? '',
    level: 'medium', category: '', problem: '',
    legalBasis: '', analysis: '', suggestion: '', suggestedClauseText: '',
})

const fromRisk = (r: Risk): FormState => ({
    clauseIndex: r.clauseIndex, clauseText: r.clauseText, level: r.level,
    category: r.category, problem: r.problem, legalBasis: r.legalBasis ?? '',
    analysis: r.analysis, suggestion: r.suggestion,
    suggestedClauseText: r.suggestedClauseText ?? '',
})

const form = ref<FormState>(props.risk ? fromRisk(props.risk) : emptyForm())

// 仅在对话框"打开"时重置，避免关闭态下 props 抖动覆盖用户输入
watch(() => props.open, (isOpen, wasOpen) => {
    if (isOpen && !wasOpen) form.value = props.risk ? fromRisk(props.risk) : emptyForm()
})

const canSubmit = computed(() => {
    const f = form.value
    const idx = typeof f.clauseIndex === 'number' ? f.clauseIndex : Number(f.clauseIndex)
    if (!Number.isInteger(idx) || idx < 0) return false
    if (!f.clauseText.trim() || !f.category.trim()) return false
    if (!f.problem.trim() || !f.analysis.trim() || !f.suggestion.trim()) return false
    if (f.level !== 'low' && !f.suggestedClauseText.trim()) return false
    return true
})

function handleConfirm() {
    if (!canSubmit.value) return
    const f = form.value
    emit('confirm', {
        ...(props.risk ?? {}),
        id: props.risk?.id ?? crypto.randomUUID(),
        clauseIndex: typeof f.clauseIndex === 'number' ? f.clauseIndex : Number(f.clauseIndex),
        clauseText: f.clauseText,
        level: f.level,
        category: f.category,
        problem: f.problem,
        legalBasis: f.legalBasis.trim() || undefined,
        analysis: f.analysis,
        // Risk.risk 是必填字段；新增模式无此输入，透传原值或空串
        risk: props.risk?.risk ?? '',
        suggestion: f.suggestion,
        suggestedClauseText: f.suggestedClauseText.trim() || undefined,
    })
    emit('update:open', false)
}

function handleCancel() {
    emit('cancel')
    emit('update:open', false)
}

// 配置化的 Textarea 字段，减少模板重复
const textFields: Array<{ key: keyof FormState; label: string; rows: number; placeholder: string; optional?: boolean }> = [
    { key: 'problem', label: '问题概述', rows: 2, placeholder: '问题概述文本' },
    { key: 'legalBasis', label: '法律依据', rows: 2, placeholder: '如：《民法典》第 509 条...', optional: true },
    { key: 'analysis', label: '条款分析', rows: 3, placeholder: '条款分析文本' },
    { key: 'suggestion', label: '修改建议', rows: 3, placeholder: '修改建议文本' },
]

const levelOptions: Array<{ value: RiskLevel; label: string }> = (
    Object.entries(RISK_LEVEL_LABEL) as [RiskLevel, string][]
).map(([value, label]) => ({ value, label }))
</script>

<template>
    <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
        <DialogContent
            class="flex flex-col gap-0 p-0 w-screen h-dvh max-w-none rounded-none border-0 sm:h-auto sm:max-h-[90vh] sm:w-[80vw] sm:max-w-[80vw] sm:rounded-lg sm:border"
        >
            <DialogHeader class="shrink-0 border-b px-6 py-4">
                <DialogTitle>{{ risk ? '编辑风险' : '新增风险' }}</DialogTitle>
                <DialogDescription class="sr-only">编辑或新增合同风险条目</DialogDescription>
            </DialogHeader>

            <div class="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
                <div class="space-y-1">
                    <Label>风险级别</Label>
                    <RadioGroup v-model="form.level" class="flex gap-3">
                        <div v-for="opt in levelOptions" :key="opt.value" class="flex items-center gap-1">
                            <RadioGroupItem :id="`risk-lv-${opt.value}`" :value="opt.value" />
                            <Label :for="`risk-lv-${opt.value}`">{{ opt.label }}</Label>
                        </div>
                    </RadioGroup>
                </div>

                <div class="space-y-1">
                    <Label for="risk-clause-text">原文条款</Label>
                    <div
                        v-if="risk === null"
                        id="risk-clause-text"
                        class="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap"
                    >{{ form.clauseText }}</div>
                    <Textarea v-else id="risk-clause-text" v-model="form.clauseText" :rows="3" />
                </div>

                <div v-for="field in textFields" :key="field.key" class="space-y-1">
                    <Label :for="`risk-${field.key}`">
                        {{ field.label }}
                        <span v-if="field.optional" class="text-muted-foreground">（可空）</span>
                    </Label>
                    <Textarea
                        :id="`risk-${field.key}`"
                        v-model="(form[field.key] as string)"
                        :rows="field.rows"
                        :placeholder="field.placeholder"
                    />
                </div>

                <div class="space-y-1">
                    <Label for="risk-category">风险类别</Label>
                    <Input id="risk-category" v-model="form.category" placeholder="如：付款条件" />
                </div>

                <div class="space-y-1">
                    <Label for="risk-suggested-clause">
                        建议改写后的条款
                        <span v-if="form.level !== 'low'" class="text-destructive">（高/中风险必填）</span>
                        <span v-else class="text-muted-foreground">（可空）</span>
                    </Label>
                    <Textarea
                        id="risk-suggested-clause"
                        v-model="form.suggestedClauseText"
                        :rows="3"
                        placeholder="替换原条款的完整修订版..."
                    />
                </div>
            </div>

            <DialogFooter class="shrink-0 border-t px-6 py-4">
                <Button variant="outline" @click="handleCancel">取消</Button>
                <Button :disabled="!canSubmit" @click="handleConfirm">确认</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
