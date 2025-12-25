/**
 * 批量获取预签名 URL
 * 
 * 用于多文件上传场景，一次请求为多个文件生成签名信息
 */
import type { Prisma } from "#shared/types/prisma";

/**
 * 单个文件信息
 */
interface FileInfo {
  originalFileName: string
  fileSize: number
  mimeType: string
}

/**
 * 批量签名请求体
 */
interface BatchPresignedUrlRequest {
  source: string
  files: FileInfo[]
  encrypted?: boolean  // 是否加密
}

/**
 * 文件元数据（预处理后）
 */
interface FileMeta {
  file: FileInfo
  saveName: string
  allowedMimeTypes: string[]
  maxSize: number
}

export default defineEventHandler(async (event) => {
  try {
    const logger = createLogger('files')
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
    })

    const body = bodySchema.parse(await readBody(event)) as BatchPresignedUrlRequest
    const { source, files, encrypted } = body

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

    // 如果有验证错误，返回错误信息
    if (validationErrors.length > 0) {
      logger.error('批量文件验证失败', { user, source, errors: validationErrors })
      return resError(event, 400, validationErrors.join('; '))
    }

    // 获取配置
    const config = useRuntimeConfig()
    const bucket = config.aliyun.oss.main.bucket
    const basePath = config.aliyun.oss.main.basePath
    const dir = `${basePath}user${user.id}/${source}/`

    // 预处理文件信息，生成保存名称和扩展名
    const fileMetaList: FileMeta[] = files.map(file => {
      const acceptType = sourceConfig.find((item: FileSourceAccept) =>
        item.accept.find(accept => accept.mime === file.mimeType)
      )
      const allowedMimeTypes = acceptType?.accept.map(accept => accept.mime) ?? []
      const maxSize = acceptType?.accept.find(accept => accept.mime === file.mimeType)?.maxSize ?? 0

      // 优先从原始文件名提取后缀名，如果没有则使用 mime 库转换
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

        // 生成 OSS 预签名
        const signature = await generateOssPostSignatureService({
          bucket,
          originalFileName: encrypted ? `${file.originalFileName}.age` : file.originalFileName,
          maxSize,
          dir,
          saveName,
          allowedMimeTypes: encrypted ? ['application/octet-stream'] : allowedMimeTypes,
          callbackVar: {
            user_id: user.id,
            source: source,
            original_file_name: file.originalFileName,
            file_id: ossFile.id.toString(),
            encrypted: encrypted ? '1' : '0',
            original_mime_type: file.mimeType,
          }
        })

        results.push(signature)
      }

      return results
    })

    logger.info(`批量生成签名成功，共 ${signatures.length} 个文件`, { user, source, encrypted })

    return resSuccess(event, '批量获取预签名URL成功', signatures)
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, '批量获取预签名URL失败'))
  }
})
