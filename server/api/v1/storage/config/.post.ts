/**
 * 创建用户存储配置
 *
 * POST /api/v1/storage/config
 */

import {
    createStorageConfigDao,
    isConfigNameExistsDao
} from '~~/server/services/storage/storage-config.dao'
import { testStorageConnectionService } from '~~/server/services/storage/storage.service'
import { StorageProviderType } from '~~/server/lib/storage/types'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 验证请求体
        const bodySchema = z.object({
            name: z.string().min(1, '配置名称不能为空').max(100, '配置名称最长100字符'),
            type: z.enum([
                StorageProviderType.ALIYUN_OSS,
                StorageProviderType.QINIU,
                StorageProviderType.TENCENT_COS
            ], { message: '不支持的存储类型' }),
            config: z.object({
                bucket: z.string().min(1, 'bucket 不能为空'),
                region: z.string().min(1, 'region 不能为空'),
                customDomain: z.string().optional(),
                // 阿里云 OSS
                accessKeyId: z.string().optional(),
                accessKeySecret: z.string().optional(),
                // 七牛云
                accessKey: z.string().optional(),
                secretKey: z.string().optional(),
                // 腾讯云 COS
                secretId: z.string().optional(),
                appId: z.string().optional()
            }),
            isDefault: z.boolean().optional().default(false),
            enabled: z.boolean().optional().default(true),
            testConnection: z.boolean().optional().default(false)
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
