import { describe, it, expect } from 'vitest'
import { applyBrackets, type Bracket } from '#shared/utils/tools/algorithms/applyBrackets'

describe('applyBrackets', () => {
    const brackets: Bracket[] = [
        { upper: 100, rate: 0.05, base: 0,    start: 0 },     // 0-100: 5%
        { upper: 1000, rate: 0.03, base: 5,   start: 100 },   // 100-1000: 3% + 5
        { upper: Infinity, rate: 0.01, base: 32, start: 1000 }, // >1000: 1% + 32
    ]

    it('amount 在第一档', () => {
        expect(applyBrackets(50, brackets)).toBeCloseTo(2.5, 4)
    })
    it('amount 在第二档', () => {
        expect(applyBrackets(500, brackets)).toBeCloseTo(5 + (500 - 100) * 0.03, 4)
    })
    it('amount 跨越最后一档', () => {
        expect(applyBrackets(5000, brackets)).toBeCloseTo(32 + (5000 - 1000) * 0.01, 4)
    })
    it('amount = 0 返回 0（首档支持 fixed=0）', () => {
        expect(applyBrackets(0, brackets)).toBeCloseTo(0, 4)
    })
    it('支持 fixed 档位（定额）', () => {
        const b2: Bracket[] = [{ upper: 10000, rate: 0, base: 0, start: 0, fixed: 50 }]
        expect(applyBrackets(5000, b2)).toBe(50)
    })
})
