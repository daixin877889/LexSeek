/**
 * RiskListPanel 单元测试（重做后：标签切换 + 速览条 + 抽屉式详情）
 *
 * **Feature: contract-review-detail-page-redesign**
 *
 * 覆盖：
 * - 空态 / 分组渲染顺序 / 排序不原地改 props
 * - 风险清单 ↔ 审查总览 标签切换、风险分速览条
 * - 风险卡分态着色、钉按钮、点卡片 emit focusRisk
 * - 风险详情抽屉集成：打开 / 关闭 / 编辑 / 删除
 * - 下载按钮三态、下载模式 toggle
 * - openCreateWithPrefill 暴露 + createRisk emit
 * - Phase B 三分组（外部新增 / 孤立 / 客户已移除）
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, nextTick, provide } from 'vue'
import RiskListPanel from '~/components/assistant/contract/RiskListPanel.vue'
import type { ContractOverview, Risk, ContractReviewStatus, PlaybookSnapshot, ContractAnnotationEntity, RiskDisplayPhaseB } from '#shared/types/contract'

// 透明 stub：保持 slot 渲染
function passthrough(name: string) {
    return defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots, attrs }) {
            return () => h('div', { 'data-stub': name, ...attrs }, slots.default?.())
        },
    })
}

// Button stub：渲染真实 <button>，透传 disabled 与 @click
const ButtonStub = defineComponent({
    name: 'Button',
    props: { disabled: Boolean },
    inheritAttrs: false,
    setup(props, { slots, attrs }) {
        return () => h('button', { disabled: props.disabled || undefined, ...attrs }, slots.default?.())
    },
})

// RiskEditDialog stub：按 open 条件渲染，暴露 risk prop 与手动触发 confirm 的按钮
const RiskEditDialogStub = defineComponent({
    name: 'AssistantContractRiskEditDialog',
    props: {
        open: { type: Boolean, default: false },
        risk: { type: Object as () => Risk | null, default: null },
    },
    emits: ['update:open', 'confirm', 'cancel'],
    setup(props, { emit }) {
        return () =>
            props.open
                ? h('div', { 'data-stub': 'RiskEditDialog', 'data-has-risk': props.risk ? '1' : '0' }, [
                    h('button', {
                        'data-test': 'edit-dialog-fire-confirm',
                        onClick: () => {
                            const payload: Risk = props.risk
                                ? { ...(props.risk as Risk), suggestion: '已修改建议' }
                                : {
                                    id: 'new-risk-uuid',
                                    clauseIndex: 99,
                                    clauseText: '新条款原文',
                                    level: 'medium',
                                    category: '新类别',
                                    problem: '新问题',
                                    legalBasis: undefined,
                                    analysis: '新分析',
                                    risk: '新风险',
                                    suggestion: '新建议',
                                    suggestedClauseText: '新改写文本',
                                }
                            emit('confirm', payload)
                            emit('update:open', false)
                        },
                    }, '触发 confirm'),
                ])
                : null
    },
})

// AlertDialog stub：按 open 条件渲染内容
const AlertDialogStub = defineComponent({
    name: 'AlertDialog',
    props: { open: { type: Boolean, default: false } },
    emits: ['update:open'],
    setup(props, { slots }) {
        return () => h('div', { 'data-stub': 'AlertDialog' }, props.open ? slots.default?.() : [])
    },
})

const alertBtn = (name: string) =>
    defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots, attrs }) {
            return () => h('button', { 'data-stub': name, ...attrs }, slots.default?.())
        },
    })

const stubs = {
    ScrollArea: passthrough('ScrollArea'),
    Switch: passthrough('Switch'),
    Button: ButtonStub,
    TooltipProvider: passthrough('TooltipProvider'),
    Tooltip: passthrough('Tooltip'),
    TooltipTrigger: passthrough('TooltipTrigger'),
    TooltipContent: passthrough('TooltipContent'),
    AssistantContractAnnotationBubble: passthrough('AnnotationBubble'),
    AssistantContractRiskClauseDiff: passthrough('RiskClauseDiff'),
    AssistantContractExportPdfDialog: passthrough('ExportPdfDialog'),
    AssistantContractRiskEditDialog: RiskEditDialogStub,
    AlertDialog: AlertDialogStub,
    AlertDialogContent: passthrough('AlertDialogContent'),
    AlertDialogHeader: passthrough('AlertDialogHeader'),
    AlertDialogTitle: passthrough('AlertDialogTitle'),
    AlertDialogDescription: passthrough('AlertDialogDescription'),
    AlertDialogFooter: passthrough('AlertDialogFooter'),
    AlertDialogAction: alertBtn('AlertDialogAction'),
    AlertDialogCancel: alertBtn('AlertDialogCancel'),
}

function makeRisk(over: Partial<RiskDisplayPhaseB> = {}): RiskDisplayPhaseB {
    return {
        id: 'risk-1',
        clauseIndex: 0,
        clauseText: '原条款文本',
        level: 'high',
        category: '违约责任',
        problem: '违约金比例过高',
        legalBasis: undefined,
        analysis: '分析内容',
        risk: '法律风险说明',
        suggestion: '修改建议说明',
        suggestedClauseText: '建议改写文本',
        matchedPointCode: null,
        ...over,
    } as RiskDisplayPhaseB
}

function makeAnnotation(over: Partial<ContractAnnotationEntity> = {}): ContractAnnotationEntity {
    return {
        id: 1,
        reviewId: 1,
        riskId: 1,
        parentAnnotationId: null,
        authorType: 'lawyer',
        authorName: '张律师',
        authorUserId: 1,
        content: '批注内容',
        createdAt: '2024-01-01T00:00:00.000Z',
        wordCommentRef: null,
        removedByClient: false,
        suppressInExport: false,
        ...over,
    }
}

function mountPanel(props: Partial<{
    risks: RiskDisplayPhaseB[]
    annotations: ContractAnnotationEntity[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: ContractOverview | null
    focusedRiskId: string | null
    hoveredRiskId: string | null
    pinnedRiskIds: Set<string>
    notLocatedIds: Set<string>
    playbookSnapshot: PlaybookSnapshot | null
}> = {}) {
    return mount(RiskListPanel, {
        props: {
            risks: [],
            status: 'pending' as ContractReviewStatus,
            reviewedFileId: null,
            summary: null,
            focusedRiskId: null,
            hoveredRiskId: null,
            pinnedRiskIds: new Set<string>(),
            notLocatedIds: new Set<string>(),
            ...props,
        },
        global: { stubs },
    })
}

type Wrapper = ReturnType<typeof mountPanel>

function findCards(w: Wrapper) {
    return w.findAll('[data-risk-id]')
}
function findButtonByText(w: Wrapper, label: string) {
    return w.findAll('button').find(b => b.text().includes(label))
}
function findDownloadButton(w: Wrapper) {
    return findButtonByText(w, '下载批注 Word')!
}
function findTab(w: Wrapper, label: string) {
    return w.findAll('button').find(b => b.text().trim().startsWith(label))!
}
function exposedOpenCreate(w: Wrapper) {
    return (w.vm as unknown as {
        openCreateWithPrefill: (p: { clauseText: string; clauseParagraphIndex: number }) => void
    }).openCreateWithPrefill
}

const completed = { status: 'completed' as ContractReviewStatus, reviewedFileId: 123 }

describe('RiskListPanel · 基础渲染', () => {
    it('风险数组为空时显示"暂无风险条目"', () => {
        const w = mountPanel({ risks: [] })
        expect(w.text()).toContain('暂无风险条目')
        expect(findCards(w)).toHaveLength(0)
    })

    it('主清单按 clauseParagraphIndex 升序渲染（输入故意倒序）', () => {
        const r1 = makeRisk({ id: 'a', clauseParagraphIndex: 5, category: '条款甲' })
        const r2 = makeRisk({ id: 'b', clauseParagraphIndex: 1, category: '条款乙' })
        const w = mountPanel({ risks: [r1, r2] })
        const cards = findCards(w)
        expect(cards).toHaveLength(2)
        expect(cards[0]!.text()).toContain('条款乙')
        expect(cards[1]!.text()).toContain('条款甲')
    })

    it('不原地 sort props（外层传入数组不会被变更）', () => {
        const risks = [makeRisk({ id: 'a', clauseIndex: 5 }), makeRisk({ id: 'b', clauseIndex: 1 })]
        const snapshot = risks.map(r => r.id)
        mountPanel({ risks })
        expect(risks.map(r => r.id)).toEqual(snapshot)
    })

    it('不同 level 渲染不同徽章颜色类（低风险为 slate-400）', () => {
        const risks = [
            makeRisk({ id: 'h', clauseIndex: 0, level: 'high' }),
            makeRisk({ id: 'm', clauseIndex: 1, level: 'medium' }),
            makeRisk({ id: 'l', clauseIndex: 2, level: 'low' }),
        ]
        const html = mountPanel({ risks }).html()
        expect(html).toContain('bg-red-500')
        expect(html).toContain('bg-orange-500')
        expect(html).toContain('bg-slate-400')
    })

    it('level 徽章文案使用中文（高/中/低）', () => {
        const risks = [
            makeRisk({ id: 'h', clauseIndex: 0, level: 'high' }),
            makeRisk({ id: 'm', clauseIndex: 1, level: 'medium' }),
            makeRisk({ id: 'l', clauseIndex: 2, level: 'low' }),
        ]
        const text = mountPanel({ risks }).text()
        expect(text).toContain('高')
        expect(text).toContain('中')
        expect(text).toContain('低')
    })
})

describe('RiskListPanel · 标签切换 + 速览条', () => {
    it('默认显示风险清单标签 + 风险分速览条', () => {
        const w = mountPanel({ risks: [makeRisk()] })
        expect(w.text()).toContain('风险分')
        expect(w.text()).toContain('风险清单')
        expect(w.text()).toContain('审查总览')
    })

    it('风险清单标签显示风险数量', () => {
        const risks = [
            makeRisk({ id: 'a', clauseIndex: 0 }),
            makeRisk({ id: 'b', clauseIndex: 1 }),
        ]
        const w = mountPanel({ risks })
        expect(findTab(w, '风险清单').text()).toContain('2')
    })

    it('点"审查总览"标签切到总览，渲染 summary 总评', async () => {
        const w = mountPanel({
            risks: [makeRisk()],
            summary: { highlights: null, overall: '合同整体风险可控，需重点关注违约金条款。' },
        })
        // 列表标签下不展示总评
        expect(w.text()).not.toContain('合同整体风险可控')
        await findTab(w, '审查总览').trigger('click')
        expect(w.text()).toContain('合同整体风险可控，需重点关注违约金条款。')
    })
})

describe('RiskListPanel · 下载按钮三态', () => {
    it('reviewedFileId 为 null 时下载按钮 disabled', () => {
        const w = mountPanel({ status: 'completed', reviewedFileId: null })
        expect((findDownloadButton(w).element as HTMLButtonElement).disabled).toBe(true)
    })

    it('status 非 completed 时下载按钮 disabled', () => {
        const w = mountPanel({ status: 'reviewing', reviewedFileId: 123 })
        expect((findDownloadButton(w).element as HTMLButtonElement).disabled).toBe(true)
    })

    it('status=completed 且 reviewedFileId 有值时下载按钮 enable', () => {
        const w = mountPanel({ status: 'completed', reviewedFileId: 123 })
        expect((findDownloadButton(w).element as HTMLButtonElement).disabled).toBe(false)
    })
})

describe('RiskListPanel · 新增风险入口', () => {
    it('顶部不显示"新增风险"按钮，改为暴露 openCreateWithPrefill', () => {
        const w = mountPanel({ ...completed, risks: [] })
        expect(findButtonByText(w, '新增风险')).toBeUndefined()
        expect(typeof exposedOpenCreate(w)).toBe('function')
    })

    it('openCreateWithPrefill → 打开 RiskEditDialog（新增模式）', async () => {
        const w = mountPanel({ ...completed, risks: [] })
        expect(w.find('[data-stub="RiskEditDialog"]').exists()).toBe(false)
        exposedOpenCreate(w)({ clauseText: '段落原文', clauseParagraphIndex: 3 })
        await nextTick()
        const dialog = w.find('[data-stub="RiskEditDialog"]')
        expect(dialog.exists()).toBe(true)
        expect(dialog.attributes('data-has-risk')).toBe('0')
    })

    it('openCreateWithPrefill 后确认 → emit createRisk 携带 prefill', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'existing' })] })
        exposedOpenCreate(w)({ clauseText: '段落原文', clauseParagraphIndex: 3 })
        await nextTick()
        await w.find('[data-test="edit-dialog-fire-confirm"]').trigger('click')
        const payload = w.emitted('createRisk')![0]![0] as { clauseText: string; clauseParagraphIndex: number; risk: Risk }
        expect(payload.clauseText).toBe('段落原文')
        expect(payload.clauseParagraphIndex).toBe(3)
        expect(payload.risk.id).toBe('new-risk-uuid')
        expect(w.emitted('editRisks')).toBeUndefined()
    })
})

describe('RiskListPanel · 流式冒出', () => {
    it('新增 risk 挂 data-just-added 属性 3 秒后移除', async () => {
        vi.useFakeTimers()
        const w = mountPanel({ risks: [], status: 'reviewing' })
        await w.setProps({ risks: [makeRisk({ id: 'r1', clauseIndex: 1 })] })
        await nextTick()
        expect(w.find('[data-risk-id="r1"][data-just-added="true"]').exists()).toBe(true)
        vi.advanceTimersByTime(3000)
        await nextTick()
        expect(w.find('[data-risk-id="r1"][data-just-added="true"]').exists()).toBe(false)
        vi.useRealTimers()
    })
})

describe('RiskListPanel · 钉住 + 聚焦态', () => {
    it('卡片渲染未钉状态的 Pin 按钮（aria-label=钉住）', () => {
        const w = mountPanel({ risks: [makeRisk({ id: 'r1' })] })
        expect(w.find('[aria-label="钉住"]').exists()).toBe(true)
    })

    it('已钉住时按钮 aria-label 变为"取消钉住"', () => {
        const w = mountPanel({ risks: [makeRisk({ id: 'r1' })], pinnedRiskIds: new Set(['r1']) })
        expect(w.find('[aria-label="取消钉住"]').exists()).toBe(true)
    })

    it('点钉按钮 emit togglePin，不触发 focusRisk（@click.stop）', async () => {
        const w = mountPanel({ risks: [makeRisk({ id: 'r1' })] })
        await w.find('[aria-label="钉住"]').trigger('click')
        expect(w.emitted('togglePin')![0]).toEqual(['r1'])
        expect(w.emitted('focusRisk')).toBeUndefined()
    })

    it('点卡片 emit focusRisk', async () => {
        const w = mountPanel({ risks: [makeRisk({ id: 'r1' })] })
        await w.find('[data-risk-id="r1"]').trigger('click')
        expect(w.emitted('focusRisk')![0]).toEqual(['r1'])
    })

    it('focusedRiskId 命中的 high 卡片带等级聚焦色 + ring', () => {
        const w = mountPanel({ risks: [makeRisk({ id: 'r1', level: 'high' })], focusedRiskId: 'r1' })
        const card = w.find('[data-risk-id="r1"]')
        expect(card.classes()).toContain('border-l-red-600')
        expect(card.classes()).toContain('ring-2')
    })

    it('已钉且非聚焦时卡片带 border-l-orange-500', () => {
        const w = mountPanel({ risks: [makeRisk({ id: 'r1' })], pinnedRiskIds: new Set(['r1']) })
        expect(w.find('[data-risk-id="r1"]').classes()).toContain('border-l-orange-500')
    })
})

describe('RiskListPanel · 清单要点徽章', () => {
    const snapshot: PlaybookSnapshot = {
        contractType: '劳动合同',
        snapshotAt: '2024-01-01T00:00:00.000Z',
        points: [
            { code: 'P001', title: '试用期约定合规性', defaultLevel: 'high', stancePreference: 'party_a', checkContent: '是否约定了合法试用期', legalBasis: '《劳动合同法》第19条', suggestion: '试用期不超过6个月' },
        ],
    }

    it('matchedPointCode 命中 snapshot 时卡片显示要点标题徽章', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1', matchedPointCode: 'P001' })], playbookSnapshot: snapshot })
        expect(w.find('[data-risk-id="r1"]').text()).toContain('试用期约定合规性')
    })

    it('matchedPointCode 为空时卡片不显示要点徽章', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1' })], playbookSnapshot: snapshot })
        expect(w.find('[data-risk-id="r1"]').text()).not.toContain('试用期约定合规性')
    })
})

describe('RiskListPanel · 详情抽屉集成', () => {
    it('focusedRiskId 命中时渲染风险详情抽屉，显示问题概述', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1', problem: '抽屉里的问题概述' })], focusedRiskId: 'r1' })
        // 抽屉头的上下条导航是抽屉独有标识
        expect(w.find('[aria-label="关闭详情"]').exists()).toBe(true)
        expect(w.text()).toContain('抽屉里的问题概述')
    })

    it('focusedRiskId 为 null 时不渲染抽屉', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1' })], focusedRiskId: null })
        expect(w.find('[aria-label="关闭详情"]').exists()).toBe(false)
    })

    it('点抽屉关闭按钮 emit focusRisk(null)', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1' })], focusedRiskId: 'r1' })
        await w.find('[aria-label="关闭详情"]').trigger('click')
        const emitted = w.emitted('focusRisk')!
        expect(emitted[emitted.length - 1]).toEqual([null])
    })

    it('点抽屉"编辑" → 打开 RiskEditDialog（editingRisk 命中该 risk）', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1' })], focusedRiskId: 'r1' })
        await findButtonByText(w, '编辑')!.trigger('click')
        const dialog = w.find('[data-stub="RiskEditDialog"]')
        expect(dialog.exists()).toBe(true)
        expect(dialog.attributes('data-has-risk')).toBe('1')
    })

    it('抽屉"编辑"确认 → emit editRisks 替换同 id 风险', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1', suggestion: '旧建议' })], focusedRiskId: 'r1' })
        await findButtonByText(w, '编辑')!.trigger('click')
        await w.find('[data-test="edit-dialog-fire-confirm"]').trigger('click')
        const payload = w.emitted('editRisks')![0]![0] as Risk[]
        expect(payload[0]!.suggestion).toBe('已修改建议')
    })

    it('点抽屉"删除" → 打开 AlertDialog 二次确认', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1' })], focusedRiskId: 'r1' })
        expect(w.text()).not.toContain('确认删除该风险？')
        await findButtonByText(w, '删除')!.trigger('click')
        await nextTick()
        expect(w.text()).toContain('确认删除该风险？')
    })

    it('删除 AlertDialog 确认 → emit editRisks 移除该 risk', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1' }), makeRisk({ id: 'r2', clauseIndex: 1 })], focusedRiskId: 'r1' })
        await findButtonByText(w, '删除')!.trigger('click')
        await nextTick()
        await w.find('[data-stub="AlertDialogAction"]').trigger('click')
        const payload = w.emitted('editRisks')![0]![0] as Risk[]
        expect(payload).toHaveLength(1)
        expect(payload[0]!.id).toBe('r2')
    })

    it('点抽屉"标记已处理" → emit archive(id, handled)', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'r1' })], focusedRiskId: 'r1' })
        await findButtonByText(w, '标记已处理')!.trigger('click')
        expect(w.emitted('archive')![0]).toEqual(['r1', 'handled'])
    })
})

describe('RiskListPanel · Phase B 外部新增分组', () => {
    it('source=external_new 渲染在顶部外部新增分组', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'ext-1', source: 'external_new' })] })
        expect(w.text()).toContain('外部新增')
    })

    it('外部新增分组卡片带 border-l-orange-500 竖条', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'ext-1', source: 'external_new' })] })
        expect(w.html()).toContain('border-l-orange-500')
    })

    it('没有 external_new 风险时不渲染外部新增分组', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'ai-1', source: 'ai' })] })
        expect(w.text()).not.toContain('外部新增（')
    })

    it('外部新增分组标题显示数量', () => {
        const w = mountPanel({ ...completed, risks: [
            makeRisk({ id: 'e1', clauseIndex: 0, source: 'external_new' }),
            makeRisk({ id: 'e2', clauseIndex: 1, source: 'external_new' }),
        ] })
        expect(w.text()).toContain('外部新增（2）')
    })

    it('外部新增分组渲染在主清单之前', () => {
        const w = mountPanel({ ...completed, risks: [
            makeRisk({ id: 'ai-1', clauseIndex: 1, source: 'ai' }),
            makeRisk({ id: 'ext-1', clauseIndex: 10, source: 'external_new' }),
        ] })
        const html = w.html()
        expect(html.indexOf('外部新增')).toBeLessThan(html.indexOf('data-risk-id="ai-1"'))
    })
})

describe('RiskListPanel · Phase B 孤立批注区', () => {
    it('orphaned=true 渲染在孤立批注区，显示"原文已修改·无法定位"标题', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'o-1', orphaned: true })] })
        expect(w.text()).toContain('原文已修改')
        expect(w.text()).toContain('无法定位')
    })

    it('孤立批注区标题显示数量', () => {
        const w = mountPanel({ ...completed, risks: [
            makeRisk({ id: 'o-1', clauseIndex: 0, orphaned: true }),
            makeRisk({ id: 'o-2', clauseIndex: 1, orphaned: true }),
        ] })
        expect(w.text()).toContain('无法定位（2）')
    })

    it('没有 orphaned 风险时不渲染孤立批注区', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk({ id: 'ai-1', orphaned: false })] })
        expect(w.text()).not.toContain('无法定位（')
    })

    it('孤立批注区渲染在主清单之后', () => {
        const w = mountPanel({ ...completed, risks: [
            makeRisk({ id: 'ai-1', clauseIndex: 1, source: 'ai' }),
            makeRisk({ id: 'o-1', clauseIndex: 2, orphaned: true }),
        ] })
        const html = w.html()
        expect(html.indexOf('data-risk-id="ai-1"')).toBeLessThan(html.indexOf('无法定位'))
    })
})

describe('RiskListPanel · Phase B 客户已移除分组', () => {
    it('有 removedByClient 批注时渲染"客户已移除"分组，默认折叠', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk()], annotations: [makeAnnotation({ id: 20, removedByClient: true, content: '被删内容X' })] })
        expect(w.text()).toContain('客户已移除')
        expect(w.text()).not.toContain('被删内容X')
    })

    it('客户已移除分组标题显示数量', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk()], annotations: [
            makeAnnotation({ id: 21, removedByClient: true }),
            makeAnnotation({ id: 22, removedByClient: true }),
        ] })
        expect(w.text()).toContain('客户已移除（2）')
    })

    it('点分组标题展开后显示被删批注内容 + 恢复推送按钮', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk()], annotations: [makeAnnotation({ id: 23, removedByClient: true, content: '已删批注内容' })] })
        await findButtonByText(w, '客户已移除')!.trigger('click')
        expect(w.text()).toContain('已删批注内容')
        expect(findButtonByText(w, '恢复推送')).toBeTruthy()
    })

    it('恢复推送 AlertDialog 确认后 emit restore-annotation', async () => {
        const w = mountPanel({ ...completed, risks: [makeRisk()], annotations: [makeAnnotation({ id: 25, removedByClient: true })] })
        await findButtonByText(w, '客户已移除')!.trigger('click')
        await findButtonByText(w, '恢复推送')!.trigger('click')
        await nextTick()
        await w.find('[data-stub="AlertDialogAction"]').trigger('click')
        expect(w.emitted('restore-annotation')![0]).toEqual([25])
    })

    it('没有 removedByClient 批注时不渲染客户已移除分组', () => {
        const w = mountPanel({ ...completed, risks: [makeRisk()], annotations: [makeAnnotation({ id: 30, removedByClient: false })] })
        expect(w.text()).not.toContain('客户已移除（')
    })
})

describe('RiskListPanel · 下载模式 toggle', () => {
    const RADIO_GROUP_KEY = Symbol('radio-group-update')

    const dropdownStubs = {
        DropdownMenu: { template: '<div><slot/></div>' },
        DropdownMenuTrigger: { template: '<div><slot/></div>' },
        DropdownMenuContent: { template: '<div><slot/></div>' },
        DropdownMenuLabel: { template: '<div><slot/></div>' },
        DropdownMenuRadioGroup: defineComponent({
            name: 'DropdownMenuRadioGroup',
            props: { modelValue: { type: String, default: '' } },
            emits: ['update:modelValue'],
            setup(_, { slots, emit }) {
                provide(RADIO_GROUP_KEY, (v: string) => emit('update:modelValue', v))
                return () => h('div', slots.default?.())
            },
        }),
        DropdownMenuRadioItem: defineComponent({
            name: 'DropdownMenuRadioItem',
            props: { value: { type: String, required: true } },
            setup(props, { slots }) {
                const onUpdate = inject<(v: string) => void>(RADIO_GROUP_KEY)
                return () => h('div', {
                    'data-testid': `download-mode-${props.value}`,
                    onClick: () => onUpdate?.(props.value),
                }, slots.default?.())
            },
        }),
    }
    const mergedStubs = { ...stubs, ...dropdownStubs }

    function mountWithMode() {
        return mount(RiskListPanel, {
            props: {
                risks: [], status: 'completed' as ContractReviewStatus, reviewedFileId: 123, summary: null,
                focusedRiskId: null, hoveredRiskId: null,
                pinnedRiskIds: new Set<string>(), notLocatedIds: new Set<string>(),
            },
            global: { stubs: mergedStubs },
        })
    }

    afterEach(() => {
        localStorage.removeItem('contract-review-export-mode')
    })

    it('三种模式 RadioItem 都渲染', () => {
        const w = mountWithMode()
        const items = w.findAll('[data-testid^="download-mode-"]')
        expect(items.map(i => i.attributes('data-testid'))).toEqual([
            'download-mode-comment', 'download-mode-redline', 'download-mode-both',
        ])
    })

    it('选中 redline → emit download(redline)', async () => {
        const w = mountWithMode()
        await w.find('[data-testid="download-mode-redline"]').trigger('click')
        const emitted = w.emitted('download') ?? []
        expect(emitted[emitted.length - 1]).toEqual(['redline'])
    })

    it('localStorage 持久化模式偏好', () => {
        localStorage.setItem('contract-review-export-mode', 'both')
        const w = mountWithMode()
        const radioGroup = w.findComponent(dropdownStubs.DropdownMenuRadioGroup)
        expect(radioGroup.props('modelValue')).toBe('both')
    })
})
