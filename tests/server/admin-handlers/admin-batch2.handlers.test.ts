/**
 * Admin handlers Batch 2（8 个子目录 / 40 文件）
 * asr-tasks / benefits / case-types / mineru-tasks / mineru-tokens /
 * orders / model-providers / redemption-codes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/material/asrTask.service', () => ({
    getAsrTasksService: vi.fn(),
    getAsrTaskByIdService: vi.fn(),
    queryAsrTaskStatusBatchService: vi.fn(),
    queryAsrTaskStatusService: vi.fn(),
    retryAsrTaskService: vi.fn(),
}))
vi.mock('~~/server/services/material/mineruTask.service', () => ({
    getMineruTasksService: vi.fn(),
    getMineruTaskByIdService: vi.fn(),
    queryMineruTaskStatusBatchService: vi.fn(),
    queryMineruTaskStatusService: vi.fn(),
    retryMineruTaskService: vi.fn(),
}))
vi.mock('~~/server/services/material/mineruToken.service', () => ({
    getMineruTokensService: vi.fn(),
    createMineruTokenService: vi.fn(),
    updateMineruTokenService: vi.fn(),
    deleteMineruTokenService: vi.fn(),
    updateMineruTokenStatusService: vi.fn(),
}))
vi.mock('~~/server/services/case/caseType.service', () => ({
    getCaseTypesService: vi.fn(),
    createCaseTypeService: vi.fn(),
    updateCaseTypeService: vi.fn(),
    deleteCaseTypeService: vi.fn(),
    updateCaseTypeStatusService: vi.fn(),
}))
vi.mock('~~/server/services/payment/order.admin.service', () => ({
    findOrdersForAdminService: vi.fn(),
    findOrderForAdminService: vi.fn(),
    cancelOrderForAdminService: vi.fn(),
    exportOrdersService: vi.fn(),
    updateOrderRemarkService: vi.fn(),
}))
vi.mock('~~/server/services/model/modelProviders.dao', () => ({
    findManyModelProvidersDao: vi.fn(),
    findModelProviderByIdDao: vi.fn(),
    findModelProviderByNameDao: vi.fn(),
    createModelProviderDao: vi.fn(),
    updateModelProviderDao: vi.fn(),
    softDeleteModelProviderDao: vi.fn(),
}))
vi.mock('~~/server/services/redemption/redemptionCode.admin.service', () => ({
    getRedemptionCodesAdminService: vi.fn(),
    getRedemptionRecordsAdminService: vi.fn(),
    generateRedemptionCodesService: vi.fn(),
    invalidateRedemptionCodeService: vi.fn(),
    exportRedemptionCodesService: vi.fn(),
}))

;(globalThis as any).prisma = {
    benefits: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
    membershipBenefits: { findMany: vi.fn(async () => []) },
}

import { getAsrTasksService, getAsrTaskByIdService, queryAsrTaskStatusBatchService, queryAsrTaskStatusService, retryAsrTaskService } from '~~/server/services/material/asrTask.service'
import { getMineruTasksService, getMineruTaskByIdService, queryMineruTaskStatusBatchService, queryMineruTaskStatusService, retryMineruTaskService } from '~~/server/services/material/mineruTask.service'
import { getMineruTokensService, createMineruTokenService, updateMineruTokenService, deleteMineruTokenService, updateMineruTokenStatusService } from '~~/server/services/material/mineruToken.service'
import { getCaseTypesService, createCaseTypeService, updateCaseTypeService, deleteCaseTypeService, updateCaseTypeStatusService } from '~~/server/services/case/caseType.service'
import { findOrdersForAdminService, findOrderForAdminService, cancelOrderForAdminService, exportOrdersService, updateOrderRemarkService } from '~~/server/services/payment/order.admin.service'
import { findManyModelProvidersDao, findModelProviderByIdDao, findModelProviderByNameDao, createModelProviderDao, updateModelProviderDao, softDeleteModelProviderDao } from '~~/server/services/model/modelProviders.dao'
import { getRedemptionCodesAdminService, getRedemptionRecordsAdminService, generateRedemptionCodesService, invalidateRedemptionCodeService, exportRedemptionCodesService } from '~~/server/services/redemption/redemptionCode.admin.service'

// ---- ASR Tasks ----
const { default: asrListHandler } = await import('../../../server/api/v1/admin/asr-tasks/index.get')
const { default: asrGetHandler } = await import('../../../server/api/v1/admin/asr-tasks/[id].get')
const { default: asrBatchHandler } = await import('../../../server/api/v1/admin/asr-tasks/query-batch.post')
const { default: asrQueryHandler } = await import('../../../server/api/v1/admin/asr-tasks/query/[id].post')
const { default: asrRetryHandler } = await import('../../../server/api/v1/admin/asr-tasks/retry/[id].post')
// ---- MinerU Tasks ----
const { default: muListHandler } = await import('../../../server/api/v1/admin/mineru-tasks/index.get')
const { default: muGetHandler } = await import('../../../server/api/v1/admin/mineru-tasks/[id].get')
const { default: muBatchHandler } = await import('../../../server/api/v1/admin/mineru-tasks/query-batch.post')
const { default: muQueryHandler } = await import('../../../server/api/v1/admin/mineru-tasks/query/[id].post')
const { default: muRetryHandler } = await import('../../../server/api/v1/admin/mineru-tasks/retry/[id].post')
// ---- MinerU Tokens ----
const { default: mtListHandler } = await import('../../../server/api/v1/admin/mineru-tokens/index.get')
const { default: mtCreateHandler } = await import('../../../server/api/v1/admin/mineru-tokens/index.post')
const { default: mtPutHandler } = await import('../../../server/api/v1/admin/mineru-tokens/[id].put')
const { default: mtDeleteHandler } = await import('../../../server/api/v1/admin/mineru-tokens/[id].delete')
const { default: mtStatusHandler } = await import('../../../server/api/v1/admin/mineru-tokens/status/[id].put')
// ---- Case Types ----
const { default: ctListHandler } = await import('../../../server/api/v1/admin/case-types/index.get')
const { default: ctCreateHandler } = await import('../../../server/api/v1/admin/case-types/index.post')
const { default: ctPutHandler } = await import('../../../server/api/v1/admin/case-types/[id].put')
const { default: ctDeleteHandler } = await import('../../../server/api/v1/admin/case-types/[id].delete')
const { default: ctStatusHandler } = await import('../../../server/api/v1/admin/case-types/status/[id].put')
// ---- Benefits ----
const { default: bListHandler } = await import('../../../server/api/v1/admin/benefits/index.get')
const { default: bCreateHandler } = await import('../../../server/api/v1/admin/benefits/index.post')
const { default: bPutHandler } = await import('../../../server/api/v1/admin/benefits/[id].put')
const { default: bDeleteHandler } = await import('../../../server/api/v1/admin/benefits/[id].delete')
const { default: bStatusHandler } = await import('../../../server/api/v1/admin/benefits/status/[id].put')
// ---- Orders ----
const { default: orderListHandler } = await import('../../../server/api/v1/admin/orders/index.get')
const { default: orderGetHandler } = await import('../../../server/api/v1/admin/orders/[id].get')
const { default: orderCancelHandler } = await import('../../../server/api/v1/admin/orders/cancel/[id].post')
const { default: orderExportHandler } = await import('../../../server/api/v1/admin/orders/export.get')
const { default: orderRemarkHandler } = await import('../../../server/api/v1/admin/orders/remark/[id].patch')
// ---- Model Providers ----
const { default: mpListHandler } = await import('../../../server/api/v1/admin/model-providers/index.get')
const { default: mpGetHandler } = await import('../../../server/api/v1/admin/model-providers/[id].get')
const { default: mpCreateHandler } = await import('../../../server/api/v1/admin/model-providers/index.post')
const { default: mpPutHandler } = await import('../../../server/api/v1/admin/model-providers/[id].put')
const { default: mpDeleteHandler } = await import('../../../server/api/v1/admin/model-providers/[id].delete')
// ---- Redemption Codes ----
const { default: rcListHandler } = await import('../../../server/api/v1/admin/redemption-codes/index.get')
const { default: rcCreateHandler } = await import('../../../server/api/v1/admin/redemption-codes/index.post')
const { default: rcRecordsHandler } = await import('../../../server/api/v1/admin/redemption-codes/records.get')
const { default: rcInvalidateHandler } = await import('../../../server/api/v1/admin/redemption-codes/invalidate/[id].put')
const { default: rcExportHandler } = await import('../../../server/api/v1/admin/redemption-codes/export.get')

beforeEach(() => vi.clearAllMocks())

describe('admin/asr-tasks', () => {
    it('list happy', async () => { ;(getAsrTasksService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await asrListHandler(makeEvent({ query: {} }) as any)) })
    it('list Zod 失败 → 400', async () => { expectError(await asrListHandler(makeEvent({ query: { page: '0' } }) as any), 400) })
    it('get happy', async () => { ;(getAsrTaskByIdService as any).mockResolvedValue({ id: 1 }); expectSuccess(await asrGetHandler(makeEvent({ params: { id: '1' } }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await asrGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(getAsrTaskByIdService as any).mockResolvedValue(null); expectError(await asrGetHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('batch happy', async () => { ;(queryAsrTaskStatusBatchService as any).mockResolvedValue([]); expectSuccess(await asrBatchHandler(makeEvent({ body: { ids: [1] } }) as any)) })
    it('batch Zod 失败 → 400', async () => { expectError(await asrBatchHandler(makeEvent({ body: {} }) as any), 400) })
    it('query happy', async () => { ;(queryAsrTaskStatusService as any).mockResolvedValue({ status: 1 }); expectSuccess(await asrQueryHandler(makeEvent({ params: { id: '1' } }) as any)) })
    it('query id 非法 → 400', async () => { expectError(await asrQueryHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('retry happy', async () => { ;(retryAsrTaskService as any).mockResolvedValue({ id: 1 }); expectSuccess(await asrRetryHandler(makeEvent({ params: { id: '1' } }) as any)) })
    it('retry id 非法 → 400', async () => { expectError(await asrRetryHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
})

describe('admin/mineru-tasks', () => {
    it('list happy', async () => { ;(getMineruTasksService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await muListHandler(makeEvent({ query: {} }) as any)) })
    it('list Zod 失败 → 400', async () => { expectError(await muListHandler(makeEvent({ query: { page: '0' } }) as any), 400) })
    it('get happy', async () => { ;(getMineruTaskByIdService as any).mockResolvedValue({ id: 1 }); expectSuccess(await muGetHandler(makeEvent({ params: { id: '1' } }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await muGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(getMineruTaskByIdService as any).mockResolvedValue(null); expectError(await muGetHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('batch happy', async () => { ;(queryMineruTaskStatusBatchService as any).mockResolvedValue([]); expectSuccess(await muBatchHandler(makeEvent({ body: { ids: [1] } }) as any)) })
    it('batch Zod 失败 → 400', async () => { expectError(await muBatchHandler(makeEvent({ body: {} }) as any), 400) })
    it('query happy', async () => { ;(queryMineruTaskStatusService as any).mockResolvedValue({ status: 1 }); expectSuccess(await muQueryHandler(makeEvent({ params: { id: '1' } }) as any)) })
    it('retry happy', async () => { ;(retryMineruTaskService as any).mockResolvedValue({ id: 1 }); expectSuccess(await muRetryHandler(makeEvent({ params: { id: '1' } }) as any)) })
})

describe('admin/mineru-tokens', () => {
    it('list happy', async () => { ;(getMineruTokensService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await mtListHandler(makeEvent({ query: {} }) as any)) })
    it('list Zod 失败 → 400', async () => { expectError(await mtListHandler(makeEvent({ query: { page: '0' } }) as any), 400) })
    it('create Zod 失败 → 400', async () => { expectError(await mtCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await mtPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await mtDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('status id 非法 → 400', async () => { expectError(await mtStatusHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
})

describe('admin/case-types', () => {
    it('list happy', async () => { ;(getCaseTypesService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await ctListHandler(makeEvent({ query: {} }) as any)) })
    it('create Zod 失败 → 400', async () => { expectError(await ctCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await ctPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await ctDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('status id 非法 → 400', async () => { expectError(await ctStatusHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
})

describe('admin/benefits', () => {
    it('list happy', async () => { ;(globalThis as any).prisma.benefits.findMany.mockResolvedValue([]); expectSuccess(await bListHandler(makeEvent({ query: {} }) as any)) })
    it('create Zod 失败 → 400', async () => { expectError(await bCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await bPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await bDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('status id 非法 → 400', async () => { expectError(await bStatusHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
})

describe('admin/orders', () => {
    it('list happy', async () => { ;(findOrdersForAdminService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await orderListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await orderListHandler(makeEvent({ query: {} }) as any), 401) })
    it('list Zod 失败 → 400', async () => { expectError(await orderListHandler(makeEvent({ userId: 100, query: { page: '0' } }) as any), 400) })
    it('get happy', async () => { ;(findOrderForAdminService as any).mockResolvedValue({ id: 1 }); expectSuccess(await orderGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)) })
    it('get 未登录 → 401', async () => { expectError(await orderGetHandler(makeEvent({ params: { id: '1' } }) as any), 401) })
    it('get id 非法 → 400', async () => { expectError(await orderGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(findOrderForAdminService as any).mockResolvedValue(null); expectError(await orderGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any), 404) })
    it('cancel 未登录 → 401', async () => { expectError(await orderCancelHandler(makeEvent({ params: { id: '1' } }) as any), 401) })
    it('cancel id 非法 → 400', async () => { expectError(await orderCancelHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('export 未登录 → 401', async () => { expectError(await orderExportHandler(makeEvent({ query: {} }) as any), 401) })
    it('remark 未登录 → 401', async () => { expectError(await orderRemarkHandler(makeEvent({ params: { id: '1' }, body: {} }) as any), 401) })
    it('remark id 非法 → 400', async () => { expectError(await orderRemarkHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
})

describe('admin/model-providers', () => {
    it('list happy', async () => { ;(findManyModelProvidersDao as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await mpListHandler(makeEvent({ query: {} }) as any)) })
    it('list Zod 失败 → 400', async () => { expectError(await mpListHandler(makeEvent({ query: { page: '0' } }) as any), 400) })
    it('get id 非法 → 400', async () => { expectError(await mpGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(findModelProviderByIdDao as any).mockResolvedValue(null); expectError(await mpGetHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('create Zod 失败 → 400', async () => { expectError(await mpCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await mpPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await mpDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
})

describe('admin/redemption-codes', () => {
    it('list happy', async () => { ;(getRedemptionCodesAdminService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await rcListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await rcListHandler(makeEvent({ query: {} }) as any), 401) })
    it('create 未登录 → 401', async () => { expectError(await rcCreateHandler(makeEvent({ body: {} }) as any), 401) })
    it('create Zod 失败 → 400', async () => { expectError(await rcCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('records happy', async () => { ;(getRedemptionRecordsAdminService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await rcRecordsHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('records 未登录 → 401', async () => { expectError(await rcRecordsHandler(makeEvent({ query: {} }) as any), 401) })
    it('invalidate 未登录 → 401', async () => { expectError(await rcInvalidateHandler(makeEvent({ params: { id: '1' } }) as any), 401) })
    it('invalidate id 非法 → 400', async () => { expectError(await rcInvalidateHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('export 未登录 → 401', async () => { expectError(await rcExportHandler(makeEvent({ query: {} }) as any), 401) })
})
