/**
 * 文书导出服务
 *
 * 使用 docxtemplater + pizzip 渲染模板 + values → 生成 .docx，上传 OSS，更新 draft。
 *
 * 流程：
 *   1. 查 draft（权限 + 状态校验）
 *   2. 查 template（软删保护）
 *   3. 下载模板 .docx Buffer
 *   4. docxtemplater 渲染（nullGetter 保证缺字段不抛错）
 *   5. 上传渲染结果到 OSS + 写 ossFiles 记录
 *   6. 更新 draft.status='exported' + draft.outputFileId
 *   7. 返回签名下载 URL
 *
 * 参见 spec §11 - 文书导出
 */

import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { FileSource, OssFileStatus } from '#shared/types/file'
import { downloadFileService, generateSignedUrlService, uploadFileService } from '~~/server/services/storage/storage.service'
import { createOssFileDao, findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { getDocumentDraftDAO, updateDocumentDraftDAO } from './documentDraft.dao'
import { getDocumentTemplateDAO } from './documentTemplate.dao'
import type { ExportDraftResponse } from '#shared/types/document'

/** 导出错误响应 */
type ExportError = { error: string; code: number }

/**
 * 导出文书草稿为 .docx 文件并上传 OSS。
 *
 * @param userId 当前登录用户 ID
 * @param draftId 草稿 ID
 * @returns 成功时返回 { ossFileId, downloadUrl }，失败时返回 { error, code }
 */
export async function exportDraftService(
    userId: number,
    draftId: number,
): Promise<ExportDraftResponse | ExportError> {
    // 1. 查 draft + 权限/状态校验
    const draft = await getDocumentDraftDAO(draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权导出此草稿', code: 403 }
    if (draft.status !== 'ready' && draft.status !== 'exported') {
        return { error: '草稿未就绪，无法导出', code: 400 }
    }

    // 2. 查 template（DAO 内已过滤 deletedAt=null，null 表示已删）
    const template = await getDocumentTemplateDAO(draft.templateId)
    if (!template) return { error: '模板已删除，无法导出', code: 404 }

    // 3. 查模板 OSS 文件
    const templateOssFile = await findOssFileByIdDao(template.ossFileId)
    if (!templateOssFile) return { error: '模板文件丢失', code: 404 }
    if (!templateOssFile.filePath) return { error: '模板文件路径缺失', code: 500 }

    // 4. 下载模板 .docx buffer
    const templateBuffer = await downloadFileService(templateOssFile.filePath, { userId })

    // 5. 用 docxtemplater 渲染
    const zip = new PizZip(templateBuffer)
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => '',   // 缺字段返回空字符串，不抛错
        delimiters: { start: '{{', end: '}}' },
    })
    doc.render(draft.values as Record<string, unknown>)
    const renderedBuffer = doc.getZip().generate({ type: 'nodebuffer' }) as Buffer

    // 6. 并行上传 + 获取存储配置（与模板上传服务保持一致）
    const ossPath = `users/${userId}/document-exports/${Date.now()}_${template.name}.docx`
    const [uploadResult, storageConfig] = await Promise.all([
        uploadFileService(ossPath, renderedBuffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            userId,
        }),
        getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userId),
    ])
    const bucketName = storageConfig?.bucket ?? ''

    // 7. 写 ossFiles 记录
    const ossFile = await createOssFileDao({
        userId,
        bucketName,
        fileName: `${template.name}.docx`,
        filePath: uploadResult.name,
        fileSize: renderedBuffer.length,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        source: FileSource.DOCUMENT_EXPORT,
        status: OssFileStatus.UPLOADED,
        encrypted: false,
    })

    // 8. 更新 draft
    await updateDocumentDraftDAO(draftId, {
        status: 'exported',
        outputFileId: ossFile.id,
    })

    // 9. 生成签名下载 URL（1 小时有效）
    const downloadUrl = await generateSignedUrlService(uploadResult.name, {
        expires: 3600,
        userId,
    })

    return { ossFileId: ossFile.id, downloadUrl }
}
