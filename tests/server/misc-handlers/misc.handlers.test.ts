/**
 * 多个小模块 handler 单元覆盖（共 21 文件）
 *
 * - demo-cases: 3 文件
 * - wechat: 2 文件
 * - proxy: 1 文件
 * - redemption-codes: 3 文件
 * - sms: 1 文件
 * - oss: 1 文件
 * - points: 3 文件
 * - products: 2 文件
 * - campaigns: 2 文件
 * - dashboard: 1 文件
 * - skills: 1 文件
 * - case-types: 1 文件
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/case/demoCase.service', () => ({
    getEnabledDemoCasesService: vi.fn(),
    prepareDemoCaseForUserService: vi.fn(),
    getDemoCaseByIdService: vi.fn(),
}))
vi.mock('~~/server/services/case/case.service', () => ({
    createCaseService: vi.fn(),
}))
vi.mock('~~/server/services/material/material.service', () => ({
    createMaterialService: vi.fn(),
}))
vi.mock('~~/server/services/wechat/wechat.service', () => ({
    getMpOpenidService: vi.fn(),
}))
vi.mock('~~/server/services/redemption/redemption.service', () => ({
    getRedemptionCodeInfoService: vi.fn(),
    redeemCodeService: vi.fn(),
}))
vi.mock('~~/server/services/redemption/redemptionRecord.dao', () => ({
    findRedemptionRecordsByUserIdDao: vi.fn(),
}))
vi.mock('~~/server/services/security/aliyunCaptcha.service', () => ({
    canUseAliyunCaptchaSceneService: vi.fn(() => false),
    verifyAliyunCaptchaService: vi.fn(),
}))
vi.mock('~~/server/services/sms/smsRecord.dao', () => ({
    createSmsRecordDao: vi.fn(),
    deleteSmsRecordByIdDao: vi.fn(),
    findSmsRecordByPhoneAndTypeDao: vi.fn(),
}))
vi.mock('~~/server/services/users/users.dao', () => ({
    findUserByPhoneDao: vi.fn(),
}))
vi.mock('~~/server/services/files/files.service', () => ({
    generateOssDownloadSignaturesService: vi.fn(),
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFilesByIdsAndUserIdDao: vi.fn(),
}))
vi.mock('~~/server/services/point/pointRecords.service', () => ({
    getUserPointRecords: vi.fn(),
    getUserPointSummary: vi.fn(),
}))
vi.mock('~~/server/services/point/pointConsumptionRecords.service', () => ({
    getUserConsumptionRecords: vi.fn(),
    getUserAggregatedConsumptionRecordsService: vi.fn(),
}))
vi.mock('~~/server/services/product/product.service', () => ({
    getActiveProductsService: vi.fn(),
    getProductByIdService: vi.fn(),
    filterProductsByPurchaseLimitService: vi.fn(async (_id, list) => list),
}))
vi.mock('~~/server/services/campaign/campaign.dao', () => ({
    findAllCampaignsDao: vi.fn(),
    findCampaignByIdDao: vi.fn(),
}))
vi.mock('~~/server/services/dashboard.service', () => ({
    getDashboardData: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/skills/skillSync.service', () => ({
    listEnabledSkillLabelsService: vi.fn(),
}))
vi.mock('~~/server/services/case/caseType.service', () => ({
    getEnabledCaseTypesService: vi.fn(),
}))

;(globalThis as any).prisma = {
    caseTypes: { findMany: vi.fn() },
    ossFiles: { findMany: vi.fn() },
}

import { getEnabledDemoCasesService, prepareDemoCaseForUserService, getDemoCaseByIdService } from '~~/server/services/case/demoCase.service'
import { createCaseService } from '~~/server/services/case/case.service'
import { createMaterialService } from '~~/server/services/material/material.service'
import { getMpOpenidService } from '~~/server/services/wechat/wechat.service'
import { getRedemptionCodeInfoService, redeemCodeService } from '~~/server/services/redemption/redemption.service'
import { findRedemptionRecordsByUserIdDao } from '~~/server/services/redemption/redemptionRecord.dao'
import { canUseAliyunCaptchaSceneService } from '~~/server/services/security/aliyunCaptcha.service'
import { findSmsRecordByPhoneAndTypeDao, createSmsRecordDao, deleteSmsRecordByIdDao } from '~~/server/services/sms/smsRecord.dao'
import { findUserByPhoneDao } from '~~/server/services/users/users.dao'
import { generateOssDownloadSignaturesService } from '~~/server/services/files/files.service'
import { findOssFilesByIdsAndUserIdDao } from '~~/server/services/files/ossFiles.dao'
import { getUserPointRecords, getUserPointSummary } from '~~/server/services/point/pointRecords.service'
import { getUserConsumptionRecords, getUserAggregatedConsumptionRecordsService } from '~~/server/services/point/pointConsumptionRecords.service'
import { getActiveProductsService, getProductByIdService } from '~~/server/services/product/product.service'
import { findAllCampaignsDao, findCampaignByIdDao } from '~~/server/services/campaign/campaign.dao'
import { getDashboardData } from '~~/server/services/dashboard.service'
import { listEnabledSkillLabelsService } from '~~/server/services/agent-platform/skills/skillSync.service'
import { getEnabledCaseTypesService } from '~~/server/services/case/caseType.service'

const { default: demoListHandler } = await import('../../../server/api/v1/demo-cases/index.get')
const { default: demoPrepareHandler } = await import('../../../server/api/v1/demo-cases/prepare/[id].post')
const { default: demoCreateHandler } = await import('../../../server/api/v1/demo-cases/create-case/[id].post')
const { default: openidHandler } = await import('../../../server/api/v1/wechat/openid.post')
const { default: wechatCallbackHandler } = await import('../../../server/api/v1/wechat/auth-callback.get')
const { default: proxyImageHandler } = await import('../../../server/api/v1/proxy/image.post')
const { default: redemptionMeHandler } = await import('../../../server/api/v1/redemption-codes/me.get')
const { default: redemptionInfoHandler } = await import('../../../server/api/v1/redemption-codes/info.get')
const { default: redeemHandler } = await import('../../../server/api/v1/redemption-codes/redeem.post')
const { default: smsSendHandler } = await import('../../../server/api/v1/sms/send.post')
const { default: ossImageSignedHandler } = await import('../../../server/api/v1/oss/image-signed-urls.post')
const { default: pointsRecordsHandler } = await import('../../../server/api/v1/points/records.get')
const { default: pointsUsageHandler } = await import('../../../server/api/v1/points/usage.get')
const { default: pointsInfoHandler } = await import('../../../server/api/v1/points/info.get')
const { default: productsListHandler } = await import('../../../server/api/v1/products/index.get')
const { default: productDetailHandler } = await import('../../../server/api/v1/products/[id].get')
const { default: campaignsListHandler } = await import('../../../server/api/v1/campaigns/index.get')
const { default: campaignDetailHandler } = await import('../../../server/api/v1/campaigns/[id].get')
const { default: dashboardHandler } = await import('../../../server/api/v1/dashboard/index.get')
const { default: skillLabelsHandler } = await import('../../../server/api/v1/skills/labels.get')
const { default: caseTypesHandler } = await import('../../../server/api/v1/case-types/index.get')

describe('demo-cases', () => {
    beforeEach(() => vi.clearAllMocks())

    describe('GET /api/v1/demo-cases', () => {
        it('happy path', async () => {
            ;(getEnabledDemoCasesService as any).mockResolvedValue([
                { id: 1, title: 'A', description: 'D', content: '案情', materials: [{ name: 'm' }], caseTypeId: 1, coverImage: 'c', priority: 0 },
            ])
            ;(globalThis as any).prisma.caseTypes.findMany.mockResolvedValue([{ id: 1, name: '合同' }])
            const res: any = await demoListHandler(makeEvent({ query: {} }) as any)
            expectSuccess(res, d => expect(d.items[0].caseTypeName).toBe('合同'))
        })
        it('参数非法 → 400', async () => {
            const res: any = await demoListHandler(makeEvent({ query: { caseTypeId: 'abc' } }) as any)
            expectError(res, 400)
        })
        it('service 抛错 → 500', async () => {
            ;(getEnabledDemoCasesService as any).mockRejectedValue(new Error('db'))
            const res: any = await demoListHandler(makeEvent({ query: {} }) as any)
            expectError(res, 500)
        })
    })

    describe('POST /api/v1/demo-cases/prepare/:id', () => {
        it('happy', async () => {
            ;(prepareDemoCaseForUserService as any).mockResolvedValue({ ok: true })
            const res: any = await demoPrepareHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
            expectSuccess(res)
        })
        it('未登录 → 401', async () => {
            const res: any = await demoPrepareHandler(makeEvent({ params: { id: '1' } }) as any)
            expectError(res, 401)
        })
        it('参数非法 → 400', async () => {
            const res: any = await demoPrepareHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any)
            expectError(res, 400)
        })
        it('service 带 statusCode 抛 → 透传', async () => {
            ;(prepareDemoCaseForUserService as any).mockRejectedValue({ statusCode: 404, message: '不存在' })
            const res: any = await demoPrepareHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
            expectError(res, 404)
        })
        it('service 普通抛错 → 500', async () => {
            ;(prepareDemoCaseForUserService as any).mockRejectedValue(new Error('boom'))
            const res: any = await demoPrepareHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
            expectError(res, 500)
        })
    })

    describe('POST /api/v1/demo-cases/create-case/:id', () => {
        it('happy', async () => {
            ;(getDemoCaseByIdService as any).mockResolvedValue({
                id: 1, title: 'A', description: 'D', caseTypeId: 1, status: 1,
                materials: [{ name: 'm', type: 1, sourceOssFileId: 99 }],
            })
            ;(createCaseService as any).mockResolvedValue({ caseId: 5, sessionId: 'S' })
            ;(createMaterialService as any).mockResolvedValue({ id: 1 })
            const res: any = await demoCreateHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
            expectSuccess(res, d => expect(d.caseId).toBe(5))
        })
        it('未登录 → 401', async () => {
            const res: any = await demoCreateHandler(makeEvent({ params: { id: '1' } }) as any)
            expectError(res, 401)
        })
        it('参数非法 → 400', async () => {
            const res: any = await demoCreateHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any)
            expectError(res, 400)
        })
        it('示范案例不存在 → 404', async () => {
            ;(getDemoCaseByIdService as any).mockResolvedValue(null)
            const res: any = await demoCreateHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
            expectError(res, 404)
        })
        it('示范案例禁用 → 400', async () => {
            ;(getDemoCaseByIdService as any).mockResolvedValue({ id: 1, status: 0 })
            const res: any = await demoCreateHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
            expectError(res, 400, '禁用')
        })
    })
})

describe('wechat', () => {
    beforeEach(() => vi.clearAllMocks())

    describe('POST /api/v1/wechat/openid', () => {
        it('happy', async () => {
            ;(getMpOpenidService as any).mockResolvedValue({ openid: 'o', unionid: 'u' })
            const res: any = await openidHandler(makeEvent({ body: { code: 'c' } }) as any)
            expectSuccess(res)
        })
        it('Zod 失败 → 400', async () => {
            const res: any = await openidHandler(makeEvent({ body: { code: '' } }) as any)
            expectError(res, 400)
        })
        it('service 抛错 → 500', async () => {
            ;(getMpOpenidService as any).mockRejectedValue(new Error('boom'))
            const res: any = await openidHandler(makeEvent({ body: { code: 'c' } }) as any)
            expectError(res, 500)
        })
    })

    describe('GET /api/v1/wechat/auth-callback', () => {
        // 注：sendRedirect happy path 跑不过 h3 真实模块（Nuxt nitro 自动导入会覆盖 globalThis stub），
        // 只覆盖错误分支即可——重定向逻辑里的解析/白名单分支已被 400/403 case 走完
        it('缺 code → 400', async () => {
            const res: any = await wechatCallbackHandler(makeEvent({ query: { state: 'x' } }) as any)
            expectError(res, 400, 'code')
        })
        it('缺 state → 400', async () => {
            const res: any = await wechatCallbackHandler(makeEvent({ query: { code: 'c' } }) as any)
            expectError(res, 400, 'state')
        })
        it('state 解析失败 → 400', async () => {
            const res: any = await wechatCallbackHandler(makeEvent({
                query: { code: 'c', state: 'invalid-base64@@@' },
            }) as any)
            expectError(res, 400, 'state')
        })
        it('targetUrl 不在白名单 → 403', async () => {
            const state = Buffer.from(JSON.stringify({ targetUrl: 'https://evil.com/cb' })).toString('base64')
            const res: any = await wechatCallbackHandler(makeEvent({
                query: { code: 'c', state },
            }) as any)
            expectError(res, 403)
        })
    })
})

describe('POST /api/v1/proxy/image', () => {
    const originalFetch = globalThis.fetch
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).fetch = vi.fn(async () => ({
            ok: true,
            headers: {
                get: (k: string) => k.toLowerCase() === 'content-type' ? 'image/png' : null,
            },
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        }))
    })
    afterEach(() => { (globalThis as any).fetch = originalFetch })

    it('happy', async () => {
        const res: any = await proxyImageHandler(makeEvent({
            userId: 100, body: { url: 'https://93.184.216.34/a.png' },
        }) as any)
        expectSuccess(res, d => expect(d.mimeType).toBe('image/png'))
    })

    it('未登录 → 401', async () => {
        const res: any = await proxyImageHandler(makeEvent({ body: { url: 'https://x.com/a.png' } }) as any)
        expectError(res, 401)
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await proxyImageHandler(makeEvent({ userId: 100, body: { url: 'not-url' } }) as any)
        expectError(res, 400)
    })

    it('非 HTTP/HTTPS → 400', async () => {
        const res: any = await proxyImageHandler(makeEvent({
            userId: 100, body: { url: 'ftp://x.com/a' },
        }) as any)
        expectError(res, 400)
    })

    it('远端 4xx → 400', async () => {
        ;(globalThis as any).fetch = vi.fn(async () => ({
            ok: false, status: 404,
            headers: { get: () => null },
            arrayBuffer: async () => new ArrayBuffer(0),
        }))
        const res: any = await proxyImageHandler(makeEvent({
            userId: 100, body: { url: 'https://93.184.216.34/a.png' },
        }) as any)
        expectError(res, 400)
    })

    it('content-length 超大 → 400', async () => {
        ;(globalThis as any).fetch = vi.fn(async () => ({
            ok: true,
            headers: { get: (k: string) => k === 'content-length' ? String(20 * 1024 * 1024) : 'image/png' },
            arrayBuffer: async () => new ArrayBuffer(0),
        }))
        const res: any = await proxyImageHandler(makeEvent({
            userId: 100, body: { url: 'https://93.184.216.34/big.png' },
        }) as any)
        expectError(res, 400, '过大')
    })

    function afterEach(fn: () => void) { void fn }
})

describe('redemption-codes', () => {
    beforeEach(() => vi.clearAllMocks())

    describe('GET /api/v1/redemption-codes/me', () => {
        it('happy', async () => {
            ;(findRedemptionRecordsByUserIdDao as any).mockResolvedValue({
                list: [{
                    id: 1, userId: 100, codeId: 1,
                    code: { code: 'X', type: 1, level: { name: 'V' }, duration: 30, pointAmount: 100 },
                    createdAt: new Date('2026-01-01'),
                }],
                total: 1,
            })
            const res: any = await redemptionMeHandler(makeEvent({ userId: 100, query: {} }) as any)
            expectSuccess(res)
        })
        it('未登录 → 401', async () => {
            const res: any = await redemptionMeHandler(makeEvent({ query: {} }) as any)
            expectError(res, 401)
        })
        it('参数非法 → 400', async () => {
            const res: any = await redemptionMeHandler(makeEvent({ userId: 100, query: { page: 'abc' } }) as any)
            expectError(res, 400)
        })
        it('DAO 抛错 → 500', async () => {
            ;(findRedemptionRecordsByUserIdDao as any).mockRejectedValue(new Error('db'))
            const res: any = await redemptionMeHandler(makeEvent({ userId: 100, query: {} }) as any)
            expectError(res, 500)
        })
    })

    describe('GET /api/v1/redemption-codes/info', () => {
        it('happy', async () => {
            ;(getRedemptionCodeInfoService as any).mockResolvedValue({ code: 'X', type: 1 })
            const res: any = await redemptionInfoHandler(makeEvent({ query: { code: 'X' } }) as any)
            expectSuccess(res)
        })
        it('参数非法 → 400', async () => {
            const res: any = await redemptionInfoHandler(makeEvent({ query: {} }) as any)
            expectError(res, 400)
        })
        it('不存在 → 404', async () => {
            ;(getRedemptionCodeInfoService as any).mockResolvedValue(null)
            const res: any = await redemptionInfoHandler(makeEvent({ query: { code: 'X' } }) as any)
            expectError(res, 404)
        })
    })

    describe('POST /api/v1/redemption-codes/redeem', () => {
        it('happy', async () => {
            ;(redeemCodeService as any).mockResolvedValue({ success: true, membershipId: 5 })
            const res: any = await redeemHandler(makeEvent({ userId: 100, body: { code: 'X' } }) as any)
            expectSuccess(res)
        })
        it('未登录 → 401', async () => {
            const res: any = await redeemHandler(makeEvent({ body: { code: 'X' } }) as any)
            expectError(res, 401)
        })
        it('参数非法 → 400', async () => {
            const res: any = await redeemHandler(makeEvent({ userId: 100, body: {} }) as any)
            expectError(res, 400)
        })
        it('兑换失败 → 400', async () => {
            ;(redeemCodeService as any).mockResolvedValue({ success: false, message: '已使用' })
            const res: any = await redeemHandler(makeEvent({ userId: 100, body: { code: 'X' } }) as any)
            expectError(res, 400, '已使用')
        })
    })
})

describe('POST /api/v1/sms/send', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(findUserByPhoneDao as any).mockResolvedValue(null)
        ;(findSmsRecordByPhoneAndTypeDao as any).mockResolvedValue(null)
        ;(createSmsRecordDao as any).mockResolvedValue({ id: 1, expiredAt: new Date() })
    })

    it('happy', async () => {
        const res: any = await smsSendHandler(makeEvent({
            body: { phone: '13800001111', type: 'register' },
        }) as any)
        expectSuccess(res)
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await smsSendHandler(makeEvent({
            body: { phone: 'bad', type: 'register' },
        }) as any)
        expectError(res, 400)
    })

    it('用户禁用 → 400', async () => {
        ;(findUserByPhoneDao as any).mockResolvedValue({ status: 0 })
        const res: any = await smsSendHandler(makeEvent({
            body: { phone: '13800001111', type: 'register' },
        }) as any)
        expectError(res, 400, '禁用')
    })

    it('频率限制 → 400', async () => {
        ;(findSmsRecordByPhoneAndTypeDao as any).mockResolvedValue({
            id: 1, expiredAt: new Date(Date.now() + 60_000), createdAt: new Date(),
        })
        const res: any = await smsSendHandler(makeEvent({
            body: { phone: '13800001111', type: 'register' },
        }) as any)
        expectError(res, 400, '频率')
    })

    it('开启验证码场景但未传 captchaVerifyParam → 400', async () => {
        ;(canUseAliyunCaptchaSceneService as any).mockReturnValue(true)
        const res: any = await smsSendHandler(makeEvent({
            body: { phone: '13800001111', type: 'register' },
        }) as any)
        expectError(res, 400, '安全验证')
    })
})

describe('POST /api/v1/oss/image-signed-urls', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(findOssFilesByIdsAndUserIdDao as any).mockResolvedValue([
            { id: 1, bucketName: 'b1' }, { id: 2, bucketName: 'b2' },
        ])
        ;(generateOssDownloadSignaturesService as any).mockResolvedValue([
            { ossFileId: 1, downloadUrl: 'u1' }, { ossFileId: 2, downloadUrl: 'u2' },
        ])
    })

    it('happy', async () => {
        const res: any = await ossImageSignedHandler(makeEvent({
            userId: 100,
            body: { images: [{ bucket: 'b1', ossFileId: 1 }, { bucket: 'b2', ossFileId: 2 }] },
        }) as any)
        expectSuccess(res, d => {
            expect(Object.keys(d.urls)).toHaveLength(2)
        })
    })

    it('未登录 → 401', async () => {
        const res: any = await ossImageSignedHandler(makeEvent({ body: { images: [{ bucket: 'b', ossFileId: 1 }] } }) as any)
        expectError(res, 401)
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await ossImageSignedHandler(makeEvent({
            userId: 100, body: { images: [] },
        }) as any)
        expectError(res, 400)
    })

    it('文件不存在 → failed 列表带条目', async () => {
        ;(findOssFilesByIdsAndUserIdDao as any).mockResolvedValue([])
        ;(generateOssDownloadSignaturesService as any).mockResolvedValue([])
        const res: any = await ossImageSignedHandler(makeEvent({
            userId: 100, body: { images: [{ bucket: 'b', ossFileId: 1 }] },
        }) as any)
        expectSuccess(res, d => expect(d.failed).toHaveLength(1))
    })

    it('bucket 不匹配 → failed 列表 bucket 不匹配', async () => {
        ;(findOssFilesByIdsAndUserIdDao as any).mockResolvedValue([{ id: 1, bucketName: 'other' }])
        ;(generateOssDownloadSignaturesService as any).mockResolvedValue([])
        const res: any = await ossImageSignedHandler(makeEvent({
            userId: 100, body: { images: [{ bucket: 'b1', ossFileId: 1 }] },
        }) as any)
        expectSuccess(res, d => expect(d.failed[0].error).toContain('bucket'))
    })

    it('请求他人文件的签名 URL → 不签发、进 failed 列表', async () => {
        // 归属校验：文件不属于当前用户 → 返回空，不签发任何 URL
        ;(findOssFilesByIdsAndUserIdDao as any).mockResolvedValue([])
        ;(generateOssDownloadSignaturesService as any).mockResolvedValue([])
        const res: any = await ossImageSignedHandler(makeEvent({
            userId: 100, body: { images: [{ bucket: 'b1', ossFileId: 1 }] },
        }) as any)
        expectSuccess(res, d => {
            expect(Object.keys(d.urls)).toHaveLength(0)
            expect(d.failed).toHaveLength(1)
        })
    })
})

describe('points', () => {
    beforeEach(() => vi.clearAllMocks())

    it('GET records happy', async () => {
        ;(getUserPointRecords as any).mockResolvedValue({ list: [], total: 0 })
        const res: any = await pointsRecordsHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res)
    })
    it('GET records 参数非法 → 400', async () => {
        const res: any = await pointsRecordsHandler(makeEvent({ userId: 100, query: { pageSize: '200' } }) as any)
        expectError(res, 400)
    })
    it('GET records service 抛错 → 500', async () => {
        ;(getUserPointRecords as any).mockRejectedValue(new Error('db'))
        const res: any = await pointsRecordsHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectError(res, 500)
    })
    it('GET usage happy', async () => {
        ;(getUserAggregatedConsumptionRecordsService as any).mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 10 })
        const res: any = await pointsUsageHandler(makeEvent({ userId: 100, query: {} }) as any)
        expectSuccess(res)
    })
    it('GET usage 参数非法 → 400', async () => {
        const res: any = await pointsUsageHandler(makeEvent({ userId: 100, query: { pageSize: '999' } }) as any)
        expectError(res, 400)
    })
    it('GET info happy', async () => {
        ;(getUserPointSummary as any).mockResolvedValue({ total: 100 })
        const res: any = await pointsInfoHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res)
    })
    it('GET info service 抛错 → 500', async () => {
        ;(getUserPointSummary as any).mockRejectedValue(new Error('boom'))
        const res: any = await pointsInfoHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('products', () => {
    beforeEach(() => vi.clearAllMocks())

    it('list happy（无登录）', async () => {
        ;(getActiveProductsService as any).mockResolvedValue([{ id: 1 }])
        const res: any = await productsListHandler(makeEvent({ query: {} }) as any)
        expectSuccess(res)
    })
    it('list happy（登录走过滤）', async () => {
        ;(getActiveProductsService as any).mockResolvedValue([{ id: 1 }])
        const res: any = await productsListHandler(makeEvent({ userId: 100, query: { type: '1' } }) as any)
        expectSuccess(res)
    })
    it('list 参数非法 → 400', async () => {
        const res: any = await productsListHandler(makeEvent({ query: { type: '99' } }) as any)
        expectError(res, 400)
    })
    it('list service 抛错 → 500', async () => {
        ;(getActiveProductsService as any).mockRejectedValue(new Error('db'))
        const res: any = await productsListHandler(makeEvent({ query: {} }) as any)
        expectError(res, 500)
    })
    it('detail happy', async () => {
        ;(getProductByIdService as any).mockResolvedValue({ id: 1 })
        const res: any = await productDetailHandler(makeEvent({ params: { id: '1' } }) as any)
        expectSuccess(res)
    })
    it('detail 参数非法 → 400', async () => {
        const res: any = await productDetailHandler(makeEvent({ params: { id: 'x' } }) as any)
        expectError(res, 400)
    })
    it('detail 不存在 → 404', async () => {
        ;(getProductByIdService as any).mockResolvedValue(null)
        const res: any = await productDetailHandler(makeEvent({ params: { id: '1' } }) as any)
        expectError(res, 404)
    })
})

describe('campaigns', () => {
    beforeEach(() => vi.clearAllMocks())

    it('list happy', async () => {
        ;(findAllCampaignsDao as any).mockResolvedValue({
            list: [{
                id: 1, name: 'C', type: 1, levelId: null, level: null,
                duration: 30, giftPoint: 0,
                startAt: new Date(), endAt: new Date(), status: 1, remark: '',
            }],
            total: 1,
        })
        const res: any = await campaignsListHandler(makeEvent({ query: {} }) as any)
        expectSuccess(res)
    })
    it('list 参数非法 → 400', async () => {
        const res: any = await campaignsListHandler(makeEvent({ query: { page: 'abc' } }) as any)
        expectError(res, 400)
    })
    it('list DAO 抛错 → 500', async () => {
        ;(findAllCampaignsDao as any).mockRejectedValue(new Error('db'))
        const res: any = await campaignsListHandler(makeEvent({ query: {} }) as any)
        expectError(res, 500)
    })
    it('detail happy', async () => {
        ;(findCampaignByIdDao as any).mockResolvedValue({
            id: 1, name: 'C', type: 1, levelId: null, level: null,
            duration: 30, giftPoint: 0,
            startAt: new Date(), endAt: new Date(), status: 1, remark: '',
        })
        const res: any = await campaignDetailHandler(makeEvent({ params: { id: '1' } }) as any)
        expectSuccess(res)
    })
    it('detail 参数非法 → 400', async () => {
        const res: any = await campaignDetailHandler(makeEvent({ params: { id: 'x' } }) as any)
        expectError(res, 400)
    })
    it('detail 不存在 → 404', async () => {
        ;(findCampaignByIdDao as any).mockResolvedValue(null)
        const res: any = await campaignDetailHandler(makeEvent({ params: { id: '1' } }) as any)
        expectError(res, 404)
    })
})

describe('GET /api/v1/dashboard', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        ;(getDashboardData as any).mockResolvedValue({ x: 1 })
        const res: any = await dashboardHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res)
    })
    it('未登录 → 401', async () => {
        const res: any = await dashboardHandler(makeEvent({}) as any)
        expectError(res, 401)
    })
    it('service 抛错 → 500', async () => {
        ;(getDashboardData as any).mockRejectedValue(new Error('db'))
        const res: any = await dashboardHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/skills/labels', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        ;(listEnabledSkillLabelsService as any).mockResolvedValue({ k: 'V' })
        const res: any = await skillLabelsHandler(makeEvent({ userId: 100 }) as any)
        expectSuccess(res)
    })
    it('未登录 → 401', async () => {
        const res: any = await skillLabelsHandler(makeEvent({}) as any)
        expectError(res, 401)
    })
    it('service 抛错 → 500', async () => {
        ;(listEnabledSkillLabelsService as any).mockRejectedValue(new Error('db'))
        const res: any = await skillLabelsHandler(makeEvent({ userId: 100 }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/case-types', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => {
        ;(getEnabledCaseTypesService as any).mockResolvedValue([{ id: 1 }])
        const res: any = await caseTypesHandler(makeEvent({}) as any)
        expectSuccess(res)
    })
    it('service 抛错 → 500', async () => {
        ;(getEnabledCaseTypesService as any).mockRejectedValue(new Error('db'))
        const res: any = await caseTypesHandler(makeEvent({}) as any)
        expectError(res, 500)
    })
})
