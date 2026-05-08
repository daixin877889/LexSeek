/**
 * 文件粒度识别服务补充覆盖测试
 *
 * 补齐 server/services/material/fileProcess.service.ts 未覆盖路径：
 * - waitForRecognitionComplete：文档 / 音频 两条轮询路径、超时路径
 * - recognizeFile AUDIO：提交后轮询返回、无 taskId 时回读记录、记录为空时抛错
 * - recognizeFile DOCUMENT：提交后轮询返回、记录为空时抛错
 * - recognizeFile 音频识别结果依赖 extractTextFromAsrResult（无 summary）
 *
 * **Feature: file-process-service-gap-coverage**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CaseMaterialType } from '#shared/types/case'

// Mock Nuxt 自动导入
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

vi.stubGlobal('prisma', {
    ossFiles: { findMany: vi.fn() },
    docRecognitionRecords: { findMany: vi.fn() },
    imageRecognitionRecords: { findMany: vi.fn() },
    asrRecords: { findMany: vi.fn(), findFirst: vi.fn() },
})

// Mock 下游依赖
const mockCreateImageConversionService = vi.fn()
vi.mock('~~/server/services/material/ocr.service', () => ({
    createImageConversionService: (...args: any[]) => mockCreateImageConversionService(...args),
}))

const mockConvertPdfService = vi.fn()
const mockGetDocRecognitionByOssFileIdService = vi.fn()
vi.mock('~~/server/services/material/mineru.service', () => ({
    convertPdfService: (...args: any[]) => mockConvertPdfService(...args),
    getDocRecognitionByOssFileIdService: (...args: any[]) =>
        mockGetDocRecognitionByOssFileIdService(...args),
}))

const mockTranscribeAudioService = vi.fn()
vi.mock('~~/server/services/material/asr.service', () => ({
    transcribeAudioService: (...args: any[]) => mockTranscribeAudioService(...args),
    // T2：extractTextFromAsrResult 已从 materialPipeline.service 迁到 asr.service
    extractTextFromAsrResult: (result: any) => {
        if (!result) return null
        if (result.sentences && Array.isArray(result.sentences)) {
            const text = result.sentences.map((s: any) => s.text || '').filter(Boolean).join('\n')
            if (text) return text
        }
        if (result.transcripts && Array.isArray(result.transcripts)) {
            const text = result.transcripts
                .flatMap((t: any) => t.sentences || [])
                .map((s: any) => s.text || '')
                .filter(Boolean)
                .join('\n')
            if (text) return text
        }
        if (typeof result.text === 'string' && result.text.trim()) return result.text
        return null
    },
}))

// 控制 materialType 判断
vi.mock('#shared/types/case', async () => {
    const actual = await vi.importActual('#shared/types/case')
    return {
        ...actual,
        getMaterialTypeFromMime: vi.fn((mime: string) => {
            if (!mime) return (actual as any).CaseMaterialType.DOCUMENT
            if (mime.startsWith('image/')) return (actual as any).CaseMaterialType.IMAGE
            if (mime.startsWith('audio/')) return (actual as any).CaseMaterialType.AUDIO
            return (actual as any).CaseMaterialType.DOCUMENT
        }),
    }
})

import { processFileMaterials } from '~~/server/services/material/fileProcess.service'

describe('文件粒度识别服务 - 补充覆盖', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 关键：给 setTimeout 提速，因为 waitForRecognitionComplete 内部 setTimeout
        vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 10 })
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('recognizeFile AUDIO 异步路径', () => {
        it('提交后需要轮询：应等到 asrRecords 出现 result 后返回（T2：转录文本从 result JSON 现拼）', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 300, fileName: 'audio.mp3', fileType: 'audio/mpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            // transcribeAudioService 返回 task.taskId（非 'existing'），触发轮询
            mockTranscribeAudioService.mockResolvedValue({
                success: true,
                task: { taskId: 'new-task-001' },
            })
            // 第一次 findFirst 返回 null（继续轮询），第二次返回成功记录
            ;(prisma.asrRecords.findFirst as any)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                    result: { sentences: [{ text: '音频最终结果' }] },
                })

            const results = await processFileMaterials([300], 1)

            expect(results[0]!.recognitionStatus).toBe('success')
            expect(results[0]!.content).toBe('音频最终结果')
        })

        it('提交后通过 result.sentences 回退解析返回', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 301, fileName: 'audio2.mp3', fileType: 'audio/mpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockTranscribeAudioService.mockResolvedValue({
                success: true,
                task: { taskId: 'new-task-002' },
            })
            ;(prisma.asrRecords.findFirst as any).mockResolvedValueOnce({
                summary: null,
                result: { sentences: [{ text: '你好' }, { text: '世界' }] },
            })

            const results = await processFileMaterials([301], 1)
            expect(results[0]!.recognitionStatus).toBe('success')
            expect(results[0]!.content).toBe('你好\n世界')
        })

        it('taskId=existing 时直接回读记录：summary 为空应由 extractTextFromAsrResult 兜底', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 302, fileName: 'audio3.mp3', fileType: 'audio/mpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockTranscribeAudioService.mockResolvedValue({
                success: true,
                task: { taskId: 'existing' },
            })
            ;(prisma.asrRecords.findFirst as any).mockResolvedValue({
                summary: null,
                result: { sentences: [{ text: '兜底文本' }] },
            })

            const results = await processFileMaterials([302], 1)
            expect(results[0]!.recognitionStatus).toBe('success')
            expect(results[0]!.content).toBe('兜底文本')
        })

        it('taskId=existing 且无记录时应抛出 "音频识别结果为空"', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 303, fileName: 'audio4.mp3', fileType: 'audio/mpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockTranscribeAudioService.mockResolvedValue({
                success: true,
                task: { taskId: 'existing' },
            })
            ;(prisma.asrRecords.findFirst as any).mockResolvedValue(null)

            const results = await processFileMaterials([303], 1)
            expect(results[0]!.recognitionStatus).toBe('failed')
            expect(results[0]!.error).toContain('音频识别结果为空')
        })

        it('transcribeAudioService 返回失败时应进入 failed', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 304, fileName: 'bad.mp3', fileType: 'audio/mpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockTranscribeAudioService.mockResolvedValue({
                success: false,
                error: 'ASR 失败',
            })

            const results = await processFileMaterials([304], 1)
            expect(results[0]!.recognitionStatus).toBe('failed')
            expect(results[0]!.error).toContain('ASR 失败')
        })

        it('transcribeAudioService 无 task 时回退读 DB 并返回', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 305, fileName: 'a5.mp3', fileType: 'audio/mpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockTranscribeAudioService.mockResolvedValue({ success: true, task: null })
            ;(prisma.asrRecords.findFirst as any).mockResolvedValue({
                // T2：summary 字段不再用于转录文本，从 result JSON 现拼
                result: { sentences: [{ text: '同步返回' }] },
            })

            const results = await processFileMaterials([305], 1)
            expect(results[0]!.recognitionStatus).toBe('success')
            expect(results[0]!.content).toBe('同步返回')
        })
    })

    describe('recognizeFile DOCUMENT 异步路径', () => {
        it('提交后需要轮询：应等到 doc 识别记录 markdownContent 出现后返回', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 400, fileName: 'a.pdf', fileType: 'application/pdf', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockConvertPdfService.mockResolvedValue({
                success: true,
                task: { taskId: 'doc-task-001' },
            })
            // 第一次轮询无内容，第二次拿到 markdown
            mockGetDocRecognitionByOssFileIdService
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ markdownContent: 'PDF 最终内容' })

            const results = await processFileMaterials([400], 1)
            expect(results[0]!.recognitionStatus).toBe('success')
            expect(results[0]!.content).toBe('PDF 最终内容')
        })

        it('taskId=existing 且无记录时应抛出 "文档识别结果为空"', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 401, fileName: 'x.pdf', fileType: 'application/pdf', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockConvertPdfService.mockResolvedValue({
                success: true,
                task: { taskId: 'existing' },
            })
            mockGetDocRecognitionByOssFileIdService.mockResolvedValue(null)

            const results = await processFileMaterials([401], 1)
            expect(results[0]!.recognitionStatus).toBe('failed')
            expect(results[0]!.error).toContain('文档识别结果为空')
        })

        it('convertPdfService 返回失败时应进入 failed', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 402, fileName: 'fail.pdf', fileType: 'application/pdf', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockConvertPdfService.mockResolvedValue({ success: false, error: 'PDF 错误' })

            const results = await processFileMaterials([402], 1)
            expect(results[0]!.recognitionStatus).toBe('failed')
            expect(results[0]!.error).toContain('PDF 错误')
        })

        it('convertPdfService 返回无 task 时应从 DB 读取', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 403, fileName: 'd.pdf', fileType: 'application/pdf', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([])

            mockConvertPdfService.mockResolvedValue({ success: true, task: null })
            mockGetDocRecognitionByOssFileIdService.mockResolvedValue({
                markdownContent: 'DB 直接返回',
            })

            const results = await processFileMaterials([403], 1)
            expect(results[0]!.recognitionStatus).toBe('success')
            expect(results[0]!.content).toBe('DB 直接返回')
        })
    })

    describe('已有识别记录 - 音频 extractTextFromAsrResult 回退', () => {
        it('summary 为空时应使用 extractTextFromAsrResult 解析 result', async () => {
            ;(prisma.ossFiles.findMany as any).mockResolvedValue([
                { id: 500, fileName: 'a.mp3', fileType: 'audio/mpeg', filePath: '/path' },
            ])
            ;(prisma.docRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.imageRecognitionRecords.findMany as any).mockResolvedValue([])
            ;(prisma.asrRecords.findMany as any).mockResolvedValue([
                {
                    ossFileId: 500,
                    status: 2,
                    summary: null,
                    result: { sentences: [{ text: '第一句' }] },
                },
            ])

            const results = await processFileMaterials([500], 1)
            expect(results[0]!.recognitionStatus).toBe('success')
            expect(results[0]!.content).toBe('第一句')
        })
    })
})
