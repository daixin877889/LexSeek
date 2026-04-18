import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, nextTick, provide } from 'vue'
import StanceSelectionDialog from '~/components/assistant/contract/StanceSelectionDialog.vue'

/**
 * StanceSelectionDialog 单元测试
 *
 * **Feature: contract-review-m4**
 *
 * 组件职责：
 * - 展示 AI 识别到的 partyA / partyB / contractType（可编辑）
 * - 单选立场（甲方 / 乙方 / 中立）
 * - 确认后 emit confirm(StanceRequest)，取消 emit cancel
 * - 支持 v-model:open
 */

// 透明 stubs：把 Radix Dialog 的 Teleport 打扁，直接渲染 slot 到 wrapper DOM 中
// 这样测试无需处理 document.body 查询，也不会受 happy-dom Teleport 行为影响
function passthrough(name: string) {
    return defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots }) {
            return () => h('div', { 'data-stub': name }, slots.default?.())
        },
    })
}

// Dialog：根据 open prop 控制 slot 是否渲染
const DialogStub = defineComponent({
    name: 'Dialog',
    props: { open: { type: Boolean, default: false } },
    emits: ['update:open'],
    setup(props, { slots }) {
        return () =>
            h('div', { 'data-stub': 'Dialog', 'data-open': String(props.open) }, props.open ? slots.default?.() : [])
    },
})

// RadioGroup 桩：通过 provide 把 update 回调传给后代 RadioGroupItem
const RADIO_GROUP_KEY = Symbol('radio-group-update')

const RadioGroupStub = defineComponent({
    name: 'RadioGroup',
    props: { modelValue: { type: String, default: null } },
    emits: ['update:modelValue'],
    setup(_, { slots, emit }) {
        provide(RADIO_GROUP_KEY, (value: string) => emit('update:modelValue', value))
        return () => h('div', { 'data-stub': 'RadioGroup' }, slots.default?.())
    },
})

const RadioGroupItemStub = defineComponent({
    name: 'RadioGroupItem',
    props: { value: { type: String, required: true }, id: String },
    setup(props) {
        const onUpdate = inject<(v: string) => void>(RADIO_GROUP_KEY)
        return () =>
            h('input', {
                type: 'radio',
                value: props.value,
                id: props.id,
                'data-stance-value': props.value,
                onChange: () => onUpdate?.(props.value),
            })
    },
})

const InputStub = defineComponent({
    name: 'Input',
    props: { modelValue: { type: String, default: '' }, placeholder: String },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () =>
            h('input', {
                value: props.modelValue,
                placeholder: props.placeholder,
                onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value),
            })
    },
})

const ButtonStub = defineComponent({
    name: 'Button',
    props: { disabled: Boolean },
    setup(props, { slots, attrs }) {
        return () =>
            h(
                'button',
                {
                    disabled: props.disabled || undefined,
                    ...attrs,
                },
                slots.default?.()
            )
    },
})

