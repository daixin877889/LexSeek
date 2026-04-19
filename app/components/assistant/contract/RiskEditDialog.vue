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

const props = defineProps<{ open: boolean; risk: Risk | null }>()
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
    risk: string
    suggestion: string
    suggestedClauseText: string
}

const emptyForm = (): FormState => ({
    clauseIndex: 0, clauseText: '', level: 'medium', category: '', problem: '',
    legalBasis: '', analysis: '', risk: '', suggestion: '', suggestedClauseText: '',
})

const fromRisk = (r: Risk): FormState => ({
    clauseIndex: r.clauseIndex, clauseText: r.clauseText, level: r.level,
    category: r.category, problem: r.problem, legalBasis: r.legalBasis ?? '',
    analysis: r.analysis, risk: r.risk, suggestion: r.suggestion,
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
    if (!f.problem.trim() || !f.analysis.trim() || !f.risk.trim() || !f.suggestion.trim()) return false
    if (f.level !== 'low' && !f.suggestedClauseText.trim()) return false
    return true
})

function handleConfirm() {
    if (!canSubmit.value) return
    const f = form.value
    emit('confirm', {
        id: props.risk?.id ?? crypto.randomUUID(),
        clauseIndex: typeof f.clauseIndex === 'number' ? f.clauseIndex : Number(f.clauseIndex),
        clauseText: f.clauseText,
        level: f.level,
        category: f.category,
        problem: f.problem,
        legalBasis: f.legalBasis.trim() || undefined,
        analysis: f.analysis,
        risk: f.risk,
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
    { key: 'clauseText', label: '原文条款', rows: 3, placeholder: '粘贴原合同的该段落...' },
    { key: 'problem', label: '问题概述', rows: 2, placeholder: '问题概述文本' },
    { key: 'legalBasis', label: '法律依据', rows: 2, placeholder: '如：《民法典》第 509 条...', optional: true },
    { key: 'analysis', label: '条款分析', rows: 3, placeholder: '条款分析文本' },
    { key: 'risk', label: '法律风险', rows: 3, placeholder: '法律风险文本' },
    { key: 'suggestion', label: '修改建议', rows: 3, placeholder: '修改建议文本' },
]

const levelOptions: Array<{ value: RiskLevel; label: string }> = [
    { value: 'high', label: '高' },
    { value: 'medium', label: '中' },
    { value: 'low', label: '低' },
]
</script>

<template>
    <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
        <DialogContent class="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <DialogTitle>{{ risk ? '编辑风险' : '新增风险' }}</DialogTitle>
            </DialogHeader>

            <div class="space-y-4 py-2">
                <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                        <Label for="risk-clause-index">条款序号（段落 index，从 0 开始）</Label>
                        <Input id="risk-clause-index" v-model="form.clauseIndex" type="number" min="0" />
                    </div>
                    <div class="space-y-1">
                        <Label>风险级别</Label>
                        <RadioGroup v-model="form.level" class="flex gap-3">
                            <div v-for="opt in levelOptions" :key="opt.value" class="flex items-center gap-1">
                                <RadioGroupItem :id="`risk-lv-${opt.value}`" :value="opt.value" />
                                <Label :for="`risk-lv-${opt.value}`">{{ opt.label }}</Label>
                            </div>
                        </RadioGroup>
                    </div>
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

            <DialogFooter>
                <Button variant="outline" @click="handleCancel">取消</Button>
                <Button :disabled="!canSubmit" @click="handleConfirm">确认</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
