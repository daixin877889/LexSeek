/**
 * File Transport
 *
 * Writes logs to files in the logs directory (Node.js server environment only).
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.1, 6.2
 */

import { type LogEntry, type Transport, getLevelName } from '../types'
import { LogFormatter } from '../formatter'

/**
 * 检测是否为 Node.js 服务端环境
 * 需要同时满足：没有 window 对象、有 process 对象、process.cwd 是函数
 */
function isNodeEnvironment(): boolean {
    return typeof window === 'undefined' &&
        typeof process !== 'undefined' &&
        typeof process.cwd === 'function'
}

/**
 * 检测是否为 Serverless 环境（只读文件系统）
 * 腾讯云 EdgeOne/SCF 等环境的工作目录通常是 /var/user
 */
function isServerlessEnvironment(): boolean {
    if (typeof process === 'undefined') return false
    const cwd = process.cwd?.()
    // 腾讯云 Serverless 环境特征
    if (cwd?.startsWith('/var/user')) return true
    // AWS Lambda 环境特征
    if (cwd?.startsWith('/var/task')) return true
    // 通过环境变量检测
    if (process.env.SERVERLESS || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SCF_RUNTIME) return true
    return false
}

/**
 * FileTransport class for writing logs to files.
 * Only available in Node.js environment.
 */
export class FileTransport implements Transport {
    private logsDir: string
    private fs: typeof import('fs') | null = null
    private path: typeof import('path') | null = null
    private initialized: boolean = false
    private initError: boolean = false
    private isNode: boolean = false
    private isServerless: boolean = false

    constructor(logsDir: string = 'logs') {
        this.logsDir = logsDir
        this.isNode = isNodeEnvironment()
        this.isServerless = isServerlessEnvironment()
        // 只在 Node.js 非 Serverless 环境初始化文件写入
        if (this.isNode && !this.isServerless) {
            this.initModules()
        } else if (this.isServerless) {
            // Serverless 环境下禁用文件日志，静默处理
            this.initError = true
        }
    }

    /**
     * Dynamically import Node.js modules.
     * This allows the class to be imported in browser without errors.
     */
    private async initModules(): Promise<void> {
        if (this.initialized || this.initError || !this.isNode || this.isServerless) return

        try {
            this.fs = await import('fs')
            this.path = await import('path')
            this.ensureLogsDir()
            this.initialized = true
        } catch (error) {
            this.initError = true
            // 只在非 Serverless 环境输出警告
            if (!this.isServerless) {
                console.warn('[FileTransport] Failed to initialize file system modules:', error)
            }
        }
    }

    /**
     * Ensure the logs directory exists.
     * Requirements: 3.2, 6.2
     */
    private ensureLogsDir(): void {
        if (!this.fs || !this.path || !this.isNode || this.isServerless) return

        try {
            const fullPath = this.path.resolve(process.cwd(), this.logsDir)
            if (!this.fs.existsSync(fullPath)) {
                this.fs.mkdirSync(fullPath, { recursive: true })
            }
        } catch (error) {
            this.initError = true
            // 只在非 Serverless 环境输出警告
            if (!this.isServerless) {
                console.warn(`[FileTransport] Failed to create logs directory: ${this.logsDir}`, error)
            }
        }
    }

    /**
     * Get the log file path for a given level and date.
     * Pattern: logs/{level}-{YYYY-MM-DD}.log
     * Requirements: 3.3, 3.4
     */
    getLogFilePath(level: number, date: Date): string {
        const levelName = getLevelName(level).toLowerCase()
        const year = date.getFullYear()
        const month = (date.getMonth() + 1).toString().padStart(2, '0')
        const day = date.getDate().toString().padStart(2, '0')
        const dateStr = `${year}-${month}-${day}`

        return `${this.logsDir}/${levelName}-${dateStr}.log`
    }

    /**
     * Write a log entry to the appropriate file.
     * Requirements: 3.1, 3.5, 3.6, 6.1
     */
    write(entry: LogEntry): void {
        // 非 Node.js 环境或 Serverless 环境直接跳过（静默处理，不输出到控制台）
        if (!this.isNode || this.isServerless) return

        if (this.initError) {
            // Fall back to console output
            console.log(LogFormatter.format(entry))
            return
        }

        // Ensure modules are loaded (sync check for already initialized)
        if (!this.initialized) {
            // Queue the write for after initialization
            this.initModules().then(() => this.writeToFile(entry))
            return
        }

        this.writeToFile(entry)
    }

    /**
     * Actually write the log entry to file.
     * Requirements: 3.5, 3.6, 6.1
     */
    private writeToFile(entry: LogEntry): void {
        if (!this.fs || !this.path || this.initError || !this.isNode) {
            console.log(LogFormatter.format(entry))
            return
        }

        try {
            const filePath = this.getLogFilePath(entry.level, entry.timestamp)
            const fullPath = this.path.resolve(process.cwd(), filePath)
            const formattedLog = LogFormatter.format(entry)

            // Append to file with newline
            // Requirements: 3.5 - append mode, no overwriting
            this.fs.appendFileSync(fullPath, formattedLog + '\n', { encoding: 'utf-8' })
        } catch (error) {
            // Requirements: 6.1 - fall back to console on file write failure
            console.warn('[FileTransport] Failed to write to log file, falling back to console:', error)
            console.log(LogFormatter.format(entry))
        }
    }
}
