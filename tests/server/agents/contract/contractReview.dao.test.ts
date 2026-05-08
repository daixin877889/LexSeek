/**
 * contractReview.dao 补充单元测试（覆盖 stage 8 缺失部分）
 *
 * 现有测试（tests/server/assistant/contract/contractReview.dao.test.ts）只覆盖基础 4 CRUD。
 * 本文件补充：
 * - softDeleteContractReviewDAO：软删字段 / 列表过滤
 * - PatchReviewRisksUnknownIdsError：异常对象字段
 * - patchReviewRisksDAO：未迁移走 legacy / 已迁移走三向 diff（keep + new + removed）
 * - atomicSetRebuildingDAO：原子占位 / 已被占用 / 软删行不能占位
 * - setCompletedAfterRebuildDAO：rebuilding 转 completed / 状态错误抛错
 * - rollbackRebuildDAO：rebuilding 回 completed / 非 rebuilding 幂等
 * - listUserReviewsDAO：基础列表 / status 过滤 / caseId 过滤 / q 关键词命中 / q 无命中
 * - listAdminReviewsDAO：跨用户列表 / userId 过滤 / includeDeleted / q 命中
 * - getAdminReviewDAO：含 user 关联 / 软删可见 / 含 reviewedFile
 * - findReviewingTimeoutDAO：返回超时 id 列表
 * - softDeleteAdminReviewDAO：deleted / already_deleted / not_found
 *
 * **Validates: 阶段 8 测试覆盖率提升**
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createContractReviewDAO,
    softDeleteContractReviewDAO,
    PatchReviewRisksUnknownIdsError,
    patchReviewRisksDAO,
    atomicSetRebuildingDAO,
    setCompletedAfterRebuildDAO,
    rollbackRebuildDAO,
    listUserReviewsDAO,
    listAdminReviewsDAO,
    getAdminReviewDAO,
    findReviewingTimeoutDAO,
    softDeleteAdminReviewDAO,
} from '~~/server/agents/contract/contractReview.dao'
import { createContractRiskDAO } from '~~/server/agents/contract/contractRisk.dao'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { ensureTestUser } from '../../assistant/test-db-helper'
import { OssFileStatus } from '#shared/types/file'

describe('contractReview.dao（补充覆盖）', () => {
    let userId: number
    const createdReviewIds: number[] = []
    const createdOssFileIds: number[] = []

    beforeEach(async () => {
        userId = await ensureTestUser()
    })

    afterEach(async () => {
        if (createdReviewIds.length > 0) {
            await prisma.contractAnnotations.deleteMany({ where: { reviewId: { in: createdReviewIds } } })
            await prisma.contractRisks.deleteMany({ where: { reviewId: { in: createdReviewIds } } })
            await prisma.contractReviewVersions.deleteMany({ where: { reviewId: { in: createdReviewIds } } })
            await prisma.contractReviews.deleteMany({ where: { id: { in: createdReviewIds } } })
            createdReviewIds.length = 0
        }
        if (createdOssFileIds.length > 0) {
            await prisma.ossFiles.deleteMany({ where: { id: { in: createdOssFileIds } } })
            createdOssFileIds.length = 0
        }
        await prisma.users.deleteMany({ where: { id: userId } })
    })

    /** 创建一个干净的 review 行 */
    async function makeReview(overrides: Record<string, any> = {}) {
        const row = await createContractReviewDAO({
            userId,
            sessionId: `t-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            originalFileId: 0,
            status: 'completed',
            ...overrides,
        })
        createdReviewIds.push(row.id)
        return row
    }

    /** 建一个假的 OSS 文件用于 list 测试 */
    async function makeOssFile(fileName: string) {
        const f = await createOssFileDao({
            userId,
            bucketName: 'b',
            fileName,
            filePath: `p/${Date.now()}-${Math.random().toString(36).slice(2)}.docx`,
            fileSize: 100,
            fileType: 'application/octet-stream',
            status: OssFileStatus.UPLOADED,
        })
        createdOssFileIds.push(f.id)
        return f
    }

    describe('softDeleteContractReviewDAO', () => {
        it('设置 deletedAt 为当前时间', async () => {
            const r = await makeReview()
            const deleted = await softDeleteContractReviewDAO(r.id)
            expect(deleted.deletedAt).not.toBeNull()
        })
    })

    describe('PatchReviewRisksUnknownIdsError', () => {
        it('错误对象含 unknownIds + name', () => {
            const err = new PatchReviewRisksUnknownIdsError(['1', 'foo'])
            expect(err.name).toBe('PatchReviewRisksUnknownIdsError')
            expect(err.unknownIds).toEqual(['1', 'foo'])
            expect(err.message).toContain('1')
            expect(err.message).toContain('foo')
        })
    })

    describe('patchReviewRisksDAO', () => {
        it('未迁移 review（currentVersionId=null）只写 legacy JSON，不抛 unknown', async () => {
            const r = await makeReview({ currentVersionId: null })
            // 即使 body 含 id 完全不存在的 risk，未迁移 review 也接受（写 legacy JSON）
            const result = await patchReviewRisksDAO(r.id, [
                { id: '999', level: 'low', category: 'x', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x', clauseIndex: 1, clauseText: '' } as any,
            ])
            expect(result.id).toBe(r.id)
            expect(result.hasUnsavedDocxChanges).toBe(true)
        })

        it('已迁移 review，body 全是已知 id → keep 路径更新所有字段', async () => {
            const r = await makeReview()
            const risk = await createContractRiskDAO({
                reviewId: r.id, source: 'ai', category: '原',
                level: 'medium', stance: 'balanced',
                problem: '原 problem', anchorQuote: '原 anchor',
            })
            // 模拟已迁移
            await prisma.contractReviews.update({
                where: { id: r.id },
                data: { currentVersionId: 999999 }, // 占位（实际值不重要，DAO 不查）
            })
            // 但这会因为 FK 失败……改用真版本
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId: r.id, versionNumber: 1, systemLabel: 'lawyer_save',
                    snapshotData: {}, createdById: userId,
                },
            })
            await prisma.contractReviews.update({
                where: { id: r.id },
                data: { currentVersionId: v.id },
            })

            const updated = await patchReviewRisksDAO(r.id, [
                {
                    id: String(risk.id),
                    level: 'high', category: '新分类', problem: '新 problem',
                    analysis: '新分析', risk: '风险', suggestion: '新建议',
                    legalBasis: '新法条',
                    clauseIndex: 0, clauseText: 'x',
                } as any,
            ])
            expect(updated.id).toBe(r.id)
            // DB 应已更新
            const after = await prisma.contractRisks.findUnique({ where: { id: risk.id } })
            expect(after?.level).toBe('high')
            expect(after?.category).toBe('新分类')
            expect(after?.problem).toBe('新 problem')
            expect(after?.legalBasis).toBe('新法条')
        })

        it('已迁移 review，body 含未知 id → 抛 PatchReviewRisksUnknownIdsError', async () => {
            const r = await makeReview()
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId: r.id, versionNumber: 1, systemLabel: 'lawyer_save',
                    snapshotData: {}, createdById: userId,
                },
            })
            await prisma.contractReviews.update({
                where: { id: r.id },
                data: { currentVersionId: v.id },
            })

            await expect(
                patchReviewRisksDAO(r.id, [
                    { id: '99999999', level: 'low', category: 'x', problem: 'x', analysis: 'x', risk: 'x', suggestion: 'x', clauseIndex: 0, clauseText: '' } as any,
                ]),
            ).rejects.toThrow(PatchReviewRisksUnknownIdsError)
        })

        it('已迁移 review，body 漏了某个已知 risk → removed 走 archivedStatus=ignored', async () => {
            const r = await makeReview()
            const risk1 = await createContractRiskDAO({
                reviewId: r.id, source: 'ai', category: 'a',
                level: 'medium', stance: 'balanced', problem: 'p1', anchorQuote: 'q1',
            })
            const risk2 = await createContractRiskDAO({
                reviewId: r.id, source: 'ai', category: 'b',
                level: 'low', stance: 'balanced', problem: 'p2', anchorQuote: 'q2',
            })
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId: r.id, versionNumber: 1, systemLabel: 'lawyer_save',
                    snapshotData: {}, createdById: userId,
                },
            })
            await prisma.contractReviews.update({
                where: { id: r.id },
                data: { currentVersionId: v.id },
            })

            // body 只含 risk1，不含 risk2 → risk2 被 removed
            await patchReviewRisksDAO(r.id, [
                { id: String(risk1.id), level: 'high', category: 'a-new', problem: 'p1-new', analysis: '', risk: '', suggestion: '', clauseIndex: 0, clauseText: '' } as any,
            ])

            const after2 = await prisma.contractRisks.findUnique({ where: { id: risk2.id } })
            expect(after2?.archivedStatus).toBe('ignored')
            expect(after2?.archivedAt).not.toBeNull()
        })
    })

    describe('atomicSetRebuildingDAO', () => {
        it('completed 状态可占位 → true', async () => {
            const r = await makeReview({ status: 'completed' })
            const ok = await atomicSetRebuildingDAO(r.id)
            expect(ok).toBe(true)
            const after = await prisma.contractReviews.findUnique({ where: { id: r.id } })
            expect(after?.status).toBe('rebuilding')
        })

        it('reviewing 状态不能占位 → false', async () => {
            const r = await makeReview({ status: 'reviewing' })
            const ok = await atomicSetRebuildingDAO(r.id)
            expect(ok).toBe(false)
        })

        it('已软删行不能占位 → false', async () => {
            const r = await makeReview({ status: 'completed' })
            await prisma.contractReviews.update({
                where: { id: r.id }, data: { deletedAt: new Date() },
            })
            const ok = await atomicSetRebuildingDAO(r.id)
            expect(ok).toBe(false)
        })

        it('不存在 → false', async () => {
            const ok = await atomicSetRebuildingDAO(99999999)
            expect(ok).toBe(false)
        })
    })

    describe('setCompletedAfterRebuildDAO', () => {
        it('rebuilding 状态可写入 completed + reviewedFileId', async () => {
            const r = await makeReview({ status: 'rebuilding' })
            await setCompletedAfterRebuildDAO(r.id, 12345)
            const after = await prisma.contractReviews.findUnique({ where: { id: r.id } })
            expect(after?.status).toBe('completed')
            expect(after?.reviewedFileId).toBe(12345)
            expect(after?.hasUnsavedDocxChanges).toBe(false)
        })

        it('非 rebuilding 状态抛错', async () => {
            const r = await makeReview({ status: 'completed' })
            await expect(setCompletedAfterRebuildDAO(r.id, 12345)).rejects.toThrow(
                /不在 rebuilding 状态或已被软删/,
            )
        })

        it('已软删行抛错', async () => {
            const r = await makeReview({ status: 'rebuilding' })
            await prisma.contractReviews.update({
                where: { id: r.id }, data: { deletedAt: new Date() },
            })
            await expect(setCompletedAfterRebuildDAO(r.id, 12345)).rejects.toThrow()
        })
    })

    describe('rollbackRebuildDAO', () => {
        it('rebuilding 回滚到 completed', async () => {
            const r = await makeReview({ status: 'rebuilding' })
            await rollbackRebuildDAO(r.id)
            const after = await prisma.contractReviews.findUnique({ where: { id: r.id } })
            expect(after?.status).toBe('completed')
        })

        it('非 rebuilding 状态幂等不变', async () => {
            const r = await makeReview({ status: 'failed' })
            await rollbackRebuildDAO(r.id)
            const after = await prisma.contractReviews.findUnique({ where: { id: r.id } })
            expect(after?.status).toBe('failed')
        })
    })

    describe('listUserReviewsDAO', () => {
        it('基础列表：按 createdAt 降序 + total + 含 fileName', async () => {
            const f1 = await makeOssFile('合同 A.docx')
            const f2 = await makeOssFile('合同 B.docx')
            await makeReview({ originalFileId: f1.id })
            await new Promise(r => setTimeout(r, 10)) // 保证 createdAt 顺序
            await makeReview({ originalFileId: f2.id })

            const r = await listUserReviewsDAO({ userId, skip: 0, take: 10 })
            expect(r.total).toBe(2)
            expect(r.items).toHaveLength(2)
            // 第 1 条应是 f2（更新的）
            expect(r.items[0]?.originalFileName).toBe('合同 B.docx')
        })

        it('status 精确过滤', async () => {
            const f = await makeOssFile('x.docx')
            await makeReview({ originalFileId: f.id, status: 'completed' })
            await makeReview({ originalFileId: f.id, status: 'reviewing' })
            const r = await listUserReviewsDAO({ userId, skip: 0, take: 10, status: 'completed' })
            expect(r.total).toBe(1)
            expect(r.items[0]?.status).toBe('completed')
        })

        it('caseId 过滤', async () => {
            // 建一条 caseType + case 满足 FK
            const caseType = await prisma.caseTypes.create({
                data: { name: `测试类型_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, priority: 999, status: 1 },
            })
            const realCase = await prisma.cases.create({
                data: {
                    userId,
                    title: `测试案件_${Date.now()}`,
                    caseTypeId: caseType.id,
                    status: 1,
                },
            })
            try {
                const f = await makeOssFile('x.docx')
                await makeReview({ originalFileId: f.id, caseId: null })
                await makeReview({ originalFileId: f.id, caseId: realCase.id })
                const r = await listUserReviewsDAO({ userId, skip: 0, take: 10, caseId: realCase.id })
                expect(r.total).toBe(1)
                expect(r.items[0]?.caseId).toBe(realCase.id)
            } finally {
                await prisma.contractReviews.deleteMany({ where: { caseId: realCase.id } })
                await prisma.cases.delete({ where: { id: realCase.id } })
                await prisma.caseTypes.delete({ where: { id: caseType.id } })
            }
        })

        it('q 关键词命中文件名（大小写不敏感）', async () => {
            const f1 = await makeOssFile('Apple Contract.docx')
            const f2 = await makeOssFile('Banana Contract.docx')
            await makeReview({ originalFileId: f1.id })
            await makeReview({ originalFileId: f2.id })
            const r = await listUserReviewsDAO({ userId, skip: 0, take: 10, q: 'apple' })
            expect(r.total).toBe(1)
            expect(r.items[0]?.originalFileName).toBe('Apple Contract.docx')
        })

        it('q 关键词无命中 → 空列表 total=0', async () => {
            const r = await listUserReviewsDAO({ userId, skip: 0, take: 10, q: 'never-exist-keyword' })
            expect(r.total).toBe(0)
            expect(r.items).toEqual([])
        })

        it('summary 是 ContractOverview JSON → 取 overall 截断', async () => {
            const f = await makeOssFile('x.docx')
            const overall = 'X'.repeat(200)
            await makeReview({
                originalFileId: f.id,
                summary: { overall, highlights: [] } as any,
            })
            const r = await listUserReviewsDAO({ userId, skip: 0, take: 10 })
            expect(r.items[0]?.summary?.length).toBeLessThanOrEqual(120)
        })

        it('summary 是字符串 → 直接截断', async () => {
            const f = await makeOssFile('x.docx')
            await makeReview({ originalFileId: f.id, summary: 'A'.repeat(200) as any })
            const r = await listUserReviewsDAO({ userId, skip: 0, take: 10 })
            expect(r.items[0]?.summary?.length).toBeLessThanOrEqual(120)
        })

        it('summary 为 null → null', async () => {
            const f = await makeOssFile('x.docx')
            await makeReview({ originalFileId: f.id, summary: null as any })
            const r = await listUserReviewsDAO({ userId, skip: 0, take: 10 })
            expect(r.items[0]?.summary).toBeNull()
        })

        it('已迁移 review → 风险计数走 contractRisks 表 groupBy', async () => {
            const f = await makeOssFile('x.docx')
            const r = await makeReview({ originalFileId: f.id })
            const v = await prisma.contractReviewVersions.create({
                data: {
                    reviewId: r.id, versionNumber: 1, systemLabel: 'lawyer_save',
                    snapshotData: {}, createdById: userId,
                },
            })
            await prisma.contractReviews.update({
                where: { id: r.id }, data: { currentVersionId: v.id },
            })
            await createContractRiskDAO({
                reviewId: r.id, source: 'ai', category: 'x',
                level: 'high', stance: 'balanced', problem: 'p', anchorQuote: 'q',
            })
            await createContractRiskDAO({
                reviewId: r.id, source: 'ai', category: 'x',
                level: 'medium', stance: 'balanced', problem: 'p2', anchorQuote: 'q2',
            })
            // archived 不计入
            const archived = await createContractRiskDAO({
                reviewId: r.id, source: 'ai', category: 'x',
                level: 'high', stance: 'balanced', problem: 'p3', anchorQuote: 'q3',
            })
            await prisma.contractRisks.update({
                where: { id: archived.id },
                data: { archivedStatus: 'ignored', archivedAt: new Date() },
            })
            const list = await listUserReviewsDAO({ userId, skip: 0, take: 10 })
            const item = list.items.find(i => i.id === r.id)
            expect(item?.highRiskCount).toBe(1)
            expect(item?.mediumRiskCount).toBe(1)
            expect(item?.totalRiskCount).toBe(2)
        })

        it('未迁移 review → 风险计数走 legacy JSON', async () => {
            const f = await makeOssFile('x.docx')
            const legacyRisks = [
                { id: '1', level: 'high', category: 'x', problem: 'p', clauseIndex: 0, clauseText: '', risk: '', analysis: '', suggestion: '' },
                { id: '2', level: 'low', category: 'x', problem: 'p', clauseIndex: 0, clauseText: '', risk: '', analysis: '', suggestion: '' },
            ]
            await makeReview({ originalFileId: f.id, risks: legacyRisks as any })
            const list = await listUserReviewsDAO({ userId, skip: 0, take: 10 })
            const item = list.items[0]!
            expect(item.totalRiskCount).toBe(2)
            expect(item.highRiskCount).toBe(1)
        })
    })

    describe('listAdminReviewsDAO', () => {
        it('跨用户列表 + 含 user.phone / user.name', async () => {
            const f = await makeOssFile('admin-test.docx')
            await makeReview({ originalFileId: f.id })
            const r = await listAdminReviewsDAO({ skip: 0, take: 10, userId })
            expect(r.total).toBeGreaterThanOrEqual(1)
            const item = r.items.find(i => i.userId === userId)
            expect(item?.userPhone).toBeTruthy()
        })

        it('includeDeleted=false（默认）过滤软删', async () => {
            const f = await makeOssFile('x.docx')
            const r = await makeReview({ originalFileId: f.id })
            await prisma.contractReviews.update({
                where: { id: r.id }, data: { deletedAt: new Date() },
            })
            const list = await listAdminReviewsDAO({ skip: 0, take: 10, userId })
            const found = list.items.find(i => i.id === r.id)
            expect(found).toBeUndefined()
        })

        it('includeDeleted=true 包含软删', async () => {
            const f = await makeOssFile('x.docx')
            const r = await makeReview({ originalFileId: f.id })
            await prisma.contractReviews.update({
                where: { id: r.id }, data: { deletedAt: new Date() },
            })
            const list = await listAdminReviewsDAO({ skip: 0, take: 10, userId, includeDeleted: true })
            const found = list.items.find(i => i.id === r.id)
            expect(found).toBeDefined()
            expect(found?.deletedAt).not.toBeNull()
        })

        it('q 关键词跨用户命中', async () => {
            const f = await makeOssFile('admin-search-keyword.docx')
            await makeReview({ originalFileId: f.id })
            const r = await listAdminReviewsDAO({ skip: 0, take: 10, q: 'admin-search-keyword' })
            expect(r.total).toBeGreaterThanOrEqual(1)
        })

        it('q 关键词无命中 → 空列表', async () => {
            const r = await listAdminReviewsDAO({ skip: 0, take: 10, q: 'no-such-admin-keyword-xxx' })
            expect(r.total).toBe(0)
            expect(r.items).toEqual([])
        })

        it('status 过滤', async () => {
            const f = await makeOssFile('x.docx')
            await makeReview({ originalFileId: f.id, status: 'failed' })
            const r = await listAdminReviewsDAO({ skip: 0, take: 10, userId, status: 'failed' })
            expect(r.items.every(i => i.status === 'failed')).toBe(true)
        })
    })

    describe('getAdminReviewDAO', () => {
        it('未知 id → null', async () => {
            const r = await getAdminReviewDAO(99999999)
            expect(r).toBeNull()
        })

        it('已存在 → 返回完整对象（含 user / fileName）', async () => {
            const f = await makeOssFile('合同.docx')
            const review = await makeReview({ originalFileId: f.id })
            const r = await getAdminReviewDAO(review.id)
            expect(r?.id).toBe(review.id)
            expect(r?.originalFileName).toBe('合同.docx')
            expect(r?.userPhone).toBeTruthy()
        })

        it('reviewedFileId 不为空 → 返回 reviewedFileName', async () => {
            const f1 = await makeOssFile('原.docx')
            const f2 = await makeOssFile('审.docx')
            const review = await makeReview({ originalFileId: f1.id, reviewedFileId: f2.id })
            const r = await getAdminReviewDAO(review.id)
            expect(r?.reviewedFileName).toBe('审.docx')
        })

        it('软删行也可见', async () => {
            const f = await makeOssFile('x.docx')
            const review = await makeReview({ originalFileId: f.id })
            await prisma.contractReviews.update({
                where: { id: review.id }, data: { deletedAt: new Date() },
            })
            const r = await getAdminReviewDAO(review.id)
            expect(r).not.toBeNull()
            expect(r?.deletedAt).not.toBeNull()
        })
    })

    describe('findReviewingTimeoutDAO', () => {
        it('返回超过阈值的 reviewing 状态 review id 列表', async () => {
            const oldReview = await makeReview({ status: 'reviewing' })
            // 强制更新 updatedAt 到 1 小时前
            await prisma.contractReviews.update({
                where: { id: oldReview.id },
                data: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
            })
            const newReview = await makeReview({ status: 'reviewing' })

            const ids = await findReviewingTimeoutDAO(10 * 60 * 1000) // 10 分钟阈值
            expect(ids).toContain(oldReview.id)
            expect(ids).not.toContain(newReview.id)
        })

        it('已软删 reviewing 不返回', async () => {
            const r = await makeReview({ status: 'reviewing' })
            await prisma.contractReviews.update({
                where: { id: r.id },
                data: {
                    updatedAt: new Date(Date.now() - 60 * 60 * 1000),
                    deletedAt: new Date(),
                },
            })
            const ids = await findReviewingTimeoutDAO(10 * 60 * 1000)
            expect(ids).not.toContain(r.id)
        })
    })

    describe('softDeleteAdminReviewDAO', () => {
        it('未存在 → not_found', async () => {
            const r = await softDeleteAdminReviewDAO(99999999)
            expect(r).toEqual({ status: 'not_found' })
        })

        it('happy path：deleted', async () => {
            const review = await makeReview()
            const r = await softDeleteAdminReviewDAO(review.id)
            expect(r).toEqual({ status: 'deleted' })
            const after = await prisma.contractReviews.findUnique({ where: { id: review.id } })
            expect(after?.deletedAt).not.toBeNull()
        })

        it('已软删 → already_deleted（幂等）', async () => {
            const review = await makeReview()
            await prisma.contractReviews.update({
                where: { id: review.id }, data: { deletedAt: new Date() },
            })
            const r = await softDeleteAdminReviewDAO(review.id)
            expect(r).toEqual({ status: 'already_deleted' })
        })
    })
})
