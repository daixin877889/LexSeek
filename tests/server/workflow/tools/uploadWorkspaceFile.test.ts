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

// 模拟存储服务（避免真实 OSS 调用）
vi.mock('../../../../server/services/storage/storage.service', () => ({
    uploadFileService: vi.fn().mockResolvedValue({
        name: 'users/1/workspace/test.txt',
        etag: 'abc123',
        url: 'https://example.oss.com/users/1/workspace/test.txt',
    }),
}))

vi.mock('../../../../server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: vi.fn().mockResolvedValue({
        id: 1,
        type: 'aliyun_oss',
        name: 'default',
        bucket: 'test-bucket',
        region: 'oss-cn-hangzhou',
        enabled: true,
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

/** 子目录测试文件 */
const SUBDIR_FILE_PATH = 'output/litigation-visualization.md'
const SUBDIR_FILE_CONTENT = '# 诉讼可视化\n\n```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```'

beforeAll(async () => {
    // 提前创建 workspace 目录、测试文件和子目录文件
    await mkdir(testWorkspaceDir, { recursive: true })
    await writeFile(resolve(testWorkspaceDir, SMALL_FILE_NAME), SMALL_FILE_CONTENT, 'utf-8')
    await mkdir(resolve(testWorkspaceDir, 'output'), { recursive: true })
    await writeFile(resolve(testWorkspaceDir, SUBDIR_FILE_PATH), SUBDIR_FILE_CONTENT, 'utf-8')
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

    it('schema 应包含 filePath 字段', () => {
        expect(toolDefinition.schema.shape).toHaveProperty('filePath')
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

describe('upload_workspace_file 工具 - 路径安全校验', () => {
    it('应拒绝包含路径遍历的路径（..）', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: '../etc/passwd' })
        expect(result).toContain('Error')
    })

    it('应拒绝绝对路径', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: '/etc/passwd' })
        expect(result).toContain('Error')
    })

    it('应拒绝包含 NULL 字节的路径', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: 'file\x00.txt' })
        expect(result).toContain('Error')
    })

    it('应拒绝反斜杠路径', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: 'bad\\file.txt' })
        expect(result).toContain('Error')
    })
})

describe('upload_workspace_file 工具 - 文件存在性和大小校验', () => {
    it('应拒绝不存在的文件', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: 'nonexistent.txt' })
        expect(result).toContain('Error')
    })

    it('应拒绝超过 180MB 的文件', async () => {
        const bigFileName = 'big-file.bin'
        await writeFile(resolve(testWorkspaceDir, bigFileName), Buffer.alloc(1))

        // 注入 mock stat 函数模拟 181MB 文件，避免真实创建大文件
        const uploadTool = createTool(
            testContext,
            testWorkspaceBase,
            async (_path: string) => ({ size: 181 * 1024 * 1024 })
        )
        const result = await uploadTool.invoke({ filePath: bigFileName })
        expect(result).toContain('Error')
        expect(result).toContain('180MB')
    })
})

describe('upload_workspace_file 工具 - 正常上传流程', () => {
    it('应返回 [file-card] 格式', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: SMALL_FILE_NAME })
        expect(result).toContain('[file-card]')
        expect(result).toContain('[/file-card]')
    })

    it('file-card 应包含 fileId 字段', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: SMALL_FILE_NAME })
        expect(result).toMatch(/fileId:\s*\d+/)
    })

    it('file-card 应包含 fileName 字段', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: SMALL_FILE_NAME })
        expect(result).toContain(`fileName: ${SMALL_FILE_NAME}`)
    })

    it('file-card 应包含 fileSize 字段', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: SMALL_FILE_NAME })
        expect(result).toMatch(/fileSize:\s*\d+/)
    })

    it('file-card 应包含 mimeType 字段', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: SMALL_FILE_NAME })
        expect(result).toMatch(/mimeType:\s*.+/)
    })

    it('应支持子目录路径上传（如 output/litigation-visualization.md）', async () => {
        const uploadTool = createTool(testContext, testWorkspaceBase)
        const result = await uploadTool.invoke({ filePath: SUBDIR_FILE_PATH })
        expect(result).toContain('[file-card]')
        expect(result).toContain('fileName: litigation-visualization.md')
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
        const result = await uploadTool.invoke({ filePath: SMALL_FILE_NAME })

        // 临时上传也应返回 file-card，但含 temporary 标识
        expect(result).toContain('[file-card]')
        expect(result).toContain('temporary: true')
        expect(result).toContain('expiresAt:')
    })
})
