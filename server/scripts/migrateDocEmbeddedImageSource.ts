/**
 * 一次性数据修复：把存量"文档识别提取的内嵌图片"在 ossFiles 表里的 source
 * 从 caseAnalysis 改为 doc_embedded_image，从案件材料弹框的可选范围里剥离。
 *
 * 背景：mineruResult / mineru / imageProcessor 三处历史上把 MinerU 解压出的
 * 内嵌图片以 source=caseAnalysis 落库，导致它们和用户实际上传的案件材料混在
 * 一起出现在"选择案情材料"弹框。代码侧已经统一改用新增的
 * FileSource.DOC_EMBEDDED_IMAGE，本脚本负责把存量数据收敛过来。
 *
 * 识别规则（满足任意一条即视为内嵌图片）：
 *   - source='caseAnalysis' AND fileType LIKE 'image/%' AND fileName ~ '_mineru_'
 *     → mineruResult.service.ts 的 ${prefix}_mineru_${i+1}.${ext}
 *   - source='caseAnalysis' AND fileType LIKE 'image/%' AND fileName ~ '_image_'
 *     → imageProcessor.ts 的 ${docFileName}_image_${Date.now()}.${ext}
 *   - source='caseAnalysis' AND fileType LIKE 'image/%' AND filePath ~ '^mineru/'
 *     → mineru.service.ts 的 mineru/${taskId}/${uuidv4}.${ext}
 *
 * 为什么走 server/scripts/ 而不是 prisma migration：
 *   ossFiles.source 是 String? 字段，新增枚举值不涉及 schema 变更；
 *   项目铁律禁止手写 SQL 进 prisma/migrations/，存量数据修正属于维护脚本范畴
 *   （与 migrateGlobalTemplateOwnership.ts / migrateFillingDrafts.ts 同模式）。
 *
 * 用法：`npx tsx server/scripts/migrateDocEmbeddedImageSource.ts`
 */

import { prisma } from '~~/server/utils/db'
import { logger } from '#shared/utils/logger'
import { FileSource } from '#shared/types/file'

async function main() {
    // 1. 捞出所有符合内嵌图片特征的行（命名模式或路径前缀任一匹配）
    const candidates = await prisma.ossFiles.findMany({
        where: {
            source: FileSource.CASE_ANALYSIS,
            fileType: { startsWith: 'image/' },
            OR: [
                { fileName: { contains: '_mineru_' } },
                { fileName: { contains: '_image_' } },
                { filePath: { startsWith: 'mineru/' } },
            ],
        },
        select: { id: true, fileName: true, filePath: true, fileType: true, userId: true },
    })

    if (candidates.length === 0) {
        logger.info('[migrate-doc-embedded-image-source] 没有符合条件的存量内嵌图片，跳过')
        return
    }

    logger.info('[migrate-doc-embedded-image-source] 待迁移记录数:', {
        count: candidates.length,
        sample: candidates.slice(0, 5).map(c => ({
            id: c.id,
            fileName: c.fileName,
            filePath: c.filePath,
        })),
        affectedUserIds: [...new Set(candidates.map(c => c.userId).filter((v): v is number => v != null))].length,
    })

    // 2. 批量改 source（幂等：只更新仍是 caseAnalysis 的行）
    const result = await prisma.ossFiles.updateMany({
        where: {
            id: { in: candidates.map(c => c.id) },
            source: FileSource.CASE_ANALYSIS,
        },
        data: { source: FileSource.DOC_EMBEDDED_IMAGE },
    })

    logger.info('[migrate-doc-embedded-image-source] 完成', {
        scanned: candidates.length,
        updated: result.count,
        skipped: candidates.length - result.count,
    })
}

main()
    .catch((err) => {
        logger.error('[migrate-doc-embedded-image-source] 失败', { err })
        process.exit(1)
    })
    .finally(() => process.exit(0))
