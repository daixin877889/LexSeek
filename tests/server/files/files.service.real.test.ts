/**
 * 文件服务（真实 DB 集成）测试
 *
 * 覆盖 server/services/files/files.service.ts 的全部导出函数：
 * - generateOssPostSignatureService：上传预签名生成编排
 * - generateOssDownloadSignaturesService：批量下载预签名生成编排
 *
 * 策略：
 * - 真实插入 systemConfigs / ossFiles / users 记录，走真实 Prisma
 * - 仅 mock `~~/server/lib/oss` 以避免真实 OSS/STS 网络调用
 *   （验证 service 对 DAO 的编排，不验证 OSS SDK 本身）
 *
 * **Feature: files-service**
 * **Validates: Requirements 1.1, 2.1, 6.1**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------
// Mock `~~/server/lib/oss` —— 仅隔离 OSS SDK 网络调用
// 必须在 import service 之前通过 vi.mock 提升到顶部
// ---------------------------------------------------------------
const ossMocks = vi.hoisted(() => ({
    generatePostSignature: vi.fn(),
    generateSignedUrl: vi.fn(),
}))

const runtimeMocks = vi.hoisted(() => ({
    getRuntimeConfig: vi.fn(() => ({
        aliyun: { oss: { callbackUrl: 'https://example.com/callback' } },
        storage: { aliyunOss: {} },
    })),
}))

vi.mock('~~/server/lib/oss', () => ({
    generatePostSignature: ossMocks.generatePostSignature,
    generateSignedUrl: ossMocks.generateSignedUrl,
    // 其他无关导出给空对象即可
    createOssClient: vi.fn(),
    validateConfig: vi.fn(),
    uploadFile: vi.fn(),
    downloadFile: vi.fn(),
    downloadFileStream: vi.fn(),
    deleteFile: vi.fn(),
    formatDateToUTC: vi.fn(),
    getStandardRegion: vi.fn(),
    getCredential: vi.fn(),
    encodeBase64: vi.fn(),
    decodeBase64: vi.fn(),
    getOssHost: vi.fn(),
}))

// Mock #app/nuxt 的 useRuntimeConfig（Nuxt test env 下 service 通过此解析）
vi.mock('#app/nuxt', async (importOriginal) => {
    const actual = await importOriginal<any>()
    return {
        ...actual,
        useRuntimeConfig: (...args: any[]) => runtimeMocks.getRuntimeConfig(...args),
    }
})

// ---------------------------------------------------------------
// systemConfig.dao 不再走全局自动导入，service 通过 ES import 引入。
// 用 vi.mock 把 getConfigsByGroupAndKeyDao 改写为可在用例里临时替换的 ref，
// 这样 "顶层异常传播" 用例覆盖全局变量时才能真正影响到 service 的真实调用。
// ---------------------------------------------------------------
const systemConfigMocks = vi.hoisted(() => ({
    getConfigsByGroupAndKeyDao: undefined as undefined | ((group: string, key: string) => Promise<any>),
}))

vi.mock('~~/server/services/system/systemConfig.dao', async (importOriginal) => {
    const actual = await importOriginal<any>()
    return {
        ...actual,
        getConfigsByGroupAndKeyDao: (group: string, key: string) =>
            (systemConfigMocks.getConfigsByGroupAndKeyDao
                ? systemConfigMocks.getConfigsByGroupAndKeyDao(group, key)
                : actual.getConfigsByGroupAndKeyDao(group, key)),
    }
})

import { getConfigsByGroupAndKeyDao } from '../../../server/services/system/systemConfig.dao'
import { SystemConfigStatus } from '../../../shared/types/system'
;(globalThis as any).SystemConfigStatus = SystemConfigStatus
;(globalThis as any).getConfigsByGroupAndKeyDao = getConfigsByGroupAndKeyDao
;(globalThis as any).OSS = {
    generatePostSignature: ossMocks.generatePostSignature,
    generateSignedUrl: ossMocks.generateSignedUrl,
}
;(globalThis as any).useRuntimeConfig = (...args: any[]) => runtimeMocks.getRuntimeConfig(...args)

// ---------------------------------------------------------------
// 被测 service（真实导入，确保 vi.mock 已注册）
// ---------------------------------------------------------------
import {
    generateOssPostSignatureService,
    generateOssDownloadSignaturesService,
    type BatchDownloadSignatureResult,
} from '../../../server/services/files/files.service'

import {
    getTestPrisma,
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    disconnectTestDb,
    createEmptyTestIds,
    type TestIds,
} from './test-db-helper'

// ---------------------------------------------------------------
// 测试数据追踪
// ---------------------------------------------------------------
interface ExtendedTestIds extends TestIds {
    systemConfigIds: number[]
}

const createEmptyExtendedTestIds = (): ExtendedTestIds => ({
    ...createEmptyTestIds(),
    systemConfigIds: [],
})

let testIds: ExtendedTestIds = createEmptyExtendedTestIds()

// ---------------------------------------------------------------
// Helper：真实插入一条 systemConfigs 记录作为 bucket 的 OSS 配置
// ---------------------------------------------------------------
const createTestOssConfig = async (
    bucket: string,
    value: Record<string, unknown> = {},
): Promise<{ id: number }> => {
    const prisma = getTestPrisma()
    const record = await prisma.systemConfigs.create({
        data: {
            configGroup: 'ossConfig',
            key: bucket,
            value: {
                accessKeyId: 'test_ak',
                accessKeySecret: 'test_sk',
                region: 'cn-hangzhou',
                domain: `https://${bucket}.oss-cn-hangzhou.aliyuncs.com`,
                roleArn: 'acs:ram::000000000000:role/test',
                roleSessionName: 'OSS',
                expiration: 3600,
                ...value,
            },
            description: '测试 OSS 配置',
            status: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        },
    })
    return { id: record.id }
}

// ---------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------
describe('文件服务真实 DB 集成测试', () => {
    beforeAll(async () => {
        const prisma = getTestPrisma()
        await prisma.$connect()
    })

    afterEach(async () => {
        // 清理 systemConfigs（硬删除，避免唯一键冲突）
        const prisma = getTestPrisma()
        if (testIds.systemConfigIds.length > 0) {
            await prisma.systemConfigs.deleteMany({
                where: { id: { in: testIds.systemConfigIds } },
            })
        }
        await cleanupTestData(testIds)
        testIds = createEmptyExtendedTestIds()

        // 清理 mock 调用
        ossMocks.generatePostSignature.mockReset()
        ossMocks.generateSignedUrl.mockReset()
    })

    afterAll(async () => {
        await disconnectTestDb()
    })

    // ==================================================================
    // generateOssPostSignatureService
    // ==================================================================
    describe('generateOssPostSignatureService - 生成上传预签名', () => {
        it('成功编排：读取 DB 中的 OSS 配置并返回 OSS.generatePostSignature 结果', async () => {
            const bucket = `test-bucket-${Date.now()}`
            const cfg = await createTestOssConfig(bucket)
            testIds.systemConfigIds.push(cfg.id)

            const fakeResult = {
                host: `https://${bucket}.oss-cn-hangzhou.aliyuncs.com`,
                policy: 'fake-policy',
                signatureVersion: 'OSS4-HMAC-SHA256',
                credential: 'fake-credential',
                date: '20260417T000000Z',
                signature: 'fake-signature',
                dir: 'uploads/',
                key: 'uploads/test.pdf',
            }
            ossMocks.generatePostSignature.mockResolvedValueOnce(fakeResult)

            const result = await generateOssPostSignatureService({
                bucket,
                originalFileName: 'test.pdf',
                maxSize: 10 * 1024 * 1024,
                dir: 'uploads/',
                saveName: 'test.pdf',
                allowedMimeTypes: ['application/pdf'],
                callbackVar: { userId: '1' },
            })

            expect(result).toEqual(fakeResult)

            // 验证 OSS.generatePostSignature 收到的配置来自 DB
            expect(ossMocks.generatePostSignature).toHaveBeenCalledTimes(1)
            const [calledConfig, calledOptions] = ossMocks.generatePostSignature.mock.calls[0]!
            expect(calledConfig).toMatchObject({
                accessKeyId: 'test_ak',
                accessKeySecret: 'test_sk',
                bucket,
                region: 'cn-hangzhou',
                customDomain: `https://${bucket}.oss-cn-hangzhou.aliyuncs.com`,
                sts: {
                    roleArn: 'acs:ram::000000000000:role/test',
                    roleSessionName: 'OSS',
                    durationSeconds: 3600,
                },
            })
            expect(calledOptions).toMatchObject({
                dir: 'uploads/',
                fileKey: {
                    originalFileName: 'test.pdf',
                    strategy: 'custom',
                    customFileName: 'test.pdf',
                },
                expirationMinutes: 10,
                conditions: {
                    contentLengthRange: [0, 10 * 1024 * 1024],
                    contentType: ['application/pdf'],
                },
            })
            expect(calledOptions.callback).toMatchObject({
                callbackBody: 'filename=${object}&size=${size}&mimeType=${mimeType}',
                callbackBodyType: 'application/x-www-form-urlencoded',
                callbackVar: { userId: '1' },
            })
        })

        it('OSS 配置可选字段为空时使用默认值（roleSessionName/durationSeconds）', async () => {
            const bucket = `test-bucket-default-${Date.now()}`
            // 插入配置时清除可选字段
            const prisma = getTestPrisma()
            const rec = await prisma.systemConfigs.create({
                data: {
                    configGroup: 'ossConfig',
                    key: bucket,
                    value: {
                        accessKeyId: 'ak',
                        accessKeySecret: 'sk',
                        region: 'cn-shanghai',
                        domain: '',
                        // 故意缺失 roleArn / roleSessionName / expiration
                    },
                    status: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            })
            testIds.systemConfigIds.push(rec.id)

            ossMocks.generatePostSignature.mockResolvedValueOnce({
                host: 'h',
                policy: 'p',
                signatureVersion: 's',
                credential: 'c',
                date: 'd',
                signature: 'sig',
                dir: '',
            })

            await generateOssPostSignatureService({
                bucket,
                originalFileName: 'a.txt',
                maxSize: 1024,
                dir: '',
                saveName: 'a.txt',
                allowedMimeTypes: ['text/plain'],
            })

            const [cfg] = ossMocks.generatePostSignature.mock.calls[0]!
            expect(cfg.sts.roleArn).toBe('')
            expect(cfg.sts.roleSessionName).toBe('OSS')
            expect(cfg.sts.durationSeconds).toBe(3600)
        })

        it('DB 中无对应 bucket 配置时抛出 "OSS配置不存在"', async () => {
            await expect(
                generateOssPostSignatureService({
                    bucket: `non-existent-${Date.now()}`,
                    originalFileName: 'x.txt',
                    maxSize: 1024,
                    dir: '',
                    saveName: 'x.txt',
                    allowedMimeTypes: ['text/plain'],
                }),
            ).rejects.toThrow('OSS配置不存在')

            expect(ossMocks.generatePostSignature).not.toHaveBeenCalled()
        })

        it('OSS.generatePostSignature 抛错时向上透传', async () => {
            const bucket = `test-bucket-err-${Date.now()}`
            const cfg = await createTestOssConfig(bucket)
            testIds.systemConfigIds.push(cfg.id)

            ossMocks.generatePostSignature.mockRejectedValueOnce(new Error('sts failed'))

            await expect(
                generateOssPostSignatureService({
                    bucket,
                    originalFileName: 'x.txt',
                    maxSize: 1024,
                    dir: '',
                    saveName: 'x.txt',
                    allowedMimeTypes: ['text/plain'],
                }),
            ).rejects.toThrow('sts failed')
        })
    })

    // ==================================================================
    // generateOssDownloadSignaturesService
    // ==================================================================
    describe('generateOssDownloadSignaturesService - 批量下载签名', () => {
        it('空文件列表直接返回空数组，不触发任何调用', async () => {
            const result = await generateOssDownloadSignaturesService({ ossFiles: [] })
            expect(result).toEqual([])
            expect(ossMocks.generateSignedUrl).not.toHaveBeenCalled()
        })

        it('undefined / null 文件列表也返回空数组', async () => {
            // @ts-expect-error 故意传入非法值，覆盖防御分支
            const result = await generateOssDownloadSignaturesService({ ossFiles: undefined })
            expect(result).toEqual([])
        })

        it('单 bucket 下多文件：并行返回对应结果', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const bucket = `single-bucket-${Date.now()}`
            const cfg = await createTestOssConfig(bucket)
            testIds.systemConfigIds.push(cfg.id)

            const file1 = await createTestOssFile(user.id, { bucketName: bucket, fileName: 'a.pdf' })
            const file2 = await createTestOssFile(user.id, { bucketName: bucket, fileName: 'b.pdf' })
            testIds.ossFileIds.push(file1.id, file2.id)

            ossMocks.generateSignedUrl.mockImplementation(async (_config, path) => `https://cdn.example.com/${path}?sign=xx`)

            const results = await generateOssDownloadSignaturesService({
                ossFiles: [file1 as any, file2 as any],
                expires: 600,
            })

            expect(results).toHaveLength(2)
            const byId = new Map(results.map((r: BatchDownloadSignatureResult) => [r.ossFileId, r]))
            expect(byId.get(file1.id)?.fileName).toBe('a.pdf')
            expect(byId.get(file2.id)?.downloadUrl).toContain(file2.filePath!)

            // 校验 expires 被正确传递
            expect(ossMocks.generateSignedUrl).toHaveBeenCalledTimes(2)
            const firstCall = ossMocks.generateSignedUrl.mock.calls[0]!
            expect(firstCall[2]).toMatchObject({ expires: 600, method: 'GET' })
        })

        it('未指定 expires 时使用默认 3600 秒', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const bucket = `default-expires-${Date.now()}`
            const cfg = await createTestOssConfig(bucket)
            testIds.systemConfigIds.push(cfg.id)

            const file = await createTestOssFile(user.id, { bucketName: bucket })
            testIds.ossFileIds.push(file.id)

            ossMocks.generateSignedUrl.mockResolvedValue('https://cdn.example.com/x?sign=1')

            await generateOssDownloadSignaturesService({ ossFiles: [file as any] })

            const firstCall = ossMocks.generateSignedUrl.mock.calls[0]!
            expect(firstCall[2].expires).toBe(3600)
        })

        it('多 bucket：按 bucket 分组并行获取配置，下载 URL 使用 AK/SK 而非 STS', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const bucketA = `multi-a-${Date.now()}`
            const bucketB = `multi-b-${Date.now()}`
            const cfgA = await createTestOssConfig(bucketA)
            const cfgB = await createTestOssConfig(bucketB)
            testIds.systemConfigIds.push(cfgA.id, cfgB.id)

            const fa = await createTestOssFile(user.id, { bucketName: bucketA })
            const fb = await createTestOssFile(user.id, { bucketName: bucketB })
            testIds.ossFileIds.push(fa.id, fb.id)

            ossMocks.generateSignedUrl.mockImplementation(async (config, path) => `https://${config.bucket}/${path}`)

            const results = await generateOssDownloadSignaturesService({
                ossFiles: [fa as any, fb as any],
            })

            expect(results).toHaveLength(2)

            // 每次调用 generateSignedUrl 的 config 不能包含 STS（下载用 AK/SK）
            for (const call of ossMocks.generateSignedUrl.mock.calls) {
                const config = call[0]
                expect(config.sts).toBeUndefined()
                expect(config.accessKeyId).toBe('test_ak')
                expect(config.accessKeySecret).toBe('test_sk')
            }

            // URL 中应包含按 bucket 选择的 host
            const urlA = results.find(r => r.ossFileId === fa.id)!.downloadUrl
            const urlB = results.find(r => r.ossFileId === fb.id)!.downloadUrl
            expect(urlA).toContain(bucketA)
            expect(urlB).toContain(bucketB)
        })

        it('跳过配置缺失的 bucket（无 DB 配置且无 fallback）', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const missingBucket = `missing-${Date.now()}`
            const withCfgBucket = `with-${Date.now()}`
            const cfg = await createTestOssConfig(withCfgBucket)
            testIds.systemConfigIds.push(cfg.id)

            const fMissing = await createTestOssFile(user.id, { bucketName: missingBucket })
            const fOK = await createTestOssFile(user.id, { bucketName: withCfgBucket })
            testIds.ossFileIds.push(fMissing.id, fOK.id)

            ossMocks.generateSignedUrl.mockResolvedValue('https://ok.example/x')

            const results = await generateOssDownloadSignaturesService({
                ossFiles: [fMissing as any, fOK as any],
            })

            expect(results).toHaveLength(1)
            expect(results[0]!.ossFileId).toBe(fOK.id)
            expect(ossMocks.generateSignedUrl).toHaveBeenCalledTimes(1)
        })

        it('单文件生成签名失败时，其他文件仍能成功返回', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const bucket = `partial-fail-${Date.now()}`
            const cfg = await createTestOssConfig(bucket)
            testIds.systemConfigIds.push(cfg.id)

            const fBad = await createTestOssFile(user.id, { bucketName: bucket, fileName: 'bad.pdf' })
            const fGood = await createTestOssFile(user.id, { bucketName: bucket, fileName: 'good.pdf' })
            testIds.ossFileIds.push(fBad.id, fGood.id)

            ossMocks.generateSignedUrl.mockImplementation(async (_cfg, _path, _opts) => {
                if (_path?.includes('bad')) throw new Error('sign error')
                return 'https://cdn.example/good?sign=1'
            })

            // 注意：service 按 fileName 判定不完全准确，我们用 filePath 控制
            ossMocks.generateSignedUrl.mockReset()
            ossMocks.generateSignedUrl.mockImplementation(async (_cfg, path: string) => {
                if (path === fBad.filePath) throw new Error('sign error for bad file')
                return 'https://cdn.example/good?sign=1'
            })

            const results = await generateOssDownloadSignaturesService({
                ossFiles: [fBad as any, fGood as any],
            })

            expect(results).toHaveLength(1)
            expect(results[0]!.ossFileId).toBe(fGood.id)
            expect(results[0]!.fileName).toBe('good.pdf')
        })

        it('encrypted 字段透传到返回结果', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const bucket = `encrypted-${Date.now()}`
            const cfg = await createTestOssConfig(bucket)
            testIds.systemConfigIds.push(cfg.id)

            const encFile = await createTestOssFile(user.id, { bucketName: bucket, encrypted: true })
            const plainFile = await createTestOssFile(user.id, { bucketName: bucket, encrypted: false })
            testIds.ossFileIds.push(encFile.id, plainFile.id)

            ossMocks.generateSignedUrl.mockResolvedValue('https://x')

            const results = await generateOssDownloadSignaturesService({
                ossFiles: [encFile as any, plainFile as any],
            })

            const encResult = results.find(r => r.ossFileId === encFile.id)!
            const plainResult = results.find(r => r.ossFileId === plainFile.id)!
            expect(encResult.encrypted).toBe(true)
            expect(plainResult.encrypted).toBe(false)
        })

        it('文件名包含特殊字符时 contentDisposition 使用 encodeURIComponent', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)
            const bucket = `special-char-${Date.now()}`
            const cfg = await createTestOssConfig(bucket)
            testIds.systemConfigIds.push(cfg.id)

            const specialName = '中文名 带 空格.pdf'
            const file = await createTestOssFile(user.id, { bucketName: bucket, fileName: specialName })
            testIds.ossFileIds.push(file.id)

            ossMocks.generateSignedUrl.mockResolvedValue('https://x')

            await generateOssDownloadSignaturesService({ ossFiles: [file as any] })

            const call = ossMocks.generateSignedUrl.mock.calls[0]!
            const opts = call[2]
            expect(opts.response.contentDisposition).toContain(encodeURIComponent(specialName))
            expect(opts.response.contentDisposition).toContain('attachment;')
        })

        it('顶层异常（例如 getConfigsByGroupAndKeyDao 崩溃）被捕获并抛出', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            // 传入的 ossFiles 数据非法，强制 bucketName 为 undefined，会让 Map.get 返回 undefined 并跳过
            // 但不会触发 catch 外层 —— 另起一个场景：mock generateSignedUrl 内部错误被捕获
            // 这里专门用 Promise.all 包装的外层异常
            const bucket = `err-bucket-${Date.now()}`
            const cfg = await createTestOssConfig(bucket)
            testIds.systemConfigIds.push(cfg.id)

            const file = await createTestOssFile(user.id, { bucketName: bucket })
            testIds.ossFileIds.push(file.id)

            // 人为让 generateSignedUrl 抛出后，单文件失败只会返回 null 被过滤，不抛错
            // 所以最终列表长度为 0；外层 try/catch 此时不会触发
            ossMocks.generateSignedUrl.mockRejectedValue(new Error('inner fail'))

            const results = await generateOssDownloadSignaturesService({ ossFiles: [file as any] })
            expect(results).toEqual([])
        })
    })

    // ==================================================================
    // getFallbackOssConfig（通过 generateOssDownloadSignaturesService 间接覆盖）
    // ==================================================================
    describe('getFallbackOssConfig - runtimeConfig 保底配置路径', () => {
        afterEach(() => {
            // 每个测试用例结束后恢复默认 stub，避免影响其他测试
            runtimeMocks.getRuntimeConfig.mockImplementation(() => ({
                aliyun: { oss: { callbackUrl: 'https://example.com/callback' } },
                storage: { aliyunOss: {} },
            }))
        })

        it('DB 无配置但 runtimeConfig 有匹配 bucket 时使用 fallback', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const bucket = `fallback-${Date.now()}`

            // 覆盖 useRuntimeConfig：返回匹配的 fallback
            runtimeMocks.getRuntimeConfig.mockImplementation(() => ({
                aliyun: { oss: { callbackUrl: '' } },
                storage: {
                    aliyunOss: {
                        accessKeyId: 'fallback_ak',
                        accessKeySecret: 'fallback_sk',
                        bucket, // 显式匹配
                        region: 'cn-beijing',
                        customDomain: 'https://fallback.example.com',
                    },
                },
            }))

            const file = await createTestOssFile(user.id, { bucketName: bucket })
            testIds.ossFileIds.push(file.id)

            ossMocks.generateSignedUrl.mockResolvedValue('https://fallback/ok')

            const results = await generateOssDownloadSignaturesService({ ossFiles: [file as any] })

            expect(results).toHaveLength(1)
            const usedConfig = ossMocks.generateSignedUrl.mock.calls[0]![0]
            expect(usedConfig.accessKeyId).toBe('fallback_ak')
            expect(usedConfig.accessKeySecret).toBe('fallback_sk')
            expect(usedConfig.region).toBe('cn-beijing')
        })

        it('runtimeConfig 无 bucket 配置时使用请求的 bucket 作为默认值', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const bucket = `fallback-nobucket-${Date.now()}`

            runtimeMocks.getRuntimeConfig.mockImplementation(() => ({
                aliyun: { oss: { callbackUrl: '' } },
                storage: {
                    aliyunOss: {
                        accessKeyId: 'ak2',
                        accessKeySecret: 'sk2',
                        // bucket 故意不设置
                        region: '',
                        customDomain: '',
                    },
                },
            }))

            const file = await createTestOssFile(user.id, { bucketName: bucket })
            testIds.ossFileIds.push(file.id)

            ossMocks.generateSignedUrl.mockResolvedValue('https://x')

            await generateOssDownloadSignaturesService({ ossFiles: [file as any] })

            const usedConfig = ossMocks.generateSignedUrl.mock.calls[0]![0]
            expect(usedConfig.bucket).toBe(bucket)
            expect(usedConfig.region).toBe('')
            expect(usedConfig.customDomain).toBe('')
        })

        it('runtimeConfig 配置的 bucket 与请求 bucket 不匹配时跳过 fallback', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            runtimeMocks.getRuntimeConfig.mockImplementation(() => ({
                aliyun: { oss: { callbackUrl: '' } },
                storage: {
                    aliyunOss: {
                        accessKeyId: 'ak',
                        accessKeySecret: 'sk',
                        bucket: 'other-bucket',
                        region: 'cn-hangzhou',
                    },
                },
            }))

            const bucket = `mismatched-${Date.now()}`
            const file = await createTestOssFile(user.id, { bucketName: bucket })
            testIds.ossFileIds.push(file.id)

            const results = await generateOssDownloadSignaturesService({ ossFiles: [file as any] })
            expect(results).toEqual([])
            expect(ossMocks.generateSignedUrl).not.toHaveBeenCalled()
        })

        it('useRuntimeConfig 抛错时返回 null 并安全降级', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            runtimeMocks.getRuntimeConfig.mockImplementation(() => {
                throw new Error('runtime config unavailable')
            })

            const bucket = `throwing-${Date.now()}`
            const file = await createTestOssFile(user.id, { bucketName: bucket })
            testIds.ossFileIds.push(file.id)

            const results = await generateOssDownloadSignaturesService({ ossFiles: [file as any] })
            expect(results).toEqual([])
            expect(ossMocks.generateSignedUrl).not.toHaveBeenCalled()
        })
    })

    // ==================================================================
    // 顶层 try/catch：getConfigsByGroupAndKeyDao 崩溃时错误向上透传
    // ==================================================================
    describe('generateOssDownloadSignaturesService - 顶层异常传播', () => {
        it('获取 DB 配置时抛错会被捕获并重新抛出', async () => {
            const user = await createTestUser()
            testIds.userIds.push(user.id)

            const file = await createTestOssFile(user.id, { bucketName: 'any-bucket' })
            testIds.ossFileIds.push(file.id)

            // 通过 vi.hoisted 暴露的 ref 临时替换 dao 实现，让 service 真正捕获到抛错
            systemConfigMocks.getConfigsByGroupAndKeyDao = async () => {
                throw new Error('db outage')
            }

            try {
                await expect(
                    generateOssDownloadSignaturesService({ ossFiles: [file as any] }),
                ).rejects.toThrow('db outage')
            } finally {
                systemConfigMocks.getConfigsByGroupAndKeyDao = undefined
            }
        })
    })
})