const stubs = {
    Dialog: DialogStub,
    DialogContent: passthrough('DialogContent'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle'),
    DialogDescription: passthrough('DialogDescription'),
    DialogFooter: passthrough('DialogFooter'),
    Label: passthrough('Label'),
    Input: InputStub,
    RadioGroup: RadioGroupStub,
    RadioGroupItem: RadioGroupItemStub,
    Button: ButtonStub,
}

function mountDialog(props: Partial<{
    open: boolean
    partyA: string | null
    partyB: string | null
    contractType: string | null
}> = {}) {
    return mount(StanceSelectionDialog, {
        props: {
            open: true,
            partyA: '甲公司',
            partyB: '乙公司',
            contractType: '劳动合同',
            ...props,
        },
        global: { stubs },
    })
}

/** 选中某个立场（模拟用户在 RadioGroupItem 上触发 change） */
async function pickStance(w: ReturnType<typeof mountDialog>, value: 'partyA' | 'partyB' | 'neutral') {
    const input = w.find(`input[data-stance-value="${value}"]`)
    expect(input.exists()).toBe(true)
    await input.trigger('change')
}

function findPartyInput(w: ReturnType<typeof mountDialog>, which: '甲方' | '乙方') {
    const inputs = w.findAll('input[placeholder]')
    return inputs.find(i => (i.element as HTMLInputElement).placeholder.includes(which))!
}

function findButton(w: ReturnType<typeof mountDialog>, label: string) {
    return w.findAll('button').find(b => b.text().includes(label))!
}

describe('StanceSelectionDialog', () => {
    it('默认 open=false 时 Dialog 内容不渲染', () => {
        const w = mountDialog({ open: false })
        expect(w.find('[data-stub="DialogContent"]').exists()).toBe(false)
    })

    it('open=true 时展示已识别的甲乙方与合同类型', () => {
        const w = mountDialog({ partyA: '某某科技有限公司', partyB: '张三', contractType: '劳动合同' })
        expect(w.text()).toContain('劳动合同')
        expect((findPartyInput(w, '甲方').element as HTMLInputElement).value).toBe('某某科技有限公司')
        expect((findPartyInput(w, '乙方').element as HTMLInputElement).value).toBe('张三')
    })

    it('立场未选时"确认"按钮 disabled，不会触发 confirm', async () => {
        const w = mountDialog()
        const confirmBtn = findButton(w, '确认')
        expect((confirmBtn.element as HTMLButtonElement).disabled).toBe(true)
        await confirmBtn.trigger('click')
        expect(w.emitted('confirm')).toBeUndefined()
    })

    it('选择立场后 emit confirm，携带 trim 后的 partyA/partyB 并关闭对话框', async () => {
        const w = mountDialog({ partyA: '  甲公司  ', partyB: '  乙公司  ' })
        await pickStance(w, 'partyA')

        const confirmBtn = findButton(w, '确认')
        expect((confirmBtn.element as HTMLButtonElement).disabled).toBe(false)
        await confirmBtn.trigger('click')

        const emitted = w.emitted('confirm')
        expect(emitted).toBeTruthy()
        expect(emitted![0][0]).toEqual({ stance: 'partyA', partyA: '甲公司', partyB: '乙公司' })

        const updateOpen = w.emitted('update:open')
        expect(updateOpen).toBeTruthy()
        expect(updateOpen![updateOpen!.length - 1]).toEqual([false])
    })

    it('编辑甲乙方后 emit 反映编辑结果（全空白→undefined）', async () => {
        const w = mountDialog({ partyA: '原甲方', partyB: '原乙方' })
        await findPartyInput(w, '甲方').setValue('新甲方  ')
        await findPartyInput(w, '乙方').setValue('   ')

        await pickStance(w, 'neutral')
        await findButton(w, '确认').trigger('click')

        const emitted = w.emitted('confirm')!
        expect(emitted[0][0]).toEqual({ stance: 'neutral', partyA: '新甲方', partyB: undefined })
    })

    it('partyA/partyB/contractType 为 null 时使用占位符且不报错', () => {
        const w = mountDialog({ partyA: null, partyB: null, contractType: null })
        expect((findPartyInput(w, '甲方').element as HTMLInputElement).value).toBe('')
        expect((findPartyInput(w, '乙方').element as HTMLInputElement).value).toBe('')
        expect(w.text()).toContain('未识别到明确的合同类型')
    })

    it('点击"取消"emit cancel 无参数并关闭对话框', async () => {
        const w = mountDialog()
        await findButton(w, '取消').trigger('click')

        const cancelEvt = w.emitted('cancel')
        expect(cancelEvt).toBeTruthy()
        expect(cancelEvt![0]).toEqual([])

        const updateOpen = w.emitted('update:open')!
        expect(updateOpen[updateOpen.length - 1]).toEqual([false])
    })

    it('open 从 false→true 时重置输入与立场（不保留上次残留）', async () => {
        const w = mountDialog({ open: true, partyA: '初始甲', partyB: '初始乙' })

        // 用户修改甲方、选了立场
        await findPartyInput(w, '甲方').setValue('被改的甲方')
        await pickStance(w, 'partyB')

        // 关闭
        await w.setProps({ open: false })
        await nextTick()

        // 重新打开（props 未变）
        await w.setProps({ open: true })
        await nextTick()

        expect((findPartyInput(w, '甲方').element as HTMLInputElement).value).toBe('初始甲')
        // 立场应重置 → 确认按钮再次 disabled
        expect((findButton(w, '确认').element as HTMLButtonElement).disabled).toBe(true)
    })
})
