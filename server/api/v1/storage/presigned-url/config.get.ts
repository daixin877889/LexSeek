/**
 * 获取预签名场景及配置
 * 
 * 返回文件上传场景的允许类型和大小限制
 */

export default defineEventHandler(async (event) => {
    const query = z.object({
        source: z.enum(FileSource, { message: '场景值错误' }).optional(),
    }).parse(getQuery(event))

    const acceptList = getFileSourceAccept(query.source ?? undefined)
    return resSuccess(event, '获取预签名配置成功', acceptList)
})
