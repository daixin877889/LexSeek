/**
 * server/api/v1/recognition/** handler 单元覆盖（15 文件）
 *
 * 覆盖策略：每个 handler 重点覆盖 happy path + 401/400/404/403/500 关键分支
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../_helpers/handler-test'
import { makeEvent, expectSuccess, expectError } from '../_helpers/handler-test'

vi.mock('~~/server/services/material/ocr.service', () => ({
    createImageRecognitionByBase64Service: vi.fn(),
    createImageConversionService: vi.fn(),
    SUPPORTED_IMAGE_TYPES: ['image/jpeg', 'image/png'],
}))
vi.mock('~~/server/services/material/asr.service', () => ({
    transcribeAudioService: vi.fn(),
    getAsrRecordByIdService: vi.fn(),
    updateAsrRecordService: vi.fn(),
    SUPPORTED_AUDIO_TYPES: ['audio/mpeg', 'audio/mp3', 'audio/wav'],
}))
vi.mock('~~/server/services/material/asr.dao', () => ({
    findAsrRecordByOssFileIdDao: vi.fn(),
    findAsrRecordsByTaskIdDao: vi.fn(),
}))
vi.mock('~~/server/services/material/asrTask.service', () => ({
    getAsrTaskByTaskIdService: vi.fn(),
}))
vi.mock('~~/server/services/material/mineru.service', () => ({
    convertPdfService: vi.fn(),
}))
vi.mock('~~/server/services/material/mineru.dao', () => ({
    findDocRecognitionByOssFileIdDao: vi.fn(),
    createDocRecognitionRecordDao: vi.fn(),
    updateDocRecognitionRecordDao: vi.fn(),
}))
vi.mock('~~/server/services/material/mineruTask.service', () => ({
    createMineruTaskService: vi.fn(),
    getMineruTaskByOssFileIdService: vi.fn(),
    getMineruTaskByTaskIdService: vi.fn(),
    getMineruTaskByIdService: vi.fn(),
}))
vi.mock('~~/server/services/material/mineruToken.service', () => ({
    pickTokenForNewTaskService: vi.fn(),
}))
vi.mock('~~/server/services/material/textReader.service', () => ({
    readTextFileService: vi.fn(),
}))
vi.mock('~~/server/services/material/docxRecognition.service', () => ({
    recognizeDocxService: vi.fn(),
}))
vi.mock('~~/server/services/material/fileDetect.service', () => ({
    detectFileTypeService: vi.fn(),
}))
vi.mock('~~/server/services/material/ocr.dao', () => ({
    findImageRecognitionByOssFileIdDao: vi.fn(),
}))
vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn(async () => 'https://signed.url/audio'),
    generatePostSignatureService: vi.fn(async () => ({ host: 'https://oss', accessId: 'AK' })),
}))
vi.mock('ofetch', () => ({
    $fetch: vi.fn(),
}))

;(globalThis as any).prisma = {
    ossFiles: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
    },
    // T5：start.post.ts 同步成功路径会 fire-and-forget 触发摘要
    caseMaterials: {
        findMany: vi.fn().mockResolvedValue([]),
    },
}

import { createImageRecognitionByBase64Service, createImageConversionService } from '~~/server/services/material/ocr.service'
import { transcribeAudioService, getAsrRecordByIdService, updateAsrRecordService } from '~~/server/services/material/asr.service'
import { findAsrRecordByOssFileIdDao, findAsrRecordsByTaskIdDao } from '~~/server/services/material/asr.dao'
import { getAsrTaskByTaskIdService } from '~~/server/services/material/asrTask.service'
import { convertPdfService } from '~~/server/services/material/mineru.service'
import {
    findDocRecognitionByOssFileIdDao,
    createDocRecognitionRecordDao,
    updateDocRecognitionRecordDao,
} from '~~/server/services/material/mineru.dao'
import { createMineruTaskService, getMineruTaskByOssFileIdService } from '~~/server/services/material/mineruTask.service'
import { pickTokenForNewTaskService } from '~~/server/services/material/mineruToken.service'
import { readTextFileService } from '~~/server/services/material/textReader.service'
import { recognizeDocxService } from '~~/server/services/material/docxRecognition.service'
import { detectFileTypeService } from '~~/server/services/material/fileDetect.service'
import { findImageRecognitionByOssFileIdDao } from '~~/server/services/material/ocr.dao'
import { $fetch } from 'ofetch'

const { default: imageHandler } = await import('../../../server/api/v1/recognition/image.post')
const { default: startHandler } = await import('../../../server/api/v1/recognition/start.post')
const { default: statusHandler } = await import('../../../server/api/v1/recognition/status/[ossFileId].get')
const { default: audioGetHandler } = await import('../../../server/api/v1/recognition/audio/[id].get')
const { default: audioPutHandler } = await import('../../../server/api/v1/recognition/audio/[id].put')
const { default: audioPostHandler } = await import('../../../server/api/v1/recognition/audio/index.post')
const { default: audioByOssHandler } = await import('../../../server/api/v1/recognition/audio/by-oss-file/[ossFileId].get')
const { default: audioTaskHandler } = await import('../../../server/api/v1/recognition/audio/task/[taskId].get')
const { default: audioTempHandler } = await import('../../../server/api/v1/recognition/audio/temp-upload.post')
const { default: docSaveHandler } = await import('../../../server/api/v1/recognition/doc/save.post')
const { default: docStatusHandler } = await import('../../../server/api/v1/recognition/doc/status/[ossFileId].get')
const { default: mineruSubmitHandler } = await import('../../../server/api/v1/recognition/mineru/submit.post')
const { default: mineruTaskHandler } = await import('../../../server/api/v1/recognition/mineru/task/[taskId].get')
const { default: mineruUploadHandler } = await import('../../../server/api/v1/recognition/mineru/upload.post')
const { default: mineruUploadUrlHandler } = await import('../../../server/api/v1/recognition/mineru/upload-url.post')

describe('POST /api/v1/recognition/image', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path', async () => {
        ;(createImageRecognitionByBase64Service as any).mockResolvedValue({
            success: true,
            record: { id: 1, imageType: 'photo', markdownContent: '# x', htmlContent: '<h1>x</h1>' },
        })
        const res: any = await imageHandler(makeEvent({
            userId: 100, body: { base64Data: 'abc', mimeType: 'image/jpeg', ossFileId: 1 },
        }) as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await imageHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await imageHandler(makeEvent({
            userId: 100, body: { base64Data: '', mimeType: 'image/x', ossFileId: 1 },
        }) as any)
        expectError(res, 400)
    })

    it('service 返失败有 record → 500', async () => {
        ;(createImageRecognitionByBase64Service as any).mockResolvedValue({
            success: false, record: { id: 1 }, error: 'OOM',
        })
        const res: any = await imageHandler(makeEvent({
            userId: 100, body: { base64Data: 'abc', mimeType: 'image/jpeg', ossFileId: 1 },
        }) as any)
        expectError(res, 500)
    })

    it('service 返失败无 record → 400', async () => {
        ;(createImageRecognitionByBase64Service as any).mockResolvedValue({ success: false, error: 'X' })
        const res: any = await imageHandler(makeEvent({
            userId: 100, body: { base64Data: 'abc', mimeType: 'image/jpeg', ossFileId: 1 },
        }) as any)
        expectError(res, 400)
    })

    it('service 抛错 → 500', async () => {
        ;(createImageRecognitionByBase64Service as any).mockRejectedValue(new Error('boom'))
        const res: any = await imageHandler(makeEvent({
            userId: 100, body: { base64Data: 'abc', mimeType: 'image/jpeg', ossFileId: 1 },
        }) as any)
        expectError(res, 500)
    })
})

describe('POST /api/v1/recognition/start', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([
            { id: 1, fileName: 'a.pdf' },
        ])
        ;(detectFileTypeService as any).mockReturnValue(2 /* DOCUMENT */)
        ;(convertPdfService as any).mockResolvedValue({ success: true })
    })

    it('happy path: pdf → MinerU', async () => {
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [1] } }) as any)
        expectSuccess(res, d => expect(d.results[0].status).toBe('processing'))
    })

    it('未登录 → 401', async () => {
        const res: any = await startHandler(makeEvent({ body: { ossFileIds: [1] } }) as any)
        expectError(res, 401)
    })

    it('参数非法 → 400', async () => {
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [] } }) as any)
        expectError(res, 400)
    })

    it('文件不存在 → results 标 failed', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([])
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [1] } }) as any)
        expectSuccess(res, d => expect(d.results[0].status).toBe('failed'))
    })

    it('图片类型 → OCR', async () => {
        ;(detectFileTypeService as any).mockReturnValue(3 /* IMAGE */)
        ;(createImageConversionService as any).mockResolvedValue({ success: true })
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [1] } }) as any)
        expectSuccess(res)
    })

    it('音频类型 → ASR', async () => {
        ;(detectFileTypeService as any).mockReturnValue(4 /* AUDIO */)
        ;(transcribeAudioService as any).mockResolvedValue({ success: true })
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [1] } }) as any)
        expectSuccess(res)
    })

    it('md 文件 → 直接读取（同步 completed）', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([{ id: 1, fileName: 'a.md' }])
        ;(detectFileTypeService as any).mockReturnValue(2)
        ;(readTextFileService as any).mockResolvedValue({ success: true })
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [1] } }) as any)
        expectSuccess(res, d => expect(d.results[0].status).toBe('completed'))
    })

    it('docx 文件 → 同步 completed', async () => {
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([{ id: 1, fileName: 'a.docx' }])
        ;(detectFileTypeService as any).mockReturnValue(2)
        ;(recognizeDocxService as any).mockResolvedValue({ success: true })
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [1] } }) as any)
        expectSuccess(res, d => expect(d.results[0].status).toBe('completed'))
    })

    it('已有成功记录（taskId=existing）→ completed', async () => {
        ;(convertPdfService as any).mockResolvedValue({ success: true, task: { taskId: 'existing' } })
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [1] } }) as any)
        expectSuccess(res, d => expect(d.results[0].status).toBe('completed'))
    })

    it('未知类型走默认 MinerU', async () => {
        ;(detectFileTypeService as any).mockReturnValue(99)
        const res: any = await startHandler(makeEvent({ userId: 100, body: { ossFileIds: [1] } }) as any)
        expectSuccess(res)
    })
})

