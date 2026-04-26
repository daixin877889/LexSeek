/**
 * DocumentExport Service 测试
 *
 * 使用 Mock 策略：mock OSS 上传/下载/signedUrl/DAO 调用，
 * 专注测试主流程编排（权限校验、docxtemplater 渲染、DB 更新）。
 *
 * **Feature: document-generation**
 * **Validates: Task 4.1**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import '../../case/test-setup'

// ==================== Mock 外部依赖（必须在 import 被测模块之前） ====================

vi.mock('~~/server/agents/document/documentDraft.dao', () => ({
    getDocumentDraftDAO: vi.fn(),
    updateDocumentDraftDAO: vi.fn(),
}))

vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    getDocumentTemplateDAO: vi.fn(),
}))

vi.mock('~~/server/agents/document/documentDraftVersion.dao', () => ({
    getVersionByIdDAO: vi.fn(),
}))

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn(),
    createOssFileDao: vi.fn(),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    downloadFileService: vi.fn(),
    uploadFileService: vi.fn(),
    generateSignedUrlService: vi.fn(),
}))

vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(),
}))

// ==================== 导入被测模块（在 mock 之后） ====================

import { exportDraftService, exportVersionByIdService } from '~~/server/agents/document/documentExport.service'
import { getDocumentDraftDAO, updateDocumentDraftDAO } from '~~/server/agents/document/documentDraft.dao'
import { getDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'
import { getVersionByIdDAO } from '~~/server/agents/document/documentDraftVersion.dao'
import { findOssFileByIdDao, createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import {
    downloadFileService,
    uploadFileService,
    generateSignedUrlService,
} from '~~/server/services/storage/storage.service'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'

// ==================== 类型转换 ====================

const mockGetDocumentDraftDAO = getDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockUpdateDocumentDraftDAO = updateDocumentDraftDAO as ReturnType<typeof vi.fn>
const mockGetDocumentTemplateDAO = getDocumentTemplateDAO as ReturnType<typeof vi.fn>
const mockGetVersionByIdDAO = getVersionByIdDAO as ReturnType<typeof vi.fn>
const mockFindOssFileByIdDao = findOssFileByIdDao as ReturnType<typeof vi.fn>
const mockCreateOssFileDao = createOssFileDao as ReturnType<typeof vi.fn>
const mockDownloadFileService = downloadFileService as ReturnType<typeof vi.fn>
const mockUploadFileService = uploadFileService as ReturnType<typeof vi.fn>
const mockGenerateSignedUrlService = generateSignedUrlService as ReturnType<typeof vi.fn>
const mockGetDefaultStorageConfigDao = getDefaultStorageConfigDao as ReturnType<typeof vi.fn>

// ==================== 测试帮助数据 ====================

/** 构造最小可用的真实 .docx Buffer（PizZip + docxtemplater 可解析） */
async function buildMinimalDocxBuffer(template: string): Promise<Buffer> {
    const PizZip = (await import('pizzip')).default
    const Docxtemplater = (await import('docxtemplater')).default

    // 构造最小 docx（只含 word/document.xml）
    const zip = new PizZip()
    zip.folder('word')
    zip.file(
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${template}</w:t></w:r></w:p></w:body>
</w:document>`,
    )
    zip.file(
        '[Content_Types].xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    )
    zip.file(
        '_rels/.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`,
    )

    return zip.generate({ type: 'nodebuffer' }) as Buffer
}

const MOCK_DRAFT_READY = {
    id: 10,
    userId: 100,
    templateId: 1,
    sessionId: 'test-session-uuid',
    status: 'ready',
    values: { plaintiff: '张三', defendant: '李四' },
    sourceRef: null,
    metadata: null,
    caseId: null,
    outputFileId: null,
}

const MOCK_TEMPLATE = {
    id: 1,
    name: '起诉状模板',
    ossFileId: 5,
    placeholders: [{ name: 'plaintiff' }, { name: 'defendant' }],
    deletedAt: null,
}

