/**
 * 获取预签名场景及配置
 */

export default defineEventHandler(async (event) => {
  try {
    const query = z.object({
      source: z.enum(FileSource, { message: '场景值错误' }),
      fileSize: z.string().refine((val) => { return Number(val) > 0 && Number.isInteger(Number(val)) }, { message: '文件大小必须为整数且大于0' }),
      mimeType: z.string({ message: '文件类型不能为空' }),
      originalFileName: z.string({ message: '文件名称不能为空' }).refine((val) => { return val.includes('.') }, { message: '文件名称必须包含扩展名' }),
      encrypted: z.enum(['true', 'false']).optional().default('false'),  // 新增：是否加密
    }).parse(getQuery(event))

    const { source, fileSize, mimeType, originalFileName, encrypted } = query
    const isEncrypted = encrypted === 'true'

    const logger = createLogger('files')
    const user = event.context.auth.user;

    // 获取预签名场景及配置
    const sourceConfig = getFileSourceAccept(source);
    if (!sourceConfig) {
      return resError(event, 400, `不支持的上传场景: ${source}`);
    }

    // 判断文件类型是否被允许
    const acceptType = sourceConfig.find((item: FileSourceAccept) => item.accept.find(accept => accept.mime === mimeType));
    if (!acceptType) {
      logger.error(`文件类型不被允许: ${mimeType}`, { user, source, mimeType, fileSize, originalFileName });
      return resError(event, 400, `文件类型不被允许: ${mimeType}`);
    }

    // 判断文件类型是否超出大小
    const maxSize = acceptType.accept.find(accept => accept.mime === mimeType)?.maxSize ?? 0;
    if (Number(fileSize) > maxSize) {
      logger.error(`文件大小超出限制: ${formatByteSize(maxSize)}`, { user, source, mimeType, fileSize, originalFileName });
      return resError(event, 400, `文件大小超出限制: ${formatByteSize(maxSize)}`);
    }

    // 获取所有被允许文件的 mimeType
    const allowedMimeTypes = acceptType.accept.map(accept => accept.mime);

    // 创建文件记录
    const config = useRuntimeConfig();
    const bucket = config.aliyun.oss.main.bucket;
    const basePath = config.aliyun.oss.main.basePath;

    // 如果是加密文件，修改保存名称添加 .age 后缀
    // 优先从原始文件名提取后缀名，如果没有则使用 mime 库转换
    const originalExtension = getExtensionFromFileName(originalFileName);
    const extension = isEncrypted ? 'age' : (originalExtension || mime.getExtension(mimeType) || '')
    const saveName = `${uuidv7()}.${extension}`

    // 生成保存目录
    const dir = `${basePath}user${user.id}/${source}/`;

    // 创建文件记录时添加加密相关字段
    const file = await createOssFileDao({
      userId: user.id,
      bucketName: bucket,
      fileName: originalFileName,
      filePath: `${dir}${saveName}`,
      fileSize: Number(fileSize),
      fileType: mimeType,  // 存储原始 MIME 类型
      source: source as FileSource,
      status: OssFileStatus.PENDING,
      encrypted: isEncrypted,  // 新增：是否加密
      originalMimeType: isEncrypted ? mimeType : null,  // 新增：原始 MIME 类型
    });

    // 生成 OSS 预签名，回调变量中添加加密相关信息
    const signature = await generateOssPostSignature({
      bucket,
      originalFileName: isEncrypted ? `${originalFileName}.age` : originalFileName,
      maxSize,
      dir,
      saveName,
      allowedMimeTypes: isEncrypted ? ['application/octet-stream'] : allowedMimeTypes,
      callbackVar: {
        user_id: user.id,
        source: source,
        original_file_name: originalFileName,
        file_id: file.id.toString(),
        encrypted: isEncrypted ? '1' : '0',  // 新增：加密标识
        original_mime_type: mimeType,  // 新增：原始 MIME 类型
      }
    });

    // 调试日志：检查返回的 callbackVar
    logger.info('签名结果 callbackVar:', signature.callbackVar);

    return resSuccess(event, "获取预签名URL成功", signature)
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, "获取预签名URL失败"))
  }


})
