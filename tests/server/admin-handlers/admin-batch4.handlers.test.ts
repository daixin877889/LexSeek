/**
 * Admin handlers Batch 4（8 个子目录 / 59 文件）
 * api-permissions / legal-articles / nodes / point-consumption-items /
 * prompts / roles / routers / users
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/rbac/guard.service', () => ({
    requireSuperAdminGuard: vi.fn(async () => ({ ok: true })),
}))
vi.mock('~~/server/services/rbac/auditLog.dao', () => ({
    findAuditLogsDao: vi.fn(),
    createAuditLogDao: vi.fn(),
}))
vi.mock('~~/server/services/rbac/apiPermission.dao', () => ({
    findApiPermissionsDao: vi.fn(),
    findApiPermissionByIdDao: vi.fn(),
    createApiPermissionDao: vi.fn(),
    updateApiPermissionDao: vi.fn(),
    deleteApiPermissionDao: vi.fn(),
    checkApiPermissionExistsDao: vi.fn(),
    findAllApiPermissionGroupsDao: vi.fn(),
    createManyApiPermissionsDao: vi.fn(),
    updateApiPermissionsPublicStatusDao: vi.fn(),
}))
vi.mock('~~/server/services/rbac/auditLog.service', () => ({
    logApiPermissionCreate: vi.fn(),
    logApiPermissionUpdate: vi.fn(),
    logApiPermissionDelete: vi.fn(),
    logApiPermissionBatchDelete: vi.fn(),
    logApiPermissionBatchPublic: vi.fn(),
    logRoleCreate: vi.fn(),
    logRoleUpdate: vi.fn(),
    logRoleDelete: vi.fn(),
    logUserAssignRole: vi.fn(),
}))
vi.mock('~~/server/services/rbac/permission.service', () => ({
    refreshPublicApiPermissions: vi.fn(),
    refreshRoleUsersPermissions: vi.fn(),
}))
vi.mock('~~/server/services/rbac/cache.service', () => ({
    clearAllUserPermissionCache: vi.fn(),
    clearUserPermissionCache: vi.fn(),
}))
vi.mock('~~/server/services/rbac/roleApiPermission.dao', () => ({
    findRolesByApiPermissionDao: vi.fn(async () => []),
}))
vi.mock('~~/server/services/legal/legalArticles.service', () => ({
    getLegalArticlesListService: vi.fn(),
    getLegalArticleDetailService: vi.fn(),
    createLegalArticleService: vi.fn(),
    updateLegalArticleService: vi.fn(),
    deleteLegalArticleService: vi.fn(),
    triggerArticleEmbeddingService: vi.fn(),
    batchSortArticlesService: vi.fn(),
    getSortTreeService: vi.fn(),
}))
vi.mock('~~/server/services/legal/article.service', () => ({
    batchSaveArticlesService: vi.fn(),
}))
vi.mock('~~/server/services/legal/parser.service', () => ({
    parseContent: vi.fn(),
}))
vi.mock('~~/server/services/legal/vectorStore.service', () => ({
    deleteEmbeddingsByMetadata: vi.fn(),
    getPool: vi.fn(() => ({ query: vi.fn(async () => ({ rowCount: 1 })) })),
}))
vi.mock('~~/server/services/legal/lawEmbedding.service', () => ({
    updateLegalEmbeddings: vi.fn(),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getNodesService: vi.fn(),
    getNodeByIdService: vi.fn(),
    createNodeService: vi.fn(),
    updateNodeService: vi.fn(),
    deleteNodeService: vi.fn(),
    getNodeSkillsService: vi.fn(),
    setNodeSkillsService: vi.fn(),
}))
vi.mock('~~/server/services/node/prompt.service', () => ({
    getPromptsService: vi.fn(),
    getPromptByIdService: vi.fn(),
    createPromptService: vi.fn(),
    deletePromptService: vi.fn(),
    activatePromptVersionService: vi.fn(),
    previewPromptService: vi.fn(),
    getPromptVersionsService: vi.fn(),
}))
vi.mock('~~/server/services/point/pointConsumptionItems.service', () => ({
    getPointConsumptionItemsService: vi.fn(),
    getPointConsumptionItemByIdService: vi.fn(),
    createPointConsumptionItemService: vi.fn(),
    updatePointConsumptionItemService: vi.fn(),
    deletePointConsumptionItemService: vi.fn(),
    getAllGroupsService: vi.fn(),
    updatePointConsumptionItemStatusService: vi.fn(),
}))
vi.mock('~~/server/services/retrieval/intentClassifier.service', () => ({
    invalidateIntentCacheService: vi.fn(),
}))

;(globalThis as any).prisma = {
    users: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
    },
    roles: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
    },
    routers: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
    routerGroups: {
        findMany: vi.fn(async () => []),
    },
    userRoles: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
    },
    userBenefits: {
        findMany: vi.fn(async () => []),
        update: vi.fn(),
    },
    benefits: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(),
    },
    membershipBenefits: { findMany: vi.fn(async () => []) },
    apiPermissions: {
        findMany: vi.fn(async () => []),
    },
    roleApiPermissions: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
    },
    roleRouters: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => typeof fn === 'function' ? fn({}) : fn),
}

import { findApiPermissionsDao, findApiPermissionByIdDao, createApiPermissionDao, updateApiPermissionDao, deleteApiPermissionDao, checkApiPermissionExistsDao, findAllApiPermissionGroupsDao, createManyApiPermissionsDao, updateApiPermissionsPublicStatusDao } from '~~/server/services/rbac/apiPermission.dao'
import { getLegalArticlesListService, getLegalArticleDetailService, createLegalArticleService, updateLegalArticleService, deleteLegalArticleService, triggerArticleEmbeddingService, batchSortArticlesService, getSortTreeService } from '~~/server/services/legal/legalArticles.service'
import { batchSaveArticlesService } from '~~/server/services/legal/article.service'
import { parseContent } from '~~/server/services/legal/parser.service'
import { getNodesService, getNodeByIdService, createNodeService, updateNodeService, deleteNodeService, getNodeSkillsService, setNodeSkillsService } from '~~/server/services/node/node.service'
import { getPromptsService, getPromptByIdService, createPromptService, deletePromptService, activatePromptVersionService, previewPromptService, getPromptVersionsService } from '~~/server/services/node/prompt.service'
import { getPointConsumptionItemsService, getPointConsumptionItemByIdService, createPointConsumptionItemService, updatePointConsumptionItemService, deletePointConsumptionItemService, getAllGroupsService, updatePointConsumptionItemStatusService } from '~~/server/services/point/pointConsumptionItems.service'

// api-permissions
const { default: apListHandler } = await import('../../../server/api/v1/admin/api-permissions/index.get')
const { default: apGetHandler } = await import('../../../server/api/v1/admin/api-permissions/[id].get')
const { default: apCreateHandler } = await import('../../../server/api/v1/admin/api-permissions/index.post')
const { default: apPutHandler } = await import('../../../server/api/v1/admin/api-permissions/[id].put')
const { default: apDeleteHandler } = await import('../../../server/api/v1/admin/api-permissions/[id].delete')
const { default: apBatchDelHandler } = await import('../../../server/api/v1/admin/api-permissions/batch-delete.delete')
const { default: apBatchImpHandler } = await import('../../../server/api/v1/admin/api-permissions/batch-import.post')
const { default: apBatchPubHandler } = await import('../../../server/api/v1/admin/api-permissions/batch-public.put')
const { default: apGroupsHandler } = await import('../../../server/api/v1/admin/api-permissions/groups.get')
const { default: apScanHandler } = await import('../../../server/api/v1/admin/api-permissions/scan.post')
// legal-articles
const { default: laListHandler } = await import('../../../server/api/v1/admin/legal-articles/index.get')
const { default: laGetHandler } = await import('../../../server/api/v1/admin/legal-articles/[id].get')
const { default: laCreateHandler } = await import('../../../server/api/v1/admin/legal-articles/index.post')
const { default: laPutHandler } = await import('../../../server/api/v1/admin/legal-articles/[id].put')
const { default: laDeleteHandler } = await import('../../../server/api/v1/admin/legal-articles/[id].delete')
const { default: laEmbedBatchHandler } = await import('../../../server/api/v1/admin/legal-articles/batch-embed.post')
const { default: laSaveBatchHandler } = await import('../../../server/api/v1/admin/legal-articles/batch-save.post')
const { default: laSortBatchHandler } = await import('../../../server/api/v1/admin/legal-articles/batch-sort.post')
const { default: laEmbedHandler } = await import('../../../server/api/v1/admin/legal-articles/embed/[id].post')
const { default: laParseHandler } = await import('../../../server/api/v1/admin/legal-articles/parse.post')
const { default: laTreeHandler } = await import('../../../server/api/v1/admin/legal-articles/sort-tree.get')
// nodes
const { default: nListHandler } = await import('../../../server/api/v1/admin/nodes/index.get')
const { default: nGetHandler } = await import('../../../server/api/v1/admin/nodes/[id].get')
const { default: nCreateHandler } = await import('../../../server/api/v1/admin/nodes/index.post')
const { default: nPutHandler } = await import('../../../server/api/v1/admin/nodes/[id].put')
const { default: nDeleteHandler } = await import('../../../server/api/v1/admin/nodes/[id].delete')
const { default: nSkillsGetHandler } = await import('../../../server/api/v1/admin/nodes/skills/[id].get')
const { default: nSkillsPatchHandler } = await import('../../../server/api/v1/admin/nodes/skills/[id].patch')
// point-consumption-items
const { default: pciListHandler } = await import('../../../server/api/v1/admin/point-consumption-items/index.get')
const { default: pciGetHandler } = await import('../../../server/api/v1/admin/point-consumption-items/[id].get')
const { default: pciCreateHandler } = await import('../../../server/api/v1/admin/point-consumption-items/index.post')
const { default: pciPutHandler } = await import('../../../server/api/v1/admin/point-consumption-items/[id].put')
const { default: pciDeleteHandler } = await import('../../../server/api/v1/admin/point-consumption-items/[id].delete')
const { default: pciStatusHandler } = await import('../../../server/api/v1/admin/point-consumption-items/status/[id].put')
const { default: pciGroupsHandler } = await import('../../../server/api/v1/admin/point-consumption-items/groups.get')
// prompts
const { default: prListHandler } = await import('../../../server/api/v1/admin/prompts/index.get')
const { default: prGetHandler } = await import('../../../server/api/v1/admin/prompts/[id].get')
const { default: prCreateHandler } = await import('../../../server/api/v1/admin/prompts/index.post')
const { default: prDeleteHandler } = await import('../../../server/api/v1/admin/prompts/[id].delete')
const { default: prActivateHandler } = await import('../../../server/api/v1/admin/prompts/activate/[id].put')
const { default: prPreviewHandler } = await import('../../../server/api/v1/admin/prompts/preview.post')
const { default: prVersionsHandler } = await import('../../../server/api/v1/admin/prompts/versions/[id].get')
// roles
const { default: rListHandler } = await import('../../../server/api/v1/admin/roles/index.get')
const { default: rGetHandler } = await import('../../../server/api/v1/admin/roles/[id].get')
const { default: rCreateHandler } = await import('../../../server/api/v1/admin/roles/index.post')
const { default: rPutHandler } = await import('../../../server/api/v1/admin/roles/[id].put')
const { default: rDeleteHandler } = await import('../../../server/api/v1/admin/roles/[id].delete')
const { default: rApiPermsHandler } = await import('../../../server/api/v1/admin/roles/api-permissions/[roleId].put')
const { default: rPermsHandler } = await import('../../../server/api/v1/admin/roles/permissions/[roleId].get')
const { default: rRoutePermsHandler } = await import('../../../server/api/v1/admin/roles/route-permissions/[roleId].put')
// routers
const { default: rtDeleteHandler } = await import('../../../server/api/v1/admin/routers/[id].delete')
const { default: rtPutHandler } = await import('../../../server/api/v1/admin/routers/[id].put')
const { default: rtGroupsHandler } = await import('../../../server/api/v1/admin/routers/groups.get')
const { default: rtImportHandler } = await import('../../../server/api/v1/admin/routers/import.post')
const { default: rtListHandler } = await import('../../../server/api/v1/admin/routers/index.get')
const { default: rtScanHandler } = await import('../../../server/api/v1/admin/routers/scan.post')
// users (admin)
const { default: uListHandler } = await import('../../../server/api/v1/admin/users/index.get')
const { default: uSearchHandler } = await import('../../../server/api/v1/admin/users/search.get')
const { default: uBenefitsGetHandler } = await import('../../../server/api/v1/admin/users/benefits/[userId].get')
const { default: uBenefitsPostHandler } = await import('../../../server/api/v1/admin/users/benefits/[userId].post')
const { default: uBenefitsDisableHandler } = await import('../../../server/api/v1/admin/users/benefits/disable/[userId]/[benefitId].put')
const { default: uRolesPutHandler } = await import('../../../server/api/v1/admin/users/roles/[userId].put')

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => vi.clearAllMocks())

describe('admin/api-permissions', () => {
    it('list happy', async () => { ;(findApiPermissionsDao as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await apListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await apGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(findApiPermissionByIdDao as any).mockResolvedValue(null); expectError(await apGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any), 404) })
    it('create Zod 失败 → 400', async () => { expectError(await apCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await apPutHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await apDeleteHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('batch-delete Zod 失败 → 400', async () => { expectError(await apBatchDelHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('batch-import Zod 失败 → 400', async () => { expectError(await apBatchImpHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('batch-public Zod 失败 → 400', async () => { expectError(await apBatchPubHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('groups happy', async () => { ;(findAllApiPermissionGroupsDao as any).mockResolvedValue([]); expectSuccess(await apGroupsHandler(makeEvent({ userId: 100 }) as any)) })
})

describe('admin/legal-articles', () => {
    it('list 缺 legalId → 400', async () => { expectError(await laListHandler(makeEvent({ userId: 100, query: {} }) as any), 400) })
    it('list happy', async () => { ;(getLegalArticlesListService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await laListHandler(makeEvent({ userId: 100, query: { legalId: VALID_UUID } }) as any)) })
    it('get 不存在 → 404', async () => { ;(getLegalArticleDetailService as any).mockResolvedValue(null); expectError(await laGetHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any), 404) })
    it('create Zod 失败 → 400', async () => { expectError(await laCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('put Zod 失败 → 400', async () => { expectError(await laPutHandler(makeEvent({ userId: 100, params: { id: VALID_UUID }, body: { type: 'invalid_type' } }) as any), 400) })
    it('batch-embed Zod 失败 → 400', async () => { expectError(await laEmbedBatchHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('batch-save Zod 失败 → 400', async () => { expectError(await laSaveBatchHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('batch-sort Zod 失败 → 400', async () => { expectError(await laSortBatchHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('parse Zod 失败 → 400', async () => { expectError(await laParseHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('sort-tree happy', async () => { ;(getSortTreeService as any).mockResolvedValue([]); expectSuccess(await laTreeHandler(makeEvent({ userId: 100, query: { legalId: VALID_UUID } }) as any)) })
})

describe('admin/nodes', () => {
    it('list happy', async () => { ;(getNodesService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await nListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await nGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('create Zod 失败 → 400', async () => { expectError(await nCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await nPutHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await nDeleteHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('skills get id 非法 → 400', async () => { expectError(await nSkillsGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('skills patch id 非法 → 400', async () => { expectError(await nSkillsPatchHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
})

describe('admin/point-consumption-items', () => {
    it('list happy', async () => { ;(getPointConsumptionItemsService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await pciListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await pciGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('create Zod 失败 → 400', async () => { expectError(await pciCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await pciPutHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await pciDeleteHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('status id 非法 → 400', async () => { expectError(await pciStatusHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
    it('groups happy', async () => { ;(getAllGroupsService as any).mockResolvedValue([]); expectSuccess(await pciGroupsHandler(makeEvent({}) as any)) })
})

describe('admin/prompts', () => {
    it('list happy', async () => { ;(getPromptsService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await prListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await prGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('create Zod 失败 → 400', async () => { expectError(await prCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await prDeleteHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('activate id 非法 → 400', async () => { expectError(await prActivateHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('preview Zod 失败 → 400', async () => { expectError(await prPreviewHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('versions id 非法 → 400', async () => { expectError(await prVersionsHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
})

describe('admin/roles', () => {
    it('list happy', async () => { ;(globalThis as any).prisma.roles.findMany.mockResolvedValue([]); expectSuccess(await rListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await rListHandler(makeEvent({ query: {} }) as any), 401) })
    it('get id 非法 → 400', async () => { expectError(await rGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('create Zod 失败 → 400', async () => { expectError(await rCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await rPutHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
    it('delete id 非法 → 400', async () => { expectError(await rDeleteHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('api-permissions roleId 非法 → 400', async () => { expectError(await rApiPermsHandler(makeEvent({ userId: 100, params: { roleId: 'x' }, body: {} }) as any), 400) })
    it('permissions roleId 非法 → 400', async () => { expectError(await rPermsHandler(makeEvent({ userId: 100, params: { roleId: 'x' } }) as any), 400) })
    it('route-permissions roleId 非法 → 400', async () => { expectError(await rRoutePermsHandler(makeEvent({ userId: 100, params: { roleId: 'x' }, body: {} }) as any), 400) })
})

describe('admin/routers', () => {
    it('list happy', async () => { expectSuccess(await rtListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('groups happy', async () => { expectSuccess(await rtGroupsHandler(makeEvent({ userId: 100 }) as any)) })
    it('delete id 非法 → 400', async () => { expectError(await rtDeleteHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('put id 非法 → 400', async () => { expectError(await rtPutHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
    it('import Zod 失败 → 400', async () => { expectError(await rtImportHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
})

describe('admin/users', () => {
    it('list happy', async () => { expectSuccess(await uListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await uListHandler(makeEvent({ query: {} }) as any), 401) })
    it('search Zod 失败 → 400', async () => { expectError(await uSearchHandler(makeEvent({ userId: 100, query: {} }) as any), 400) })
    it('benefits get userId 非法 → 400', async () => { expectError(await uBenefitsGetHandler(makeEvent({ params: { userId: 'x' } }) as any), 400) })
    it('benefits post userId 非法 → 400', async () => { expectError(await uBenefitsPostHandler(makeEvent({ params: { userId: 'x' }, body: {} }) as any), 400) })
    it('benefits disable id 非法 → 400', async () => { expectError(await uBenefitsDisableHandler(makeEvent({ params: { userId: 'x', benefitId: 'y' } }) as any), 400) })
    it('roles put userId 非法 → 400', async () => { expectError(await uRolesPutHandler(makeEvent({ params: { userId: 'x' }, body: {} }) as any), 400) })
})
