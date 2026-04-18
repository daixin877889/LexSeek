/**
 * AiChat 组件接口扩展测试
 *
 * **Feature: contract-review-m1 / Task 11.1**
 *
 * 验证点：
 * 1. AiChat 新增 `onFileButtonClick` prop，会透传给内部 AiPromptInput
 * 2. AiChat 的 defineExpose 新增 `addFiles` 和 `selectedFileIds`（保留原有 `resetPrompt`）
 *
 * 说明：
 * - AiPromptInput 被 stub，通过 stub 的 expose 模拟 addFiles/selectedFileIds 行为，
 *   这样测试聚焦于 AiChat 的透传与转发契约，避免拉起完整文件上传依赖。
 */

import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import AiChat from '~/components/ai/AiChat.vue'

/**
 * 创建 AiPromptInput stub，暴露 addFiles / selectedFileIds / reset，
 * 并在 onFileButtonClick 存在时渲染一个按钮用于触发事件。
 */
function createPromptInputStub(addFilesSpy: (files: unknown[]) => void, fileIds: number[]) {
    return defineComponent({
        name: 'AiPromptInput',
        props: {
            onFileButtonClick: { type: Function, default: undefined },
            loading: Boolean,
            disabled: Boolean,
            placeholder: String,
            enableFileUpload: Boolean,
            showThinkingToggle: Boolean,
            thinking: Boolean,
            queueLength: Number,
            queueFull: Boolean,
            isStopping: Boolean,
        },
        setup(props, { expose }) {
            expose({
                reset: () => { },
                addFiles: (files: unknown[]) => addFilesSpy(files),
                get selectedFileIds() {
                    return fileIds
                },
            })
            return () => h('button', {
                class: 'stub-file-btn',
                onClick: () => props.onFileButtonClick?.(),
            }, 'file')
        },
    })
}

const commonStubs = {
    AiMessageList: { template: '<div class="stub-message-list" />' },
    AiTaskQueue: { template: '<div class="stub-task-queue" />' },
    Button: { template: '<button><slot /></button>' },
    ResizablePanelGroup: { template: '<div><slot /></div>' },
    ResizablePanel: { template: '<div><slot /></div>' },
    ResizableHandle: { template: '<div />' },
    ClientOnly: { template: '<div><slot /></div>' },
}

describe('AiChat 文件按钮与 ref 接口扩展', () => {
    it('将 onFileButtonClick 透传给内部 AiPromptInput', async () => {
        const handler = vi.fn()
        const PromptInputStub = createPromptInputStub(() => { }, [])

        const wrapper = mount(AiChat, {
            props: {
                messages: [],
                enableFileUpload: true,
                onFileButtonClick: handler,
                panelMode: 'left',
                showHeader: false,
            },
            global: {
                stubs: {
                    ...commonStubs,
                    AiPromptInput: PromptInputStub,
                },
            },
        })

        const btn = wrapper.find('.stub-file-btn')
        expect(btn.exists()).toBe(true)
        await btn.trigger('click')
        expect(handler).toHaveBeenCalledTimes(1)
    })

    it('通过 ref 暴露 selectedFileIds 和 addFiles，并保留 resetPrompt', () => {
        const addFilesSpy = vi.fn()
        const fileIds = [101, 202]
        const PromptInputStub = createPromptInputStub(addFilesSpy, fileIds)

        const wrapper = mount(AiChat, {
            props: {
                messages: [],
                enableFileUpload: true,
                panelMode: 'left',
                showHeader: false,
            },
            global: {
                stubs: {
                    ...commonStubs,
                    AiPromptInput: PromptInputStub,
                },
            },
        })

        const vm = wrapper.vm as unknown as {
            selectedFileIds: number[]
            addFiles: (f: unknown[]) => void
            resetPrompt: () => void
        }

        expect(typeof vm.resetPrompt).toBe('function')
        expect(typeof vm.addFiles).toBe('function')
        expect(Array.isArray(vm.selectedFileIds)).toBe(true)
        expect(vm.selectedFileIds).toEqual(fileIds)

        const payload = [{ id: 1 }, { id: 2 }]
        vm.addFiles(payload)
        expect(addFilesSpy).toHaveBeenCalledWith(payload)
    })
})
