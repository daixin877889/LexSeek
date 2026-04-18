/**
 * ContractReviewPanel 单元测试
 *
 * **Feature: contract-review-m4**
 *
 * 主容器组件职责（M4 三屏 + Dialog）：
 * - review == null && !isLoading → 显示 ContractSourceInput（提交屏）
 * - review != null → 显示结果屏（左 DocxPreview + 右 RiskListPanel）
 * - awaitingStance 非空 → StanceSelectionDialog open=true（始终挂载）
 * - runStatus 文案：pending/reviewing/awaiting_stance/completed/failed 内联映射
 * - 顶部 busy 条（Loader2Icon + statusLabel）仅在 isLoading || status in (pending,reviewing) 时显示
 * - props.reviewId 传入时 immediate 触发 mountReview 一次
 * - ContractSourceInput @submit → onStart
 * - StanceSelectionDialog @confirm → onStance
 * - RiskListPanel @download → onDownload
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, computed, nextTick } from 'vue'
import type { contractReviews } from '~~/generated/prisma/client'

// ── mock vue-sonner toast（组件内 import toast from 'vue-sonner'）─────────────
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastWarning = vi.fn()
vi.mock('vue-sonner', () => ({
    toast: {
        info: (...args: unknown[]) => mockToastInfo(...args),
        error: (...args: unknown[]) => mockToastError(...args),
        success: (...args: unknown[]) => mockToastSuccess(...args),
        warning: (...args: unknown[]) => mockToastWarning(...args),
    },
}))

// ── mock lucide-vue-next Loader2Icon（脚本内直接 import，globalStubs 无法注入）──
vi.mock('lucide-vue-next', () => ({
    Loader2Icon: defineComponent({
        name: 'Loader2Icon',
        setup: () => () => h('i', { 'data-stub': 'Loader2Icon' }),
    }),
}))

// ── mock useContractReview ──────────────────────────────────────────────────
// 用受测试控制的 refs，驱动组件的三屏/Dialog/busy 行为。

const reviewRef = ref<contractReviews | null>(null)
const reviewIdRef = ref<number | null>(null)
const runStatusRef = ref<'idle' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'>('idle')
const isLoadingRef = ref(false)
const interruptDataRef = ref<Record<string, unknown> | null>(null)
const awaitingStanceRef = ref<{ partyA?: string; partyB?: string; contractType?: string } | null>(null)
const hasUnsavedDocxChangesRef = ref(false)

const mockOnStart = vi.fn()
const mockMountReview = vi.fn()
const mockOnStance = vi.fn()
const mockOnDownload = vi.fn()
const mockOnEditRisks = vi.fn()
const mockOnRebuildDocx = vi.fn()
const mockCancelReview = vi.fn().mockResolvedValue(undefined)

vi.mock('~/composables/useContractReview', () => ({
    useContractReview: () => ({
        review: reviewRef,
        reviewId: reviewIdRef,
        runStatus: computed(() => runStatusRef.value),
        isLoading: computed(() => isLoadingRef.value),
        interruptData: computed(() => interruptDataRef.value),
        awaitingStance: computed(() => awaitingStanceRef.value),
        isRebuilding: computed(() => reviewRef.value?.status === 'rebuilding'),
        hasUnsavedDocxChanges: hasUnsavedDocxChangesRef,
        onStart: mockOnStart,
        mountReview: mockMountReview,
        onStance: mockOnStance,
        onDownload: mockOnDownload,
        onEditRisks: mockOnEditRisks,
        onRebuildDocx: mockOnRebuildDocx,
        cancelReview: mockCancelReview,
    }),
}))

// ── 子组件 stubs：记录 props 便于断言 ───────────────────────────────────────

const SourceInputStub = defineComponent({
    name: 'AssistantContractContractSourceInput',
    emits: ['submit'],
    setup(_, { emit }) {
        return () =>
            h(
                'button',
                {
                    'data-stub': 'ContractSourceInput',
                    onClick: () => emit('submit', { sourceType: 'paste', text: 'hello' }),
                },
                '提交',
            )
    },
})

const StanceDialogStub = defineComponent({
    name: 'AssistantContractStanceSelectionDialog',
    props: {
        open: Boolean,
        partyA: { type: [String, null] as unknown as () => string | null, default: null },
        partyB: { type: [String, null] as unknown as () => string | null, default: null },
        contractType: { type: [String, null] as unknown as () => string | null, default: null },
    },
    emits: ['confirm', 'cancel', 'update:open'],
    setup(props, { emit }) {
        return () =>
            h(
                'div',
                { 'data-stub': 'StanceSelectionDialog', 'data-open': String(props.open) },
                [
                    h(
                        'button',
                        {
                            'data-stub-btn': 'confirm',
                            'data-party-a': props.partyA ?? '',
                            'data-party-b': props.partyB ?? '',
                            'data-contract-type': props.contractType ?? '',
                            onClick: () => emit('confirm', { stance: 'partyA', partyA: 'A', partyB: 'B' }),
                        },
                        'confirm',
                    ),
                    h(
                        'button',
                        {
                            'data-stub-btn': 'cancel',
                            onClick: () => {
                                emit('cancel')
                                emit('update:open', false)
                            },
                        },
                        'cancel',
                    ),
                ],
            )
    },
})

const DocxPreviewStub = defineComponent({
    name: 'AssistantContractContractDocxPreview',
    props: {
        reviewedFileId: { type: [Number, null] as unknown as () => number | null, default: null },
        originalFileId: { type: [Number, null] as unknown as () => number | null, default: null },
    },
    setup(props) {
        return () =>
            h('div', {
                'data-stub': 'ContractDocxPreview',
                'data-reviewed-file-id': props.reviewedFileId ?? '',
                'data-original-file-id': props.originalFileId ?? '',
            })
    },
})

const RiskListPanelStub = defineComponent({
    name: 'AssistantContractRiskListPanel',
    props: {
        risks: { type: Array, default: () => [] },
        status: { type: String, default: 'pending' },
        reviewedFileId: { type: [Number, null] as unknown as () => number | null, default: null },
        summary: { type: [String, null] as unknown as () => string | null, default: null },
        isRebuilding: { type: Boolean, default: false },
        hasUnsavedDocxChanges: { type: Boolean, default: false },
    },
    emits: ['download', 'rebuild', 'editRisks'],
    setup(props, { emit }) {
        return () =>
            h(
                'div',
                {
                    'data-stub': 'RiskListPanel',
                    'data-status': props.status,
                    'data-risk-count': String((props.risks as unknown[]).length),
                    'data-summary': props.summary ?? '',
                    'data-is-rebuilding': String(props.isRebuilding),
                    'data-has-unsaved': String(props.hasUnsavedDocxChanges),
                },
                [
                    h('button', { 'data-stub-btn': 'download', onClick: () => emit('download') }, 'download'),
                    h('button', { 'data-stub-btn': 'rebuild', onClick: () => emit('rebuild') }, 'rebuild'),
                    h(
                        'button',
                        {
                            'data-stub-btn': 'edit-risks',
                            onClick: () => emit('editRisks', [{ id: 'nr', clauseIndex: 0 }]),
                        },
                        'edit-risks',
                    ),
                ],
            )
    },
})

const stubs = {
    AssistantContractContractSourceInput: SourceInputStub,
    AssistantContractStanceSelectionDialog: StanceDialogStub,
    AssistantContractContractDocxPreview: DocxPreviewStub,
    AssistantContractRiskListPanel: RiskListPanelStub,
}

// ── 动态导入（确保 mock 先完成）─────────────────────────────────────────────

const ContractReviewPanel = (await import('~/components/assistant/contract/ContractReviewPanel.vue'))
    .default

function makeReview(over: Partial<contractReviews> = {}): contractReviews {
    return {
        id: 1,
        userId: 1,
        sessionId: 'sess-1',
        originalFileId: 100,
        reviewedFileId: null,
        status: 'reviewing',
        stance: null,
        partyA: null,
        partyB: null,
        contractType: null,
        risks: [],
        summary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...over,
    } as unknown as contractReviews
}

const mountedWrappers: Array<{ unmount: () => void }> = []

function mountPanel(props: { reviewId?: number | null } = {}) {
    const w = mount(ContractReviewPanel, {
        props,
        global: { stubs },
    })
    mountedWrappers.push(w as unknown as { unmount: () => void })
    return w
}

function resetRefs() {
    reviewRef.value = null
    reviewIdRef.value = null
    runStatusRef.value = 'idle'
    isLoadingRef.value = false
    interruptDataRef.value = null
    awaitingStanceRef.value = null
    hasUnsavedDocxChangesRef.value = false
}

beforeEach(() => {
    resetRefs()
    mockOnStart.mockReset()
    mockMountReview.mockReset()
    mockOnStance.mockReset()
    mockOnDownload.mockReset()
    mockOnEditRisks.mockReset()
    mockOnRebuildDocx.mockReset()
    mockCancelReview.mockClear()
    mockToastInfo.mockReset()
    mockToastError.mockReset()
    mockToastSuccess.mockReset()
    mockToastWarning.mockReset()
})

afterEach(() => {
    while (mountedWrappers.length) {
        try { mountedWrappers.pop()?.unmount() } catch { /* ignore */ }
    }
})

