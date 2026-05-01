/**
 * 批量删除 OSS 文件
 *
 * 软删除用户的文件记录
 */

import { z } from 'zod'
import { parseErrorMessage } from '#shared/utils/apiResponse'
import { deleteOssFilesDao, findOssFileByIdsDao } from '~~/server/services/files/ossFiles.dao'

export default defineEventHandler(async (event) => {
  try {
    const user = event.context.auth.user

    const body = await readBody(event)
    const schema = z.object({
      fileIds: z.array(z.number()).min(1, '至少需要指定一个文件 ID'),
    })
    const { fileIds } = schema.parse(body)

    const files = await findOssFileByIdsDao(fileIds)
    if (files.length !== fileIds.length) {
      return resError(event, 404, '文件不存在')
    }
    if (files.some(f => f.userId !== user.id)) {
      return resError(event, 403, '无权删除此文件')
    }

    await deleteOssFilesDao(fileIds)

    return resSuccess(event, '批量删除成功', {
      deletedCount: fileIds.length,
    })
  } catch (error) {
    return resError(event, 400, parseErrorMessage(error, '批量删除失败'))
  }
})
