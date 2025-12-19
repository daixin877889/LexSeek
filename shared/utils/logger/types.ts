/**
 * Logger Types and Interfaces
 * 
 * Core type definitions for the universal logger system.
 * Requirements: 1.1, 1.3
 */

/**
 * Log level constants with numeric values for comparison.
 * Lower values = more verbose, higher values = less verbose.
 */
export const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4,
} as const

/**
 * Log level type derived from LOG_LEVELS constant.
 */
export type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS]

/**
 * Log level name type for string representations.
 */
export type LogLevelName = keyof typeof LOG_LEVELS

/**
 * Log entry data structure for passing log information between components.
 */
export interface LogEntry {
    /** Timestamp when the log was created */
    timestamp: Date
    /** Numeric log level */
    level: LogLevel
    /** Log prefix (e.g., "[LexSeek][SMS]") */
    prefix: string
    /** Log message content */
    message: string
    /** Additional arguments passed to the log method */
    args: unknown[]
}

/**
 * Transport interface for log output destinations.
 * Implementations handle writing logs to specific targets (console, file, etc.).
 */
export interface Transport {
    /** Write a log entry to the transport destination */
    write(entry: LogEntry): void
}

/**
 * Logger configuration options.
 */
export interface LoggerOptions {
    /** Initial log level (defaults based on environment) */
    level?: LogLevel
    /** Log prefix string */
    prefix?: string
    /** Whether to include timestamps in output */
    enableTimestamp?: boolean
    /** Custom transports (auto-configured if not provided) */
    transports?: Transport[]
}

/**
 * Helper function to get log level name from numeric value.
 */
export function getLevelName(level: LogLevel): LogLevelName {
    const entries = Object.entries(LOG_LEVELS) as [LogLevelName, LogLevel][]
    const found = entries.find(([_, value]) => value === level)
    return found ? found[0] : 'INFO'
}

/**
 * Helper function to get numeric log level from name.
 */
export function getLevelValue(name: string): LogLevel {
    const upperName = name.toUpperCase() as LogLevelName
    return LOG_LEVELS[upperName] ?? LOG_LEVELS.INFO
}
