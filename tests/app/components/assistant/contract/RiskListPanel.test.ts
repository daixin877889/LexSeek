import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, nextTick, provide } from 'vue'
import RiskListPanel from '~/components/assistant/contract/RiskListPanel.vue'
import type { ContractOverview, Risk, ContractReviewStatus, PlaybookSnapshot, ContractAnnotationEntity } from '#shared/types/contract'

/**
 * RiskListPanel 单元测试
 *
 * **Feature: contract-review-m4 + m5**
 *
 * M4 只读版（13 用例）：
 * - 按 clauseParagraphIndex 升序渲染 / 不原地 sort props
 * - level 徽章颜色 + 中文文案
 * - 点击 Card 展开 / 收起 / 切换 / 展开内容正确
 * - summary 空/非空 / 下载按钮三态
 *
 * M5 CRUD 扩展（8 用例）：
 * - 新增入口经 openCreateWithPrefill 暴露给预览 hover；每条风险有「编辑 / 删除」按钮
 * - editable 由 status 推导
 * - RiskEditDialog / AlertDialog 交互触发 editRisks
 */

// 透明 stub：保持 slot 渲染
function passthrough(name: string) {
    return defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots }) {
            return () => h('div', { 'data-stub': name }, slots.default?.())
        },
    })
}

// ScrollArea / Card / CardHeader / CardContent 全部走 passthrough
const ScrollAreaStub = passthrough('ScrollArea')
// Card 需要把点击事件透传出去
const CardStub = defineComponent({
    name: 'Card',
    inheritAttrs: false,
    setup(_, { slots, attrs }) {
        return () => h('div', { 'data-stub': 'Card', ...attrs }, slots.default?.())
    },
})

const ButtonStub = defineComponent({
    name: 'Button',
    props: { disabled: Boolean },
    setup(props, { slots, attrs }) {
        return () =>
            h(
                'button',
                {
                    disabled: props.disabled || undefined,
                    ...attrs,
                },
                slots.default?.()
            )
    },
})

// 子组件：记录收到的 props，用于断言
const RiskClauseDiffStub = defineComponent({
    name: 'AssistantContractRiskClauseDiff',
    props: {
        clauseText: { type: String, default: '' },
        suggestedClauseText: { type: String, default: '' },
        // PR 4：mode 由 RiskCard 透传（来自 RiskListPanel 的 cardLayout），
        // 把它落到 data-mode 上让"布局切换"链路在 stub 层可断言
        mode: { type: String, default: '' },
    },
    setup(props) {
        return () =>
            h('div', {
                'data-stub': 'RiskClauseDiff',
                'data-clause-text': props.clauseText,
                'data-suggested-clause-text': props.suggestedClauseText,
                'data-mode': props.mode,
            })
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
                    h(
                        'button',
                        {
                            'data-test': 'edit-dialog-fire-confirm',
                            onClick: () => {
                                // 构造一个合法的 Risk payload 让外层替换/追加
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
                        },
                        '触发 confirm'
                    ),
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
        return () =>
            h('div', { 'data-stub': 'AlertDialog' }, props.open ? slots.default?.() : [])
    },
})

// Action / Cancel 渲染为 button，透传 @click 事件
const alertBtn = (name: string) =>
    defineComponent({
        name,
        inheritAttrs: false,
        setup(_, { slots, attrs }) {
            return () => h('button', { 'data-stub': name, ...attrs }, slots.default?.())
        },
    })

const stubs = {
    ScrollArea: ScrollAreaStub,
    Card: CardStub,
    CardHeader: passthrough('CardHeader'),
    CardContent: passthrough('CardContent'),
    Button: ButtonStub,
    AssistantContractRiskClauseDiff: RiskClauseDiffStub,
    AssistantContractRiskEditDialog: RiskEditDialogStub,
    AlertDialog: AlertDialogStub,
    AlertDialogContent: passthrough('AlertDialogContent'),
    AlertDialogHeader: passthrough('AlertDialogHeader'),
    AlertDialogTitle: passthrough('AlertDialogTitle'),
    AlertDialogDescription: passthrough('AlertDialogDescription'),
    AlertDialogFooter: passthrough('AlertDialogFooter'),
    AlertDialogAction: alertBtn('AlertDialogAction'),
    AlertDialogCancel: alertBtn('AlertDialogCancel'),
    // PR 4：布局 Tabs 段控相关 stub
    Tabs: defineComponent({
        name: 'Tabs',
        props: { modelValue: String },
        emits: ['update:modelValue'],
        setup(_, { slots }) {
            return () => h('div', { 'data-stub': 'Tabs' }, slots.default?.())
        },
    }),
    TabsList: passthrough('TabsList'),
    TabsTrigger: defineComponent({
        name: 'TabsTrigger',
        props: { value: String },
        setup(props, { slots, attrs }) {
            return () =>
                h('button', { 'data-stub': 'TabsTrigger', 'data-value': props.value, ...attrs }, slots.default?.())
        },
    }),
}

function makeRisk(over: Partial<Risk> = {}): Risk {
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
        ...over,
    }
}

