/**
 * OSS 文件数据访问层
 *
 * 封装所有与 OSS 文件表相关的数据库操作
 */

import { ossFiles, Prisma } from '#shared/types/prisma'

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

// /**
//  * 软删除文件记录
//  */
// export async function deleteFileDao(id: number, tx?: Prisma.TransactionClient): Promise<void> {
//     try {
//         await (tx || prisma).ossFiles.update({
//             where: { id, deletedAt: null },
//             data: {
//                 deletedAt: new Date()
//             }
//         })
//     } catch (error) {
//         logger.error(`软删除文件记录失败: ${error}`)
//         throw error
//     }
// }

// /**
//  * 获取用户 OSS 用量
//  */
// export async function ossUsageDao(userId: number): Promise<{ fileSize: number, unit: FileSizeUnit, count: number }> {
//     try {
//         const fileSize = await prisma.ossFiles.aggregate({
//             where: {
//                 userId: userId,
//                 deletedAt: null
//             },
//             _sum: {
//                 fileSize: true
//             },
//             _count: {
//                 id: true
//             }
//         })

//         return {
//             fileSize: Number(fileSize._sum.fileSize),
//             unit: FileSizeUnit.BYTE,
//             count: fileSize._count.id
//         };
//     } catch (error) {
//         logger.error('获取用户 OSS 用量失败', {
//             error: error instanceof Error ? error.message : String(error),
//             stack: error instanceof Error ? error.stack : undefined,
//         });
//         throw error;
//     }
// }

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
 * 根据用户 ID 获取 OSS 文件列表
 */
export async function findOssFilesByUserIdDao(userId: number, options: {
    page: number
    pageSize: number
    fileType?: FileType
    fileName?: string
    source?: FileSource
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

        // 按来源筛选
        if (options.source) {
            where.source = options.source
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