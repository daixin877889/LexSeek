/**
 * 加班费和调休时间计算服务测试
 *
 * 测试 calculateOvertimePay, calculateCompensatoryTime 函数
 */
import { describe, it, expect } from 'vitest'
import { calculateOvertimePay, calculateCompensatoryTime } from '#shared/utils/tools/overtimePayService'

describe('calculateOvertimePay', () => {
    it('应正确计算小时工资', () => {
        const result = calculateOvertimePay(5000, 0, 0, 0)
        const expectedHourlyRate = (5000 / (21.75 * 8)).toFixed(2)
        expect(result.hourlyRate).toBe(expectedHourlyRate)
    })

    it('应正确计算工作日加班费', () => {
        const result = calculateOvertimePay(5000, 10, 0, 0)
        const hourlyRate = 5000 / (21.75 * 8)
        const expectedWorkdayPay = hourlyRate * 1.5 * 10
        expect(parseFloat(result.workdayOvertimePay)).toBeCloseTo(expectedWorkdayPay, 2)
    })

    it('应正确计算休息日加班费', () => {
        const result = calculateOvertimePay(5000, 0, 10, 0)
        const hourlyRate = 5000 / (21.75 * 8)
        const expectedWeekendPay = hourlyRate * 2 * 10
        expect(parseFloat(result.weekendOvertimePay)).toBeCloseTo(expectedWeekendPay, 2)
    })

    it('应正确计算法定节假日加班费', () => {
        const result = calculateOvertimePay(5000, 0, 0, 10)
        const hourlyRate = 5000 / (21.75 * 8)
        const expectedHolidayPay = hourlyRate * 3 * 10
        expect(parseFloat(result.holidayOvertimePay)).toBeCloseTo(expectedHolidayPay, 2)
    })

    it('应正确计算总加班费', () => {
        const result = calculateOvertimePay(5000, 10, 10, 10)
        const total = parseFloat(result.workdayOvertimePay) + parseFloat(result.weekendOvertimePay) + parseFloat(result.holidayOvertimePay)
        expect(parseFloat(result.totalOvertimePay)).toBeCloseTo(total, 1)
    })

    it('应包含计算明细', () => {
        const result = calculateOvertimePay(5000, 5, 3, 2)
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('小时工资'))).toBe(true)
    })

    it('无加班时间应返回零', () => {
        const result = calculateOvertimePay(5000, 0, 0, 0)
        expect(parseFloat(result.totalOvertimePay)).toBe(0)
    })

    it('应支持自定义月工作日和每天工作时数', () => {
        const result = calculateOvertimePay(5000, 10, 0, 0, 20, 7)
        const expectedHourlyRate = (5000 / (20 * 7)).toFixed(2)
        expect(result.hourlyRate).toBe(expectedHourlyRate)
    })

    it('明细应包含工作日加班费详情', () => {
        const result = calculateOvertimePay(5000, 10, 0, 0)
        expect(result.details.some(d => d.includes('工作日加班费'))).toBe(true)
    })

    it('明细应包含休息日加班费详情', () => {
        const result = calculateOvertimePay(5000, 0, 10, 0)
        expect(result.details.some(d => d.includes('休息日加班费'))).toBe(true)
    })

    it('明细应包含法定节假日加班费详情', () => {
        const result = calculateOvertimePay(5000, 0, 0, 10)
        expect(result.details.some(d => d.includes('法定节假日加班费'))).toBe(true)
    })
})

describe('calculateCompensatoryTime', () => {
    it('工作日加班应按1:1计算调休', () => {
        const result = calculateCompensatoryTime(10, 0, 0)
        expect(result.workdayCompensatoryHours).toBe(10)
    })

    it('休息日加班应按1:1计算调休', () => {
        const result = calculateCompensatoryTime(0, 10, 0)
        expect(result.weekendCompensatoryHours).toBe(10)
    })

    it('法定节假日加班应按1:3计算调休', () => {
        const result = calculateCompensatoryTime(0, 0, 10)
        expect(result.holidayCompensatoryHours).toBe(30)
    })

    it('应正确计算总调休时间', () => {
        const result = calculateCompensatoryTime(5, 5, 5)
        expect(result.totalCompensatoryHours).toBe(5 + 5 + 15)
    })

    it('应正确计算总调休天数', () => {
        const result = calculateCompensatoryTime(8, 8, 0)
        expect(parseFloat(result.totalCompensatoryDays)).toBeCloseTo(2, 1)
    })

    it('应包含计算明细', () => {
        const result = calculateCompensatoryTime(5, 3, 2)
        expect(result.details.length).toBeGreaterThan(0)
    })

    it('无加班时间应返回零', () => {
        const result = calculateCompensatoryTime(0, 0, 0)
        expect(result.totalCompensatoryHours).toBe(0)
    })

    it('明细应包含工作日调休详情', () => {
        const result = calculateCompensatoryTime(5, 0, 0)
        expect(result.details.some(d => d.includes('工作日加班调休'))).toBe(true)
    })

    it('明细应包含休息日调休详情', () => {
        const result = calculateCompensatoryTime(0, 5, 0)
        expect(result.details.some(d => d.includes('休息日加班调休'))).toBe(true)
    })

    it('明细应包含法定节假日调休详情', () => {
        const result = calculateCompensatoryTime(0, 0, 5)
        expect(result.details.some(d => d.includes('法定节假日加班调休'))).toBe(true)
    })

    it('应支持自定义每天工作时数', () => {
        const result = calculateCompensatoryTime(16, 0, 0, 8)
        expect(parseFloat(result.totalCompensatoryDays)).toBeCloseTo(2, 1)
    })
})
