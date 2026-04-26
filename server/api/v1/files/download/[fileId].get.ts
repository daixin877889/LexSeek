import { generateOssDownloadSignaturesService } from '~~/server/services/files/files.service'
/**
 * 生成单个文件的下载预签名 URL
 *
 * GET /api/v1/files/download/:fileId
 *
 * 仅允许文件所有者访问；返回带过期时间的签名下载 URL。
 */

export default defineEventHandler(async (event) => {
  const user = event.context.auth?.user
  if (!user) return resError(event, 401, '请先登录')

  const rawId = getRouterParam(event, 'fileId')
  const fileId = rawId ? Number(rawId) : NaN
  if (!rawId || !Number.isInteger(fileId) || fileId <= 0) {
    return resError(event, 400, '无效的文件ID')
  }

  const ossFile = await prisma.ossFiles.findFirst({
    where: { id: fileId, deletedAt: null },
  })

  if (!ossFile) return resError(event, 404, '文件不存在')
  if (ossFile.userId !== user.id) return resError(event, 403, '无权限访问该文件')

  const results = await generateOssDownloadSignaturesService({
    ossFiles: [ossFile],
    expires: 3600,
  })

  if (!results.length) return resError(event, 500, '生成下载链接失败')

  return resSuccess(event, '获取下载链接成功', results[0])
})
