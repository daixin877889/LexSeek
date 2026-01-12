/**
 * 获取启用的案件类型列表（前台）
 *
 * GET /api/v1/case-types
 * 返回所有启用状态的案件类型，按优先级排序
 * Requirements: 11.1
 */

export default defineEventHandler(async (event) => {
    try {
        const list = await getEnabledCaseTypesService()
        return resSuccess(event, '获取案件类型列表成功', {
            items: list,
        })
    } catch (error) {
        logger.error('获取案件类型列表失败：', error)
        return resError(event, 500, '获取案件类型列表失败')
    }
})
