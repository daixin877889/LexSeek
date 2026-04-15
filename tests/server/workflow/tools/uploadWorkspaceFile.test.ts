/**
 * upload_workspace_file 工具测试
 *
 * 测试从 workspace 目录上传文件到用户云盘（OSS）的功能和安全边界
 *
 * **Feature: upload-workspace-file-tool**
 * **Validates: 文件校验、安全边界、工具定义、file-card 格式输出**
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

// 模拟 uploadFileService（避免真实 OSS 调用）
vi.mock('../../../../server/services/storage/storage.service', () => ({
    uploadFileService: vi.fn().mockResolvedValue({
        name: 'users/1/workspace/test.txt',
        etag: 'abc123',
        url: 'https://example.oss.com/users/1/workspace/test.txt',
    }),
}))

// 模拟 checkStorageQuotaService（避免真实数据库调用）
vi.mock('../../../../server/services/membership/userBenefit.service', () => ({
    checkStorageQuotaService: vi.fn().mockResolvedValue({
        allowed: true,
        quota: {
            totalBytes: 10 * 1024 * 1024 * 1024,
            usedBytes: 1024,
            remainingBytes: 10 * 1024 * 1024 * 1024 - 1024,
            formatted: { total: '10GB', used: '1KB', remaining: '10GB', percentage: 0 },
        },
        requiredSize: 100,
        requiredFormatted: '100B',
    }),
    getUserStorageQuotaService: vi.fn(),
}))

// 模拟 createOssFileDao（避免真实数据库调用）
vi.mock('../../../../server/services/files/ossFiles.dao', () => ({
    createOssFileDao: vi.fn().mockResolvedValue({
        id: 999,
        userId: 1,
        bucketName: 'test-bucket',
        fileName: 'test.txt',
        filePath: 'users/1/workspace/test.txt',
        fileSize: 100,
        fileType: 'text/plain',
        source: 'caseAnalysis',
        status: 1,
        encrypted: false,
        originalMimeType: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
    }),
}))

// 模拟 logger（避免服务端自动导入）
vi.mock('../../../../server/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}))

import { createTool, toolDefinition } from '../../../../server/services/workflow/tools/uploadWorkspaceFile.tool'

/** 临时 workspace 根目录（替代 WORKSPACE_BASE，隔离测试） */
const testWorkspaceBase = resolve(tmpdir(), 'lexseek-test-upload-workspace-' + Date.now())

/** 测试 sessionId */
const testSessionId = 'test-upload-session-abc123'

/** workspace 目录（sessionId 子目录） */
const testWorkspaceDir = resolve(testWorkspaceBase, testSessionId)

/** 测试上下文 */
const testContext = {
    userId: 1,
    caseId: 1,
    sessionId: testSessionId,
}

/** 正常大小的测试文件（1KB） */
const SMALL_FILE_NAME = 'test.txt'
const SMALL_FILE_CONTENT = 'Hello, 测试文件内容'

beforeAll(async () => {
    // 提前创建 workspace 目录和测试文件
    await mkdir(testWorkspaceDir, { recursive: true })
    await writeFile(resolve(testWorkspaceDir, SMALL_FILE_NAME), SMALL_FILE_CONTENT, 'utf-8')
})

afterAll(async () => {
    // 清理全部临时目录
    await rm(testWorkspaceBase, { recursive: true, force: true })
})

describe('upload_workspace_file 工具 - 工具定义', () => {
    it('工具名应为 upload_workspace_file', () => {
        expect(toolDefinition.name).toBe('upload_workspace_file')
    })

    it('toolDefinition.description 应不为空', () => {
        expect(toolDefinition.description.length).toBeGreaterThan(0)
    })

    it('工具实例 name 应为 upload_workspace_file', () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        expect(uploadTool.name).toBe('upload_workspace_file')
    })

    it('schema 应包含 fileName 字段', () => {
        expect(toolDefinition.schema.shape).toHaveProperty('fileName')
    })
})

