import { deleteProductService } from '~~/server/services/product/product.service'
/**
 * 删除产品（软删除）
 *
 * DELETE /api/v1/admin/products/:id
 */

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的产品ID')
    }

    try {
        await deleteProductService(id)
        return resSuccess(event, '删除产品成功', { deleted: true })
    } catch (error: any) {
        if (error.message === '产品不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('删除产品失败：', error)
        return resError(event, 500, '删除产品失败')
    }
})
