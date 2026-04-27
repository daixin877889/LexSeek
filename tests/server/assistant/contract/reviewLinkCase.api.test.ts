/**
 * PATCH /api/v1/assistant/contract/reviews/:id 关联案件 · service + handler 测试
 *
 * 阶段 5 · 法律助手「+ 关联案件」入口（合同审查工作台来源条）。
 *
 * **Feature: ai-unify-stage-5**
 * **Validates: Task 7 · PATCH 合同审查关联案件 API**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '~~/generated/prisma/client'
import { CaseStatus } from '#shared/types/case'
import '../../case/test-setup'

// ==================== Mock DAO ====================

vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    updateContractReviewDAO: vi.fn(),
    createContractReviewDAO: vi.fn(),
    findContractReviewBySessionIdDAO: vi.fn(),
    softDeleteContractReviewDAO: vi.fn(),
    patchReviewRisksDAO: vi.fn(),
    PatchReviewRisksUnknownIdsError: class extends Error {},
    atomicSetRebuildingDAO: vi.fn(),
    setCompletedAfterRebuildDAO: vi.fn(),
    rollbackRebuildDAO: vi.fn(),
    listUserReviewsDAO: vi.fn(),
    listAdminReviewsDAO: vi.fn(),
    getAdminReviewDAO: vi.fn(),
    findReviewingTimeoutDAO: vi.fn(),
    softDeleteAdminReviewDAO: vi.fn(),
}))

// 屏蔽其他重依赖以加速 import 链
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentRun.service', () => ({
    enqueueRunService: vi.fn(),
}))
vi.mock('~~/server/agents/contract/textToDocx.service', () => ({
    textToDocxService: vi.fn(),
}))
vi.mock('~~/server/agents/contract/utils/uploadAndRegisterOssFile', () => ({
    uploadAndRegisterOssFile: vi.fn(),
}))

import { linkReviewToCaseService } from '~~/server/agents/contract/contractReview.service'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/agents/contract/contractReview.dao'

const mockGetReview = getContractReviewDAO as ReturnType<typeof vi.fn>
const mockUpdateReview = updateContractReviewDAO as ReturnType<typeof vi.fn>

// ==================== 替换全局 prisma.cases.findFirst ====================

type CasesFindFirst = PrismaClient['cases']['findFirst']
const testPrisma = (globalThis as unknown as { prisma: PrismaClient }).prisma
let __origFindFirst: CasesFindFirst | null = null

const USER_ID = 100
const OTHER_USER_ID = 200
const REVIEW_ID = 30
const CASE_ID = 50

const MOCK_REVIEW = {
    id: REVIEW_ID,
    userId: USER_ID,
    caseId: null,
    status: 'completed',
}

beforeEach(() => {
    vi.resetAllMocks()
    __origFindFirst = testPrisma.cases.findFirst.bind(testPrisma.cases)
    testPrisma.cases.findFirst = vi.fn() as unknown as CasesFindFirst
    mockUpdateReview.mockResolvedValue({ ...MOCK_REVIEW, caseId: CASE_ID })
})

afterEach(() => {
    vi.clearAllMocks()
    if (__origFindFirst) {
        testPrisma.cases.findFirst = __origFindFirst
        __origFindFirst = null
    }
})

// ==================== Service 测试 ====================

describe('linkReviewToCaseService · 关联合同审查到案件', () => {
    it('审查不存在返回 404', async () => {
        mockGetReview.mockResolvedValue(null)
        const res = await linkReviewToCaseService(USER_ID, 999, CASE_ID)
        expect(res).toEqual({ error: '合同审查不存在', code: 404 })
        expect(mockUpdateReview).not.toHaveBeenCalled()
    })

    it('修改他人审查返回 403', async () => {
        mockGetReview.mockResolvedValue({ ...MOCK_REVIEW, userId: OTHER_USER_ID })
        const res = await linkReviewToCaseService(USER_ID, REVIEW_ID, CASE_ID)
        expect(res).toEqual({ error: '无权修改该合同审查', code: 403 })
        expect(mockUpdateReview).not.toHaveBeenCalled()
    })

    it('案件不存在或不归属当前用户返回 403', async () => {
        mockGetReview.mockResolvedValue(MOCK_REVIEW)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue(null)
        const res = await linkReviewToCaseService(USER_ID, REVIEW_ID, CASE_ID)
        expect(res).toEqual({ error: '案件不存在或无权访问', code: 403 })
        expect(mockUpdateReview).not.toHaveBeenCalled()
    })

    it('案件已归档返回 409', async () => {
        mockGetReview.mockResolvedValue(MOCK_REVIEW)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue({
            id: CASE_ID,
            status: CaseStatus.ARCHIVED,
        })
        const res = await linkReviewToCaseService(USER_ID, REVIEW_ID, CASE_ID)
        expect(res).toEqual({ error: '案件已归档，不可关联', code: 409 })
        expect(mockUpdateReview).not.toHaveBeenCalled()
    })

    it('成功关联：写入 caseId', async () => {
        mockGetReview.mockResolvedValue(MOCK_REVIEW)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue({
            id: CASE_ID,
            status: CaseStatus.CONSULTING,
        })
        const res = await linkReviewToCaseService(USER_ID, REVIEW_ID, CASE_ID)
        expect('error' in res).toBe(false)
        expect(mockUpdateReview).toHaveBeenCalledWith(REVIEW_ID, { caseId: CASE_ID })
    })

    it('解绑（caseId=null）：跳过案件校验直接写入 null', async () => {
        mockGetReview.mockResolvedValue({ ...MOCK_REVIEW, caseId: CASE_ID })
        const res = await linkReviewToCaseService(USER_ID, REVIEW_ID, null)
        expect('error' in res).toBe(false)
        expect(testPrisma.cases.findFirst).not.toHaveBeenCalled()
        expect(mockUpdateReview).toHaveBeenCalledWith(REVIEW_ID, { caseId: null })
    })
})

// ==================== Handler 测试 ====================

const resErrorStub = (_e: any, code: number, message: string) => ({ code, success: false, message })
const resSuccessStub = (_e: any, message: string, data: any) => ({ code: 0, success: true, message, data })

;(globalThis as any).resError = resErrorStub
;(globalThis as any).resSuccess = resSuccessStub
;(globalThis as any).defineEventHandler = (h: any) => h
;(globalThis as any).readBody = async (event: any) => event.__body
;(globalThis as any).getRouterParam = (event: any, key: string) => event.__params?.[key]

const { default: patchHandler } = await import(
    '../../../../server/api/v1/assistant/contract/reviews/[id].patch'
)

function makeEvent(opts: { userId?: number; params?: Record<string, string>; body?: any }) {
    return {
        context: opts.userId ? { auth: { user: { id: opts.userId } } } : {},
        __params: opts.params,
        __body: opts.body,
    }
}

describe('PATCH /api/v1/assistant/contract/reviews/:id · handler', () => {
    it('未登录返回 401', async () => {
        const res: any = await patchHandler(makeEvent({ params: { id: '1' }, body: { caseId: 5 } }) as any)
        expect(res.code).toBe(401)
    })

    it('id 非数字返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({ userId: USER_ID, params: { id: 'abc' }, body: { caseId: 5 } }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('缺少 caseId 字段返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({ userId: USER_ID, params: { id: '1' }, body: {} }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('caseId 为 0 返回 400', async () => {
        const res: any = await patchHandler(
            makeEvent({ userId: USER_ID, params: { id: '1' }, body: { caseId: 0 } }) as any,
        )
        expect(res.code).toBe(400)
    })

    it('成功关联返回 review', async () => {
        mockGetReview.mockResolvedValue(MOCK_REVIEW)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue({
            id: CASE_ID,
            status: CaseStatus.CONSULTING,
        })
        const res: any = await patchHandler(
            makeEvent({ userId: USER_ID, params: { id: String(REVIEW_ID) }, body: { caseId: CASE_ID } }) as any,
        )
        expect(res.success).toBe(true)
        expect(res.message).toBe('关联成功')
        expect(res.data.review).toBeDefined()
    })

    it('解绑（caseId=null）成功', async () => {
        mockGetReview.mockResolvedValue({ ...MOCK_REVIEW, caseId: CASE_ID })
        mockUpdateReview.mockResolvedValueOnce({ ...MOCK_REVIEW, caseId: null })
        const res: any = await patchHandler(
            makeEvent({ userId: USER_ID, params: { id: String(REVIEW_ID) }, body: { caseId: null } }) as any,
        )
        expect(res.success).toBe(true)
        expect(mockUpdateReview).toHaveBeenCalledWith(REVIEW_ID, { caseId: null })
    })

    it('案件无权访问返回 403', async () => {
        mockGetReview.mockResolvedValue(MOCK_REVIEW)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue(null)
        const res: any = await patchHandler(
            makeEvent({ userId: USER_ID, params: { id: String(REVIEW_ID) }, body: { caseId: 999 } }) as any,
        )
        expect(res.code).toBe(403)
    })

    it('案件已归档返回 409', async () => {
        mockGetReview.mockResolvedValue(MOCK_REVIEW)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue({
            id: CASE_ID,
            status: CaseStatus.ARCHIVED,
        })
        const res: any = await patchHandler(
            makeEvent({ userId: USER_ID, params: { id: String(REVIEW_ID) }, body: { caseId: CASE_ID } }) as any,
        )
        expect(res.code).toBe(409)
    })
})
