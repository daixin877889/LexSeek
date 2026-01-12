/**
 * 创建用户存储配置
 *
 * POST /api/v1/storage/config
 */

// import {
//     createStorageConfigDao,
//     isConfigNameExistsDao
// } from '~~/server/services/storage/storage-config.dao'
// import { testStorageConnectionService } from '~~/server/services/storage/storage.service'
import { StorageProviderType } from '~~/server/lib/storage/types'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 验证请求体
        const bodySchema = z.object({
            name: z.string({ message: '配置名称必须是字符串' }).min(1, '配置名称不能为空').max(100, '配置名称最长100字符'),
            type: z.enum([
                StorageProviderType.ALIYUN_OSS,
                StorageProviderType.QINIU,
                StorageProviderType.TENCENT_COS
            ], { message: '不支持的存储类型' }),
            config: z.object({
                bucket: z.string({ message: 'bucket 必须是字符串' }).min(1, 'bucket 不能为空'),
                region: z.string({ message: 'region 必须是字符串' }).min(1, 'region 不能为空'),
                customDomain: z.string({ message: '自定义域名必须是字符串' }).optional(),
                // 阿里云 OSS
                accessKeyId: z.string({ message: 'accessKeyId 必须是字符串' }).optional(),
                accessKeySecret: z.string({ message: 'accessKeySecret 必须是字符串' }).optional(),
                // 七牛云
                accessKey: z.string({ message: 'accessKey 必须是字符串' }).optional(),
                secretKey: z.string({ message: 'secretKey 必须是字符串' }).optional(),
                // 腾讯云 COS
                secretId: z.string({ message: 'secretId 必须是字符串' }).optional(),
                appId: z.string({ message: 'appId 必须是字符串' }).optional()
            }, { message: '存储配置必须是对象' }),
            isDefault: z.boolean({ message: '是否默认必须是布尔值' }).optional().default(false),
            enabled: z.boolean({ message: '是否启用必须是布尔值' }).optional().default(true),
            testConnection: z.boolean({ message: '是否测试连接必须是布尔值' }).optional().default(false)
        })

        const body = bodySchema.parse(await readBody(event))

        // 检查名称是否已存在
        const nameExists = await isConfigNameExistsDao(body.name, user.id)
        if (nameExists) {
            return resError(event, 400, '配置名称已存在')
        }

        // 如果需要测试连接
        if (body.testConnection) {
            try {
                const testConfig = {
                    type: body.type,
                    name: body.name,
                    ...body.config,
                    enabled: true
                }
                const connected = await testStorageConnectionService({
                    userId: user.id,
                    type: body.type
                })
                if (!connected) {
                    return resError(event, 400, '存储连接测试失败，请检查配置')
                }
            } catch (err) {
                return resError(event, 400, `存储连接测试失败: ${parseErrorMessage(err)}`)
            }
        }

        // 创建配置
        const config = await createStorageConfigDao({
            userId: user.id,
            name: body.name,
            type: body.type,
            config: body.config,
            isDefault: body.isDefault,
            enabled: body.enabled
        })

        return resSuccess(event, '创建存储配置成功', {
            id: config.id,
            name: config.name,
            type: config.type,
            isDefault: config.isDefault,
            enabled: config.enabled
        })
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '创建存储配置失败'))
    }
})