describe('ContractReviewPanel', () => {
    it('初始状态（review=null，!isLoading）显示提交屏，不渲染结果屏', () => {
        const w = mountPanel()
        expect(w.find('[data-stub="ContractSourceInput"]').exists()).toBe(true)
        expect(w.find('[data-stub="ContractDocxPreview"]').exists()).toBe(false)
        expect(w.find('[data-stub="RiskListPanel"]').exists()).toBe(false)
    })

    it('StanceSelectionDialog 始终挂载（初始关闭态 open=false）', () => {
        const w = mountPanel()
        const dlg = w.find('[data-stub="StanceSelectionDialog"]')
        expect(dlg.exists()).toBe(true)
        expect(dlg.attributes('data-open')).toBe('false')
    })

    it('review 非空时显示结果屏（DocxPreview + RiskListPanel），隐藏提交屏', async () => {
        reviewRef.value = makeReview({ status: 'reviewing', originalFileId: 77, reviewedFileId: null })
        runStatusRef.value = 'reviewing'
        const w = mountPanel()
        await nextTick()

        expect(w.find('[data-stub="ContractSourceInput"]').exists()).toBe(false)
        const preview = w.find('[data-stub="ContractDocxPreview"]')
        expect(preview.exists()).toBe(true)
        expect(preview.attributes('data-original-file-id')).toBe('77')
        expect(preview.attributes('data-reviewed-file-id')).toBe('')

        const risk = w.find('[data-stub="RiskListPanel"]')
        expect(risk.exists()).toBe(true)
        expect(risk.attributes('data-status')).toBe('reviewing')
    })

    it('status=reviewing 时顶部 busy 条显示"AI 正在逐条审查合同条款..."', async () => {
        reviewRef.value = makeReview({ status: 'reviewing' })
        runStatusRef.value = 'reviewing'
        const w = mountPanel()
        await nextTick()
        expect(w.text()).toContain('AI 正在逐条审查合同条款...')
        expect(w.find('[data-stub="Loader2Icon"]').exists()).toBe(true)
    })

    it('status=completed 时 busy 条隐藏（showBusy=false），statusLabel 不渲染', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 999 })
        runStatusRef.value = 'completed'
        const w = mountPanel()
        await nextTick()
        expect(w.find('[data-stub="Loader2Icon"]').exists()).toBe(false)
        expect(w.text()).not.toContain('AI 正在逐条审查合同条款...')
    })

    it('status=failed 时 busy 条隐藏，RiskListPanel 仍挂载并收到 failed', async () => {
        reviewRef.value = makeReview({ status: 'failed' })
        runStatusRef.value = 'failed'
        const w = mountPanel()
        await nextTick()
        expect(w.find('[data-stub="Loader2Icon"]').exists()).toBe(false)
        const risk = w.find('[data-stub="RiskListPanel"]')
        expect(risk.attributes('data-status')).toBe('failed')
    })

    it('status=pending 时 busy 条显示"准备中..."', async () => {
        reviewRef.value = makeReview({ status: 'pending' })
        runStatusRef.value = 'reviewing'
        const w = mountPanel()
        await nextTick()
        expect(w.text()).toContain('准备中...')
    })

    it('awaitingStance 非空时 Dialog open=true 且 partyA/partyB/contractType 传入', async () => {
        awaitingStanceRef.value = { partyA: '甲公司', partyB: '乙公司', contractType: '购销合同' }
        runStatusRef.value = 'awaiting_stance'
        const w = mountPanel()
        await nextTick()
        const dlg = w.find('[data-stub="StanceSelectionDialog"]')
        expect(dlg.attributes('data-open')).toBe('true')
        const confirmBtn = w.find('[data-stub-btn="confirm"]')
        expect(confirmBtn.attributes('data-party-a')).toBe('甲公司')
        expect(confirmBtn.attributes('data-party-b')).toBe('乙公司')
        expect(confirmBtn.attributes('data-contract-type')).toBe('购销合同')
    })

    it('ContractSourceInput @submit 触发 onStart', async () => {
        const w = mountPanel()
        await w.find('[data-stub="ContractSourceInput"]').trigger('click')
        expect(mockOnStart).toHaveBeenCalledTimes(1)
        expect(mockOnStart).toHaveBeenCalledWith({ sourceType: 'paste', text: 'hello' })
    })

    it('StanceSelectionDialog @confirm 触发 onStance', async () => {
        awaitingStanceRef.value = { partyA: 'A', partyB: 'B' }
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="confirm"]').trigger('click')
        expect(mockOnStance).toHaveBeenCalledTimes(1)
        expect(mockOnStance).toHaveBeenCalledWith({ stance: 'partyA', partyA: 'A', partyB: 'B' })
    })

    it('StanceSelectionDialog @cancel 触发 cancelReview（放弃整个审查）', async () => {
        awaitingStanceRef.value = { partyA: 'A', partyB: 'B' }
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="cancel"]').trigger('click')
        await flushPromises()
        expect(mockCancelReview).toHaveBeenCalledTimes(1)
        expect(mockOnStance).not.toHaveBeenCalled()
    })

    it('RiskListPanel @download 触发 onDownload', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 999 })
        runStatusRef.value = 'completed'
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="download"]').trigger('click')
        expect(mockOnDownload).toHaveBeenCalledTimes(1)
    })

    it('props.reviewId 传入时 immediate 触发 mountReview 一次', async () => {
        mountPanel({ reviewId: 42 })
        await flushPromises()
        expect(mockMountReview).toHaveBeenCalledTimes(1)
        expect(mockMountReview).toHaveBeenCalledWith(42)
    })

    it('props.reviewId 为 null 时不调用 mountReview', async () => {
        mountPanel({ reviewId: null })
        await flushPromises()
        expect(mockMountReview).not.toHaveBeenCalled()
    })

    it('RiskListPanel 收到 review.risks / summary / reviewedFileId', async () => {
        reviewRef.value = makeReview({
            status: 'completed',
            reviewedFileId: 555,
            risks: [{ id: 'r1', clauseIndex: 0 }, { id: 'r2', clauseIndex: 1 }] as unknown as contractReviews['risks'],
            summary: '整体风险可控',
        })
        runStatusRef.value = 'completed'
        const w = mountPanel()
        await nextTick()
        const risk = w.find('[data-stub="RiskListPanel"]')
        expect(risk.attributes('data-risk-count')).toBe('2')
        expect(risk.attributes('data-summary')).toBe('整体风险可控')
    })

    it('isLoading=true 且 review=null 时不显示提交屏（防止闪烁）', async () => {
        isLoadingRef.value = true
        const w = mountPanel()
        await nextTick()
        expect(w.find('[data-stub="ContractSourceInput"]').exists()).toBe(false)
    })
})