function mountPanel(props: Partial<{
    risks: Risk[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: ContractOverview | null
    focusedRiskId: string | null
    hoveredRiskId: string | null
    pinnedRiskIds: Set<string>
    notLocatedIds: Set<string>
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
    return w.findAll('[data-stub="Card"]')
}

function findButtonByText(w: Wrapper, label: string) {
    return w.findAll('button').find(b => b.text().includes(label))
}

function findDownloadButton(w: Wrapper) {
    return findButtonByText(w, '下载批注 Word')!
}

function exposedOpenCreate(w: Wrapper) {
    return (w.vm as unknown as {
        openCreateWithPrefill: (p: { clauseText: string; clauseParagraphIndex: number }) => void
    }).openCreateWithPrefill
}

describe('RiskListPanel', () => {
    it('风险数组为空时显示"暂无风险条目"', () => {
        const w = mountPanel({ risks: [] })
        expect(w.text()).toContain('暂无风险条目')
        expect(findCards(w)).toHaveLength(0)
    })

    it('按 clauseParagraphIndex 升序渲染风险（输入故意倒序）', () => {
        const r1 = makeRisk({ id: 'a', clauseParagraphIndex: 5, category: '条款甲' })
        const r2 = makeRisk({ id: 'b', clauseParagraphIndex: 1, category: '条款乙' })
        const w = mountPanel({ risks: [r1, r2] })

        const cards = findCards(w)
        expect(cards).toHaveLength(2)
        // clauseParagraphIndex=1 的 "条款乙" 排在前面
        expect(cards[0]!.text()).toContain('条款乙')
        expect(cards[1]!.text()).toContain('条款甲')
    })

    it('不原地 sort props（外层传入数组不会被变更）', () => {
        const risks = [
            makeRisk({ id: 'a', clauseIndex: 5 }),
            makeRisk({ id: 'b', clauseIndex: 1 }),
        ]
        const snapshot = risks.map(r => r.id)
        mountPanel({ risks })
        expect(risks.map(r => r.id)).toEqual(snapshot)
    })

    it('不同 level 渲染不同徽章颜色类', () => {
        const risks = [
            makeRisk({ id: 'h', clauseIndex: 0, level: 'high' }),
            makeRisk({ id: 'm', clauseIndex: 1, level: 'medium' }),
            makeRisk({ id: 'l', clauseIndex: 2, level: 'low' }),
        ]
        const w = mountPanel({ risks })
        const html = w.html()
        expect(html).toContain('bg-red-500')
        expect(html).toContain('bg-orange-500')
        expect(html).toContain('bg-gray-400')
    })

    it('level 徽章文案使用中文（高/中/低）', () => {
        const risks = [
            makeRisk({ id: 'h', clauseIndex: 0, level: 'high' }),
            makeRisk({ id: 'm', clauseIndex: 1, level: 'medium' }),
            makeRisk({ id: 'l', clauseIndex: 2, level: 'low' }),
        ]
        const w = mountPanel({ risks })
        const text = w.text()
        expect(text).toContain('高')
        expect(text).toContain('中')
        expect(text).toContain('低')
    })

    it('点击 Card 展开单条风险，显示 analysis/risk/suggestion 与 RiskClauseDiff', async () => {
        const risk = makeRisk({
            id: 'x',
            analysis: '条款分析详细内容',
            risk: '法律风险详细内容',
            suggestion: '修改建议详细内容',
            clauseText: '原文AAA',
            suggestedClauseText: '改写BBB',
        })
        const w = mountPanel({ risks: [risk] })

        expect(w.find('[data-stub="RiskClauseDiff"]').exists()).toBe(false)

        await findCards(w)[0]!.trigger('click')

        expect(w.find('[data-stub="RiskClauseDiff"]').exists()).toBe(true)
        const text = w.text()
        expect(text).toContain('条款分析详细内容')
        expect(text).toContain('法律风险详细内容')
        expect(text).toContain('修改建议详细内容')

        const diff = w.find('[data-stub="RiskClauseDiff"]')
        expect(diff.attributes('data-clause-text')).toBe('原文AAA')
        expect(diff.attributes('data-suggested-clause-text')).toBe('改写BBB')
    })

    it('legalBasis 非空时展示；为空时不展示"法律依据"标签', async () => {
        const withBasis = makeRisk({ id: '1', legalBasis: '《民法典》第 585 条' })
        const w1 = mountPanel({ risks: [withBasis] })
        await findCards(w1)[0]!.trigger('click')
        expect(w1.text()).toContain('法律依据')
        expect(w1.text()).toContain('《民法典》第 585 条')

        const withoutBasis = makeRisk({ id: '2', legalBasis: undefined })
        const w2 = mountPanel({ risks: [withoutBasis] })
        await findCards(w2)[0]!.trigger('click')
        expect(w2.text()).not.toContain('法律依据')
    })

    it('再次点击同一 Card 收起', async () => {
        const w = mountPanel({ risks: [makeRisk({ id: 'a' })] })
        const card = findCards(w)[0]!
        await card.trigger('click')
        expect(w.find('[data-stub="RiskClauseDiff"]').exists()).toBe(true)

        await card.trigger('click')
        expect(w.find('[data-stub="RiskClauseDiff"]').exists()).toBe(false)
    })

    it('点击另一张 Card 会切换展开目标（只展开一条）', async () => {
        const risks = [
            makeRisk({ id: 'a', clauseIndex: 0, clauseText: 'AAA' }),
            makeRisk({ id: 'b', clauseIndex: 1, clauseText: 'BBB' }),
        ]
        const w = mountPanel({ risks })
        const cards = findCards(w)

        await cards[0]!.trigger('click')
        expect(w.find('[data-stub="RiskClauseDiff"]').attributes('data-clause-text')).toBe('AAA')

        await cards[1]!.trigger('click')
        const diffs = w.findAll('[data-stub="RiskClauseDiff"]')
        expect(diffs).toHaveLength(1)
        expect(diffs[0]!.attributes('data-clause-text')).toBe('BBB')
    })

    it('summary 非空时渲染摘要；为 null 时不渲染', () => {
        // M6.1 Task 1.2：summary 从 string 收敛为 ContractOverview，overall 字段承载总评
        const w1 = mountPanel({ summary: { highlights: null, overall: '合同整体风险可控，需重点关注违约金条款。' } })
        expect(w1.text()).toContain('合同整体风险可控，需重点关注违约金条款。')

        const w2 = mountPanel({ summary: null })
        expect(w2.text()).not.toContain('合同整体风险可控')
    })

    it('reviewedFileId 为 null 时下载按钮 disabled', () => {
        const w = mountPanel({ status: 'completed', reviewedFileId: null })
        const btn = findDownloadButton(w)
        expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('status 非 completed 但 reviewedFileId 有值时下载按钮仍 disabled', () => {
        const w = mountPanel({ status: 'reviewing', reviewedFileId: 123 })
        const btn = findDownloadButton(w)
        expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('status=completed 且 reviewedFileId 有值时下载按钮 enable', () => {
        // PR6：下载入口改为 DropdownMenu，点击 trigger 仅打开菜单不直接 emit；
        // emit('download', mode) 在选中 RadioItem 时触发，断言移到下方
        // "RiskListPanel 下载模式 toggle" describe 块。
        const w = mountPanel({ status: 'completed', reviewedFileId: 123 })
        const btn = findDownloadButton(w)
        expect((btn.element as HTMLButtonElement).disabled).toBe(false)
    })
})

describe('RiskListPanel M5 扩展', () => {
    function completedProps(over: Partial<Parameters<typeof mountPanel>[0]> = {}) {
        return { status: 'completed' as ContractReviewStatus, reviewedFileId: 123, ...over }
    }

    it('顶部不再显示"新增风险"按钮（入口已移至左侧预览 hover）', () => {
        const w = mountPanel(completedProps({ risks: [] }))
        expect(findButtonByText(w, '新增风险')).toBeUndefined()
        // 新增入口改为暴露 openCreateWithPrefill 给父组件（预览 hover「＋」调用）
        expect(typeof exposedOpenCreate(w)).toBe('function')
    })

    it('editable=false 时编辑/删除按钮 disabled', async () => {
        // status != 'completed' → 全局不可编辑
        const w = mountPanel({ status: 'reviewing', risks: [makeRisk()] })
        await findCards(w)[0]!.trigger('click')
        const editBtn = findButtonByText(w, '编辑')!
        const delBtn = findButtonByText(w, '删除')!
        expect((editBtn.element as HTMLButtonElement).disabled).toBe(true)
        expect((delBtn.element as HTMLButtonElement).disabled).toBe(true)
    })

    it('openCreateWithPrefill → 打开 RiskEditDialog（新增模式 editingRisk=null）', async () => {
        const w = mountPanel(completedProps({ risks: [] }))
        expect(w.find('[data-stub="RiskEditDialog"]').exists()).toBe(false)

        exposedOpenCreate(w)({ clauseText: '段落原文', clauseParagraphIndex: 3 })
        await nextTick()
        const dialog = w.find('[data-stub="RiskEditDialog"]')
        expect(dialog.exists()).toBe(true)
        expect(dialog.attributes('data-has-risk')).toBe('0')
    })

    it('点击某条风险的"编辑" → 打开 RiskEditDialog（editingRisk=该 risk）', async () => {
        const w = mountPanel(completedProps({ risks: [makeRisk({ id: 'target-id' })] }))
        await findCards(w)[0]!.trigger('click')
        await findButtonByText(w, '编辑')!.trigger('click')

        const dialog = w.find('[data-stub="RiskEditDialog"]')
        expect(dialog.exists()).toBe(true)
        expect(dialog.attributes('data-has-risk')).toBe('1')
    })

    it('openCreateWithPrefill 后确认 → emit createRisk 携带 prefill 与新 risk', async () => {
        const w = mountPanel(completedProps({ risks: [makeRisk({ id: 'existing' })] }))
        exposedOpenCreate(w)({ clauseText: '段落原文', clauseParagraphIndex: 3 })
        await nextTick()
        await w.find('[data-test="edit-dialog-fire-confirm"]').trigger('click')

        const payload = w.emitted('createRisk')![0][0] as {
            clauseText: string; clauseParagraphIndex: number; risk: Risk
        }
        expect(payload.clauseText).toBe('段落原文')
        expect(payload.clauseParagraphIndex).toBe(3)
        expect(payload.risk.id).toBe('new-risk-uuid')
        // 新增走 createRisk，不再走 editRisks
        expect(w.emitted('editRisks')).toBeUndefined()
    })

    it('RiskEditDialog 确认编辑 → emit editRisks 替换同 id 的 risk', async () => {
        const r = makeRisk({ id: 'target', suggestion: '旧建议' })
        const other = makeRisk({ id: 'other', clauseIndex: 10 })
        const w = mountPanel(completedProps({ risks: [r, other] }))

        await findCards(w)[0]!.trigger('click')
        await findButtonByText(w, '编辑')!.trigger('click')
        await w.find('[data-test="edit-dialog-fire-confirm"]').trigger('click')

        const payload = w.emitted('editRisks')![0][0] as Risk[]
        expect(payload).toHaveLength(2)
        const replaced = payload.find(x => x.id === 'target')!
        expect(replaced.suggestion).toBe('已修改建议')
        expect(payload.find(x => x.id === 'other')).toEqual(other)
    })

    it('点击"删除" → 打开 AlertDialog 二次确认', async () => {
        const w = mountPanel(completedProps({ risks: [makeRisk()] }))
        await findCards(w)[0]!.trigger('click')
        expect(w.text()).not.toContain('确认删除该风险？')

        await findButtonByText(w, '删除')!.trigger('click')
        await nextTick()
        expect(w.text()).toContain('确认删除该风险？')
    })

    it('AlertDialog 确认 → emit editRisks 移除该 risk', async () => {
        const a = makeRisk({ id: 'a', clauseIndex: 0 })
        const b = makeRisk({ id: 'b', clauseIndex: 1 })
        const w = mountPanel(completedProps({ risks: [a, b] }))

        await findCards(w)[0]!.trigger('click')
        await findButtonByText(w, '删除')!.trigger('click')
        await nextTick()
        await w.find('[data-stub="AlertDialogAction"]').trigger('click')

        const payload = w.emitted('editRisks')![0][0] as Risk[]
        expect(payload).toHaveLength(1)
        expect(payload[0]!.id).toBe('b')
    })

    it('AlertDialog 取消 → 不 emit editRisks', async () => {
        const w = mountPanel(completedProps({ risks: [makeRisk()] }))
        await findCards(w)[0]!.trigger('click')
        await findButtonByText(w, '删除')!.trigger('click')
        await nextTick()

        await w.find('[data-stub="AlertDialogCancel"]').trigger('click')
        expect(w.emitted('editRisks')).toBeUndefined()
    })
})

describe('RiskListPanel · M6.1 流式冒出', () => {
    it('新增 risk 挂 data-just-added 属性 3 秒后移除', async () => {
        vi.useFakeTimers()
        const w = mountPanel({
            risks: [],
            status: 'reviewing' as ContractReviewStatus,
            reviewedFileId: null,
            summary: null,
        })
        await w.setProps({
            risks: [makeRisk({
                id: 'r1',
                clauseIndex: 1,
                level: 'high',
                category: '违约责任',
                problem: '违约金比例过高',
                analysis: '分析内容',
                risk: '法律风险说明',
                suggestion: '修改建议说明',
            })],
        })
        await nextTick()
        expect(w.find('[data-risk-id="r1"][data-just-added="true"]').exists()).toBe(true)
        vi.advanceTimersByTime(3000)
        await nextTick()
        expect(w.find('[data-risk-id="r1"][data-just-added="true"]').exists()).toBe(false)
        vi.useRealTimers()
    })
})

// mountPanel 辅助：带 Task 4.4 + 4.6.1 新增 props 的版本
function mountPanelWithPin(props: Partial<{
    risks: Risk[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: ContractOverview | null
    focusedRiskId: string | null
    hoveredRiskId: string | null
    pinnedRiskIds: Set<string>
    notLocatedIds: Set<string>
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

// 注：M6.1 Task 4.6.1 "未定位"标签的渲染逻辑已搬到 RiskCard 子组件，
// 对应单元测试见 tests/app/components/assistant/contract/RiskCard.test.ts。

describe('RiskListPanel · M6.1 Task 4.4 钉住 + 聚焦态', () => {
    it('卡片右上渲染未钉状态的 Pin 图标按钮', () => {
        const w = mountPanelWithPin({ risks: [makeRisk({ id: 'r1' })], pinnedRiskIds: new Set() })
        // 未钉时按钮 aria-label="钉住"
        const pinBtn = w.find('[aria-label="钉住"]')
        expect(pinBtn.exists()).toBe(true)
    })

    it('已钉住时按钮 aria-label 变为"取消钉住"', () => {
        const w = mountPanelWithPin({
            risks: [makeRisk({ id: 'r1' })],
            pinnedRiskIds: new Set(['r1']),
        })
        const pinBtn = w.find('[aria-label="取消钉住"]')
        expect(pinBtn.exists()).toBe(true)
    })

    it('点击钉按钮 emit togglePin，不触发 focusRisk（@click.stop）', async () => {
        const w = mountPanelWithPin({ risks: [makeRisk({ id: 'r1' })], pinnedRiskIds: new Set() })
        const pinBtn = w.find('[aria-label="钉住"]')
        await pinBtn.trigger('click')
        expect(w.emitted('togglePin')).toBeTruthy()
        expect(w.emitted('togglePin')![0]).toEqual(['r1'])
        // focusRisk 不应该被触发（@click.stop）
        expect(w.emitted('focusRisk')).toBeUndefined()
    })

    it('点击卡片 emit focusRisk', async () => {
        const w = mountPanelWithPin({ risks: [makeRisk({ id: 'r1' })], pinnedRiskIds: new Set() })
        const card = w.find('[data-stub="Card"]')
        await card.trigger('click')
        expect(w.emitted('focusRisk')).toBeTruthy()
        expect(w.emitted('focusRisk')![0]).toEqual(['r1'])
    })

    it('focusedRiskId 匹配时卡片带 bg-yellow-50 border-l-4 border-red-500 class', () => {
        const w = mountPanelWithPin({
            risks: [makeRisk({ id: 'r1' })],
            focusedRiskId: 'r1',
            pinnedRiskIds: new Set(),
        })
        const card = w.find('[data-risk-id="r1"]')
        expect(card.classes()).toContain('bg-yellow-50')
        expect(card.classes()).toContain('border-l-4')
        expect(card.classes()).toContain('border-red-500')
    })

    it('已钉且 focusedRiskId 不是该 id 时卡片带 bg-orange-50 border-l-4 border-orange-500 class', () => {
        const w = mountPanelWithPin({
            risks: [makeRisk({ id: 'r1' })],
            focusedRiskId: null,
            pinnedRiskIds: new Set(['r1']),
        })
        const card = w.find('[data-risk-id="r1"]')
        expect(card.classes()).toContain('bg-orange-50')
        expect(card.classes()).toContain('border-l-4')
        expect(card.classes()).toContain('border-orange-500')
    })

    it('已钉且 focusedRiskId 是该 id 时，焦点 class 优先（bg-yellow-50 border-red-500）', () => {
        const w = mountPanelWithPin({
            risks: [makeRisk({ id: 'r1' })],
            focusedRiskId: 'r1',
            pinnedRiskIds: new Set(['r1']),
        })
        const card = w.find('[data-risk-id="r1"]')
        // 焦点态优先
        expect(card.classes()).toContain('bg-yellow-50')
        expect(card.classes()).toContain('border-red-500')
        expect(card.classes()).not.toContain('bg-orange-50')
        expect(card.classes()).not.toContain('border-orange-500')
    })

    it('hoveredRiskId 命中的 card 加 bg-yellow-50（不加 border-l / 不加红色边框）', () => {
        const w = mountPanelWithPin({
            risks: [makeRisk({ id: 'r1' }), makeRisk({ id: 'r2', clauseIndex: 1 })],
            focusedRiskId: null,
            hoveredRiskId: 'r1',
            pinnedRiskIds: new Set<string>(),
        })
        const card1 = w.find('[data-risk-id="r1"]')
        expect(card1.classes()).toContain('bg-yellow-50')
        // hover 态不加边框/焦点标识
        expect(card1.classes()).not.toContain('border-red-500')
        expect(card1.classes()).not.toContain('border-l-4')
        // 其它卡片不受影响
        const card2 = w.find('[data-risk-id="r2"]')
        expect(card2.classes()).not.toContain('bg-yellow-50')
    })
})

describe('RiskListPanel · Task 2.6 清单要点徽章', () => {
    const snapshot: PlaybookSnapshot = {
        contractType: '劳动合同',
        snapshotAt: '2024-01-01T00:00:00.000Z',
        points: [
            {
                code: 'P001',
                title: '试用期约定合规性',
                defaultLevel: 'high',
                stancePreference: 'party_a',
                checkContent: '是否约定了合法试用期',
                legalBasis: '《劳动合同法》第19条',
                suggestion: '试用期不超过6个月',
            },
            {
                code: 'P002',
                title: '工资支付条款',
                defaultLevel: 'medium',
                stancePreference: 'balanced',
                checkContent: '工资支付方式是否合法',
                legalBasis: undefined,
                suggestion: undefined,
            },
        ],
    }

    it('risk.matchedPointCode 命中 snapshot 时，卡片显示对应要点标题徽章', () => {
        const risk = makeRisk({ id: 'r1', matchedPointCode: 'P001' })
        const w = mount(RiskListPanel, {
            props: {
                risks: [risk],
                status: 'completed' as ContractReviewStatus,
                reviewedFileId: 123,
                summary: null,
                focusedRiskId: null,
                hoveredRiskId: null,
                pinnedRiskIds: new Set<string>(),
                notLocatedIds: new Set<string>(),
                playbookSnapshot: snapshot,
            },
            global: { stubs },
        })
        const card = w.find('[data-risk-id="r1"]')
        expect(card.text()).toContain('试用期约定合规性')
    })

    it('risk.matchedPointCode 为空时，卡片不显示清单要点徽章', () => {
        const risk = makeRisk({ id: 'r1' })
        const w = mount(RiskListPanel, {
            props: {
                risks: [risk],
                status: 'completed' as ContractReviewStatus,
                reviewedFileId: 123,
                summary: null,
                focusedRiskId: null,
                hoveredRiskId: null,
                pinnedRiskIds: new Set<string>(),
                notLocatedIds: new Set<string>(),
                playbookSnapshot: snapshot,
            },
            global: { stubs },
        })
        const card = w.find('[data-risk-id="r1"]')
        expect(card.text()).not.toContain('试用期约定合规性')
        expect(card.text()).not.toContain('工资支付条款')
    })

    it('matchedPointCode 有值但 playbookSnapshot 为 null 时，不显示徽章', () => {
        const risk = makeRisk({ id: 'r1', matchedPointCode: 'P001' })
        const w = mount(RiskListPanel, {
            props: {
                risks: [risk],
                status: 'completed' as ContractReviewStatus,
                reviewedFileId: 123,
                summary: null,
                focusedRiskId: null,
                hoveredRiskId: null,
                pinnedRiskIds: new Set<string>(),
                notLocatedIds: new Set<string>(),
                playbookSnapshot: null,
            },
            global: { stubs },
        })
        const card = w.find('[data-risk-id="r1"]')
        expect(card.text()).not.toContain('试用期约定合规性')
    })

    it('matchedPointCode 在 snapshot 中找不到对应 point 时，不显示徽章', () => {
        const risk = makeRisk({ id: 'r1', matchedPointCode: 'UNKNOWN' })
        const w = mount(RiskListPanel, {
            props: {
                risks: [risk],
                status: 'completed' as ContractReviewStatus,
                reviewedFileId: 123,
                summary: null,
                focusedRiskId: null,
                hoveredRiskId: null,
                pinnedRiskIds: new Set<string>(),
                notLocatedIds: new Set<string>(),
                playbookSnapshot: snapshot,
            },
            global: { stubs },
        })
        const card = w.find('[data-risk-id="r1"]')
        expect(card.text()).not.toContain('试用期约定合规性')
    })
})

// ===== Phase B：三分组 UI 测试 =====

type RiskDisplayPhaseB = Risk & {
    archivedStatus?: string | null
    entityId?: number
    source?: 'ai' | 'external_new' | 'global_review'
    orphaned?: boolean
    originalClauseText?: string | null
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

function mountPanelPhaseB(props: Partial<{
    risks: RiskDisplayPhaseB[]
    annotations: ContractAnnotationEntity[]
    status: ContractReviewStatus
    reviewedFileId: number | null
    summary: ContractOverview | null
    focusedRiskId: string | null
    hoveredRiskId: string | null
    pinnedRiskIds: Set<string>
    notLocatedIds: Set<string>
}> = {}) {
    return mount(RiskListPanel, {
        props: {
            risks: [],
            status: 'completed' as ContractReviewStatus,
            reviewedFileId: 123,
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

describe('RiskListPanel · Phase B 外部新增分组', () => {
    it('source=external_new 的风险渲染在顶部外部新增分组，显示"外部新增"标题', () => {
        const extRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'ext-1', clauseIndex: 5 }), source: 'external_new' }
        const w = mountPanelPhaseB({ risks: [extRisk] })
        expect(w.text()).toContain('外部新增')
    })

    it('外部新增分组卡片带 border-orange-500 竖条样式', () => {
        const extRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'ext-1' }), source: 'external_new' }
        const w = mountPanelPhaseB({ risks: [extRisk] })
        expect(w.html()).toContain('border-orange-500')
    })

    it('外部新增分组显示外部批注 authorName + "外部批注"标签', () => {
        const extRisk: RiskDisplayPhaseB = { ...makeRisk({ id: '1' }), source: 'external_new' }
        const ann = makeAnnotation({ id: 10, riskId: 1, authorType: 'external', authorName: '王先生' })
        const w = mountPanelPhaseB({ risks: [extRisk], annotations: [ann] })
        expect(w.text()).toContain('王先生')
        expect(w.text()).toContain('外部批注')
    })

    it('没有 external_new 风险时不渲染外部新增分组', () => {
        const aiRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'ai-1' }), source: 'ai' }
        const w = mountPanelPhaseB({ risks: [aiRisk] })
        expect(w.text()).not.toContain('外部新增（')
    })

    it('外部新增分组标题显示数量', () => {
        const r1: RiskDisplayPhaseB = { ...makeRisk({ id: 'e1', clauseIndex: 0 }), source: 'external_new' }
        const r2: RiskDisplayPhaseB = { ...makeRisk({ id: 'e2', clauseIndex: 1 }), source: 'external_new' }
        const w = mountPanelPhaseB({ risks: [r1, r2] })
        expect(w.text()).toContain('外部新增（2）')
    })
})

describe('RiskListPanel · Phase B 孤立批注区', () => {
    it('orphaned=true 的风险渲染在孤立批注区，显示"原文已修改·无法定位"标题', () => {
        const orphanRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'o-1', clauseIndex: 3 }), orphaned: true }
        const w = mountPanelPhaseB({ risks: [orphanRisk] })
        expect(w.text()).toContain('原文已修改')
        expect(w.text()).toContain('无法定位')
    })

    it('孤立批注区标题显示数量', () => {
        const r1: RiskDisplayPhaseB = { ...makeRisk({ id: 'o-1', clauseIndex: 0 }), orphaned: true }
        const r2: RiskDisplayPhaseB = { ...makeRisk({ id: 'o-2', clauseIndex: 1 }), orphaned: true }
        const w = mountPanelPhaseB({ risks: [r1, r2] })
        expect(w.text()).toContain('无法定位（2）')
    })

    it('没有 orphaned 风险时不渲染孤立批注区', () => {
        const aiRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'ai-1' }), orphaned: false }
        const w = mountPanelPhaseB({ risks: [aiRisk] })
        expect(w.text()).not.toContain('无法定位（')
    })

    it('孤立风险卡片展开后显示 originalClauseText 原锚点', async () => {
        const orphanRisk: RiskDisplayPhaseB = {
            ...makeRisk({ id: 'o-1' }),
            orphaned: true,
            originalClauseText: '此处为原合同第三条款内容',
        }
        const w = mountPanelPhaseB({ risks: [orphanRisk] })
        await w.find('[data-risk-id="o-1"]').trigger('click')
        expect(w.text()).toContain('此处为原合同第三条款内容')
    })

    it('孤立风险卡片展开后有"查看原始语境"按钮，点击 emit jump-to-original', async () => {
        const orphanRisk: RiskDisplayPhaseB = {
            ...makeRisk({ id: 'o-1' }),
            orphaned: true,
            originalClauseText: '原文片段',
        }
        const w = mountPanelPhaseB({ risks: [orphanRisk] })
        await w.find('[data-risk-id="o-1"]').trigger('click')
        const btn = w.findAll('button').find(b => b.text().includes('查看原始语境'))
        expect(btn).toBeTruthy()
        await btn!.trigger('click')
        expect(w.emitted('jump-to-original')).toBeTruthy()
        expect(w.emitted('jump-to-original')![0]).toEqual(['o-1'])
    })
})

