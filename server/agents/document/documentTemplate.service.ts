/**
 * DocumentTemplate Service
 *
 * 文书模板上传：格式/大小校验 → 占位符扫描 → OSS 上传 → 配额校验（事务内串行）→ 落库。
 * 参见 spec §2.2
 */

import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import { uploadFileService } from '~~/server/services/storage/storage.service'
import { createOssFileDao } from '~~/server/services/files/ossFiles.dao'
import { getDefaultStorageConfigDao } from '~~/server/services/storage/storageConfig.dao'
import { StorageProviderType } from '~~/server/lib/storage/types'
import { FileSource, OssFileStatus } from '~~/shared/types/file'
import { scanPlaceholders } from './templateScanner'
import { createDocumentTemplateDAO, countUserTemplatesDAO } from './documentTemplate.dao'
import { extractDocxtemplaterErrorDetail } from './docxtemplaterError.util'
import type { Prisma } from '#shared/types/prisma'
import type { DocumentCategoryKey, Placeholder } from '#shared/types/document'

// ==================== 常量 ====================

/** 个人模板数量上限 */
export const MAX_PRIVATE_TEMPLATES = 20

/** 最大文件大小（20MB） */
const MAX_FILE_SIZE = 20 * 1024 * 1024

// ==================== 类型 ====================

export interface CreateDocumentTemplateParams {
    userId: number
    isAdmin: boolean
    file: Buffer
    fileName: string
    fileSize: number
    mimeType: string
    name: string
    category: DocumentCategoryKey
    description?: string
}

type ServiceResult = { templateId: number } | { error: string; code: number }

// ==================== Service ====================

/**
 * 创建文书模板。
 *
 * 返回 `{ templateId }` 表示成功，`{ error, code }` 表示失败。
 */
export async function createDocumentTemplateService(
    params: CreateDocumentTemplateParams,
): Promise<ServiceResult> {
    if (params.fileSize > MAX_FILE_SIZE) {
        return { error: '文件不能超过 20MB', code: 413 }
    }

    if (!params.fileName.endsWith('.docx')) {
        return { error: '仅支持 .docx 格式', code: 400 }
    }

    const placeholders = await scanPlaceholders(params.file)
    if (placeholders.length === 0) {
        return { error: '未扫描到占位符，请检查模板', code: 400 }
    }

    // docxtemplater 预编译校验：提前暴露不匹配花括号 / 未闭合标签等错误，
    // 避免上传后到导出时才报错让用户不知道哪里有问题。
    const compileError = tryCompileTemplate(params.file)
    if (compileError) {
        return { error: `模板占位符不合法：${compileError}。请确认所有占位符都使用双花括号 {{name}} 格式。`, code: 400 }
    }

    if (params.isAdmin) {
        return uploadAndCreate({ params, scope: 'global', userId: null, placeholders })
    }

    // 配额校验与写入在事务内串行，防止并发超额
    return prisma.$transaction(async (tx) => {
        const count = await countUserTemplatesDAO(params.userId, tx)
        if (count >= MAX_PRIVATE_TEMPLATES) {
            return { error: `私人模板已达上限 ${MAX_PRIVATE_TEMPLATES} 个`, code: 403 }
        }

        return uploadAndCreate({ params, scope: 'user', userId: params.userId, placeholders, tx })
    })
}

// ==================== 内部辅助 ====================

async function uploadAndCreate(opts: {
    params: CreateDocumentTemplateParams
    scope: 'user' | 'global'
    userId: number | null
    placeholders: Placeholder[]
    tx?: Prisma.TransactionClient
}): Promise<ServiceResult> {
    const { params, scope, userId, placeholders, tx } = opts

    const timestamp = Date.now()
    const ossPath =
        scope === 'user'
            ? `users/${params.userId}/templates/${timestamp}_${params.fileName}`
            : `global-templates/${timestamp}_${params.fileName}`

    // userId=null 时（admin global 上传）走系统默认存储配置
    const userIdForStorage = userId ?? undefined

    const [uploadResult, storageConfig] = await Promise.all([
        uploadFileService(ossPath, params.file, {
            contentType: params.mimeType,
            userId: userIdForStorage,
        }),
        getDefaultStorageConfigDao(StorageProviderType.ALIYUN_OSS, userIdForStorage),
    ])

    const bucketName = storageConfig?.bucket ?? ''

    // ossFiles.userId 是 NOT NULL 约束，admin 上传时使用其自身 userId（与 documentTemplate.userId=null 区分）
    const ossFile = await createOssFileDao(
        {
            userId: params.userId,
            bucketName,
            fileName: params.fileName,
            filePath: uploadResult.name,
            fileSize: params.fileSize,
            fileType: params.mimeType,
            source: FileSource.DOCUMENT_TEMPLATE,
            status: OssFileStatus.UPLOADED,
            encrypted: false,
        },
        tx,
    )

    // 写模板记录
    const template = await createDocumentTemplateDAO(
        {
            name: params.name,
            category: params.category,
            scope,
            userId,
            ossFileId: ossFile.id,
            placeholders,
            description: params.description,
            priority: 100,
        },
        tx,
    )

    return { templateId: template.id }
}

/**
 * 用 docxtemplater 预编译模板，触发词法器检查；成功返回 null，失败返回首条可读错误信息。
 * 仅做语法校验，不做真实渲染，所以 nullGetter 直接返回空字符串即可。
 */
function tryCompileTemplate(buffer: Buffer): string | null {
    try {
        const zip = new PizZip(buffer)
        new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            nullGetter: () => '',
            delimiters: { start: '{{', end: '}}' },
        })
        return null
    } catch (err) {
        return extractDocxtemplaterErrorDetail(err)
    }
}
