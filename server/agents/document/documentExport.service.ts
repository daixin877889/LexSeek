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
import { DOCX_MIME } from '#shared/utils/mime'
import { downloadFileService, generateSignedUrlService, uploadFileService } from '~~/server/services/storage/storage.service'
import { createOssFileDao, findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { getDocumentDraftDAO, updateDocumentDraftDAO } from './documentDraft.dao'
import { getDocumentTemplateDAO } from './documentTemplate.dao'
import { getVersionByIdDAO } from './documentDraftVersion.dao'
import { extractDocxtemplaterErrorDetail } from './docxtemplaterError.util'
import { buildStorageKey } from '~~/server/utils/storagePath'
import type { ExportDraftResponse } from '#shared/types/document'

/** 导出错误响应 */
type ExportError = { error: string; code: number }

/**
 * 核心渲染 + 上传流水线（内部复用，不对外导出）。
 *
 * 查 template → 下载 buffer → docxtemplater 渲染 → 上传 OSS → 写 ossFiles → 返回签名 URL。
 *
 * @param params.userId          当前用户 ID（OSS 路径 + 权限透传）
 * @param params.templateId      文书模板 ID
 * @param params.values          填充值
 * @param params.fileBaseName    输出文件名前缀（会自动清洗非法字符）
 */
async function renderAndUploadDocx(params: {
    userId: number
    templateId: number
    values: Record<string, unknown>
    fileBaseName: string
}): Promise<{ ossFileId: number; downloadUrl: string } | ExportError> {
    const { userId, templateId, values, fileBaseName } = params
    const safeBaseName = fileBaseName.replace(/[\\/:*?"<>|]/g, '_')

    // 1. 查 template（DAO 内已过滤 deletedAt=null，null 表示已删）
    const template = await getDocumentTemplateDAO(templateId)
    if (!template) return { error: '模板已删除，无法导出', code: 404 }

    // 2. 查模板 OSS 文件
    const templateOssFile = await findOssFileByIdDao(template.ossFileId)
    if (!templateOssFile) return { error: '模板文件丢失', code: 404 }
    if (!templateOssFile.filePath) return { error: '模板文件路径缺失', code: 500 }

    // 3. 下载模板 .docx buffer
    const templateBuffer = await downloadFileService(templateOssFile.filePath, { userId })

    // 4. 用 docxtemplater 渲染
    // 模板作者有可能写成单花括号（如 `{证据和证据来源}}`），
    // docxtemplater 会以 Unopened/Unclosed tag 抛错，此处兜底抓取并返回可读错误，
    // 避免把底层栈透给用户。
    const zip = new PizZip(templateBuffer)
    let renderedBuffer: Buffer
    try {
        const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            nullGetter: () => '',
            delimiters: { start: '{{', end: '}}' },
        })
        doc.render(values)
        renderedBuffer = doc.getZip().generate({ type: 'nodebuffer' }) as Buffer
    } catch (err) {
        const detail = extractDocxtemplaterErrorDetail(err)
        logger.error('docxtemplater 渲染失败', { templateId, detail })
        return { error: `模板占位符不合法：${detail}。请检查模板文件并修正（占位符需用双花括号 {{name}}）。`, code: 400 }
    }

    // 5. 并行上传 + 获取存储配置
    const ossPath = buildStorageKey({
        scope: 'user',
        userId,
        source: FileSource.DOCUMENT_EXPORT,
        fileName: `${Date.now()}_${safeBaseName}.docx`,
    })
    const [uploadResult, storageConfig] = await Promise.all([
        uploadFileService(ossPath, renderedBuffer, {
            contentType: DOCX_MIME,
            userId,
        }),
        getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userId),
    ])
    const bucketName = storageConfig?.bucket ?? ''

    // 6. 写 ossFiles 记录
    const ossFile = await createOssFileDao({
        userId,
        bucketName,
        fileName: `${safeBaseName}.docx`,
        filePath: uploadResult.name,
        fileSize: renderedBuffer.length,
        fileType: DOCX_MIME,
        source: FileSource.DOCUMENT_EXPORT,
        status: OssFileStatus.UPLOADED,
        encrypted: false,
    })

    // 7. 生成签名下载 URL（1 小时有效）
    const downloadUrl = await generateSignedUrlService(uploadResult.name, {
        expires: 3600,
        userId,
    })

    return { ossFileId: ossFile.id, downloadUrl }
}

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
    if (draft.templateId == null) {
        return { error: '自由文书暂不支持导出为 docx', code: 400 }
    }
    if (draft.status !== 'ready' && draft.status !== 'exported') {
        return { error: '草稿未就绪，无法导出', code: 400 }
    }

    // 2. 渲染 + 上传
    const result = await renderAndUploadDocx({
        userId,
        templateId: draft.templateId,
        values: draft.values as Record<string, unknown>,
        fileBaseName: draft.title || `draft-${draftId}`,
    })
    if ('error' in result) return result

    // 3. 更新 draft
    await updateDocumentDraftDAO(draftId, {
        status: 'exported',
        outputFileId: result.ossFileId,
    })

    return result
}

/**
 * 导出指定版本为 .docx 文件并上传 OSS。
 * 不修改 draft.status，仅生成下载链接。
 *
 * @param userId    当前登录用户 ID
 * @param versionId 版本 ID
 * @returns 成功时返回 { ossFileId, downloadUrl }，失败时返回 { error, code }
 */
export async function exportVersionByIdService(
    userId: number,
    versionId: number,
): Promise<{ ossFileId: number; downloadUrl: string } | ExportError> {
    // 1. 查版本
    const version = await getVersionByIdDAO(versionId)
    if (!version) return { error: '版本不存在', code: 404 }

    // 2. 查所属 draft + owner 校验
    const draft = await getDocumentDraftDAO(version.draftId)
    if (!draft) return { error: '草稿不存在', code: 404 }
    if (draft.userId !== userId) return { error: '无权导出此版本', code: 403 }
    if (draft.templateId == null) {
        return { error: '自由文书暂不支持导出为 docx', code: 400 }
    }

    // 3. 渲染 + 上传（文件名：titleAt-name）
    return renderAndUploadDocx({
        userId,
        templateId: draft.templateId,
        values: version.values as Record<string, unknown>,
        fileBaseName: `${version.titleAt}-${version.name}`,
    })
}
