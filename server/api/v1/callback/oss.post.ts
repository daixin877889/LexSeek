export default defineEventHandler(async (event) => {
  try {
    // 获取 OSS 回调的 body（application/x-www-form-urlencoded 格式）
    const body = await readBody(event)

    logger.debug('OSS 回调数据:', body)

    // 解析回调变量
    const fileId = Number(body?.['x:file_id'])
    const encrypted = body?.['x:encrypted'] === '1'
    const originalMimeType = body?.['x:original_mime_type'] || ''

    const result = {
      success: true,
      filename: body?.filename || '',
      size: body?.size || 0,
      mimeType: body?.mimeType || '',
      fileId,
      userId: body?.['x:user_id'] || '',
      source: body?.['x:source'] || '',
      originalFileName: body?.['x:original_file_name'] || '',
      encrypted,
      originalMimeType: encrypted ? originalMimeType : null,
    }

    if (!result.fileId) {
      await updateOssFileDao(result.fileId, {
        status: OssFileStatus.FAILED,
      })

      return {
        success: false,
        error: 'fileId is required'
      }
    }

    // 更新文件记录，包含加密相关字段
    await updateOssFileDao(result.fileId, {
      status: OssFileStatus.UPLOADED,
      encrypted,
      originalMimeType: encrypted ? originalMimeType : null,
    })

    logger.info('OSS 回调处理成功', { fileId, encrypted })

    // OSS 回调必须返回 JSON 格式，且状态码为 200
    // 返回的内容会透传给客户端
    return result
  } catch (error) {
    console.error('OSS 回调处理错误:', error)
    // 即使出错也返回 200，避免 OSS 报错
    return {
      success: false,
      error: 'callback processing failed'
    }
  }
})
