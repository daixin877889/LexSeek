/**
 * MinerU 提交 API 测试
 *
 * 测试 POST /api/v1/recognition/mineru/submit
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestHelper } from './test-api-helpers'
import { prisma } from '../../../server/utils/db'
import { MineruTaskStatus, DocRecognitionStatus } from '../../../shared/types/recognition'
import { clearUserPermissionCache } from '../../../server/services/rbac/cache.service'

describe('MinerU 提交 API', () => {
    const helper = createTestHelper()
    const client = helper.getClient()
    let testUser: any
    let testOssFile: any

    beforeAll(async () => {
        // 创建测试用户并登录
        testUser = await helper.createAndLoginUser()
        console.log('Test User Token (Submit):', client.getAuthToken())

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
                fileName: 'test-submit.pdf',
                fileSize: 2048,
                fileType: 'application/pdf',
                bucketName: 'test-bucket',
                filePath: 'test/test-submit.pdf',
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

    describe('POST /api/v1/recognition/mineru/submit', () => {
        it('应该成功提交 MinerU 识别任务', async () => {
            // 模拟 API 请求
            const response = await client.post('/api/v1/recognition/mineru/submit', {
                ossFileId: testOssFile.id,
                fileName: testOssFile.fileName,
                encrypted: false,
            })

            expect(response).toBeDefined()
            expect(response.code).toBe(0)
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
            const response = await client.post('/api/v1/recognition/mineru/submit', {
                ossFileId: 99999,
                fileName: 'non-existent.pdf',
                encrypted: false,
            })
            expect(response.code).toBe(404)
        })

        it('应该在未登录时返回 401', async () => {
            const { createApiClient } = await import('./test-api-client')
            const noAuthClient = createApiClient()

            const response = await noAuthClient.post('/api/v1/recognition/mineru/submit', {
                ossFileId: testOssFile.id,
                fileName: testOssFile.fileName,
                encrypted: false,
            })
            expect(response.code).toBe(401)
        })

        it('应该在参数缺失时返回 400', async () => {
            const response = await client.post('/api/v1/recognition/mineru/submit', {
                // 缺少 ossFileId
                fileName: 'test.pdf',
            })
            expect(response.code).toBe(400)
        })
    })
})
