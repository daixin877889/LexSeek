import { syncLPRRatesService } from '~~/server/services/rates/lprSync.service'
import { withDistributedLock } from '~~/server/utils/cron'

export default defineEventHandler(async (event) => {
    const user = event.context.auth?.user
    if (!user) return resError(event, 401, '请先登录')

    try {
        const result = await withDistributedLock(
            'cron:lock:lpr-daily-sync',
            60,
            () => syncLPRRatesService({ triggeredBy: 'manual', operatorId: user.id }),
        )

        if (result === null) {
            return resError(event, 409, '已有同步任务在执行中，请稍后再试')
        }
        return resSuccess(event, '同步成功', result)
    } catch (err) {
        logger.error('手动同步 LPR 失败', err)
        const msg = err instanceof Error ? err.message : '同步失败'
        return resError(event, 500, msg)
    }
})
