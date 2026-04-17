/**
 * MinerU 文档识别记录 DAO 层真实数据库覆盖测试
 *
 * 覆盖 server/services/material/mineru.dao.ts 四个导出函数的
 * 成功路径与 catch 分支（通过故障注入触发）。
 *
 * **Feature: mineru-dao-real-coverage**
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { DocRecognitionStatus } from '#shared/types/recognition'
import {
    createDocRecognitionRecordDao,
    findDocRecognitionByOssFileIdDao,
    updateDocRecognitionRecordDao,
    findDocRecognitionsByOssFileIdsDao,
} from '../../../server/services/material/mineru.dao'
import {
    createTestUser,
    createTestOssFile,
} from '../case/test-db-helper'

// vitest.config.ts 中 setupFiles 会挂好 globalThis.prisma
const db: any = (globalThis as any).prisma

// 跟踪创建的资源以便清理
const createdRecordIds: number[] = []
const createdOssFileIds: number[] = []
const createdUserIds: number[] = []

async function createOssFileFixture(): Promise<{ userId: number; ossFileId: number }> {
    const user = await createTestUser()
    createdUserIds.push(user.id)
    const ossFile = await createTestOssFile({ userId: user.id })
    createdOssFileIds.push(ossFile.id)
    return { userId: user.id, ossFileId: ossFile.id }
}

afterAll(async () => {
    // 硬删本轮产生的测试数据
    if (createdRecordIds.length) {
        await db.docRecognitionRecords.deleteMany({ where: { id: { in: createdRecordIds } } })
    }
    if (createdOssFileIds.length) {
        await db.ossFiles.deleteMany({ where: { id: { in: createdOssFileIds } } })
    }
    if (createdUserIds.length) {
        await db.users.deleteMany({ where: { id: { in: createdUserIds } } })
    }
})

afterEach(() => {
    // 不在每个 it 后清理，所有用例共享 afterAll 清理
})

describe('mineru.dao - 真实数据库', () => {
    describe('createDocRecognitionRecordDao', () => {
        it('应使用默认 PENDING 状态创建记录', async () => {
            const { userId, ossFileId } = await createOssFileFixture()

            const record = await createDocRecognitionRecordDao({
                userId,
                ossFileId,
            })
            createdRecordIds.push(record.id)

            expect(record.id).toBeGreaterThan(0)
            expect(record.userId).toBe(userId)
            expect(record.ossFileId).toBe(ossFileId)
            expect(record.status).toBe(DocRecognitionStatus.PENDING)
            expect(record.deletedAt).toBeNull()
        })

        it('应允许传入自定义 status 与 markdownContent / htmlContent', async () => {
            const { userId, ossFileId } = await createOssFileFixture()

            const record = await createDocRecognitionRecordDao({
                userId,
                ossFileId,
                status: DocRecognitionStatus.SUCCESS,
                markdownContent: '# 标题',
                htmlContent: '<h1>标题</h1>',
            })
            createdRecordIds.push(record.id)

            expect(record.status).toBe(DocRecognitionStatus.SUCCESS)
            expect(record.markdownContent).toBe('# 标题')
            expect(record.htmlContent).toBe('<h1>标题</h1>')
        })

        it('应支持事务客户端参数', async () => {
            const { userId, ossFileId } = await createOssFileFixture()

            const record = await db.$transaction(async (tx: any) => {
                return await createDocRecognitionRecordDao(
                    { userId, ossFileId, status: DocRecognitionStatus.PROCESSING },
                    tx,
                )
            })
            createdRecordIds.push(record.id)

            expect(record.status).toBe(DocRecognitionStatus.PROCESSING)
        })

        it('外键不存在应抛错并进入 catch 分支', async () => {
            // userId=0 不存在，会触发外键冲突
            await expect(
                createDocRecognitionRecordDao({ userId: 0, ossFileId: 0 }),
            ).rejects.toThrow()
        })
    })

    describe('findDocRecognitionByOssFileIdDao', () => {
        it('应返回未删除的记录', async () => {
            const { userId, ossFileId } = await createOssFileFixture()
            const created = await createDocRecognitionRecordDao({ userId, ossFileId })
            createdRecordIds.push(created.id)

            const found = await findDocRecognitionByOssFileIdDao(ossFileId)
            expect(found).not.toBeNull()
            expect(found?.id).toBe(created.id)
        })

        it('不存在的 ossFileId 返回 null', async () => {
            const found = await findDocRecognitionByOssFileIdDao(-99999)
            expect(found).toBeNull()
        })

        it('软删除后应返回 null', async () => {
            const { userId, ossFileId } = await createOssFileFixture()
            const created = await createDocRecognitionRecordDao({ userId, ossFileId })
            createdRecordIds.push(created.id)

            // 软删除
            await db.docRecognitionRecords.update({
                where: { id: created.id },
                data: { deletedAt: new Date() },
            })

            const found = await findDocRecognitionByOssFileIdDao(ossFileId)
            expect(found).toBeNull()
        })

        it('故障注入：事务参数查询异常进入 catch 分支', async () => {
            const brokenTx = {
                docRecognitionRecords: {
                    findFirst: async () => {
                        throw new Error('mock find error')
                    },
                },
            } as any
            await expect(
                findDocRecognitionByOssFileIdDao(1, brokenTx),
            ).rejects.toThrow('mock find error')
        })
    })

    describe('updateDocRecognitionRecordDao', () => {
        it('应更新状态与内容字段', async () => {
            const { userId, ossFileId } = await createOssFileFixture()
            const created = await createDocRecognitionRecordDao({ userId, ossFileId })
            createdRecordIds.push(created.id)

            const updated = await updateDocRecognitionRecordDao(created.id, {
                status: DocRecognitionStatus.SUCCESS,
                markdownContent: '更新后内容',
                htmlContent: '<p>更新</p>',
                keywords: ['合同', '违约'],
                summary: '摘要',
                vectorIds: ['v1', 'v2'],
                lastEmbeddingAt: new Date('2026-01-01'),
                lastEditAt: new Date('2026-01-02'),
            })

            expect(updated.id).toBe(created.id)
            expect(updated.status).toBe(DocRecognitionStatus.SUCCESS)
            expect(updated.markdownContent).toBe('更新后内容')
            expect(updated.htmlContent).toBe('<p>更新</p>')
            expect(updated.summary).toBe('摘要')
            expect(updated.lastEmbeddingAt).toBeInstanceOf(Date)
        })

        it('更新不存在的 id 应抛错并进入 catch 分支', async () => {
            await expect(
                updateDocRecognitionRecordDao(-99999, { status: DocRecognitionStatus.FAILED }),
            ).rejects.toThrow()
        })

        it('应支持事务客户端参数', async () => {
            const { userId, ossFileId } = await createOssFileFixture()
            const created = await createDocRecognitionRecordDao({ userId, ossFileId })
            createdRecordIds.push(created.id)

            const updated = await db.$transaction(async (tx: any) => {
                return await updateDocRecognitionRecordDao(
                    created.id,
                    { status: DocRecognitionStatus.PROCESSING },
                    tx,
                )
            })
            expect(updated.status).toBe(DocRecognitionStatus.PROCESSING)
        })
    })

    describe('findDocRecognitionsByOssFileIdsDao', () => {
        it('应批量返回指定 ossFileIds 且未删除的记录', async () => {
            const a = await createOssFileFixture()
            const b = await createOssFileFixture()
            const recA = await createDocRecognitionRecordDao({
                userId: a.userId,
                ossFileId: a.ossFileId,
            })
            const recB = await createDocRecognitionRecordDao({
                userId: b.userId,
                ossFileId: b.ossFileId,
            })
            createdRecordIds.push(recA.id, recB.id)

            const list = await findDocRecognitionsByOssFileIdsDao([
                a.ossFileId,
                b.ossFileId,
            ])
            const ids = list.map((r) => r.id)
            expect(ids).toContain(recA.id)
            expect(ids).toContain(recB.id)
        })

        it('软删除的记录不应出现在结果中', async () => {
            const { userId, ossFileId } = await createOssFileFixture()
            const rec = await createDocRecognitionRecordDao({ userId, ossFileId })
            createdRecordIds.push(rec.id)
            await db.docRecognitionRecords.update({
                where: { id: rec.id },
                data: { deletedAt: new Date() },
            })

            const list = await findDocRecognitionsByOssFileIdsDao([ossFileId])
            expect(list.find((r) => r.id === rec.id)).toBeUndefined()
        })

        it('传入空数组应返回空列表', async () => {
            const list = await findDocRecognitionsByOssFileIdsDao([])
            expect(list).toEqual([])
        })

        it('故障注入：事务参数查询异常进入 catch 分支', async () => {
            const brokenTx = {
                docRecognitionRecords: {
                    findMany: async () => {
                        throw new Error('mock find many error')
                    },
                },
            } as any
            await expect(
                findDocRecognitionsByOssFileIdsDao([1, 2], brokenTx),
            ).rejects.toThrow('mock find many error')
        })
    })
})
