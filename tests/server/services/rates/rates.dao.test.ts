/**
 * 利率 DAO 单元测试
 *
 * **Feature: rates-data-layer**
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    findAllLPRRatesDAO,
    createLPRRateDAO,
    updateLPRRateDAO,
    softDeleteLPRRateDAO,
    findAllPBOCDepositRatesDAO,
    createPBOCDepositRateDAO,
    updatePBOCDepositRateDAO,
    softDeletePBOCDepositRateDAO,
    findAllPBOCLoanRatesDAO,
    createPBOCLoanRateDAO,
    updatePBOCLoanRateDAO,
    softDeletePBOCLoanRateDAO,
} from '~~/server/services/rates/rates.dao'

describe('rates.dao - LPR', () => {
    const createdIds: number[] = []

    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.lprRates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('findAllLPRRatesDAO 应返回未软删除的所有 LPR，按 effectDate desc 排序', async () => {
        const seedCount = await prisma.lprRates.count({ where: { deletedAt: null } })
        expect(seedCount).toBeGreaterThanOrEqual(72)
        const rates = await findAllLPRRatesDAO()
        expect(rates).toHaveLength(seedCount)
        for (let i = 0; i < rates.length - 1; i++) {
            expect(rates[i]!.effectDate.getTime()).toBeGreaterThanOrEqual(rates[i + 1]!.effectDate.getTime())
        }
    })

    it('createLPRRateDAO 应成功创建一条新 LPR', async () => {
        const date = `2030-01-${String(Date.now() % 28 + 1).padStart(2, '0')}`
        const created = await createLPRRateDAO({
            effectDate: new Date(date),
            oneYear: 2.50,
            fiveYear: 3.00,
            remark: '测试',
        })
        createdIds.push(created.id)
        expect(Number(created.oneYear)).toBe(2.50)
        expect(Number(created.fiveYear)).toBe(3.00)
    })

    it('updateLPRRateDAO 应更新一条 LPR', async () => {
        const created = await createLPRRateDAO({
            effectDate: new Date(`2031-02-${String(Date.now() % 28 + 1).padStart(2, '0')}`),
            oneYear: 2.50, fiveYear: 3.00,
        })
        createdIds.push(created.id)
        const updated = await updateLPRRateDAO(created.id, { oneYear: 2.60, remark: '调整' })
        expect(Number(updated.oneYear)).toBe(2.60)
        expect(updated.remark).toBe('调整')
    })

    it('softDeleteLPRRateDAO 应设置 deletedAt 而非物理删除', async () => {
        const created = await createLPRRateDAO({
            effectDate: new Date(`2032-03-${String(Date.now() % 28 + 1).padStart(2, '0')}`),
            oneYear: 2.50, fiveYear: 3.00,
        })
        createdIds.push(created.id)
        await softDeleteLPRRateDAO(created.id)
        const reloaded = await prisma.lprRates.findUnique({ where: { id: created.id } })
        expect(reloaded?.deletedAt).not.toBeNull()
        const visible = await findAllLPRRatesDAO()
        expect(visible.find((r) => r.id === created.id)).toBeUndefined()
    })
})

describe('rates.dao - PBOC Deposit', () => {
    const createdIds: number[] = []
    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.pbocDepositRates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('createPBOCDepositRateDAO + findAllPBOCDepositRatesDAO + update + softDelete 全链路', async () => {
        const created = await createPBOCDepositRateDAO({
            effectDate: new Date(`2030-04-${String(Date.now() % 28 + 1).padStart(2, '0')}`),
            demand: 0.30, threeMonths: 1.00, sixMonths: 1.20, oneYear: 1.40,
            twoYear: 2.00, threeYear: 2.50, fiveYear: 2.50,
        })
        createdIds.push(created.id)

        const list = await findAllPBOCDepositRatesDAO()
        expect(list.find((r) => r.id === created.id)).toBeTruthy()

        await updatePBOCDepositRateDAO(created.id, { demand: 0.40 })
        const reloaded = await prisma.pbocDepositRates.findUnique({ where: { id: created.id } })
        expect(Number(reloaded!.demand)).toBe(0.40)

        await softDeletePBOCDepositRateDAO(created.id)
        const afterDelete = await findAllPBOCDepositRatesDAO()
        expect(afterDelete.find((r) => r.id === created.id)).toBeUndefined()
    })
})

describe('rates.dao - PBOC Loan', () => {
    const createdIds: number[] = []
    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.pbocLoanRates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('createPBOCLoanRateDAO + findAllPBOCLoanRatesDAO + update + softDelete 全链路', async () => {
        const created = await createPBOCLoanRateDAO({
            effectDate: new Date(`2030-05-${String(Date.now() % 28 + 1).padStart(2, '0')}`),
            sixMonths: 4.00, oneYear: 4.10, oneToFiveYear: 4.40, fiveYear: 4.60,
        })
        createdIds.push(created.id)

        const list = await findAllPBOCLoanRatesDAO()
        expect(list.find((r) => r.id === created.id)).toBeTruthy()

        await updatePBOCLoanRateDAO(created.id, { sixMonths: 4.05 })
        await softDeletePBOCLoanRateDAO(created.id)
        const afterDelete = await findAllPBOCLoanRatesDAO()
        expect(afterDelete.find((r) => r.id === created.id)).toBeUndefined()
    })
})
