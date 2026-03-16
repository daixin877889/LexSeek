/**
 * 批量删除 OSS 文件
 *
 * 软删除用户的文件记录
 */

import { z } from 'zod'

export default defineEventHandler(async (event) => {
  try {
    const user = event.context.auth.user

    // 验证请求体
    const body = await readBody(event)
    const schema = z.object({
      fileIds: z.array(z.number()).min(1, '至少需要指定一个文件 ID'),
    })
    const { fileIds } = schema.parse(body)

    // 批量查找文件
    const files = await Promise.all(fileIds.map(id => findOssFileByIdDao(id)))

    // 验证所有文件都存在且属于当前用户
    for (const file of files) {
      if (!file) {
        return resError(event, 404, '文件不存在')
      }
      if (file.userId !== user.id) {
        return resError(event, 403, '无权删除此文件')
      }
    }

    // 批量删除
    await Promise.all(fileIds.map(id => deleteFileDao(id)))

    return resSuccess(event, '批量删除成功', {
      deletedCount: fileIds.length,
    })
  } catch (error) {
    return resError(event, 400, parseErrorMessage(error, '批量删除失败'))
  }
})
