/**
 * MinerU 任务状态查询 API 测试
 *
 * 测试 GET /api/v1/recognition/mineru/task/:taskId
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '../../../server/utils/db'
import { createTestHelper } from './test-api-helpers'
import { MineruTaskStatus, DocRecognitionStatus } from '../../../shared/types/recognition'
import { clearUserPermissionCache } from '../../../server/services/rbac/cache.service'

describe('MinerU 任务状态查询 API', () => {
    const helper = createTestHelper()
    const client = helper.getClient()
    let testUser: any
    let testOssFile: any
    let testTask: any

    beforeAll(async () => {
        // 创建测试用户并登录
        testUser = await helper.createAndLoginUser()
        console.log('Test User Token:', client.getAuthToken())

        // 赋予超级管理员权限
        const superAdminRole = await prisma.roles.upsert({
            where: { code: 'super_admin' },
            update: {},
            create: {
                name: '超级管理员',
                code: 'super_admin',
                description: '系统超级管理员',
                status: 1,
            },
        })

        await prisma.userRoles.create({
            data: {
                userId: testUser.id,
                roleId: superAdminRole.id,
            },
        })

        // 清除权限缓存
        clearUserPermissionCache(testUser.id)

        // 创建测试 OSS 文件
        testOssFile = await prisma.ossFiles.create({
            data: {
                userId: testUser.id,
                fileName: 'test.pdf',
                fileSize: 1024,
                fileType: 'application/pdf',
                bucketName: 'test-bucket',
                filePath: 'test/test.pdf',
            },
        })
    })

    afterAll(async () => {
        // 清理测试数据
        if (testUser) {
            await prisma.mineruTasks.deleteMany({
                where: { userId: testUser.id },
            })
            await prisma.docRecognitionRecords.deleteMany({
                where: { userId: testUser.id },
            })
            await prisma.ossFiles.deleteMany({
                where: { userId: testUser.id },
            })
        }
        await helper.cleanup()
    })

    beforeEach(async () => {
        // 清理之前的测试任务
        if (testUser) {
            await prisma.mineruTasks.deleteMany({
                where: { userId: testUser.id },
            })
            await prisma.docRecognitionRecords.deleteMany({
                where: { userId: testUser.id },
            })
        }
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
            const response = await client.get(`/api/v1/recognition/mineru/task/${testTask.taskId}`)

            expect(response).toBeDefined()
            expect(response.code).toBe(0)
            expect(response.data).toMatchObject({
                taskId: testTask.id.toString(),
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
            const response = await client.get(`/api/v1/recognition/mineru/task/${testTask.taskId}`)

            expect(response).toBeDefined()
            expect(response.code).toBe(0)
            expect(response.data).toMatchObject({
                taskId: testTask.id.toString(),
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
            const response = await client.get(`/api/v1/recognition/mineru/task/${testTask.taskId}`)

            expect(response).toBeDefined()
            expect(response.code).toBe(0)
            expect(response.data).toMatchObject({
                taskId: testTask.id.toString(),
                status: MineruTaskStatus.FAILED,
                recordId: null,
                errorMsg: '识别失败',
            })
        })

        it('应该在任务不存在时返回 404', async () => {
            // 模拟 API 请求
            const response = await client.get('/api/v1/recognition/mineru/task/non-existent-task')
            expect(response.code).toBe(404)
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

            // 创建未认证的客户端
            const { createApiClient } = await import('./test-api-client')
            const noAuthClient = createApiClient()

            // 模拟未登录的 API 请求
            const response = await noAuthClient.get(`/api/v1/recognition/mineru/task/${testTask.taskId}`)
            expect(response.code).toBe(401)
        })
    })
})
