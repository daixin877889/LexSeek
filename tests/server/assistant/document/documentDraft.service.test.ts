/**
 * DocumentDraft Service 测试
 *
 * 使用 mock 策略：外部依赖（DAO、enqueueRunService、ensureMaterialsReadyForDraftService）全部 mock，
 * 专注测试服务层主流程编排（权限校验、状态保护、schema 校验等）。
 *
 * **Feature: document-generation**
 * **Validates: Task 3.10**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { PrismaClient } from '~~/generated/prisma/client'
import '../../case/test-setup'

// ==================== Mock 外部依赖（必须在 import 被测模块之前） ====================

vi.mock('~~/server/services/assistant/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))

vi.mock('~~/server/services/assistant/document/documentDraft.dao', () => ({
    createDocumentDraftDAO: vi.fn(),
    getDocumentDraftDAO: vi.fn(),
    updateDocumentDraftDAO: vi.fn(),
    listDocumentDraftsDAO: vi.fn(),
    findDraftBySessionIdDAO: vi.fn(),
    softDeleteDocumentDraftDAO: vi.fn(),
}))

vi.mock('~~/server/services/assistant/assistantSession.dao', () => ({
    createAssistantSessionDAO: vi.fn(),
}))

vi.mock('~~/server/services/agent/agentRun.service', () => ({
    enqueueRunService: vi.fn(),
}))

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyForDraftService: vi.fn(),
}))

vi.mock('~~/server/services/assistant/document/draftSchema.builder', () => ({
    buildDraftSchema: vi.fn(),
}))

// ==================== 导入被测模块（在 mock 之后） ====================

import {
    createDraftService,
    getDraftService,
    patchDraftService,
    deleteDraftService,
} from '~~/server/services/assistant/document/documentDraft.service'
import { getDocumentTemplateDAO } from '~~/server/services/assistant/document/documentTemplate.dao'
import {
    createDocumentDraftDAO,
    getDocumentDraftDAO,
    updateDocumentDraftDAO,
    softDeleteDocumentDraftDAO,
} from '~~/server/services/assistant/document/documentDraft.dao'
import { createAssistantSessionDAO } from '~~/server/services/assistant/assistantSession.dao'
import { enqueueRunService } from '~~/server/services/agent/agentRun.service'
import { ensureMaterialsReadyForDraftService } from '~~/server/services/material/materialPipeline.service'
import { buildDraftSchema } from '~~/server/services/assistant/document/draftSchema.builder'
import { z } from 'zod'

// ==================== 类型转换（方便使用 mockResolvedValue） ====================

const mockGetDocumentTemplateDAO = getDocumentTemplateDAO as ReturnType<typeof vi.fn>
const mockCreateDocumentDraftDAO = createDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockGetDocumentDraftDAO = getDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockUpdateDocumentDraftDAO = updateDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockSoftDeleteDocumentDraftDAO = softDeleteDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockCreateAssistantSessionDAO = createAssistantSessionDAO as ReturnType<typeof vi.fn>
const mockEnqueueRunService = enqueueRunService as ReturnType<typeof vi.fn>
const mockEnsureMaterialsReadyForDraftService = ensureMaterialsReadyForDraftService as ReturnType<typeof vi.fn>
const mockBuildDraftSchema = buildDraftSchema as ReturnType<typeof vi.fn>

// ==================== 测试帮助数据 ====================

const MOCK_GLOBAL_TEMPLATE = {
    id: 1,
    name: '起诉状模板',
    scope: 'global',
    userId: null,
    placeholders: [{ name: 'plaintiff', firstContext: '原告：{{plaintiff}}' }],
    category: '起诉状',
}

const MOCK_USER_TEMPLATE = {
    id: 2,
    name: '个人模板',
    scope: 'user',
    userId: 100,
    placeholders: [{ name: 'content', firstContext: '内容：{{content}}' }],
    category: '合同',
}

const MOCK_SESSION = {
    sessionId: 'test-uuid-1234-abcd-efgh',
    userId: 100,
    scope: 'document',
}

const MOCK_DRAFT = {
    id: 10,
    userId: 100,
    templateId: 1,
    sessionId: MOCK_SESSION.sessionId,
    status: 'drafting',
    values: {},
    sourceRef: null,
    metadata: null,
    caseId: null,
    template: MOCK_GLOBAL_TEMPLATE,
}

const MOCK_DRAFT_READY = {
    ...MOCK_DRAFT,
    status: 'ready',
    values: { plaintiff: '张三' },
}

// ==================== beforeEach 默认 mock 设置 ====================

// createDraftService 内部直接用 prisma.caseSessions.create（而非 DAO），
// Prisma Proxy 不支持 vi.spyOn，改用属性替换；保留原函数在 afterEach 复位
type CaseSessionsCreate = PrismaClient['caseSessions']['create']
const testPrisma = (globalThis as unknown as { prisma: PrismaClient }).prisma
let __origCaseSessionsCreate: CaseSessionsCreate | null = null

beforeEach(() => {
    vi.resetAllMocks()

    __origCaseSessionsCreate = testPrisma.caseSessions.create.bind(testPrisma.caseSessions)
    testPrisma.caseSessions.create = vi.fn().mockResolvedValue(MOCK_SESSION) as unknown as CaseSessionsCreate

    // 默认：成功路径
    mockGetDocumentTemplateDAO.mockResolvedValue(MOCK_GLOBAL_TEMPLATE)
    mockCreateAssistantSessionDAO.mockResolvedValue(MOCK_SESSION)
    mockCreateDocumentDraftDAO.mockResolvedValue(MOCK_DRAFT)
    mockEnqueueRunService.mockResolvedValue({ runId: 'run-001', isNew: true })
    mockEnsureMaterialsReadyForDraftService.mockResolvedValue({
        id: 1,
        status: 3,
        draftId: 10,
        ossFileId: 5,
    })
    mockGetDocumentDraftDAO.mockResolvedValue({
        ...MOCK_DRAFT,
        template: MOCK_GLOBAL_TEMPLATE,
    })
    mockUpdateDocumentDraftDAO.mockResolvedValue(MOCK_DRAFT_READY)

    // buildDraftSchema mock：返回有 plaintiff key 的 schema
    mockBuildDraftSchema.mockReturnValue(
        z.object({
            values: z.object({ plaintiff: z.string().nullable() }),
        }),
    )
})

afterEach(() => {
    vi.clearAllMocks()
    if (__origCaseSessionsCreate) {
        testPrisma.caseSessions.create = __origCaseSessionsCreate
        __origCaseSessionsCreate = null
    }
})

// ==================== createDraftService ====================

describe('createDraftService', () => {
    describe('模板校验', () => {
        it('模板不存在时返回 { error, code: 404 }', async () => {
            mockGetDocumentTemplateDAO.mockResolvedValue(null)

            const result = await createDraftService({
                userId: 100,
                templateId: 999,
            })

            expect(result).toEqual({ error: '模板不存在', code: 404 })
            expect(mockCreateDocumentDraftDAO).not.toHaveBeenCalled()
        })

        it('scope=user 且 userId 不匹配时返回 { error, code: 403 }', async () => {
            mockGetDocumentTemplateDAO.mockResolvedValue(MOCK_USER_TEMPLATE)

            const result = await createDraftService({
                userId: 999, // 不是模板所有者（MOCK_USER_TEMPLATE.userId = 100）
                templateId: 2,
            })

            expect(result).toEqual({ error: '无权使用此模板', code: 403 })
            expect(mockCreateDocumentDraftDAO).not.toHaveBeenCalled()
        })

        it('scope=user 且 userId 匹配时允许通过', async () => {
            mockGetDocumentTemplateDAO.mockResolvedValue(MOCK_USER_TEMPLATE)

            const result = await createDraftService({
                userId: 100, // 正是模板所有者
                templateId: 2,
            })

            expect(result).not.toHaveProperty('code', 403)
            expect(result).not.toHaveProperty('code', 404)
        })

        it('scope=global 对任何 userId 都可用', async () => {
            mockGetDocumentTemplateDAO.mockResolvedValue(MOCK_GLOBAL_TEMPLATE)

            const result = await createDraftService({
                userId: 999, // 不是创建者（global 没有创建者）
                templateId: 1,
            })

            expect(result).not.toHaveProperty('code', 403)
        })
    })

    describe('成功路径', () => {
        it('返回 { draftId, sessionId }', async () => {
            const result = await createDraftService({
                userId: 100,
                templateId: 1,
            })

            expect(result).toHaveProperty('draftId', MOCK_DRAFT.id)
            expect(result).toHaveProperty('sessionId', MOCK_SESSION.sessionId)
        })

        // 注：业务方已改用 prisma.caseSessions.create 直接创建 scope='document' 的会话，
        //   不再调用 createAssistantSessionDAO（避免硬编码 scope='assistant' 让 agentWorker 错误路由）。
        //   该路径由 testPrisma.caseSessions.create 的 mock 覆盖（见 beforeEach 第 135 行）。

        it('调用 createDocumentDraftDAO 创建草稿（无 source 时 status=ready）', async () => {
            await createDraftService({ userId: 100, templateId: 1 })

            expect(mockCreateDocumentDraftDAO).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 100,
                    templateId: 1,
                    status: 'ready',
                }),
            )
        })

        it('传入 sourceText 时 status=drafting 并调用 enqueueRunService 入队 Worker', async () => {
            await createDraftService({ userId: 100, templateId: 1, sourceText: '原告是张三' })

            expect(mockCreateDocumentDraftDAO).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'drafting' }),
            )
            expect(mockEnqueueRunService).toHaveBeenCalledWith(
                expect.objectContaining({
                    sessionId: MOCK_SESSION.sessionId,
                    userId: 100,
                }),
            )
        })

        it('未传 source 时不调用 enqueueRunService（避免 Agent 空跑）', async () => {
            await createDraftService({ userId: 100, templateId: 1 })

            expect(mockEnqueueRunService).not.toHaveBeenCalled()
        })

        it('传入 sourceFileIds 时循环调用 ensureMaterialsReadyForDraftService（无 caseId 透传 null）', async () => {
            const result = await createDraftService({
                userId: 100,
                templateId: 1,
                sourceFileIds: [5, 6],
            })

            expect(mockEnsureMaterialsReadyForDraftService).toHaveBeenCalledTimes(2)
            expect(mockEnsureMaterialsReadyForDraftService).toHaveBeenCalledWith(5, MOCK_DRAFT.id, 100, null)
            expect(mockEnsureMaterialsReadyForDraftService).toHaveBeenCalledWith(6, MOCK_DRAFT.id, 100, null)
            expect(result).toHaveProperty('draftId')
        })

        it('传入 caseId + sourceFileIds 时，将 caseId 透传给 ensureMaterialsReadyForDraftService（双绑）', async () => {
            // Task 4: createDraftService 需把 draft.caseId 透传到 ensureMaterialsReady，
            // 以便 upsert 分支写入 caseMaterials 的 caseId 字段，形成 (caseId+draftId+ossFileId) 双绑
            const DRAFT_WITH_CASE = { ...MOCK_DRAFT, caseId: 77 }
            mockCreateDocumentDraftDAO.mockResolvedValue(DRAFT_WITH_CASE)

            await createDraftService({
                userId: 100,
                templateId: 1,
                caseId: 77,
                sourceFileIds: [5],
            })

            expect(mockEnsureMaterialsReadyForDraftService).toHaveBeenCalledTimes(1)
            expect(mockEnsureMaterialsReadyForDraftService).toHaveBeenCalledWith(5, DRAFT_WITH_CASE.id, 100, 77)
        })

        it('不传 sourceFileIds 时不调用 ensureMaterialsReadyForDraftService', async () => {
            await createDraftService({ userId: 100, templateId: 1 })

            expect(mockEnsureMaterialsReadyForDraftService).not.toHaveBeenCalled()
        })

        it('传入 sourceText 时写入 sourceRef.text', async () => {
            await createDraftService({
                userId: 100,
                templateId: 1,
                sourceText: '原告：张三',
            })

            expect(mockCreateDocumentDraftDAO).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourceRef: expect.objectContaining({ text: '原告：张三' }),
                }),
            )
        })
    })
})

// ==================== getDraftService ====================

describe('getDraftService', () => {
    it('草稿不存在时返回 { error, code: 404 }', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue(null)

        const result = await getDraftService(100, 999)
        expect(result).toEqual({ error: '草稿不存在', code: 404 })
    })

    it('userId 不匹配时返回 { error, code: 403 }', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT,
            userId: 200, // 不是调用者
        })

        const result = await getDraftService(100, MOCK_DRAFT.id)
        expect(result).toEqual({ error: '无权访问此草稿', code: 403 })
    })

    it('成功返回 draft 对象', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT,
            userId: 100,
            template: MOCK_GLOBAL_TEMPLATE,
        })

        const result = await getDraftService(100, MOCK_DRAFT.id)
        expect(result).toHaveProperty('draft')
        expect((result as any).draft.id).toBe(MOCK_DRAFT.id)
    })
})

// ==================== patchDraftService ====================

describe('patchDraftService', () => {
    describe('权限校验', () => {
        it('草稿不存在时返回 { error, code: 404 }', async () => {
            mockGetDocumentDraftDAO.mockResolvedValue(null)

            const result = await patchDraftService(100, 999, { values: { plaintiff: '张三' } })
            expect(result).toEqual({ error: '草稿不存在', code: 404 })
        })

        it('userId 不匹配时返回 { error, code: 403 }', async () => {
            mockGetDocumentDraftDAO.mockResolvedValue({
                ...MOCK_DRAFT,
                userId: 200,
                template: MOCK_GLOBAL_TEMPLATE,
            })

            const result = await patchDraftService(100, MOCK_DRAFT.id, { values: {} })
            expect(result).toEqual({ error: '无权修改此草稿', code: 403 })
        })
    })

    describe('status 409 保护', () => {
        it('status=drafting 时返回 { error, code: 409 }', async () => {
            mockGetDocumentDraftDAO.mockResolvedValue({
                ...MOCK_DRAFT,
                userId: 100,
                status: 'drafting',
                template: MOCK_GLOBAL_TEMPLATE,
            })

            const result = await patchDraftService(100, MOCK_DRAFT.id, { values: {} })
            expect(result).toEqual({ error: '草稿正在生成中，请稍后再修改', code: 409 })
        })

        it('status=filling 时返回 { error, code: 409 }', async () => {
            mockGetDocumentDraftDAO.mockResolvedValue({
                ...MOCK_DRAFT,
                userId: 100,
                status: 'filling',
                template: MOCK_GLOBAL_TEMPLATE,
            })

            const result = await patchDraftService(100, MOCK_DRAFT.id, { values: {} })
            expect(result).toEqual({ error: '草稿正在生成中，请稍后再修改', code: 409 })
        })

        it('status=ready 时允许修改', async () => {
            mockGetDocumentDraftDAO.mockResolvedValue({
                ...MOCK_DRAFT_READY,
                userId: 100,
                template: MOCK_GLOBAL_TEMPLATE,
            })

            const result = await patchDraftService(100, MOCK_DRAFT.id, {
                values: { plaintiff: '李四' },
            })

            expect(result).not.toHaveProperty('code', 409)
            expect(mockUpdateDocumentDraftDAO).toHaveBeenCalled()
        })
    })

    describe('values schema 校验', () => {
        it('多余的 key 会被过滤（只保留 template 定义的占位符）', async () => {
            mockGetDocumentDraftDAO.mockResolvedValue({
                ...MOCK_DRAFT_READY,
                userId: 100,
                template: MOCK_GLOBAL_TEMPLATE,
            })

            // template 只有 plaintiff，传入额外的 extra key
            await patchDraftService(100, MOCK_DRAFT.id, {
                values: { plaintiff: '张三', extra_key: '额外值' },
            })

            // updateDocumentDraftDAO 被调用时，values 中不应包含 extra_key
            expect(mockUpdateDocumentDraftDAO).toHaveBeenCalledWith(
                MOCK_DRAFT.id,
                expect.objectContaining({
                    values: expect.not.objectContaining({ extra_key: expect.anything() }),
                }),
            )
        })

        it('成功路径：符合 schema 的 values 写回 DB', async () => {
            mockGetDocumentDraftDAO.mockResolvedValue({
                ...MOCK_DRAFT_READY,
                userId: 100,
                template: MOCK_GLOBAL_TEMPLATE,
            })

            await patchDraftService(100, MOCK_DRAFT.id, {
                values: { plaintiff: '王五' },
            })

            expect(mockUpdateDocumentDraftDAO).toHaveBeenCalledWith(
                MOCK_DRAFT.id,
                expect.objectContaining({ values: expect.objectContaining({ plaintiff: '王五' }) }),
            )
        })
    })
})

// ==================== deleteDraftService ====================

describe('deleteDraftService', () => {
    it('草稿不存在时返回 { error, code: 404 }', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue(null)

        const result = await deleteDraftService(100, 999)
        expect(result).toEqual({ error: '草稿不存在', code: 404 })
        expect(mockSoftDeleteDocumentDraftDAO).not.toHaveBeenCalled()
    })

    it('userId 不匹配时返回 { error, code: 403 }', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT,
            userId: 200,
        })

        const result = await deleteDraftService(100, MOCK_DRAFT.id)
        expect(result).toEqual({ error: '无权删除此草稿', code: 403 })
        expect(mockSoftDeleteDocumentDraftDAO).not.toHaveBeenCalled()
    })

    it('成功软删自己的草稿，返回 { ok: true }', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT,
            userId: 100,
        })
        mockSoftDeleteDocumentDraftDAO.mockResolvedValue({ ...MOCK_DRAFT, deletedAt: new Date() })

        const result = await deleteDraftService(100, MOCK_DRAFT.id)
        expect(result).toEqual({ ok: true })
        expect(mockSoftDeleteDocumentDraftDAO).toHaveBeenCalledWith(MOCK_DRAFT.id)
    })
})
