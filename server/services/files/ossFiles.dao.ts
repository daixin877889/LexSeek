/**
 * OSS 文件数据访问层
 *
 * 封装所有与 OSS 文件表相关的数据库操作
 */
import type { Prisma } from '#shared/types/prisma'
import { FileSortField, FileSource, FileType, OssFileStatus, SortOrder } from '#shared/types/file'
import { FileSizeUnit } from '#shared/types/unitConverision'
import { decimalToNumberUtils } from '#shared/utils/decimalToNumber'
import type { ossFiles } from '~~/generated/prisma/client'

/**
 * 创建 OSS 文件记录
 */
export async function createOssFileDao(ossFile: Prisma.ossFilesCreateInput, tx?: Prisma.TransactionClient): Promise<ossFiles> {
    try {
        // 排除关联字段
        const result = await (tx || prisma).ossFiles.create({
            data: ossFile
        })

        logger.debug(`创建 OSS 文件记录成功:`, result)
        // 确保fileSize是number类型并转换日期字段
        return {
            ...result,
            source: result.source as FileSource,
            fileSize: result.fileSize
        }
    } catch (error) {
        logger.error(`创建 OSS 文件记录失败: ${error}`)
        throw error
    }
}

/**
 * 批量创建 OSS 文件记录
 * @param ossFiles 
 * @returns 
 */
export async function createOssFilesDao(ossFiles: Prisma.ossFilesCreateManyInput[], tx?: Prisma.TransactionClient): Promise<ossFiles[]> {
    try {
        const result = await (tx || prisma).ossFiles.createManyAndReturn({
            data: ossFiles
        })
        return result
    } catch (error) {
        logger.error(`批量创建 OSS 文件记录失败: ${error}`)
        throw error
    }
}

/**
 * 根据文件 ID 查找 OSS 文件记录
 */
export async function findOssFileByIdDao(id: number, tx?: Prisma.TransactionClient): Promise<ossFiles | null> {
    try {
        const result = await (tx || prisma).ossFiles.findFirst({
            where: {
                id: id,
                deletedAt: null
            }
        })

        if (!result) return null;
        return {
            ...result,
            source: result.source as FileSource,
        };
    } catch (error) {
        logger.error(`根据文件ID查找 OSS 文件记录失败: ${error}`)
        throw error
    }
}

/**
 * 根据文件 ID 查找 OSS 文件记录（包含已删除）
 * 用于需要查询所有状态文件的场景，如获取文件元数据
 */
export async function findOssFileByIdIncludeDeletedDao(id: number, tx?: Prisma.TransactionClient): Promise<ossFiles | null> {
    try {
        const result = await (tx || prisma).ossFiles.findUnique({
            where: { id }
        })

        if (!result) return null;
        return {
            ...result,
            source: result.source as FileSource,
        };
    } catch (error) {
        logger.error(`根据文件 ID 查找 OSS 文件记录（包含已删除）失败: ${error}`)
        throw error
    }
}

/**
 * 根据文件 ID 批量查找 OSS 文件记录
 */
export async function findOssFileByIdsDao(id: number[], tx?: Prisma.TransactionClient): Promise<ossFiles[]> {
    try {
        const result = await (tx || prisma).ossFiles.findMany({
            where: {
                id: { in: id },
                deletedAt: null
            }
        })

        return result.map((file: ossFiles) => ({
            ...file,
            source: file.source as FileSource,
        }))
    } catch (error) {
        logger.error(`根据文件 ID 批量查找 OSS 文件记录失败: ${error}`)
        throw error
    }
}

/**
 * 软删除文件记录
 */
export async function deleteFileDao(id: number, tx?: Prisma.TransactionClient): Promise<boolean> {
    try {
        await (tx || prisma).ossFiles.update({
            where: { id, deletedAt: null },
            data: {
                deletedAt: new Date()
            }
        })
        return true
    } catch (error) {
        logger.error(`软删除文件记录失败: ${error}`)
        throw error
    }
}

/**
 * 
 * @param ossFiles 批量软删除文件记录
 * @param tx 
 * @returns 
 */
export async function deleteOssFilesDao(ossFilesIds: number[], tx?: Prisma.TransactionClient): Promise<boolean> {
    try {
        await (tx || prisma).ossFiles.updateMany({
            data: {
                deletedAt: new Date()
            },
            where: {
                id: { in: ossFilesIds },
                deletedAt: null
            }
        })
        return true
    } catch (error) {
        logger.error(`批量软删除文件记录失败: ${error}`)
        throw error
    }
}


/**
 * 获取用户 OSS 用量
 * @param userId 用户 ID
 * @param includeAllStatus 是否包含所有状态的文件（默认只统计已上传成功的文件）
 */
