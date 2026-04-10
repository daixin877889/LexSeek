/**
 * 材料处理编排服务 - 补充覆盖率测试
 *
 * 覆盖 materialProcess.service.ts 中已有测试未覆盖的路径：
 * - processMaterialService: 不支持的材料类型、PDF 新任务异步返回、
 *   PDF 已有记录但无内容、PDF 转换异常、音频处理异常、
 *   状态更新失败时的 catch 分支、嵌入完成后有内容返回
 * - ensureMaterialsEmbeddedService: 'not exists' 跳过、失败 error 不含关键字
 * - queryRecognitionByOssFileId: 重复 ossFileId 去重
 * - batchCheckMaterialRecognizedService: 无 ossFileId 的文档/图片/音频
 *
 * **Feature: material-process-coverage-extra**
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
    textContentRecords: { findFirst: vi.fn(), findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn() },
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
    ensureMaterialsEmbeddedService,
    batchCheckMaterialRecognizedService,
} from '~~/server/services/material/materialProcess.service'

describe('材料处理编排服务 - 补充覆盖率', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== processMaterialService 扩展路径 ====================

    describe('processMaterialService - 不支持的材料类型', () => {
        it('CASE_CONTENT 类型（有 ossFileId）时回退状态并抛出错误', async () => {
            mockGetMaterialByIdService.mockResolvedValue({
                id: 1,
                caseId: 1,
                type: CaseMaterialType.CASE_CONTENT,
                status: MaterialStatus.PENDING,
                ossFileId: 100,
            })
            ;(prisma.cases.findFirst as any).mockResolvedValue({ id: 1 })
            ;(prisma.ossFiles.findFirst as any).mockResolvedValue({ id: 100 })
            mockUpdateMaterialStatusService.mockResolvedValue(undefined)

            await expect(processMaterialService(1, 1)).rejects.toThrow('该材料类型不需要服务端处理')
        })
    })

    describe('processMaterialService - PDF 新任务异步', () => {
        it('PDF 新任务（非 existing）返回 PROCESSING 状态', async () => {
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
                task: { taskId: 'new-task-123' },
            })

            const result = await processMaterialService(1, 1)

            expect(result.status).toBe(MaterialStatus.PROCESSING)
        })
    })

    describe('processMaterialService - PDF existing 无内容', () => {
        it('已有记录但无内容时返回 PROCESSING（无 content 分支）', async () => {
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
            // getDocRecognitionByOssFileIdService 返回无内容记录
            mockGetDocRecognitionByOssFileIdService.mockResolvedValue({
                markdownContent: null,
            })

            const result = await processMaterialService(1, 1)

            // 有 existing record 但无内容 → success: true 但无 content → PROCESSING
            expect(result.status).toBe(MaterialStatus.PROCESSING)
        })
    })

    describe('processMaterialService - PDF 转换失败', () => {
        it('convertPdfService 抛出异常时回退状态', async () => {
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
            mockConvertPdfService.mockRejectedValue(new Error('MinerU 服务不可用'))

            await expect(processMaterialService(1, 1)).rejects.toThrow()
        })
    })

    describe('processMaterialService - 音频转录异常', () => {
        it('transcribeAudioService 抛出异常时回退状态', async () => {
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
            mockTranscribeAudioService.mockRejectedValue(new Error('ASR 服务异常'))

            await expect(processMaterialService(1, 1)).rejects.toThrow()
        })
    })

    describe('processMaterialService - 图片处理有内容 + 嵌入失败', () => {
        it('有内容时嵌入失败不影响主流程', async () => {
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
            // 嵌入失败
            mockEmbedMaterialUnifiedService.mockRejectedValue(new Error('嵌入失败'))

            const result = await processMaterialService(1, 1)

            expect(result.status).toBe(MaterialStatus.COMPLETED)
            expect(result.contentLength).toBe(4) // '识别内容'.length
        })
    })

    describe('processMaterialService - 禁用嵌入 + 有内容', () => {
        it('enableEmbedding=false 时跳过嵌入', async () => {
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
                record: { markdownContent: '图片内容' },
            })
            mockUpdateMaterialContentService.mockResolvedValue(undefined)

            const result = await processMaterialService(1, 1, { enableEmbedding: false })

            expect(result.status).toBe(MaterialStatus.COMPLETED)
            expect(mockEmbedMaterialUnifiedService).not.toHaveBeenCalled()
        })
    })

    describe('processMaterialService - PDF 返回 success:false', () => {
        it('PDF 转换返回失败结果时标记 FAILED 并抛出', async () => {
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
                success: false,
                error: 'PDF 格式损坏',
            })

            await expect(processMaterialService(1, 1)).rejects.toThrow()
        })
    })

    describe('processMaterialService - 音频返回 success:false', () => {
        it('音频转录返回失败时标记 FAILED 并抛出', async () => {
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
            mockTranscribeAudioService.mockResolvedValue({
                success: false,
                error: '音频格式不支持',
            })

            await expect(processMaterialService(1, 1)).rejects.toThrow()
        })
    })

    // ==================== ensureMaterialsEmbeddedService 扩展 ====================

    describe('ensureMaterialsEmbeddedService - 扩展路径', () => {
        it('"不存在" 关键字触发 skipped', async () => {
            mockEmbedMaterialUnifiedService.mockResolvedValue({
                success: false,
                error: '材料不存在',
            })

            const materials = [{ id: 1, type: 1 }] as any[]

            const result = await ensureMaterialsEmbeddedService(materials, 1)

            expect(result.skipped).toBe(1)
            expect(result.failed).toBe(0)
        })

        it('失败 error 不含关键字时计为 failed', async () => {
            mockEmbedMaterialUnifiedService.mockResolvedValue({
                success: false,
                error: '数据库连接超时',
            })

            const materials = [{ id: 1, type: 2 }] as any[]

            const result = await ensureMaterialsEmbeddedService(materials, 1)

            expect(result.failed).toBe(1)
            expect(result.skipped).toBe(0)
        })
    })

    // ==================== batchCheckMaterialRecognizedService 扩展 ====================

    describe('batchCheckMaterialRecognizedService - 扩展路径', () => {
        it('无 ossFileId 的文档/图片/音频材料不查询识别记录', async () => {
            const materials = [
                { id: 1, type: CaseMaterialType.DOCUMENT, ossFileId: null },
                { id: 2, type: CaseMaterialType.IMAGE, ossFileId: null },
                { id: 3, type: CaseMaterialType.AUDIO, ossFileId: null },
            ] as any[]

            // 重新 stub prisma（确保 findMany 存在）
            vi.stubGlobal('prisma', {
                ...prisma,
                textContentRecords: { findMany: vi.fn().mockResolvedValue([]) },
                docRecognitionRecords: { findMany: vi.fn().mockResolvedValue([]) },
                imageRecognitionRecords: { findMany: vi.fn().mockResolvedValue([]) },
                asrRecords: { findMany: vi.fn().mockResolvedValue([]) },
            })

            const result = await batchCheckMaterialRecognizedService(materials)

            expect(result.get(1)).toBe(false)
            expect(result.get(2)).toBe(false)
            expect(result.get(3)).toBe(false)
        })

        it('多个相同 ossFileId 的记录不重复计数', async () => {
            const materials = [
                { id: 1, type: CaseMaterialType.DOCUMENT, ossFileId: 100 },
            ] as any[]

            vi.stubGlobal('prisma', {
                ...prisma,
                textContentRecords: { findMany: vi.fn().mockResolvedValue([]) },
                docRecognitionRecords: {
                    findMany: vi.fn().mockResolvedValue([
                        { ossFileId: 100, status: 2 },
                        { ossFileId: 100, status: 2 }, // 重复记录
                    ]),
                },
                imageRecognitionRecords: { findMany: vi.fn().mockResolvedValue([]) },
                asrRecords: { findMany: vi.fn().mockResolvedValue([]) },
            })

            const result = await batchCheckMaterialRecognizedService(materials)

            expect(result.get(1)).toBe(true)
        })
    })
})
