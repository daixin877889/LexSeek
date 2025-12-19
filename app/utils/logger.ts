/**
 * 日志工具
 * 提供统一的日志输出功能，支持不同级别的日志
 * @author LexSeek
 * @version 1.0.0
 */

// 日志级别枚举
export const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4  // 静默模式，不输出任何日志
} as const

export type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS]

// 日志级别名称映射
const LEVEL_NAMES: Record<number, string> = {
    [LOG_LEVELS.DEBUG]: 'DEBUG',
    [LOG_LEVELS.INFO]: 'INFO',
    [LOG_LEVELS.WARN]: 'WARN',
    [LOG_LEVELS.ERROR]: 'ERROR'
}

// 日志级别颜色
const LEVEL_COLORS: Record<number, string> = {
    [LOG_LEVELS.DEBUG]: '#6366f1', // 蓝色
    [LOG_LEVELS.INFO]: '#22c55e',  // 绿色
    [LOG_LEVELS.WARN]: '#f59e0b',  // 黄色
    [LOG_LEVELS.ERROR]: '#ef4444'  // 红色
}

class Logger {
    level: number
    prefix: string
    enableTimestamp: boolean
    enableStackTrace: boolean
    private _timers: Record<string, number>

    constructor() {
        // 根据环境设置默认日志级别
        this.level = this.getDefaultLogLevel()
        this.prefix = '[LexSeek]'
        this.enableTimestamp = true
        this.enableStackTrace = false
        this._timers = {}
    }

    /**
     * 获取默认日志级别
     * @returns {number} 日志级别
     */
    getDefaultLogLevel() {
        // 检测是否为生产环境
        const isProduction = this.isProductionEnvironment()

        // 在生产环境中显示 INFO 及以上级别的日志
        if (isProduction) {
            return LOG_LEVELS.INFO
        }
        // 其他环境显示所有日志
        return LOG_LEVELS.DEBUG
    }

    /**
     * 检测是否为生产环境
     * @returns {boolean} 是否为生产环境
     */
    isProductionEnvironment(): boolean {
        // Vite 环境变量检测
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            return import.meta.env.PROD === true || import.meta.env.MODE === 'production'
        }

        // Node.js 环境变量检测
        if (typeof globalThis !== 'undefined' && 'process' in globalThis) {
            const proc = (globalThis as Record<string, unknown>).process as { env?: Record<string, string> }
            return proc?.env?.NODE_ENV === 'production'
        }

