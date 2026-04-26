/**
 * DocumentTemplate Service 测试
 *
 * 使用 Mock 策略 A：mock uploadFileService / createOssFileDao / getDefaultStorageConfigDao
 * 只测试业务逻辑（文件大小、格式、占位符、配额校验），OSS 集成由 Task 2.3 API 测试覆盖。
 *
 * **Feature: document-generation**
 * **Validates: Task 2.2**
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import '../../case/test-setup'

// ==================== Mock 外部依赖 ====================

vi.mock('~~/server/services/storage/storage.service', () => ({
    uploadFileService: vi.fn(),
}))

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    createOssFileDao: vi.fn(),
}))

vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(),
}))

vi.mock('~~/server/services/assistant/document/documentTemplate.dao', () => ({
    countUserTemplatesDAO: vi.fn(),
    createDocumentTemplateDAO: vi.fn(),
}))

vi.mock('~~/server/services/assistant/document/templateScanner', () => ({
    scanPlaceholders: vi.fn(),
}))

// docxtemplater 预编译校验只能在真实 docx 上跑通；测试用 fake buffer，
// 直接 mock 掉底层 PizZip + Docxtemplater 让 tryCompileTemplate 内 try 块不抛错。
vi.mock('pizzip', () => ({
    default: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('docxtemplater', () => ({
    default: vi.fn().mockImplementation(() => ({})),
}))

// ==================== 导入被测模块（在 mock 之后）====================

import { createDocumentTemplateService, MAX_PRIVATE_TEMPLATES } from '~~/server/services/assistant/document/documentTemplate.service'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { countUserTemplatesDAO, createDocumentTemplateDAO } from '~~/server/services/assistant/document/documentTemplate.dao'
import { scanPlaceholders } from '~~/server/services/assistant/document/templateScanner'

// ==================== 类型转换 ====================

const mockUploadFileService = uploadFileService as ReturnType<typeof vi.fn>
const mockCreateOssFileDao = createOssFileDao as ReturnType<typeof vi.fn>
const mockGetDefaultStorageConfigDao = getDefaultStorageConfigDao as ReturnType<typeof vi.fn>
const mockCountUserTemplatesDAO = countUserTemplatesDAO as ReturnType<typeof vi.fn>
const mockCreateDocumentTemplateDAO = createDocumentTemplateDAO as ReturnType<typeof vi.fn>
const mockScanPlaceholders = scanPlaceholders as ReturnType<typeof vi.fn>

// ==================== 测试帮助数据 ====================

/** 构造一个有效的 .docx Buffer（内容随意，因为 scanPlaceholders 已被 mock） */
const makeDocxBuffer = () => Buffer.from('fake-docx-content')

const BASE_PARAMS = {
    userId: 1,
    isAdmin: false,
    file: makeDocxBuffer(),
    fileName: 'test-template.docx',
    fileSize: 1024 * 100, // 100KB
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    name: '测试模板',
    category: 'litigation' as const,
    description: '用于测试的模板',
}

const MOCK_PLACEHOLDERS = [{ name: '原告', firstContext: '原告：{{原告}}' }]
const MOCK_UPLOAD_RESULT = { name: 'users/1/templates/12345_test-template.docx', url: 'https://oss.example.com/...' }
const MOCK_OSS_FILE = { id: 42, userId: 1, fileName: 'test-template.docx', fileSize: 102400 }
const MOCK_STORAGE_CONFIG = { bucket: 'my-test-bucket', type: 'aliyun_oss', name: '默认配置' }
const MOCK_TEMPLATE = { id: 100, name: '测试模板', scope: 'user' }

// ==================== beforeEach 默认 mock 设置 ====================

beforeEach(() => {
    vi.resetAllMocks()

    // 默认：成功路径
    mockScanPlaceholders.mockResolvedValue(MOCK_PLACEHOLDERS)
    mockGetDefaultStorageConfigDao.mockResolvedValue(MOCK_STORAGE_CONFIG)
    mockUploadFileService.mockResolvedValue(MOCK_UPLOAD_RESULT)
    mockCreateOssFileDao.mockResolvedValue(MOCK_OSS_FILE)
    mockCountUserTemplatesDAO.mockResolvedValue(0)
    mockCreateDocumentTemplateDAO.mockResolvedValue(MOCK_TEMPLATE)
})

