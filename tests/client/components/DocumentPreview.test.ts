/**
 * DocumentPreview 组件测试
 *
 * **Feature: contract-review-m1 / Bug A**
 *
 * 验证点：
 * - templateBuffer 从 null 切换到 ArrayBuffer 时（二次进入工作区场景），
 *   watch 回调在 DOM flush 之后触发 renderAsync，
 *   而非在 previewRoot 尚未挂载时 bail，导致预览空白。
 *
 * 说明：
 * - mock docx-preview 的 renderAsync，模拟向 previewRoot 注入 DOM。
 * - 使用 setProps 在挂载后异步切换 templateBuffer，还原 mountDraft 中
 *   "先挂载组件、后拿到 template buffer" 的竞态场景。
 */

import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import DocumentPreview from '~/components/assistant/document/DocumentPreview.vue'

// 记录 renderAsync 被调用时 root 是否真实存在 DOM
const renderAsyncCalls: Array<{ hasRoot: boolean }> = []

vi.mock('docx-preview', () => ({
    renderAsync: vi.fn(async (_buffer: ArrayBuffer, root: HTMLElement) => {
        renderAsyncCalls.push({ hasRoot: !!root })
        if (root) {
            root.innerHTML = '<p class="docx-para">原告：{{原告}}</p>'
        }
    }),
}))

const commonStubs = {
    Button: { template: '<button><slot /></button>' },
    FileTextIcon: { template: '<span />' },
    DownloadIcon: { template: '<span />' },
}

describe('DocumentPreview 二次进入工作区的时序竞态', () => {
    it('templateBuffer 在挂载后异步到达时仍会渲染 DOCX', async () => {
        renderAsyncCalls.length = 0

        const wrapper = mount(DocumentPreview, {
            props: {
                templateBuffer: null,
                values: { 原告: '张三' },
            },
            global: { stubs: commonStubs },
            attachTo: document.body,
        })

        await flushPromises()
        // 初始 null：渲染占位分支，预览容器不存在
        expect(wrapper.find('.docx-preview-root').exists()).toBe(false)

        // 模拟 mountDraft 流程：templateBuffer 异步到达
        const fakeBuffer = new ArrayBuffer(8)
        await wrapper.setProps({ templateBuffer: fakeBuffer })
        await flushPromises()

        // 关键断言：预览容器已挂载，renderAsync 已被调用且 root 真实存在
        expect(wrapper.find('.docx-preview-root').exists()).toBe(true)
        expect(renderAsyncCalls.length).toBe(1)
        expect(renderAsyncCalls[0]?.hasRoot).toBe(true)

        wrapper.unmount()
    })
})
