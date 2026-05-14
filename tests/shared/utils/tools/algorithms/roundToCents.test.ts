import { describe, it, expect } from 'vitest'
import { roundToCents } from '#shared/utils/tools/algorithms/roundToCents'

describe('roundToCents', () => {
    it('精确小数直接保留两位', () => {
        expect(roundToCents(10.25)).toBe(10.25)
    })

    it('四舍五入到分（入）', () => {
        expect(roundToCents(10.255)).toBe(10.26)
    })

    it('四舍五入到分（舍）', () => {
        expect(roundToCents(10.254)).toBe(10.25)
    })

    it('浮点误差场景：0.1 + 0.2 应精确为 0.30', () => {
        expect(roundToCents(0.1 + 0.2)).toBe(0.30)
    })
})
