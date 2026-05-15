import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, nextTick, provide } from 'vue'
import RiskEditDialog from '~/components/assistant/contract/RiskEditDialog.vue'
import type { Risk } from '#shared/types/contract'

/**
 * RiskEditDialog 单元测试
 *
 * **Feature: contract-review-m5 + contract-add-risk-hover**
 *
 * - 新增模式（risk=null）：原文条款由 prefill 只读带入，无条款序号输入框
 * - 编辑模式（risk 非空）：预填字段，原文条款可编辑
 * - 必填校验：clauseText / category / problem / analysis / suggestion 非空；
 *   high/medium 必含 suggestedClauseText；clauseIndex ≥ 0 整数
 * - 确认 emit confirm(Risk)，取消 emit cancel
 * - open false→true 重置表单
 */

// 透明 stub 把 Radix Dialog 的 Teleport 打扁，slot 直接渲染到 wrapper DOM
const passthrough = (name: string) =>
    defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots }) { return () => h('div', { 'data-stub': name }, slots.default?.()) },
    })

const DialogStub = defineComponent({
    name: 'Dialog',
    props: { open: { type: Boolean, default: false } },
    emits: ['update:open'],
    setup(props, { slots }) {
        return () => h('div', { 'data-stub': 'Dialog' }, props.open ? slots.default?.() : [])
    },
})

// RadioGroup 桩：provide 回调供后代 RadioGroupItem change 时触发
const RADIO_GROUP_KEY = Symbol('radio-group-update')
const RadioGroupStub = defineComponent({
    name: 'RadioGroup',
    props: { modelValue: { type: String, default: null } },
    emits: ['update:modelValue'],
    setup(_, { slots, emit }) {
        provide(RADIO_GROUP_KEY, (v: string) => emit('update:modelValue', v))
        return () => h('div', slots.default?.())
    },
})
const RadioGroupItemStub = defineComponent({
    name: 'RadioGroupItem',
    props: { value: { type: String, required: true }, id: String },
    setup(props) {
        const onUpdate = inject<(v: string) => void>(RADIO_GROUP_KEY)
        return () => h('input', {
            type: 'radio', value: props.value, id: props.id,
            'data-level-value': props.value,
            onChange: () => onUpdate?.(props.value),
        })
    },
})

const InputStub = defineComponent({
    name: 'Input',
    props: { modelValue: { type: [String, Number], default: '' }, placeholder: String, type: { type: String, default: 'text' } },
    emits: ['update:modelValue'],
    setup(props, { emit, attrs }) {
        return () => h('input', {
            ...attrs, type: props.type, value: props.modelValue, placeholder: props.placeholder,
            onInput: (e: Event) => {
                const v = (e.target as HTMLInputElement).value
                emit('update:modelValue', props.type === 'number' ? (v === '' ? '' : Number(v)) : v)
            },
        })
    },
})

const TextareaStub = defineComponent({
    name: 'Textarea',
    props: { modelValue: { type: String, default: '' }, placeholder: String, rows: [String, Number] },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () => h('textarea', {
            value: props.modelValue,
            placeholder: props.placeholder,
            rows: props.rows,
            onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
        })
    },
})

const ButtonStub = defineComponent({
    name: 'Button',
    props: { disabled: Boolean },
    setup(props, { slots, attrs }) {
        return () => h('button', { disabled: props.disabled || undefined, ...attrs }, slots.default?.())
    },
})

const stubs = {
    Dialog: DialogStub, DialogContent: passthrough('DialogContent'),
    DialogHeader: passthrough('DialogHeader'), DialogTitle: passthrough('DialogTitle'),
    DialogDescription: passthrough('DialogDescription'),
    DialogFooter: passthrough('DialogFooter'), Label: passthrough('Label'),
    Input: InputStub, Textarea: TextareaStub,
    RadioGroup: RadioGroupStub, RadioGroupItem: RadioGroupItemStub,
    Button: ButtonStub,
}

function baseRisk(overrides: Partial<Risk> = {}): Risk {
    return {
        id: 'fixed-id-0001', clauseIndex: 3, clauseText: '甲方应在 7 日内付款。',
        level: 'high', category: '付款条件', problem: '付款期过短',
        legalBasis: '《民法典》第 509 条', analysis: '条款分析内容',
        risk: '对甲方产生法律风险', suggestion: '建议延长至 30 日',
        suggestedClauseText: '甲方应在 30 日内付款。',
        ...overrides,
    }
}

