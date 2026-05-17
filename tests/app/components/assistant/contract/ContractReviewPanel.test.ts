/**
 * ContractReviewPanel 单元测试
 *
 * **Feature: contract-review-m4**
 *
 * 主容器组件职责（M4 两屏 + Dialog）：
 * - review != null → 显示结果屏（左 DocxPreview + 右 RiskListPanel）
 * - awaitingStance 非空 → StanceSelectionDialog open=true（始终挂载）
 * - runStatus 文案：pending/reviewing/awaiting_stance/completed/failed 内联映射
 * - 顶部 busy 条（Loader2Icon + statusLabel）仅在 isLoading || status in (pending,reviewing) 时显示
 * - props.reviewId 传入时 immediate 触发 mountReview 一次
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

// ── mock lucide-vue-next（代理式自动 stub）──
// 任意图标名按需自动生成 stub，覆盖全部传递依赖（contractRiskLevelStyle / RiskCard /
// RiskDetailPanel / ContractDocxPreview 等）引入的图标，避免漏列导致整测试文件无法收集。
vi.mock('lucide-vue-next', () => {
    const made = new Map<string, unknown>()
    const make = (name: string) => defineComponent({
        name,
        setup: () => () => h('i', { 'data-stub': name }),
    })
    return new Proxy({} as Record<string, unknown>, {
        get(_t, prop: string | symbol) {
            if (typeof prop !== 'string') return undefined
            if (prop === '__esModule') return true
            if (prop === 'default') return undefined
            if (!made.has(prop)) made.set(prop, make(prop))
            return made.get(prop)
        },
        has: () => true,
    })
})

// ── mock useContractReview ──────────────────────────────────────────────────
// 用受测试控制的 refs，驱动组件的三屏/Dialog/busy 行为。

const reviewRef = ref<contractReviews | null>(null)
const reviewIdRef = ref<number | null>(null)
const runStatusRef = ref<'idle' | 'reviewing' | 'awaiting_stance' | 'completed' | 'failed'>('idle')
const isLoadingRef = ref(false)
const interruptDataRef = ref<Record<string, unknown> | null>(null)
const awaitingStanceRef = ref<{ partyA?: string; partyB?: string; contractType?: string } | null>(null)
const hasUnsavedDocxChangesRef = ref(false)
const stageStatusRef = ref({ detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait' })
const totalClausesRef = ref<number | null>(null)
const analyzingClauseIndexRef = ref<number | null>(null)
const analyzeWarningsRef = ref<string[]>([])

const mockOnStart = vi.fn()
const mockMountReview = vi.fn()
const mockOnStance = vi.fn()
const mockOnDownload = vi.fn()
const mockOnExportPdf = vi.fn()
const mockOnEditRisks = vi.fn()
const mockOnRebuildDocx = vi.fn()
const mockCancelReview = vi.fn().mockResolvedValue(undefined)
// Task 4.5 新增：聚焦/悬停/钉状态与动作
const focusedRiskIdRef = ref<string | null>(null)
const hoveredRiskIdRef = ref<string | null>(null)
const pinnedRiskIdsRef = ref<Set<string>>(new Set())
const highlightedRiskIdsRef = computed(() => {
    const s = new Set(pinnedRiskIdsRef.value)
    if (focusedRiskIdRef.value) s.add(focusedRiskIdRef.value)
    return s
})
const mockFocusRisk = vi.fn()
const mockTogglePin = vi.fn()
const mockSetHoveredRisk = vi.fn()
const mockClearAllPins = vi.fn()
// notLocated/hasLocated 与 markLocated/reset 由 useContractRiskHighlight 接管
const notLocatedIdsRef = ref<Set<string>>(new Set())
const hasLocatedRef = ref(false)
const mockMarkLocated = vi.fn((ids: Set<string>) => {
    hasLocatedRef.value = true
    notLocatedIdsRef.value = ids
})
const mockResetRiskFocus = vi.fn(() => {
    hasLocatedRef.value = false
    notLocatedIdsRef.value = new Set()
})

// TODO 阶段 7：useContractReview 已删除（→ useContractAgent + 3 sub-composable）
// describe 已 skip，原 mock 仅作为占位逻辑保留（运行期不会执行）。
// vitest mock factory 不强制要求 path 存在（virtual module 模式），保留旧 path 不报错
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
        stageStatus: stageStatusRef,
        totalClauses: totalClausesRef,
        analyzingClauseIndex: analyzingClauseIndexRef,
        analyzeWarnings: analyzeWarningsRef,
        onStart: mockOnStart,
        mountReview: mockMountReview,
        onStance: mockOnStance,
        onDownload: mockOnDownload,
        onExportPdf: mockOnExportPdf,
        onEditRisks: mockOnEditRisks,
        onRebuildDocx: mockOnRebuildDocx,
        cancelReview: mockCancelReview,
    }),
}))

// 聚焦/钉/悬停 + 定位状态由 useContractRiskHighlight 提供
vi.mock('~/composables/useContractRiskHighlight', () => ({
    useContractRiskHighlight: () => ({
        focusedRiskId: focusedRiskIdRef,
        hoveredRiskId: hoveredRiskIdRef,
        pinnedRiskIds: pinnedRiskIdsRef,
        highlightedRiskIds: highlightedRiskIdsRef,
        notLocatedIds: notLocatedIdsRef,
        hasLocated: hasLocatedRef,
        // 保留真实 composable 的"未定位拦截"语义：notLocatedIds 命中则不调 focusRisk
        focusRisk: (id: string | null) => {
            if (id && notLocatedIdsRef.value.has(id)) return
            mockFocusRisk(id)
        },
        togglePin: mockTogglePin,
        setHoveredRisk: mockSetHoveredRisk,
        clearAllPins: mockClearAllPins,
        markLocated: mockMarkLocated,
        reset: mockResetRiskFocus,
    }),
}))

// 避免组件 mount 时调用真实 useApiFetch 触发 404 unhandled rejection
vi.mock('~/composables/useContractReviewVersion', () => ({
    useContractReviewVersion: () => ({
        workspace: ref({ risks: [], annotations: [], currentVersionId: null, maxVersionNo: 0 }),
        versions: ref([]),
        previewVersionId: ref(null),
        previewSnapshot: ref(null),
        isReadOnly: computed(() => false),
        currentView: computed(() => ({ risks: [], annotations: [], docxText: '' })),
        hasUnsavedEdits: computed(() => false),
        lastUploadResult: ref(null),
        dismissUploadBanner: vi.fn(),
        refreshWorkspace: vi.fn().mockResolvedValue(undefined),
        refreshVersions: vi.fn().mockResolvedValue(undefined),
        enterPreview: vi.fn(),
        exitPreview: vi.fn(),
        saveNewVersion: vi.fn().mockResolvedValue(true),
        updateRiskArchivedStatus: vi.fn(),
        addLawyerAnnotation: vi.fn(),
        updateAnnotation: vi.fn(),
        deleteAnnotation: vi.fn(),
        restoreAnnotationPush: vi.fn(),
        updateVersionNote: vi.fn(),
        uploadNewVersion: vi.fn(),
    }),
}))

// ── 子组件 stubs：记录 props 便于断言 ───────────────────────────────────────

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
    // 同上，折叠为 AssistantContractDocxPreview
    name: 'AssistantContractDocxPreview',
    props: {
        reviewedFileId: { type: [Number, null] as unknown as () => number | null, default: null },
        originalFileId: { type: [Number, null] as unknown as () => number | null, default: null },
        risks: { type: Array, default: () => [] },
        focusedRiskId: { type: [String, null] as unknown as () => string | null, default: null },
        hoveredRiskId: { type: [String, null] as unknown as () => string | null, default: null },
        highlightedRiskIds: { type: Object as unknown as () => Set<string>, default: () => new Set() },
    },
    emits: ['focusRisk', 'hoverClause', 'locateResult'],
    setup(props, { emit }) {
        return () =>
            h('div', {
                'data-stub': 'ContractDocxPreview',
                'data-reviewed-file-id': props.reviewedFileId ?? '',
                'data-original-file-id': props.originalFileId ?? '',
                'data-focused-risk-id': props.focusedRiskId ?? '',
                'data-hovered-risk-id': props.hoveredRiskId ?? '',
            }, [
                h('button', {
                    'data-stub-btn': 'hover-clause',
                    onClick: () => emit('hoverClause', 'risk-hover-1'),
                }, 'hover'),
                h('button', {
                    'data-stub-btn': 'focus-risk-from-preview',
                    onClick: () => emit('focusRisk', 'risk-from-preview'),
                }, 'focus'),
                h('button', {
                    'data-stub-btn': 'locate-result-with-r1',
                    onClick: () => emit('locateResult', new Set(['r1'])),
                }, 'locate-result'),
            ])
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
        focusedRiskId: { type: [String, null] as unknown as () => string | null, default: null },
        hoveredRiskId: { type: [String, null] as unknown as () => string | null, default: null },
        pinnedRiskIds: { type: Object as unknown as () => Set<string>, default: () => new Set() },
        notLocatedIds: { type: Object as unknown as () => Set<string>, default: () => new Set() },
    },
    emits: ['download', 'rebuild', 'editRisks', 'focusRisk', 'togglePin'],
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
                    'data-focused-risk-id': props.focusedRiskId ?? '',
                    'data-hovered-risk-id': props.hoveredRiskId ?? '',
                    'data-not-located-count': String((props.notLocatedIds as Set<string>).size),
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
                    h(
                        'button',
                        {
                            'data-stub-btn': 'focus-risk',
                            onClick: () => emit('focusRisk', 'risk-from-list'),
                        },
                        'focus-risk',
                    ),
                    h(
                        'button',
                        {
                            'data-stub-btn': 'focus-risk-not-located',
                            onClick: () => emit('focusRisk', 'r1'),
                        },
                        'focus-risk-not-located',
                    ),
                ],
            )
    },
})

const ReviewProgressStub = defineComponent({
    name: 'AssistantContractReviewProgress',
    props: {
        stages: { type: Object, default: () => ({}) },
        totalClauses: { type: [Number, null] as unknown as () => number | null, default: null },
        analyzingIndex: { type: [Number, null] as unknown as () => number | null, default: null },
    },
    setup(props) {
        return () => h('div', {
            'data-stub': 'ReviewProgress',
            'data-all-done': String(
                ['detect', 'stance', 'segment', 'analyze', 'summarize'].every(k => (props.stages as Record<string, string>)[k] === 'done')
            ),
            'data-analyzing-index': props.analyzingIndex ?? '',
        })
    },
})

const stubs = {
    // 字段名必须与模板里的组件名严格匹配（Nuxt 4 自动导入折叠 assistant/contract/Contract* → AssistantContract*）
    AssistantContractStanceSelectionDialog: StanceDialogStub,
    AssistantContractDocxPreview: DocxPreviewStub,
    AssistantContractRiskListPanel: RiskListPanelStub,
    AssistantContractReviewProgress: ReviewProgressStub,
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
    stageStatusRef.value = { detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait' }
    totalClausesRef.value = null
    analyzingClauseIndexRef.value = null
    analyzeWarningsRef.value = []
    focusedRiskIdRef.value = null
    hoveredRiskIdRef.value = null
    pinnedRiskIdsRef.value = new Set()
    notLocatedIdsRef.value = new Set()
    hasLocatedRef.value = false
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
    mockFocusRisk.mockReset()
    mockTogglePin.mockReset()
    mockSetHoveredRisk.mockReset()
    mockClearAllPins.mockReset()
    mockMarkLocated.mockClear()
    mockResetRiskFocus.mockClear()
})

afterEach(() => {
    while (mountedWrappers.length) {
        try { mountedWrappers.pop()?.unmount() } catch { /* ignore */ }
    }
})