describe('RiskListPanel · Phase B 客户已移除分组', () => {
    it('有 removedByClient=true 的批注时渲染"客户已移除"分组，默认折叠', () => {
        const removedAnn = makeAnnotation({ id: 20, removedByClient: true, content: '被删内容X' })
        const w = mountPanelPhaseB({ risks: [makeRisk()], annotations: [removedAnn] })
        expect(w.text()).toContain('客户已移除')
        expect(w.text()).not.toContain('被删内容X')
    })

    it('客户已移除分组标题显示数量', () => {
        const a1 = makeAnnotation({ id: 21, removedByClient: true })
        const a2 = makeAnnotation({ id: 22, removedByClient: true })
        const w = mountPanelPhaseB({ risks: [makeRisk()], annotations: [a1, a2] })
        expect(w.text()).toContain('客户已移除（2）')
    })

    it('点击"客户已移除"分组标题后展开，显示被删除批注内容', async () => {
        const removedAnn = makeAnnotation({ id: 23, removedByClient: true, content: '已删批注内容' })
        const w = mountPanelPhaseB({ risks: [makeRisk()], annotations: [removedAnn] })
        const toggleBtn = w.findAll('button').find(b => b.text().includes('客户已移除'))
        await toggleBtn!.trigger('click')
        expect(w.text()).toContain('已删批注内容')
    })

    it('展开后显示"恢复推送"按钮，点击弹出 AlertDialog 确认', async () => {
        const removedAnn = makeAnnotation({ id: 24, removedByClient: true })
        const w = mountPanelPhaseB({ risks: [makeRisk()], annotations: [removedAnn] })
        const toggleBtn = w.findAll('button').find(b => b.text().includes('客户已移除'))
        await toggleBtn!.trigger('click')
        const restoreBtn = w.findAll('button').find(b => b.text().includes('恢复推送'))
        expect(restoreBtn).toBeTruthy()
        await restoreBtn!.trigger('click')
        await nextTick()
        expect(w.text()).toContain('客户已明确删除过这条')
    })

    it('AlertDialog 确认恢复后 emit restore-annotation', async () => {
        const removedAnn = makeAnnotation({ id: 25, removedByClient: true })
        const w = mountPanelPhaseB({ risks: [makeRisk()], annotations: [removedAnn] })
        const toggleBtn = w.findAll('button').find(b => b.text().includes('客户已移除'))
        await toggleBtn!.trigger('click')
        const restoreBtn = w.findAll('button').find(b => b.text().includes('恢复推送'))
        await restoreBtn!.trigger('click')
        await nextTick()
        const confirmBtn = w.find('[data-stub="AlertDialogAction"]')
        await confirmBtn.trigger('click')
        expect(w.emitted('restore-annotation')).toBeTruthy()
        expect(w.emitted('restore-annotation')![0]).toEqual([25])
    })

    it('没有 removedByClient 批注时不渲染客户已移除分组', () => {
        const ann = makeAnnotation({ id: 30, removedByClient: false })
        const w = mountPanelPhaseB({ risks: [makeRisk()], annotations: [ann] })
        expect(w.text()).not.toContain('客户已移除（')
    })
})

