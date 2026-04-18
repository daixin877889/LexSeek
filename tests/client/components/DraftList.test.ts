/**
 * DraftList 组件测试
 *
 * **Feature: contract-review-m1 / Task 12.1**
 *
 * 验证点：
 * 1. 挂载后拉取草稿列表并渲染（templateName fallback 为 "模板 #ID"）
 * 2. 点击删除按钮经 confirm 后调用 DELETE API 并刷新列表
 * 3. 点击"进入"按钮调用 navigateTo 跳转工作区
 * 4. 列表为空时显示空态文案
 *
 * 说明：
 * - 通过 global.stubs 把 shadcn 表格组件 stub 成简化结构，聚焦组件行为而非 DOM 细节。
 * - mock useApiFetch / navigateTo / confirm 避免真实请求与跳转。
 */

import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import DraftList from '~/components/assistant/document/DraftList.vue'

// ─── mocks ─────────────────────────────────────────────────────────────────
const mockFetch = vi.fn()
vi.mock('~/composables/useApiFetch', () => ({
    useApiFetch: (...args: unknown[]) => mockFetch(...args),
}))

const navigateMock = vi.fn()
mockNuxtImport('navigateTo', () => (path: string) => navigateMock(path))

vi.mock('vue-sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}))

// ─── stubs：shadcn 表格 + 分页 + 按钮 + 图标 ─────────────────────────────────
const commonStubs = {
    Table: { template: '<table><slot /></table>' },
    TableHeader: { template: '<thead><slot /></thead>' },
    TableBody: { template: '<tbody><slot /></tbody>' },
    TableRow: { template: '<tr><slot /></tr>' },
    TableHead: { template: '<th><slot /></th>' },
    TableCell: { template: '<td><slot /></td>' },
    GeneralPagination: { template: '<div class="stub-pagination" />' },
    Button: {
        template: '<button class="stub-btn" @click="$emit(\'click\')"><slot /></button>',
    },
    Loader2Icon: { template: '<span class="stub-loader" />' },
    FileTextIcon: { template: '<span class="stub-file" />' },
    Trash2Icon: { template: '<span class="lucide-trash-2" />' },
}

const rows = [
    {
        id: 1,
        templateId: 7,
        caseId: null,
        status: 'ready',
        updatedAt: '2026-04-18T00:00:00Z',
    },
    {
        id: 2,
        templateId: 8,
        caseId: 7,
        status: 'exported',
        updatedAt: '2026-04-17T10:00:00Z',
    },
]

beforeEach(() => {
    mockFetch.mockReset()
    navigateMock.mockReset()
    vi.stubGlobal('confirm', () => true)
})

describe('DraftList', () => {
    it('拉取列表并以 "模板 #ID" fallback 渲染行', async () => {
        mockFetch.mockResolvedValueOnce({ items: rows, total: 2, skip: 0, take: 10 })

        const wrapper = mount(DraftList, { global: { stubs: commonStubs } })
        await flushPromises()

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts',
            expect.objectContaining({ query: expect.objectContaining({ skip: 0 }) }),
        )
        expect(wrapper.text()).toContain('模板 #7')
        expect(wrapper.text()).toContain('模板 #8')
    })

    it('点击删除按钮时调用 DELETE API', async () => {
        mockFetch.mockResolvedValueOnce({ items: rows, total: 2, skip: 0, take: 10 })

        const wrapper = mount(DraftList, { global: { stubs: commonStubs } })
        await flushPromises()

        // 删除成功 + 重新加载
        mockFetch.mockResolvedValueOnce({ ok: true })
        mockFetch.mockResolvedValueOnce({ items: [rows[1]], total: 1, skip: 0, take: 10 })

        const delBtn = wrapper.findAll('button').find(b => b.find('.lucide-trash-2').exists())
        expect(delBtn).toBeDefined()
        await delBtn!.trigger('click')
        await flushPromises()

        expect(mockFetch).toHaveBeenCalledWith(
            '/api/v1/assistant/document/drafts/1',
            expect.objectContaining({ method: 'DELETE' }),
        )
    })

    it('点击"进入"按钮时调用 navigateTo 跳转到工作区', async () => {
        mockFetch.mockResolvedValueOnce({ items: rows, total: 2, skip: 0, take: 10 })

        const wrapper = mount(DraftList, { global: { stubs: commonStubs } })
        await flushPromises()

        const enterBtn = wrapper.findAll('button').find(b => b.text().includes('进入'))
        expect(enterBtn).toBeDefined()
        await enterBtn!.trigger('click')

        expect(navigateMock).toHaveBeenCalledWith('/dashboard/document/drafts/1')
    })

    it('列表为空时显示空态文案', async () => {
        mockFetch.mockResolvedValueOnce({ items: [], total: 0, skip: 0, take: 10 })

        const wrapper = mount(DraftList, { global: { stubs: commonStubs } })
        await flushPromises()

        expect(wrapper.text()).toContain('还没有草稿')
    })
})
