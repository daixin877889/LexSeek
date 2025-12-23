/**
 * Logger 初始化插件
 * 
 * 根据 runtimeConfig 中的配置设置日志级别
 * 支持客户端和服务端环境
 */
import { logger, LOG_LEVELS, type LogLevel } from '#shared/utils/logger'

export default defineNuxtPlugin({
    name: 'logger',
    // 确保在其他插件之前执行
    enforce: 'pre',
    setup() {
        const config = useRuntimeConfig()
        const logLevelName = (config.public.logLevel as string || 'DEBUG').toUpperCase()

        // 将字符串转换为日志级别
        const level = LOG_LEVELS[logLevelName as keyof typeof LOG_LEVELS] as LogLevel | undefined

        if (level !== undefined) {
            logger.setLevel(level)
        }

        // 在开发环境下输出日志配置信息
        if (import.meta.dev) {
            const env = import.meta.server ? 'Server' : 'Client'
            logger.debug(`[${env}] Logger initialized with level: ${logLevelName}`)
        }
    }
})
