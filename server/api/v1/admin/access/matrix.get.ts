/**
 * 获取权限矩阵
 *
 * GET /api/v1/admin/access/matrix
 * Requirements: 15.9
 *
 * 返回所有会员级别与节点的权限关系矩阵
 */

export default defineEventHandler(async (event) => {
    try {
        const data = await getAccessMatrixService()
        return resSuccess(event, '获取权限矩阵成功', data)
    } catch (error) {
        logger.error('获取权限矩阵失败：', error)
        return resError(event, 500, '获取权限矩阵失败')
    }
})
