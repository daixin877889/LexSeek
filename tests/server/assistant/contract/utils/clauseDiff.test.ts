import { describe, it, expect } from 'vitest'
import type { ClauseSnapshotItem } from '#shared/types/contract'
import { diffClauses } from '~~/server/services/assistant/contract/utils/clauseDiff'

// 构造辅助：快速生成 ClauseSnapshotItem 数组
function makeClauses(texts: string[]): ClauseSnapshotItem[] {
    let offset = 0
    return texts.map((text, index) => {
        const item: ClauseSnapshotItem = { index, text, offsetStart: offset, offsetEnd: offset + text.length }
        offset += text.length + 1
        return item
    })
}

describe('diffClauses', () => {
    it('完全相同时全部为 unchanged', () => {
        const clauses = makeClauses(['第一条 甲方应按时付款。', '第二条 乙方应按时交货。'])
        const result = diffClauses(clauses, clauses)
        expect(result.unchanged).toHaveLength(2)
        expect(result.modified).toHaveLength(0)
        expect(result.added).toHaveLength(0)
        expect(result.removed).toHaveLength(0)
    })

    it('新增一条时，added 包含新条款 index', () => {
        const old = makeClauses(['第一条 甲方应按时付款。'])
        const newC = makeClauses(['第一条 甲方应按时付款。', '第二条 乙方应按时交货。'])
        const result = diffClauses(old, newC)
        expect(result.unchanged).toHaveLength(1)
        expect(result.added).toContain(1)
        expect(result.removed).toHaveLength(0)
        expect(result.modified).toHaveLength(0)
    })

    it('删除一条时，removed 包含被删条款 index', () => {
        const old = makeClauses(['第一条 甲方应按时付款。', '第二条 乙方应按时交货。'])
        const newC = makeClauses(['第一条 甲方应按时付款。'])
        const result = diffClauses(old, newC)
        expect(result.unchanged).toHaveLength(1)
        expect(result.removed).toContain(1)
        expect(result.added).toHaveLength(0)
        expect(result.modified).toHaveLength(0)
    })

    it('微改一条时（相似度 >= 0.6），modified 包含对应映射', () => {
        const old = makeClauses(['第一条 甲方应于每月十日前支付货款。'])
        // 小改动，相似度应高于阈值
        const newC = makeClauses(['第一条 甲方应于每月十五日前支付货款。'])
        const result = diffClauses(old, newC)
        expect(result.modified).toHaveLength(1)
        expect(result.modified[0].oldIndex).toBe(0)
        expect(result.modified[0].newIndex).toBe(0)
        expect(result.modified[0].similarity).toBeGreaterThanOrEqual(0.6)
        expect(result.modified[0].similarity).toBeLessThan(1)
        expect(result.added).toHaveLength(0)
        expect(result.removed).toHaveLength(0)
    })

    it('大改一条时（相似度 < 0.6），旧条款变 removed，新条款变 added', () => {
        const old = makeClauses(['第一条 甲方应按时付款。'])
        // 完全不同的文字，相似度低于默认阈值
        const newC = makeClauses(['XYZXYZXYZ ABCABC DEF GHIJKL MNOPQRSTUVWXYZ。'])
        const result = diffClauses(old, newC)
        expect(result.removed).toContain(0)
        expect(result.added).toContain(0)
        expect(result.modified).toHaveLength(0)
        expect(result.unchanged).toHaveLength(0)
    })

    it('空输入时全部为空数组', () => {
        const result = diffClauses([], [])
        expect(result.unchanged).toHaveLength(0)
        expect(result.modified).toHaveLength(0)
        expect(result.added).toHaveLength(0)
        expect(result.removed).toHaveLength(0)
    })

    it('旧为空时，所有新条款都是 added', () => {
        const newC = makeClauses(['第一条 甲方付款。', '第二条 乙方交货。'])
        const result = diffClauses([], newC)
        expect(result.added).toEqual([0, 1])
        expect(result.removed).toHaveLength(0)
        expect(result.unchanged).toHaveLength(0)
        expect(result.modified).toHaveLength(0)
    })

    it('新为空时，所有旧条款都是 removed', () => {
        const old = makeClauses(['第一条 甲方付款。', '第二条 乙方交货。'])
        const result = diffClauses(old, [])
        expect(result.removed).toEqual([0, 1])
        expect(result.added).toHaveLength(0)
        expect(result.unchanged).toHaveLength(0)
        expect(result.modified).toHaveLength(0)
    })

    it('自定义 modifiedThreshold 生效', () => {
        const old = makeClauses(['第一条 甲方应于每月十日前支付货款。'])
        const newC = makeClauses(['第一条 甲方应于每月十五日前支付货款。'])
        // 用高阈值使微改也被认为是 added+removed
        const result = diffClauses(old, newC, { modifiedThreshold: 0.999 })
        expect(result.modified).toHaveLength(0)
        expect(result.removed).toContain(0)
        expect(result.added).toContain(0)
    })
})