describe('GET /api/v1/recognition/status/:ossFileId', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // owner-only：默认 ossFile 属于 user 100，便于命中后续状态分支
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({ id: 1, userId: 100 })
    })

    it('mineruTask 命中（即使 SUCCESS 也强制 recognized=false）', async () => {
        // mineruTask 表无 summary 字段；mineruTask 命中通常说明 docRecord 还未创建或摘要未生成
        // 必须返回 recognized=false 让前端继续轮询，等到 docRecord.summary 就绪再放行
        ;(getMineruTaskByOssFileIdService as any).mockResolvedValue({ status: 2 /* SUCCESS */ })
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => expect(d.recognized).toBe(false))
    })

    it('mineruTask processing → 1', async () => {
        ;(getMineruTaskByOssFileIdService as any).mockResolvedValue({ status: 1 /* PROCESSING */ })
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => expect(d.status).toBe(1))
    })

    it('docRecord 命中', async () => {
        ;(getMineruTaskByOssFileIdService as any).mockResolvedValue(null)
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue({ status: 2 /* SUCCESS */ })
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => expect(d.recordType).toBe('doc'))
    })

    it('imageRecord 命中', async () => {
        ;(getMineruTaskByOssFileIdService as any).mockResolvedValue(null)
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(findImageRecognitionByOssFileIdDao as any).mockResolvedValue({ status: 2 /* COMPLETED */ })
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => expect(d.recordType).toBe('image'))
    })

    it('asrRecord 命中', async () => {
        ;(getMineruTaskByOssFileIdService as any).mockResolvedValue(null)
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(findImageRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(findAsrRecordByOssFileIdDao as any).mockResolvedValue({ status: 2 /* SUCCESS */ })
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => expect(d.recordType).toBe('audio'))
    })

    it('全部无记录 → unknown', async () => {
        ;(getMineruTaskByOssFileIdService as any).mockResolvedValue(null)
        ;(findDocRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(findImageRecognitionByOssFileIdDao as any).mockResolvedValue(null)
        ;(findAsrRecordByOssFileIdDao as any).mockResolvedValue(null)
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectSuccess(res, d => expect(d.recordType).toBe('unknown'))
    })

    it('未登录 → 401', async () => {
        const res: any = await statusHandler(makeEvent({ params: { ossFileId: '1' } }) as any)
        expectError(res, 401)
    })

    it('id 非数字 → 400', async () => {
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: 'abc' } }) as any)
        expectError(res, 400)
    })

    it('service 抛错 → 500', async () => {
        ;(getMineruTaskByOssFileIdService as any).mockRejectedValue(new Error('db'))
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectError(res, 500)
    })

    it('ossFile 属于他人 → 404 越权拒绝', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValueOnce(null)
        const res: any = await statusHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectError(res, 404)
    })
})