describe('upload_workspace_file 工具 - sessionId 校验', () => {
    it('应拒绝包含非法字符的 sessionId（含斜杠）', () => {
        expect(() => {
            createTool({ ...testContext, sessionId: 'abc/def' }, testWorkspaceBase)
        }).toThrow(/无效的 sessionId/)
    })

    it('应拒绝空 sessionId', () => {
        expect(() => {
            createTool({ ...testContext, sessionId: '' }, testWorkspaceBase)
        }).toThrow(/无效的 sessionId/)
    })

    it('应接受合法的 sessionId（字母数字下划线连字符）', () => {
        expect(() => {
            createTool({ ...testContext, sessionId: 'valid-session_123' }, testWorkspaceBase)
        }).not.toThrow()
    })
})

describe('upload_workspace_file 工具 - 文件名安全校验', () => {
    it('应拒绝包含路径遍历的文件名（..）', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: '../etc/passwd' })
        expect(result).toContain('Error')
    })

    it('应拒绝包含斜杠的文件名', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: 'dir/evil.txt' })
        expect(result).toContain('Error')
    })

    it('应拒绝包含 NULL 字节的文件名', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: 'file\x00.txt' })
        expect(result).toContain('Error')
    })

    it('应拒绝反斜杠文件名', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: 'bad\\file.txt' })
        expect(result).toContain('Error')
    })
})

describe('upload_workspace_file 工具 - 文件存在性和大小校验', () => {
    it('应拒绝不存在的文件', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: 'nonexistent.txt' })
        expect(result).toContain('Error')
    })

    it('应拒绝超过 50MB 的文件', async () => {
        // 创建一个大文件的路径（使用 mock stat 避免真实创建 50MB 文件）
        const bigFileName = 'big-file.bin'
        // 创建 1 字节占位文件，通过模块内部 stat mock 测试大小检查
        await writeFile(resolve(testWorkspaceDir, bigFileName), Buffer.alloc(1))

        // 用真实 stat 替换方式：直接手写一个超大文件（会实际创建，但这里只测逻辑）
        // 改为：在实现中注入 statFn 使测试可 mock
        // 由于测试文件不超过 50MB，此用例通过 stat 注入来测试
        // 如果工具支持传入自定义 stat 函数（见工具实现），则使用 mock
        const uploadTool = createTool(
            testContext,
            testWorkspaceBase,
            // 传入 mock stat 函数，模拟 51MB 文件
            async (_path: string) => ({ size: 51 * 1024 * 1024 })
        )
        const result = await uploadTool.invoke({ fileName: bigFileName })
        expect(result).toContain('Error')
        expect(result).toContain('50MB')
    })
})

describe('upload_workspace_file 工具 - 正常上传流程', () => {
    it('应返回 [file-card] 格式', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: SMALL_FILE_NAME })
        expect(result).toContain('[file-card]')
        expect(result).toContain('[/file-card]')
    })

    it('file-card 应包含 fileId 字段', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: SMALL_FILE_NAME })
        expect(result).toMatch(/fileId:\s*\d+/)
    })

    it('file-card 应包含 fileName 字段', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: SMALL_FILE_NAME })
        expect(result).toContain(`fileName: ${SMALL_FILE_NAME}`)
    })

    it('file-card 应包含 fileSize 字段', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: SMALL_FILE_NAME })
        expect(result).toMatch(/fileSize:\s*\d+/)
    })

    it('file-card 应包含 mimeType 字段', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: SMALL_FILE_NAME })
        expect(result).toMatch(/mimeType:\s*.+/)
    })
})

describe('upload_workspace_file 工具 - 配额不足兜底流程', () => {
    it('配额不足时应返回临时 file-card（含 temporary: true）', async () => {
        const { checkStorageQuotaService } = await import('../../../../server/services/membership/userBenefit.service')
        vi.mocked(checkStorageQuotaService).mockResolvedValueOnce({
            allowed: false,
            quota: {
                totalBytes: 100,
                usedBytes: 99,
                remainingBytes: 1,
                formatted: { total: '100B', used: '99B', remaining: '1B', percentage: 99 },
            },
            requiredSize: 100,
            requiredFormatted: '100B',
            message: '云盘空间不足',
        })

        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ fileName: SMALL_FILE_NAME })

        // 临时上传也应返回 file-card，但含 temporary 标识
        expect(result).toContain('[file-card]')
        expect(result).toContain('temporary: true')
        expect(result).toContain('expiresAt:')
    })
})