const MOCK_OSS_FILE = {
    id: 5,
    filePath: 'templates/1/起诉状模板.docx',
    fileName: '起诉状模板.docx',
    fileSize: 1024,
    fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const MOCK_STORAGE_CONFIG = {
    id: 1,
    bucket: 'test-bucket',
}

const MOCK_UPLOAD_RESULT = {
    name: 'users/100/document-exports/12345_起诉状模板.docx',
    etag: 'test-etag',
    url: 'https://oss.example.com/...',
}

const MOCK_CREATED_OSS_FILE = {
    id: 99,
    filePath: 'users/100/document-exports/12345_起诉状模板.docx',
    fileName: '起诉状模板.docx',
}

const MOCK_SIGNED_URL = 'https://oss.example.com/signed-download-url?expires=3600'

// ==================== beforeEach 默认 mock 设置 ====================

beforeEach(async () => {
    vi.resetAllMocks()

    // 默认成功路径
    mockGetDocumentDraftDAO.mockResolvedValue(MOCK_DRAFT_READY)
    mockGetDocumentTemplateDAO.mockResolvedValue(MOCK_TEMPLATE)
    mockGetVersionByIdDAO.mockResolvedValue(null)
    mockFindOssFileByIdDao.mockResolvedValue(MOCK_OSS_FILE)
    mockGetDefaultStorageConfigDao.mockResolvedValue(MOCK_STORAGE_CONFIG)
    mockDownloadFileService.mockResolvedValue(await buildMinimalDocxBuffer('原告：{{plaintiff}}，被告：{{defendant}}'))
    mockUploadFileService.mockResolvedValue(MOCK_UPLOAD_RESULT)
    mockCreateOssFileDao.mockResolvedValue(MOCK_CREATED_OSS_FILE)
    mockGenerateSignedUrlService.mockResolvedValue(MOCK_SIGNED_URL)
    mockUpdateDocumentDraftDAO.mockResolvedValue({ ...MOCK_DRAFT_READY, status: 'exported', outputFileId: 99 })
})

afterEach(() => {
    vi.clearAllMocks()
})

// ==================== 权限校验 ====================

describe('exportDraftService - 权限校验', () => {
    it('草稿不存在时返回 { error, code: 404 }', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue(null)

        const result = await exportDraftService(100, 999)

        expect(result).toEqual({ error: '草稿不存在', code: 404 })
        expect(mockGetDocumentTemplateDAO).not.toHaveBeenCalled()
    })

    it('draft 不属于当前用户时返回 { error, code: 403 }', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT_READY,
            userId: 200, // 不是调用者
        })

        const result = await exportDraftService(100, 10)

        expect(result).toEqual({ error: '无权导出此草稿', code: 403 })
        expect(mockDownloadFileService).not.toHaveBeenCalled()
    })

    it('draft.status 不是 ready/exported 时返回 { error, code: 400 }', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT_READY,
            status: 'drafting',
        })

        const result = await exportDraftService(100, 10)

        expect(result).toEqual({ error: '草稿未就绪，无法导出', code: 400 })
        expect(mockDownloadFileService).not.toHaveBeenCalled()
    })

    it('draft.status=exported 时允许重复导出', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT_READY,
            status: 'exported',
        })

        const result = await exportDraftService(100, 10)

        expect(result).not.toHaveProperty('code')
        expect(result).toHaveProperty('ossFileId')
    })
})

// ==================== 模板校验 ====================

describe('exportDraftService - 模板校验', () => {
    it('模板已软删（deletedAt != null）时返回 { error, code: 404 }', async () => {
        mockGetDocumentTemplateDAO.mockResolvedValue(null) // DAO 内已过滤 deletedAt != null

        const result = await exportDraftService(100, 10)

        expect(result).toEqual({ error: '模板已删除，无法导出', code: 404 })
        expect(mockDownloadFileService).not.toHaveBeenCalled()
    })

    it('模板 ossFile 不存在时返回 { error, code: 404 }', async () => {
        mockFindOssFileByIdDao.mockResolvedValue(null)

        const result = await exportDraftService(100, 10)

        expect(result).toEqual({ error: '模板文件丢失', code: 404 })
        expect(mockDownloadFileService).not.toHaveBeenCalled()
    })
})