describe('ContractReviewPanel M5 接线', () => {
    it('review.status=rebuilding → 传给 RiskListPanel 的 :isRebuilding=true', async () => {
        reviewRef.value = makeReview({ status: 'rebuilding', reviewedFileId: 1 } as unknown as Partial<contractReviews>)
        const w = mountPanel()
        await nextTick()
        const risk = w.find('[data-stub="RiskListPanel"]')
        expect(risk.attributes('data-is-rebuilding')).toBe('true')
    })

    it('hasUnsavedDocxChanges=true 时透传给 RiskListPanel', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        hasUnsavedDocxChangesRef.value = true
        const w = mountPanel()
        await nextTick()
        const risk = w.find('[data-stub="RiskListPanel"]')
        expect(risk.attributes('data-has-unsaved')).toBe('true')
    })

    it('RiskListPanel emit rebuild → 调 onRebuildDocx', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="rebuild"]').trigger('click')
        expect(mockOnRebuildDocx).toHaveBeenCalledTimes(1)
    })

    it('RiskListPanel emit edit-risks → 调 onEditRisks with 新 risks 数组', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="edit-risks"]').trigger('click')
        expect(mockOnEditRisks).toHaveBeenCalledTimes(1)
        expect(mockOnEditRisks).toHaveBeenCalledWith([{ id: 'nr', clauseIndex: 0 }])
    })

    it('isRebuilding 从 false 变 true → 弹 toast.info 一次', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        mountPanel()
        await nextTick()
        expect(mockToastInfo).not.toHaveBeenCalled()

        reviewRef.value = makeReview({ status: 'rebuilding', reviewedFileId: 1 } as unknown as Partial<contractReviews>)
        await nextTick()
        expect(mockToastInfo).toHaveBeenCalledTimes(1)
        expect(mockToastInfo).toHaveBeenCalledWith('批注正在重新生成，请稍候...')
    })

    it('isRebuilding 保持 true → 不重复弹 toast.info', async () => {
        reviewRef.value = makeReview({ status: 'rebuilding', reviewedFileId: 1 } as unknown as Partial<contractReviews>)
        mountPanel()
        await nextTick()
        // mount 时 isRebuilding 已为 true（非 false→true 转变），watch 不 immediate，不应触发
        expect(mockToastInfo).not.toHaveBeenCalled()

        // 保持 true 下改 reviewedFileId（触发 review 重设但 isRebuilding 未变）
        reviewRef.value = makeReview({ status: 'rebuilding', reviewedFileId: 2 } as unknown as Partial<contractReviews>)
        await nextTick()
        expect(mockToastInfo).not.toHaveBeenCalled()
    })
})
