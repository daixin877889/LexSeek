/**
 * Universal Logger - Main Entry Point
 *
 * 通用日志工具的主入口文件，导出 Logger 类、类型和便捷函数。
 * Requirements: 1.1
 */

// 导出类型
export {
    LOG_LEVELS,
    type LogLevel,
    type LogLevelName,
    type LogEntry,
    type Transport,
    type LoggerOptions,
    getLevelName,
    getLevelValue,
} from './types'

// 导出格式化器和解析器
export { LogFormatter } from './formatter'
export { LogParser } from './parser'

// 导出传输层
export { ConsoleTransport, FileTransport } from './transports'

// 导出 Logger 类
export { Logger } from './logger'

// 延迟初始化 logger 实例（避免循环依赖）
import { Logger } from './logger'
import { type LogLevel } from './types'

let _logger: Logger | null = null

function getDefaultLogger(): Logger {
    if (!_logger) {
        _logger = new Logger({ prefix: 'LexSeek' })
    }
    return _logger
}

/**
 * 默认 logger 实例，使用 'LexSeek' 前缀（延迟初始化）
 */
export const logger = new Proxy({} as Logger, {
    get(_target, prop) {
        return (getDefaultLogger() as any)[prop as string]
    },
})

/**
 * 便捷函数：输出 DEBUG 级别日志
 */
export function debug(message: string, ...args: unknown[]): void {
    getDefaultLogger().debug(message, ...args)
}

/**
 * 便捷函数：输出 INFO 级别日志
 */
export function info(message: string, ...args: unknown[]): void {
    getDefaultLogger().info(message, ...args)
}

/**
 * 便捷函数：输出 WARN 级别日志
 */
export function warn(message: string, ...args: unknown[]): void {
    getDefaultLogger().warn(message, ...args)
}

/**
 * 便捷函数：输出 ERROR 级别日志
 */
export function error(message: string, ...args: unknown[]): void {
    getDefaultLogger().error(message, ...args)
}

/**
 * 便捷函数：设置全局日志级别
 */
export function setLogLevel(level: LogLevel): void {
    getDefaultLogger().setLevel(level)
}

/**
 * 便捷函数：设置全局日志前缀
 */
export function setLogPrefix(prefix: string): void {
    getDefaultLogger().setPrefix(prefix)
}

/**
 * 便捷函数：启用/禁用时间戳
 */
export function enableTimestamp(enabled: boolean): void {
    getDefaultLogger().setTimestamp(enabled)
}

/**
 * 便捷函数：创建命名空间 logger
 */
export function createLogger(namespace: string) {
    return getDefaultLogger().createNamespace(namespace)
}
