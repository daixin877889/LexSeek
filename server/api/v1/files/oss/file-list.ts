/**
 * 获取 OSS 文件列表
 * 
 * 支持分页、筛选和排序，返回带签名的下载 URL
 */

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 参数验证（GET 请求参数都是字符串，需要转换）
        const rawQuery = getQuery(event)
        const query = z.object({
            page: z.coerce.number({ message: '页码必须为数字' }).min(1, { message: '页码最小为1' }).default(1),
            pageSize: z.coerce.number({ message: '每页数量必须为数字' }).min(1, { message: '每页数量最小为1' }).max(100, { message: '每页数量最大为100' }).default(30),
            fileType: z.enum(FileType, { message: '文件类型值错误' }).optional(),
            fileName: z.string({ message: '文件名必须为字符串' }).optional(),
            source: z.enum(FileSource, { message: '场景值错误' }).optional(),
            sortField: z.enum(FileSortField, { message: '排序字段值错误' }).optional(),
            sortOrder: z.enum(SortOrder, { message: '排序顺序值错误' }).optional().default(SortOrder.DESC),
        }).parse(rawQuery)

        // 查询文件列表
        const { files, total } = await findOssFilesByUserIdDao(user.id, {
            page: query.page,
            pageSize: query.pageSize,
            fileType: query.fileType as FileType | undefined,
            fileName: query.fileName,
            source: query.source as FileSource | undefined,
            sortField: query.sortField as FileSortField,
            sortOrder: query.sortOrder as SortOrder,
        })

        // 批量生成下载签名 URL
        const downloadResults = await generateOssDownloadSignaturesService({
            ossFiles: files,
            expires: 3600
        })

        // 构建 fileId -> downloadUrl 映射
        const downloadUrlMap = new Map(
            downloadResults.map(r => [r.ossFileId, r.downloadUrl])
        )

        // 返回结果
        return resSuccess(event, '获取文件列表成功', {
            list: files.map(file => ({
                id: file.id,
                fileName: file.fileName,
                fileSize: decimalToNumberUtils(file.fileSize),  // Decimal 转换为数字
                fileType: file.fileType,
                source: file.source,
                sourceName: FileSourceName[file.source as FileSource],
                status: file.status,
                statusName: OssFileStatusName[file.status as OssFileStatus],
                encrypted: file.encrypted,
                createdAt: file.createdAt,
                url: downloadUrlMap.get(file.id) || null,  // 签名下载 URL
            })),
            pagination: {
                page: query.page,
                pageSize: query.pageSize,
                total,
                totalPages: Math.ceil(total / query.pageSize),
            }
        })
    } catch (error) {
        return resError(event, 400, parseErrorMessage(error, '获取文件列表失败'))
    }
})