describe('GET /api/v1/recognition/audio/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy path（audioUrl 已存在）', async () => {
        ;(getAsrRecordByIdService as any).mockResolvedValue({
            id: 1, userId: 100, status: 2, audioUrl: 'http://existing', audioDuration: 60,
            result: { transcripts: [{ sentences: [{ text: 'hi', begin_time: 0, end_time: 1, speaker_id: 0, sentence_id: 0 }] }] },
            speakers: [{ id: 0, name: 'A', color: '#fff' }],
        })
        const res: any = await audioGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
        expectSuccess(res)
    })

    it('audioUrl 缺失 → 走签名 URL', async () => {
        ;(getAsrRecordByIdService as any).mockResolvedValue({
            id: 1, userId: 100, status: 2, audioUrl: '', ossFileId: 5,
            result: null, speakers: null,
        })
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({ id: 5, filePath: 'p' })
        const res: any = await audioGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
        expectSuccess(res, d => expect(d.audioUrl).toContain('signed'))
    })

    it('未登录 → 401', async () => {
        const res: any = await audioGetHandler(makeEvent({ params: { id: '1' } }) as any)
        expectError(res, 401)
    })

    it('id 非数字 → 400', async () => {
        const res: any = await audioGetHandler(makeEvent({ userId: 100, params: { id: 'x' } }) as any)
        expectError(res, 400)
    })

    it('记录不存在 → 404', async () => {
        ;(getAsrRecordByIdService as any).mockResolvedValue(null)
        const res: any = await audioGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
        expectError(res, 404)
    })

    it('记录非本人 → 403', async () => {
        ;(getAsrRecordByIdService as any).mockResolvedValue({ id: 1, userId: 999 })
        const res: any = await audioGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
        expectError(res, 403)
    })

    it('service 抛错 → 500', async () => {
        ;(getAsrRecordByIdService as any).mockRejectedValue(new Error('db'))
        const res: any = await audioGetHandler(makeEvent({ userId: 100, params: { id: '1' } }) as any)
        expectError(res, 500)
    })
})

