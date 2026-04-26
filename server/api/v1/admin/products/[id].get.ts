import { getProductByIdService } from '~~/server/services/product/product.service'
/**
 * 获取产品详情
 *
 * GET /api/v1/admin/products/:id
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的产品ID')
    }

    try {
        const product = await getProductByIdService(id)
        if (!product) {
            return resError(event, 404, '产品不存在')
        }

        return resSuccess(event, '获取产品详情成功', product)
    } catch (error) {
        logger.error('获取产品详情失败：', error)
        return resError(event, 500, '获取产品详情失败')
    }
})
