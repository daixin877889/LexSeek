/**
 * CaseLinkerDialog 案件选择对话框测试（Mockup F）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import CaseLinkerDialog from '~/components/cases/CaseLinkerDialog.vue'

vi.mock('vue-sonner', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}))

const useApiFetchMock = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => useApiFetchMock(...args),
}))

const stubs = {
    global: {
        stubs: {
            // Dialog 系列：用透传容器，保留默认 open=true 时渲染内部内容
            Dialog: {
                template: '<div data-stub="dialog" v-if="open"><slot /></div>',
                props: ['open'],
            },
            DialogContent: {
                template: '<div data-stub="dialog-content"><slot /></div>',
                props: ['class', 'overlayClass'],
            },
            DialogHeader: { template: '<div><slot /></div>' },
            DialogTitle: { template: '<div data-stub="dialog-title"><slot /></div>' },
            DialogDescription: { template: '<div><slot /></div>' },
            DialogFooter: { template: '<div data-stub="dialog-footer"><slot /></div>' },
            Button: {
                template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
                props: ['disabled', 'variant', 'size'],
            },
            Input: {
                template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :disabled="disabled" :placeholder="placeholder" />',
                props: ['modelValue', 'disabled', 'placeholder'],
            },
            Loader2: true,
            Search: true,
            Check: true,
            Folder: true,
            Info: true,
            X: true,
        },
    },
}

const FAKE_CASES = [
    { id: 1, title: '张三诉李四 合同纠纷', caseType: '合同' },
    { id: 2, title: '王五工伤赔偿案', caseType: '劳动' },
    { id: 3, title: '李四诉张三 名誉权', caseType: '人格权' },
]

beforeEach(() => {
    useApiFetchMock.mockReset()
    useApiFetchMock.mockResolvedValue({ items: FAKE_CASES })
})

describe('CaseLinkerDialog', () => {
    it('open=true 时拉取 /api/v1/cases/active 并渲染列表', async () => {
        const w = mount(CaseLinkerDialog, {
            props: {
                open: true,
                onConfirm: vi.fn(),
            },
            ...stubs,
        })
        await flushPromises()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/cases/active',
            expect.objectContaining({ query: expect.any(Object) }),
        )
        expect(w.text()).toContain('张三诉李四 合同纠纷')
        expect(w.text()).toContain('王五工伤赔偿案')
    })

    it('选择案件后点击「确认关联」调 onConfirm(caseId)', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined)
        const w = mount(CaseLinkerDialog, {
            props: { open: true, onConfirm },
            ...stubs,
        })
        await flushPromises()

        // 点击第二个案件
        const caseButtons = w.findAll('button').filter(b =>
            b.text().includes('王五工伤赔偿案'),
        )
        expect(caseButtons.length).toBeGreaterThan(0)
        await caseButtons[0].trigger('click')

        // 点击确认
        const confirmBtn = w.findAll('button').find(b => b.text().includes('确认关联'))
        await confirmBtn.trigger('click')
        await flushPromises()
        expect(onConfirm).toHaveBeenCalledWith(2)
    })

    it('点击「取消」不调用 onConfirm 且关闭弹窗', async () => {
        const onConfirm = vi.fn()
        const w = mount(CaseLinkerDialog, {
            props: { open: true, onConfirm },
            ...stubs,
        })
        await flushPromises()
        const cancelBtn = w.findAll('button').find(b => b.text().trim() === '取消')
        await cancelBtn.trigger('click')
        await nextTick()
        expect(onConfirm).not.toHaveBeenCalled()
        expect(w.emitted('update:open')?.[0]).toEqual([false])
    })

    it('未做任何选择时，确认按钮 disabled（selectedId === currentCaseId）', async () => {
        const w = mount(CaseLinkerDialog, {
            props: { open: true, currentCaseId: 1, onConfirm: vi.fn() },
            ...stubs,
        })
        await flushPromises()
        const confirmBtn = w.findAll('button').find(b => b.text().includes('确认关联'))
        expect(confirmBtn.attributes('disabled')).toBeDefined()
    })

    it('搜索关键词改变时重新调用 useApiFetch（带 q 参数）', async () => {
        const w = mount(CaseLinkerDialog, {
            props: { open: true, onConfirm: vi.fn() },
            ...stubs,
        })
        await flushPromises()
        useApiFetchMock.mockClear()

        const input = w.find('input')
        await input.setValue('张三')
        // 等待 refDebounced (300ms)
        await new Promise((r) => setTimeout(r, 350))
        await flushPromises()

        expect(useApiFetchMock).toHaveBeenCalled()
        const lastCall = useApiFetchMock.mock.calls[useApiFetchMock.mock.calls.length - 1]
        expect(lastCall?.[1]?.query?.q).toBe('张三')
    })

    it('空列表展示空态', async () => {
        useApiFetchMock.mockResolvedValueOnce({ items: [] })
        const w = mount(CaseLinkerDialog, {
            props: { open: true, onConfirm: vi.fn() },
            ...stubs,
        })
        await flushPromises()
        expect(w.text()).toContain('暂无进行中的案件')
    })

    it('选择当前已关联案件后改为别的，确认按钮可用', async () => {
        const w = mount(CaseLinkerDialog, {
            props: { open: true, currentCaseId: 1, onConfirm: vi.fn() },
            ...stubs,
        })
        await flushPromises()
        const targetBtn = w.findAll('button').find(b =>
            b.text().includes('王五工伤赔偿案'),
        )
        await targetBtn.trigger('click')
        const confirmBtn = w.findAll('button').find(b => b.text().includes('确认关联'))
        expect(confirmBtn.attributes('disabled')).toBeUndefined()
    })

    it('显示底部「仅显示进行中案件」提示', async () => {
        const w = mount(CaseLinkerDialog, {
            props: { open: true, onConfirm: vi.fn() },
            ...stubs,
        })
        await flushPromises()
        expect(w.text()).toContain('仅显示进行中案件')
    })
})
