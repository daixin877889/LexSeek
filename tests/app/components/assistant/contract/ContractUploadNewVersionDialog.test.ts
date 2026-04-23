/**
 * ContractUploadNewVersionDialog 单元测试
 *
 * **Feature: contract-review-versioning-phase-b**
 *
 * 组件职责：
 * - 支持 v-model:open 控制显示/隐藏
 * - 文件选择（仅 .docx，≤20 MB）
 * - OSS 上传后调用 uploadNewVersion(ossFileId) 获得 SSE 响应式状态
 * - 渲染 5 个步骤（backup/parse/diff/ai/merge）及其 idle/progress/done/error 四态
 * - SSE complete 后 emit complete(payload)
 * - 关闭时重置状态
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, nextTick } from 'vue'
import type { Ref } from 'vue'
import type { StepState } from '~/composables/useContractReviewVersion'

// ── mock vue-sonner ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
vi.mock('vue-sonner', () => ({ toast: mockToast }))

// ── mock lucide-vue-next ───────────────────────────────────────────────────────
vi.mock('lucide-vue-next', () => {
    function icon(name: string) {
        return defineComponent({ setup: () => () => h('i', { 'data-icon': name }) })
    }
    return {
        UploadIcon: icon('Upload'),
        CheckCircleIcon: icon('CheckCircle'),
        AlertCircleIcon: icon('AlertCircle'),
        Loader2Icon: icon('Loader2'),
        FileIcon: icon('File'),
        XIcon: icon('X'),
    }
})

// ── mock useFileStore (Pinia store，自动导入) ──────────────────────────────────
const mockGetBatchPresignedUrls = vi.fn()
vi.mock('~/store/file', () => ({
    useFileStore: () => ({ getBatchPresignedUrls: mockGetBatchPresignedUrls }),
}))

// ── mock useBatchUpload ───────────────────────────────────────────────────────
const mockUploadToOSS = vi.fn()
vi.mock('~/composables/useBatchUpload', () => ({
    useBatchUpload: () => ({ uploadToOSS: mockUploadToOSS }),
}))

// ── mock useContractReviewVersion ─────────────────────────────────────────────
const mockUploadNewVersion = vi.fn()
vi.mock('~/composables/useContractReviewVersion', () => ({
    useContractReviewVersion: () => ({
        uploadNewVersion: mockUploadNewVersion,
        // 其他方法留空（本组件只用 uploadNewVersion）
        workspace: ref(null),
        versions: ref([]),
        previewVersionId: ref(null),
        previewSnapshot: ref(null),
        isReadOnly: ref(false),
        currentView: ref({ risks: [], annotations: [], docxText: '' }),
        hasUnsavedEdits: ref(false),
        refreshWorkspace: vi.fn(),
        refreshVersions: vi.fn(),
        enterPreview: vi.fn(),
        exitPreview: vi.fn(),
        saveNewVersion: vi.fn(),
        updateRiskArchivedStatus: vi.fn(),
        addLawyerAnnotation: vi.fn(),
        updateAnnotation: vi.fn(),
        deleteAnnotation: vi.fn(),
        updateVersionNote: vi.fn(),
    }),
}))

// ── 动态导入（mock 注册后）────────────────────────────────────────────────────
const { default: ContractUploadNewVersionDialog } = await import(
    '~/components/assistant/contract/ContractUploadNewVersionDialog.vue'
)

// ── 测试辅助 ──────────────────────────────────────────────────────────────────

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
        return () => h('button', { disabled: props.disabled || undefined, ...attrs }, slots.default?.())
    },
})

const stubs = {
    Dialog: DialogStub,
    DialogContent: passthrough('DialogContent'),
    DialogHeader: passthrough('DialogHeader'),
    DialogTitle: passthrough('DialogTitle'),
    DialogFooter: passthrough('DialogFooter'),
    Button: ButtonStub,
}

/** 制造测试用 .docx File */
function makeDocxFile(name = 'contract.docx') {
    return new File(['content'], name, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
}

/** 制造 uploadNewVersion 返回的受控状态 */
function makeSseState() {
    const steps = ref<StepState[]>([
        { key: 'backup', label: '备份当前版本', status: 'idle' },
        { key: 'parse', label: '解析新文档', status: 'idle' },
        { key: 'diff', label: '对比变更', status: 'idle' },
        { key: 'ai', label: 'AI 分析', status: 'idle' },
        { key: 'merge', label: '合并与更新', status: 'idle' },
    ])
    const done = ref(false)
    const result = ref<{ newVersionId: number; summary: string } | null>(null)
    const error = ref<{ step: string; message: string } | null>(null)
    return { steps, done, result, error }
}

/** 选择文件 */
async function selectFile(w: ReturnType<typeof mount>, file: File) {
    const input = w.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await nextTick()
}

/** 点击包含 label 文本的按钮 */
function findButton(w: ReturnType<typeof mount>, label: string) {
    return w.findAll('button').find(b => b.text().includes(label))
}

// ── 测试用例 ──────────────────────────────────────────────────────────────────

describe('ContractUploadNewVersionDialog', () => {
    beforeEach(() => {
        mockGetBatchPresignedUrls.mockResolvedValue([{
            host: 'https://oss.example.com',
            policy: 'policy',
            signature: 'sig',
            key: 'uploads/test.docx',
            dir: 'uploads/',
        }])
        mockUploadToOSS.mockResolvedValue({ id: 123 })
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    it('open=false 时对话框内容不渲染', () => {
        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: false, reviewId: 1 },
            global: { stubs },
        })
        expect(w.find('[data-stub="DialogContent"]').exists()).toBe(false)
    })

    it('open=true 时显示文件选择区域', () => {
        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        expect(w.find('[data-stub="DialogContent"]').exists()).toBe(true)
        expect(w.find('input[type="file"]').exists()).toBe(true)
    })

    it('选择 .docx 文件后显示文件名和上传按钮', async () => {
        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        await selectFile(w, makeDocxFile('my-contract.docx'))
        expect(w.text()).toContain('my-contract.docx')
        expect(findButton(w, '上传')).toBeTruthy()
    })

    it('选择非 .docx 文件时 toast.warning 提示且不显示文件名', async () => {
        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        const txtFile = new File(['x'], 'doc.txt', { type: 'text/plain' })
        await selectFile(w, txtFile)
        expect(mockToast.warning).toHaveBeenCalledWith(expect.stringMatching(/docx/i))
        expect(w.text()).not.toContain('doc.txt')
    })

    it('完成 OSS 上传后调用 uploadNewVersion，渲染 5 个步骤', async () => {
        const sseState = makeSseState()
        mockUploadNewVersion.mockResolvedValue(sseState)

        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        await selectFile(w, makeDocxFile())
        await findButton(w, '上传')!.trigger('click')
        await flushPromises()
        await nextTick()

        expect(mockUploadNewVersion).toHaveBeenCalledWith(123)
        expect(w.findAll('[data-step]').length).toBe(5)
    })

    it('SSE progress 事件：backup 步骤从 idle → progress', async () => {
        const sseState = makeSseState()
        mockUploadNewVersion.mockResolvedValue(sseState)

        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        await selectFile(w, makeDocxFile())
        await findButton(w, '上传')!.trigger('click')
        await flushPromises()
        await nextTick()

        // 模拟 SSE progress 事件
        sseState.steps.value = sseState.steps.value.map(s =>
            s.key === 'backup' ? { ...s, status: 'progress' } : s
        )
        await nextTick()

        const backupStep = w.find('[data-step="backup"]')
        expect(backupStep.exists()).toBe(true)
        expect(backupStep.attributes('data-status')).toBe('progress')
    })

    it('SSE progress 事件：backup done 后步骤变 done', async () => {
        const sseState = makeSseState()
        mockUploadNewVersion.mockResolvedValue(sseState)

        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        await selectFile(w, makeDocxFile())
        await findButton(w, '上传')!.trigger('click')
        await flushPromises()
        await nextTick()

        sseState.steps.value = sseState.steps.value.map(s =>
            s.key === 'backup' ? { ...s, status: 'done' } : s
        )
        await nextTick()

        expect(w.find('[data-step="backup"]').attributes('data-status')).toBe('done')
    })

    it('SSE error 事件：出错步骤变 error，显示错误提示', async () => {
        const sseState = makeSseState()
        mockUploadNewVersion.mockResolvedValue(sseState)

        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        await selectFile(w, makeDocxFile())
        await findButton(w, '上传')!.trigger('click')
        await flushPromises()
        await nextTick()

        sseState.steps.value = sseState.steps.value.map(s =>
            s.key === 'diff' ? { ...s, status: 'error' } : s
        )
        sseState.error.value = { step: 'diff', message: '差异计算失败' }
        await nextTick()

        expect(w.find('[data-step="diff"]').attributes('data-status')).toBe('error')
        expect(w.text()).toContain('差异计算失败')
    })

    it('SSE complete 事件：done=true 时 emit complete，显示摘要', async () => {
        const sseState = makeSseState()
        mockUploadNewVersion.mockResolvedValue(sseState)

        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        await selectFile(w, makeDocxFile())
        await findButton(w, '上传')!.trigger('click')
        await flushPromises()
        await nextTick()

        sseState.result.value = { newVersionId: 42, summary: '新增 3 处变更' }
        sseState.done.value = true
        await nextTick()

        // 显示摘要文本
        expect(w.text()).toContain('新增 3 处变更')

        // 点击完成按钮触发 emit
        const closeBtn = findButton(w, '完成')
        expect(closeBtn).toBeTruthy()
        await closeBtn!.trigger('click')

        const emitted = w.emitted('complete')
        expect(emitted).toBeTruthy()
        expect(emitted![0][0]).toEqual({ newVersionId: 42, summary: '新增 3 处变更' })
    })

    it('关闭后重新打开：状态重置', async () => {
        const sseState = makeSseState()
        mockUploadNewVersion.mockResolvedValue(sseState)

        const w = mount(ContractUploadNewVersionDialog, {
            props: { open: true, reviewId: 1 },
            global: { stubs },
        })
        await selectFile(w, makeDocxFile())
        await findButton(w, '上传')!.trigger('click')
        await flushPromises()
        await nextTick()

        // 关闭
        await w.setProps({ open: false })
        await nextTick()
        // 重新打开
        await w.setProps({ open: true })
        await nextTick()

        // 文件选择区域重新显示，步骤消失
        expect(w.find('input[type="file"]').exists()).toBe(true)
        expect(w.findAll('[data-step]').length).toBe(0)
    })
})