describe('PUT /api/v1/recognition/audio/:id', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy: 更新 speakers + summary', async () => {
        ;(getAsrRecordByIdService as any).mockResolvedValue({ id: 1, userId: 100 })
        ;(updateAsrRecordService as any).mockResolvedValue({
            id: 1, speakers: [{ id: 0, name: 'A', color: '#000000' }], keywords: null, summary: 's',
        })
        const res: any = await audioPutHandler(makeEvent({
            userId: 100, params: { id: '1' },
            body: { speakers: [{ id: 0, name: 'A', color: '#000000' }], summary: 's' },
        }) as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await audioPutHandler(makeEvent({ params: { id: '1' }, body: { summary: 'x' } }) as any)
        expectError(res, 401)
    })

    it('id 非数字 → 400', async () => {
        const res: any = await audioPutHandler(makeEvent({
            userId: 100, params: { id: 'x' }, body: { summary: 'x' },
        }) as any)
        expectError(res, 400)
    })

    it('未提供更新字段 → 400', async () => {
        const res: any = await audioPutHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: {},
        }) as any)
        expectError(res, 400)
    })

    it('记录不存在 → 404', async () => {
        ;(getAsrRecordByIdService as any).mockResolvedValue(null)
        const res: any = await audioPutHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: { summary: 'x' },
        }) as any)
        expectError(res, 404)
    })

    it('非本人 → 403', async () => {
        ;(getAsrRecordByIdService as any).mockResolvedValue({ id: 1, userId: 999 })
        const res: any = await audioPutHandler(makeEvent({
            userId: 100, params: { id: '1' }, body: { summary: 'x' },
        }) as any)
        expectError(res, 403)
    })
})

