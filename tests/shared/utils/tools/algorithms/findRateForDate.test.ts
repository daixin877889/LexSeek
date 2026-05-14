import { describe, it, expect } from 'vitest'
import { findRateForDate } from '#shared/utils/tools/algorithms/findRateForDate'

interface RateEntry {
    date: string
    rate: number
}

describe('findRateForDate', () => {
    // 按 date desc 排序的利率表（最新在前）
    const rates: RateEntry[] = [
        { date: '2024-06-01', rate: 3.5 },
        { date: '2024-01-01', rate: 4.0 },
        { date: '2023-01-01', rate: 4.5 },
    ]

    it('精确匹配生效日期，返回该条', () => {
        const result = findRateForDate(rates, '2024-06-01')
        expect(result).toEqual({ date: '2024-06-01', rate: 3.5 })
    })

    it('目标日期在两条之间，返回最近一条（date <= target）', () => {
        const result = findRateForDate(rates, '2024-03-15')
        expect(result).toEqual({ date: '2024-01-01', rate: 4.0 })
    })

    it('目标日期早于所有利率，返回 null', () => {
        const result = findRateForDate(rates, '2022-12-31')
        expect(result).toBeNull()
    })

    it('目标日期晚于最新利率，返回最新一条', () => {
        const result = findRateForDate(rates, '2025-01-01')
        expect(result).toEqual({ date: '2024-06-01', rate: 3.5 })
    })

    it('target 传 Date 对象同样工作', () => {
        const result = findRateForDate(rates, new Date('2024-03-15'))
        expect(result).toEqual({ date: '2024-01-01', rate: 4.0 })
    })

    it('rates 为空数组时返回 null', () => {
        const result = findRateForDate<RateEntry>([], '2024-01-01')
        expect(result).toBeNull()
    })
})