/** 新增模式 prefill：原文条款与段落序号由左侧预览 hover 入口带入 */
const PREFILL = { clauseText: '甲方应在 7 日内付款。', clauseParagraphIndex: 2 }

function mountDialog(
    props: Partial<{ open: boolean; risk: Risk | null; prefill: typeof PREFILL | null }> = {},
) {
    return mount(RiskEditDialog, { props: { open: true, risk: null, ...props }, global: { stubs } })
}

type Wrapper = ReturnType<typeof mountDialog>
const findButton = (w: Wrapper, label: string) => w.findAll('button').find(b => b.text().includes(label))!
const confirmBtn = (w: Wrapper) => findButton(w, '确认')
const textInput = (w: Wrapper) =>
    w.findAll('input').find(i => (i.element as HTMLInputElement).type === 'text')!
const pickLevel = (w: Wrapper, v: 'high' | 'medium' | 'low') =>
    w.find(`input[data-level-value="${v}"]`).trigger('change')

// 新增模式 textarea 顺序：problem, legalBasis, analysis, suggestion, suggestedClauseText
// （原文条款在新增模式为只读 div，不计入 textarea）
async function fillValidForm(w: Wrapper) {
    const tas = w.findAll('textarea')
    const values = ['问题概述文本', '法律依据文本', '条款分析文本', '修改建议文本', '建议改写后的完整条款']
    for (let i = 0; i < values.length; i++) await tas[i]!.setValue(values[i])
    await textInput(w).setValue('付款条件')
}

