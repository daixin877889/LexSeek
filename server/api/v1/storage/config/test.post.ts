/**
 * 测试存储配置连接
 *
 * POST /api/v1/storage/config/test
 */

// import { testStorageConnectionService } from '~~/server/services/storage/storage.service'
import { StorageProviderType } from '~~/server/lib/storage/types'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 验证请求体
        const bodySchema = z.object({
            configId: z.number().optional(),
            type: z.enum([
                StorageProviderType.ALIYUN_OSS,
                StorageProviderType.QINIU,
                StorageProviderType.TENCENT_COS
            ]).optional()
        })

        const body = bodySchema.parse(await readBody(event))

        // 测试连接
        const connected = await testStorageConnectionService({
            configId: body.configId,
            userId: user.id,
            type: body.type
        })

        if (connected) {
            return resSuccess(event, '存储连接测试成功', { connected: true })
        } else {
            return resError(event, 400, '存储连接测试失败')
        }
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '存储连接测试失败'))
    }
})
