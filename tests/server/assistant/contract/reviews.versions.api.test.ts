/**
 * 版本/风险/批注 API handler 测试（Task 3.1-3.9）
 *
 * 策略：直接 import handler default export，注入 mock event，
 * DAO/Service 层 mock 替换——避免真实数据库调用。
 *
 * 覆盖接口：
 *   - GET  /reviews/:id/versions
 *   - POST /reviews/:id/versions
 *   - GET  /reviews/versions/:versionId
 *   - PATCH /reviews/versions/:versionId
 *   - PATCH /reviews/risks/:riskId
 *   - POST /reviews/:id/annotations
 *   - PATCH /reviews/annotations/:annotationId
 *   - DELETE /reviews/annotations/:annotationId
 *   - GET  /reviews/:id（改造后）
 *
 * **Feature: contract-review-versioning-phase-a**
 * **Validates: Plan Task 3.1-3.9**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ==================== 全局 Stub（模拟 Nuxt nitro 自动导入）====================

const resError = (_event: unknown, code: number, message: string) => ({
    code,
    success: false,
    message,
    data: null,
})
const resSuccess = (_event: unknown, message: string, data: unknown) => ({
    code: 0,
    success: true,
    message,
    data,
});

(globalThis as Record<string, unknown>).resError = resError;
(globalThis as Record<string, unknown>).resSuccess = resSuccess;
(globalThis as Record<string, unknown>).defineEventHandler = (h: unknown) => h;
(globalThis as Record<string, unknown>).getRouterParam = (event: Record<string, unknown>, key: string) => (event.__params as Record<string, string>)?.[key];
(globalThis as Record<string, unknown>).readBody = (event: Record<string, unknown>) => Promise.resolve(event.__body);
(globalThis as Record<string, unknown>).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() }

// ==================== Mock DAO/Service 层 ====================

vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
}))
vi.mock('~~/server/agents/contract/contractReviewVersion.dao', () => ({
    listContractReviewVersionsDAO: vi.fn(),
    updateContractReviewVersionNoteDAO: vi.fn(),
    getContractReviewVersionByIdDAO: vi.fn(),
}))
vi.mock('~~/server/agents/contract/contractReviewVersion.service', () => ({
    saveContractReviewVersionService: vi.fn(),
    loadContractReviewVersionSnapshotService: vi.fn(),
    // ReviewNotFoundError 被 versions.post handler 用 instanceof 检测；mock 时必须导出真类
    // 而不是 vi.fn()，否则 versions.post.ts 的 catch 分支 `err instanceof ReviewNotFoundError`
    // 触发 ReferenceError。
    ReviewNotFoundError: class ReviewNotFoundError extends Error {
        constructor(reviewId: number) {
            super(`合同审查不存在或已删除：${reviewId}`)
            this.name = 'ReviewNotFoundError'
        }
    },
}))
vi.mock('~~/server/agents/contract/contractRisk.service', () => ({
    archiveContractRiskService: vi.fn(),
}))
vi.mock('~~/server/agents/contract/contractRisk.dao', () => ({
    listContractRisksDAO: vi.fn(),
    getContractRiskByIdDAO: vi.fn(),
}))
vi.mock('~~/server/agents/contract/contractAnnotation.service', () => ({
    createLawyerAnnotationService: vi.fn(),
    updateAnnotationContentService: vi.fn(),
    softDeleteAnnotationService: vi.fn(),
}))
vi.mock('~~/server/agents/contract/contractAnnotation.dao', () => ({
    listContractAnnotationsByReviewDAO: vi.fn(),
    getContractAnnotationByIdDAO: vi.fn(),
}))

import { getContractReviewDAO } from '~~/server/agents/contract/contractReview.dao'
import {
    listContractReviewVersionsDAO,
    updateContractReviewVersionNoteDAO,
    getContractReviewVersionByIdDAO,
} from '~~/server/agents/contract/contractReviewVersion.dao'
import {
    saveContractReviewVersionService,
    loadContractReviewVersionSnapshotService,
} from '~~/server/agents/contract/contractReviewVersion.service'
import { archiveContractRiskService } from '~~/server/agents/contract/contractRisk.service'
import { listContractRisksDAO } from '~~/server/agents/contract/contractRisk.dao'
import {
    createLawyerAnnotationService,
    updateAnnotationContentService,
    softDeleteAnnotationService,
} from '~~/server/agents/contract/contractAnnotation.service'
import { listContractAnnotationsByReviewDAO } from '~~/server/agents/contract/contractAnnotation.dao'

// ==================== 动态 import handlers ====================

const { default: versionsGetHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/version-list/[id].get'
)
const { default: versionsPostHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/version-list/[id].post'
)
const { default: versionIdGetHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/versions/[versionId].get'
)
const { default: versionIdPatchHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/versions/[versionId].patch'
)
const { default: riskIdPatchHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/risks/[riskId].patch'
)
const { default: annotationsPostHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/add-annotation/[id].post'
)
const { default: annotationIdPatchHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/annotations/[annotationId].patch'
)
const { default: annotationIdDeleteHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/annotations/[annotationId].delete'
)
const { default: reviewGetHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id].get'
)

// ==================== 工具函数 ====================

const USER_A = 1001
const USER_B = 1002

function makeEvent(opts: {
    userId?: number
    params?: Record<string, string>
    body?: unknown
}) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId, name: '测试律师' } } } : {},
        __params: opts.params,
        __body: opts.body,
    }
}

const fakeReview = {
    id: 1,
    userId: USER_A,
    sessionId: 'test-session',
    status: 'completed',
    contractType: '劳动合同',
    partyA: '甲方',
    partyB: '乙方',
    stance: 'balanced',
    risks: [{ level: 'high' }],
    summary: null,
    playbookSnapshot: null,
    originalFileId: 0,
    reviewedFileId: null,
    currentVersionId: 10,
    maxVersionNo: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
}

const mockGetReviewDAO = getContractReviewDAO as ReturnType<typeof vi.fn>
const mockListVersionsDAO = listContractReviewVersionsDAO as ReturnType<typeof vi.fn>
const mockUpdateVersionNoteDAO = updateContractReviewVersionNoteDAO as ReturnType<typeof vi.fn>
const mockGetVersionByIdDAO = getContractReviewVersionByIdDAO as ReturnType<typeof vi.fn>
const mockSaveVersionSvc = saveContractReviewVersionService as ReturnType<typeof vi.fn>
const mockLoadSnapshotSvc = loadContractReviewVersionSnapshotService as ReturnType<typeof vi.fn>
const mockArchiveRiskSvc = archiveContractRiskService as ReturnType<typeof vi.fn>
const mockListRisksDAO = listContractRisksDAO as ReturnType<typeof vi.fn>
const mockCreateAnnotationSvc = createLawyerAnnotationService as ReturnType<typeof vi.fn>
const mockUpdateAnnotationSvc = updateAnnotationContentService as ReturnType<typeof vi.fn>
const mockSoftDeleteAnnotationSvc = softDeleteAnnotationService as ReturnType<typeof vi.fn>
const mockListAnnotationsByReviewDAO = listContractAnnotationsByReviewDAO as ReturnType<typeof vi.fn>

// ==================== 测试 ====================

describe('版本/风险/批注 API handler（Task 3.1-3.9）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 默认 mock 返回：review 存在且属于 USER_A
        mockGetReviewDAO.mockResolvedValue(fakeReview)
    })

    // ======================================================
    // Task 3.1: GET /reviews/:id/versions
    // ======================================================
    describe('GET /reviews/:id/versions', () => {
        it('未登录返回 401', async () => {
            const res: any = await versionsGetHandler(makeEvent({ params: { id: '1' } }) as any)
            expect(res.code).toBe(401)
        })

        it('review 属于他人返回 403', async () => {
            const res: any = await versionsGetHandler(
                makeEvent({ userId: USER_B, params: { id: '1' } }) as any,
            )
            expect(res.code).toBe(403)
        })

        it('happy path 返回版本列表', async () => {
            mockListVersionsDAO.mockResolvedValue([
                {
                    id: 10,
                    reviewId: 1,
                    versionNumber: 1,
                    systemLabel: 'initial_upload',
                    lawyerNote: null,
                    createdById: USER_A,
                    createdAt: new Date('2026-04-22T00:00:00Z'),
                    createdBy: { name: '测试律师' },
                },
            ])

            const res: any = await versionsGetHandler(
                makeEvent({ userId: USER_A, params: { id: '1' } }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.versions).toHaveLength(1)
            expect(res.data.versions[0].versionNumber).toBe(1)
            expect(res.data.versions[0].systemLabel).toBe('initial_upload')
            expect(res.data.currentVersionId).toBe(10)
            expect(res.data.maxVersionNo).toBe(1)
        })
    })

    // ======================================================
    // Task 3.2: POST /reviews/:id/versions
    // ======================================================
    describe('POST /reviews/:id/versions', () => {
        it('未登录返回 401', async () => {
            const res: any = await versionsPostHandler(makeEvent({ params: { id: '1' } }) as any)
            expect(res.code).toBe(401)
        })

        it('lawyerNote 超过 200 字返回 400', async () => {
            const res: any = await versionsPostHandler(
                makeEvent({
                    userId: USER_A,
                    params: { id: '1' },
                    body: { lawyerNote: 'x'.repeat(201) },
                }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('happy path 返回新版本信息', async () => {
            mockSaveVersionSvc.mockResolvedValue({
                id: 11,
                versionNumber: 2,
                systemLabel: 'lawyer_save',
                lawyerNote: '审阅完毕',
                createdAt: new Date('2026-04-22T01:00:00Z'),
            })

            const res: any = await versionsPostHandler(
                makeEvent({
                    userId: USER_A,
                    params: { id: '1' },
                    body: { lawyerNote: '审阅完毕' },
                }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.versionNumber).toBe(2)
            expect(res.data.systemLabel).toBe('lawyer_save')
            expect(res.data.lawyerNote).toBe('审阅完毕')
        })

        it('P2002 并发冲突返回 409', async () => {
            mockSaveVersionSvc.mockRejectedValue({ code: 'P2002' })

            const res: any = await versionsPostHandler(
                makeEvent({
                    userId: USER_A,
                    params: { id: '1' },
                    body: {},
                }) as any,
            )

            expect(res.code).toBe(409)
        })
    })

    // ======================================================
    // Task 3.3: GET /reviews/versions/:versionId
    // ======================================================
    describe('GET /reviews/versions/:versionId', () => {
        it('未登录返回 401', async () => {
            const res: any = await versionIdGetHandler(makeEvent({ params: { versionId: '10' } }) as any)
            expect(res.code).toBe(401)
        })

        it('version 不存在返回 404（guard 阶段）', async () => {
            mockGetVersionByIdDAO.mockResolvedValue(null)

            const res: any = await versionIdGetHandler(
                makeEvent({ userId: USER_A, params: { versionId: '999' } }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('happy path 返回快照数据', async () => {
            mockGetVersionByIdDAO.mockResolvedValue({ id: 10, reviewId: 1 })
            mockLoadSnapshotSvc.mockResolvedValue({
                data: {
                    id: 10,
                    reviewId: 1,
                    versionNumber: 1,
                    systemLabel: 'initial_upload',
                    lawyerNote: null,
                    createdById: USER_A,
                    createdByName: '测试律师',
                    createdAt: '2026-04-22T00:00:00.000Z',
                    snapshot: { risks: [], annotations: [], docxText: '合同正文' },
                },
            })

            const res: any = await versionIdGetHandler(
                makeEvent({ userId: USER_A, params: { versionId: '10' } }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.versionNumber).toBe(1)
            expect(res.data.snapshot.docxText).toBe('合同正文')
        })

        it('service 返回 error 时返回 404', async () => {
            mockGetVersionByIdDAO.mockResolvedValue({ id: 10, reviewId: 1 })
            mockLoadSnapshotSvc.mockResolvedValue({ error: 'version_not_found' })

            const res: any = await versionIdGetHandler(
                makeEvent({ userId: USER_A, params: { versionId: '10' } }) as any,
            )
            expect(res.code).toBe(404)
        })
    })

    // ======================================================
    // Task 3.4: PATCH /reviews/versions/:versionId
    // ======================================================
    describe('PATCH /reviews/versions/:versionId', () => {
        it('未登录返回 401', async () => {
            const res: any = await versionIdPatchHandler(makeEvent({ params: { versionId: '10' } }) as any)
            expect(res.code).toBe(401)
        })

        it('lawyerNote 超过 200 字返回 400', async () => {
            mockGetVersionByIdDAO.mockResolvedValue({ id: 10, reviewId: 1 })
            const res: any = await versionIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { versionId: '10' },
                    body: { lawyerNote: 'x'.repeat(201) },
                }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('happy path 成功更新备注', async () => {
            mockGetVersionByIdDAO.mockResolvedValue({ id: 10, reviewId: 1 })
            mockUpdateVersionNoteDAO.mockResolvedValue({
                id: 10,
                lawyerNote: '新备注',
            })

            const res: any = await versionIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { versionId: '10' },
                    body: { lawyerNote: '新备注' },
                }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.lawyerNote).toBe('新备注')
        })

        it('lawyerNote 为 null 时清空备注', async () => {
            mockGetVersionByIdDAO.mockResolvedValue({ id: 10, reviewId: 1 })
            mockUpdateVersionNoteDAO.mockResolvedValue({ id: 10, lawyerNote: null })

            const res: any = await versionIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { versionId: '10' },
                    body: { lawyerNote: null },
                }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.lawyerNote).toBeNull()
        })
    })

    // ======================================================
    // Task 3.5: PATCH /reviews/risks/:riskId
    // ======================================================
    describe('PATCH /reviews/risks/:riskId', () => {
        beforeEach(() => {
            // 子资源 guard 需要先查版本/风险的 reviewId，mock contractRisk.dao
            // 但这里 guard 走的是 loadOwnedReviewByRiskId，需要 getContractRiskByIdDAO
        })

        it('未登录返回 401', async () => {
            const res: any = await riskIdPatchHandler(makeEvent({ params: { riskId: '5' } }) as any)
            expect(res.code).toBe(401)
        })

        it('参数缺失 archivedStatus 返回 400', async () => {
            // mock getContractRiskByIdDAO for guard
            const mockGetRiskById = (await import('~~/server/agents/contract/contractRisk.dao')).getContractRiskByIdDAO as ReturnType<typeof vi.fn>
            mockGetRiskById.mockResolvedValue({ id: 5, reviewId: 1 })

            const res: any = await riskIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { riskId: '5' },
                    body: { archivedStatus: 'invalid_status' },
                }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('happy path 处置风险为 handled', async () => {
            const mockGetRiskById = (await import('~~/server/agents/contract/contractRisk.dao')).getContractRiskByIdDAO as ReturnType<typeof vi.fn>
            mockGetRiskById.mockResolvedValue({ id: 5, reviewId: 1 })
            mockArchiveRiskSvc.mockResolvedValue({
                id: 5,
                archivedStatus: 'handled',
                archivedAt: new Date(),
            })

            const res: any = await riskIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { riskId: '5' },
                    body: { archivedStatus: 'handled' },
                }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.archivedStatus).toBe('handled')
        })

        it('archivedStatus 置 null 时取消处置', async () => {
            const mockGetRiskById = (await import('~~/server/agents/contract/contractRisk.dao')).getContractRiskByIdDAO as ReturnType<typeof vi.fn>
            mockGetRiskById.mockResolvedValue({ id: 5, reviewId: 1 })
            mockArchiveRiskSvc.mockResolvedValue({
                id: 5,
                archivedStatus: null,
                archivedAt: null,
            })

            const res: any = await riskIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { riskId: '5' },
                    body: { archivedStatus: null },
                }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.archivedStatus).toBeNull()
            expect(res.data.archivedAt).toBeNull()
        })
    })

    // ======================================================
    // Task 3.6: POST /reviews/:id/annotations
    // ======================================================
    describe('POST /reviews/:id/annotations', () => {
        it('未登录返回 401', async () => {
            const res: any = await annotationsPostHandler(makeEvent({ params: { id: '1' } }) as any)
            expect(res.code).toBe(401)
        })

        it('content 为空返回 400', async () => {
            const res: any = await annotationsPostHandler(
                makeEvent({
                    userId: USER_A,
                    params: { id: '1' },
                    body: { riskId: 5, content: '' },
                }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('content 超过 2000 字返回 400', async () => {
            const res: any = await annotationsPostHandler(
                makeEvent({
                    userId: USER_A,
                    params: { id: '1' },
                    body: { riskId: 5, content: 'x'.repeat(2001) },
                }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('风险不存在返回 404', async () => {
            mockCreateAnnotationSvc.mockResolvedValue({ error: 'risk_not_found' })

            const res: any = await annotationsPostHandler(
                makeEvent({
                    userId: USER_A,
                    params: { id: '1' },
                    body: { riskId: 999, content: '测试批注' },
                }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('happy path 成功创建批注', async () => {
            mockCreateAnnotationSvc.mockResolvedValue({
                annotation: {
                    id: 100,
                    riskId: 5,
                    parentAnnotationId: null,
                    authorType: 'lawyer',
                    authorName: '测试律师',
                    authorUserId: USER_A,
                    content: '合同条款有问题',
                    createdAt: new Date('2026-04-22T00:00:00Z'),
                },
            })

            const res: any = await annotationsPostHandler(
                makeEvent({
                    userId: USER_A,
                    params: { id: '1' },
                    body: { riskId: 5, content: '合同条款有问题' },
                }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.authorType).toBe('lawyer')
            expect(res.data.content).toBe('合同条款有问题')
        })
    })

    // ======================================================
    // Task 3.7: PATCH /reviews/annotations/:annotationId
    // ======================================================
    describe('PATCH /reviews/annotations/:annotationId', () => {
        beforeEach(() => {
            // mock getContractAnnotationByIdDAO for guard
        })

        it('未登录返回 401', async () => {
            const res: any = await annotationIdPatchHandler(makeEvent({ params: { annotationId: '100' } }) as any)
            expect(res.code).toBe(401)
        })

        it('content 为空返回 400', async () => {
            const mockGetAnnotById = (await import('~~/server/agents/contract/contractAnnotation.dao')).getContractAnnotationByIdDAO as ReturnType<typeof vi.fn>
            mockGetAnnotById.mockResolvedValue({ id: 100, reviewId: 1 })

            const res: any = await annotationIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { annotationId: '100' },
                    body: { content: '' },
                }) as any,
            )
            expect(res.code).toBe(400)
        })

        it('修改他人批注返回 403', async () => {
            const mockGetAnnotById = (await import('~~/server/agents/contract/contractAnnotation.dao')).getContractAnnotationByIdDAO as ReturnType<typeof vi.fn>
            mockGetAnnotById.mockResolvedValue({ id: 100, reviewId: 1 })
            mockUpdateAnnotationSvc.mockResolvedValue({ error: 'not_own' })

            const res: any = await annotationIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { annotationId: '100' },
                    body: { content: '修改内容' },
                }) as any,
            )
            expect(res.code).toBe(403)
        })

        it('happy path 成功修改批注', async () => {
            const mockGetAnnotById = (await import('~~/server/agents/contract/contractAnnotation.dao')).getContractAnnotationByIdDAO as ReturnType<typeof vi.fn>
            mockGetAnnotById.mockResolvedValue({ id: 100, reviewId: 1 })
            mockUpdateAnnotationSvc.mockResolvedValue({
                annotation: { id: 100, content: '已修改内容' },
            })

            const res: any = await annotationIdPatchHandler(
                makeEvent({
                    userId: USER_A,
                    params: { annotationId: '100' },
                    body: { content: '已修改内容' },
                }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.content).toBe('已修改内容')
        })
    })

    // ======================================================
    // Task 3.8: DELETE /reviews/annotations/:annotationId
    // ======================================================
    describe('DELETE /reviews/annotations/:annotationId', () => {
        it('未登录返回 401', async () => {
            const res: any = await annotationIdDeleteHandler(makeEvent({ params: { annotationId: '100' } }) as any)
            expect(res.code).toBe(401)
        })

        it('删除他人批注返回 403', async () => {
            const mockGetAnnotById = (await import('~~/server/agents/contract/contractAnnotation.dao')).getContractAnnotationByIdDAO as ReturnType<typeof vi.fn>
            mockGetAnnotById.mockResolvedValue({ id: 100, reviewId: 1 })
            mockSoftDeleteAnnotationSvc.mockResolvedValue({ error: 'not_own' })

            const res: any = await annotationIdDeleteHandler(
                makeEvent({ userId: USER_A, params: { annotationId: '100' } }) as any,
            )
            expect(res.code).toBe(403)
        })

        it('批注不存在返回 404', async () => {
            const mockGetAnnotById = (await import('~~/server/agents/contract/contractAnnotation.dao')).getContractAnnotationByIdDAO as ReturnType<typeof vi.fn>
            mockGetAnnotById.mockResolvedValue({ id: 100, reviewId: 1 })
            mockSoftDeleteAnnotationSvc.mockResolvedValue({ error: 'not_found' })

            const res: any = await annotationIdDeleteHandler(
                makeEvent({ userId: USER_A, params: { annotationId: '100' } }) as any,
            )
            expect(res.code).toBe(404)
        })

        it('happy path 软删成功', async () => {
            const mockGetAnnotById = (await import('~~/server/agents/contract/contractAnnotation.dao')).getContractAnnotationByIdDAO as ReturnType<typeof vi.fn>
            mockGetAnnotById.mockResolvedValue({ id: 100, reviewId: 1 })
            mockSoftDeleteAnnotationSvc.mockResolvedValue({ ok: true })

            const res: any = await annotationIdDeleteHandler(
                makeEvent({ userId: USER_A, params: { annotationId: '100' } }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.deleted).toBe(true)
        })
    })

    // ======================================================
    // Task 3.9: GET /reviews/:id（改造后）
    // ======================================================
    describe('GET /reviews/:id（改造后兼容逻辑）', () => {
        it('currentVersionId === null 时回退到 legacy risks JSON', async () => {
            const legacyReview = {
                ...fakeReview,
                currentVersionId: null,
                risks: [{ level: 'high', description: 'legacy risk' }],
            }
            mockGetReviewDAO.mockResolvedValue(legacyReview)

            const res: any = await reviewGetHandler(
                makeEvent({ userId: USER_A, params: { id: '1' } }) as any,
            )

            expect(res.success).toBe(true)
            // legacy 数据直接返回 risks JSON，不走新表
            expect(res.data.review.risks).toEqual([{ level: 'high', description: 'legacy risk' }])
            expect(mockListRisksDAO).not.toHaveBeenCalled()
        })

        it('currentVersionId 有值时从新表读 risks + annotations', async () => {
            mockListRisksDAO.mockResolvedValue([
                {
                    id: 5,
                    reviewId: 1,
                    source: 'ai',
                    category: '试用期',
                    level: 'high',
                    stance: 'balanced',
                    problem: '超长',
                    legalBasis: null,
                    analysis: null,
                    suggestion: null,
                    archivedStatus: null,
                    archivedAt: null,
                    clauseText: 'x',
                    clauseParagraphIndex: null,
                    clauseCharStart: null,
                    clauseCharEnd: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ])
            mockListAnnotationsByReviewDAO.mockResolvedValue([
                {
                    id: 100,
                    reviewId: 1,
                    riskId: 5,
                    parentAnnotationId: null,
                    authorType: 'ai',
                    authorName: 'AI',
                    authorUserId: null,
                    content: 'AI 分析内容',
                    deletedAt: null,
                    createdAt: new Date(),
                },
            ])

            const res: any = await reviewGetHandler(
                makeEvent({ userId: USER_A, params: { id: '1' } }) as any,
            )

            expect(res.success).toBe(true)
            expect(res.data.review.risks).toHaveLength(1)
            expect(res.data.review.risks[0].annotations).toHaveLength(1)
            expect(res.data.review.risks[0].annotations[0].content).toBe('AI 分析内容')
            expect(res.data.review.currentVersionId).toBe(10)
            expect(res.data.review.maxVersionNo).toBe(1)
        })

        it('返回字段包含 currentVersionId 和 maxVersionNo', async () => {
            mockListRisksDAO.mockResolvedValue([])
            mockListAnnotationsByReviewDAO.mockResolvedValue([])

            const res: any = await reviewGetHandler(
                makeEvent({ userId: USER_A, params: { id: '1' } }) as any,
            )

            expect(res.data.review).toHaveProperty('currentVersionId')
            expect(res.data.review).toHaveProperty('maxVersionNo')
        })
    })
})