describe('POST /api/v1/recognition/audio', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({
            id: 1, userId: 100, fileType: 'audio/mpeg', encrypted: false, fileName: 'a.mp3',
        })
        ;(transcribeAudioService as any).mockResolvedValue({ success: true, task: { taskId: 'T', status: 1 } })
    })

    it('happy path', async () => {
        const res: any = await audioPostHandler(makeEvent({
            userId: 100, body: { ossFileId: 1 },
        }) as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await audioPostHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await audioPostHandler(makeEvent({
            userId: 100, body: { ossFileId: -1 },
        }) as any)
        expectError(res, 400)
    })

    it('文件不存在 → 404', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue(null)
        const res: any = await audioPostHandler(makeEvent({
            userId: 100, body: { ossFileId: 1 },
        }) as any)
        expectError(res, 404)
    })

    it('不支持的音频类型 → 400', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({
            id: 1, userId: 100, fileType: 'video/mp4', encrypted: false, fileName: 'x.mp4',
        })
        const res: any = await audioPostHandler(makeEvent({
            userId: 100, body: { ossFileId: 1 },
        }) as any)
        expectError(res, 400, '不支持')
    })

    it('tempFilePath 路径不合法 → 400', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({
            id: 1, userId: 100, fileType: 'audio/mpeg', encrypted: true, fileName: 'x.mp3',
        })
        const res: any = await audioPostHandler(makeEvent({
            userId: 100, body: { ossFileId: 1, tempFilePath: 'evil/path' },
        }) as any)
        expectError(res, 400, '路径')
    })

    it('tempFilePath 与当前用户和文件绑定时允许提交', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({
            id: 1, userId: 100, fileType: 'audio/mpeg', encrypted: true, fileName: 'x.mp3',
        })
        const res: any = await audioPostHandler(makeEvent({
            userId: 100,
            body: { ossFileId: 1, tempFilePath: 'temp/asr/user100/file1/2026/05/19/a.mp3' },
        }) as any)
        expectSuccess(res)
    })

    it('service 失败 → 400', async () => {
        ;(transcribeAudioService as any).mockResolvedValue({ success: false, error: 'X' })
        const res: any = await audioPostHandler(makeEvent({
            userId: 100, body: { ossFileId: 1 },
        }) as any)
        expectError(res, 400)
    })

    it('service 抛错 → 500', async () => {
        ;(transcribeAudioService as any).mockRejectedValue(new Error('boom'))
        const res: any = await audioPostHandler(makeEvent({
            userId: 100, body: { ossFileId: 1 },
        }) as any)
        expectError(res, 500)
    })
})

describe('GET /api/v1/recognition/audio/by-oss-file/:ossFileId', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy', async () => {
        ;(findAsrRecordByOssFileIdDao as any).mockResolvedValue({
            id: 1, userId: 100, ossFileId: 5, status: 2, audioUrl: 'http://x',
            result: null, speakers: null, audioDuration: 30,
        })
        const res: any = await audioByOssHandler(makeEvent({ userId: 100, params: { ossFileId: '5' } }) as any)
        expectSuccess(res)
    })

    it('未登录 → 401', async () => {
        const res: any = await audioByOssHandler(makeEvent({ params: { ossFileId: '1' } }) as any)
        expectError(res, 401)
    })

    it('id 非数字 → 400', async () => {
        const res: any = await audioByOssHandler(makeEvent({ userId: 100, params: { ossFileId: 'x' } }) as any)
        expectError(res, 400)
    })

    it('记录不存在 → 404', async () => {
        ;(findAsrRecordByOssFileIdDao as any).mockResolvedValue(null)
        const res: any = await audioByOssHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectError(res, 404)
    })

    it('非本人 → 403', async () => {
        ;(findAsrRecordByOssFileIdDao as any).mockResolvedValue({ userId: 999 })
        const res: any = await audioByOssHandler(makeEvent({ userId: 100, params: { ossFileId: '1' } }) as any)
        expectError(res, 403)
    })
})

