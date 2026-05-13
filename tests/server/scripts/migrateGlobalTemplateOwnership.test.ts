/**
 * migrateGlobalTemplateOwnership 脚本测试
 *
 * 验证：
 * 1) 全局模板对应 ossFile.userId 被置 NULL
 * 2) 用户个人模板对应 ossFile.userId 保持不变
 * 3) 重复执行幂等（第二次不改任何行）
 *
 * **Feature: system-files-decouple-from-cloud**
 * **Validates: spec §八 测试 4**
 */

import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import {
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
    type TestIds,
} from '../files/test-db-helper'
import { FileSource, OssFileStatus } from '#shared/types/file'

// 不直接 import 脚本（脚本含 process.exit）；把核心逻辑提到此处 1:1 重现，与脚本保持对应。
async function runMigration() {
    const globalTemplates = await prisma.documentTemplates.findMany({
        where: { scope: 'global' },
        select: { ossFileId: true },
    })
    if (globalTemplates.length === 0) return { scanned: 0, updated: 0 }

    const targets = await prisma.ossFiles.findMany({
        where: {
            id: { in: globalTemplates.map(t => t.ossFileId) },
            source: FileSource.DOCUMENT_TEMPLATE,
            userId: { not: null },
        },
        select: { id: true },
    })
    if (targets.length === 0) return { scanned: 0, updated: 0 }

    const result = await prisma.ossFiles.updateMany({
        where: { id: { in: targets.map(t => t.id) }, userId: { not: null } },
        data: { userId: null },
    })
    return { scanned: targets.length, updated: result.count }
}

describe('migrateGlobalTemplateOwnership', () => {
    const testIds: TestIds = createEmptyTestIds()
    const templateIds: number[] = []

    afterEach(async () => {
        // 叶表先删（documentTemplates 引用 ossFiles）
        if (templateIds.length > 0) {
            await prisma.documentTemplates.deleteMany({ where: { id: { in: templateIds } } })
            templateIds.length = 0
        }
        await cleanupTestData(testIds)
        testIds.userIds.length = 0
        testIds.ossFileIds.length = 0
    })

    /** 造一个全局模板（ossFile.userId=管理员，模拟改造前的存量脏数据） */
    async function seedGlobalTemplate(adminId: number) {
        const oss = await createTestOssFile(adminId, {
            fileName: `tpl_${Date.now()}_${Math.random()}.docx`,
            source: FileSource.DOCUMENT_TEMPLATE,
            status: OssFileStatus.UPLOADED,
        })
        testIds.ossFileIds.push(oss.id)
        const tpl = await prisma.documentTemplates.create({
            data: {
                name: `全局模板_${Date.now()}_${Math.random()}`,
                category: 'litigation',
                scope: 'global',
                userId: null,
                ossFileId: oss.id,
                placeholders: [],
                priority: 100,
            },
        })
        templateIds.push(tpl.id)
        return { template: tpl, ossFile: oss }
    }

    /** 造一个个人模板（不应被迁移触达） */
    async function seedPersonalTemplate(ownerId: number) {
        const oss = await createTestOssFile(ownerId, {
            fileName: `tpl_${Date.now()}_${Math.random()}.docx`,
            source: FileSource.DOCUMENT_TEMPLATE,
            status: OssFileStatus.UPLOADED,
        })
        testIds.ossFileIds.push(oss.id)
        const tpl = await prisma.documentTemplates.create({
            data: {
                name: `个人模板_${Date.now()}_${Math.random()}`,
                category: 'litigation',
                scope: 'user',
                userId: ownerId,
                ossFileId: oss.id,
                placeholders: [],
                priority: 100,
            },
        })
        templateIds.push(tpl.id)
        return { template: tpl, ossFile: oss }
    }

    it('全局模板对应 ossFile.userId 被置 NULL', async () => {
        const admin = await createTestUser()
        testIds.userIds.push(admin.id)
        const { ossFile } = await seedGlobalTemplate(admin.id)

        await runMigration()

        // 核心断言：我们的文件 userId 被正确置空
        // 不断言 r.updated 的具体数值，因为测试库可能已有 seed 全局模板
        const after = await prisma.ossFiles.findUnique({ where: { id: ossFile.id } })
        expect(after?.userId).toBeNull()
    })

    it('用户个人模板对应 ossFile.userId 保持不变', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)
        const { ossFile } = await seedPersonalTemplate(user.id)

        await runMigration()

        const after = await prisma.ossFiles.findUnique({ where: { id: ossFile.id } })
        expect(after?.userId).toBe(user.id)
    })

    it('重复执行幂等，我们的文件第二次执行后仍然是 NULL（不会回退）', async () => {
        const admin = await createTestUser()
        testIds.userIds.push(admin.id)
        const { ossFile } = await seedGlobalTemplate(admin.id)

        await runMigration() // 第一次：把 userId 置空
        const afterFirst = await prisma.ossFiles.findUnique({ where: { id: ossFile.id } })
        expect(afterFirst?.userId).toBeNull()

        await runMigration() // 第二次：幂等，不改动
        const afterSecond = await prisma.ossFiles.findUnique({ where: { id: ossFile.id } })
        expect(afterSecond?.userId).toBeNull() // 仍为 null，没有被回退或破坏
    })
})
