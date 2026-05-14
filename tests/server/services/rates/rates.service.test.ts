import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    listLPRRatesService,
    createLPRRateService,
    updateLPRRateService,
    deleteLPRRateService,
    listPBOCDepositRatesService,
    listPBOCLoanRatesService,
} from '~~/server/services/rates/rates.service'
import { getLPRRates } from '#shared/utils/tools/data'

describe('rates.service', () => {
    const createdIds: number[] = []
    afterEach(async () => {
        if (createdIds.length > 0) {
            await prisma.lprRates.deleteMany({ where: { id: { in: createdIds } } })
            createdIds.length = 0
        }
    })

    it('listLPRRatesService 应返回 number 类型的字段（不是 Decimal）', async () => {
        const rates = await listLPRRatesService()
        expect(rates.length).toBeGreaterThan(0)
        const first = rates[0]!
        expect(typeof first.oneYear).toBe('number')
        expect(typeof first.fiveYear).toBe('number')
        expect(typeof first.date).toBe('string')
        expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('createLPRRateService 创建后应自动刷新 shared 缓存', async () => {
        const beforeCache = getLPRRates()
        const beforeFirst = beforeCache[0]?.date

        const created = await createLPRRateService({
            effectDate: '2099-12-31',
            oneYear: 9.99,
            fiveYear: 10.99,
            remark: '测试',
        })
        createdIds.push(created.id)

        const afterCache = getLPRRates()
        expect(afterCache[0]?.date).toBe('2099-12-31')
        expect(afterCache[0]?.oneYear).toBe(9.99)
        expect(afterCache[0]?.date).not.toBe(beforeFirst)
    })

    it('updateLPRRateService 应刷新缓存', async () => {
        const created = await createLPRRateService({
            effectDate: '2098-12-31',
            oneYear: 1.11,
            fiveYear: 2.22,
        })
        createdIds.push(created.id)

        await updateLPRRateService(created.id, { oneYear: 1.99 })
        const cache = getLPRRates()
        const target = cache.find((r) => r.date === '2098-12-31')
        expect(target?.oneYear).toBe(1.99)
    })

    it('deleteLPRRateService 应刷新缓存且数据不可见', async () => {
        const created = await createLPRRateService({
            effectDate: '2097-12-31',
            oneYear: 1.0,
            fiveYear: 2.0,
        })
        createdIds.push(created.id)
        await deleteLPRRateService(created.id)
        const cache = getLPRRates()
        expect(cache.find((r) => r.date === '2097-12-31')).toBeUndefined()
    })

    it('listPBOCDepositRatesService + listPBOCLoanRatesService 应能返回 number 字段', async () => {
        const deposit = await listPBOCDepositRatesService()
        expect(deposit.length).toBeGreaterThan(0)
        expect(typeof deposit[0]!.demand).toBe('number')

        const loan = await listPBOCLoanRatesService()
        expect(loan.length).toBeGreaterThan(0)
        expect(typeof loan[0]!.sixMonths).toBe('number')
    })
})
