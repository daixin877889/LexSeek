export default defineEventHandler(async (event) => {
  try {
    // 获取 OSS 回调的 body（application/x-www-form-urlencoded 格式）
    const body = await readBody(event)

    console.log('OSS 回调数据:', body)

    // OSS 回调必须返回 JSON 格式，且状态码为 200
    // 返回的内容会透传给客户端
    return {
      success: true,
      filename: body?.filename || '',
      size: body?.size || 0,
      mimeType: body?.mimeType || '',
      width: body?.width || 0,
      height: body?.height || 0
    }
  } catch (error) {
    console.error('OSS 回调处理错误:', error)
    // 即使出错也返回 200，避免 OSS 报错
    return {
      success: false,
      error: 'callback processing failed'
    }
  }
})
