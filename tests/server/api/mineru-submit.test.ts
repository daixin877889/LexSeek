/**
 * MinerU 提交 API 测试
 *
 * 测试 POST /api/v1/recognition/mineru/submit
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { MineruTaskStatus, DocRecognitionStatus } from '~/shared/types/recognition'

describe('MinerU 提交 API', () => {
    let testUser: any
    let testOssFile: any

    beforeAll(async () => {
        // 创建测试用户
        testUser = await prisma.users.create({
            data: {
                phone: '13800000098',
                password: 'test123',
                nickname: 'MinerU Submit Test User',
            },
        })

        // 创建测试 OSS 文件
        testOssFile = await prisma.ossFiles.create({
            data: {
                userId: testUser.id,
                fileName: 'test-submit.pdf',
                fileSize: 2048,
                mimeType: 'application/pdf',
                bucketName: 'test-bucket',
                objectKey: 'test/test-submit.pdf',
                url: 'https://example.com/test-submit.pdf',
            },
        })
    })

    afterAll(async () => {
        // 清理测试数据
        await prisma.mineruTasks.deleteMany({
            where: { userId: testUser.id },
        })
        await prisma.docRecognitionRecords.deleteMany({
            where: { userId: testUser.id },
        })
        await prisma.ossFiles.deleteMany({
            where: { userId: testUser.id },
        })
        await prisma.users.delete({
            where: { id: testUser.id },
        })
    })

    beforeEach(async () => {
        // 清理之前的测试任务
        await prisma.mineruTasks.deleteMany({
            where: { userId: testUser.id },
        })
        await prisma.docRecognitionRecords.deleteMany({
            where: { userId: testUser.id },
        })
    })

    describe('POST /api/v1/recognition/mineru/submit', () => {
        it('应该成功提交 MinerU 识别任务', async () => {
            // Mock MinerU API 响应
            vi.mock('$fetch', () => ({
                default: vi.fn().mockResolvedValue({
                    code: 0,
                    data: {
                        batch_id: 'mock-batch-id',
                        file_urls: ['https://mineru.net/upload/mock-url'],
                    },
                }),
            }))

            // 模拟 API 请求
            const response = await $fetch('/api/v1/recognition/mineru/submit', {
                method: 'POST',
                headers: {
                    'x-user-id': testUser.id.toString(),
                },
                body: {
                    ossFileId: testOssFile.id,
                    fileName: testOssFile.fileName,
                    encrypted: false,
                },
            })

            expect(response).toBeDefined()
            expect(response.code).toBe(200)
            expect(response.data).toHaveProperty('taskId')
            expect(response.data).toHaveProperty('taskStatus')
            expect(response.data.taskStatus).toBe(MineruTaskStatus.PROCESSING)

            // 验证任务记录已创建
            const task = await prisma.mineruTasks.findFirst({
                where: {
                    ossFileId: testOssFile.id,
                    userId: testUser.id,
                    deletedAt: null,
                },
            })

            expect(task).toBeDefined()
            expect(task?.status).toBe(MineruTaskStatus.PROCESSING)
        })

        it('应该在文件不存在时返回 404', async () => {
            try {
                await $fetch('/api/v1/recognition/mineru/submit', {
                    method: 'POST',
                    headers: {
                        'x-user-id': testUser.id.toString(),
                    },
                    body: {
                        ossFileId: 99999,
                        fileName: 'non-existent.pdf',
                        encrypted: false,
                    },
                })
                expect.fail('应该抛出 404 错误')
            } catch (error: any) {
                expect(error.statusCode).toBe(404)
            }
        })

        it('应该在未登录时返回 401', async () => {
            try {
                await $fetch('/api/v1/recognition/mineru/submit', {
                    method: 'POST',
                    body: {
                        ossFileId: testOssFile.id,
                        fileName: testOssFile.fileName,
                        encrypted: false,
                    },
                })
                expect.fail('应该抛出 401 错误')
            } catch (error: any) {
                expect(error.statusCode).toBe(401)
            }
        })

        it('应该在参数缺失时返回 400', async () => {
            try {
                await $fetch('/api/v1/recognition/mineru/submit', {
                    method: 'POST',
                    headers: {
                        'x-user-id': testUser.id.toString(),
                    },
                    body: {
                        // 缺少 ossFileId
                        fileName: 'test.pdf',
                    },
                })
                expect.fail('应该抛出 400 错误')
            } catch (error: any) {
                expect(error.statusCode).toBe(400)
            }
        })
    })
})