describe('GET /api/v1/recognition/audio/task/:taskId', () => {
    beforeEach(() => vi.clearAllMocks())

    it('happy', async () => {
        ;(getAsrTaskByTaskIdService as any).mockResolvedValue({ id: 1, taskId: 'T', status: 1, taskRawData: { userId: 100 } })
        ;(findAsrRecordsByTaskIdDao as any).mockResolvedValue([{ id: 5, userId: 100, status: 2 }])
        const res: any = await audioTaskHandler(makeEvent({ userId: 100, params: { taskId: 'T' } }) as any)
        expectSuccess(res, d => expect(d.recordId).toBe(5))
    })

    it('happy path 无记录', async () => {
        ;(getAsrTaskByTaskIdService as any).mockResolvedValue({ id: 1, taskId: 'T', status: 1, taskRawData: { userId: 100 } })
        ;(findAsrRecordsByTaskIdDao as any).mockResolvedValue([])
        const res: any = await audioTaskHandler(makeEvent({ userId: 100, params: { taskId: 'T' } }) as any)
        expectSuccess(res, d => expect(d.recordId).toBeNull())
    })

    it('非本人任务 → 404', async () => {
        ;(getAsrTaskByTaskIdService as any).mockResolvedValue({ id: 1, taskId: 'T', status: 1, taskRawData: { userId: 999 } })
        ;(findAsrRecordsByTaskIdDao as any).mockResolvedValue([])
        const res: any = await audioTaskHandler(makeEvent({ userId: 100, params: { taskId: 'T' } }) as any)
        expectError(res, 404)
    })

    it('未登录 → 401', async () => {
        const res: any = await audioTaskHandler(makeEvent({ params: { taskId: 'T' } }) as any)
        expectError(res, 401)
    })

    it('缺 taskId → 400', async () => {
        const res: any = await audioTaskHandler(makeEvent({ userId: 100, params: {} }) as any)
        expectError(res, 400)
    })

    it('任务不存在 → 404', async () => {
        ;(getAsrTaskByTaskIdService as any).mockResolvedValue(null)
        const res: any = await audioTaskHandler(makeEvent({ userId: 100, params: { taskId: 'T' } }) as any)
        expectError(res, 404)
    })
})

describe('POST /api/v1/recognition/audio/temp-upload', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({
            id: 1, userId: 100, encrypted: true, originalMimeType: 'audio/mpeg',
        })
    })

    it('happy', async () => {
        const res: any = await audioTempHandler(makeEvent({
            userId: 100,
            body: { ossFileId: 1, fileName: 'a.mp3', fileSize: 1024, mimeType: 'audio/mpeg' },
        }) as any)
        expectSuccess(res, d => expect(d.key).toContain('temp/asr/user100/file1/'))
    })

    it('未登录 → 401', async () => {
        const res: any = await audioTempHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('Zod 失败 → 400', async () => {
        const res: any = await audioTempHandler(makeEvent({
            userId: 100, body: { ossFileId: -1, fileName: '', fileSize: 0, mimeType: '' },
        }) as any)
        expectError(res, 400)
    })

    it('不支持的 MIME → 400', async () => {
        const res: any = await audioTempHandler(makeEvent({
            userId: 100, body: { ossFileId: 1, fileName: 'a.mp4', fileSize: 100, mimeType: 'video/mp4' },
        }) as any)
        expectError(res, 400, '不支持')
    })

    it('原始文件不存在 → 404', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue(null)
        const res: any = await audioTempHandler(makeEvent({
            userId: 100, body: { ossFileId: 1, fileName: 'a.mp3', fileSize: 100, mimeType: 'audio/mpeg' },
        }) as any)
        expectError(res, 404)
    })

    it('原始文件未加密 → 400', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({
            id: 1, userId: 100, encrypted: false,
        })
        const res: any = await audioTempHandler(makeEvent({
            userId: 100, body: { ossFileId: 1, fileName: 'a.mp3', fileSize: 100, mimeType: 'audio/mpeg' },
        }) as any)
        expectError(res, 400, '未加密')
    })

    it('originalMimeType 非音频 → 400', async () => {
        ;(globalThis as any).prisma.ossFiles.findFirst.mockResolvedValue({
            id: 1, userId: 100, encrypted: true, originalMimeType: 'image/png',
        })
        const res: any = await audioTempHandler(makeEvent({
            userId: 100, body: { ossFileId: 1, fileName: 'a.png', fileSize: 100, mimeType: 'audio/mpeg' },
        }) as any)
        expectError(res, 400, '原始文件')
    })
})