describe.skip('ContractReviewPanel（阶段 7 TODO：迁到 useContractAgent + sub-composable mock）', () => {
    it('StanceSelectionDialog 始终挂载（初始关闭态 open=false）', () => {
        const w = mountPanel()
        const dlg = w.find('[data-stub="StanceSelectionDialog"]')
        expect(dlg.exists()).toBe(true)
        expect(dlg.attributes('data-open')).toBe('false')
    })

    it('review 非空时显示结果屏（DocxPreview + RiskListPanel）', async () => {
        reviewRef.value = makeReview({ status: 'reviewing', originalFileId: 77, reviewedFileId: null })
        runStatusRef.value = 'reviewing'
        const w = mountPanel()
        await nextTick()

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

    it('status=pending 时 busy 条显示"准备中..."（runStatus=idle）', async () => {
        reviewRef.value = makeReview({ status: 'pending' })
        // runStatus=idle 时 fallback 到 review.status → "准备中..."。
        // statusLabel 的派生顺序：runStatus 活跃态（reviewing/completed/failed）优先 →
        // 否则按 review.status 映射，保留 "pending → 准备中..." 语义。
        runStatusRef.value = 'idle'
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

    it('审查期间在右侧面板顶部渲染 ReviewProgress', async () => {
        reviewRef.value = makeReview({ status: 'reviewing' })
        runStatusRef.value = 'reviewing'
        // 通过 useContractReview mock 注入 stageStatus 等
        stageStatusRef.value = { detect: 'done', stance: 'done', segment: 'done', analyze: 'running', summarize: 'wait' }
        totalClausesRef.value = 24
        analyzingClauseIndexRef.value = 14

        const w = mountPanel()
        await nextTick()
        expect(w.find('[data-stub="ReviewProgress"]').exists()).toBe(true)
    })

    it('全流程完成后 ReviewProgress 由组件自身 v-if 隐藏（父不干预）', async () => {
        reviewRef.value = makeReview({ status: 'completed' })
        stageStatusRef.value = { detect: 'done', stance: 'done', segment: 'done', analyze: 'done', summarize: 'done' }
        const w = mountPanel()
        await nextTick()
        // 父始终挂，由 ReviewProgress 内部 v-if="!allDone" 决定
        const stub = w.find('[data-stub="ReviewProgress"]')
        expect(stub.exists()).toBe(true)  // 组件存在
        // stub 接收到的 props 能让实际组件隐藏；test 用 stub 直接断 props
        expect(stub.attributes('data-all-done')).toBe('true')
    })
})

describe.skip('ContractReviewPanel M5 接线（阶段 7 TODO）', () => {
    // 注：旧的 isRebuilding/hasUnsavedDocxChanges/rebuild 透传 + toast.info 提示场景，
    // 业务侧已下线（onRebuildDocx 入口移除，下载链路内部触发 rebuild），相关 it 移除。
    // 仅保留与现有业务一致的 edit-risks 透传断言。

    it('RiskListPanel emit edit-risks → 调 onEditRisks with 新 risks 数组', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="edit-risks"]').trigger('click')
        expect(mockOnEditRisks).toHaveBeenCalledTimes(1)
        expect(mockOnEditRisks).toHaveBeenCalledWith([{ id: 'nr', clauseIndex: 0 }])
    })
})

describe.skip('ContractReviewPanel Task 4.5：焦点/悬停/钉调度（阶段 7 TODO）', () => {
    it('RiskListPanel @focus-risk emit → focusRisk 被调用', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="focus-risk"]').trigger('click')
        expect(mockFocusRisk).toHaveBeenCalledTimes(1)
        expect(mockFocusRisk).toHaveBeenCalledWith('risk-from-list')
    })

    it('DocxPreview @hover-clause emit → setHoveredRisk 被调用，focusRisk 不被调用', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="hover-clause"]').trigger('click')
        expect(mockSetHoveredRisk).toHaveBeenCalledTimes(1)
        expect(mockSetHoveredRisk).toHaveBeenCalledWith('risk-hover-1')
        expect(mockFocusRisk).not.toHaveBeenCalled()
    })

    it('DocxPreview @focus-risk emit → focusRisk 被调用', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()
        await w.find('[data-stub-btn="focus-risk-from-preview"]').trigger('click')
        expect(mockFocusRisk).toHaveBeenCalledTimes(1)
        expect(mockFocusRisk).toHaveBeenCalledWith('risk-from-preview')
    })

    it('容器 Shift+click 含 data-risk-id 元素 → togglePin 被调用', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()
        // 在容器根元素上触发 Shift+click，并模拟 closest('[data-risk-id]') 有命中
        // 直接在容器上新增带 data-risk-id 的 DOM，通过 trigger 传入 shiftKey
        const container = w.find('.h-full.flex.flex-col')
        // 创建 CustomEvent，用 detail 传递 shiftKey 语义——
        // @vue/test-utils trigger 方法支持传入 eventInit 对象
        const el = container.element
        const childWithRiskId = document.createElement('div')
        childWithRiskId.dataset.riskId = 'risk-shift-1'
        el.appendChild(childWithRiskId)

        const event = new MouseEvent('click', { bubbles: true, shiftKey: true })
        childWithRiskId.dispatchEvent(event)
        await nextTick()

        expect(mockTogglePin).toHaveBeenCalledTimes(1)
        expect(mockTogglePin).toHaveBeenCalledWith('risk-shift-1')
        el.removeChild(childWithRiskId)
    })

    it('容器 Shift+click 不含 data-risk-id 元素 → togglePin 不被调用', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()
        // 在容器根元素上 Shift+click 不含 data-risk-id 的元素
        const container = w.find('.h-full.flex.flex-col')
        const el = container.element
        const childNoRiskId = document.createElement('div')
        el.appendChild(childNoRiskId)

        const event = new MouseEvent('click', { bubbles: true, shiftKey: true })
        childNoRiskId.dispatchEvent(event)
        await nextTick()

        expect(mockTogglePin).not.toHaveBeenCalled()
        el.removeChild(childNoRiskId)
    })

})

