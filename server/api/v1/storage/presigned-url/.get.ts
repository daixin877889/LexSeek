/**
 * 获取预签名 URL（单文件）
 *
 * 使用新的存储适配器系统，支持多种云存储服务商
 */

import { generatePostSignatureService } from '~~/server/services/storage/storage.service'
import { StorageProviderType } from '~~/server/lib/storage/types'

export default defineEventHandler(async (event) => {
    try {
        const query = z.object({
            source: z.enum(FileSource, { message: '场景值错误' }),
            fileSize: z.string().refine((val) => Number(val) > 0 && Number.isInteger(Number(val)), { message: '文件大小必须为整数且大于0' }),
            mimeType: z.string({ message: '文件类型不能为空' }),
            originalFileName: z.string({ message: '文件名称不能为空' }).refine((val) => val.includes('.'), { message: '文件名称必须包含扩展名' }),
            encrypted: z.enum(['true', 'false']).optional().default('false'),
            configId: z.string().optional(),
        }).parse(getQuery(event))

        const { source, fileSize, mimeType, originalFileName, encrypted, configId } = query
        const isEncrypted = encrypted === 'true'
        const parsedConfigId = configId ? Number(configId) : undefined

        const log = createLogger('storage')
        const user = event.context.auth.user

        // 获取预签名场景及配置
        const sourceConfig = getFileSourceAccept(source)
        if (!sourceConfig) {
            return resError(event, 400, `不支持的上传场景: ${source}`)
        }

        // 判断文件类型是否被允许
        const acceptType = sourceConfig.find((item: FileSourceAccept) => item.accept.find(accept => accept.mime === mimeType))
        if (!acceptType) {
            log.error(`文件类型不被允许: ${mimeType}`, { user, source, mimeType, fileSize, originalFileName })
            return resError(event, 400, `文件类型不被允许: ${mimeType}`)
        }

        // 判断文件类型是否超出大小
        const maxSize = acceptType.accept.find(accept => accept.mime === mimeType)?.maxSize ?? 0
        if (Number(fileSize) > maxSize) {
            log.error(`文件大小超出限制: ${formatByteSize(maxSize)}`, { user, source, mimeType, fileSize, originalFileName })
            return resError(event, 400, `文件大小超出限制: ${formatByteSize(maxSize)}`)
        }

        // 获取所有被允许文件的 mimeType
        const allowedMimeTypes = acceptType.accept.map(accept => accept.mime)

        // 获取配置
        const config = useRuntimeConfig()
        const storageConfig = config.storage
        const ossConfig = storageConfig.aliyunOss
        const bucket = ossConfig.bucket
        const basePath = storageConfig.basePath
        const callbackUrl = storageConfig.callbackUrl

        // 生成保存名称
        const originalExtension = getExtensionFromFileName(originalFileName)
        const extension = isEncrypted ? 'age' : (originalExtension || mime.getExtension(mimeType) || '')
        const saveName = `${uuidv7()}.${extension}`

        // 生成保存目录
        const dir = `${basePath}user${user.id}/${source}/`

        // 创建文件记录
        const file = await createOssFileDao({
            userId: user.id,
            bucketName: bucket,
            fileName: originalFileName,
            filePath: `${dir}${saveName}`,
            fileSize: Number(fileSize),
            fileType: mimeType,
            source: source as FileSource,
            status: OssFileStatus.PENDING,
            encrypted: isEncrypted,
            originalMimeType: isEncrypted ? mimeType : null,
        })

        // 使用新的存储服务生成签名
        const signature = await generatePostSignatureService({
            dir,
            fileKey: {
                originalFileName: isEncrypted ? `${originalFileName}.age` : originalFileName,
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
                    original_file_name: originalFileName,
                    file_id: file.id.toString(),
                    encrypted: isEncrypted ? '1' : '0',
                    original_mime_type: mimeType,
                }
            },
            conditions: {
                contentLengthRange: [0, maxSize],
                contentType: isEncrypted ? ['application/octet-stream'] : allowedMimeTypes
            },
            configId: parsedConfigId,
            userId: user.id,
            type: StorageProviderType.ALIYUN_OSS
        })

        log.info('生成签名成功', { user, source, encrypted: isEncrypted })

        return resSuccess(event, '获取预签名URL成功', signature)
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '获取预签名URL失败'))
    }
})
