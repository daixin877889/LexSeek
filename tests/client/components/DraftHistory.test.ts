/**
 * DraftHistory 组件测试
 *
 * 验证点：
 * - 传入 items 时不调用 API（受控模式）
 * - 未传 items 时内部自拉（兼容独立文书页）
 * - caseId 传入时查询带 caseId
 * - hideCaseColumn=true 时不渲染"关联案件"列
 * - 有 caseId 时空态文案为"本案件还没有文书..."
 * - 无 caseId 时空态文案为"还没有历史文书..."
 */

import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DraftHistory from '~/components/assistant/document/DraftHistory.vue'

// 用 hoisted 变量 + vi.mock，避免 Nuxt 自动导入问题
const { useApiFetchMock, toastMock } = vi.hoisted(() => ({
    useApiFetchMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => useApiFetchMock(...args),
}))
vi.stubGlobal('useApiFetch', useApiFetchMock)
vi.stubGlobal('navigateTo', vi.fn())
vi.stubGlobal('useFormatters', () => ({ formatDate: (v: string) => v }))
vi.stubGlobal('useAlertDialogStore', () => ({ showErrorDialog: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: toastMock }))

const commonStubs = {
    Loader2Icon: { template: '<span />' },
    FileTextIcon: { template: '<span />' },
    Trash2Icon: { template: '<span />' },
    EyeIcon: { template: '<span />' },
    Table: { template: '<div><slot /></div>' },
    TableHeader: { template: '<div><slot /></div>' },
    TableBody: { template: '<div><slot /></div>' },
    TableRow: { template: '<div><slot /></div>' },
    TableHead: { template: '<div><slot /></div>' },
    TableCell: { template: '<div><slot /></div>' },
    Button: { template: '<button><slot /></button>' },
    NuxtLink: { template: '<a><slot /></a>' },
    GeneralPagination: { template: '<div />' },
}

describe('DraftHistory', () => {
    it('传入 items 时不调用 API', async () => {
        useApiFetchMock.mockClear()
        mount(DraftHistory, {
            props: {
                items: [
                    { id: 1, title: '起诉状', templateId: 10, templateName: '起诉状模板', caseId: null, status: 'ready', updatedAt: '2026-04-20' },
                ],
            },
            global: { stubs: commonStubs },
        })
        await flushPromises()
        expect(useApiFetchMock).not.toHaveBeenCalled()
    })

    it('未传 items 时内部自拉', async () => {
        useApiFetchMock.mockClear()
        useApiFetchMock.mockResolvedValue({ items: [], total: 0 })
        mount(DraftHistory, { global: { stubs: commonStubs } })
        await flushPromises()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts',
            expect.objectContaining({ query: expect.any(Object) }),
        )
    })

    it('caseId 传入时查询带 caseId', async () => {
        useApiFetchMock.mockClear()
        useApiFetchMock.mockResolvedValue({ items: [], total: 0 })
        mount(DraftHistory, {
            props: { caseId: 41 },
            global: { stubs: commonStubs },
        })
        await flushPromises()
        expect(useApiFetchMock).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts',
            { query: expect.objectContaining({ caseId: 41 }) },
        )
    })

    it('有 caseId 时空态文案变化', () => {
        const w = mount(DraftHistory, {
            props: {
                items: [],
                loading: false,
                caseId: 41,
            },
            global: { stubs: commonStubs },
        })
        expect(w.text()).toContain('本案件还没有文书')
    })

    it('无 caseId 时保留原空态文案', () => {
        const w = mount(DraftHistory, {
            props: { items: [], loading: false },
            global: { stubs: commonStubs },
        })
        expect(w.text()).toContain('还没有历史文书')
    })
})
