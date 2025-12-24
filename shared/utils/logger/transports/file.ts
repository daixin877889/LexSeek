/**
 * File Transport
 *
 * Writes logs to files in the logs directory (Node.js server environment only).
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 6.1, 6.2
 */

import { type LogEntry, type LogLevel, type Transport, getLevelName } from '../types'
import { LogFormatter } from '../formatter'

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

    constructor(logsDir: string = 'logs') {
        this.logsDir = logsDir
        this.initModules()
    }

    /**
     * 检测是否为 serverless 环境（只读文件系统）
     */
    private isServerlessEnvironment(): boolean {
        // 常见的 serverless 环境标识
        return !!(
            process.env.VERCEL ||
            process.env.NETLIFY ||
            process.env.AWS_LAMBDA_FUNCTION_NAME ||
            process.env.TENCENT_CLOUD ||
            process.env.EDGEONE ||
            // 腾讯云 EdgeOne/Pages 的路径特征
            process.cwd?.()?.startsWith('/var/user')
        )
    }

    /**
     * Dynamically import Node.js modules.
     * This allows the class to be imported in browser without errors.
     */
    private async initModules(): Promise<void> {
        if (this.initialized || this.initError) return

        try {
            // Only import in Node.js environment
            if (typeof window === 'undefined') {
                // 在 serverless 环境中禁用文件日志
                if (this.isServerlessEnvironment()) {
                    this.initError = true
                    return
                }

                this.fs = await import('fs')
                this.path = await import('path')
                this.ensureLogsDir()
                this.initialized = true
            }
        } catch (error) {
            this.initError = true
            // 静默处理，不打印警告
        }
    }

    /**
     * Ensure the logs directory exists.
     * Requirements: 3.2, 6.2
     */
    private ensureLogsDir(): void {
        if (!this.fs || !this.path) return

        try {
            const cwd = process.cwd()
            const fullPath = this.path.resolve(cwd, this.logsDir)

            // 先检查目录是否可写
            if (!this.fs.existsSync(fullPath)) {
                this.fs.mkdirSync(fullPath, { recursive: true })
            }
        } catch {
            // 静默失败，禁用文件日志
            this.initError = true
        }
    }

    /**
     * Get the log file path for a given level and date.
     * Pattern: logs/{level}-{YYYY-MM-DD}.log
     * Requirements: 3.3, 3.4
     */
    getLogFilePath(level: LogLevel, date: Date): string {
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
        // Skip if not in Node.js environment or initialization failed
        if (typeof window !== 'undefined') return
        if (this.initError) {
            // serverless 环境中静默跳过文件日志，由 ConsoleTransport 处理
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
        if (!this.fs || !this.path || this.initError) {
            return
        }

        try {
            const cwd = process.cwd()
            const filePath = this.getLogFilePath(entry.level, entry.timestamp)
            const fullPath = this.path.resolve(cwd, filePath)
            const formattedLog = LogFormatter.format(entry)

            // Append to file with newline
            // Requirements: 3.5 - append mode, no overwriting
            this.fs.appendFileSync(fullPath, formattedLog + '\n', { encoding: 'utf-8' })
        } catch {
            // 静默失败，禁用后续文件写入
            this.initError = true
        }
    }
}
