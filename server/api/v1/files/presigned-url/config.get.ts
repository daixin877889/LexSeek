/**
 * 获取预签名场景及配置
 */
// import Mime from 'mime'

export default defineEventHandler(async (event) => {

  const query = z.object({
    source: z.enum(FileSource, { message: '场景值错误' }).optional(),
  }).parse(getQuery(event))

  const acceptList = getFileSourceAccept(query.source ?? undefined)
  return resSuccess(event, "获取预签名允配置失败", acceptList)
})
