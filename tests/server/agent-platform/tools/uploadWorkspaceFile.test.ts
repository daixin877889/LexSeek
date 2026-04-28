/**
 * uploadWorkspaceFile 工具单测
 *
 * 验证：
 * - 路径校验：NULL 字节 / 绝对路径 / 路径遍历 / 反斜杠 / 段非法字符
 * - 文件不存在 / 超大 / 配额检查异常降级
 * - 上传到用户存储 / 上传到临时存储
 * - 上传失败时返回错误字符串
 * - inferMimeType（通过文件名扩展）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
    uploadFileServiceMock,
    checkStorageQuotaServiceMock,
    createOssFileDaoMock,
    getDefaultStorageConfigDaoMock,
    createReadStreamMock,
    warnSpy, errorSpy, infoSpy,
} = vi.hoisted(() => ({
    uploadFileServiceMock: vi.fn(),
    checkStorageQuotaServiceMock: vi.fn(),
    createOssFileDaoMock: vi.fn(),
    getDefaultStorageConfigDaoMock: vi.fn(),
    createReadStreamMock: vi.fn(() => ({ _stream: 'fake' })),
    warnSpy: vi.fn(),
    errorSpy: vi.fn(),
    infoSpy: vi.fn(),
}))

vi.mock('~~/server/services/storage/storage.service', () => ({
    uploadFileService: uploadFileServiceMock,
}))
vi.mock('~~/server/services/storage/storageConfig.dao', () => ({
    getDefaultStorageConfigDao: getDefaultStorageConfigDaoMock,
}))
vi.mock('~~/server/services/membership/userBenefit.service', () => ({
    checkStorageQuotaService: checkStorageQuotaServiceMock,
}))
vi.mock('~~/server/services/files/ossFiles.dao', () => ({
    createOssFileDao: createOssFileDaoMock,
}))
vi.mock('node:fs', async () => {
    const actual = await vi.importActual<any>('node:fs')
    const overlay = { ...actual, createReadStream: createReadStreamMock }
    return { ...overlay, default: overlay }
})
vi.mock('#shared/utils/logger', () => ({
    logger: { info: infoSpy, error: errorSpy, warn: warnSpy, debug: vi.fn() },
}))
;(globalThis as any).logger = { info: infoSpy, error: errorSpy, warn: warnSpy, debug: vi.fn() }

import { createTool } from '~~/server/services/agent-platform/tools/uploadWorkspaceFile.tool'

const baseCtx = { userId: 1, sessionId: 'sess-up-1' } as any

beforeEach(() => {
    vi.clearAllMocks()
})

describe('uploadWorkspaceFile 路径校验', () => {
    const fakeStat = async () => ({ size: 100 })

    async function invokeWith(filePath: string) {
        const t = createTool(baseCtx, '/tmp/ws', fakeStat)
        const out: any = await t.invoke({ filePath })
        return typeof out === 'string' ? out : out.content
    }

    it('含 NULL 字节', async () => {
        expect(await invokeWith('a\0b')).toMatch(/NULL 字节/)
    })

    it('绝对路径', async () => {
        expect(await invokeWith('/etc/passwd')).toMatch(/绝对路径/)
    })

    it('路径遍历', async () => {
        expect(await invokeWith('../escape.txt')).toMatch(/路径遍历/)
    })

    it('反斜杠', async () => {
        expect(await invokeWith('a\\b')).toMatch(/反斜杠/)
    })

    it('路径段含非法字符（空格）', async () => {
        expect(await invokeWith('hello world.txt')).toMatch(/包含非法字符/)
    })
})

describe('uploadWorkspaceFile 文件检查', () => {
    it('stat 失败 → 文件不存在错误', async () => {
        const failStat = async () => { throw new Error('ENOENT') }
        const t = createTool(baseCtx, '/tmp/ws', failStat as any)
        const out: any = await t.invoke({ filePath: 'output.txt' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/文件不存在或无法访问/)
    })

    it('文件超过 50MB 限制', async () => {
        const bigStat = async () => ({ size: 60 * 1024 * 1024 })
        const t = createTool(baseCtx, '/tmp/ws', bigStat)
        const out: any = await t.invoke({ filePath: 'big.bin' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/超过大小限制/)
    })
})

describe('uploadWorkspaceFile 上传路径', () => {
    const okStat = async () => ({ size: 1024 })

    it('配额允许：上传到用户存储并返回 file-card', async () => {
        checkStorageQuotaServiceMock.mockResolvedValueOnce({ allowed: true })
        uploadFileServiceMock.mockResolvedValueOnce({ name: 'users/1/workspace/sess-up-1/x.txt' })
        getDefaultStorageConfigDaoMock.mockResolvedValueOnce({ bucket: 'lexseek' })
        createOssFileDaoMock.mockResolvedValueOnce({ id: 999 })

        const t = createTool(baseCtx, '/tmp/ws', okStat)
        const out: any = await t.invoke({ filePath: 'output.txt' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('[file-card]')
        expect(text).toContain('fileId: 999')
        expect(text).toContain('mimeType: text/plain')
    })

    it('配额服务抛错 → 降级临时路径并 warn', async () => {
        checkStorageQuotaServiceMock.mockRejectedValueOnce(new Error('quota svc 挂了'))
        uploadFileServiceMock.mockResolvedValueOnce({ name: 'temp/...' })

        const t = createTool(baseCtx, '/tmp/ws', okStat)
        const out: any = await t.invoke({ filePath: 'log.txt' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('[file-card]')
        expect(text).toMatch(/temporary: true/)
        expect(text).toMatch(/expiresAt:/)
        expect(warnSpy).toHaveBeenCalledWith('配额检查失败，降级到临时路径:', expect.any(Error))
    })

    it('配额不足：上传到临时路径', async () => {
        checkStorageQuotaServiceMock.mockResolvedValueOnce({ allowed: false })
        uploadFileServiceMock.mockResolvedValueOnce({ name: 'temp/x' })

        const t = createTool(baseCtx, '/tmp/ws', okStat)
        const out: any = await t.invoke({ filePath: 'sub/data.json' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('[file-card]')
        expect(text).toMatch(/temporary: true/)
        expect(text).toContain('mimeType: application/json')
    })

    it('用户存储上传抛错 → 返回错误字符串', async () => {
        checkStorageQuotaServiceMock.mockResolvedValueOnce({ allowed: true })
        uploadFileServiceMock.mockRejectedValueOnce(new Error('OSS down'))

        const t = createTool(baseCtx, '/tmp/ws', okStat)
        const out: any = await t.invoke({ filePath: 'a.txt' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/Error: 文件上传失败.*OSS down/)
        expect(errorSpy).toHaveBeenCalled()
    })

    it('临时存储上传抛错 → 返回错误字符串', async () => {
        checkStorageQuotaServiceMock.mockResolvedValueOnce({ allowed: false })
        uploadFileServiceMock.mockRejectedValueOnce('字符串错误')

        const t = createTool(baseCtx, '/tmp/ws', okStat)
        const out: any = await t.invoke({ filePath: 'b.png' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toMatch(/Error: 文件上传失败.*未知错误/)
    })

    it('未知扩展名走 application/octet-stream', async () => {
        checkStorageQuotaServiceMock.mockResolvedValueOnce({ allowed: true })
        uploadFileServiceMock.mockResolvedValueOnce({ name: 'p' })
        getDefaultStorageConfigDaoMock.mockResolvedValueOnce(null)
        createOssFileDaoMock.mockResolvedValueOnce({ id: 1 })

        const t = createTool(baseCtx, '/tmp/ws', okStat)
        const out: any = await t.invoke({ filePath: 'output.weirdext' })
        const text = typeof out === 'string' ? out : out.content
        expect(text).toContain('mimeType: application/octet-stream')
    })
})