afterEach(() => {
    vi.clearAllMocks()
})

// ==================== 测试套件 ====================

describe('createDocumentTemplateService', () => {

    // ==================== 文件格式/大小校验 ====================

    describe('文件格式校验', () => {
        it('文件大小 > 20MB 拒绝，返回 { error, code: 413 }', async () => {
            const result = await createDocumentTemplateService({
                ...BASE_PARAMS,
                fileSize: 20 * 1024 * 1024 + 1, // 超出 1 字节
            })

            expect(result).toEqual({ error: '文件不能超过 20MB', code: 413 })
            // 不应调用后续逻辑
            expect(mockScanPlaceholders).not.toHaveBeenCalled()
            expect(mockUploadFileService).not.toHaveBeenCalled()
        })

        it('文件恰好等于 20MB 时允许通过', async () => {
            const result = await createDocumentTemplateService({
                ...BASE_PARAMS,
                fileSize: 20 * 1024 * 1024,
            })

            // 应该进入后续流程（由于其他 mock 设置成功，结果是 templateId）
            expect(result).not.toHaveProperty('code', 413)
        })

        it('格式非 .docx 拒绝，返回 { error, code: 400 }', async () => {
            const result = await createDocumentTemplateService({
                ...BASE_PARAMS,
                fileName: 'bad-format.pdf',
            })

            expect(result).toEqual({ error: '仅支持 .docx 格式', code: 400 })
            expect(mockScanPlaceholders).not.toHaveBeenCalled()
        })

        it('文件名以 .docx 结尾的文件通过格式校验', async () => {
            const result = await createDocumentTemplateService({
                ...BASE_PARAMS,
                fileName: 'my-template.docx',
            })

            expect(result).not.toHaveProperty('code', 400)
            expect(result).toHaveProperty('templateId')
        })
    })

    // ==================== 占位符扫描 ====================

    describe('占位符扫描', () => {
        it('扫描无占位符返回 { error, code: 400 }', async () => {
            mockScanPlaceholders.mockResolvedValue([])

            const result = await createDocumentTemplateService(BASE_PARAMS)

            expect(result).toEqual({ error: '未扫描到占位符，请检查模板', code: 400 })
            expect(mockUploadFileService).not.toHaveBeenCalled()
        })

        it('扫描到占位符时继续执行', async () => {
            mockScanPlaceholders.mockResolvedValue(MOCK_PLACEHOLDERS)

            const result = await createDocumentTemplateService(BASE_PARAMS)

            expect(mockUploadFileService).toHaveBeenCalled()
            expect(result).toHaveProperty('templateId')
        })
    })

    // ==================== 普通用户上传成功 ====================

    describe('用户上传成功路径', () => {
        it('成功上传：扫描占位符 → OSS 上传 → 写 ossFiles + documentTemplates，返回 templateId', async () => {
            const result = await createDocumentTemplateService(BASE_PARAMS)

            // 核心断言：返回 templateId
            expect(result).toEqual({ templateId: MOCK_TEMPLATE.id })

            // 验证调用链
            expect(mockScanPlaceholders).toHaveBeenCalledWith(BASE_PARAMS.file)
            expect(mockGetDefaultStorageConfigDao).toHaveBeenCalled()
            expect(mockUploadFileService).toHaveBeenCalled()
            expect(mockCreateOssFileDao).toHaveBeenCalled()
            expect(mockCreateDocumentTemplateDAO).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: BASE_PARAMS.name,
                    category: BASE_PARAMS.category,
                    scope: 'user',
                    userId: BASE_PARAMS.userId,
                    ossFileId: MOCK_OSS_FILE.id,
                    placeholders: MOCK_PLACEHOLDERS,
                }),
                expect.anything(), // tx 参数
            )
        })

        it('上传 OSS 路径包含 userId（用户个人模板路径隔离）', async () => {
            await createDocumentTemplateService(BASE_PARAMS)

            const uploadCall = mockUploadFileService.mock.calls[0]
            const ossPath: string = uploadCall[0]
            expect(ossPath).toContain(`users/${BASE_PARAMS.userId}/`)
        })
    })

    // ==================== 配额校验 ====================

    describe('配额校验（普通用户 20 个上限）', () => {
        it('当前数量为 19，第 20 个上传成功', async () => {
            mockCountUserTemplatesDAO.mockResolvedValue(MAX_PRIVATE_TEMPLATES - 1)

            const result = await createDocumentTemplateService(BASE_PARAMS)

            expect(result).toHaveProperty('templateId')
        })

        it('当前数量已达 20，第 21 个被拒绝，返回 { error, code: 403 }', async () => {
            mockCountUserTemplatesDAO.mockResolvedValue(MAX_PRIVATE_TEMPLATES)

            const result = await createDocumentTemplateService(BASE_PARAMS)

            expect(result).toEqual({
                error: `私人模板已达上限 ${MAX_PRIVATE_TEMPLATES} 个`,
                code: 403,
            })
            // 不应调用 OSS 上传
            expect(mockUploadFileService).not.toHaveBeenCalled()
        })

        it('串行上传 20 个均成功', async () => {
            // 模拟每次计数递增
            let count = 0
            mockCountUserTemplatesDAO.mockImplementation(async () => count)
            mockCreateDocumentTemplateDAO.mockImplementation(async () => {
                count++
                return { id: count + 100, name: BASE_PARAMS.name, scope: 'user' }
            })

            for (let i = 0; i < MAX_PRIVATE_TEMPLATES; i++) {
                const result = await createDocumentTemplateService(BASE_PARAMS)
                expect(result).toHaveProperty('templateId')
            }
        })

        it('在 20 个之后（第 21 个）被拒', async () => {
            // 模拟已有 20 个
            mockCountUserTemplatesDAO.mockResolvedValue(MAX_PRIVATE_TEMPLATES)

            const result = await createDocumentTemplateService(BASE_PARAMS)

            expect(result).toEqual({
                error: `私人模板已达上限 ${MAX_PRIVATE_TEMPLATES} 个`,
                code: 403,
            })
        })

        it('检查配额时使用 countUserTemplatesDAO 并传入正确 userId', async () => {
            mockCountUserTemplatesDAO.mockResolvedValue(0)
            await createDocumentTemplateService(BASE_PARAMS)

            expect(mockCountUserTemplatesDAO).toHaveBeenCalledWith(
                BASE_PARAMS.userId,
                expect.anything(), // tx
            )
        })
    })

    // ==================== Admin 上传 ====================

    describe('Admin 上传（scope=global，不受配额限制）', () => {
        it('admin 上传成功，scope=global，不检查配额', async () => {
            const adminParams = { ...BASE_PARAMS, isAdmin: true, userId: 99 }

            const result = await createDocumentTemplateService(adminParams)

            expect(result).toHaveProperty('templateId')
            // admin 不调用 countUserTemplatesDAO
            expect(mockCountUserTemplatesDAO).not.toHaveBeenCalled()
        })

        it('admin 上传：createDocumentTemplateDAO 调用时 scope=global', async () => {
            const adminParams = { ...BASE_PARAMS, isAdmin: true, userId: 99 }

            await createDocumentTemplateService(adminParams)

            // admin 不走 transaction，第二个参数为 undefined
            expect(mockCreateDocumentTemplateDAO).toHaveBeenCalledWith(
                expect.objectContaining({
                    scope: 'global',
                    userId: null,
                }),
                undefined,
            )
        })

        it('admin 上传：OSS 路径使用 global-templates 前缀', async () => {
            const adminParams = { ...BASE_PARAMS, isAdmin: true, userId: 99 }

            await createDocumentTemplateService(adminParams)

            const uploadCall = mockUploadFileService.mock.calls[0]
            const ossPath: string = uploadCall[0]
            expect(ossPath).toContain('global-templates/')
        })
    })

    // ==================== 导出常量 ====================

    describe('导出常量', () => {
        it('MAX_PRIVATE_TEMPLATES 值为 20', () => {
            expect(MAX_PRIVATE_TEMPLATES).toBe(20)
        })
    })
})
