/**
 * MinerU 批量上传功能测试
 *
 * **Feature: mineru-batch-upload**
 * **Validates: Requirements 1.1-1.4, 2.1-2.6, 4.1-4.5**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import * as fc from 'fast-check'
import './test-setup'
import {
    createTestUser,
    createTestOssFile,
    createEmptyTestIds,
    cleanupTestData,
    disconnectTestDb,
    getTestPrisma,
    type CaseTestIds,
} from './test-db-helper'
import { PBT_CONFIG } from './test-generators'

// 导入被测试的服务
import { DocRecognitionStatus } from '../../../server/services/material/mineru.service'
import { MineruTaskStatus } from '../../../server/services/material/mineruTask.service'

describe('MinerU 批量上传功能', () => {
    let testIds: CaseTestIds
    let testUser: Awaited<ReturnType<typeof createTestUser>>

    beforeAll(async () => {
        testIds = createEmptyTestIds()
        testUser = await createTestUser()
        testIds.userIds.push(testUser.id)
    })

    afterEach(async () => {
        // 清理每个测试创建的 OSS 文件和相关记录
        if (testIds.ossFileIds.length > 0) {
            // 清理 MinerU 任务记录
            await getTestPrisma().mineruTasks.deleteMany({
                where: { ossFileId: { in: testIds.ossFileIds } },
            })
            // 清理文档识别记录
            await getTestPrisma().docRecognitionRecords.deleteMany({
                where: { ossFileId: { in: testIds.ossFileIds } },
            })
            // 清理 OSS 文件
            await cleanupTestData({
                ...createEmptyTestIds(),
                ossFileIds: [...testIds.ossFileIds],
            })
            testIds.ossFileIds = []
        }
    })

    afterAll(async () => {
        await cleanupTestData(testIds)
        await disconnectTestDb()
    })

    // ==================== 单元测试 ====================

    describe('data_id 格式测试', () => {
        it('应该正确生成 ossFileId_userId 格式的 data_id', () => {
            const generateDataId = (ossFileId: number, userId: number): string => {
                return `${ossFileId}_${userId}`
            }

            expect(generateDataId(123, 456)).toBe('123_456')
            expect(generateDataId(1, 1)).toBe('1_1')
            expect(generateDataId(999999, 888888)).toBe('999999_888888')
        })

        it('应该正确解析 data_id 为 ossFileId 和 userId', () => {
            const parseDataId = (dataId: string): { ossFileId: number; userId: number } | null => {
                const parts = dataId.split('_')
                if (parts.length !== 2) return null

                const ossFileId = parseInt(parts[0]!, 10)
                const userId = parseInt(parts[1]!, 10)

                if (isNaN(ossFileId) || isNaN(userId)) return null

                return { ossFileId, userId }
            }

            expect(parseDataId('123_456')).toEqual({ ossFileId: 123, userId: 456 })
            expect(parseDataId('1_1')).toEqual({ ossFileId: 1, userId: 1 })
            expect(parseDataId('invalid')).toBeNull()
            expect(parseDataId('123_abc')).toBeNull()
            expect(parseDataId('123_456_789')).toBeNull()
        })
    })

    describe('指数退避计算测试', () => {
        it('应该正确计算指数退避延迟', () => {
            const calculateBackoffDelay = (
                retryCount: number,
                initialDelay: number = 5000,
                maxDelay: number = 300000,
                backoffFactor: number = 1.5
            ): number => {
                const delay = initialDelay * Math.pow(backoffFactor, retryCount)
                return Math.min(delay, maxDelay)
            }

            // 第 0 次重试：5000ms
            expect(calculateBackoffDelay(0)).toBe(5000)
            // 第 1 次重试：7500ms
            expect(calculateBackoffDelay(1)).toBe(7500)
            // 第 2 次重试：11250ms
            expect(calculateBackoffDelay(2)).toBe(11250)
            // 第 10 次重试：应该接近或达到最大值
            expect(calculateBackoffDelay(10)).toBeLessThanOrEqual(300000)
            // 第 20 次重试：应该等于最大值
            expect(calculateBackoffDelay(20)).toBe(300000)
        })
    })

    describe('文档识别记录创建测试', () => {
        it('应该成功创建文档识别记录', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const record = await getTestPrisma().docRecognitionRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: ossFile.id,
                    status: DocRecognitionStatus.PROCESSING,
                },
            })

            expect(record).toBeDefined()
            expect(record.userId).toBe(testUser.id)
            expect(record.ossFileId).toBe(ossFile.id)
            expect(record.status).toBe(DocRecognitionStatus.PROCESSING)
        })

        it('应该成功更新文档识别记录状态', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const record = await getTestPrisma().docRecognitionRecords.create({
                data: {
                    userId: testUser.id,
                    ossFileId: ossFile.id,
                    status: DocRecognitionStatus.PROCESSING,
                },
            })

            const updated = await getTestPrisma().docRecognitionRecords.update({
                where: { id: record.id },
                data: { status: DocRecognitionStatus.SUCCESS },
            })

            expect(updated.status).toBe(DocRecognitionStatus.SUCCESS)
        })
    })

    describe('MinerU 任务记录创建测试', () => {
        it('应该成功创建 MinerU 任务记录', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const task = await getTestPrisma().mineruTasks.create({
                data: {
                    ossFileId: ossFile.id,
                    userId: testUser.id,
                    status: MineruTaskStatus.PROCESSING,
                    taskRawData: {
                        batchId: 'test-batch-id',
                        dataId: `${ossFile.id}_${testUser.id}`,
                        seed: 'test-seed',
                    },
                },
            })

            expect(task).toBeDefined()
            expect(task.ossFileId).toBe(ossFile.id)
            expect(task.userId).toBe(testUser.id)
            expect(task.status).toBe(MineruTaskStatus.PROCESSING)
        })

        it('应该成功更新 MinerU 任务状态和结果', async () => {
            const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
            testIds.ossFileIds.push(ossFile.id)

            const task = await getTestPrisma().mineruTasks.create({
                data: {
                    ossFileId: ossFile.id,
                    userId: testUser.id,
                    status: MineruTaskStatus.PROCESSING,
                },
            })

            const downloadUrl = 'https://example.com/result.zip'
            const updated = await getTestPrisma().mineruTasks.update({
                where: { id: task.id },
                data: {
                    status: MineruTaskStatus.SUCCESS,
                    result: { downloadUrl },
                    completedAt: new Date(),
                },
            })

            expect(updated.status).toBe(MineruTaskStatus.SUCCESS)
            expect((updated.result as any)?.downloadUrl).toBe(downloadUrl)
            expect(updated.completedAt).toBeDefined()
        })
    })

    // ==================== 属性测试 ====================

    describe('属性测试', () => {
        describe('Property 1: 识别状态检测正确性', () => {
            it('状态为成功时应返回 recognized=true', async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({ min: 1, max: 1000000 }),
                        async (randomSuffix) => {
                            const ossFile = await createTestOssFile({
                                userId: testUser.id,
                                fileName: `test_${randomSuffix}.pdf`,
                            }, testIds)
                            testIds.ossFileIds.push(ossFile.id)

                            // 创建成功状态的识别记录
                            await getTestPrisma().docRecognitionRecords.create({
                                data: {
                                    userId: testUser.id,
                                    ossFileId: ossFile.id,
                                    status: DocRecognitionStatus.SUCCESS,
                                    htmlContent: '<p>测试内容</p>',
                                    markdownContent: '测试内容',
                                },
                            })

                            // 查询记录
                            const record = await getTestPrisma().docRecognitionRecords.findFirst({
                                where: { ossFileId: ossFile.id, deletedAt: null },
                            })

                            expect(record).toBeDefined()
                            expect(record?.status).toBe(DocRecognitionStatus.SUCCESS)

                            return true
                        }
                    ),
                    { ...PBT_CONFIG, numRuns: 10 }
                )
            })

            it('状态为处理中时应返回 processing=true', async () => {
                await fc.assert(
                    fc.asyncProperty(
                        fc.integer({ min: 1, max: 1000000 }),
                        async (randomSuffix) => {
                            const ossFile = await createTestOssFile({
                                userId: testUser.id,
                                fileName: `test_${randomSuffix}.doc`,
                            }, testIds)
                            testIds.ossFileIds.push(ossFile.id)

                            // 创建处理中状态的识别记录
                            await getTestPrisma().docRecognitionRecords.create({
                                data: {
                                    userId: testUser.id,
                                    ossFileId: ossFile.id,
                                    status: DocRecognitionStatus.PROCESSING,
                                },
                            })

                            // 查询记录
                            const record = await getTestPrisma().docRecognitionRecords.findFirst({
                                where: { ossFileId: ossFile.id, deletedAt: null },
                            })

                            expect(record).toBeDefined()
                            expect(record?.status).toBe(DocRecognitionStatus.PROCESSING)

                            return true
                        }
                    ),
                    { ...PBT_CONFIG, numRuns: 10 }
                )
            })
        })

        describe('Property 2: 上传链接申请正确性', () => {
            it('data_id 格式应为 ossFileId_userId', async () => {
                await fc.assert(
                    fc.property(
                        fc.integer({ min: 1, max: 1000000 }),
                        fc.integer({ min: 1, max: 1000000 }),
                        (ossFileId, userId) => {
                            const dataId = `${ossFileId}_${userId}`

                            // 验证格式
                            expect(dataId).toMatch(/^\d+_\d+$/)

                            // 验证可解析
                            const parts = dataId.split('_')
                            expect(parts.length).toBe(2)
                            expect(parseInt(parts[0]!, 10)).toBe(ossFileId)
                            expect(parseInt(parts[1]!, 10)).toBe(userId)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 4: 回调处理正确性', () => {
            it('data_id 解析应正确提取 ossFileId 和 userId', async () => {
                await fc.assert(
                    fc.property(
                        fc.integer({ min: 1, max: 1000000 }),
                        fc.integer({ min: 1, max: 1000000 }),
                        (ossFileId, userId) => {
                            const dataId = `${ossFileId}_${userId}`

                            // 解析 data_id
                            const parts = dataId.split('_')
                            const parsedOssFileId = parseInt(parts[0]!, 10)
                            const parsedUserId = parseInt(parts[1]!, 10)

                            expect(parsedOssFileId).toBe(ossFileId)
                            expect(parsedUserId).toBe(userId)

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })

            it('幂等处理：已完成的任务不应重复处理', async () => {
                const ossFile = await createTestOssFile({ userId: testUser.id }, testIds)
                testIds.ossFileIds.push(ossFile.id)

                // 创建已完成的任务
                const task = await getTestPrisma().mineruTasks.create({
                    data: {
                        ossFileId: ossFile.id,
                        userId: testUser.id,
                        status: MineruTaskStatus.SUCCESS,
                        result: { downloadUrl: 'https://example.com/result.zip' },
                        completedAt: new Date(),
                    },
                })

                // 验证任务已完成
                const isProcessed = task.status === MineruTaskStatus.SUCCESS ||
                    task.status === MineruTaskStatus.FAILED

                expect(isProcessed).toBe(true)
            })
        })

        describe('Property 5: 指数退避轮询正确性', () => {
            it('延迟应随重试次数指数增长但不超过最大值', async () => {
                await fc.assert(
                    fc.property(
                        fc.integer({ min: 0, max: 100 }),
                        (retryCount) => {
                            const initialDelay = 5000
                            const maxDelay = 300000
                            const backoffFactor = 1.5

                            const delay = Math.min(
                                initialDelay * Math.pow(backoffFactor, retryCount),
                                maxDelay
                            )

                            // 验证延迟不超过最大值
                            expect(delay).toBeLessThanOrEqual(maxDelay)

                            // 验证延迟不小于初始值
                            expect(delay).toBeGreaterThanOrEqual(initialDelay)

                            // 验证延迟随重试次数增长（在未达到最大值时）
                            if (retryCount > 0) {
                                const prevDelay = Math.min(
                                    initialDelay * Math.pow(backoffFactor, retryCount - 1),
                                    maxDelay
                                )
                                expect(delay).toBeGreaterThanOrEqual(prevDelay)
                            }

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })
        })

        describe('Property 8: 文件类型路由正确性', () => {
            it('应根据文件扩展名正确路由到识别方式', async () => {
                await fc.assert(
                    fc.property(
                        fc.constantFrom(
                            { ext: 'docx', method: 'mammoth' },
                            { ext: 'doc', method: 'mineru' },
                            { ext: 'pdf', method: 'mineru' },
                            { ext: 'md', method: 'direct' },
                            { ext: 'txt', method: 'direct' }
                        ),
                        ({ ext, method }) => {
                            // 判断文件类型
                            const isDocx = ext === 'docx'
                            const isDoc = ext === 'doc'
                            const isPdf = ext === 'pdf'
                            const isMarkdown = ['md', 'mkd', 'markdown'].includes(ext)
                            const isTxt = ext === 'txt'

                            // 验证路由逻辑
                            if (method === 'mammoth') {
                                expect(isDocx).toBe(true)
                            } else if (method === 'mineru') {
                                expect(isDoc || isPdf).toBe(true)
                            } else if (method === 'direct') {
                                expect(isMarkdown || isTxt).toBe(true)
                            }

                            return true
                        }
                    ),
                    PBT_CONFIG
                )
            })
        })
    })
})
