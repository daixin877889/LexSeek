/**
 * RiskListPanel Phase B 徽章测试
 *
 * **Feature: contract-review-versioning-phase-a Task 3.3.2**
 *
 * 覆盖 AI 已重审徽章逻辑：
 * - originalClauseText 非 null → 显示"AI 已重审"徽章
 * - originalClauseText 为 null/undefined → 不显示徽章
 */

import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

// ── mock lucide-vue-next ──────────────────────────────────────────────────────
vi.mock('lucide-vue-next', () => {
    const stub = (name: string) => defineComponent({
        name,
        setup: () => () => h('i', { 'data-icon': name }),
    })
    return {
        DownloadIcon: stub('DownloadIcon'),
        ChevronDownIcon: stub('ChevronDownIcon'),
        ChevronRightIcon: stub('ChevronRightIcon'),
        ChevronLeftIcon: stub('ChevronLeftIcon'),
        XIcon: stub('XIcon'),
        Loader2Icon: stub('Loader2Icon'),
        PlusIcon: stub('PlusIcon'),
        PencilIcon: stub('PencilIcon'),
        Trash2Icon: stub('Trash2Icon'),
        FileTextIcon: stub('FileTextIcon'),
        Pin: stub('Pin'),
        TriangleAlert: stub('TriangleAlert'),
        ClipboardList: stub('ClipboardList'),
        CheckCircle2Icon: stub('CheckCircle2Icon'),
        XCircleIcon: stub('XCircleIcon'),
        SendIcon: stub('SendIcon'),
        MessageCircleIcon: stub('MessageCircleIcon'),
        UserIcon: stub('UserIcon'),
        BotIcon: stub('BotIcon'),
        EyeOffIcon: stub('EyeOffIcon'),
        RotateCcwIcon: stub('RotateCcwIcon'),
        SparklesIcon: stub('SparklesIcon'),
        CircleDashedIcon: stub('CircleDashedIcon'),
        HelpCircleIcon: stub('HelpCircleIcon'),
    }
})

// ── mock @vueuse/core（保留实际导出，仅覆盖 useLocalStorage 避免 localStorage 依赖）
vi.mock('@vueuse/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@vueuse/core')>()
    return {
        ...actual,
        useLocalStorage: (_key: string, defaultVal: unknown) => ref(defaultVal),
    }
})

// ── 动态导入 ──────────────────────────────────────────────────────────────────
const RiskListPanel = (await import('~/components/assistant/contract/RiskListPanel.vue')).default

// ── 测试数据工厂 ──────────────────────────────────────────────────────────────
function makeRisk(over: Record<string, unknown> = {}) {
    return {
        id: '1',
        clauseIndex: 0,
        clauseText: '测试条款',
        level: 'high' as const,
        category: '违约责任',
        problem: '问题描述',
        analysis: '分析',
        risk: '风险',
        suggestion: '建议',
        archivedStatus: null,
        ...over,
    }
}

function mountPanel(risks: unknown[] = []) {
    return mount(RiskListPanel, {
        props: {
            risks,
            annotations: [],
            readOnly: false,
            currentUserId: 1,
            status: 'completed' as const,
            reviewedFileId: 1,
            summary: null,
            isRebuilding: false,
            hasUnsavedDocxChanges: false,
            focusedRiskId: null,
            hoveredRiskId: null,
            pinnedRiskIds: new Set(),
            notLocatedIds: new Set(),
        },
        global: {
            stubs: {
                ScrollArea: defineComponent({
                    setup(_, { slots }) {
                        return () => h('div', { 'data-stub': 'ScrollArea' }, slots.default?.())
                    },
                }),
                AssistantContractOverviewPanel: defineComponent({
                    name: 'AssistantContractOverviewPanel',
                    setup: () => () => h('div', { 'data-stub': 'OverviewPanel' }),
                }),
                AssistantContractRiskClauseDiff: defineComponent({
                    name: 'AssistantContractRiskClauseDiff',
                    setup: () => () => h('div', { 'data-stub': 'ClauseDiff' }),
                }),
                AssistantContractRiskEditDialog: defineComponent({
                    name: 'AssistantContractRiskEditDialog',
                    setup: () => () => h('div'),
                }),
                AssistantContractExportPdfDialog: defineComponent({
                    name: 'AssistantContractExportPdfDialog',
                    setup: () => () => h('div'),
                }),
                AlertDialog: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                AlertDialogContent: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                AlertDialogHeader: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                AlertDialogTitle: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                AlertDialogDescription: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                AlertDialogFooter: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                AlertDialogCancel: defineComponent({
                    setup(_, { slots }) { return () => h('button', slots.default?.()) },
                }),
                AlertDialogAction: defineComponent({
                    setup(_, { slots }) { return () => h('button', slots.default?.()) },
                }),
                Switch: defineComponent({
                    name: 'Switch',
                    setup: () => () => h('div'),
                }),
                TooltipProvider: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                Tooltip: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                TooltipTrigger: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                TooltipContent: defineComponent({
                    setup(_, { slots }) { return () => h('div', slots.default?.()) },
                }),
                Textarea: defineComponent({
                    name: 'Textarea',
                    setup: () => () => h('textarea'),
                }),
            },
        },
    })
}

describe('RiskListPanel Task 3.3.2：AI 已重审徽章', () => {
    it('主风险卡片：originalClauseText 非 null 时显示"AI 已重审"', async () => {
        const w = mountPanel([makeRisk({ originalClauseText: '原始条款引文' })])
        expect(w.text()).toContain('AI 已重审')
        expect(w.find('[data-icon="SparklesIcon"]').exists()).toBe(true)
    })

    it('主风险卡片：originalClauseText 为 null 时不显示"AI 已重审"', async () => {
        const w = mountPanel([makeRisk({ originalClauseText: null })])
        expect(w.text()).not.toContain('AI 已重审')
    })

    it('主风险卡片：originalClauseText 为 undefined 时不显示"AI 已重审"', async () => {
        const w = mountPanel([makeRisk()])
        expect(w.text()).not.toContain('AI 已重审')
    })

    it('外部新增风险：originalClauseText 非 null 时也显示"AI 已重审"', async () => {
        const risk = makeRisk({
            source: 'external_new',
            originalClauseText: '外部引文',
        })
        const w = mountPanel([risk])
        expect(w.text()).toContain('AI 已重审')
    })

    it('外部新增风险：originalClauseText 为 null 时不显示徽章', async () => {
        const risk = makeRisk({
            source: 'external_new',
            originalClauseText: null,
        })
        const w = mountPanel([risk])
        expect(w.text()).not.toContain('AI 已重审')
    })

    it('多个风险：只有含 originalClauseText 的卡片显示徽章', async () => {
        const risks = [
            makeRisk({ id: '1', originalClauseText: '引文A' }),
            makeRisk({ id: '2', originalClauseText: null }),
            makeRisk({ id: '3', originalClauseText: '引文C' }),
        ]
        const w = mountPanel(risks)
        // 2 个徽章
        expect(w.findAll('[data-icon="SparklesIcon"]')).toHaveLength(2)
    })
})

describe('RiskListPanel Task 11：客户修订处置徽章', () => {
    it('风险带 clientRedlineDecision 时渲染客户处置徽章', () => {
        const wrapper = mountPanel([makeRisk({ clientRedlineDecision: 'accepted' })])
        expect(wrapper.text()).toContain('客户已采纳')
    })
})
