/**
 * Admin handlers Batch 3（7 个子目录 / 42 文件）
 * campaigns / demo-cases / document-templates / legal-main / model-api-keys /
 * models / products
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/campaign/campaign.service', () => ({
    getCampaignsForAdminService: vi.fn(),
    getCampaignByIdService: vi.fn(),
    createCampaignService: vi.fn(),
    updateCampaignService: vi.fn(),
    deleteCampaignService: vi.fn(),
    updateCampaignStatusService: vi.fn(),
}))
vi.mock('~~/server/services/case/demoCase.service', () => ({
    getDemoCasesService: vi.fn(),
    getDemoCaseByIdService: vi.fn(),
    createDemoCaseService: vi.fn(),
    updateDemoCaseService: vi.fn(),
    deleteDemoCaseService: vi.fn(),
    updateDemoCaseStatusService: vi.fn(),
    ensureSourceFileRecognitionService: vi.fn(),
}))
vi.mock('~~/server/services/assistant/document/documentTemplate.service', () => ({
    createDocumentTemplateService: vi.fn(),
}))
vi.mock('~~/server/services/assistant/document/documentTemplate.dao', () => ({
    listDocumentTemplatesDAO: vi.fn(),
    getDocumentTemplateDAO: vi.fn(),
    updateDocumentTemplateDAO: vi.fn(),
    softDeleteDocumentTemplateDAO: vi.fn(),
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    findOssFileByIdsDao: vi.fn(),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn(async () => 'https://signed.url'),
}))
vi.mock('~~/server/services/legal/legalMain.service', () => ({
    getLegalMainListService: vi.fn(),
    getLegalMainDetailService: vi.fn(),
    createLegalMainService: vi.fn(),
    updateLegalMainService: vi.fn(),
    deleteLegalMainService: vi.fn(),
    getLegalStatisticsService: vi.fn(),
}))
vi.mock('~~/server/services/retrieval/intentClassifier.service', () => ({
    invalidateIntentCacheService: vi.fn(),
}))
vi.mock('~~/server/services/model/modelApiKeys.dao', () => ({
    findManyModelApiKeysDao: vi.fn(),
    findModelApiKeyByIdDao: vi.fn(),
    createModelApiKeyDao: vi.fn(),
    updateModelApiKeyDao: vi.fn(),
    softDeleteModelApiKeyDao: vi.fn(),
    setDefaultModelApiKeyDao: vi.fn(),
}))
vi.mock('~~/server/services/model/modelProviders.dao', () => ({
    findModelProviderByIdDao: vi.fn(),
}))
vi.mock('~~/server/services/model/models.service', () => ({
    getModelsService: vi.fn(),
    getModelByIdService: vi.fn(),
    createModelService: vi.fn(),
    updateModelService: vi.fn(),
    deleteModelService: vi.fn(),
    setDefaultModelService: vi.fn(),
}))
vi.mock('~~/server/services/product/product.service', () => ({
    getProductsForAdminService: vi.fn(),
    getProductByIdService: vi.fn(),
    createProductService: vi.fn(),
    updateProductService: vi.fn(),
    deleteProductService: vi.fn(),
    updateProductStatusService: vi.fn(),
}))

import { getCampaignsForAdminService, getCampaignByIdService, createCampaignService, updateCampaignService, deleteCampaignService, updateCampaignStatusService } from '~~/server/services/campaign/campaign.service'
import { getDemoCasesService, getDemoCaseByIdService, createDemoCaseService, updateDemoCaseService, deleteDemoCaseService, updateDemoCaseStatusService } from '~~/server/services/case/demoCase.service'
import { listDocumentTemplatesDAO, getDocumentTemplateDAO, updateDocumentTemplateDAO, softDeleteDocumentTemplateDAO } from '~~/server/services/assistant/document/documentTemplate.dao'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { getLegalMainListService, getLegalMainDetailService, createLegalMainService, updateLegalMainService, deleteLegalMainService, getLegalStatisticsService } from '~~/server/services/legal/legalMain.service'
import { findManyModelApiKeysDao, findModelApiKeyByIdDao, createModelApiKeyDao, updateModelApiKeyDao, softDeleteModelApiKeyDao, setDefaultModelApiKeyDao } from '~~/server/services/model/modelApiKeys.dao'
import { findModelProviderByIdDao } from '~~/server/services/model/modelProviders.dao'
import { getModelsService, getModelByIdService, createModelService, updateModelService, deleteModelService, setDefaultModelService } from '~~/server/services/model/models.service'
import { getProductsForAdminService, getProductByIdService, createProductService, updateProductService, deleteProductService, updateProductStatusService } from '~~/server/services/product/product.service'

// campaigns
const { default: campListHandler } = await import('../../../server/api/v1/admin/campaigns/index.get')
const { default: campCreateHandler } = await import('../../../server/api/v1/admin/campaigns/index.post')
const { default: campGetHandler } = await import('../../../server/api/v1/admin/campaigns/[id].get')
const { default: campPutHandler } = await import('../../../server/api/v1/admin/campaigns/[id].put')
const { default: campDeleteHandler } = await import('../../../server/api/v1/admin/campaigns/[id].delete')
const { default: campStatusHandler } = await import('../../../server/api/v1/admin/campaigns/status/[id].patch')
// demo-cases
const { default: dcListHandler } = await import('../../../server/api/v1/admin/demo-cases/index.get')
const { default: dcGetHandler } = await import('../../../server/api/v1/admin/demo-cases/[id].get')
const { default: dcCreateHandler } = await import('../../../server/api/v1/admin/demo-cases/index.post')
const { default: dcPutHandler } = await import('../../../server/api/v1/admin/demo-cases/[id].put')
const { default: dcDeleteHandler } = await import('../../../server/api/v1/admin/demo-cases/[id].delete')
const { default: dcStatusHandler } = await import('../../../server/api/v1/admin/demo-cases/status/[id].put')
// document-templates
const { default: dtListHandler } = await import('../../../server/api/v1/admin/document-templates/index.get')
const { default: dtGetHandler } = await import('../../../server/api/v1/admin/document-templates/[id].get')
const { default: dtCreateHandler } = await import('../../../server/api/v1/admin/document-templates/index.post')
const { default: dtPatchHandler } = await import('../../../server/api/v1/admin/document-templates/[id].patch')
const { default: dtDeleteHandler } = await import('../../../server/api/v1/admin/document-templates/[id].delete')
const { default: dtDownloadHandler } = await import('../../../server/api/v1/admin/document-templates/download-url/[id].get')
// legal-main
const { default: lmListHandler } = await import('../../../server/api/v1/admin/legal-main/index.get')
const { default: lmGetHandler } = await import('../../../server/api/v1/admin/legal-main/[id].get')
const { default: lmCreateHandler } = await import('../../../server/api/v1/admin/legal-main/index.post')
const { default: lmPutHandler } = await import('../../../server/api/v1/admin/legal-main/[id].put')
const { default: lmDeleteHandler } = await import('../../../server/api/v1/admin/legal-main/[id].delete')
const { default: lmStatsHandler } = await import('../../../server/api/v1/admin/legal-main/statistics/[id].get')
// model-api-keys
const { default: makListHandler } = await import('../../../server/api/v1/admin/model-api-keys/index.get')
const { default: makGetHandler } = await import('../../../server/api/v1/admin/model-api-keys/[id].get')
const { default: makCreateHandler } = await import('../../../server/api/v1/admin/model-api-keys/index.post')
const { default: makPutHandler } = await import('../../../server/api/v1/admin/model-api-keys/[id].put')
const { default: makDeleteHandler } = await import('../../../server/api/v1/admin/model-api-keys/[id].delete')
const { default: makDefaultHandler } = await import('../../../server/api/v1/admin/model-api-keys/default/[id].put')
// models
const { default: mListHandler } = await import('../../../server/api/v1/admin/models/index.get')
const { default: mGetHandler } = await import('../../../server/api/v1/admin/models/[id].get')
const { default: mCreateHandler } = await import('../../../server/api/v1/admin/models/index.post')
const { default: mPutHandler } = await import('../../../server/api/v1/admin/models/[id].put')
const { default: mDeleteHandler } = await import('../../../server/api/v1/admin/models/[id].delete')
const { default: mDefaultHandler } = await import('../../../server/api/v1/admin/models/default/[id].put')
// products
const { default: pListHandler } = await import('../../../server/api/v1/admin/products/index.get')
const { default: pGetHandler } = await import('../../../server/api/v1/admin/products/[id].get')
const { default: pCreateHandler } = await import('../../../server/api/v1/admin/products/index.post')
const { default: pPutHandler } = await import('../../../server/api/v1/admin/products/[id].put')
const { default: pDeleteHandler } = await import('../../../server/api/v1/admin/products/[id].delete')
const { default: pStatusHandler } = await import('../../../server/api/v1/admin/products/status/[id].patch')

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => vi.clearAllMocks())

describe('admin/campaigns', () => {
    it('list happy', async () => { ;(getCampaignsForAdminService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await campListHandler(makeEvent({ query: {} }) as any)) })
    it('list Zod 失败 → 400', async () => { expectError(await campListHandler(makeEvent({ query: { page: '0' } }) as any), 400) })
    it('get id 非法 → 400', async () => { expectError(await campGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(getCampaignByIdService as any).mockResolvedValue(null); expectError(await campGetHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('create Zod 失败 → 400', async () => { expectError(await campCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await campPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await campDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('status id 非法 → 400', async () => { expectError(await campStatusHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
})

describe('admin/demo-cases', () => {
    it('list happy', async () => { ;(getDemoCasesService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await dcListHandler(makeEvent({ query: {} }) as any)) })
    it('list Zod 失败 → 400', async () => { expectError(await dcListHandler(makeEvent({ query: { page: '0' } }) as any), 400) })
    it('get id 非法 → 400', async () => { expectError(await dcGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(getDemoCaseByIdService as any).mockResolvedValue(null); expectError(await dcGetHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('create Zod 失败 → 400', async () => { expectError(await dcCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await dcPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await dcDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('status id 非法 → 400', async () => { expectError(await dcStatusHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
})

describe('admin/document-templates', () => {
    it('list happy', async () => { ;(listDocumentTemplatesDAO as any).mockResolvedValue({ items: [], total: 0 }); expectSuccess(await dtListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await dtListHandler(makeEvent({ query: {} }) as any), 401) })
    it('get 未登录 → 401', async () => { expectError(await dtGetHandler(makeEvent({ params: { id: '1' } }) as any), 401) })
    it('get id 非法 → 400', async () => { expectError(await dtGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(getDocumentTemplateDAO as any).mockResolvedValue(null); expectError(await dtGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any), 404) })
    it('create 未登录 → 401', async () => { expectError(await dtCreateHandler(makeEvent({}) as any), 401) })
    it('create 缺 formData → 400', async () => { expectError(await dtCreateHandler(makeEvent({ userId: 100 }) as any), 400) })
    it('patch 未登录 → 401', async () => { expectError(await dtPatchHandler(makeEvent({ params: { id: '1' }, body: {} }) as any), 401) })
    it('patch id 非法 → 400', async () => { expectError(await dtPatchHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
    it('patch 不存在 → 404', async () => { ;(getDocumentTemplateDAO as any).mockResolvedValue(null); expectError(await dtPatchHandler(makeEvent({ userId: 100, params: { id: '1' }, body: {} }) as any), 404) })
    it('patch 私人模板 → 403', async () => { ;(getDocumentTemplateDAO as any).mockResolvedValue({ id: 1, scope: 'user' }); expectError(await dtPatchHandler(makeEvent({ userId: 100, params: { id: '1' }, body: {} }) as any), 403) })
    it('delete 未登录 → 401', async () => { expectError(await dtDeleteHandler(makeEvent({ params: { id: '1' } }) as any), 401) })
    it('delete id 非法 → 400', async () => { expectError(await dtDeleteHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('download 未登录 → 401', async () => { expectError(await dtDownloadHandler(makeEvent({ params: { id: '1' } }) as any), 401) })
    it('download id 非法 → 400', async () => { expectError(await dtDownloadHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('download 模板不存在 → 404', async () => { ;(getDocumentTemplateDAO as any).mockResolvedValue(null); expectError(await dtDownloadHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any), 404) })
})

describe('admin/legal-main', () => {
    it('list happy', async () => { ;(getLegalMainListService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await lmListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await lmListHandler(makeEvent({ query: {} }) as any), 401) })
    it('get 不存在 → 404', async () => { ;(getLegalMainDetailService as any).mockResolvedValue(null); expectError(await lmGetHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any), 404) })
    it('create 未登录 → 401', async () => { expectError(await lmCreateHandler(makeEvent({ body: {} }) as any), 401) })
    it('create Zod 失败 → 400', async () => { expectError(await lmCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('put 未登录 → 401', async () => { expectError(await lmPutHandler(makeEvent({ params: { id: VALID_UUID }, body: {} }) as any), 401) })
    it('delete happy', async () => { ;(deleteLegalMainService as any).mockResolvedValue(undefined); expectSuccess(await lmDeleteHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any)) })
    it('stats happy', async () => { ;(getLegalStatisticsService as any).mockResolvedValue({}); expectSuccess(await lmStatsHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any)) })
    it('stats 不存在 → 404', async () => { ;(getLegalStatisticsService as any).mockResolvedValue(null); expectError(await lmStatsHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any), 404) })
})

describe('admin/model-api-keys', () => {
    it('list happy', async () => { ;(findManyModelApiKeysDao as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await makListHandler(makeEvent({ query: {} }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await makGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(findModelApiKeyByIdDao as any).mockResolvedValue(null); expectError(await makGetHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('create Zod 失败 → 400', async () => { expectError(await makCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await makPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await makDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('default id 非法 → 400', async () => { expectError(await makDefaultHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
})

describe('admin/models', () => {
    it('list happy', async () => { ;(getModelsService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await mListHandler(makeEvent({ query: {} }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await mGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(getModelByIdService as any).mockResolvedValue(null); expectError(await mGetHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('create Zod 失败 → 400', async () => { expectError(await mCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await mPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await mDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('default id 非法 → 400', async () => { expectError(await mDefaultHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
})

describe('admin/products', () => {
    it('list happy', async () => { ;(getProductsForAdminService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await pListHandler(makeEvent({ query: {} }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await pGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(getProductByIdService as any).mockResolvedValue(null); expectError(await pGetHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('create Zod 失败 → 400', async () => { expectError(await pCreateHandler(makeEvent({ body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await pPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await pDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('status id 非法 → 400', async () => { expectError(await pStatusHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
})
