/**
 * OSS 文件数据访问层
 *
 * 封装所有与 OSS 文件表相关的数据库操作
 */

import { Prisma } from '#shared/types/prisma'

/**
 * 创建 OSS 文件记录
 */
export async function createOssFileDao(ossFile: Prisma.ossFilesCreateInput): Promise<ossFiles> {
    try {
        // 排除关联字段
        const result = await prisma.ossFiles.create({
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

// /**
//  * 根据文件 ID 查找 OSS 文件记录
//  */
// export async function findOssFileByIdDao(id: number, tx?: Prisma.TransactionClient): Promise<OssFile | null> {
//     try {
//         const result = await (tx || prisma).ossFiles.findFirst({
//             where: {
//                 id: id,
//                 deletedAt: null
//             }
//         })

//         // 确保fileSize是number类型并转换日期字段
//         if (!result) return null;

//         return {
//             ...result,
//             source: result.source as OssFileSource,
//             fileSize: Number(result.fileSize)
//         };
//     } catch (error) {
//         logger.error(`根据文件ID查找 OSS 文件记录失败: ${error}`)
//         throw error
//     }
// }


// /**
//  * 根据文件 ID 批量查找 OSS 文件记录
//  */
// export async function findOssFileByIdsDao(id: number[], tx?: Prisma.TransactionClient): Promise<OssFile[]> {
//     try {
//         const result = await prisma.ossFiles.findMany({
//             where: {
//                 id: { in: id },
//                 deletedAt: null
//             }
//         })

//         // 确保每个结果的fileSize是number类型并转换日期字段
//         return result.map((file: any) => ({
//             ...file,
//             source: file.source as OssFileSource,
//             fileSize: Number(file.fileSize)
//         }))
//     } catch (error) {
//         logger.error(`根据文件 ID 批量查找 OSS 文件记录失败: ${error}`)
//         throw error
//     }
// }

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
export async function updateOssFileDao(id: number, data: Prisma.ossFilesUpdateInput): Promise<ossFiles> {
    try {
        // 排除 id 和关联字段
        const result = await prisma.ossFiles.update({
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

// /**
//  * 根据用户 ID 获取 OSS 文件列表
//  */
// export async function findOssFilesByUserIdDao(userId: number,
//     options: {
//         tx?: Prisma.TransactionClient,
//         page: number,
//         pageSize: number,
//         fileType?: FileType,
//         fileName?: string,
//         source?: OssFileSource,
//         sortField?: FileSortField,
//         sortOrder?: SortOrder
//     }): Promise<{ ossFiles: OssFile[], total: number }> {
//     try {

//         const where: any = { userId: userId, deletedAt: null }
//         if (options.fileType) {
//             where.fileType = { in: getMimeTypeByFileType(options.fileType) }
//         }

//         if (options.fileName) {
//             where.fileName = { contains: options.fileName, mode: 'insensitive' }
//         }

//         if (options.source) {
//             where.source = options.source
//         }

//         // 构建排序条件
//         const orderBy: any = {};
//         const sortField = options.sortField || FileSortField.CREATED_AT;
//         const sortOrder = options.sortOrder || SortOrder.DESC;
//         orderBy[sortField] = sortOrder;

//         const [ossFiles, total] = await Promise.all([
//             (options.tx || prisma).ossFiles.findMany({
//                 where: where,
//                 skip: (options.page - 1) * options.pageSize,
//                 take: options.pageSize,
//                 orderBy: orderBy,
//                 include: {
//                     docRecognitionRecords: {
//                         where: { deletedAt: null },
//                         orderBy: { createdAt: SortOrder.DESC }
//                     },
//                     imageRecognitionRecords: {
//                         where: { deletedAt: null },
//                         orderBy: { createdAt: SortOrder.DESC }
//                     },
//                     asrRecords: {
//                         where: { deletedAt: null },
//                         orderBy: { createdAt: SortOrder.DESC }
//                     }
//                 }
//             }),
//             (options.tx || prisma).ossFiles.count({
//                 where: where,
//             })
//         ])
//         return {
//             ossFiles: ossFiles.map((file: any) => ({
//                 ...file,
//                 source: file.source as OssFileSource,
//                 fileSize: Number(file.fileSize),
//                 sourceName: OssFileSourceName[file.source as OssFileSource],
//                 statusName: OssFileStatusName[file.status as OssFileStatus]
//             })),
//             total: total
//         }
//     } catch (error) {
//         logger.error(`根据用户 ID 获取 OSS 文件列表失败: ${error}`)
//         throw error
//     }
// }