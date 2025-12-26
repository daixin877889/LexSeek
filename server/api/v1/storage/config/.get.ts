/**
 * 获取用户存储配置列表
 *
 * GET /api/v1/storage/config
 */

import { getStorageConfigsDao } from '~~/server/services/storage/storage-config.dao'
import { StorageProviderType } from '~~/server/lib/storage/types'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user

        // 验证查询参数
        const querySchema = z.object({
            type: z.enum([
                StorageProviderType.ALIYUN_OSS,
                StorageProviderType.QINIU,
                StorageProviderType.TENCENT_COS
            ]).optional(),
            enabled: z.enum(['true', 'false']).optional(),
            includeSystem: z.enum(['true', 'false']).optional()
        })

        const query = querySchema.parse(getQuery(event))

        // 获取配置列表
        const configs = await getStorageConfigsDao({
            userId: user.id,
            type: query.type,
            enabled: query.enabled === 'true' ? true : query.enabled === 'false' ? false : undefined,
            includeSystem: query.includeSystem !== 'false'
        })

        // 过滤敏感信息
        const safeConfigs = configs.map(config => ({
            id: config.id,
            name: config.name,
            type: config.type,
            bucket: config.bucket,
            region: config.region,
            customDomain: config.customDomain,
            enabled: config.enabled
        }))

        return resSuccess(event, '获取存储配置列表成功', safeConfigs)
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '获取存储配置列表失败'))
    }
})
