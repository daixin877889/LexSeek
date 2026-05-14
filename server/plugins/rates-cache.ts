import { refreshAllRatesCacheService } from '~~/server/services/rates/rates.service'

/**
 * 启动时从 DB 拉一次最新利率到 shared/utils/tools/data/ 模块缓存
 *
 * 失败不阻塞启动：模块默认 DEFAULT_*_RATES 兜底
 */
export default defineNitroPlugin(async () => {
    try {
        await refreshAllRatesCacheService()
        logger.info('[rates-cache] 利率缓存初始化完成')
    } catch (err) {
        logger.error('[rates-cache] 利率缓存初始化失败，使用 DEFAULT 兜底', err)
    }
})