describe('RiskListPanel · Phase B 渲染顺序', () => {
    it('外部新增分组渲染在主清单之前', () => {
        const extRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'ext-1', clauseIndex: 10 }), source: 'external_new' }
        const aiRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'ai-1', clauseIndex: 1 }), source: 'ai' }
        const w = mountPanelPhaseB({ risks: [aiRisk, extRisk] })
        const html = w.html()
        const extIdx = html.indexOf('外部新增')
        const aiCardIdx = html.indexOf('data-risk-id="ai-1"')
        expect(extIdx).toBeLessThan(aiCardIdx)
    })

    it('孤立批注区渲染在主清单之后', () => {
        const aiRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'ai-1', clauseIndex: 1 }), source: 'ai' }
        const orphanRisk: RiskDisplayPhaseB = { ...makeRisk({ id: 'o-1', clauseIndex: 2 }), orphaned: true }
        const w = mountPanelPhaseB({ risks: [aiRisk, orphanRisk] })
        const html = w.html()
        const aiCardIdx = html.indexOf('data-risk-id="ai-1"')
        const orphanSectionIdx = html.indexOf('无法定位')
        expect(aiCardIdx).toBeLessThan(orphanSectionIdx)
    })
})

describe('RiskListPanel · 布局切换（PR 4）', () => {
    // 兜底清理：测试串行共享 jsdom，前一个 it 异常退出会残留偏好
    afterEach(() => {
        localStorage.removeItem('contract-review-risk-card-layout')
    })

    it('渲染顶部布局 Tabs 段控（分段 / 对照 两选项）', () => {
        const w = mountPanel({ risks: [] })
        const tabs = w.find('[data-testid="risk-card-layout-tabs"]')
        expect(tabs.exists()).toBe(true)
        const triggers = w.findAll('[data-stub="TabsTrigger"]')
        expect(triggers.length).toBe(2)
        expect(triggers[0]?.attributes('data-value')).toBe('stacked')
        expect(triggers[1]?.attributes('data-value')).toBe('inline-diff')
        expect(triggers[0]?.text()).toBe('分段')
        expect(triggers[1]?.text()).toBe('对照')
    })

    it('cardLayout 默认 stacked → 链路最终把 mode="stacked" 透传到 RiskClauseDiff', async () => {
        // 清理 localStorage 避免前序用例残留污染
        localStorage.removeItem('contract-review-risk-card-layout')
        const w = mountPanel({
            risks: [makeRisk({ id: 'r1' })],
        })
        // RiskListPanel.cardLayout → RiskCard.layout → RiskClauseDiff.mode 链路
        // 展开第一张卡让 RiskClauseDiff 进入 DOM
        await w.find('[data-risk-id="r1"]').trigger('click')
        const diff = w.find('[data-stub="RiskClauseDiff"]')
        expect(diff.exists()).toBe(true)
        expect(diff.attributes('data-mode')).toBe('stacked')
    })

    it('localStorage 已存 inline-diff → 链路最终把 mode="inline-diff" 透传到 RiskClauseDiff', async () => {
        // @vueuse/core useLocalStorage 对 string 类型走 String(v) serializer，
        // localStorage 里的值是裸字符串 'inline-diff'（**不带 JSON 引号**）。
        // 源码确认：node_modules/@vueuse/core/dist/index.js StorageSerializers.string.write = (v) => String(v)
        localStorage.setItem('contract-review-risk-card-layout', 'inline-diff')
        const w = mountPanel({
            risks: [makeRisk({ id: 'r1' })],
        })
        await nextTick()
        await w.find('[data-risk-id="r1"]').trigger('click')
        const diff = w.find('[data-stub="RiskClauseDiff"]')
        expect(diff.exists()).toBe(true)
        expect(diff.attributes('data-mode')).toBe('inline-diff')
    })
})

