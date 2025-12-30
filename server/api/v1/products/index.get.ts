/**
 * 获取商品列表
 *
 * GET /api/v1/products
 *
 * 返回所有上架商品列表
 */
// import { z } from 'zod'
// import { getActiveProductsService } from '~/server/services/product/product.service'
// import { ProductType } from '#shared/types/product'

// 查询参数验证 schema
const querySchema = z.object({
    type: z.string().regex(/^[12]$/).transform(Number).optional(),
})

export default defineEventHandler(async (event) => {
    try {
        // 获取当前登录用户（可选）
        const user = event.context.auth?.user

        // 验证查询参数
        const query = getQuery(event)
        const result = querySchema.safeParse(query)

        if (!result.success) {
            return resError(event, 400, result.error.issues[0].message)
        }

        const { type } = result.data

        // 获取商品列表
        let products = await getActiveProductsService(type as ProductType)

        // 如果用户已登录，过滤掉已达购买限制的商品
        if (user) {
            products = await filterProductsByPurchaseLimitService(user.id, products)
        }

        return resSuccess(event, '获取商品列表成功', products)
    } catch (error) {
        logger.error('获取商品列表失败：', error)
        return resError(event, 500, '获取商品列表失败')
    }
})
