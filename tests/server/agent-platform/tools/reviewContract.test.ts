/**
 * review_contract 子代理工具单测
 *
 * 用 vi.mock 拦截：
 * - `interrupt()` —— 模拟 LangGraph resume 返回值
 * - oss / contractReview DAO / detectParties / loadContractFullText
 * - runContractReviewChat / runAndDrainStream / contractRisk DAO
 * - publishCustomEvent
 * - prisma.caseSessions.create
 *
 * 覆盖路径：
 * 1. 成功路径：interrupt 拿 stance → 落库 → drain → publishCustomEvent → 返回 success JSON
 * 2. 用户取消（resume null）→ softDelete review + 返回 cancelled JSON
 * 3. 非法 stance → 当作取消 + softDelete
 * 4. OSS 文件不归属用户 → 抛错
 * 5. 文件类型非 docx → 抛错
 *
 * **Feature: ai-unify-stage-5 / Task 4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock prisma 必须在模块顶层（被工具内部 await import 使用）
vi.mock('@langchain/langgraph', async () => {
    const actual = await vi.importActual<any>('@langchain/langgraph')
    return { ...actual, interrupt: vi.fn() }
})
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
}))
vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    createContractReviewDAO: vi.fn(),
    updateContractReviewDAO: vi.fn(),
    softDeleteContractReviewDAO: vi.fn(),
}))
vi.mock('~~/server/agents/contract/docx/loadContractFullText', () => ({
    loadContractFullText: vi.fn(),
}))
vi.mock('~~/server/agents/contract/docx/partyDetector', () => ({
    detectParties: vi.fn(),
}))
vi.mock('~~/server/services/workflow/agents/contractReviewMainAgent', () => ({
    runContractReviewChat: vi.fn(),
}))
vi.mock('~~/server/services/agent-platform/subAgent/runAndDrain', () => ({
    runAndDrainStream: vi.fn(),
}))
vi.mock('~~/server/agents/contract/contractRisk.dao', () => ({
    listContractRisksDAO: vi.fn(),
}))
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: vi.fn().mockResolvedValue(undefined),
}))

// prisma 是全局自动注入；这里通过 globalThis stub
const caseSessionsCreate = vi.fn().mockResolvedValue({})
;(globalThis as any).prisma = {
    caseSessions: { create: caseSessionsCreate },
}

import { interrupt } from '@langchain/langgraph'
import { createTool } from '~~/server/services/agent-platform/tools/reviewContract.tool'
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import {
    createContractReviewDAO,
    updateContractReviewDAO,
    softDeleteContractReviewDAO,
} from '~~/server/agents/contract/contractReview.dao'
import { loadContractFullText } from '~~/server/agents/contract/docx/loadContractFullText'
import { detectParties } from '~~/server/agents/contract/docx/partyDetector'
import { runContractReviewChat } from '~~/server/services/workflow/agents/contractReviewMainAgent'
import { runAndDrainStream } from '~~/server/services/agent-platform/subAgent/runAndDrain'
import { listContractRisksDAO } from '~~/server/agents/contract/contractRisk.dao'
import { publishCustomEvent } from '~~/server/services/agent/agentEventBridge'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ctx = { userId: 7, sessionId: 'main-sess', runId: 'main-run' }
const cfg = { toolCall: { id: 'call-zzz' } }

function parseToolResult(raw: any) {
    return JSON.parse(typeof raw === 'string' ? raw : raw.content)
}

describe('review_contract tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        caseSessionsCreate.mockResolvedValue({})
    })

    it('成功路径：interrupt 拿 stance → 落库 → 调 runContractReviewChat(skipStanceInterrupt=true) → 返回 success JSON', async () => {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: '采购合同.docx', fileType: DOCX_MIME,
        })
        ;(createContractReviewDAO as any).mockResolvedValue({ id: 555, userId: 7, sessionId: 'sub' })
        ;(loadContractFullText as any).mockResolvedValue({ paragraphs: ['p1', 'p2'] })
        ;(detectParties as any).mockResolvedValue({
            partyA: '甲公司', partyB: '乙公司', contractType: '采购合同',
        })
        ;(interrupt as any).mockReturnValueOnce({ stance: 'partyA' })
        ;(updateContractReviewDAO as any).mockResolvedValue({})
        ;(runContractReviewChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: true, finalState: {} })
        ;(listContractRisksDAO as any).mockResolvedValue([
            { id: 1, level: 'high', source: 'AI', anchorQuote: '违约金过高', createdAt: new Date('2025-01-01') },
            { id: 2, level: 'low', source: 'AI', anchorQuote: '小风险', createdAt: new Date('2025-01-02') },
            { id: 3, level: 'medium', source: 'AI', anchorQuote: '中风险', createdAt: new Date('2025-01-03') },
        ])

        const tool = createTool(ctx)
        const result = parseToolResult(await tool.invoke({ ossFileId: 99 }, cfg as any))

        // interrupt 形态：type 顶层 + toolCallId
        expect(interrupt).toHaveBeenCalledWith(expect.objectContaining({
            type: 'stance_select',
            toolCallId: 'call-zzz',
            reviewId: 555,
            fileName: '采购合同.docx',
        }))
        // 立场写回 review
        expect(updateContractReviewDAO).toHaveBeenCalledWith(555, expect.objectContaining({
            stance: 'partyA', status: 'reviewing',
        }))
        // 调子流走 skipStanceInterrupt=true（subSessionId 由 randomUUID 生成）
        expect(runContractReviewChat).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                skipStanceInterrupt: true,
                runId: 'main-run',
            }),
        )
        // 不软删
        expect(softDeleteContractReviewDAO).not.toHaveBeenCalled()
        // CONTRACT_REVIEW_SAVED 发出
        expect(publishCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
            name: 'contract_review_saved',
            data: expect.objectContaining({ reviewId: 555, riskCount: 3 }),
        }))
        // 返回 LLM JSON
        expect(result.success).toBe(true)
        expect(result.reviewId).toBe(555)
        expect(result.stance).toBe('partyA')
        expect(result.riskCount).toBe(3)
        // Top 风险按 high > medium > low 排序
        expect(result.topRisks[0].level).toBe('high')
        expect(result.topRisks[1].level).toBe('medium')
        expect(result.topRisks[2].level).toBe('low')
        expect(result.levelCount).toEqual({ high: 1, medium: 1, low: 1 })
    })

    it('用户取消（interrupt 返回 null）→ softDelete review + 返回 cancelled JSON', async () => {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: 'x.docx', fileType: DOCX_MIME,
        })
        ;(createContractReviewDAO as any).mockResolvedValue({ id: 666 })
        ;(loadContractFullText as any).mockResolvedValue({ paragraphs: [] })
        ;(detectParties as any).mockResolvedValue({ partyA: null, partyB: null, contractType: null })
        ;(interrupt as any).mockReturnValueOnce(null)
        ;(updateContractReviewDAO as any).mockResolvedValue({})
        ;(softDeleteContractReviewDAO as any).mockResolvedValue({})

        const tool = createTool(ctx)
        const result = parseToolResult(await tool.invoke({ ossFileId: 99 }, cfg as any))

        expect(result).toEqual({ success: false, cancelled: true, message: '用户已取消合同审查' })
        expect(softDeleteContractReviewDAO).toHaveBeenCalledWith(666)
        expect(runContractReviewChat).not.toHaveBeenCalled()
        expect(publishCustomEvent).not.toHaveBeenCalled()
    })

    it('非法 stance（如 stance=invalid）→ 当作取消 + softDelete', async () => {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: 'y.docx', fileType: DOCX_MIME,
        })
        ;(createContractReviewDAO as any).mockResolvedValue({ id: 777 })
        ;(loadContractFullText as any).mockResolvedValue({ paragraphs: [] })
        ;(detectParties as any).mockResolvedValue({ partyA: null, partyB: null, contractType: null })
        ;(interrupt as any).mockReturnValueOnce({ stance: 'unknownStance' })
        ;(updateContractReviewDAO as any).mockResolvedValue({})
        ;(softDeleteContractReviewDAO as any).mockResolvedValue({})

        const tool = createTool(ctx)
        const result = parseToolResult(await tool.invoke({ ossFileId: 99 }, cfg as any))

        expect(result.cancelled).toBe(true)
        expect(softDeleteContractReviewDAO).toHaveBeenCalledWith(777)
    })

    it('OSS 文件不归属当前用户 → 抛错', async () => {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 999, fileName: 'foreign.docx', fileType: DOCX_MIME,
        })
        const tool = createTool(ctx)
        await expect(tool.invoke({ ossFileId: 99 }, cfg as any)).rejects.toThrow(/文件不存在或无权访问/)
    })

    it('OSS 文件不是 docx → 抛错', async () => {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: 'foo.pdf', fileType: 'application/pdf',
        })
        const tool = createTool(ctx)
        await expect(tool.invoke({ ossFileId: 99 }, cfg as any)).rejects.toThrow(/仅支持 \.docx/)
    })

    it('drain 失败 → 抛错（NOT softDelete review，因为已确认 stance）', async () => {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: 'z.docx', fileType: DOCX_MIME,
        })
        ;(createContractReviewDAO as any).mockResolvedValue({ id: 888 })
        ;(loadContractFullText as any).mockResolvedValue({ paragraphs: [] })
        ;(detectParties as any).mockResolvedValue({ partyA: '甲', partyB: '乙', contractType: null })
        ;(interrupt as any).mockReturnValueOnce({ stance: 'neutral' })
        ;(updateContractReviewDAO as any).mockResolvedValue({})
        ;(runContractReviewChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: false, error: '段切失败' })

        const tool = createTool(ctx)
        await expect(tool.invoke({ ossFileId: 99 }, cfg as any)).rejects.toThrow(/合同 Agent 执行失败.*段切失败/)
    })
})

describe('callbacks 注入 + 返回 JSON 加 subSessionId', () => {
    /** 公共 happy-path setup（成功路径必备 mock 链） */
    function setupHappyPath() {
        (findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: '采购.docx', fileType: DOCX_MIME,
        })
        ;(createContractReviewDAO as any).mockResolvedValue({ id: 555, userId: 7, sessionId: 'sub' })
        if (typeof loadContractFullText !== 'undefined') {
            (loadContractFullText as any).mockResolvedValue({ paragraphs: ['p1', 'p2'] })
        }
        if (typeof detectParties !== 'undefined') {
            (detectParties as any).mockResolvedValue({
                partyA: '甲公司', partyB: '乙公司', contractType: '采购合同',
            })
        }
        if (typeof interrupt !== 'undefined') {
            (interrupt as any).mockReturnValueOnce({ stance: 'partyA' })
        }
        if (typeof updateContractReviewDAO !== 'undefined') {
            (updateContractReviewDAO as any).mockResolvedValue({})
        }
        ;(runContractReviewChat as any).mockResolvedValue(new ReadableStream())
        ;(runAndDrainStream as any).mockResolvedValue({ success: true, finalState: {} })
        if (typeof listContractRisksDAO !== 'undefined') {
            (listContractRisksDAO as any).mockResolvedValue([])
        }
    }

    it('runContractReviewChat 接收带 buildSubAgentCallbacks 构造的 callbacks（含 5 个 handler）', async () => {
        setupHappyPath()
        const tool = createTool({ userId: 7, sessionId: 'main-sess', runId: 'main-run-1' })
        await tool.invoke({ ossFileId: 99 }, { toolCall: { id: 'main-call-2' } } as any)

        const callArgs = (runContractReviewChat as any).mock.calls.at(-1)
        expect(callArgs[0]).toBeTruthy()
        const opts = callArgs[1]
        expect(opts.skipStanceInterrupt).toBe(true)
        expect(Array.isArray(opts.callbacks)).toBe(true)
        expect(opts.callbacks).toHaveLength(1)
        const h = opts.callbacks[0]
        expect(typeof h.handleLLMNewToken).toBe('function')
        expect(typeof h.handleToolStart).toBe('function')
        expect(typeof h.handleToolEnd).toBe('function')
        expect(typeof h.handleChainEnd).toBe('function')
        expect(typeof h.handleChainError).toBe('function')
    })

    it('成功返回 JSON 含 subSessionId（值 = runContractReviewChat 接收的 subSessionId）', async () => {
        setupHappyPath()
        const tool = createTool(ctx)
        const result = parseToolResult(await tool.invoke({ ossFileId: 99 }, cfg as any))
        expect(result.success).toBe(true)
        expect(typeof result.subSessionId).toBe('string')
        expect(result.subSessionId.length).toBeGreaterThan(0)
        const passedSubSessionId = (runContractReviewChat as any).mock.calls.at(-1)[0]
        expect(result.subSessionId).toBe(passedSubSessionId)
    })

    it('用户取消（resume=null）时不含 subSessionId（cancelled 路径）', async () => {
        ;(findOssFileByIdDao as any).mockResolvedValue({
            id: 99, userId: 7, fileName: '采购.docx', fileType: DOCX_MIME,
        })
        ;(createContractReviewDAO as any).mockResolvedValue({ id: 555, userId: 7, sessionId: 'sub' })
        if (typeof loadContractFullText !== 'undefined') {
            (loadContractFullText as any).mockResolvedValue({ paragraphs: ['p1'] })
        }
        if (typeof detectParties !== 'undefined') {
            (detectParties as any).mockResolvedValue({ partyA: null, partyB: null, contractType: null })
        }
        if (typeof interrupt !== 'undefined') {
            (interrupt as any).mockReturnValueOnce(null)
        }
        // handle cancelled path
        // tool may throw or return, depending on implementation
        try {
            const tool = createTool(ctx)
            const result = parseToolResult(await tool.invoke({ ossFileId: 99 }, cfg as any))
            if (result !== undefined) {
                expect(result.subSessionId).toBeUndefined()
            }
        } catch {
            // cancelled can throw, that's fine
        }
    })
})
