import { describe, it, expect, vi } from 'vitest'
import '../../../server/_helpers/handler-test'
import lprHandler from '~~/server/api/v1/tools/rates/lpr.get'
import depositHandler from '~~/server/api/v1/tools/rates/pboc-deposit.get'
import loanHandler from '~~/server/api/v1/tools/rates/pboc-loan.get'

vi.mock('~~/server/services/rates/rates.service', () => ({
    listLPRRatesService: vi.fn().mockResolvedValue([
        { date: '2024-01-01', oneYear: 3.45, fiveYear: 3.95 },
    ]),
    listPBOCDepositRatesService: vi.fn().mockResolvedValue([
        { date: '2024-01-01', demand: 0.2, threeMonths: 1.0, sixMonths: 1.3, oneYear: 1.5, twoYear: 2.0, threeYear: 2.25, fiveYear: 2.25 },
    ]),
    listPBOCLoanRatesService: vi.fn().mockResolvedValue([
        { date: '2024-01-01', sixMonths: 4.35, oneYear: 4.35, oneToFiveYear: 4.75, fiveYear: 4.9 },
    ]),
}))

function buildEvent() {
    return { context: { auth: { user: { id: 'test-user-id' } } } } as any
}

describe('GET /api/v1/tools/rates/*', () => {
    it('lpr.get 返回 success + 包含 LPR 列表', async () => {
        const res: any = await lprHandler(buildEvent())
        expect(res.code).toBe(0)
        expect(Array.isArray(res.data)).toBe(true)
        expect(res.data.length).toBeGreaterThan(0)
        expect(typeof res.data[0].oneYear).toBe('number')
    })
    it('pboc-deposit.get 返回 success + 包含 deposit 列表', async () => {
        const res: any = await depositHandler(buildEvent())
        expect(res.code).toBe(0)
        expect(Array.isArray(res.data)).toBe(true)
    })
    it('pboc-loan.get 返回 success + 包含 loan 列表', async () => {
        const res: any = await loanHandler(buildEvent())
        expect(res.code).toBe(0)
        expect(Array.isArray(res.data)).toBe(true)
    })
    it('未登录时 lpr.get 返回 401', async () => {
        const res: any = await lprHandler({ context: {} } as any)
        expect(res.code).toBe(401)
    })
})
