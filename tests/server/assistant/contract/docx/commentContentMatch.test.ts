import { describe, it, expect } from 'vitest'
import { matchCommentsToAnnotations } from '~~/server/agents/contract/docx/commentContentMatch'

const ANN_A = '【高风险】薪酬合规\n问题：试用期工资仅为转正后 50%，违反法定底线。'
const ANN_B = '【中风险】合同期限\n问题：3 年固定期限合同缺少到期续签预警机制。'

describe('matchCommentsToAnnotations', () => {
    it('exact：归一化后完全相等 → 命中', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: ANN_A }],
            [{ id: 100, content: ANN_A }, { id: 101, content: ANN_B }],
        )
        expect(r.get(5)).toBe(100)
    })

    it('换行被 Word 压成空格 → 归一化后仍 exact 命中', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: ANN_A.replace(/\n/g, ' ') }],
            [{ id: 100, content: ANN_A }],
        )
        expect(r.get(5)).toBe(100)
    })

    it('客户改了几个字 → fuzzy 命中', () => {
        const edited = ANN_A.replace('50%', '百分之五十')
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: edited }],
            [{ id: 100, content: ANN_A }, { id: 101, content: ANN_B }],
        )
        expect(r.get(5)).toBe(100)
    })

    it('内容与任何系统批注都不像 → 不命中', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: '客户自己新增的一句无关批注' }],
            [{ id: 100, content: ANN_A }, { id: 101, content: ANN_B }],
        )
        expect(r.has(5)).toBe(false)
    })

    it('两条系统批注内容完全相同 → exact 多命中，不匹配（避免错选）', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: ANN_A }],
            [{ id: 100, content: ANN_A }, { id: 101, content: ANN_A }],
        )
        expect(r.has(5)).toBe(false)
    })

    it('空 content → 跳过', () => {
        const r = matchCommentsToAnnotations(
            [{ wId: 5, content: '' }],
            [{ id: 100, content: ANN_A }],
        )
        expect(r.has(5)).toBe(false)
    })
})
