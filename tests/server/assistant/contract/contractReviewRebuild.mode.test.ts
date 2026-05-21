import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

;(globalThis as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() }

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    createOssFileDao: vi.fn(async () => ({ id: 999 })),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
    uploadFileService: vi.fn(async () => ({ name: 'oss/path.docx' })),
    generateSignedUrlService: vi.fn(async () => 'https://signed/url'),
    deleteFileService: vi.fn(),
}))
vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(async () => ({ bucket: 'b' })),
}))
vi.mock('~~/server/agents/contract/contractAnnotation.dao', () => ({
    listAnnotationsForExportDAO: vi.fn(async () => []),
}))
vi.mock('~~/server/agents/contract/contractAnnotation.service', () => ({
    filterExportableDbAnnotations: vi.fn((annotations: any[]) => annotations),
}))
vi.mock('~~/server/agents/contract/contractRisk.dao', () => ({
    listContractRisksDAO: vi.fn(async () => []),
}))
vi.mock('~~/server/agents/contract/contractReview.dao', () => ({
    setCompletedAfterRebuildDAO: vi.fn(),
}))
// 自定义署名功能：rebuildDocxService 新增调用 resolveContractExportSignatureService，
// 其内部走真实 DAO → prisma。本 mock 单测未 mock 该链，故固定返回署名 '审查人'。
vi.mock('~~/server/services/users/contractSignature.service', () => ({
    resolveContractExportSignatureService: vi.fn().mockResolvedValue('审查人'),
}))
vi.mock('~~/server/agents/contract/docx', async () => {
    const actual = await vi.importActual<any>('~~/server/agents/contract/docx')
    return {
        ...actual,
        injectAnnotations: vi.fn(async (buf: Buffer) => ({
            buffer: buf, refsByAnnotationId: new Map(), nextIdAfter: 0,
        })),
        injectRedlineMarks: vi.fn(async (buf: Buffer, _risks: any[]) => ({
            buffer: buf, skippedRiskIds: [], spansByRiskId: new Map(), nextIdAfter: 0, warnings: [],
        })),
    }
})

const SAMPLE = join(__dirname, '../../../../prisma/seeds/contract-samples/labor.docx')

describe('rebuildDocxService 三模式协调（PR6 §8.2）', () => {
    beforeEach(() => vi.clearAllMocks())

    async function setup() {
        const buf = await readFile(SAMPLE)
        const { findOssFileByIdDao } = await import('~~/server/services/files/ossFiles.dao')
        const { downloadFileService } = await import('~~/server/services/storage/storage.service')
        ;(findOssFileByIdDao as any).mockResolvedValue({ filePath: 'orig', fileName: 'orig.docx' })
        ;(downloadFileService as any).mockResolvedValue(buf)

        const review = {
            id: 100,
            userId: 1,
            originalFileId: 1,
            maxVersionNo: null,
        } as any

        const { rebuildDocxService } = await import('~~/server/agents/contract/contractReviewRebuild.service')
        return { rebuildDocxService, review }
    }

    it('mode=comment（默认）：只调 injectAnnotations，不调 injectRedlineMarks', async () => {
        const { rebuildDocxService, review } = await setup()
        const docx = await import('~~/server/agents/contract/docx')
        await rebuildDocxService(review)
        expect(docx.injectAnnotations).toHaveBeenCalledOnce()
        expect(docx.injectRedlineMarks).not.toHaveBeenCalled()
    })

    it('mode=redline：调 injectRedlineMarks + 跳过的 risk fallback 走 injectAnnotations', async () => {
        const { rebuildDocxService, review } = await setup()
        const docx = await import('~~/server/agents/contract/docx')
        ;(docx.injectRedlineMarks as any).mockResolvedValue({
            buffer: Buffer.alloc(0), skippedRiskIds: [42], spansByRiskId: new Map(), nextIdAfter: 4, warnings: [],
        })
        const { listAnnotationsForExportDAO } = await import('~~/server/agents/contract/contractAnnotation.dao')
        ;(listAnnotationsForExportDAO as any).mockResolvedValue([
            { id: 1, riskId: 42, authorType: 'ai', authorName: 'AI', content: 'x', parentAnnotationId: null, wordCommentRef: null, createdAt: new Date(), risk: { clauseText: 'c', clauseParagraphIndex: 0, orphaned: false } },
        ])
        await rebuildDocxService(review, { mode: 'redline' })
        expect(docx.injectRedlineMarks).toHaveBeenCalledOnce()
        // fallback comment：annotations 仅 riskId in skippedRiskIds 的子集
        expect(docx.injectAnnotations).toHaveBeenCalledOnce()
        const callArgs = (docx.injectAnnotations as any).mock.calls[0]
        expect(callArgs[1]).toHaveLength(1)
        expect(callArgs[1][0].riskId).toBe(42)
        // 自定义署名功能：注入参数新增 signature（取自 resolveContractExportSignatureService）
        expect(callArgs[3]).toEqual({ idStart: 4, signature: '审查人' })
    })

    it('mode=both：先调 injectRedlineMarks，全部 annotations 走 injectAnnotations 接力 nextIdAfter + 传 wrapTargetByRiskId（spec §8.3.6）', async () => {
        const { rebuildDocxService, review } = await setup()
        const docx = await import('~~/server/agents/contract/docx')
        const fakeSpans = new Map([[10, { paragraphSpans: [{ paraIdx: 0, delId: 4, insId: 5 }] }]])
        ;(docx.injectRedlineMarks as any).mockResolvedValue({
            buffer: Buffer.alloc(0), skippedRiskIds: [], spansByRiskId: fakeSpans, nextIdAfter: 6, warnings: [],
        })
        const { listAnnotationsForExportDAO } = await import('~~/server/agents/contract/contractAnnotation.dao')
        ;(listAnnotationsForExportDAO as any).mockResolvedValue([
            { id: 1, riskId: 10, authorType: 'ai', authorName: 'AI', content: 'x', parentAnnotationId: null, wordCommentRef: null, createdAt: new Date(), risk: { clauseText: 'c', clauseParagraphIndex: 0, orphaned: false } },
        ])
        await rebuildDocxService(review, { mode: 'both' })
        expect(docx.injectRedlineMarks).toHaveBeenCalledOnce()
        expect(docx.injectAnnotations).toHaveBeenCalledOnce()
        const callArgs = (docx.injectAnnotations as any).mock.calls[0]
        // both 模式 → 全部 annotations 都进 commentInjector
        expect(callArgs[1]).toHaveLength(1)
        // both 模式必须把 spansByRiskId 透传给 commentInjector 让其精确包裹 redline；
        // 自定义署名功能新增 signature 参数
        expect(callArgs[3]).toEqual({ idStart: 6, wrapTargetByRiskId: fakeSpans, signature: '审查人' })
    })
})
