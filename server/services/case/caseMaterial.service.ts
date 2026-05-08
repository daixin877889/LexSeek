/**
 * 案件材料服务层
 *
 * 提供案件材料的业务逻辑处理，包括材料添加、验证等
 */

import type { Prisma } from '~~/generated/prisma/client'
import type { CaseMaterialParam } from '#shared/types/case'
import { CaseMaterialType } from '#shared/types/case'
import { MaterialStatus } from '#shared/types/material'
import { getMaterialTypeFromMime } from '#shared/types/case'
import { findOssFileByIdsDao } from '../files/ossFiles.dao'
import { batchAddCaseMaterialsDAO, createSingleCaseMaterialDAO } from './caseMaterial.dao'
import { createTextContentRecordDAO } from '../material/textContentRecords.dao'

/**
 * 批量添加案件材料
 *
 * 职责：
 * 1. 文本材料：逐条创建以获取 materialId，然后创建 textContentRecords
 * 2. 文件材料：验证 OSS 文件存在且属于当前用户，批量创建
 *
 * @param caseId 案件 ID
 * @param userId 用户 ID
 * @param materials 材料参数列表
 * @param tx 事务对象（可选）
 */
export const batchAddCaseMaterialsService = async (
    caseId: number,
    userId: number,
    materials: CaseMaterialParam[],
    tx?: Prisma.TransactionClient
): Promise<void> => {
    if (!materials || materials.length === 0) return

    // 提前批量查所有文件材料的 ossFile（避免循环内 N+1）
    const fileOssIds: number[] = []
    for (const m of materials) {
        if (!Object.values(CaseMaterialType).includes(m.type)) {
            throw new Error(`无效的材料类型: ${m.type}`)
        }
        if (m.type !== CaseMaterialType.CASE_CONTENT) {
            if (!m.ossFileId) throw new Error('文件材料必须提供 OSS 文件 ID')
            fileOssIds.push(m.ossFileId)
        }
    }
    const ossFileMap = new Map<number, Awaited<ReturnType<typeof findOssFileByIdsDao>>[number]>()
    if (fileOssIds.length > 0) {
        const ossFiles = await findOssFileByIdsDao(fileOssIds, tx)
        for (const f of ossFiles) ossFileMap.set(f.id, f)
    }

    const fileMaterialDataList: Array<{
        name: string
        type: number
        ossFileId?: number | null
        isEncrypted?: boolean
        status?: number
    }> = []

    for (const material of materials) {
        if (material.type === CaseMaterialType.CASE_CONTENT) {
            // 文本材料：逐条创建以获取 materialId，然后创建 textContentRecords
            if (!material.content || material.content.trim() === '') {
                throw new Error('文本材料必须包含内容')
            }
            const created = await createSingleCaseMaterialDAO(caseId, {
                name: material.name || '案情描述',
                type: material.type,
                status: MaterialStatus.PENDING, // 文本材料内容已就绪，但仍需走处理流程完成嵌入
            }, tx)

            await createTextContentRecordDAO({
                userId,
                caseId,
                materialId: created.id,
                content: material.content,
                htmlContent: material.content,
            }, tx)
        } else {
            const ossFile = ossFileMap.get(material.ossFileId!)
            if (!ossFile) throw new Error('OSS 文件不存在')
            if (ossFile.userId !== userId) throw new Error('无权使用该文件，请检查文件权限')

            // 根据 ossFile.fileType 纠正材料类型（防御前端传错 type）
            const detectedType = getMaterialTypeFromMime(ossFile.fileType)
            const correctedType = detectedType !== CaseMaterialType.DOCUMENT ? detectedType : material.type

            fileMaterialDataList.push({
                name: material.name || ossFile.fileName,
                type: correctedType,
                ossFileId: material.ossFileId,
                isEncrypted: ossFile.encrypted || false,
                status: 1,
            })
        }
    }

    if (fileMaterialDataList.length > 0) {
        await batchAddCaseMaterialsDAO(caseId, fileMaterialDataList, tx)
    }
}
