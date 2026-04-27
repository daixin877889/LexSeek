/**
 * ContractReviewPanel Phase B 横幅测试（Task 3.3.1）
 *
 * **Feature: contract-review-versioning-phase-a Task 3.3**
 *
 * 覆盖"本轮变化横幅"逻辑：
 * - versioning.lastUploadResult 非 null → 显示横幅
 * - 横幅显示 summary 文案
 * - 点击关闭按钮 → 调用 dismissUploadBanner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, computed } from 'vue'
import type { contractReviews } from '~~/generated/prisma/client'

// ── mock vue-sonner ────────────────────────────────────────────────────────────
const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()
vi.mock('vue-sonner', () => ({
    toast: {
        success: (...a: unknown[]) => mockToastSuccess(...a),
        info: (...a: unknown[]) => mockToastInfo(...a),
        error: (...a: unknown[]) => mockToastError(...a),
        warning: vi.fn(),
    },
}))

// ── mock lucide-vue-next ───────────────────────────────────────────────────────
vi.mock('lucide-vue-next', () => {
    const stub = (name: string) => defineComponent({
        name,
        setup: () => () => h('i', { 'data-stub': name }),
    })
    return {
        Loader2Icon: stub('Loader2Icon'),
        SaveIcon: stub('SaveIcon'),
        HistoryIcon: stub('HistoryIcon'),
        UploadIcon: stub('UploadIcon'),
        TrendingUpIcon: stub('TrendingUpIcon'),
        XIcon: stub('XIcon'),
        PinIcon: stub('PinIcon'),
        MinusIcon: stub('MinusIcon'),
        GripVertical: stub('GripVertical'),
    }
})

// ── mock useContractReview ─────────────────────────────────────────────────────
const reviewRef = ref<contractReviews | null>(null)
const runStatusRef = ref<'idle' | 'reviewing' | 'completed' | 'failed'>('idle')
const isLoadingRef = ref(false)
const awaitingStanceRef = ref<null>(null)

vi.mock('~/composables/useContractReview', () => ({
    useContractReview: () => ({
        review: reviewRef,
        reviewId: ref(null),
        runStatus: computed(() => runStatusRef.value),
        isLoading: computed(() => isLoadingRef.value),
        awaitingStance: computed(() => awaitingStanceRef.value),
        interruptData: computed(() => null),
        isRebuilding: computed(() => false),
        hasUnsavedDocxChanges: ref(false),
        stageStatus: ref({ detect: 'wait', stance: 'wait', segment: 'wait', analyze: 'wait', summarize: 'wait' }),
        totalClauses: ref(null),
        analyzingClauseIndex: ref(null),
        analyzeWarnings: ref([]),
        onStart: vi.fn(),
        mountReview: vi.fn().mockResolvedValue(undefined),
        onStance: vi.fn().mockResolvedValue(true),
        onDownload: vi.fn(),
        onExportPdf: vi.fn(),
        onEditRisks: vi.fn(),
        onRebuildDocx: vi.fn(),
        cancelReview: vi.fn().mockResolvedValue(undefined),
    }),
}))

// 聚焦/钉/悬停 + 定位状态由 useContractRiskHighlight 提供
vi.mock('~/composables/useContractRiskHighlight', () => ({
    useContractRiskHighlight: () => ({
        focusedRiskId: ref(null),
        hoveredRiskId: ref(null),
        pinnedRiskIds: ref(new Set()),
        highlightedRiskIds: computed(() => new Set()),
        notLocatedIds: ref(new Set()),
        hasLocated: ref(false),
        focusRisk: vi.fn(),
        togglePin: vi.fn(),
        setHoveredRisk: vi.fn(),
        clearAllPins: vi.fn(),
        markLocated: vi.fn(),
        reset: vi.fn(),
    }),
}))

// ── mock useContractReviewVersion with lastUploadResult ───────────────────────
const lastUploadResultRef = ref<{ newVersionId: number; summary: string } | null>(null)
const mockDismissUploadBanner = vi.fn()
const mockRefreshWorkspace = vi.fn().mockResolvedValue(undefined)
const mockRefreshVersions = vi.fn().mockResolvedValue(undefined)
const mockSaveNewVersion = vi.fn().mockResolvedValue(true)
const versionsRef = ref<unknown[]>([])
const isReadOnlyRef = ref(false)

vi.mock('~/composables/useContractReviewVersion', () => ({
    useContractReviewVersion: () => ({
        workspace: ref({ risks: [], annotations: [], currentVersionId: null, maxVersionNo: 0 }),
        versions: versionsRef,
        previewVersionId: ref(null),
        previewSnapshot: ref(null),
        isReadOnly: computed(() => isReadOnlyRef.value),
        currentView: computed(() => ({ risks: [], annotations: [], docxText: '' })),
        hasUnsavedEdits: computed(() => false),
        lastUploadResult: lastUploadResultRef,
        dismissUploadBanner: mockDismissUploadBanner,
        refreshWorkspace: mockRefreshWorkspace,
        refreshVersions: mockRefreshVersions,
        enterPreview: vi.fn(),
        exitPreview: vi.fn(),
        saveNewVersion: mockSaveNewVersion,
        updateRiskArchivedStatus: vi.fn(),
        addLawyerAnnotation: vi.fn(),
        updateAnnotation: vi.fn(),
        deleteAnnotation: vi.fn(),
        updateVersionNote: vi.fn(),
        uploadNewVersion: vi.fn(),
    }),
}))

// ── 通用 stubs ─────────────────────────────────────────────────────────────────
const stubs = {
    AssistantContractStanceSelectionDialog: defineComponent({
        name: 'AssistantContractStanceSelectionDialog',
        props: ['open', 'partyA', 'partyB', 'contractType'],
        emits: ['confirm', 'cancel', 'update:open'],
        setup: (props) => () => h('div', { 'data-stub': 'StanceDialog', 'data-open': String(props.open) }),
    }),
    AssistantContractDocxPreview: defineComponent({
        name: 'AssistantContractDocxPreview',
        props: ['reviewedFileId', 'originalFileId', 'risks', 'focusedRiskId', 'hoveredRiskId', 'highlightedRiskIds'],
        emits: ['focusRisk', 'hoverClause', 'locateResult'],
        setup: () => () => h('div', { 'data-stub': 'DocxPreview' }),
    }),
    AssistantContractRiskListPanel: defineComponent({
        name: 'AssistantContractRiskListPanel',
        props: ['risks', 'annotations', 'readOnly', 'status', 'reviewedFileId', 'summary', 'isRebuilding', 'hasUnsavedDocxChanges', 'focusedRiskId', 'hoveredRiskId', 'pinnedRiskIds', 'notLocatedIds', 'playbookSnapshot', 'currentUserId'],
        emits: ['download', 'rebuild', 'editRisks', 'exportPdf', 'focusRisk', 'togglePin', 'archive', 'addAnnotation', 'updateAnnotation', 'deleteAnnotation', 'restore-annotation', 'jump-to-original'],
        setup: () => () => h('div', { 'data-stub': 'RiskListPanel' }),
    }),
    AssistantContractReviewProgress: defineComponent({
        name: 'AssistantContractReviewProgress',
        props: ['stages', 'totalClauses', 'analyzingIndex'],
        setup: () => () => h('div', { 'data-stub': 'ReviewProgress' }),
    }),
    AssistantContractVersionTimeline: defineComponent({
        name: 'AssistantContractVersionTimeline',
        props: ['versions', 'currentVersionId', 'previewVersionId'],
        emits: ['selectVersion', 'exitPreview', 'updateNote'],
        setup: () => () => h('div', { 'data-stub': 'VersionTimeline' }),
    }),
    AssistantContractSaveVersionDialog: defineComponent({
        name: 'AssistantContractSaveVersionDialog',
        props: ['open', 'submitting'],
        emits: ['update:open', 'confirm'],
        setup: () => () => h('div'),
    }),
    AssistantContractUploadNewVersionDialog: defineComponent({
        name: 'AssistantContractUploadNewVersionDialog',
        props: ['open', 'reviewId'],
        emits: ['update:open', 'complete'],
        setup: (_, { emit }) => () => h('button', {
            'data-stub': 'UploadDialog',
            onClick: () => emit('complete', { newVersionId: 99, summary: '本轮新增 2 条外部变更' }),
        }, '完成上传'),
    }),
}

// ── 动态导入 ───────────────────────────────────────────────────────────────────
const ContractReviewPanel = (await import('~/components/assistant/contract/ContractReviewPanel.vue')).default

function makeReview(over: Partial<contractReviews> = {}): contractReviews {
    return {
        id: 1,
        userId: 1,
        sessionId: 'sess-1',
        originalFileId: 100,
        reviewedFileId: 1,
        status: 'completed',
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

function mountPanel(props: Record<string, unknown> = {}) {
    const w = mount(ContractReviewPanel, { props, global: { stubs } })
    mountedWrappers.push(w as unknown as { unmount: () => void })
    return w
}

beforeEach(() => {
    reviewRef.value = null
    runStatusRef.value = 'idle'
    isLoadingRef.value = false
    lastUploadResultRef.value = null
    versionsRef.value = []
    isReadOnlyRef.value = false
    mockDismissUploadBanner.mockReset()
    mockRefreshWorkspace.mockResolvedValue(undefined)
    mockRefreshVersions.mockResolvedValue(undefined)
    mockToastSuccess.mockReset()
})

afterEach(() => {
    while (mountedWrappers.length) {
        try { mountedWrappers.pop()?.unmount() } catch { /* ignore */ }
    }
})

