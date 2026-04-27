/**
 * linkDraftToCaseService 测试（Mock）
 *
 * 阶段 5 · 关联 / 解绑文书草稿到案件。
 *
 * **Feature: ai-unify-stage-5**
 * **Validates: Task 6 · PATCH 文书草稿关联案件 API**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '~~/generated/prisma/client'
import { CaseStatus } from '#shared/types/case'
import '../../case/test-setup'

// ==================== Mock DAO ====================

vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    getDocumentDraftDAO: vi.fn(),
    updateDocumentDraftDAO: vi.fn(),
    // 以下 DAO 在 service 文件 import 时存在，需 mock 以免报错
    createDocumentDraftDAO: vi.fn(),
    softDeleteDocumentDraftDAO: vi.fn(),
    updateDraftTitleDAO: vi.fn(),
    updateDraftTitleIfNotOverriddenDAO: vi.fn(),
}))
vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentRun.service', () => ({
    enqueueRunService: vi.fn(),
}))
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyForDraftService: vi.fn(),
}))

import { linkDraftToCaseService } from '~~/server/agents/document/documentDraft.service'
import {
    getDocumentDraftDAO,
    updateDocumentDraftDAO,
} from '~~/server/agents/document/documentDraft.dao'

const mockGetDraft = getDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockUpdateDraft = updateDocumentDraftDAO as ReturnType<typeof vi.fn>

// ==================== 替换全局 prisma.cases.findFirst ====================

type CasesFindFirst = PrismaClient['cases']['findFirst']
const testPrisma = (globalThis as unknown as { prisma: PrismaClient }).prisma
let __origFindFirst: CasesFindFirst | null = null

const USER_ID = 100
const OTHER_USER_ID = 200
const DRAFT_ID = 10
const CASE_ID = 50

const MOCK_DRAFT = {
    id: DRAFT_ID,
    userId: USER_ID,
    caseId: null,
    status: 'ready',
}

beforeEach(() => {
    vi.resetAllMocks()
    __origFindFirst = testPrisma.cases.findFirst.bind(testPrisma.cases)
    testPrisma.cases.findFirst = vi.fn() as unknown as CasesFindFirst

    mockUpdateDraft.mockResolvedValue({ ...MOCK_DRAFT, caseId: CASE_ID })
})

afterEach(() => {
    vi.clearAllMocks()
    if (__origFindFirst) {
        testPrisma.cases.findFirst = __origFindFirst
        __origFindFirst = null
    }
})

describe('linkDraftToCaseService · 关联草稿到案件', () => {
    it('草稿不存在返回 404', async () => {
        mockGetDraft.mockResolvedValue(null)
        const res = await linkDraftToCaseService(USER_ID, 999, CASE_ID)
        expect(res).toEqual({ error: '草稿不存在', code: 404 })
        expect(mockUpdateDraft).not.toHaveBeenCalled()
    })

    it('修改他人草稿返回 403', async () => {
        mockGetDraft.mockResolvedValue({ ...MOCK_DRAFT, userId: OTHER_USER_ID })
        const res = await linkDraftToCaseService(USER_ID, DRAFT_ID, CASE_ID)
        expect(res).toEqual({ error: '无权修改此草稿', code: 403 })
        expect(mockUpdateDraft).not.toHaveBeenCalled()
    })

    it('案件不存在或不归属当前用户返回 403', async () => {
        mockGetDraft.mockResolvedValue(MOCK_DRAFT)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue(null)
        const res = await linkDraftToCaseService(USER_ID, DRAFT_ID, CASE_ID)
        expect(res).toEqual({ error: '案件不存在或无权访问', code: 403 })
        expect(mockUpdateDraft).not.toHaveBeenCalled()
    })

    it('案件已归档返回 409', async () => {
        mockGetDraft.mockResolvedValue(MOCK_DRAFT)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue({
            id: CASE_ID,
            status: CaseStatus.ARCHIVED,
        })
        const res = await linkDraftToCaseService(USER_ID, DRAFT_ID, CASE_ID)
        expect(res).toEqual({ error: '案件已归档，不可关联', code: 409 })
        expect(mockUpdateDraft).not.toHaveBeenCalled()
    })

    it('成功关联：写入 caseId', async () => {
        mockGetDraft.mockResolvedValue(MOCK_DRAFT)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue({
            id: CASE_ID,
            status: CaseStatus.CONSULTING,
        })
        const res = await linkDraftToCaseService(USER_ID, DRAFT_ID, CASE_ID)
        expect('error' in res).toBe(false)
        expect(mockUpdateDraft).toHaveBeenCalledWith(DRAFT_ID, { caseId: CASE_ID })
    })

    it('解绑（caseId=null）：跳过案件校验直接写入 null', async () => {
        mockGetDraft.mockResolvedValue({ ...MOCK_DRAFT, caseId: CASE_ID })
        const res = await linkDraftToCaseService(USER_ID, DRAFT_ID, null)
        expect('error' in res).toBe(false)
        expect(testPrisma.cases.findFirst).not.toHaveBeenCalled()
        expect(mockUpdateDraft).toHaveBeenCalledWith(DRAFT_ID, { caseId: null })
    })

    it('一审状态案件可正常关联', async () => {
        mockGetDraft.mockResolvedValue(MOCK_DRAFT)
        ;(testPrisma.cases.findFirst as any).mockResolvedValue({
            id: CASE_ID,
            status: CaseStatus.FIRST_TRIAL,
        })
        const res = await linkDraftToCaseService(USER_ID, DRAFT_ID, CASE_ID)
        expect('error' in res).toBe(false)
    })
})
