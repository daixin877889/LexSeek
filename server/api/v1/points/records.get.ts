/**
 * 获取用户积分记录列表
 * GET /api/v1/points/records
 */

// 请求参数验证 schema
const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    sourceType: z.coerce.number().int().optional(),
})

export default defineEventHandler(async (event) => {
    const logger = createLogger('points')
    const user = event.context.auth.user

    try {
        // 验证请求参数
        const query = getQuery(event)
        const validatedQuery = querySchema.parse(query)

        // 获取积分记录列表
        const result = await getUserPointRecords(user.id, {
            page: validatedQuery.page,
            pageSize: validatedQuery.pageSize,
            sourceType: validatedQuery.sourceType,
        })

        return resSuccess(event, '获取积分记录成功', result)
    } catch (error) {
        // Zod 验证错误
        if (error instanceof z.ZodError) {
            return resError(event, 400, '参数验证失败：' + error.issues.map(e => e.message).join(', '))
        }

        logger.error('获取积分记录失败：', error)
        return resError(event, 500, '获取积分记录失败')
    }
})
