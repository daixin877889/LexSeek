/**
 * MinerU PDF 转换服务 - 工具函数行为测试
 *
 * 测试 mineru.service.ts 内部工具函数的行为：
 * - escapeRegExp（通过 replaceImagePaths 间接测试）
 * - extractMarkdownFromZip（通过 processConversionResultService 间接测试）
 * - markdownToHtml（通过 processConversionResultService 间接测试）
 *
 * 由于内部工具函数未导出，通过 processConversionResultService 的输出行为来验证。
 *
 * **Feature: mineru-service**
 * **Validates: Requirements 3.1.5, 3.1.6, 3.1.7, 3.1.8**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import JSZip from 'jszip'

// 模拟全局 logger（Nuxt 自动导入）
const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}
;(globalThis as any).logger = mockLogger

// 模拟全局 prisma
;(globalThis as any).prisma = {
    ossFiles: {
        create: vi.fn().mockResolvedValue({ id: 1 }),
    },
}

// 模拟全局 useRuntimeConfig
;(globalThis as any).useRuntimeConfig = vi.fn().mockReturnValue({
    storage: {
        aliyunOss: {
            bucket: 'test-bucket',
        },
    },
})

// 模拟全局状态常量
;(globalThis as any).DocRecognitionStatus = {
    PENDING: 0,
    PROCESSING: 1,
    SUCCESS: 2,
    FAILED: 3,
}
;(globalThis as any).MineruTaskStatus = {
    PENDING: 0,
    PROCESSING: 1,
    SUCCESS: 2,
    FAILED: 3,
}

// 模拟依赖模块
vi.mock('~~/server/services/material/mineruToken.service', () => ({
    getActiveTokenValueService: vi.fn().mockResolvedValue('mock-token'),
    hasActiveTokenService: vi.fn().mockResolvedValue(true),
}))

vi.mock('~~/server/services/material/mineruTask.service', () => ({
    createMineruTaskService: vi.fn(),
    updateMineruTaskService: vi.fn(),
    getMineruTaskByTaskIdService: vi.fn().mockResolvedValue(null),
    getPendingMineruTasksService: vi.fn().mockResolvedValue([]),
    isMineruTaskProcessedService: vi.fn().mockResolvedValue(false),
}))

vi.mock('~~/server/services/material/mineru.dao', () => ({
    createDocRecognitionRecordDao: vi.fn(),
    findDocRecognitionByOssFileIdDao: vi.fn().mockResolvedValue(null),
    updateDocRecognitionRecordDao: vi.fn(),
    findDocRecognitionsByOssFileIdsDao: vi.fn().mockResolvedValue([]),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    generateSignedUrlService: vi.fn().mockResolvedValue('https://example.com/signed-url'),
    uploadFileService: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~~/server/services/point/pointConsumption.service', () => ({
    checkPointsService: vi.fn().mockResolvedValue({ sufficient: true, required: 1, available: 100 }),
    consumePointsService: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    findOssFileByIdDao: vi.fn().mockResolvedValue(null),
    findOssFileByIdIncludeDeletedDao: vi.fn().mockResolvedValue(null),
}))

vi.mock('~~/server/services/material/imageProcessor', () => ({
    processUrlImagesInMarkdown: vi.fn().mockImplementation((md: string) => Promise.resolve(md)),
}))

vi.mock('~~/shared/utils/file', () => ({
    getExtensionFromFileName: vi.fn().mockImplementation((name: string) => {
        const ext = name.split('.').pop()
        return ext || 'png'
    }),
}))

vi.mock('~~/server/services/material/materialConstants', () => ({
    calculateBackoffDelay: vi.fn().mockReturnValue(1000),
    DEFAULT_POLLING_CONFIG: {
        initialDelay: 1000,
        backoffFactor: 1.5,
        maxDelay: 30000,
        maxRetries: 50,
    },
}))

// 模拟 ofetch（用于 MinerU API 调用和 ZIP 下载）
vi.mock('ofetch', () => ({
    $fetch: vi.fn(),
}))

describe('MinerU 服务 - 工具函数行为测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('extractMarkdownFromZip - 通过 processConversionResultService 测试', () => {
        /**
         * 构造一个包含 full.md 的 ZIP Buffer
         */
        async function createZipBuffer(mdContent: string, images?: Record<string, Buffer>): Promise<ArrayBuffer> {
            const zip = new JSZip()
            zip.file('full.md', mdContent)
            if (images) {
                for (const [name, buf] of Object.entries(images)) {
                    zip.file(name, buf)
                }
            }
            const buf = await zip.generateAsync({ type: 'arraybuffer' })
            return buf
        }

        it('应从 ZIP 中提取 full.md 内容并转换为 HTML', async () => {
            const mdContent = '# 测试标题\n\n这是正文内容'
            const zipBuffer = await createZipBuffer(mdContent)

            // 模拟 ofetch 返回 ZIP buffer
            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-123', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            expect(result.markdownContent).toBeDefined()
            expect(result.markdownContent).toContain('# 测试标题')
            expect(result.htmlContent).toBeDefined()
            expect(result.htmlContent).toContain('<h1>')
            expect(result.htmlContent).toContain('测试标题')
        })

        it('当 ZIP 中无 full.md 时应返回失败', async () => {
            const zip = new JSZip()
            zip.file('other.txt', '无关内容')
            const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' })

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-456', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('full.md')
        })

        it('应处理嵌套目录中的 full.md 文件', async () => {
            const zip = new JSZip()
            zip.file('output/full.md', '## 嵌套目录内容')
            const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' })

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-789', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            expect(result.markdownContent).toContain('## 嵌套目录内容')
        })

        it('应提取 ZIP 中的图片文件', async () => {
            // 创建一个 1x1 像素的最小 PNG
            const pngBuffer = Buffer.from([
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
            ])

            const mdContent = '# 带图片\n\n![图片](images/test.png)'
            const zip = new JSZip()
            zip.file('full.md', mdContent)
            zip.file('images/test.png', pngBuffer)
            const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' })

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-img', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            // 图片应该被替换为 OSS 占位符
            expect(result.markdownContent).toBeDefined()
        })

        it('应处理空 Markdown 文件', async () => {
            const zipBuffer = await createZipBuffer('')

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-empty', 'https://example.com/result.zip', 1)

            // 空 markdown 被视为没有找到 full.md 内容
            expect(result.success).toBe(false)
        })
    })

    describe('markdownToHtml - 通过 processConversionResultService 测试', () => {
        async function createZipBuffer(mdContent: string): Promise<ArrayBuffer> {
            const zip = new JSZip()
            zip.file('full.md', mdContent)
            return await zip.generateAsync({ type: 'arraybuffer' })
        }

        it('应将标题转换为 <h1> 标签', async () => {
            const zipBuffer = await createZipBuffer('# 一级标题')

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-h1', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            expect(result.htmlContent).toContain('<h1')
            expect(result.htmlContent).toContain('一级标题')
        })

        it('应将列表转换为 <ul>/<li> 标签', async () => {
            const zipBuffer = await createZipBuffer('- 项目一\n- 项目二\n- 项目三')

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-list', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            expect(result.htmlContent).toContain('<ul>')
            expect(result.htmlContent).toContain('<li>')
        })

        it('应支持 GFM 表格转换', async () => {
            const tableMarkdown = '| 列A | 列B |\n|------|------|\n| 值1 | 值2 |'
            const zipBuffer = await createZipBuffer(tableMarkdown)

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-table', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            expect(result.htmlContent).toContain('<table>')
            expect(result.htmlContent).toContain('<th>')
        })

        it('应将粗体文本转换为 <strong> 标签', async () => {
            const zipBuffer = await createZipBuffer('这是**粗体**文本')

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-bold', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            expect(result.htmlContent).toContain('<strong>')
            expect(result.htmlContent).toContain('粗体')
        })

        it('应将代码块转换为 <code> 标签', async () => {
            const zipBuffer = await createZipBuffer('```python\nprint("hello")\n```')

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-code', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            expect(result.htmlContent).toContain('<code')
        })

        it('应将换行转换为 <br> 标签（GFM breaks 模式）', async () => {
            const zipBuffer = await createZipBuffer('第一行\n第二行')

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-br', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
            expect(result.htmlContent).toContain('<br>')
        })
    })

    describe('escapeRegExp - 通过图片路径替换行为测试', () => {
        it('应正确处理包含正则特殊字符的图片文件名', async () => {
            // 文件名包含正则特殊字符：圆括号、方括号等
            const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47])
            const mdContent = '![图片](images/test(1).png)'
            const zip = new JSZip()
            zip.file('full.md', mdContent)
            zip.file('images/test(1).png', pngBuffer)
            const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' })

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-special', 'https://example.com/result.zip', 1)

            // 不应因正则特殊字符而抛错
            expect(result.success).toBe(true)
        })

        it('应正确处理包含加号的图片文件名', async () => {
            const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47])
            const mdContent = '![图片](images/a+b.png)'
            const zip = new JSZip()
            zip.file('full.md', mdContent)
            zip.file('images/a+b.png', pngBuffer)
            const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' })

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-plus', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
        })

        it('应正确处理包含点号的图片文件名', async () => {
            const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47])
            const mdContent = '![图片](images/file.v2.0.png)'
            const zip = new JSZip()
            zip.file('full.md', mdContent)
            zip.file('images/file.v2.0.png', pngBuffer)
            const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' })

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(zipBuffer)

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-dots', 'https://example.com/result.zip', 1)

            expect(result.success).toBe(true)
        })
    })

    describe('processConversionResultService - 错误处理', () => {
        it('下载 ZIP 失败时应返回失败结果', async () => {
            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockRejectedValue(new Error('网络错误'))

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-err', 'https://example.com/bad.zip', 1)

            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })

        it('无效 ZIP 数据时应返回失败结果', async () => {
            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue(new ArrayBuffer(10))

            const { processConversionResultService } = await import('~~/server/services/material/mineru.service')
            const result = await processConversionResultService('task-bad-zip', 'https://example.com/bad.zip', 1)

            expect(result.success).toBe(false)
            expect(result.error).toBeDefined()
        })
    })

    describe('checkUserPointsService', () => {
        it('应委托给 checkPointsService 并返回正确格式', async () => {
            const { checkPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(checkPointsService).mockResolvedValue({
                sufficient: true,
                required: 5,
                available: 100,
            })

            const { checkUserPointsService } = await import('~~/server/services/material/mineru.service')
            const result = await checkUserPointsService(1, 5)

            expect(result.sufficient).toBe(true)
            expect(result.required).toBe(5)
            expect(result.available).toBe(100)
        })

        it('积分不足时应返回 sufficient 为 false', async () => {
            const { checkPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(checkPointsService).mockResolvedValue({
                sufficient: false,
                required: 10,
                available: 5,
            })

            const { checkUserPointsService } = await import('~~/server/services/material/mineru.service')
            const result = await checkUserPointsService(1, 10)

            expect(result.sufficient).toBe(false)
            expect(result.required).toBe(10)
            expect(result.available).toBe(5)
        })

        it('checkPointsService 抛出异常时应向上传播', async () => {
            const { checkPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(checkPointsService).mockRejectedValue(new Error('积分服务不可用'))

            const { checkUserPointsService } = await import('~~/server/services/material/mineru.service')

            await expect(checkUserPointsService(1, 1)).rejects.toThrow('积分服务不可用')
        })
    })
})

// ==================== 服务层函数测试 ====================
describe('MinerU 服务 - 服务层函数', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== submitPdfConversionService ====================
    describe('submitPdfConversionService', () => {
        it('已有成功识别记录时应直接返回成功', async () => {
            const { findDocRecognitionByOssFileIdDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue({
                id: 1,
                ossFileId: 10,
                status: 2, // DocRecognitionStatus.SUCCESS
            } as any)

            const { submitPdfConversionService } = await import('~~/server/services/material/mineru.service')
            const result = await submitPdfConversionService(10, 1)

            expect(result.success).toBe(true)
            expect(result.task?.taskId).toBe('existing')
        })

        it('没有可用 Token 时应返回错误', async () => {
            const { findDocRecognitionByOssFileIdDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { hasActiveTokenService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(hasActiveTokenService).mockResolvedValue(false)

            const { submitPdfConversionService } = await import('~~/server/services/material/mineru.service')
            const result = await submitPdfConversionService(10, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('Token')
        })

        it('OSS 文件不存在时应返回错误', async () => {
            const { findDocRecognitionByOssFileIdDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { hasActiveTokenService, getActiveTokenValueService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(hasActiveTokenService).mockResolvedValue(true)
            vi.mocked(getActiveTokenValueService).mockResolvedValue('mock-token')

            const { findOssFileByIdDao } = await import('~~/server/services/files/ossFiles.dao')
            vi.mocked(findOssFileByIdDao).mockResolvedValue(null)

            const { submitPdfConversionService } = await import('~~/server/services/material/mineru.service')
            const result = await submitPdfConversionService(999, 1)

            expect(result.success).toBe(false)
            expect(result.error).toBe('文件不存在')
        })

        it('积分不足时应返回错误', async () => {
            const { findDocRecognitionByOssFileIdDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { hasActiveTokenService, getActiveTokenValueService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(hasActiveTokenService).mockResolvedValue(true)
            vi.mocked(getActiveTokenValueService).mockResolvedValue('mock-token')

            const { findOssFileByIdDao } = await import('~~/server/services/files/ossFiles.dao')
            vi.mocked(findOssFileByIdDao).mockResolvedValue({
                id: 10,
                filePath: 'docs/test.pdf',
                fileType: 'application/pdf',
            } as any)

            const { checkPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(checkPointsService).mockResolvedValue({
                sufficient: false,
                required: 10,
                available: 0,
            })

            const { submitPdfConversionService } = await import('~~/server/services/material/mineru.service')
            const result = await submitPdfConversionService(10, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('积分不足')
        })

        it('成功提交任务时应返回任务记录', async () => {
            const { findDocRecognitionByOssFileIdDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { hasActiveTokenService, getActiveTokenValueService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(hasActiveTokenService).mockResolvedValue(true)
            vi.mocked(getActiveTokenValueService).mockResolvedValue('mock-token')

            const { findOssFileByIdDao } = await import('~~/server/services/files/ossFiles.dao')
            vi.mocked(findOssFileByIdDao).mockResolvedValue({
                id: 10,
                filePath: 'docs/test.pdf',
            } as any)

            const { checkPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(checkPointsService).mockResolvedValue({
                sufficient: true,
                required: 1,
                available: 100,
            })

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue({
                code: 0,
                msg: 'success',
                data: { task_id: 'mineru-task-001' },
            })

            const { createMineruTaskService } = await import('~~/server/services/material/mineruTask.service')
            const mockTask = { id: 1, taskId: 'mineru-task-001', status: 1 }
            vi.mocked(createMineruTaskService).mockResolvedValue(mockTask as any)

            const { submitPdfConversionService } = await import('~~/server/services/material/mineru.service')
            const result = await submitPdfConversionService(10, 1)

            expect(result.success).toBe(true)
            expect(result.task).toEqual(mockTask)
        })

        it('MinerU API 返回错误码时应返回失败', async () => {
            const { findDocRecognitionByOssFileIdDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { hasActiveTokenService, getActiveTokenValueService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(hasActiveTokenService).mockResolvedValue(true)
            vi.mocked(getActiveTokenValueService).mockResolvedValue('mock-token')

            const { findOssFileByIdDao } = await import('~~/server/services/files/ossFiles.dao')
            vi.mocked(findOssFileByIdDao).mockResolvedValue({
                id: 10,
                filePath: 'docs/test.pdf',
            } as any)

            const { checkPointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(checkPointsService).mockResolvedValue({ sufficient: true, required: 1, available: 100 })

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue({
                code: 500,
                msg: '服务器内部错误',
            })

            const { submitPdfConversionService } = await import('~~/server/services/material/mineru.service')
            const result = await submitPdfConversionService(10, 1)

            expect(result.success).toBe(false)
            expect(result.error).toContain('服务器内部错误')
        })
    })

    // ==================== completeConversionService ====================
    describe('completeConversionService', () => {
        it('任务不存在时应抛出错误', async () => {
            const { getMineruTaskByTaskIdService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(getMineruTaskByTaskIdService).mockResolvedValue(null)

            const { completeConversionService } = await import('~~/server/services/material/mineru.service')

            await expect(completeConversionService('nonexistent', 'md', 'html', 1)).rejects.toThrow('任务不存在')
        })

        it('成功完成时应更新任务、创建记录并扣减积分', async () => {
            const { getMineruTaskByTaskIdService, updateMineruTaskService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(getMineruTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-complete',
                ossFileId: 10,
                userId: 1,
            } as any)

            const { findDocRecognitionByOssFileIdDao, createDocRecognitionRecordDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(null)
            vi.mocked(createDocRecognitionRecordDao).mockResolvedValue({ id: 20 } as any)

            const { findOssFileByIdIncludeDeletedDao } = await import('~~/server/services/files/ossFiles.dao')
            vi.mocked(findOssFileByIdIncludeDeletedDao).mockResolvedValue({ id: 10, fileName: 'test.pdf' } as any)

            const { consumePointsService } = await import('~~/server/services/point/pointConsumption.service')

            const { completeConversionService } = await import('~~/server/services/material/mineru.service')
            await completeConversionService('task-complete', '# Markdown', '<h1>Markdown</h1>', 5)

            expect(updateMineruTaskService).toHaveBeenCalledWith(1, expect.objectContaining({
                status: 2, // MineruTaskStatus.SUCCESS
            }))
            expect(createDocRecognitionRecordDao).toHaveBeenCalledWith(expect.objectContaining({
                status: 2, // DocRecognitionStatus.SUCCESS
                markdownContent: '# Markdown',
                htmlContent: '<h1>Markdown</h1>',
            }))
            expect(consumePointsService).toHaveBeenCalledWith(1, 'doc_parse', 5, expect.any(Object))
        })

        it('已存在识别记录时应更新而非创建', async () => {
            const { getMineruTaskByTaskIdService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(getMineruTaskByTaskIdService).mockResolvedValue({
                id: 1, taskId: 'task-update', ossFileId: 10, userId: 1,
            } as any)

            const { findDocRecognitionByOssFileIdDao, updateDocRecognitionRecordDao, createDocRecognitionRecordDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue({ id: 20, ossFileId: 10 } as any)
            vi.mocked(updateDocRecognitionRecordDao).mockResolvedValue({ id: 20 } as any)

            const { findOssFileByIdIncludeDeletedDao } = await import('~~/server/services/files/ossFiles.dao')
            vi.mocked(findOssFileByIdIncludeDeletedDao).mockResolvedValue({ id: 10, fileName: 'test.pdf' } as any)

            const { completeConversionService } = await import('~~/server/services/material/mineru.service')
            await completeConversionService('task-update', '# MD', '<h1>MD</h1>', 1)

            expect(updateDocRecognitionRecordDao).toHaveBeenCalled()
            expect(createDocRecognitionRecordDao).not.toHaveBeenCalled()
        })

        it('积分扣减失败不应影响转换结果保存', async () => {
            const { getMineruTaskByTaskIdService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(getMineruTaskByTaskIdService).mockResolvedValue({
                id: 1, taskId: 'task-point-fail', ossFileId: 10, userId: 1,
            } as any)

            const { findDocRecognitionByOssFileIdDao, createDocRecognitionRecordDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(null)
            vi.mocked(createDocRecognitionRecordDao).mockResolvedValue({ id: 30 } as any)

            const { findOssFileByIdIncludeDeletedDao } = await import('~~/server/services/files/ossFiles.dao')
            vi.mocked(findOssFileByIdIncludeDeletedDao).mockResolvedValue({ id: 10, fileName: 'test.pdf' } as any)

            const { consumePointsService } = await import('~~/server/services/point/pointConsumption.service')
            vi.mocked(consumePointsService).mockRejectedValue(new Error('积分服务不可用'))

            const { completeConversionService } = await import('~~/server/services/material/mineru.service')
            // 不应抛出错误
            await completeConversionService('task-point-fail', '# MD', '<h1>MD</h1>', 1)

            expect(createDocRecognitionRecordDao).toHaveBeenCalled()
        })
    })

    // ==================== failConversionService ====================
    describe('failConversionService', () => {
        it('任务不存在时应静默返回', async () => {
            const { getMineruTaskByTaskIdService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(getMineruTaskByTaskIdService).mockResolvedValue(null)

            const { failConversionService } = await import('~~/server/services/material/mineru.service')
            // 不应抛出错误
            await failConversionService('nonexistent', '测试失败')
        })

        it('应更新任务状态为 FAILED 并记录错误信息', async () => {
            const { getMineruTaskByTaskIdService, updateMineruTaskService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(getMineruTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-fail',
            } as any)

            const { failConversionService } = await import('~~/server/services/material/mineru.service')
            await failConversionService('task-fail', '转换失败')

            expect(updateMineruTaskService).toHaveBeenCalledWith(1, expect.objectContaining({
                status: 3, // MineruTaskStatus.FAILED
                errorMsg: '转换失败',
            }))
        })

        it('不应扣减积分', async () => {
            const { getMineruTaskByTaskIdService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(getMineruTaskByTaskIdService).mockResolvedValue({
                id: 1,
                taskId: 'task-no-points',
            } as any)

            const { consumePointsService } = await import('~~/server/services/point/pointConsumption.service')

            const { failConversionService } = await import('~~/server/services/material/mineru.service')
            await failConversionService('task-no-points', '失败')

            expect(consumePointsService).not.toHaveBeenCalled()
        })
    })

    // ==================== pollTaskStatusService ====================
    describe('pollTaskStatusService', () => {
        it('任务已处理时应直接返回 true', async () => {
            const { isMineruTaskProcessedService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(isMineruTaskProcessedService).mockResolvedValue(true)

            const { pollTaskStatusService } = await import('~~/server/services/material/mineru.service')
            const result = await pollTaskStatusService('already-done')

            expect(result).toBe(true)
        })

        it('没有可用 Token 时应返回 false', async () => {
            const { isMineruTaskProcessedService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(isMineruTaskProcessedService).mockResolvedValue(false)

            const { getActiveTokenValueService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(getActiveTokenValueService).mockResolvedValue(null as any)

            const { pollTaskStatusService } = await import('~~/server/services/material/mineru.service')
            const result = await pollTaskStatusService('task-no-token')

            expect(result).toBe(false)
        })

        it('任务状态为 failed 时应标记失败并返回 true', async () => {
            const { isMineruTaskProcessedService, getMineruTaskByTaskIdService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(isMineruTaskProcessedService).mockResolvedValue(false)
            vi.mocked(getMineruTaskByTaskIdService).mockResolvedValue({ id: 1, taskId: 'task-fail' } as any)

            const { getActiveTokenValueService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(getActiveTokenValueService).mockResolvedValue('mock-token')

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue({
                code: 0,
                msg: 'success',
                data: {
                    task_id: 'task-poll-fail',
                    state: 'failed',
                    err_msg: '解析失败',
                },
            })

            const { pollTaskStatusService } = await import('~~/server/services/material/mineru.service')
            const result = await pollTaskStatusService('task-poll-fail')

            expect(result).toBe(true)
        })

        it('任务仍在处理中时应返回 false', async () => {
            const { isMineruTaskProcessedService } = await import('~~/server/services/material/mineruTask.service')
            vi.mocked(isMineruTaskProcessedService).mockResolvedValue(false)

            const { getActiveTokenValueService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(getActiveTokenValueService).mockResolvedValue('mock-token')

            const { $fetch } = await import('ofetch')
            vi.mocked($fetch).mockResolvedValue({
                code: 0,
                msg: 'success',
                data: {
                    task_id: 'task-running',
                    state: 'running',
                    progress: 50,
                },
            })

            const { pollTaskStatusService } = await import('~~/server/services/material/mineru.service')
            const result = await pollTaskStatusService('task-running')

            expect(result).toBe(false)
        })
    })

    // ==================== convertPdfService ====================
    describe('convertPdfService', () => {
        it('提交失败时应直接返回失败结果', async () => {
            const { findDocRecognitionByOssFileIdDao } = await import('~~/server/services/material/mineru.dao')
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(null)

            const { hasActiveTokenService } = await import('~~/server/services/material/mineruToken.service')
            vi.mocked(hasActiveTokenService).mockResolvedValue(false)

            const { convertPdfService } = await import('~~/server/services/material/mineru.service')
            const result = await convertPdfService(10, 1)

            expect(result.success).toBe(false)
        })
    })

    // ==================== 查询函数 ====================
    describe('查询函数', () => {
        it('getDocRecognitionByOssFileIdService 应委托给 DAO', async () => {
            const { findDocRecognitionByOssFileIdDao } = await import('~~/server/services/material/mineru.dao')
            const mockRecord = { id: 1, ossFileId: 10 } as any
            vi.mocked(findDocRecognitionByOssFileIdDao).mockResolvedValue(mockRecord)

            const { getDocRecognitionByOssFileIdService } = await import('~~/server/services/material/mineru.service')
            const result = await getDocRecognitionByOssFileIdService(10)

            expect(result).toEqual(mockRecord)
        })

        it('getDocRecognitionsByOssFileIdsService 应委托给 DAO', async () => {
            const { findDocRecognitionsByOssFileIdsDao } = await import('~~/server/services/material/mineru.dao')
            const mockRecords = [{ id: 1 }, { id: 2 }] as any[]
            vi.mocked(findDocRecognitionsByOssFileIdsDao).mockResolvedValue(mockRecords)

            const { getDocRecognitionsByOssFileIdsService } = await import('~~/server/services/material/mineru.service')
            const result = await getDocRecognitionsByOssFileIdsService([10, 20])

            expect(result).toEqual(mockRecords)
        })
    })
})
