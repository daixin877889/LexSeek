/**
 * 赔偿金计算服务测试
 *
 * 测试 calculateWorkInjuryCompensation, calculateTrafficAccidentCompensation, calculateDeathCompensation
 */
import { describe, it, expect } from 'vitest'
import {
    calculateWorkInjuryCompensation,
    calculateTrafficAccidentCompensation,
    calculateDeathCompensation
} from '#shared/utils/tools/compensationService'

describe('calculateWorkInjuryCompensation', () => {
    it('应正确计算工伤赔偿金', () => {
        const result = calculateWorkInjuryCompensation(5000, 1, 1000, 500, 200)
        expect(result.disabilityCompensation).toBe(5000 * 27)
        expect(result.medicalExpenses).toBe(1000)
        expect(result.nursingExpenses).toBe(500)
        expect(result.nutritionExpenses).toBe(200)
        expect(result.totalCompensation).toBe(
            5000 * 27 + 1000 + 500 + 200
        )
    })

    it('各伤残等级应有不同系数', () => {
        const salary = 5000
        const coefficients = [27, 25, 23, 21, 18, 16, 13, 11, 9, 7]
        for (let level = 1; level <= 10; level++) {
            const result = calculateWorkInjuryCompensation(salary, level)
            expect(result.disabilityCompensation).toBe(salary * coefficients[level - 1])
        }
    })

    it('未知伤残等级系数为0', () => {
        const result = calculateWorkInjuryCompensation(5000, 99)
        expect(result.disabilityCompensation).toBe(0)
    })

    it('应包含计算明细', () => {
        const result = calculateWorkInjuryCompensation(5000, 5)
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('伤残等级：5级'))).toBe(true)
    })

    it('默认参数应为0', () => {
        const result = calculateWorkInjuryCompensation(5000, 3)
        expect(result.medicalExpenses).toBe(0)
        expect(result.nursingExpenses).toBe(0)
        expect(result.nutritionExpenses).toBe(0)
    })
})

describe('calculateTrafficAccidentCompensation', () => {
    it('应正确计算交通事故赔偿金', () => {
        const result = calculateTrafficAccidentCompensation(5000, 30000, 2000, 10000, 500, 200, 300, 5000)
        expect(result.totalCompensation).toBe(
            5000 + 30000 + 2000 + 10000 + 500 + 200 + 300 + 5000
        )
    })

    it('所有参数默认为0', () => {
        const result = calculateTrafficAccidentCompensation()
        expect(result.totalCompensation).toBe(0)
    })

    it('应包含各项明细', () => {
        const result = calculateTrafficAccidentCompensation(1000, 5000, 300, 2000, 100, 50, 100, 2000)
        expect(result.medicalExpenses).toBe(1000)
        expect(result.disabilityCompensation).toBe(5000)
        expect(result.nursingExpenses).toBe(300)
        expect(result.lostIncome).toBe(2000)
        expect(result.nutritionExpenses).toBe(100)
        expect(result.transportationExpenses).toBe(50)
        expect(result.accommodationExpenses).toBe(100)
        expect(result.propertyLoss).toBe(2000)
    })

    it('应包含计算明细', () => {
        const result = calculateTrafficAccidentCompensation(1000, 5000)
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('医疗费用：1000元'))).toBe(true)
    })
})

describe('calculateDeathCompensation', () => {
    it('应正确计算死亡赔偿金', () => {
        const result = calculateDeathCompensation(50000, 20, 30000, 50000, 20000)
        expect(result.deathCompensation).toBe(50000 * 20)
        expect(result.funeralExpenses).toBe(30000)
        expect(result.dependentCompensation).toBe(50000)
        expect(result.emotionalDamages).toBe(20000)
        expect(result.totalCompensation).toBe(
            50000 * 20 + 30000 + 50000 + 20000
        )
    })

    it('默认赔偿年限应为20年', () => {
        const result = calculateDeathCompensation(50000)
        expect(result.deathCompensation).toBe(50000 * 20)
    })

    it('默认额外费用应为0', () => {
        const result = calculateDeathCompensation(50000)
        expect(result.funeralExpenses).toBe(0)
        expect(result.dependentCompensation).toBe(0)
        expect(result.emotionalDamages).toBe(0)
    })

    it('应包含计算明细', () => {
        const result = calculateDeathCompensation(50000, 20, 30000)
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('年收入：50000元'))).toBe(true)
        expect(result.details.some(d => d.includes('赔偿年限：20年'))).toBe(true)
    })
})
