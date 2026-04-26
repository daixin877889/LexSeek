/**
 * 创建产品
 *
 * POST /api/v1/admin/products
 */

import { z } from 'zod'
import { ProductType, ProductStatus } from '#shared/types/product'
import { createProductService } from '~~/server/services/product/product.service'

/** 请求体验证 */
const bodySchema = z.object({
    name: z.string().min(1, '名称不能为空').max(100, '名称最多100个字符'),
    description: z.string().max(500, '描述最多500个字符').optional(),
    type: z.nativeEnum(ProductType, { error: '产品类型无效' }),
    category: z.string().max(50, '分类最多50个字符').optional(),
    levelId: z.number().int().positive('会员级别ID必须为正整数').optional(),
    priceMonthly: z.number().min(0, '月付价格不能为负').optional(),
    priceYearly: z.number().min(0, '年付价格不能为负').optional(),
    defaultDuration: z.number().int().min(1, '默认时长至少为1').optional(),
    unitPrice: z.number().min(0, '单价不能为负').optional(),
    originalPriceMonthly: z.number().min(0, '原月付价格不能为负').optional(),
    originalPriceYearly: z.number().min(0, '原年付价格不能为负').optional(),
    originalUnitPrice: z.number().min(0, '原单价不能为负').optional(),
    minQuantity: z.number().int().min(1, '最小购买数量至少为1').optional(),
    maxQuantity: z.number().int().min(1, '最大购买数量至少为1').optional(),
    purchaseLimit: z.number().int().min(0, '购买限制不能为负').optional(),
    pointAmount: z.number().int().min(0, '积分数量不能为负').optional(),
    giftPoint: z.number().int().min(0, '赠送积分不能为负').optional(),
    status: z.nativeEnum(ProductStatus, { error: '产品状态无效' }).optional(),
    sortOrder: z.number().int().min(0, '排序值不能为负').optional(),
})

export default defineEventHandler(async (event) => {
    // 验证请求体
    const body = await readBody(event)
    const result = bodySchema.safeParse(body)
    if (!result.success) {
        return resError(event, 400, '参数错误：' + result.error.issues[0]!!.message)
    }

    try {
        const product = await createProductService(result.data)
        return resSuccess(event, '创建产品成功', product)
    } catch (error) {
        logger.error('创建产品失败：', error)
        return resError(event, 500, '创建产品失败')
    }
})