// ==================== 正常渲染流程 ====================

describe('exportDraftService - 正常渲染流程', () => {
    it('成功时返回 { ossFileId, downloadUrl }', async () => {
        const result = await exportDraftService(100, 10)

        expect(result).toEqual({
            ossFileId: MOCK_CREATED_OSS_FILE.id,
            downloadUrl: MOCK_SIGNED_URL,
        })
    })

    it('调用 downloadFileService 下载模板', async () => {
        await exportDraftService(100, 10)

        expect(mockDownloadFileService).toHaveBeenCalledWith(
            MOCK_OSS_FILE.filePath,
            expect.objectContaining({ userId: 100 }),
        )
    })

    it('调用 uploadFileService 上传渲染结果', async () => {
        await exportDraftService(100, 10)

        expect(mockUploadFileService).toHaveBeenCalledWith(
            expect.stringContaining('users/100/document-exports/'),
            expect.any(Buffer),
            expect.objectContaining({
                contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            }),
        )
    })

    it('调用 createOssFileDao 写 ossFiles 记录', async () => {
        await exportDraftService(100, 10)

        expect(mockCreateOssFileDao).toHaveBeenCalledWith(
            expect.objectContaining({
                fileName: expect.stringContaining('.docx'),
                source: 'document_export',
            }),
        )
    })

    it('调用 updateDocumentDraftDAO 更新 status=exported 和 outputFileId', async () => {
        await exportDraftService(100, 10)

        expect(mockUpdateDocumentDraftDAO).toHaveBeenCalledWith(
            10,
            expect.objectContaining({
                status: 'exported',
                outputFileId: MOCK_CREATED_OSS_FILE.id,
            }),
        )
    })

    it('调用 generateSignedUrlService 生成下载链接', async () => {
        await exportDraftService(100, 10)

        expect(mockGenerateSignedUrlService).toHaveBeenCalledWith(
            MOCK_UPLOAD_RESULT.name,
            expect.objectContaining({ expires: 3600 }),
        )
    })
})

// ==================== 缺字段处理（nullGetter） ====================

describe('exportDraftService - 缺字段处理', () => {
    it('values 缺部分占位符时不抛错，缺失字段渲染为空字符串', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT_READY,
            values: { plaintiff: '张三' }, // 缺 defendant
        })

        // 不应抛错
        await expect(exportDraftService(100, 10)).resolves.not.toThrow()

        const result = await exportDraftService(100, 10)
        expect(result).toHaveProperty('ossFileId')
        expect(result).toHaveProperty('downloadUrl')
    })

    it('values 为空对象时也不抛错', async () => {
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT_READY,
            values: {},
        })

        await expect(exportDraftService(100, 10)).resolves.not.toThrow()
        const result = await exportDraftService(100, 10)
        expect(result).toHaveProperty('ossFileId')
    })
})

// ==================== exportVersionByIdService ====================

describe('exportVersionByIdService', () => {
    const MOCK_VERSION = {
        id: 7,
        draftId: 10,
        versionNo: 1,
        name: '第一稿',
        titleAt: '民事起诉状',
        values: { plaintiff: '张三', defendant: '李四' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
    }

    it('版本不存在时返回 { error, code: 404 }', async () => {
        mockGetVersionByIdDAO.mockResolvedValue(null)

        const result = await exportVersionByIdService(100, 999)

        expect(result).toEqual({ error: '版本不存在', code: 404 })
        expect(mockGetDocumentDraftDAO).not.toHaveBeenCalled()
    })

    it('版本存在但 draft 不属于当前用户时返回 { error, code: 403 }', async () => {
        mockGetVersionByIdDAO.mockResolvedValue(MOCK_VERSION)
        mockGetDocumentDraftDAO.mockResolvedValue({
            ...MOCK_DRAFT_READY,
            userId: 200, // 不是调用者
        })

        const result = await exportVersionByIdService(100, 7)

        expect(result).toEqual({ error: '无权导出此版本', code: 403 })
        expect(mockDownloadFileService).not.toHaveBeenCalled()
    })
})