export async function ossUsageDao(userId: number, includeAllStatus: boolean = false, tx?: Prisma.TransactionClient): Promise<{ fileSize: number, unit: FileSizeUnit, count: number }> {
    try {
        const where: Prisma.ossFilesWhereInput = {
            userId: userId,
            deletedAt: null,
        }

        // 默认只统计已上传成功的文件，除非明确指定包含所有状态
        if (!includeAllStatus) {
            where.status = OssFileStatus.UPLOADED
        }

        const result = await (tx || prisma).ossFiles.aggregate({
            where,
            _sum: {
                fileSize: true
            },
            _count: {
                id: true
            }
        })

        // 使用项目统一的 Decimal 转换工具
        const fileSizeValue = decimalToNumberUtils(result._sum.fileSize)

        return {
            fileSize: fileSizeValue,
            unit: FileSizeUnit.BYTE,
            count: result._count.id
        };
    } catch (error) {
        logger.error('获取用户 OSS 用量失败', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
    }
}

/**
 * 更新 OSS 文件记录
 */
export async function updateOssFileDao(id: number, data: Prisma.ossFilesUpdateInput, tx?: Prisma.TransactionClient): Promise<ossFiles> {
    try {
        // 排除 id 和关联字段
        const result = await (tx || prisma).ossFiles.update({
            where: {
                id, deletedAt: null
            },
            data: {
                ...data,
                updatedAt: new Date()
            }
        });
        return {
            ...result,
            source: result.source as FileSource,
            fileSize: result.fileSize
        }
    } catch (error) {
        logger.error(`更新 OSS 文件记录失败: ${error}`)
        throw error
    }
}

/**
 * 根据文件类型获取对应的 MIME 类型列表
 */
const getMimeTypeByFileType = (fileType: FileType): string[] => {
    switch (fileType) {
        case FileType.DOC:
            return ['application/pdf', 'text/markdown', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword']
        case FileType.AUDIO:
            return ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav']
        case FileType.IMAGE:
            return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif']
        case FileType.VIDEO:
            return ['video/mp4', 'video/quicktime', 'video/x-msvideo']
        case FileType.JSON:
            return ['application/json']
        default:
            return []
    }
}

/**
 * 查找孤儿 OSS 文件（所有业务表都不再引用的已上传文件，bug #15）。
 *
 * 业务引用表（穷举）：
 * - contract_reviews.original_file_id / reviewed_file_id
 * - contract_review_versions.docx_file_id
 * - document_templates.oss_file_id
 * - document_drafts.output_file_id
 * - case_materials.oss_file_id
 * - doc_recognition_records.oss_file_id
 * - image_recognition_records.oss_file_id
 * - asr_records.oss_file_id / json_oss_file_id
 * - mineru_tasks.oss_file_id
 *
 * 任何一个表新增 ossFileId 外键，必须同步更新此查询，否则会误删在用文件。
 */
export async function findOrphanOssFilesDAO(limit = 100): Promise<number[]> {
    const rows = await prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM oss_files
        WHERE deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM contract_reviews
              WHERE original_file_id = oss_files.id OR reviewed_file_id = oss_files.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM contract_review_versions WHERE docx_file_id = oss_files.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM document_templates WHERE oss_file_id = oss_files.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM document_drafts WHERE output_file_id = oss_files.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM case_materials WHERE oss_file_id = oss_files.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM doc_recognition_records WHERE oss_file_id = oss_files.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM image_recognition_records WHERE oss_file_id = oss_files.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM asr_records
              WHERE oss_file_id = oss_files.id OR json_oss_file_id = oss_files.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM mineru_tasks WHERE oss_file_id = oss_files.id
          )
        LIMIT ${limit}
    `
    return rows.map((r) => r.id)
}

/**
 * 根据用户 ID 获取 OSS 文件列表
 */
export async function findOssFilesByUserIdDao(userId: number, options: {
    page: number
    pageSize: number
    fileType?: FileType
    fileName?: string
    source?: FileSource[]
    sortField?: FileSortField
    sortOrder?: SortOrder
    tx?: Prisma.TransactionClient
}): Promise<{ files: ossFiles[], total: number }> {
    try {
        // 构建查询条件
        const where: Prisma.ossFilesWhereInput = {
            userId: userId,
            deletedAt: null,
            status: OssFileStatus.UPLOADED  // 只查询已上传的文件
        }

        // 按文件类型筛选
        if (options.fileType && options.fileType !== FileType.OTHER) {
            where.fileType = { in: getMimeTypeByFileType(options.fileType) }
        }

        // 按文件名模糊搜索
        if (options.fileName) {
            where.fileName = { contains: options.fileName, mode: 'insensitive' }
        }

        if (options.source?.length) {
            where.source = { in: options.source }
        }

        // 构建排序条件：未传入排序参数时默认按 ID 降序
        const orderBy: Prisma.ossFilesOrderByWithRelationInput = options.sortField
            ? { [options.sortField]: options.sortOrder || SortOrder.DESC }
            : { id: 'desc' }

        // 并行查询文件列表和总数
        const [files, total] = await Promise.all([
            (options.tx || prisma).ossFiles.findMany({
                where,
                skip: (options.page - 1) * options.pageSize,
                take: options.pageSize,
                orderBy
            }),
            prisma.ossFiles.count({ where })
        ])

        return {
            files,
            total
        }
    } catch (error) {
        logger.error(`根据用户 ID 获取 OSS 文件列表失败: ${error}`)
        throw error
    }
}

/**
 * 仅在 status=PENDING 时把记录标记为 UPLOADED（条件更新，原子幂等）
 *
 * 用于回调失败兜底场景：head OSS 命中后由本函数收敛 status；
 * 调用方根据返回的 count 区分"我改的（count=1）" / "已被回调或别人改过（count=0）"。
 *
 * @returns 实际改动行数
 */
export async function markOssFileUploadedByVerifyDao(
    fileId: number,
    options?: { auditNote?: string }
): Promise<number> {
    const result = await prisma.ossFiles.updateMany({
        where: {
            id: fileId,
            status: OssFileStatus.PENDING,
            deletedAt: null,
        },
        data: {
            status: OssFileStatus.UPLOADED,
        },
    })

    if (result.count > 0) {
        logger.info(
            '[ossFiles] PENDING → UPLOADED via head verification',
            { fileId, source: 'confirm_upload', auditNote: options?.auditNote ?? null }
        )
    }
    return result.count
}