/**
 * 社保追缴计算服务测试
 *
 * 测试 calculateSocialInsuranceBackpay 函数
 */
import { describe, it, expect } from 'vitest'
import { calculateSocialInsuranceBackpay } from '#shared/utils/tools/socialInsuranceService'

describe('calculateSocialInsuranceBackpay', () => {
    it('应正确计算养老保险个人缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employeePart.pension).toBe(5000 * 0.08 * 12)
    })

    it('应正确计算医疗保险个人缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employeePart.medical).toBe(5000 * 0.02 * 12)
    })

    it('应正确计算失业保险个人缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employeePart.unemployment).toBe(5000 * 0.005 * 12)
    })

    it('应正确计算工伤保险个人缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employeePart.injury).toBe(0)
    })

    it('应正确计算生育保险个人缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employeePart.maternity).toBe(0)
    })

    it('应正确计算住房公积金个人缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employeePart.housing).toBe(5000 * 0.07 * 12)
    })

    it('应正确计算个人缴纳总额', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employeePart.total).toBe(
            result.employeePart.pension +
            result.employeePart.medical +
            result.employeePart.unemployment +
            result.employeePart.injury +
            result.employeePart.maternity +
            result.employeePart.housing
        )
    })

    it('应正确计算养老保险单位缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employerPart.pension).toBe(5000 * 0.16 * 12)
    })

    it('应正确计算医疗保险单位缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employerPart.medical).toBe(5000 * 0.08 * 12)
    })

    it('应正确计算失业保险单位缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employerPart.unemployment).toBe(5000 * 0.015 * 12)
    })

    it('应正确计算工伤保险单位缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employerPart.injury).toBe(5000 * 0.005 * 12)
    })

    it('应正确计算生育保险单位缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employerPart.maternity).toBe(5000 * 0.01 * 12)
    })

    it('应正确计算住房公积金单位缴纳部分', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employerPart.housing).toBe(5000 * 0.07 * 12)
    })

    it('应正确计算单位缴纳总额', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.employerPart.total).toBe(
            result.employerPart.pension +
            result.employerPart.medical +
            result.employerPart.unemployment +
            result.employerPart.injury +
            result.employerPart.maternity +
            result.employerPart.housing
        )
    })

    it('包含单位部分时应返回个人加单位总额', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12, {}, true)
        expect(result.totalBackpay).toBe(result.employeePart.total + result.employerPart.total)
    })

    it('不包含单位部分时应只返回个人总额', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12, {}, false)
        expect(result.totalBackpay).toBe(result.employeePart.total)
    })

    it('应使用自定义缴费比例', () => {
        const customRates = {
            pension: { employee: 0.1, employer: 0.2 }
        }
        const result = calculateSocialInsuranceBackpay(5000, 12, customRates, false)
        expect(result.employeePart.pension).toBe(5000 * 0.1 * 12)
        expect(result.employerPart.pension).toBe(5000 * 0.2 * 12)
    })

    it('应合并自定义和默认缴费比例', () => {
        const customRates = {
            medical: { employee: 0.03, employer: 0.1 }
        }
        const result = calculateSocialInsuranceBackpay(5000, 12, customRates, false)
        expect(result.employeePart.medical).toBe(5000 * 0.03 * 12)
        expect(result.employeePart.pension).toBe(5000 * 0.08 * 12)
    })

    it('应包含详细计算明细', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.details.length).toBeGreaterThan(0)
        expect(result.details.some(d => d.includes('月工资'))).toBe(true)
        expect(result.details.some(d => d.includes('追缴月数'))).toBe(true)
    })

    it('明细应包含个人缴纳明细', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12)
        expect(result.details.some(d => d.includes('个人缴纳部分'))).toBe(true)
        expect(result.details.some(d => d.includes('养老保险'))).toBe(true)
        expect(result.details.some(d => d.includes('医疗保险'))).toBe(true)
        expect(result.details.some(d => d.includes('失业保险'))).toBe(true)
        expect(result.details.some(d => d.includes('住房公积金'))).toBe(true)
    })

    it('包含单位部分时明细应包含单位缴纳明细', () => {
        const result = calculateSocialInsuranceBackpay(5000, 12, {}, true)
        expect(result.details.some(d => d.includes('单位缴纳部分'))).toBe(true)
    })

    it('追缴月数为1应正确计算', () => {
        const result = calculateSocialInsuranceBackpay(5000, 1)
        expect(result.employeePart.total).toBeCloseTo(5000 * (0.08 + 0.02 + 0.005 + 0 + 0 + 0.07) * 1, 2)
    })

    it('月工资为0应返回零', () => {
        const result = calculateSocialInsuranceBackpay(0, 12)
        expect(result.totalBackpay).toBe(0)
    })
})
