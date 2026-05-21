/**
 * 系统级文件（ossFiles.userId=NULL）回归测试
 *
 * 验证：把全局文书模板等"系统资源"标记为 userId=NULL 后，
 * - ossUsageDao(任意 userId) 不再把它计入配额
 * - findOssFilesByUserIdDao(任意 userId) 不在列表中返回
 * - findOrphanOssFilesDAO 不会把"仍被 documentTemplates 引用的 NULL 归属文件"误判孤儿
 * - 多条 userId=NULL 行可在 UNIQUE 索引下共存（PG 17 默认 NULLS DISTINCT 假设）
 *
 * **Feature: system-files-decouple-from-cloud**
 * **Validates: spec §八 测试 2/3**
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
    createTestUser,
    createTestOssFile,
    cleanupTestData,
    createEmptyTestIds,
    type TestIds,
} from './test-db-helper'
import { prisma } from '~~/server/utils/db'
import {
    ossUsageDao,
    findOssFilesByUserIdDao,
    findOrphanOssFilesDAO,
} from '~~/server/services/files/ossFiles.dao'
import { FileSource, OssFileStatus } from '#shared/types/file'

describe('ossUsageDao / findOssFilesByUserIdDao 对系统级文件（userId=NULL）的处理', () => {
    const testIds: TestIds = createEmptyTestIds()
    const extraTemplateIds: number[] = []

    afterEach(async () => {
        // 叶表先删（documentTemplates 引用 ossFiles）
        if (extraTemplateIds.length > 0) {
            await prisma.documentTemplates.deleteMany({ where: { id: { in: extraTemplateIds } } })
            extraTemplateIds.length = 0
        }
        await cleanupTestData(testIds)
        testIds.userIds.length = 0
        testIds.ossFileIds.length = 0
    })

    /** helper 签名只接受 number，系统级文件（userId=null）需要直接写库 */
    async function makeSystemOssFile(size: number, extra?: { fileName?: string }) {
        const ts = Date.now()
        const rand = Math.random().toString(36).substring(2, 6)
        const row = await prisma.ossFiles.create({
            data: {
                userId: null,
                bucketName: 'test-bucket',
                fileName: extra?.fileName ?? `sys_${ts}_${rand}.docx`,
                filePath: `system/${ts}_${rand}.docx`,
                fileSize: size,
                fileType: 'application/x-docx',
                source: FileSource.DOCUMENT_TEMPLATE,
                status: OssFileStatus.UPLOADED,
                encrypted: false,
            },
        })
        testIds.ossFileIds.push(row.id)
        return row
    }

    it('userId=NULL 的文件不计入任何用户配额', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const privateFile = await createTestOssFile(user.id, { fileSize: 200 })
        testIds.ossFileIds.push(privateFile.id)
        await makeSystemOssFile(1000)

        const usage = await ossUsageDao(user.id)

        expect(usage.fileSize).toBe(200)
        expect(usage.count).toBe(1)
    })

    it('userId=NULL 的文件不出现在任何用户的云盘列表里', async () => {
        const user = await createTestUser()
        testIds.userIds.push(user.id)

        const privateFile = await createTestOssFile(user.id, { fileSize: 100 })
        testIds.ossFileIds.push(privateFile.id)
        await makeSystemOssFile(100)

        const { files, total } = await findOssFilesByUserIdDao(user.id, { page: 1, pageSize: 50 })

        expect(total).toBe(1)
        expect(files).toHaveLength(1)
        expect(files[0]!.id).toBe(privateFile.id)
    })

    it('多条 userId=NULL 行不触发复合唯一索引冲突（PG 17 默认 NULLS DISTINCT 假设）', async () => {
        // 若未来有人给索引加 NULLS NOT DISTINCT，此用例立即失败，提醒回查
        const r1 = await makeSystemOssFile(100, { fileName: `dup_${Date.now()}_1.bin` })
        const r2 = await makeSystemOssFile(100, { fileName: `dup_${Date.now()}_2.bin` })
        expect(r1.id).not.toBe(r2.id)
    })

    it('findOrphanOssFilesDAO 不把"被 documentTemplates 引用的 NULL 文件"误判为孤儿', async () => {
        const sysFile = await makeSystemOssFile(100, { fileName: `tpl_${Date.now()}.docx` })
        const tpl = await prisma.documentTemplates.create({
            data: {
                name: `回归测试_${Date.now()}_${Math.random()}`,
                category: 'litigation',
                scope: 'global',
                userId: null,
                ossFileId: sysFile.id,
                placeholders: [],
                priority: 100,
            },
        })
        extraTemplateIds.push(tpl.id)

        const orphanIds = await findOrphanOssFilesDAO(500)

        expect(orphanIds).not.toContain(sysFile.id)
    })
})
