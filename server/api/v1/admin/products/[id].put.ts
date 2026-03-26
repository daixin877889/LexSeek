/**
 * 更新产品
 *
 * PUT /api/v1/admin/products/:id
 */

import { z } from 'zod'
import { ProductStatus } from '#shared/types/product'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string().min(1, '名称不能为空').max(100, '名称最多100个字符').optional(),
    description: z.string().max(500, '描述最多500个字符').nullable().optional(),
    category: z.string().max(50, '分类最多50个字符').nullable().optional(),
    priceMonthly: z.number().min(0, '月付价格不能为负').nullable().optional(),
    priceYearly: z.number().min(0, '年付价格不能为负').nullable().optional(),
    defaultDuration: z.number().int().min(1, '默认时长至少为1').nullable().optional(),
    unitPrice: z.number().min(0, '单价不能为负').nullable().optional(),
    originalPriceMonthly: z.number().min(0, '原月付价格不能为负').nullable().optional(),
    originalPriceYearly: z.number().min(0, '原年付价格不能为负').nullable().optional(),
    originalUnitPrice: z.number().min(0, '原单价不能为负').nullable().optional(),
    minQuantity: z.number().int().min(1, '最小购买数量至少为1').nullable().optional(),
    maxQuantity: z.number().int().min(1, '最大购买数量至少为1').nullable().optional(),
    purchaseLimit: z.number().int().min(0, '购买限制不能为负').nullable().optional(),
    pointAmount: z.number().int().min(0, '积分数量不能为负').nullable().optional(),
    giftPoint: z.number().int().min(0, '赠送积分不能为负').nullable().optional(),
    status: z.nativeEnum(ProductStatus).optional(),
    sortOrder: z.number().int().min(0, '排序值不能为负').optional(),
})

export default defineEventHandler(async (event) => {
    // 获取路由参数
    const id = parseInt(getRouterParam(event, 'id') || '')
    if (isNaN(id)) {
        return resError(event, 400, '无效的产品ID')
    }

    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        // 将 null 转换为 undefined 以匹配 UpdateProductParams 类型
        const updateData = {
            ...result.data,
            description: result.data.description ?? undefined,
            category: result.data.category ?? undefined,
            priceMonthly: result.data.priceMonthly ?? undefined,
            priceYearly: result.data.priceYearly ?? undefined,
            defaultDuration: result.data.defaultDuration ?? undefined,
            unitPrice: result.data.unitPrice ?? undefined,
            originalPriceMonthly: result.data.originalPriceMonthly ?? undefined,
            originalPriceYearly: result.data.originalPriceYearly ?? undefined,
            originalUnitPrice: result.data.originalUnitPrice ?? undefined,
            minQuantity: result.data.minQuantity ?? undefined,
            maxQuantity: result.data.maxQuantity ?? undefined,
            purchaseLimit: result.data.purchaseLimit ?? undefined,
            pointAmount: result.data.pointAmount ?? undefined,
            giftPoint: result.data.giftPoint ?? undefined,
        }
        const product = await updateProductService(id, updateData)
        return resSuccess(event, '更新产品成功', product)
    } catch (error: any) {
        if (error.message === '产品不存在') {
            return resError(event, 404, error.message)
        }
        logger.error('更新产品失败：', error)
        return resError(event, 500, '更新产品失败')
    }
})
