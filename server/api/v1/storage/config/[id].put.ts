/**
 * 更新用户存储配置
 *
 * PUT /api/v1/storage/config/:id
 */

import {
    updateStorageConfigDao,
    isConfigNameExistsDao
} from '~~/server/services/storage/storage-config.dao'
import { clearAdapterCache } from '~~/server/services/storage/storage.service'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user
        const id = Number(getRouterParam(event, 'id'))

        if (!id || isNaN(id)) {
            return resError(event, 400, '无效的配置 ID')
        }

        // 验证请求体
        const bodySchema = z.object({
            name: z.string().min(1).max(100).optional(),
            config: z.object({
                bucket: z.string().optional(),
                region: z.string().optional(),
                customDomain: z.string().optional(),
                accessKeyId: z.string().optional(),
                accessKeySecret: z.string().optional(),
                accessKey: z.string().optional(),
                secretKey: z.string().optional(),
                secretId: z.string().optional(),
                appId: z.string().optional()
            }).optional(),
            isDefault: z.boolean().optional(),
            enabled: z.boolean().optional()
        })

        const body = bodySchema.parse(await readBody(event))

        // 如果更新名称，检查是否已存在
        if (body.name) {
            const nameExists = await isConfigNameExistsDao(body.name, user.id, id)
            if (nameExists) {
                return resError(event, 400, '配置名称已存在')
            }
        }

        // 更新配置
        const config = await updateStorageConfigDao(id, user.id, body)

        if (!config) {
            return resError(event, 404, '配置不存在或无权修改')
        }

        // 清除适配器缓存
        clearAdapterCache(id)

        return resSuccess(event, '更新存储配置成功', {
            id: config.id,
            name: config.name,
            type: config.type,
            isDefault: config.isDefault,
            enabled: config.enabled
        })
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '更新存储配置失败'))
    }
})
