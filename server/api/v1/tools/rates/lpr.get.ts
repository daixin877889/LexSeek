import { listLPRRatesService } from '~~/server/services/rates/rates.service'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')
    try {
        const data = await listLPRRatesService()
        return resSuccess(event, '查询成功', data)
    } catch (err) {
        logger.error('查询 LPR 利率失败', err)
        return resError(event, 500, '查询失败')
    }
})