describe('GET /api/v1/recognition/audio/task & MinerU/doc handlers (smoke)', () => {
    beforeEach(() => vi.clearAllMocks())

    it('mineru/task/:taskId - 未登录 401', async () => {
        const res: any = await mineruTaskHandler(makeEvent({ params: { taskId: 'T' } }) as any)
        expectError(res, 401)
    })

    it('mineru/task/:taskId - task 归他人 → 404 越权拒绝', async () => {
        const { getMineruTaskByTaskIdService } = await import('~~/server/services/material/mineruTask.service')
        ;(getMineruTaskByTaskIdService as any).mockResolvedValueOnce({ id: 1, userId: 999, status: 2, ossFileId: 5, errorMsg: null })
        const res: any = await mineruTaskHandler(makeEvent({ userId: 100, params: { taskId: 'T' } }) as any)
        expectError(res, 404)
    })

    it('mineru/upload - 未登录 401', async () => {
        const res: any = await mineruUploadHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('mineru/upload - Zod 失败 400', async () => {
        const res: any = await mineruUploadHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('mineru/submit - 未登录 401', async () => {
        const res: any = await mineruSubmitHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('mineru/submit - Zod 失败 400', async () => {
        const res: any = await mineruSubmitHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('mineru/submit - token 不可用 → 500', async () => {
        ;(pickTokenForNewTaskService as any).mockResolvedValue(null)
        const res: any = await mineruSubmitHandler(makeEvent({
            userId: 100, body: { ossFileId: 1, fileName: 'a.pdf' },
        }) as any)
        expectError(res, 500)
    })

    it('mineru/upload-url - 未登录 401', async () => {
        const res: any = await mineruUploadUrlHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('mineru/upload-url - Zod 失败 400', async () => {
        const res: any = await mineruUploadUrlHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('mineru/upload-url - token 不可用 → 500', async () => {
        ;(pickTokenForNewTaskService as any).mockResolvedValue(null)
        const res: any = await mineruUploadUrlHandler(makeEvent({
            userId: 100, body: { files: [{ ossFileId: 1, fileName: 'a.pdf' }] },
        }) as any)
        expectError(res, 500)
    })

    it('mineru/upload-url - 文件存在性校验失败 → 404', async () => {
        ;(pickTokenForNewTaskService as any).mockResolvedValue({ id: 1, token: 'tk' })
        ;(globalThis as any).prisma.ossFiles.findMany.mockResolvedValue([])
        const res: any = await mineruUploadUrlHandler(makeEvent({
            userId: 100, body: { files: [{ ossFileId: 1, fileName: 'a.pdf' }] },
        }) as any)
        expectError(res, 404)
    })

    it('doc/save - 未登录 401', async () => {
        const res: any = await docSaveHandler(makeEvent({ body: {} }) as any)
        expectError(res, 401)
    })

    it('doc/save - Zod 失败 400', async () => {
        const res: any = await docSaveHandler(makeEvent({ userId: 100, body: {} }) as any)
        expectError(res, 400)
    })

    it('doc/status/:ossFileId - 未登录 401', async () => {
        const res: any = await docStatusHandler(makeEvent({ params: { ossFileId: '1' } }) as any)
        expectError(res, 401)
    })

    it('doc/status/:ossFileId - id 非数字 → 400', async () => {
        const res: any = await docStatusHandler(makeEvent({ userId: 100, params: { ossFileId: 'x' } }) as any)
        expectError(res, 400)
    })
})
