/**
 * 示范案例材料服务测试
 *
 * **Feature: admin-demo-cases**
 * **Validates: ensureSourceFileRecognitionService**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ensureSourceFileRecognitionService } from '../../../server/services/case/demoCase.service'

// Mock 底层识别服务
vi.mock('../../../server/services/material/mineru.service', () => ({
    convertPdfService: vi.fn().mockResolvedValue({ success: true, task: { taskId: 'mock-task' } }),
}))
vi.mock('../../../server/services/material/ocr.service', () => ({
    createImageConversionService: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('../../../server/services/material/asr.service', () => ({
    transcribeAudioService: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('../../../server/services/material/textReader.service', () => ({
    readTextFileService: vi.fn().mockResolvedValue({ success: true }),
}))
vi.mock('../../../server/services/material/docxRecognition.service', () => ({
    recognizeDocxService: vi.fn().mockResolvedValue({ success: true }),
}))

describe('ensureSourceFileRecognitionService', () => {
    let adminUserId: number
    let pdfFileId: number

    beforeEach(async () => {
        const ts = Date.now().toString().slice(-8)
        const admin = await prisma.users.create({ data: { phone: `1${ts}12`, name: 'admin' } })
        adminUserId = admin.id
        const pdf = await prisma.ossFiles.create({
            data: {
                userId: adminUserId,
                bucketName: 'test-bucket',
                fileName: 'doc.pdf',
                filePath: `test/${Date.now()}.pdf`,
                fileSize: 100,
                fileType: 'application/pdf',
                source: 'demo_case',
                status: 1,
            },
        })
        pdfFileId = pdf.id
    })

    afterEach(async () => {
        await prisma.docRecognitionRecords.deleteMany({ where: { userId: adminUserId } })
        await prisma.ossFiles.deleteMany({ where: { userId: adminUserId } })
        await prisma.users.deleteMany({ where: { id: adminUserId } })
        vi.clearAllMocks()
    })

    it('三张识别表都无记录时调用底层识别服务', async () => {
        const { convertPdfService } = await import('../../../server/services/material/mineru.service')
        vi.clearAllMocks()
        await ensureSourceFileRecognitionService(pdfFileId)
        expect(convertPdfService).toHaveBeenCalledWith(pdfFileId, adminUserId)
    })

    it('已有 docRecognitionRecord 时不调用底层服务', async () => {
        await prisma.docRecognitionRecords.create({
            data: { userId: adminUserId, ossFileId: pdfFileId, status: 1 },
        })
        const { convertPdfService } = await import('../../../server/services/material/mineru.service')
        vi.clearAllMocks()
        await ensureSourceFileRecognitionService(pdfFileId)
        expect(convertPdfService).not.toHaveBeenCalled()
    })

    it('底层服务抛错时不抛出（只记 warn）', async () => {
        const { convertPdfService } = await import('../../../server/services/material/mineru.service')
        vi.mocked(convertPdfService).mockRejectedValueOnce(new Error('boom'))
        await expect(ensureSourceFileRecognitionService(pdfFileId)).resolves.toBeUndefined()
    })

    it('源文件不存在时抛错', async () => {
        await expect(ensureSourceFileRecognitionService(999999999)).rejects.toThrow()
    })
})