        // 默认为开发环境
        return false
    }

    /**
     * 设置日志级别
     * @param {number} level - 日志级别
     */
    setLevel(level: number): void {
        if (level >= LOG_LEVELS.DEBUG && level <= LOG_LEVELS.SILENT) {
            this.level = level
        }
    }

    /**
     * 设置日志前缀
     * @param {string} prefix - 前缀
     */
    setPrefix(prefix: string): void {
        this.prefix = prefix
    }

    /**
     * 开启/关闭时间戳
     * @param {boolean} enable - 是否开启
     */
    setTimestamp(enable: boolean): void {
        this.enableTimestamp = enable
    }

    /**
     * 开启/关闭堆栈跟踪
     * @param {boolean} enable - 是否开启
     */
    setStackTrace(enable: boolean): void {
        this.enableStackTrace = enable
    }

    /**
     * 格式化时间戳
     * @returns {string} 格式化的时间戳
     */
    formatTimestamp(): string {
        const now = new Date()
        return now.toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        })
    }

    /**
     * 获取调用栈信息
     * @returns {string} 调用位置信息
     */
    getCallerInfo(): string {
        if (!this.enableStackTrace) return ''

        try {
            const stack = new Error().stack
            if (!stack) return ''
            const lines = stack.split('\n')
            // 跳过当前函数和log函数的调用栈
            const callerLine = lines[4] || lines[3] || ''
            const match = callerLine.match(/at\s+(.+)\s+\((.+):(\d+):(\d+)\)/) ||
                callerLine.match(/at\s+(.+):(\d+):(\d+)/)

            if (match) {
                const fileName = match[2] ? match[2].split('/').pop() : ''
                const lineNumber = match[3]
                return fileName ? ` (${fileName}:${lineNumber})` : ''
            }
        } catch {
            // 忽略错误
        }
        return ''
    }

    /**
     * 输出日志
     * @param {number} level - 日志级别
     * @param {Array} args - 日志参数
     */
    log(level: number, ...args: unknown[]): void {
        // 检查日志级别
        if (level < this.level || this.level === LOG_LEVELS.SILENT) {
            return
        }

        const levelName = LEVEL_NAMES[level]
        const color = LEVEL_COLORS[level]
        const timestamp = this.enableTimestamp ? `[${this.formatTimestamp()}]` : ''
        const callerInfo = this.getCallerInfo()
        const prefix = `${timestamp}${this.prefix}[${levelName}]${callerInfo}`

        // 根据日志级别选择合适的 console 方法
        const consoleMethod = this.getConsoleMethod(level)

        // 在浏览器环境中使用样式
        if (typeof window !== 'undefined') {
            consoleMethod(
                `%c${prefix}`,
                `color: ${color}; font-weight: bold;`,
                ...args
            )
        } else {
            consoleMethod(prefix, ...args)
        }
    }

    /**
     * 获取对应的 console 方法
     * @param {number} level - 日志级别
     * @returns {Function} console 方法
     */
    getConsoleMethod(level: number): (...args: unknown[]) => void {
        switch (level) {
            case LOG_LEVELS.DEBUG:
                // 在开发环境中，强制使用 console.log 确保 debug 日志可见
                // 很多浏览器默认会过滤 console.debug
                if (!this.isProductionEnvironment()) {
                    return console.log
                }
                return console.debug || console.log
            case LOG_LEVELS.INFO:
                return console.info || console.log
            case LOG_LEVELS.WARN:
                return console.warn
            case LOG_LEVELS.ERROR:
                return console.error
            default:
                return console.log
        }
    }

    /**
     * 调试日志
     * @param {...any} args - 日志参数
     */
    debug(...args: unknown[]): void {
        this.log(LOG_LEVELS.DEBUG, ...args)
    }

    /**
     * 信息日志
     * @param {...any} args - 日志参数
     */
    info(...args: unknown[]): void {
        this.log(LOG_LEVELS.INFO, ...args)
    }

    /**
     * 警告日志
     * @param {...any} args - 日志参数
     */
    warn(...args: unknown[]): void {
        this.log(LOG_LEVELS.WARN, ...args)
    }

    /**
     * 错误日志
     * @param {...any} args - 日志参数
     */
    error(...args: unknown[]): void {
        this.log(LOG_LEVELS.ERROR, ...args)
    }

    /**
     * 分组日志开始
     * @param {string} label - 分组标签
     * @param {boolean} collapsed - 是否折叠
     */
    group(label: string, collapsed = false): void {
        if (this.level === LOG_LEVELS.SILENT) return

        const method = collapsed ? console.groupCollapsed : console.group
        if (method) {
            method(`${this.prefix} ${label}`)
        } else {
            this.info(`=== ${label} ===`)
        }
    }

    /**
     * 分组日志结束
     */
    groupEnd(): void {
        if (this.level === LOG_LEVELS.SILENT) return

        if (console.groupEnd) {
            console.groupEnd()
        }
    }

    /**
     * 表格日志
     * @param {Array|Object} data - 表格数据
     */
    table(data: unknown[] | Record<string, unknown>): void {
        if (this.level > LOG_LEVELS.INFO || this.level === LOG_LEVELS.SILENT) return

        if (console.table) {
            console.table(data)
        } else {
            this.info('Table data:', data)
        }
    }

    /**
     * 计时开始
     * @param {string} label - 计时标签
     */
    time(label = 'default'): void {
        if (this.level === LOG_LEVELS.SILENT) return

        if (console.time) {
            console.time(`${this.prefix} ${label}`)
        } else {
            this._timers[label] = Date.now()
        }
    }

    /**
     * 计时结束
     * @param {string} label - 计时标签
     */
    timeEnd(label = 'default'): void {
        if (this.level === LOG_LEVELS.SILENT) return

        if (console.timeEnd) {
            console.timeEnd(`${this.prefix} ${label}`)
        } else {
            if (this._timers[label]) {
                const duration = Date.now() - this._timers[label]
                this.info(`${label}: ${duration}ms`)
                delete this._timers[label]
            }
        }
    }

    /**
     * 创建子日志实例
     * @param {string} namespace - 命名空间
     * @returns {Logger} 子日志实例
     */
    createNamespace(namespace: string): Logger {
        const childLogger = new Logger()
        childLogger.setLevel(this.level)
        childLogger.setPrefix(`${this.prefix}[${namespace}]`)
        childLogger.setTimestamp(this.enableTimestamp)
        childLogger.setStackTrace(this.enableStackTrace)
        return childLogger
    }
}

// 创建默认日志实例
const logger = new Logger()

// 导出默认实例和类
export { Logger }
export default logger

// 导出便捷方法
export const debug = (...args: unknown[]): void => logger.debug(...args)
export const info = (...args: unknown[]): void => logger.info(...args)
export const warn = (...args: unknown[]): void => logger.warn(...args)
export const error = (...args: unknown[]): void => logger.error(...args)
export const group = (label: string, collapsed?: boolean): void => logger.group(label, collapsed)
export const groupEnd = (): void => logger.groupEnd()
export const table = (data: unknown[] | Record<string, unknown>): void => logger.table(data)
export const time = (label?: string): void => logger.time(label)
export const timeEnd = (label?: string): void => logger.timeEnd(label)

// 设置日志级别的便捷方法
export const setLogLevel = (level: number): void => logger.setLevel(level)
export const setLogPrefix = (prefix: string): void => logger.setPrefix(prefix)
export const enableTimestamp = (enable = true): void => logger.setTimestamp(enable)
export const enableStackTrace = (enable = true): void => logger.setStackTrace(enable)

// 创建命名空间日志的便捷方法
export const createLogger = (namespace: string): Logger => logger.createNamespace(namespace) 