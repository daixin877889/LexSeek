import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ContractSourceInput from '~/components/assistant/contract/ContractSourceInput.vue'
import type { OssFileItem } from '~/store/file'
import type { AiPromptSubmitData } from '~/components/ai/AiPromptInput.vue'

/**
 * ContractSourceInput 单元测试
 *
 * **Feature: contract-review-m4**
 *
 * 组件职责：
 * - 复用 AiPromptInput 的上传 + 文本输入能力
 * - 归一成 CreateReviewRequest emit 给父组件
 */

// mock vue-sonner 的 toast（避免真实渲染依赖）
const toastWarning = vi.fn()
vi.mock('vue-sonner', () => ({
    toast: {
        warning: (...args: unknown[]) => toastWarning(...args),
        error: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
    },
}))

// Stub AiPromptInput：暴露 submit 事件供测试触发
const AiPromptInputStub = defineComponent({
    name: 'AiPromptInput',
    emits: ['submit', 'stop'],
    setup(_, { emit, expose }) {
        const trigger = (data: AiPromptSubmitData) => emit('submit', data)
        expose({ trigger })
        return () => h('div', { class: 'ai-prompt-input-stub' })
    },
})

function makeFile(overrides: Partial<OssFileItem> = {}): OssFileItem {
    return {
        id: 1001,
        fileName: 'contract.docx',
        fileSize: 1024,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        source: 'upload',
        sourceName: '上传',
        status: 1,
        statusName: '就绪',
        encrypted: false,
        createdAt: '2026-04-18T00:00:00Z',
        ...overrides,
    }
}

function mountComponent() {
    return mount(ContractSourceInput, {
        global: {
            stubs: {
                AiPromptInput: AiPromptInputStub,
            },
        },
    })
}

function emitSubmit(w: ReturnType<typeof mountComponent>, data: AiPromptSubmitData) {
    const stub = w.findComponent(AiPromptInputStub)
    expect(stub.exists()).toBe(true)
    stub.vm.$emit('submit', data)
}

describe('ContractSourceInput', () => {
    beforeEach(() => {
        toastWarning.mockClear()
    })

    it('纯文本（无文件）emit paste 源，text 已 trim', () => {
        const w = mountComponent()
        emitSubmit(w, { text: '  合同正文内容  ', files: [] })

        const events = w.emitted('submit')
        expect(events).toBeTruthy()
        expect(events!.length).toBe(1)
        expect(events![0][0]).toEqual({ sourceType: 'paste', text: '合同正文内容' })
        expect(toastWarning).not.toHaveBeenCalled()
    })

    it('单个 .docx emit upload 源，携带 ossFileId', () => {
        const w = mountComponent()
        emitSubmit(w, { text: '', files: [makeFile({ id: 2048 })] })

        const events = w.emitted('submit')
        expect(events).toBeTruthy()
        expect(events!.length).toBe(1)
        expect(events![0][0]).toEqual({ sourceType: 'upload', ossFileId: 2048 })
        expect(toastWarning).not.toHaveBeenCalled()
    })

    it('上传 2 个文件：toast 警告 + 不 emit', () => {
        const w = mountComponent()
        emitSubmit(w, {
            text: '',
            files: [makeFile({ id: 1 }), makeFile({ id: 2 })],
        })

        expect(w.emitted('submit')).toBeUndefined()
        expect(toastWarning).toHaveBeenCalledTimes(1)
        expect(toastWarning.mock.calls[0]?.[0]).toContain('只能上传一份合同')
    })

    it('非 .docx MIME：toast 警告 + 不 emit', () => {
        const w = mountComponent()
        emitSubmit(w, {
            text: '',
            files: [makeFile({ fileType: 'application/pdf', fileName: 'contract.pdf' })],
        })

        expect(w.emitted('submit')).toBeUndefined()
        expect(toastWarning).toHaveBeenCalledTimes(1)
        expect(toastWarning.mock.calls[0]?.[0]).toContain('.docx')
    })

    it('文件 size 超过 20 MB：toast 警告 + 不 emit', () => {
        const w = mountComponent()
        emitSubmit(w, {
            text: '',
            files: [makeFile({ fileSize: 21 * 1024 * 1024 })],
        })

        expect(w.emitted('submit')).toBeUndefined()
        expect(toastWarning).toHaveBeenCalledTimes(1)
        expect(toastWarning.mock.calls[0]?.[0]).toContain('20 MB')
    })

    it('文本为空且无文件：静默不 emit', () => {
        const w = mountComponent()
        emitSubmit(w, { text: '   ', files: [] })

        expect(w.emitted('submit')).toBeUndefined()
        expect(toastWarning).not.toHaveBeenCalled()
    })
})
