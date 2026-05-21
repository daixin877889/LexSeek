/**
 * 一次性数据修复：把存量全局文书模板对应的 ossFile.userId 置 NULL，
 * 完成"系统级文件"从管理员私有云盘剥离。
 *
 * 范围筛选：
 *   关联的 documentTemplates.scope = 'global'
 *   AND ossFile.source = 'documentTemplate'
 *   AND ossFile.userId IS NOT NULL（同时承担幂等保护：已置空的记录再次执行不会被命中）
 *
 * 不限定 deletedAt：软删除记录虽不影响显示和配额，但顺手搬掉保持数据一致。
 *
 * 为什么走 server/scripts/ 而不是 prisma/seeds/seedData.sql：
 *   seedData.sql 是"新环境初始化的全量种子快照"，按项目规则只允许 INSERT INTO，
 *   且不包含 ossFiles 这类用户运行时数据。本次是已上线环境的存量数据一次性修正，
 *   属于维护脚本范畴（与 migrateFillingDrafts.ts / rebuildLawEmbeddings.ts 同模式）。
 *
 * 用法：`npx tsx server/scripts/migrateGlobalTemplateOwnership.ts`
 */

import { prisma } from '~~/server/utils/db'
import { logger } from '#shared/utils/logger'
import { FileSource } from '#shared/types/file'

async function main() {
    // documentTemplates.ossFileId 是普通 Int 字段（无 @relation 反向关系），
    // 分两步：先取全局模板的 ossFileId 列表，再按这批 id 过滤 ossFiles 做 update。

    // 1. 拿出所有 scope='global' 模板对应的 ossFileId
    const globalTemplates = await prisma.documentTemplates.findMany({
        where: { scope: 'global' },
        select: { id: true, ossFileId: true },
    })

    if (globalTemplates.length === 0) {
        logger.info('[migrate-global-template-ownership] 没有 scope=global 的模板，跳过')
        return
    }

    const ossFileIds = globalTemplates.map(t => t.ossFileId)

    // 2. 找出对应 ossFile 中"还有归属"的行（幂等保护）
    const targets = await prisma.ossFiles.findMany({
        where: {
            id: { in: ossFileIds },
            source: FileSource.DOCUMENT_TEMPLATE,
            userId: { not: null },
        },
        select: { id: true, userId: true, fileName: true },
    })

    if (targets.length === 0) {
        logger.info('[migrate-global-template-ownership] 所有全局模板对应的 ossFile.userId 已剥离，无需迁移')
        return
    }

    logger.info('[migrate-global-template-ownership] 待迁移记录数:', {
        count: targets.length,
        sampleOssFileIds: targets.slice(0, 5).map(t => t.id),
        affectedUserIds: [...new Set(targets.map(t => t.userId).filter((v): v is number => v != null))],
    })

    // 3. 把 ossFile.userId 置为 NULL
    const result = await prisma.ossFiles.updateMany({
        where: { id: { in: targets.map(t => t.id) }, userId: { not: null } },
        data: { userId: null },
    })

    logger.info('[migrate-global-template-ownership] 完成', {
        scanned: targets.length,
        updated: result.count,
        skipped: targets.length - result.count,
    })
}

main()
    .catch((err) => {
        logger.error('[migrate-global-template-ownership] 失败', { err })
        process.exit(1)
    })
    .finally(() => process.exit(0))
