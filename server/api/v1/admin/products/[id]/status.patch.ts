import { toggleProductStatusService } from '~~/server/services/product/product.service'
/**
 * 切换产品状态
 *
 * PATCH /api/v1/admin/products/:id/status
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的产品ID')
    }

    try {
        const product = await toggleProductStatusService(id)
        return resSuccess(event, '切换产品状态成功', product)
    } catch (error: any) {
        if (error.message === '产品不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('切换产品状态失败：', error)
        return resError(event, 500, '切换产品状态失败')
    }
})
