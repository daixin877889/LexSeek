/**
 * Logger Core Class
 *
 * 核心日志类，管理日志级别、前缀和传输层。
 * 自动检测运行环境并配置相应的传输层。
 * Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3
 */

import {
    type LogEntry,
    type LogLevel,
    type LoggerOptions,
    type Transport,
    LOG_LEVELS,
} from './types'
import { ConsoleTransport, FileTransport } from './transports'

/**
 * Logger 类 - 通用日志记录器
 *
 * 提供统一的日志 API，支持浏览器和 Node.js 环境。
 * - 浏览器环境：输出到控制台，带颜色样式
 * - Node.js 环境：同时输出到控制台和文件
 */
export class Logger {
    /** 当前日志级别 */
    level: LogLevel

    /** 日志前缀 */
    prefix: string

    /** 是否启用时间戳 */
    enableTimestamp: boolean

    /** 传输层列表 */
    private transports: Transport[]

    /** 是否为浏览器环境 */
    private isBrowser: boolean

    /**
     * 创建 Logger 实例
     *
     * @param options - 配置选项
     * Requirements: 1.2 - 自动检测运行环境
     * Requirements: 4.1, 4.2 - 根据环境设置默认日志级别
     */
    constructor(options: LoggerOptions = {}) {
        // 检测运行环境
        // Requirements: 1.2
        this.isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined'

        // 设置默认日志级别
        // Requirements: 4.1 - 生产环境默认 INFO
        // Requirements: 4.2 - 开发环境默认 DEBUG
        const isProduction = this.detectProductionEnvironment()
        const defaultLevel = isProduction ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG

        this.level = options.level ?? defaultLevel
        this.prefix = options.prefix ?? ''
        this.enableTimestamp = options.enableTimestamp ?? true

        // 配置传输层
        // Requirements: 1.2 - 根据环境自动配置
        this.transports = options.transports ?? this.createDefaultTransports()
    }

    /**
     * 检测是否为生产环境
     */
    private detectProductionEnvironment(): boolean {
        // Node.js 环境
        if (typeof process !== 'undefined' && process.env) {
            return process.env.NODE_ENV === 'production'
        }

        // 浏览器环境 - 检查 Nuxt 或其他框架的环境变量
        if (this.isBrowser && typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>
            const nuxtConfig = win.__NUXT__ as { config?: { public?: { nodeEnv?: string } } } | undefined
            const nuxtEnv = nuxtConfig?.config?.public?.nodeEnv
            if (nuxtEnv) {
                return nuxtEnv === 'production'
            }
        }

        // 默认为开发环境
        return false
    }

    /**
     * 创建默认传输层
     * Requirements: 1.2 - 浏览器使用 ConsoleTransport，服务端使用 Console + File
     */
    private createDefaultTransports(): Transport[] {
        const transports: Transport[] = [new ConsoleTransport()]

        // 服务端环境添加文件传输
        if (!this.isBrowser) {
            transports.push(new FileTransport())
        }

        return transports
    }

    /**
     * 设置日志级别
     * Requirements: 4.3, 4.4
     *
     * @param level - 新的日志级别
     */
    setLevel(level: LogLevel): void {
        this.level = level
    }

    /**
     * 设置日志前缀
     *
     * @param prefix - 新的前缀
     */
    setPrefix(prefix: string): void {
        this.prefix = prefix
    }

    /**
     * 设置是否启用时间戳
     *
     * @param enabled - 是否启用
     */
    setTimestamp(enabled: boolean): void {
        this.enableTimestamp = enabled
    }

    /**
     * 输出 DEBUG 级别日志
     * Requirements: 1.1
     *
     * @param message - 日志消息
     * @param args - 附加参数
     */
    debug(message: string, ...args: unknown[]): void {
        this.log(LOG_LEVELS.DEBUG, message, args)
    }

    /**
     * 输出 INFO 级别日志
     * Requirements: 1.1
     *
     * @param message - 日志消息
     * @param args - 附加参数
     */
    info(message: string, ...args: unknown[]): void {
        this.log(LOG_LEVELS.INFO, message, args)
    }

    /**
     * 输出 WARN 级别日志
     * Requirements: 1.1
     *
     * @param message - 日志消息
     * @param args - 附加参数
     */
    warn(message: string, ...args: unknown[]): void {
        this.log(LOG_LEVELS.WARN, message, args)
    }

    /**
     * 输出 ERROR 级别日志
     * Requirements: 1.1
     *
     * @param message - 日志消息
     * @param args - 附加参数
     */
    error(message: string, ...args: unknown[]): void {
        this.log(LOG_LEVELS.ERROR, message, args)
    }

    /**
     * 核心日志方法，带级别过滤
     * Requirements: 4.3 - 只输出 >= 当前级别的日志
     * Requirements: 1.3 - 格式化消息
     *
     * @param level - 日志级别
     * @param message - 日志消息
     * @param args - 附加参数
     */
    private log(level: LogLevel, message: string, args: unknown[]): void {
        // 级别过滤
        // Requirements: 4.3 - 只输出 >= 当前级别的日志
        // Requirements: 4.4 - SILENT 级别抑制所有输出
        if (level < this.level) {
            return
        }

        // 创建日志条目
        // Requirements: 1.3 - 格式化消息
        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            prefix: this.prefix,
            message,
            args,
        }

        // 写入所有传输层
        for (const transport of this.transports) {
            try {
                transport.write(entry)
            } catch (error) {
                // 传输层错误不应影响其他传输层
                console.error('[Logger] Transport write error:', error)
            }
        }
    }

    /**
     * 创建命名空间子日志器
     * Requirements: 5.1, 5.2, 5.3
     *
     * @param namespace - 命名空间名称
     * @returns 新的 Logger 实例
     */
    createNamespace(namespace: string): Logger {
        // Requirements: 5.2 - 组合父前缀和新命名空间
        const newPrefix = this.prefix ? `${this.prefix}][${namespace}` : namespace

        // Requirements: 5.3 - 继承父级设置
        return new Logger({
            level: this.level,
            prefix: newPrefix,
            enableTimestamp: this.enableTimestamp,
            transports: this.transports,
        })
    }

    /**
     * 添加传输层
     *
     * @param transport - 传输层实例
     */
    addTransport(transport: Transport): void {
        this.transports.push(transport)
    }

    /**
     * 移除所有传输层
     */
    clearTransports(): void {
        this.transports = []
    }
}