describe('RiskListPanel 下载模式 toggle（PR6 §8.1）', () => {
    /**
     * shadcn DropdownMenuContent 内部用 reka-ui Portal 渲染（默认 target=document.body），
     * happy-dom 下 wrapper.find('[data-testid=...]') 找不到 portal 内节点。
     * 参考 tests/app/components/assistant/contract/StanceSelectionDialog.test.ts:42-67 的
     * provide/inject 模式：RadioItem 通过 inject 拿到 RadioGroup 的 emit 回调，
     * 这样 click → inject callback → RadioGroup stub emit 'update:modelValue' →
     * RiskListPanel 模板上的 @update:model-value="handleSelectMode" 拿到 → emit('download', mode)。
     *
     * 不能用 `$parent.$emit` —— slot 渲染时 $parent 指向 slot owner（RiskListPanel）
     * 而不是 stub 的 RadioGroup，会让事件发到错地方导致测试 fail。
     */
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

    // 合并已有 stubs：保留 ScrollArea / Card / Button / Tabs / RiskEditDialog / AlertDialog 等基础 stub，
    // 再叠加新增的 DropdownMenu 系列；mountPanel 默认只用 stubs，这里需要 mount 时手动并入。
    const mergedStubs = { ...stubs, ...dropdownStubs }

    function mountWithMode(props: Partial<Parameters<typeof mountPanel>[0]> = {}) {
        return mount(RiskListPanel, {
            props: {
                risks: [],
                status: 'completed' as ContractReviewStatus,
                reviewedFileId: 123,
                summary: null,
                focusedRiskId: null,
                hoveredRiskId: null,
                pinnedRiskIds: new Set<string>(),
                notLocatedIds: new Set<string>(),
                ...props,
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
            'download-mode-comment',
            'download-mode-redline',
            'download-mode-both',
        ])
    })

    it('选中 redline → emit download(redline)', async () => {
        const w = mountWithMode()
        await w.find('[data-testid="download-mode-redline"]').trigger('click')
        const emitted = w.emitted('download') ?? []
        expect(emitted.length).toBeGreaterThan(0)
        expect(emitted[emitted.length - 1]).toEqual(['redline'])
    })

    it('localStorage 持久化模式偏好', async () => {
        localStorage.setItem('contract-review-export-mode', 'both')
        const w = mountWithMode()
        // 通过 modelValue prop 验证持久化生效（不依赖 data-state，因为 Portal stub 后无 radix 状态）
        const radioGroup = w.findComponent(dropdownStubs.DropdownMenuRadioGroup as any)
        expect(radioGroup.props('modelValue')).toBe('both')
    })
})