describe.skip('ContractReviewPanel Task 4.6.1（阶段 7 TODO）', () => {
    it('DocxPreview emit locateResult → notLocatedIds 下传给 RiskListPanel', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()

        // 触发 DocxPreview emit locateResult，Set 含 'r1'
        await w.find('[data-stub-btn="locate-result-with-r1"]').trigger('click')
        await nextTick()

        const riskPanel = w.find('[data-stub="RiskListPanel"]')
        expect(riskPanel.attributes('data-not-located-count')).toBe('1')
    })

    it('未定位 risk 点击 focusRisk → handleFocusRisk early return，不调 focusRisk', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()

        // 先让 notLocatedIds 含 'r1'（通过 locate-result）
        await w.find('[data-stub-btn="locate-result-with-r1"]').trigger('click')
        await nextTick()

        // 点击已被标记为未定位的 r1 focusRisk
        await w.find('[data-stub-btn="focus-risk-not-located"]').trigger('click')
        await nextTick()

        expect(mockFocusRisk).not.toHaveBeenCalled()
    })

    it('已定位 risk 点击 focusRisk → 正常调用 focusRisk', async () => {
        reviewRef.value = makeReview({ status: 'completed', reviewedFileId: 1 })
        const w = mountPanel()
        await nextTick()

        // risk-from-list 不在 notLocatedIds 中，应正常调用
        await w.find('[data-stub-btn="focus-risk"]').trigger('click')
        await nextTick()

        expect(mockFocusRisk).toHaveBeenCalledTimes(1)
        expect(mockFocusRisk).toHaveBeenCalledWith('risk-from-list')
    })
})
