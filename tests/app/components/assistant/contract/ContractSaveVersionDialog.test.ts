import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ContractSaveVersionDialog from '~/components/assistant/contract/ContractSaveVersionDialog.vue'

/**
 * ContractSaveVersionDialog 单元测试
 *
 * **Feature: contract-review-versioning-phase-a**
 *
 * 组件职责：
 * - 支持 v-model:open 控制显示/隐藏
 * - 输入律师备注（可选，最长 200 字符）
 * - 字符计数实时更新
 * - 点击"保存版本"emit confirm(lawyerNote)，空白备注视为 null
 * - 点击"取消"emit update:open(false)
 * - 关闭时重置备注和 submitting 状态
 */

function passthrough(name: string) {
    return defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots }) {
            return () => h('div', { 'data-stub': name }, slots.default?.())
        },
    })
}

const DialogStub = defineComponent({
    name: 'Dialog',
    props: { open: { type: Boolean, default: false } },
    emits: ['update:open'],
    setup(props, { slots }) {
        return () =>
            h('div', { 'data-stub': 'Dialog', 'data-open': String(props.open) },
                props.open ? slots.default?.() : [],
            )
    },
})

const ButtonStub = defineComponent({
    name: 'Button',
    props: { disabled: Boolean, variant: String },
    setup(props, { slots, attrs }) {
        return () =>
            h('button', { disabled: props.disabled || undefined, ...attrs }, slots.default?.())
    },
})

const TextareaStub = defineComponent({
    name: 'Textarea',
    props: { modelValue: { type: String, default: '' }, rows: Number, maxlength: Number },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () =>
            h('textarea', {
                value: props.modelValue,
                rows: props.rows,
                maxlength: props.maxlength,
                'data-stub': 'Textarea',
                onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
            })
    },
})

const stubs = {
    Dialog: DialogStub,
    DialogContent: passthrough('DialogContent'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle'),
    DialogFooter: passthrough('DialogFooter'),
    Button: ButtonStub,
    Textarea: TextareaStub,
    Label: passthrough('Label'),
}

function mountDialog(props: { open?: boolean } = {}) {
    return mount(ContractSaveVersionDialog, {
        props: { open: true, ...props },
        global: { stubs },
    })
}

function findButton(w: ReturnType<typeof mountDialog>, label: string) {
    return w.findAll('button').find(b => b.text().includes(label))!
}

describe('ContractSaveVersionDialog', () => {
    it('open=false 时对话框内容不渲染', () => {
        const w = mountDialog({ open: false })
        expect(w.find('[data-stub="DialogContent"]').exists()).toBe(false)
    })

    it('open=true 时显示标题和 Textarea', () => {
        const w = mountDialog()
        expect(w.text()).toContain('保存新版本')
        expect(w.find('textarea').exists()).toBe(true)
    })

    it('字符计数随输入实时更新', async () => {
        const w = mountDialog()
        expect(w.text()).toContain('0 / 200')
        await w.find('textarea').setValue('hello')
        await nextTick()
        expect(w.text()).toContain('5 / 200')
    })

    it('点击"保存版本"emit confirm，携带备注文本', async () => {
        const w = mountDialog()
        await w.find('textarea').setValue('发张三法务审阅')
        await nextTick()
        await findButton(w, '保存版本').trigger('click')
        const emitted = w.emitted('confirm')
        expect(emitted).toBeTruthy()
        expect(emitted![0][0]).toBe('发张三法务审阅')
    })

    it('备注为空白字符时 emit confirm(null)', async () => {
        const w = mountDialog()
        await w.find('textarea').setValue('   ')
        await nextTick()
        await findButton(w, '保存版本').trigger('click')
        const emitted = w.emitted('confirm')
        expect(emitted).toBeTruthy()
        expect(emitted![0][0]).toBeNull()
    })

    it('备注为空时 emit confirm(null)', async () => {
        const w = mountDialog()
        await findButton(w, '保存版本').trigger('click')
        const emitted = w.emitted('confirm')
        expect(emitted).toBeTruthy()
        expect(emitted![0][0]).toBeNull()
    })

    it('点击"取消"emit update:open(false)', async () => {
        const w = mountDialog()
        await findButton(w, '取消').trigger('click')
        const emitted = w.emitted('update:open')
        expect(emitted).toBeTruthy()
        expect(emitted![0]).toEqual([false])
    })

    it('关闭后重新打开：备注重置为空', async () => {
        const w = mountDialog()
        await w.find('textarea').setValue('待删除的备注')
        await nextTick()
        // 关闭
        await w.setProps({ open: false })
        await nextTick()
        // 重新打开
        await w.setProps({ open: true })
        await nextTick()
        // 字符计数应重置
        expect(w.text()).toContain('0 / 200')
    })
})
