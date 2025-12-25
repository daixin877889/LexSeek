/**
 * I
 * 
 * 用于多文件下载场景，一次请求为多个文件生成签名下载链接
 */

export default defineEventHandler(async (event) => {
  try {
    const user = event.context.auth.user
    const userId = user?.id as number

    // 验证请求体
    const bodySchema = z.object({
      ossFileIds: z.array(
        z.number({ message: '文件ID必须为数字' })
          .int({ message: '文件ID必须为整数' })
          .positive({ message: '文件ID必须为正整数' })
      )
        .min(1, { message: '至少需要一个文件ID' })
      // .max(50, { message: '单次最多获取50个文件的下载链接' })
    })

    const body = bodySchema.parse(await readBody(event))
    const { ossFileIds } = body

    // 批量查询文件记录
    const ossFiles = await prisma.ossFiles.findMany({
      where: {
        id: { in: ossFileIds },
        deletedAt: null
      }
    })

    // 检查是否所有文件都存在
    if (ossFiles.length !== ossFileIds.length) {
      const foundIds = new Set(ossFiles.map(f => f.id))
      const notFoundIds = ossFileIds.filter(id => !foundIds.has(id))
      return resError(event, 404, `以下文件不存在: ${notFoundIds.join(', ')}`)
    }

    // 检查权限：所有文件必须属于当前用户
    const unauthorizedFiles = ossFiles.filter(f => f.userId !== userId)
    if (unauthorizedFiles.length > 0) {
      return resError(event, 403, '部分文件无权限访问')
    }

    // 批量生成下载签名
    const results = await generateOssDownloadSignaturesService({
      ossFiles,
      expires: 3600
    })

    // 检查是否有文件生成失败
    if (results.length !== ossFiles.length) {
      const successIds = new Set(results.map(r => r.ossFileId))
      const failedIds = ossFileIds.filter(id => !successIds.has(id))
      logger.warn(`部分文件下载链接生成失败: ${failedIds.join(', ')}`)
    }

    return resSuccess(event, '批量生成下载URL成功', results)
  } catch (error) {
    return resError(event, 500, parseErrorMessage(error, '批量生成下载URL失败'))
  }
})
