/**
 * 删除用户存储配置
 *
 * DELETE /api/v1/storage/config/:id
 */

// import { deleteStorageConfigDao } from '~~/server/services/storage/storage-config.dao'
// import { clearAdapterCache } from '~~/server/services/storage/storage.service'

export default defineEventHandler(async (event) => {
    try {
        const user = event.context.auth.user
        const id = Number(getRouterParam(event, 'id'))

        if (!id || isNaN(id)) {
            return resError(event, 400, '无效的配置 ID')
        }

        // 删除配置
        const deleted = await deleteStorageConfigDao(id, user.id)

        if (!deleted) {
            return resError(event, 404, '配置不存在或无权删除')
        }

        // 清除适配器缓存
        clearAdapterCache(id)

        return resSuccess(event, '删除存储配置成功', { id })
    } catch (error) {
        return resError(event, 500, parseErrorMessage(error, '删除存储配置失败'))
    }
})