describe.skip('ContractReviewPanel Task 3.3.1：本轮变化横幅（阶段 7 TODO：迁到 useContractAgent + sub-composable mock）', () => {
    it('lastUploadResult 为 null 时不显示横幅', async () => {
        reviewRef.value = makeReview({ status: 'completed' })
        runStatusRef.value = 'completed'
        lastUploadResultRef.value = null
        const w = mountPanel()
        await flushPromises()
        expect(w.text()).not.toContain('本轮变化')
    })

    it('lastUploadResult 非 null 时显示横幅及 summary 文案', async () => {
        reviewRef.value = makeReview({ status: 'completed' })
        runStatusRef.value = 'completed'
        lastUploadResultRef.value = { newVersionId: 10, summary: '本轮新增 3 处外部变更，AI 已重审' }
        const w = mountPanel()
        await flushPromises()
        expect(w.text()).toContain('本轮变化')
        expect(w.text()).toContain('本轮新增 3 处外部变更，AI 已重审')
    })

    it('点击横幅关闭按钮调用 dismissUploadBanner', async () => {
        reviewRef.value = makeReview({ status: 'completed' })
        runStatusRef.value = 'completed'
        lastUploadResultRef.value = { newVersionId: 10, summary: '测试摘要' }
        const w = mountPanel()
        await flushPromises()

        const closeBtn = w.find('[data-testid="dismiss-upload-banner"]')
        expect(closeBtn.exists()).toBe(true)
        await closeBtn.trigger('click')
        expect(mockDismissUploadBanner).toHaveBeenCalledTimes(1)
    })

    it('上传完成回调设置 lastUploadResult（toast 由 Dialog 内部 watcher 负责）', async () => {
        // 业务调整 (bug #16)：上传完成的 toast 提示由 UploadNewVersionDialog 内部
        // uploadResult watcher 触发，避免对话框提前关闭丢失提示。父组件 handleUploadComplete
        // 仅负责关闭 dialog + 写入 lastUploadResult + 刷新工作区。
        reviewRef.value = makeReview({ status: 'completed' })
        runStatusRef.value = 'completed'
        versionsRef.value = [{ id: 1 }]
        const w = mountPanel()
        await flushPromises()

        const uploadDialogBtn = w.find('[data-stub="UploadDialog"]')
        await uploadDialogBtn.trigger('click')
        await flushPromises()

        expect(lastUploadResultRef.value).not.toBeNull()
        expect(lastUploadResultRef.value?.newVersionId).toBe(99)
        expect(lastUploadResultRef.value?.summary).toBe('本轮新增 2 条外部变更')
    })
})