describe('RiskEditDialog', () => {
    it('新增模式（risk=null）：默认 level=medium，原文条款由 prefill 只读带入，textarea 为空', async () => {
        const w = mountDialog({ risk: null, prefill: PREFILL })
        await nextTick()
        expect(w.text()).toContain('新增风险')
        expect(w.text()).toContain(PREFILL.clauseText)
        w.findAll('textarea').forEach(t => expect((t.element as HTMLTextAreaElement).value).toBe(''))
        expect((confirmBtn(w).element as HTMLButtonElement).disabled).toBe(true)
    })

    it('编辑模式（risk 非空）：字段被预填，且无条款序号输入框', async () => {
        const r = baseRisk()
        const w = mountDialog({ risk: r })
        await nextTick()
        expect(w.text()).toContain('编辑风险')
        // 编辑模式 textarea 顺序：clauseText, problem, legalBasis, analysis, suggestion, suggestedClauseText
        const tas = w.findAll('textarea')
        const expected = [r.clauseText, r.problem, r.legalBasis, r.analysis, r.suggestion, r.suggestedClauseText]
        expected.forEach((v, i) => expect((tas[i]!.element as HTMLTextAreaElement).value).toBe(v))
        expect((textInput(w).element as HTMLInputElement).value).toBe(r.category)
        // 条款序号输入框已彻底移除
        expect(w.findAll('input').some(i => (i.element as HTMLInputElement).type === 'number')).toBe(false)
    })

    it('high 级别且 suggestedClauseText 为空：确认 disabled', async () => {
        const w = mountDialog({ risk: null, prefill: PREFILL })
        await fillValidForm(w)
        await pickLevel(w, 'high')
        await w.findAll('textarea')[4]!.setValue('')
        await nextTick()
        expect((confirmBtn(w).element as HTMLButtonElement).disabled).toBe(true)
    })

    it('low 级别且 suggestedClauseText 为空：确认 enabled', async () => {
        const w = mountDialog({ risk: null, prefill: PREFILL })
        await fillValidForm(w)
        await pickLevel(w, 'low')
        await w.findAll('textarea')[4]!.setValue('')
        await nextTick()
        expect((confirmBtn(w).element as HTMLButtonElement).disabled).toBe(false)
    })

    it.each([
        { name: 'clauseIndex=-1', clauseIndex: -1 },
        { name: 'clauseIndex=1.5', clauseIndex: 1.5 },
    ])('编辑模式 $name（非法段落序号）：确认 disabled', async ({ clauseIndex }) => {
        const w = mountDialog({ risk: baseRisk({ clauseIndex }) })
        await nextTick()
        expect((confirmBtn(w).element as HTMLButtonElement).disabled).toBe(true)
    })

    it('必填留空：确认 disabled', async () => {
        const w = mountDialog({ risk: null, prefill: PREFILL })
        await pickLevel(w, 'low')
        await nextTick()
        expect((confirmBtn(w).element as HTMLButtonElement).disabled).toBe(true)
    })

    it('取消：emit cancel 无参数 + update:open(false)', async () => {
        const w = mountDialog({ risk: null, prefill: PREFILL })
        await findButton(w, '取消').trigger('click')
        expect(w.emitted('cancel')![0]).toEqual([])
        const updates = w.emitted('update:open')!
        expect(updates[updates.length - 1]).toEqual([false])
    })

    it('确认（新增）：emit confirm 携带 uuid + prefill 的原文与段落序号 + update:open(false)', async () => {
        const w = mountDialog({ risk: null, prefill: PREFILL })
        await fillValidForm(w)
        await pickLevel(w, 'medium')
        await nextTick()
        await confirmBtn(w).trigger('click')

        const payload = w.emitted('confirm')![0][0] as Risk
        expect(payload.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
        expect(payload.clauseIndex).toBe(PREFILL.clauseParagraphIndex)
        expect(payload.clauseText).toBe(PREFILL.clauseText)
        expect(payload.level).toBe('medium')
        expect(payload.category).toBe('付款条件')
        expect(payload.suggestedClauseText).toBe('建议改写后的完整条款')

        const updates = w.emitted('update:open')!
        expect(updates[updates.length - 1]).toEqual([false])
    })

    it('确认（编辑）：保留原 id', async () => {
        const w = mountDialog({ risk: baseRisk({ id: 'existing-id-xyz' }) })
        await nextTick()
        await confirmBtn(w).trigger('click')
        expect((w.emitted('confirm')![0][0] as Risk).id).toBe('existing-id-xyz')
    })

    it('确认（编辑）：保留 LLM 字段（problematicQuote / problemSentenceIds / matchedPointCode）', async () => {
        // PR4 回归保护：手动编辑 problem 字段不应清空 PR3 引入的 quote 锚点字段
        const original = baseRisk({
            id: 'risk-with-anchors',
            problematicQuote: '甲方应在 7 日内付款',
            problemSentenceIds: [1, 2],
            matchedPointCode: 'PMT-001',
        })
        const w = mountDialog({ risk: original })
        await nextTick()
        // 编辑模式 problem 在 textarea 索引 1（clauseText 占索引 0）
        await w.findAll('textarea')[1]!.setValue('修改后的问题概述')
        await nextTick()
        await confirmBtn(w).trigger('click')

        const payload = w.emitted('confirm')![0][0] as Risk
        expect(payload.problem).toBe('修改后的问题概述')
        expect(payload.problematicQuote).toBe('甲方应在 7 日内付款')
        expect(payload.problemSentenceIds).toEqual([1, 2])
        expect(payload.matchedPointCode).toBe('PMT-001')
    })

    it('legalBasis / suggestedClauseText 空白字符串：payload 为 undefined', async () => {
        const w = mountDialog({ risk: null, prefill: PREFILL })
        await fillValidForm(w)
        await pickLevel(w, 'low')
        // 新增模式 textarea：problem[0] legalBasis[1] analysis[2] suggestion[3] suggestedClauseText[4]
        await w.findAll('textarea')[1]!.setValue('   ')
        await w.findAll('textarea')[4]!.setValue('')
        await nextTick()
        await confirmBtn(w).trigger('click')

        const payload = w.emitted('confirm')![0][0] as Risk
        expect(payload.legalBasis).toBeUndefined()
        expect(payload.suggestedClauseText).toBeUndefined()
    })

    it('open false→true 重置表单（关闭再开不保留上次修改）', async () => {
        const r = baseRisk()
        const w = mountDialog({ open: true, risk: r })
        await nextTick()
        await w.findAll('textarea')[0]!.setValue('被改动的原文')
        await w.setProps({ open: false }); await nextTick()
        await w.setProps({ open: true }); await nextTick()
        expect((w.findAll('textarea')[0]!.element as HTMLTextAreaElement).value).toBe(r.clauseText)
    })
})
