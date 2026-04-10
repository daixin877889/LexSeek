/**
 * 材料处理编排服务单元测试
 *
 * Mock 所有依赖服务，测试处理编排逻辑
 *
 * **Feature: material-process-coverage**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MaterialStatus } from '#shared/types/material'
import { CaseMaterialType } from '#shared/types/case'

// Mock Nuxt 自动导入
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

vi.stubGlobal('prisma', {
    cases: { findFirst: vi.fn() },
    ossFiles: { findFirst: vi.fn() },
    textContentRecords: { findFirst: vi.fn() },
})

// Mock material.service
const mockGetMaterialByIdService = vi.fn()
const mockUpdateMaterialStatusService = vi.fn()
const mockUpdateMaterialContentService = vi.fn()
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialByIdService: (...args: any[]) => mockGetMaterialByIdService(...args),
    updateMaterialStatusService: (...args: any[]) => mockUpdateMaterialStatusService(...args),
    updateMaterialContentService: (...args: any[]) => mockUpdateMaterialContentService(...args),
}))

// Mock mineru.service
const mockConvertPdfService = vi.fn()
const mockGetDocRecognitionByOssFileIdService = vi.fn()
vi.mock('~~/server/services/material/mineru.service', () => ({
    convertPdfService: (...args: any[]) => mockConvertPdfService(...args),
    getDocRecognitionByOssFileIdService: (...args: any[]) => mockGetDocRecognitionByOssFileIdService(...args),
}))

// Mock ocr.service
const mockCreateImageConversionService = vi.fn()
vi.mock('~~/server/services/material/ocr.service', () => ({
    createImageConversionService: (...args: any[]) => mockCreateImageConversionService(...args),
}))

// Mock asr.service
const mockTranscribeAudioService = vi.fn()
vi.mock('~~/server/services/material/asr.service', () => ({
    transcribeAudioService: (...args: any[]) => mockTranscribeAudioService(...args),
}))

// Mock materialEmbedding.service
const mockEmbedMaterialUnifiedService = vi.fn()
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    embedMaterialUnifiedService: (...args: any[]) => mockEmbedMaterialUnifiedService(...args),
}))

import {
    processMaterialService,
    MaterialProcessError,
    ensureMaterialsEmbeddedService,
    batchCheckMaterialRecognizedService,
} from '~~/server/services/material/materialProcess.service'

describe('材料处理编排服务单元测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('MaterialProcessError', () => {
        it('包含 code 属性', () => {
            const error = new MaterialProcessError('测试错误', 404)
            expect(error.message).toBe('测试错误')
            expect(error.code).toBe(404)
            expect(error.name).toBe('MaterialProcessError')
        })
    })

    describe('processMaterialService - 处理材料', () => {
        it('材料不存在时抛出 404', async () => {
            mockGetMaterialByIdService.mockResolvedValue(null)

            await expect(processMaterialService(999, 1)).rejects.toThrow('材料不存在')
        })

        it('无权处理时抛出 403', async () => {
            mockGetMaterialByIdService.mockResolvedValue({ id: 1, caseId: 1, type: CaseMaterialType.DOCUMENT })
            ;(prisma.cases.findFirst as any).mockResolvedValue(null)

            await expect(processMaterialService(1, 2)).rejects.toThrow('无权处理此材料')
        })

        it('材料已完成时抛出 400', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.COMPLETED,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })

            await expect(processMaterialService(1, 1)).rejects.toThrow('材料已处理完成')
        })

        it('材料处理中时抛出 400', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PROCESSING,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })

            await expect(processMaterialService(1, 1)).rejects.toThrow('材料正在处理中')
        })

        it('无 OSS 文件且无文本内容时抛出错误', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
                ossFileId: null,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.textContentRecords.findFirst as any).mockResolvedValue(null)

            await expect(processMaterialService(1, 1)).rejects.toThrow('材料没有关联的文件')
        })

        it('无 OSS 文件但有文本内容时执行嵌入并标记完成', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
                ossFileId: null,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.textContentRecords.findFirst as any).mockResolvedValue({ content: '文本内容' })
            mockEmbedMaterialUnifiedService.mockResolvedValue({ success: true })
            mockUpdateMaterialStatusService.mockResolvedValue(undefined)

            const result = await processMaterialService(1, 1)

            expect(result.status).toBe(MaterialStatus.COMPLETED)
            expect(mockEmbedMaterialUnifiedService).toHaveBeenCalled()
        })

        it('嵌入失败时不影响主流程', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
                ossFileId: null,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.textContentRecords.findFirst as any).mockResolvedValue({ content: '文本内容' })
            mockEmbedMaterialUnifiedService.mockRejectedValue(new Error('嵌入失败'))
            mockUpdateMaterialStatusService.mockResolvedValue(undefined)

            const result = await processMaterialService(1, 1)

            expect(result.status).toBe(MaterialStatus.COMPLETED)
        })

        it('禁用嵌入时不执行嵌入', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
                ossFileId: null,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.textContentRecords.findFirst as any).mockResolvedValue({ content: '文本内容' })
            mockUpdateMaterialStatusService.mockResolvedValue(undefined)

            await processMaterialService(1, 1, { enableEmbedding: false })

            expect(mockEmbedMaterialUnifiedService).not.toHaveBeenCalled()
        })

        it('OSS 文件不存在时抛出 404', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PENDING,
                ossFileId: 100,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.ossFiles.findFirst as any).mockResolvedValue(null)

            await expect(processMaterialService(1, 1)).rejects.toThrow('关联的文件不存在')
        })

        it('成功处理图片材料（同步返回内容）', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.IMAGE,
                status: MaterialStatus.PENDING,
                ossFileId: 100,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.ossFiles.findFirst as any).mockResolvedValue({ id: 100 })
            mockUpdateMaterialStatusService.mockResolvedValue(undefined)
            mockCreateImageConversionService.mockResolvedValue({
                success: true,
                record: { markdownContent: '识别内容' },
            })
            mockUpdateMaterialContentService.mockResolvedValue(undefined)
            mockEmbedMaterialUnifiedService.mockResolvedValue({ success: true })

            const result = await processMaterialService(1, 1)

            expect(result.status).toBe(MaterialStatus.COMPLETED)
            expect(result.contentLength).toBe(4) // '识别内容'.length
        })

        it('图片处理失败时回退状态', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.IMAGE,
                status: MaterialStatus.PENDING,
                ossFileId: 100,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.ossFiles.findFirst as any).mockResolvedValue({ id: 100 })
            mockUpdateMaterialStatusService.mockResolvedValue(undefined)
            mockCreateImageConversionService.mockResolvedValue({
                success: false,
                error: 'OCR 识别失败',
            })

            await expect(processMaterialService(1, 1)).rejects.toThrow()
        })

        it('PDF 材料已有识别记录时同步返回', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.DOCUMENT,
                status: MaterialStatus.PENDING,
                ossFileId: 100,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.ossFiles.findFirst as any).mockResolvedValue({ id: 100 })
            mockUpdateMaterialStatusService.mockResolvedValue(undefined)
            mockConvertPdfService.mockResolvedValue({
                success: true,
                task: { taskId: 'existing' },
            })
            mockGetDocRecognitionByOssFileIdService.mockResolvedValue({
                markdownContent: 'PDF 内容',
            })
            mockUpdateMaterialContentService.mockResolvedValue(undefined)
            mockEmbedMaterialUnifiedService.mockResolvedValue({ success: true })

            const result = await processMaterialService(1, 1)

            expect(result.status).toBe(MaterialStatus.COMPLETED)
        })

        it('音频材料异步处理返回 PROCESSING', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.AUDIO,
                status: MaterialStatus.PENDING,
                ossFileId: 100,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.ossFiles.findFirst as any).mockResolvedValue({ id: 100 })
            mockUpdateMaterialStatusService.mockResolvedValue(undefined)
            mockTranscribeAudioService.mockResolvedValue({ success: true })

            const result = await processMaterialService(1, 1)

            expect(result.status).toBe(MaterialStatus.PROCESSING)
        })
    })

    describe('ensureMaterialsEmbeddedService - 批量确保嵌入', () => {
        it('空材料列表返回全零统计', async () => {
            const result = await ensureMaterialsEmbeddedService([], 1)

            expect(result).toEqual({ total: 0, success: 0, failed: 0, skipped: 0 })
        })

        it('统计成功/失败/跳过', async () => {
            mockEmbedMaterialUnifiedService
                .mockResolvedValueOnce({ success: true })
                .mockResolvedValueOnce({ success: false, error: '内容为空' })
                .mockRejectedValueOnce(new Error('异常'))

            const materials = [
                { id: 1, type: 1 },
                { id: 2, type: 2 },
                { id: 3, type: 3 },
            ] as any[]

            const result = await ensureMaterialsEmbeddedService(materials, 1)

            expect(result.total).toBe(3)
            expect(result.success).toBe(1)
            expect(result.skipped).toBe(1) // '内容为空'
            expect(result.failed).toBe(1)
        })
    })

    describe('batchCheckMaterialRecognizedService - 批量检查识别状态', () => {
        it('空材料列表返回空 Map', async () => {
            const result = await batchCheckMaterialRecognizedService([])

            expect(result.size).toBe(0)
        })

        it('检查各类型材料的识别状态', async () => {
            const materials = [
                { id: 1, type: CaseMaterialType.CASE_CONTENT, ossFileId: null },
                { id: 2, type: CaseMaterialType.DOCUMENT, ossFileId: 100 },
                { id: 3, type: CaseMaterialType.IMAGE, ossFileId: 200 },
                { id: 4, type: CaseMaterialType.AUDIO, ossFileId: 300 },
            ] as any[]

            ;(prisma.textContentRecords.findFirst as any) // not used in batch
            vi.stubGlobal('prisma', {
                ...prisma,
                textContentRecords: {
                    findMany: vi.fn().mockResolvedValue([{ materialId: 1 }]),
                },
                docRecognitionRecords: {
                    findMany: vi.fn().mockResolvedValue([{ ossFileId: 100, status: 2 }]),
                },
                imageRecognitionRecords: {
                    findMany: vi.fn().mockResolvedValue([]),
                },
                asrRecords: {
                    findMany: vi.fn().mockResolvedValue([{ ossFileId: 300, status: 2 }]),
                },
            })

            const result = await batchCheckMaterialRecognizedService(materials)

            expect(result.get(1)).toBe(true)
            expect(result.get(3)).toBe(false) // 图片无识别记录
        })
    })
})
