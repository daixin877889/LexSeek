/**
 * importDocumentTemplates 脚本测试
 *
 * TDD 测试覆盖：
 * - --dry-run 不写库，只打印预览
 * - 正常导入：写入 documentTemplates + ossFiles
 * - 幂等：重复 import 不重复（name+scope='global' 查重）
 * - CSV 格式错误（缺列 / 非法 category）抛错
 * - 扫描失败（无占位符 / 非 .docx）中止并打印错误行
 *
 * **Feature: document-generation**
 * **Validates: Task 7.1**
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile, unlink } from 'node:fs/promises'
import '../server/case/test-setup'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// tests/scripts/ -> tests/ -> LexSeek/
const ROOT_DIR = path.resolve(__dirname, '../..')
const FIXTURES_DIR = path.resolve(ROOT_DIR, 'tests/fixtures')

// ==================== Mock 外部依赖（必须在导入被测模块之前） ====================

vi.mock('~~/server/services/storage/storage.service', () => ({
    uploadFileService: vi.fn(),
}))

vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    createOssFileDao: vi.fn(),
}))

vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn(),
}))

vi.mock('~~/server/agents/document/documentTemplate.dao', () => ({
    createDocumentTemplateDAO: vi.fn(),
}))

// ==================== 导入被测模块（在 mock 之后） ====================

import {
    parseCsvRow,
    validateRow,
    importTemplatesFromCsv,
    type CsvRow,
    type ImportResult,
} from '~~/scripts/importDocumentTemplates'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { createDocumentTemplateDAO } from '~~/server/agents/document/documentTemplate.dao'

// ==================== 类型转换 ====================

const mockUploadFileService = uploadFileService as ReturnType<typeof vi.fn>
const mockCreateOssFileDao = createOssFileDao as ReturnType<typeof vi.fn>
const mockCreateDocumentTemplateDAO = createDocumentTemplateDAO as ReturnType<typeof vi.fn>

// ==================== 默认 Mock 数据 ====================

const MOCK_UPLOAD_RESULT = {
    name: 'document-templates/1234567890_test.docx',
    url: 'https://oss.example.com/document-templates/1234567890_test.docx',
}

const MOCK_OSS_FILE = {
    id: 42,
    userId: 1,
    fileName: 'test.docx',
    filePath: 'document-templates/1234567890_test.docx',
    fileSize: 1024,
    status: 1,
}

const MOCK_TEMPLATE = {
    id: 100,
    name: '起诉状模板',
    scope: 'global',
    category: 'litigation',
}

// ==================== beforeEach 设置默认 mock 返回值 ====================

beforeEach(() => {
    vi.clearAllMocks()

    mockUploadFileService.mockResolvedValue(MOCK_UPLOAD_RESULT)
    mockCreateOssFileDao.mockResolvedValue(MOCK_OSS_FILE)
    mockCreateDocumentTemplateDAO.mockResolvedValue(MOCK_TEMPLATE)
})

afterEach(() => {
    vi.restoreAllMocks()
})

// ==================== 测试：CSV 解析 ====================

describe('parseCsvRow', () => {
    it('正确解析有效行', () => {
        const header = ['file_path', 'name', 'category', 'description', 'priority']
        const values = ['path/to/file.docx', '起诉状模板', 'litigation', '民事起诉状', '100']
        const result = parseCsvRow(header, values)
        expect(result).toEqual({
            file_path: 'path/to/file.docx',
            name: '起诉状模板',
            category: 'litigation',
            description: '民事起诉状',
            priority: '100',
        })
    })

    it('列数少于 header 时，缺失字段为空字符串', () => {
        const header = ['file_path', 'name', 'category', 'description', 'priority']
        const values = ['path/to/file.docx', '测试模板', 'general']
        const result = parseCsvRow(header, values)
        expect(result.description).toBe('')
        expect(result.priority).toBe('')
    })
})

// ==================== 测试：行校验 ====================

describe('validateRow', () => {
    it('有效行通过校验', () => {
        const row: CsvRow = {
            file_path: 'some/file.docx',
            name: '起诉状模板',
            category: 'litigation',
            description: '',
            priority: '100',
        }
        expect(() => validateRow(row)).not.toThrow()
    })

    it('缺失 file_path 时抛错', () => {
        const row: CsvRow = {
            file_path: '',
            name: '起诉状模板',
            category: 'litigation',
            description: '',
            priority: '',
        }
        expect(() => validateRow(row)).toThrow(/file_path/)
    })

    it('缺失 name 时抛错', () => {
        const row: CsvRow = {
            file_path: 'some/file.docx',
            name: '',
            category: 'litigation',
            description: '',
            priority: '',
        }
        expect(() => validateRow(row)).toThrow(/name/)
    })

    it('非法 category 时抛错', () => {
        const row: CsvRow = {
            file_path: 'some/file.docx',
            name: '测试',
            category: 'invalid_category_xyz',
            description: '',
            priority: '',
        }
        expect(() => validateRow(row)).toThrow(/category/)
    })

    it('非 .docx 扩展名时抛错', () => {
        const row: CsvRow = {
            file_path: 'some/file.pdf',
            name: '测试',
            category: 'general',
            description: '',
            priority: '',
        }
        expect(() => validateRow(row)).toThrow(/\.docx/)
    })
})

// ==================== 测试：dry-run 模式 ====================

describe('importTemplatesFromCsv - dry-run', () => {
    it('dry-run 时不调用任何写库操作', async () => {
        // 使用 fixture CSV（3 行正常 + 1 行 empty.docx）
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        const result = await importTemplatesFromCsv(csvPath, { dryRun: true, baseDir: ROOT_DIR })

        expect(mockUploadFileService).not.toHaveBeenCalled()
        expect(mockCreateOssFileDao).not.toHaveBeenCalled()
        expect(mockCreateDocumentTemplateDAO).not.toHaveBeenCalled()

        consoleSpy.mockRestore()
    })

    it('dry-run 时打印预览信息', async () => {
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const logs: string[] = []
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
            logs.push(args.join(' '))
        })

        await importTemplatesFromCsv(csvPath, { dryRun: true, baseDir: ROOT_DIR })

        // 应打印包含 [dry-run] 字样的预览信息
        const dryRunLogs = logs.filter(l => l.includes('[dry-run]') || l.includes('dry-run'))
        expect(dryRunLogs.length).toBeGreaterThan(0)

        consoleSpy.mockRestore()
    })

    it('dry-run 返回预览结果，包含 skipped 行（扫描失败）', async () => {
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await importTemplatesFromCsv(csvPath, { dryRun: true, baseDir: ROOT_DIR })

        // 3 个正常文件 + 1 个 empty.docx（无占位符，应失败）
        expect(result.total).toBe(4)
        expect(result.skipped).toBeGreaterThanOrEqual(1)

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })
})

// ==================== 测试：正常导入 ====================

describe('importTemplatesFromCsv - 正常导入', () => {
    it('正常导入：为每个有效模板调用 uploadFileService', async () => {
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await importTemplatesFromCsv(csvPath, { dryRun: false, baseDir: ROOT_DIR })

        // 3 个有效文件应调用 3 次上传
        expect(mockUploadFileService).toHaveBeenCalledTimes(result.imported)
        expect(result.imported).toBe(3)

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })

    it('正常导入：为每个有效模板调用 createOssFileDao', async () => {
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await importTemplatesFromCsv(csvPath, { dryRun: false, baseDir: ROOT_DIR })

        expect(mockCreateOssFileDao).toHaveBeenCalledTimes(result.imported)

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })

    it('正常导入：为每个有效模板调用 createDocumentTemplateDAO，scope=global', async () => {
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        await importTemplatesFromCsv(csvPath, { dryRun: false, baseDir: ROOT_DIR })

        expect(mockCreateDocumentTemplateDAO).toHaveBeenCalledTimes(3)
        const calls = mockCreateDocumentTemplateDAO.mock.calls
        calls.forEach(([input]: [any]) => {
            expect(input.scope).toBe('global')
        })

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })

    it('正常导入：priority 使用 CSV 中的值', async () => {
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        await importTemplatesFromCsv(csvPath, { dryRun: false, baseDir: ROOT_DIR })

        const calls = mockCreateDocumentTemplateDAO.mock.calls
        // 第一行 priority=100
        expect(calls[0][0].priority).toBe(100)
        // 第二行 priority=90
        expect(calls[1][0].priority).toBe(90)

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })
})

// ==================== 测试：幂等（已存在跳过） ====================

describe('importTemplatesFromCsv - 幂等', () => {
    it('已存在的模板（name+scope=global）不重复导入', async () => {
        // 模拟第一个模板已存在：createDocumentTemplateDAO 抛出唯一约束错误
        mockCreateDocumentTemplateDAO
            .mockRejectedValueOnce({ code: 'P2002', message: '唯一约束冲突' })
            .mockResolvedValue(MOCK_TEMPLATE)

        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await importTemplatesFromCsv(csvPath, { dryRun: false, baseDir: ROOT_DIR })

        // 1 个跳过 + 2 个成功 + 1 个扫描失败
        expect(result.skipped).toBeGreaterThanOrEqual(1)

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })
})

// ==================== 测试：CSV 格式错误 ====================

describe('importTemplatesFromCsv - CSV 格式错误', () => {
    it('缺少必需列时整体抛错', async () => {
        // 写一个缺少 category 列的 CSV 到临时位置
        const csvContent = `file_path,name,description,priority\nsome/file.docx,测试模板,描述,100\n`
        const tmpPath = path.join(FIXTURES_DIR, 'bad-header.csv')
        await writeFile(tmpPath, csvContent)

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

        await expect(
            importTemplatesFromCsv(tmpPath, { dryRun: false, baseDir: ROOT_DIR })
        ).rejects.toThrow(/category|header|列/)

        // 清理临时文件
        await unlink(tmpPath).catch(() => {})

        consoleSpy.mockRestore()
    })

    it('数据行中非法 category 导致该行跳过并打印错误', async () => {
        const csvContent = `file_path,name,category,description,priority\ntests/fixtures/document-templates/chinese.docx,测试,invalid_cat,,100\n`
        const tmpPath = path.join(FIXTURES_DIR, 'bad-category.csv')
        await writeFile(tmpPath, csvContent)

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const errors: string[] = []
        consoleErrSpy.mockImplementation((...args) => {
            errors.push(args.join(' '))
        })

        const result = await importTemplatesFromCsv(tmpPath, { dryRun: false, baseDir: ROOT_DIR })

        expect(result.imported).toBe(0)
        expect(result.skipped).toBe(1)
        expect(errors.some(e => e.includes('invalid_cat') || e.includes('category'))).toBe(true)

        await unlink(tmpPath).catch(() => {})

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })
})

// ==================== 测试：扫描失败（无占位符） ====================

describe('importTemplatesFromCsv - 扫描失败', () => {
    it('无占位符的 .docx 文件：该行跳过并打印错误，其余行继续', async () => {
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const errors: string[] = []
        consoleErrSpy.mockImplementation((...args) => {
            errors.push(args.join(' '))
        })

        const result = await importTemplatesFromCsv(csvPath, { dryRun: false, baseDir: ROOT_DIR })

        // empty.docx（无占位符）应被跳过
        expect(result.skipped).toBeGreaterThanOrEqual(1)
        // 有错误信息打印
        expect(errors.length).toBeGreaterThan(0)
        // 其余有效行应成功导入
        expect(result.imported).toBe(3)

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })

    it('不存在的文件路径：该行跳过并打印错误', async () => {
        const csvContent = `file_path,name,category,description,priority\nnonexistent/path.docx,测试,general,,100\n`
        const tmpPath = path.join(FIXTURES_DIR, 'missing-file.csv')
        await writeFile(tmpPath, csvContent)

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await importTemplatesFromCsv(tmpPath, { dryRun: false, baseDir: ROOT_DIR })

        expect(result.skipped).toBe(1)
        expect(result.imported).toBe(0)

        await unlink(tmpPath).catch(() => {})

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })
})

// ==================== 测试：汇总报告 ====================

describe('importTemplatesFromCsv - 汇总报告', () => {
    it('返回包含 total/imported/skipped 的汇总', async () => {
        const csvPath = path.join(FIXTURES_DIR, 'import-templates.csv')
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await importTemplatesFromCsv(csvPath, { dryRun: false, baseDir: ROOT_DIR })

        expect(result).toHaveProperty('total')
        expect(result).toHaveProperty('imported')
        expect(result).toHaveProperty('skipped')
        expect(result.total).toBe(result.imported + result.skipped)

        consoleSpy.mockRestore()
        consoleErrSpy.mockRestore()
    })
})
