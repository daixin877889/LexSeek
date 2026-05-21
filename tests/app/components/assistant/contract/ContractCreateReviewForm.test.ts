import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, provide, nextTick } from 'vue'

/**
 * ContractCreateReviewForm 单元测试（聚焦粘贴文本分支）
 *
 * 组件职责（本测试覆盖部分）：
 * - 粘贴文本 Tab：字数计数实时更新
 * - 空文本 / 超 50000 字时「开始审查」按钮禁用
 * - 合法粘贴 → 点击「开始审查」→ 调 createReview 接口 → emit created(reviewId)
 *
 * 上传 / 文件库分支依赖 OSS，由 E2E 覆盖。
 */

const useApiFetchMock = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({ useApiFetch: (...args: unknown[]) => useApiFetchMock(...args) }))
vi.mock('~/composables/useBatchUpload', () => ({ useBatchUpload: () => ({ uploadToOSS: vi.fn() }) }))
vi.mock('~/store/file', () => ({ useFileStore: () => ({ getBatchPresignedUrls: vi.fn() }) }))
vi.mock('vue-sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }))

// 动态 import：确保 vi.mock 在组件加载前生效
const { default: ContractCreateReviewForm } = await import('~/components/assistant/contract/ContractCreateReviewForm.vue')

function passthrough(name: string) {
    return defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots }) {
            return () => h('div', { 'data-stub': name }, slots.default?.())
        },
    })
}

// Tabs 系列 stub：trigger 点击切换 modelValue，content 按当前值显隐
const TabsStub = defineComponent({
    name: 'Tabs',
    props: { modelValue: { type: String, default: '' } },
    emits: ['update:modelValue'],
    setup(props, { slots, emit }) {
        provide('tabsCtx', {
            current: () => props.modelValue,
            select: (v: string) => emit('update:modelValue', v),
        })
        return () => h('div', slots.default?.())
    },
})
const TabsTriggerStub = defineComponent({
    name: 'TabsTrigger',
    props: { value: { type: String, default: '' } },
    setup(props, { slots }) {
        const ctx = inject<{ select: (v: string) => void }>('tabsCtx')
        return () => h('button', {
            'data-tab-trigger': props.value,
            onClick: () => ctx?.select(props.value),
        }, slots.default?.())
    },
})
const TabsContentStub = defineComponent({
    name: 'TabsContent',
    props: { value: { type: String, default: '' } },
    setup(props, { slots }) {
        const ctx = inject<{ current: () => string }>('tabsCtx')
        return () => (ctx?.current() === props.value ? h('div', slots.default?.()) : null)
    },
})
const ButtonStub = defineComponent({
    name: 'Button',
    props: { disabled: Boolean, variant: String, size: String },
    setup(props, { slots, attrs }) {
        return () => h('button', { disabled: props.disabled || undefined, ...attrs }, slots.default?.())
    },
})
const TextareaStub = defineComponent({
    name: 'Textarea',
    props: { modelValue: { type: String, default: '' }, rows: Number, disabled: Boolean },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        return () => h('textarea', {
            value: props.modelValue,
            'data-stub': 'Textarea',
            onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
        })
    },
})

const stubs = {
    Tabs: TabsStub,
    TabsList: passthrough('TabsList'),
    TabsTrigger: TabsTriggerStub,
    TabsContent: TabsContentStub,
    Button: ButtonStub,
    Textarea: TextareaStub,
    Input: passthrough('Input'),
    CaseAnalysisMaterialSelector: passthrough('CaseAnalysisMaterialSelector'),
}

function mountForm(props: { caseId?: number | null } = {}) {
    return mount(ContractCreateReviewForm, { props, global: { stubs } })
}

function findButton(w: ReturnType<typeof mountForm>, label: string) {
    return w.findAll('button').find(b => b.text().includes(label))!
}

async function switchToPaste(w: ReturnType<typeof mountForm>) {
    await w.find('button[data-tab-trigger="paste"]').trigger('click')
    await nextTick()
}

describe('ContractCreateReviewForm', () => {
    beforeEach(() => {
        useApiFetchMock.mockReset()
    })

    it('粘贴文本 Tab：字数计数随输入更新', async () => {
        const w = mountForm()
        await switchToPaste(w)
        expect(w.text()).toContain('0 / 50,000')
        await w.find('textarea').setValue('合同正文示例')
        await nextTick()
        expect(w.text()).toContain('6 / 50,000')
    })

    it('粘贴文本为空时「开始审查」按钮禁用', async () => {
        const w = mountForm()
        await switchToPaste(w)
        expect((findButton(w, '开始审查').element as HTMLButtonElement).disabled).toBe(true)
    })

    it('粘贴文本超 50000 字时「开始审查」按钮禁用', async () => {
        const w = mountForm()
        await switchToPaste(w)
        await w.find('textarea').setValue('字'.repeat(50001))
        await nextTick()
        expect((findButton(w, '开始审查').element as HTMLButtonElement).disabled).toBe(true)
    })

    it('合法粘贴 → 点击开始审查 → 调接口并 emit created', async () => {
        useApiFetchMock.mockResolvedValue({ reviewId: 99, sessionId: 'sess-99' })
        const w = mountForm()
        await switchToPaste(w)
        await w.find('textarea').setValue('一份正常长度的合同文本')
        await nextTick()
        await findButton(w, '开始审查').trigger('click')
        await nextTick()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews',
            expect.objectContaining({ method: 'POST', body: { sourceType: 'paste', text: '一份正常长度的合同文本' } }),
        )
        const emitted = w.emitted('created')
        expect(emitted).toBeTruthy()
        expect(emitted![0][0]).toBe(99)
    })

    it('caseId 存在时提交 body 带上 caseId', async () => {
        useApiFetchMock.mockResolvedValue({ reviewId: 7, sessionId: 's7' })
        const w = mountForm({ caseId: 123 })
        await switchToPaste(w)
        await w.find('textarea').setValue('归属某案件的合同')
        await nextTick()
        await findButton(w, '开始审查').trigger('click')
        await nextTick()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/contract/reviews',
            expect.objectContaining({ body: { sourceType: 'paste', text: '归属某案件的合同', caseId: 123 } }),
        )
    })
})
