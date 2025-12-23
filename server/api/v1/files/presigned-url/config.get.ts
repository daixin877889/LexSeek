/**
 * 获取预签名场景及配置
 */

export default defineEventHandler(async (event) => {

  const result = await getOssClient()

  return result
})
