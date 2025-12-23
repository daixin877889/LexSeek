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
    }).parse(getQuery(event))

    const { source, fileSize, mimeType, originalFileName } = query

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

    // 生成OSS预签名
    const config = useRuntimeConfig();
    const bucket = config.aliyun.oss.main.bucket;
    const signature = await generateOssPostSignature(bucket, originalFileName, maxSize, allowedMimeTypes, {
      userId: user.id,
      source: source,
      originalFileName: originalFileName
    });

    return resSuccess(event, "获取预签名URL成功", signature)
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, "获取预签名URL失败"))
  }


})
