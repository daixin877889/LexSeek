/**
 * 批量获取存储预签名 URL
 *
 * 使用新的存储适配器系统，支持多种云存储服务商
 */

// import { generatePostSignatureService } from '~~/server/services/storage/storage.service'
import { StorageProviderType } from '~~/server/lib/storage/types'
import type { Prisma } from '#shared/types/prisma'

/** 单个文件信息 */
interface FileInfo {
    originalFileName: string
    fileSize: number
    mimeType: string
}

/** 批量签名请求体 */
interface BatchPresignedUrlRequest {
    source: string
    files: FileInfo[]
    encrypted?: boolean
    /** 存储配置 ID（可选，不传则使用默认配置） */
    configId?: number
}

/** 文件元数据（预处理后） */
interface FileMeta {
    file: FileInfo
    saveName: string
    allowedMimeTypes: string[]
    maxSize: number
}

export default defineEventHandler(async (event) => {
    try {
        const log = createLogger('storage')
        const user = event.context.auth.user

        // 验证请求体
        const bodySchema = z.object({
            source: z.enum(FileSource, { message: '场景值错误' }),
            files: z.array(z.object({
                originalFileName: z.string({ message: '文件名称不能为空' })
                    .refine((val) => val.includes('.'), { message: '文件名称必须包含扩展名' }),
                fileSize: z.number({ message: '文件大小必须为数字' })
                    .refine((val) => val > 0 && Number.isInteger(val), { message: '文件大小必须为正整数' }),
                mimeType: z.string({ message: '文件类型不能为空' }),
            })).min(1, { message: '至少需要一个文件' }).max(20, { message: '单次最多上传20个文件' }),
            encrypted: z.boolean().optional().default(false),
            configId: z.number().optional()
        })

        const body = bodySchema.parse(await readBody(event)) as BatchPresignedUrlRequest
        const { source, files, encrypted, configId } = body

        // 计算本次上传的总文件大小
        const totalUploadSize = files.reduce((sum, file) => sum + file.fileSize, 0)

        // 校验云盘空间是否足够
        const quotaCheck = await checkStorageQuotaService(user.id, totalUploadSize)
        if (!quotaCheck.allowed) {
            log.warn('云盘空间不足', {
                user,
                totalUploadSize,
                quota: quotaCheck.quota,
            })
            return resError(event, 400, quotaCheck.message || '云盘空间不足')
        }

        // 获取场景配置
        const sourceConfig = getFileSourceAccept(source as FileSource)
        if (!sourceConfig) {
            return resError(event, 400, `不支持的上传场景: ${source}`)
        }

        // 验证每个文件
        const validationErrors: string[] = []
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            if (!file) continue

            // 验证文件类型
            const acceptType = sourceConfig.find((item: FileSourceAccept) =>
                item.accept.find(accept => accept.mime === file.mimeType)
            )

            if (!acceptType) {
                validationErrors.push(`文件 "${file.originalFileName}" 类型不被允许: ${file.mimeType}`)
                continue
            }

            // 验证文件大小
            const maxSize = acceptType.accept.find(accept => accept.mime === file.mimeType)?.maxSize ?? 0
            if (file.fileSize > maxSize) {
                validationErrors.push(`文件 "${file.originalFileName}" 大小超出限制: ${formatByteSize(file.fileSize)}，最大允许: ${formatByteSize(maxSize)}`)
            }
        }

        if (validationErrors.length > 0) {
            log.error('批量文件验证失败', { user, source, errors: validationErrors })
            return resError(event, 400, validationErrors.join('; '))
        }

        // 获取配置
        const config = useRuntimeConfig()
        const storageConfig = config.storage
        const ossConfig = storageConfig.aliyunOss
        const bucket = ossConfig.bucket
        const basePath = storageConfig.basePath
        const dir = `${basePath}user${user.id}/${source}/`
        const callbackUrl = storageConfig.callbackUrl

        // 预处理文件信息
        const fileMetaList: FileMeta[] = files.map(file => {
            const acceptType = sourceConfig.find((item: FileSourceAccept) =>
                item.accept.find(accept => accept.mime === file.mimeType)
            )
            const allowedMimeTypes = acceptType?.accept.map(accept => accept.mime) ?? []
            const maxSize = acceptType?.accept.find(accept => accept.mime === file.mimeType)?.maxSize ?? 0

            const originalExtension = getExtensionFromFileName(file.originalFileName)
            const extension = encrypted ? 'age' : (originalExtension || mime.getExtension(file.mimeType) || '')
            const saveName = `${uuidv7()}.${extension}`

            return { file, saveName, allowedMimeTypes, maxSize }
        })

        // 使用事务确保批量插入和签名生成的原子性
        const signatures = await prisma.$transaction(async (tx) => {
            // 批量创建文件记录
            const ossFileRecords = await createOssFilesDao(
                fileMetaList.map(({ file, saveName }) => ({
                    userId: user.id,
                    bucketName: bucket,
                    fileName: file.originalFileName,
                    filePath: `${dir}${saveName}`,
                    fileSize: file.fileSize,
                    fileType: file.mimeType,
                    source: source as FileSource,
                    status: OssFileStatus.PENDING,
                    encrypted: encrypted,
                    originalMimeType: encrypted ? file.mimeType : null,
                })),
                tx as Prisma.TransactionClient
            )

            // 为每个文件生成签名
            const results: PostSignatureResult[] = []

            for (let i = 0; i < fileMetaList.length; i++) {
                const { file, saveName, allowedMimeTypes, maxSize } = fileMetaList[i]!
                const ossFile = ossFileRecords[i]!

                // 使用新的存储服务生成签名
                const signature = await generatePostSignatureService({
                    dir,
                    fileKey: {
                        originalFileName: encrypted ? `${file.originalFileName}.age` : file.originalFileName,
                        strategy: 'custom',
                        customFileName: saveName
                    },
                    expirationMinutes: 10,
                    callback: {
                        callbackUrl,
                        callbackBody: 'filename=${object}&size=${size}&mimeType=${mimeType}',
                        callbackBodyType: 'application/x-www-form-urlencoded',
                        callbackVar: {
                            user_id: user.id,
                            source: source,
                            original_file_name: file.originalFileName,
                            file_id: ossFile.id.toString(),
                            encrypted: encrypted ? '1' : '0',
                            original_mime_type: file.mimeType,
                        }
                    },
                    conditions: {
                        contentLengthRange: [0, maxSize],
                        contentType: encrypted ? ['application/octet-stream'] : allowedMimeTypes
                    },
                    // 使用指定的配置或默认配置
                    configId,
                    userId: user.id,
                    type: StorageProviderType.ALIYUN_OSS
                })

                results.push(signature as PostSignatureResult)
            }

            return results
        })

        log.info(`批量生成签名成功，共 ${signatures.length} 个文件`, { user, source, encrypted })

        return resSuccess(event, '批量获取预签名URL成功', signatures)
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '批量获取预签名URL失败'))
    }
})
