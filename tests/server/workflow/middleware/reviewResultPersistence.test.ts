import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~~/server/services/assistant/contract/contractReview.dao', () => ({
    getContractReviewDAO: vi.fn(),
    updateContractReviewDAO: vi.fn(),
}))
vi.mock('~~/server/services/assistant/contract/docx', () => ({
    injectComments: vi.fn(),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
    uploadFileService: vi.fn(),
}))
vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(),
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    createOssFileDao: vi.fn(),
}))

import { reviewResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/reviewResultPersistence.middleware'
import {
    getContractReviewDAO,
    updateContractReviewDAO,
} from '~~/server/services/assistant/contract/contractReview.dao'
import { injectComments } from '~~/server/services/assistant/contract/docx'
import {
    downloadFileService,
    uploadFileService,
} from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import {
    findOssFileByIdDao,
    createOssFileDao,
} from '~~/server/services/files/ossFiles.dao'

function getHooks(mw: any) {
    // createMiddleware 返回的对象形状：mw.beforeAgent.hook / mw.afterAgent.hook
    // 若运行时直接把 hook 函数挂在 mw.beforeAgent / mw.afterAgent 上也兼容
    return {
        before: mw.beforeAgent?.hook ?? mw.beforeAgent,
        after: mw.afterAgent?.hook ?? mw.afterAgent,
    }
}

describe('reviewResultPersistenceMiddleware', () => {
    const opts = { reviewId: 42, sessionId: 's1' }

    // riskSchema 校验要求完整字段：中间件 P2 引入 schema.safeParse 后，
    // 测试里的 structuredResponse.risks 必须符合 RISK_SHAPE（含必填项）。
    function makeRisk(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
        return {
            id: '00000000-0000-4000-8000-000000000001',
            clauseIndex: 0,
            clauseText: '原文段落',
            level: 'low',
            category: '其他',
            problem: '问题描述',
            analysis: '条款分析',
            risk: '法律风险',
            suggestion: '修改建议',
            ...overrides,
        }
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('beforeAgent 置 status=reviewing', async () => {
        const mw = reviewResultPersistenceMiddleware(opts)
        const { before } = getHooks(mw)
        await before({})
        expect(updateContractReviewDAO).toHaveBeenCalledWith(42, { status: 'reviewing' })
    })

    it('afterAgent happy path：写 risks/summary → 注入 → 上传 → 写 ossFile → status=completed', async () => {
        const risk = makeRisk()
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99,
        })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectComments as any).mockResolvedValueOnce({
            buffer: Buffer.from('reviewed'),
            validRisks: [risk],
            skippedIndices: [],
        })
        ;(uploadFileService as any).mockResolvedValueOnce({ name: 'contract-review/7/reviewed-xyz.docx' })
        ;(getDefaultStorageConfigDao as any).mockResolvedValueOnce({ bucket: 'test-bucket' })
        ;(createOssFileDao as any).mockResolvedValueOnce({ id: 200 })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({
            structuredResponse: {
                risks: [risk],
                summary: 'ok',
            },
        })
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(1, 42, {
            risks: [risk],
            // M6.1 Task 1.2：持久化层把 LLM 字符串 summary 包装为 ContractOverview 形态
            summary: { highlights: null, overall: 'ok' },
        })
        expect(injectComments).toHaveBeenCalled()
        // 无越界时：只更新 reviewedFileId + status，不重写 risks
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, {
            reviewedFileId: 200, status: 'completed',
        })
    })

    it('structuredResponse 缺失 → status=failed，不调 injectComments', async () => {
        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({})
        expect(updateContractReviewDAO).toHaveBeenCalledWith(42, { status: 'failed' })
        expect(injectComments).not.toHaveBeenCalled()
    })

    it('injectComments 抛错 → risks/summary 已写库 + status=failed', async () => {
        const risk = makeRisk()
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99,
        })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectComments as any).mockRejectedValueOnce(new Error('xml parse fail'))
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({
            structuredResponse: {
                risks: [risk],
                summary: 'ok',
            },
        })
        // 第一次：写 risks/summary（可 rebuild 恢复的关键）
        expect(updateContractReviewDAO).toHaveBeenNthCalledWith(1, 42, {
            risks: [risk],
            // M6.1 Task 1.2：持久化层把 LLM 字符串 summary 包装为 ContractOverview 形态
            summary: { highlights: null, overall: 'ok' },
        })
        // 最后一次：status=failed
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, { status: 'failed' })
    })

    it('fallback：structuredResponse 缺失但消息体含 ```json``` 代码块 → 解析成功走正常分支', async () => {
        const risk = makeRisk()
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99,
        })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectComments as any).mockResolvedValueOnce({
            buffer: Buffer.from('reviewed'),
            validRisks: [risk],
            skippedIndices: [],
        })
        ;(uploadFileService as any).mockResolvedValueOnce({ name: 'contract-review/7/reviewed-xyz.docx' })
        ;(getDefaultStorageConfigDao as any).mockResolvedValueOnce({ bucket: 'test-bucket' })
        ;(createOssFileDao as any).mockResolvedValueOnce({ id: 201 })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const content = '这里是 AI 的分析：\n```json\n' + JSON.stringify({ risks: [risk], summary: '兜底 ok' }) + '\n```'
        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({
            // 没有 structuredResponse，messages 里最后一条 AI 消息携带 JSON fence
            messages: [
                { getType: () => 'ai', content },
            ],
        })
        expect(injectComments).toHaveBeenCalled()
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, {
            reviewedFileId: 201, status: 'completed',
        })
    })

    it('clauseIndex 越界被注入时丢弃 → DB risks 改写为 validRisks', async () => {
        const risk0 = makeRisk({ id: '00000000-0000-4000-8000-000000000010', clauseIndex: 0 })
        const risk999 = makeRisk({ id: '00000000-0000-4000-8000-000000000999', clauseIndex: 999 })
        ;(getContractReviewDAO as any).mockResolvedValueOnce({
            id: 42, userId: 7, originalFileId: 99,
        })
        ;(findOssFileByIdDao as any).mockResolvedValueOnce({ id: 99, filePath: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValueOnce(Buffer.from('orig'))
        ;(injectComments as any).mockResolvedValueOnce({
            buffer: Buffer.from('reviewed'),
            validRisks: [risk0],
            skippedIndices: [999],
        })
        ;(uploadFileService as any).mockResolvedValueOnce({ name: 'contract-review/7/reviewed-xyz.docx' })
        ;(getDefaultStorageConfigDao as any).mockResolvedValueOnce({ bucket: 'test-bucket' })
        ;(createOssFileDao as any).mockResolvedValueOnce({ id: 202 })
        ;(updateContractReviewDAO as any).mockResolvedValue({})

        const mw = reviewResultPersistenceMiddleware(opts)
        const { after } = getHooks(mw)
        await after({
            structuredResponse: {
                risks: [risk0, risk999],
                summary: 'ok',
            },
        })
        // 终局 update 应同时带 risks（剔除越界项）+ reviewedFileId + status
        expect(updateContractReviewDAO).toHaveBeenLastCalledWith(42, {
            reviewedFileId: 202,
            status: 'completed',
            risks: [risk0],
        })
    })
})
