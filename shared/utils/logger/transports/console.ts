/**
 * Console Transport
 *
 * Outputs logs to browser or Node.js console with appropriate formatting.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { type LogEntry, type Transport, LOG_LEVELS, getLevelName } from '../types'
import { LogFormatter } from '../formatter'

/**
 * Color configuration for browser console output.
 * Requirements: 2.3, 2.4, 2.5, 2.6
 */
const BROWSER_COLORS: Record<number, string> = {
    [LOG_LEVELS.DEBUG]: '#6366f1', // Blue
    [LOG_LEVELS.INFO]: '#22c55e', // Green
    [LOG_LEVELS.WARN]: '#f59e0b', // Yellow
    [LOG_LEVELS.ERROR]: '#ef4444', // Red
}

/**
 * ConsoleTransport class for outputting logs to console.
 * Automatically detects browser vs Node.js environment and applies appropriate formatting.
 */
export class ConsoleTransport implements Transport {
    private isBrowser: boolean

    constructor() {
        // Detect browser vs Node.js environment
        this.isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined'
    }

    /**
     * Write a log entry to the console.
     * Requirements: 2.1
     */
    write(entry: LogEntry): void {
        if (this.isBrowser) {
            this.writeForBrowser(entry)
        } else {
            this.writeForNode(entry)
        }
    }

    /**
     * Format and output log for browser console with color styling.
     * Requirements: 2.2, 2.3, 2.4, 2.5, 2.6
     */
    private writeForBrowser(entry: LogEntry): void {
        const timestamp = LogFormatter.formatTimestamp(entry.timestamp)
        const levelName = getLevelName(entry.level)
        const prefix = entry.prefix ? `[${entry.prefix}]` : ''
        const color = BROWSER_COLORS[entry.level] || BROWSER_COLORS[LOG_LEVELS.INFO]

        // Format: %c[timestamp][prefix][level] message
        const formatString = `%c[${timestamp}]${prefix}[${levelName}]`
        const style = `color: ${color}; font-weight: bold;`
        const message = LogFormatter.formatMessage(entry.message, entry.args)

        const consoleMethod = this.getConsoleMethod(entry.level)
        consoleMethod(formatString, style, message)
    }

    /**
     * Format and output log for Node.js console.
     */
    private writeForNode(entry: LogEntry): void {
        const formattedLog = LogFormatter.format(entry)
        const consoleMethod = this.getConsoleMethod(entry.level)
        consoleMethod(formattedLog)
    }

    /**
     * Get the appropriate console method based on log level.
     */
    private getConsoleMethod(level: number): (...args: unknown[]) => void {
        switch (level) {
            case LOG_LEVELS.DEBUG:
                return console.debug.bind(console)
            case LOG_LEVELS.INFO:
                return console.info.bind(console)
            case LOG_LEVELS.WARN:
                return console.warn.bind(console)
            case LOG_LEVELS.ERROR:
                return console.error.bind(console)
            default:
                return console.log.bind(console)
        }
    }
}
