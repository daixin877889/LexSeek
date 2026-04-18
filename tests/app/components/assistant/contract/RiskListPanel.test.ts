import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import RiskListPanel from '~/components/assistant/contract/RiskListPanel.vue'
import type { Risk, ContractReviewStatus } from '#shared/types/contract'

/**
 * RiskListPanel 单元测试
 *
 * **Feature: contract-review-m4**
 *
 * 组件职责（M4 只读版）：
 * - 右侧风险清单侧栏
 * - 按 clauseIndex 升序渲染（不原地 sort props）
 * - 每条风险显示 level 徽章 + category + problem；点击 Card 展开/收起
 * - 展开时显示 AssistantContractRiskClauseDiff + legalBasis(可选) + analysis + risk + suggestion
 * - 顶部 summary 非空时渲染；空则不渲染
 * - 空风险 → "暂无风险条目"
 * - 下载按钮仅在 status === 'completed' && reviewedFileId !== null 时 enable
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
    },
    setup(props) {
        return () =>
            h('div', {
                'data-stub': 'RiskClauseDiff',
                'data-clause-text': props.clauseText,
                'data-suggested-clause-text': props.suggestedClauseText,
            })
    },
})

const stubs = {
    ScrollArea: ScrollAreaStub,
    Card: CardStub,
    CardHeader: passthrough('CardHeader'),
    CardContent: passthrough('CardContent'),
    Button: ButtonStub,
    AssistantContractRiskClauseDiff: RiskClauseDiffStub,
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
    summary: string | null
}> = {}) {
    return mount(RiskListPanel, {
        props: {
            risks: [],
            status: 'pending' as ContractReviewStatus,
            reviewedFileId: null,
            summary: null,
            ...props,
        },
        global: { stubs },
    })
}

function findCards(w: ReturnType<typeof mountPanel>) {
    return w.findAll('[data-stub="Card"]')
}

function findDownloadButton(w: ReturnType<typeof mountPanel>) {
    return w.findAll('button').find(b => b.text().includes('下载批注 Word'))!
}

describe('RiskListPanel', () => {
    it('风险数组为空时显示"暂无风险条目"', () => {
        const w = mountPanel({ risks: [] })
        expect(w.text()).toContain('暂无风险条目')
        expect(findCards(w)).toHaveLength(0)
    })

    it('按 clauseIndex 升序渲染风险（输入故意倒序）', () => {
        const r1 = makeRisk({ id: 'a', clauseIndex: 5, category: '条款甲' })
        const r2 = makeRisk({ id: 'b', clauseIndex: 1, category: '条款乙' })
        const w = mountPanel({ risks: [r1, r2] })

        const cards = findCards(w)
        expect(cards).toHaveLength(2)
        // clauseIndex=1 的 "条款乙" 排在前面
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

        // 展开前 RiskClauseDiff 不存在
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
        const w1 = mountPanel({ summary: '合同整体风险可控，需重点关注违约金条款。' })
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

    it('status=completed 且 reviewedFileId 有值时下载按钮 enable，点击 emit download', async () => {
        const w = mountPanel({ status: 'completed', reviewedFileId: 123 })
        const btn = findDownloadButton(w)
        expect((btn.element as HTMLButtonElement).disabled).toBe(false)

        await btn.trigger('click')
        expect(w.emitted('download')).toBeTruthy()
        expect(w.emitted('download')!.length).toBe(1)
    })
})
