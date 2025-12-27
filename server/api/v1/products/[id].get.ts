/**
 * 获取商品详情
 *
 * GET /api/v1/products/:id
 *
 * 返回指定 ID 的商品详情
 */
import { z } from 'zod'
import { getProductByIdService } from '~/server/services/product/product.service'

// 参数验证 schema
const paramsSchema = z.object({
    id: z.string().regex(/^\d+$/, 'ID 必须是数字').transform(Number),
})

export default defineEventHandler(async (event) => {
    try {
        // 验证路由参数
        const params = getRouterParams(event)
        const result = paramsSchema.safeParse(params)

        if (!result.success) {
            return resError(event, 400, result.error.errors[0].message)
        }

        const { id } = result.data

        // 获取商品详情
        const product = await getProductByIdService(id)

        if (!product) {
            return resError(event, 404, '商品不存在')
        }

        return resSuccess(event, '获取商品详情成功', product)
    } catch (error) {
        logger.error('获取商品详情失败：', error)
        return resError(event, 500, '获取商品详情失败')
    }
})
