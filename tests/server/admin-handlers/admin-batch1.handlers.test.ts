/**
 * Admin handlers Batch 1（11 个子目录 / 34 文件）
 *
 * 覆盖：audit / workflow-tools / membership-benefits / contract-playbooks /
 *       contract-reviews / access / agent-audit-logs / law-embeddings /
 *       node-groups / payments / skills
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

// 通用 RBAC guards / services
vi.mock('~~/server/services/rbac/guard.service', () => ({
    requireSuperAdminGuard: vi.fn(async () => ({ ok: true })),
}))
vi.mock('~~/server/services/rbac/auditLog.dao', () => ({
    findAuditLogsDao: vi.fn(),
}))
vi.mock('~~/server/services/workflow/tools', () => ({
    getAllToolsService: vi.fn(() => [{ name: 't1', description: 'd' }]),
}))
vi.mock('~~/server/services/assistant/contract/contractPlaybook.dao', () => ({
    listPlaybooksDAO: vi.fn(),
    createPlaybookDAO: vi.fn(),
    updatePlaybookDAO: vi.fn(),
    getPlaybookByIdDAO: vi.fn(),
}))
vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    listAdminReviewsDAO: vi.fn(),
    getAdminReviewDAO: vi.fn(),
    softDeleteAdminReviewDAO: vi.fn(),
}))
vi.mock('~~/server/services/node/access.service', () => ({
    batchUpdateAccessService: vi.fn(),
    grantAccessService: vi.fn(),
    revokeAccessService: vi.fn(),
    getAccessMatrixService: vi.fn(),
}))
vi.mock('~~/server/services/node/node.service', () => ({
    getAllNodeGroupsService: vi.fn(),
    getNodeGroupsService: vi.fn(),
    createNodeGroupService: vi.fn(),
    updateNodeGroupService: vi.fn(),
    deleteNodeGroupService: vi.fn(),
}))
vi.mock('~~/server/services/legal/lawEmbeddings.dao', () => ({
    findEmbeddingByIdDao: vi.fn(),
    findEmbeddingsByLegalIdDao: vi.fn(),
    deleteEmbeddingByIdDao: vi.fn(),
}))
vi.mock('~~/server/services/legal/vectorStore.service', () => ({
    getPool: vi.fn(() => ({ query: vi.fn(async () => ({ rowCount: 1 })) })),
}))
vi.mock('~~/server/services/payment/paymentTransaction.admin.service', () => ({
    findPaymentTransactionForAdminService: vi.fn(),
    findPaymentTransactionsForAdminService: vi.fn(),
    exportPaymentTransactionsService: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/skills/skillSync.service', () => ({
    updateSkillCustomTitleService: vi.fn(),
    scanAndSyncSkillsService: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/skills/skillSync.dao', () => ({
    listAllSkillsDAO: vi.fn(),
}))

;(globalThis as any).prisma = {
    membershipLevels: { findMany: vi.fn(async () => []), findFirst: vi.fn() },
    benefits: { findMany: vi.fn(async () => []) },
    membershipBenefits: { findMany: vi.fn(async () => []) },
    agentToolAuditLogs: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        count: vi.fn(async () => 0),
        groupBy: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (fn: any) => typeof fn === 'function' ? fn({
        membershipBenefits: { findMany: vi.fn(async () => []), update: vi.fn(), createMany: vi.fn() },
        benefits: { findMany: vi.fn(async () => [{ id: 1 }, { id: 2 }]) },
    }) : fn),
}

import { findAuditLogsDao } from '~~/server/services/rbac/auditLog.dao'
import { listPlaybooksDAO, createPlaybookDAO, updatePlaybookDAO, getPlaybookByIdDAO } from '~~/server/services/assistant/contract/contractPlaybook.dao'
import { listAdminReviewsDAO, getAdminReviewDAO, softDeleteAdminReviewDAO } from '~~/server/services/assistant/contract/contractReview.dao'
import { batchUpdateAccessService, grantAccessService, revokeAccessService, getAccessMatrixService } from '~~/server/services/node/access.service'
import { getAllNodeGroupsService, getNodeGroupsService, createNodeGroupService, updateNodeGroupService, deleteNodeGroupService } from '~~/server/services/node/node.service'
import { findEmbeddingByIdDao, findEmbeddingsByLegalIdDao, deleteEmbeddingByIdDao } from '~~/server/services/legal/lawEmbeddings.dao'
import { findPaymentTransactionForAdminService, findPaymentTransactionsForAdminService, exportPaymentTransactionsService } from '~~/server/services/payment/paymentTransaction.admin.service'
import { updateSkillCustomTitleService, scanAndSyncSkillsService } from '~~/server/services/agent-platform/skills/skillSync.service'
import { listAllSkillsDAO } from '~~/server/services/agent-platform/skills/skillSync.dao'

const { default: auditHandler } = await import('../../../server/api/v1/admin/audit/index.get')
const { default: workflowToolsHandler } = await import('../../../server/api/v1/admin/workflow-tools/index.get')
const { default: mbListHandler } = await import('../../../server/api/v1/admin/membership-benefits/index.get')
const { default: mbUpdateHandler } = await import('../../../server/api/v1/admin/membership-benefits/[levelId].put')
const { default: cpbListHandler } = await import('../../../server/api/v1/admin/contract-playbooks/index.get')
const { default: cpbCreateHandler } = await import('../../../server/api/v1/admin/contract-playbooks/index.post')
const { default: cpbPatchHandler } = await import('../../../server/api/v1/admin/contract-playbooks/[id].patch')
const { default: crListHandler } = await import('../../../server/api/v1/admin/contract-reviews/index.get')
const { default: crGetHandler } = await import('../../../server/api/v1/admin/contract-reviews/[id].get')
const { default: crDeleteHandler } = await import('../../../server/api/v1/admin/contract-reviews/[id].delete')
const { default: accessBatchHandler } = await import('../../../server/api/v1/admin/access/batch.post')
const { default: accessGrantHandler } = await import('../../../server/api/v1/admin/access/grant.post')
const { default: accessRevokeHandler } = await import('../../../server/api/v1/admin/access/revoke.post')
const { default: accessMatrixHandler } = await import('../../../server/api/v1/admin/access/matrix.get')
const { default: aalGetHandler } = await import('../../../server/api/v1/admin/agent-audit-logs/[id].get')
const { default: aalDeleteHandler } = await import('../../../server/api/v1/admin/agent-audit-logs/index.delete')
const { default: aalListHandler } = await import('../../../server/api/v1/admin/agent-audit-logs/index.get')
const { default: aalStatsHandler } = await import('../../../server/api/v1/admin/agent-audit-logs/stats.get')
const { default: leDeleteHandler } = await import('../../../server/api/v1/admin/law-embeddings/[id].delete')
const { default: leGetHandler } = await import('../../../server/api/v1/admin/law-embeddings/[id].get')
const { default: lePutHandler } = await import('../../../server/api/v1/admin/law-embeddings/[id].put')
const { default: leListHandler } = await import('../../../server/api/v1/admin/law-embeddings/index.get')
const { default: ngDeleteHandler } = await import('../../../server/api/v1/admin/node-groups/[id].delete')
const { default: ngPutHandler } = await import('../../../server/api/v1/admin/node-groups/[id].put')
const { default: ngListHandler } = await import('../../../server/api/v1/admin/node-groups/index.get')
const { default: ngCreateHandler } = await import('../../../server/api/v1/admin/node-groups/index.post')
const { default: payGetHandler } = await import('../../../server/api/v1/admin/payments/[id].get')
const { default: payExportHandler } = await import('../../../server/api/v1/admin/payments/export.get')
const { default: payListHandler } = await import('../../../server/api/v1/admin/payments/index.get')
const { default: skPatchHandler } = await import('../../../server/api/v1/admin/skills/[name].patch')
const { default: skListHandler } = await import('../../../server/api/v1/admin/skills/index.get')
const { default: skResyncHandler } = await import('../../../server/api/v1/admin/skills/resync.post')

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

describe('admin/audit', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => { ;(findAuditLogsDao as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await auditHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('Zod 失败 → 400', async () => { expectError(await auditHandler(makeEvent({ userId: 100, query: { page: '0' } }) as any), 400) })
})

describe('admin/workflow-tools', () => {
    beforeEach(() => vi.clearAllMocks())
    it('happy', async () => { expectSuccess(await workflowToolsHandler(makeEvent({ userId: 100 }) as any)) })
    it('未登录 → 401', async () => { expectError(await workflowToolsHandler(makeEvent({}) as any), 401) })
})

describe('admin/membership-benefits', () => {
    beforeEach(() => vi.clearAllMocks())
    it('list happy', async () => { expectSuccess(await mbListHandler(makeEvent({}) as any)) })
    it('update happy', async () => {
        ;(globalThis as any).prisma.membershipLevels.findFirst.mockResolvedValue({ id: 1 })
        expectSuccess(await mbUpdateHandler(makeEvent({
            params: { levelId: '1' },
            body: { benefits: [{ benefitId: 1, benefitValue: '100' }] },
        }) as any))
    })
    it('update id 非法 → 400', async () => { expectError(await mbUpdateHandler(makeEvent({ params: { levelId: 'x' }, body: {} }) as any), 400) })
    it('update Zod 失败 → 400', async () => { expectError(await mbUpdateHandler(makeEvent({ params: { levelId: '1' }, body: {} }) as any), 400) })
    it('update 级别不存在 → 404', async () => {
        ;(globalThis as any).prisma.membershipLevels.findFirst.mockResolvedValue(null)
        expectError(await mbUpdateHandler(makeEvent({ params: { levelId: '1' }, body: { benefits: [] } }) as any), 404)
    })
})

describe('admin/contract-playbooks', () => {
    beforeEach(() => vi.clearAllMocks())
    it('list happy', async () => { ;(listPlaybooksDAO as any).mockResolvedValue([{ id: 1 }]); expectSuccess(await cpbListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await cpbListHandler(makeEvent({ query: {} }) as any), 401) })
    it('create 未登录 → 401', async () => { expectError(await cpbCreateHandler(makeEvent({ body: {} }) as any), 401) })
    it('create Zod 失败 → 400', async () => { expectError(await cpbCreateHandler(makeEvent({ userId: 100, body: {} }) as any), 400) })
    it('patch 未登录 → 401', async () => { expectError(await cpbPatchHandler(makeEvent({ params: { id: '1' }, body: {} }) as any), 401) })
    it('patch id 非法 → 400', async () => { expectError(await cpbPatchHandler(makeEvent({ userId: 100, params: { id: 'x' }, body: {} }) as any), 400) })
    it('patch 不存在 → 404', async () => {
        ;(getPlaybookByIdDAO as any).mockResolvedValue(null)
        expectError(await cpbPatchHandler(makeEvent({ userId: 100, params: { id: '1' }, body: { title: 'X' } }) as any), 404)
    })
})

describe('admin/contract-reviews', () => {
    beforeEach(() => vi.clearAllMocks())
    it('list happy', async () => { ;(listAdminReviewsDAO as any).mockResolvedValue({ items: [], total: 0 }); expectSuccess(await crListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await crListHandler(makeEvent({ query: {} }) as any), 401) })
    it('get happy', async () => { ;(getAdminReviewDAO as any).mockResolvedValue({ id: 1 }); expectSuccess(await crGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)) })
    it('get id 非法 → 400', async () => { expectError(await crGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(getAdminReviewDAO as any).mockResolvedValue(null); expectError(await crGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any), 404) })
    it('delete happy', async () => { ;(softDeleteAdminReviewDAO as any).mockResolvedValue({ status: 'deleted' }); expectSuccess(await crDeleteHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)) })
    it('delete 未登录 → 401', async () => { expectError(await crDeleteHandler(makeEvent({ params: { id: '1' } }) as any), 401) })
    it('delete id 非法 → 400', async () => { expectError(await crDeleteHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('delete 不存在 → 404', async () => { ;(softDeleteAdminReviewDAO as any).mockResolvedValue({ status: 'not_found' }); expectError(await crDeleteHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any), 404) })
})

describe('admin/access', () => {
    beforeEach(() => vi.clearAllMocks())
    it('batch happy', async () => { ;(batchUpdateAccessService as any).mockResolvedValue(undefined); expectSuccess(await accessBatchHandler(makeEvent({ body: { levelId: 1, nodeIds: [1] } }) as any)) })
    it('batch Zod 失败 → 400', async () => { expectError(await accessBatchHandler(makeEvent({ body: {} }) as any), 400) })
    it('batch 级别不存在 → 404', async () => {
        ;(batchUpdateAccessService as any).mockRejectedValue(new Error('会员级别不存在'))
        expectError(await accessBatchHandler(makeEvent({ body: { levelId: 1, nodeIds: [1] } }) as any), 404)
    })
    it('grant happy', async () => { ;(grantAccessService as any).mockResolvedValue({ id: 1 }); expectSuccess(await accessGrantHandler(makeEvent({ body: { levelId: 1, nodeId: 1 } }) as any)) })
    it('grant Zod 失败 → 400', async () => { expectError(await accessGrantHandler(makeEvent({ body: {} }) as any), 400) })
    it('grant 已存在 → 409', async () => { ;(grantAccessService as any).mockRejectedValue(new Error('该权限已存在')); expectError(await accessGrantHandler(makeEvent({ body: { levelId: 1, nodeId: 1 } }) as any), 409) })
    it('grant 级别不存在 → 404', async () => { ;(grantAccessService as any).mockRejectedValue(new Error('会员级别不存在')); expectError(await accessGrantHandler(makeEvent({ body: { levelId: 1, nodeId: 1 } }) as any), 404) })
    it('revoke happy', async () => { ;(revokeAccessService as any).mockResolvedValue(undefined); expectSuccess(await accessRevokeHandler(makeEvent({ body: { levelId: 1, nodeId: 1 } }) as any)) })
    it('revoke Zod 失败 → 400', async () => { expectError(await accessRevokeHandler(makeEvent({ body: {} }) as any), 400) })
    it('revoke 不存在 → 404', async () => { ;(revokeAccessService as any).mockRejectedValue(new Error('权限记录不存在')); expectError(await accessRevokeHandler(makeEvent({ body: { levelId: 1, nodeId: 1 } }) as any), 404) })
    it('matrix happy', async () => { ;(getAccessMatrixService as any).mockResolvedValue({ matrix: [] }); expectSuccess(await accessMatrixHandler(makeEvent({}) as any)) })
    it('matrix 抛错 → 500', async () => { ;(getAccessMatrixService as any).mockRejectedValue(new Error('boom')); expectError(await accessMatrixHandler(makeEvent({}) as any), 500) })
})

describe('admin/agent-audit-logs', () => {
    beforeEach(() => vi.clearAllMocks())
    it('get happy', async () => {
        ;(globalThis as any).prisma.agentToolAuditLogs.findUnique.mockResolvedValue({ id: VALID_UUID, userId: 100, createdAt: new Date() })
        expectSuccess(await aalGetHandler(makeEvent({ params: { id: VALID_UUID } }) as any))
    })
    it('get id 非 UUID → 400', async () => { expectError(await aalGetHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => {
        ;(globalThis as any).prisma.agentToolAuditLogs.findUnique.mockResolvedValue(null)
        expectError(await aalGetHandler(makeEvent({ params: { id: VALID_UUID } }) as any), 404)
    })
    it('delete Zod 失败 → 400', async () => { expectError(await aalDeleteHandler(makeEvent({ body: {} }) as any), 400) })
    it('list happy', async () => { expectSuccess(await aalListHandler(makeEvent({ query: {} }) as any)) })
    it('list Zod 失败 → 400', async () => { expectError(await aalListHandler(makeEvent({ query: { page: '0' } }) as any), 400) })
    it('stats happy', async () => { expectSuccess(await aalStatsHandler(makeEvent({}) as any)) })
})

describe('admin/law-embeddings', () => {
    beforeEach(() => vi.clearAllMocks())
    it('delete 未登录 → 401', async () => { expectError(await leDeleteHandler(makeEvent({ params: { id: VALID_UUID } }) as any), 401) })
    it('delete id 非法 → 400', async () => { expectError(await leDeleteHandler(makeEvent({ userId: 100, params: { id: '' } }) as any), 400) })
    it('delete 不存在 → 404', async () => {
        ;(findEmbeddingByIdDao as any).mockResolvedValue(null)
        expectError(await leDeleteHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any), 404)
    })
    it('delete happy', async () => {
        ;(findEmbeddingByIdDao as any).mockResolvedValue({ id: VALID_UUID })
        ;(deleteEmbeddingByIdDao as any).mockResolvedValue(true)
        expectSuccess(await leDeleteHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any))
    })
    it('get 未登录 → 401', async () => { expectError(await leGetHandler(makeEvent({ params: { id: VALID_UUID } }) as any), 401) })
    it('get id 非法 → 400', async () => { expectError(await leGetHandler(makeEvent({ userId: 100, params: { id: '' } }) as any), 400) })
    it('get 不存在 → 404', async () => {
        ;(findEmbeddingByIdDao as any).mockResolvedValue(null)
        expectError(await leGetHandler(makeEvent({ userId: 100, params: { id: VALID_UUID } }) as any), 404)
    })
    it('put 未登录 → 401', async () => { expectError(await lePutHandler(makeEvent({ params: { id: VALID_UUID }, body: {} }) as any), 401) })
    it('put id 非法 → 400', async () => { expectError(await lePutHandler(makeEvent({ userId: 100, params: { id: '' }, body: {} }) as any), 400) })
    it('put Zod 失败 → 400', async () => { expectError(await lePutHandler(makeEvent({ userId: 100, params: { id: VALID_UUID }, body: { content: 123 } }) as any), 400) })
    it('list 未登录 → 401', async () => { expectError(await leListHandler(makeEvent({ query: {} }) as any), 401) })
    it('list happy', async () => {
        ;(findEmbeddingsByLegalIdDao as any).mockResolvedValue({ list: [], total: 0 })
        expectSuccess(await leListHandler(makeEvent({ userId: 100, query: { legalId: '1' } }) as any))
    })
})

describe('admin/node-groups', () => {
    beforeEach(() => vi.clearAllMocks())
    it('delete happy', async () => { ;(deleteNodeGroupService as any).mockResolvedValue(undefined); expectSuccess(await ngDeleteHandler(makeEvent({ params: { id: '1' } }) as any)) })
    it('delete id 非法 → 400', async () => { expectError(await ngDeleteHandler(makeEvent({ params: { id: 'x' } }) as any), 400) })
    it('delete 不存在 → 404', async () => { ;(deleteNodeGroupService as any).mockRejectedValue(new Error('节点分组不存在')); expectError(await ngDeleteHandler(makeEvent({ params: { id: '1' } }) as any), 404) })
    it('put happy', async () => { ;(updateNodeGroupService as any).mockResolvedValue({ id: 1 }); expectSuccess(await ngPutHandler(makeEvent({ params: { id: '1' }, body: { name: 'X' } }) as any)) })
    it('put id 非法 → 400', async () => { expectError(await ngPutHandler(makeEvent({ params: { id: 'x' }, body: {} }) as any), 400) })
    it('put 无内容 → 400', async () => { expectError(await ngPutHandler(makeEvent({ params: { id: '1' }, body: {} }) as any), 400) })
    it('list happy', async () => { ;(getAllNodeGroupsService as any).mockResolvedValue([]); ;(getNodeGroupsService as any).mockResolvedValue({ list: [], total: 0 }); expectSuccess(await ngListHandler(makeEvent({ query: {} }) as any)) })
    it('list Zod 失败 → 400', async () => { expectError(await ngListHandler(makeEvent({ query: { page: '0' } }) as any), 400) })
    it('create happy', async () => { ;(createNodeGroupService as any).mockResolvedValue({ id: 1 }); expectSuccess(await ngCreateHandler(makeEvent({ body: { name: 'A', code: 'a' } }) as any)) })
    it('create Zod 失败 → 400', async () => { expectError(await ngCreateHandler(makeEvent({ body: {} }) as any), 400) })
})

describe('admin/payments', () => {
    beforeEach(() => vi.clearAllMocks())
    it('get happy', async () => { ;(findPaymentTransactionForAdminService as any).mockResolvedValue({ id: 1 }); expectSuccess(await payGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)) })
    it('get 未登录 → 401', async () => { expectError(await payGetHandler(makeEvent({ params: { id: '1' } }) as any), 401) })
    it('get id 非法 → 400', async () => { expectError(await payGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any), 400) })
    it('get 不存在 → 404', async () => { ;(findPaymentTransactionForAdminService as any).mockResolvedValue(null); expectError(await payGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any), 404) })
    it('export 未登录 → 401', async () => { expectError(await payExportHandler(makeEvent({ query: {} }) as any), 401) })
    it('export Zod 失败 → 400', async () => { expectError(await payExportHandler(makeEvent({ userId: 100, query: { paymentChannel: 'X' } }) as any), 400) })
    it('list happy', async () => { ;(findPaymentTransactionsForAdminService as any).mockResolvedValue({ items: [], total: 0 }); expectSuccess(await payListHandler(makeEvent({ userId: 100, query: {} }) as any)) })
    it('list 未登录 → 401', async () => { expectError(await payListHandler(makeEvent({ query: {} }) as any), 401) })
})

describe('admin/skills', () => {
    beforeEach(() => vi.clearAllMocks())
    it('patch happy', async () => { ;(updateSkillCustomTitleService as any).mockResolvedValue({ name: 'x' }); expectSuccess(await skPatchHandler(makeEvent({ params: { name: 'x' }, body: { customTitle: 'T' } }) as any)) })
    it('patch 缺 name → 400', async () => { expectError(await skPatchHandler(makeEvent({ params: {}, body: { customTitle: 'T' } }) as any), 400) })
    it('patch Zod 失败 → 400', async () => { expectError(await skPatchHandler(makeEvent({ params: { name: 'x' }, body: {} }) as any), 400) })
    it('patch 不存在 → 404', async () => { ;(updateSkillCustomTitleService as any).mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' })); expectError(await skPatchHandler(makeEvent({ params: { name: 'x' }, body: { customTitle: 'T' } }) as any), 404) })
    it('list happy', async () => { ;(listAllSkillsDAO as any).mockResolvedValue([]); expectSuccess(await skListHandler(makeEvent({}) as any)) })
    it('list 抛错 → 500', async () => { ;(listAllSkillsDAO as any).mockRejectedValue(new Error('boom')); expectError(await skListHandler(makeEvent({}) as any), 500) })
    it('resync happy', async () => { ;(scanAndSyncSkillsService as any).mockResolvedValue({ scanned: [], added: [], updated: [], disabled: [], errors: [] }); expectSuccess(await skResyncHandler(makeEvent({}) as any)) })
    it('resync 抛错 → 500', async () => { ;(scanAndSyncSkillsService as any).mockRejectedValue(new Error('boom')); expectError(await skResyncHandler(makeEvent({}) as any), 500) })
})
