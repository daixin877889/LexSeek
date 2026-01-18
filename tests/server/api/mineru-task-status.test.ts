/**
 * MinerU 任务状态查询 API 测试
 *
 * 测试 GET /api/v1/recognition/mineru/task/:taskId
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MineruTaskStatus, DocRecognitionStatus } from '~/shared/types/recognition'

describe('MinerU 任务状态查询 API', () => {
    let testUser: any
    let testOssFile: any
    let testTask: any

    beforeAll(async () => {
        // 创建测试用户
        testUser = await prisma.users.create({
            data: {
                phone: '13800000099',
                password: 'test123',
                nickname: 'MinerU Test User',
            },
        })

        // 创建测试 OSS 文件
        testOssFile = await prisma.ossFiles.create({
            data: {
                userId: testUser.id,
                fileName: 'test.pdf',
                fileSize: 1024,
                mimeType: 'application/pdf',
                bucketName: 'test-bucket',
                objectKey: 'test/test.pdf',
                url: 'https://example.com/test.pdf',
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

    describe('GET /api/v1/recognition/mineru/task/:taskId', () => {
        it('应该返回处理中的任务状态', async () => {
            // 创建处理中的任务
            testTask = await prisma.mineruTasks.create({
                data: {
                    taskId: 'test-task-processing',
                    ossFileId: testOssFile.id,
                    userId: testUser.id,
                    status: MineruTaskStatus.PROCESSING,
                    taskRawData: {
                        batchId: 'test-batch-id',
                    },
                },
            })

            // 模拟 API 请求
            const response = await $fetch(`/api/v1/recognition/mineru/task/${testTask.taskId}`, {
                headers: {
                    // 模拟用户认证
                    'x-user-id': testUser.id.toString(),
                },
            })

            expect(response).toBeDefined()
            expect(response.code).toBe(200)
            expect(response.data).toMatchObject({
                taskId: testTask.taskId,
                status: MineruTaskStatus.PROCESSING,
                recordId: null,
            })
        })

        it('应该返回成功的任务状态和识别记录 ID', async () => {
            // 创建成功的任务
            testTask = await prisma.mineruTasks.create({
                data: {
                    taskId: 'test-task-success',
                    ossFileId: testOssFile.id,
                    userId: testUser.id,
                    status: MineruTaskStatus.SUCCESS,
                    taskRawData: {
                        batchId: 'test-batch-id',
                    },
                    completedAt: new Date(),
                },
            })

            // 创建识别记录
            const record = await prisma.docRecognitionRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: testOssFile.id,
                    status: DocRecognitionStatus.SUCCESS,
                    htmlContent: '<p>Test content</p>',
                    markdownContent: 'Test content',
                },
            })

            // 模拟 API 请求
            const response = await $fetch(`/api/v1/recognition/mineru/task/${testTask.taskId}`, {
                headers: {
                    'x-user-id': testUser.id.toString(),
                },
            })

            expect(response).toBeDefined()
            expect(response.code).toBe(200)
            expect(response.data).toMatchObject({
                taskId: testTask.taskId,
                status: MineruTaskStatus.SUCCESS,
                recordId: record.id,
            })
        })

        it('应该返回失败的任务状态', async () => {
            // 创建失败的任务
            testTask = await prisma.mineruTasks.create({
                data: {
                    taskId: 'test-task-failed',
                    ossFileId: testOssFile.id,
                    userId: testUser.id,
                    status: MineruTaskStatus.FAILED,
                    taskRawData: {
                        batchId: 'test-batch-id',
                    },
                    errorMsg: '识别失败',
                    completedAt: new Date(),
                },
            })

            // 模拟 API 请求
            const response = await $fetch(`/api/v1/recognition/mineru/task/${testTask.taskId}`, {
                headers: {
                    'x-user-id': testUser.id.toString(),
                },
            })

            expect(response).toBeDefined()
            expect(response.code).toBe(200)
            expect(response.data).toMatchObject({
                taskId: testTask.taskId,
                status: MineruTaskStatus.FAILED,
                recordId: null,
                errorMsg: '识别失败',
            })
        })

        it('应该在任务不存在时返回 404', async () => {
            // 模拟 API 请求
            try {
                await $fetch('/api/v1/recognition/mineru/task/non-existent-task', {
                    headers: {
                        'x-user-id': testUser.id.toString(),
                    },
                })
                // 如果没有抛出错误，测试失败
                expect.fail('应该抛出 404 错误')
            } catch (error: any) {
                expect(error.statusCode).toBe(404)
            }
        })

        it('应该在未登录时返回 401', async () => {
            // 创建任务
            testTask = await prisma.mineruTasks.create({
                data: {
                    taskId: 'test-task-unauthorized',
                    ossFileId: testOssFile.id,
                    userId: testUser.id,
                    status: MineruTaskStatus.PROCESSING,
                    taskRawData: {},
                },
            })

            // 模拟未登录的 API 请求
            try {
                await $fetch(`/api/v1/recognition/mineru/task/${testTask.taskId}`)
                expect.fail('应该抛出 401 错误')
            } catch (error: any) {
                expect(error.statusCode).toBe(401)
            }
        })
    })
})
