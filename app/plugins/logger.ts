/**
 * Logger 初始化插件
 * 
 * 根据 runtimeConfig 中的配置设置日志级别
 */
import { logger, LOG_LEVELS, type LogLevel } from '#shared/utils/logger'

export default defineNuxtPlugin(() => {
    const config = useRuntimeConfig()
    const logLevelName = (config.public.logLevel as string || 'DEBUG').toUpperCase()

    // 将字符串转换为日志级别
    const level = LOG_LEVELS[logLevelName as keyof typeof LOG_LEVELS] as LogLevel | undefined

    if (level !== undefined) {
        logger.setLevel(level)
    }
})
