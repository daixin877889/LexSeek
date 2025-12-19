/**
 * Log Parser
 *
 * Parses formatted log strings back into LogEntry objects.
 * Requirements: 7.2
 */

import { type LogEntry, type LogLevel, getLevelValue, LOG_LEVELS } from './types'

/**
 * Parsed log entry without args (args cannot be recovered from string).
 */
export interface ParsedLogEntry {
    timestamp: Date
    level: LogLevel
    prefix: string
    message: string
}

/**
 * LogParser class for parsing formatted log strings.
 */
export class LogParser {
    /**
     * Regular expression to match log format: [timestamp][prefix][level] message
     * Captures: timestamp, optional prefix parts, level, message
     */
    private static readonly LOG_PATTERN =
        /^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]((?:\[[^\]]*\])*)\[([A-Z]+)\]\s(.*)$/

    /**
     * Parse a formatted log string back into its components.
     * Returns null for invalid log strings.
     */
    static parse(logString: string): ParsedLogEntry | null {
        if (!logString || typeof logString !== 'string') {
            return null
        }

        const match = logString.match(this.LOG_PATTERN)
        if (!match || match.length < 5) {
            return null
        }

        const timestampStr = match[1]!
        const prefixPart = match[2] ?? ''
        const levelStr = match[3]!
        const message = match[4]!

        const timestamp = this.parseTimestamp(timestampStr)
        if (!timestamp) {
            return null
        }

        const level = this.parseLevel(levelStr)
        if (level === null) {
            return null
        }

        const prefix = this.parsePrefix(prefixPart)

        return {
            timestamp,
            level,
            prefix,
            message,
        }
    }

    /**
     * Parse timestamp string (HH:mm:ss.SSS) to Date.
     * Uses today's date with the parsed time.
     */
    private static parseTimestamp(timestampStr: string): Date | null {
        const parts = timestampStr.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/)
        if (!parts || parts.length < 5) {
            return null
        }

        const hours = parts[1]!
        const minutes = parts[2]!
        const seconds = parts[3]!
        const milliseconds = parts[4]!

        const date = new Date()
        date.setHours(
            parseInt(hours, 10),
            parseInt(minutes, 10),
            parseInt(seconds, 10),
            parseInt(milliseconds, 10)
        )

        return date
    }


    /**
     * Parse level string to LogLevel.
     * Returns null for invalid level strings.
     */
    private static parseLevel(levelStr: string): LogLevel | null {
        const upperLevel = levelStr.toUpperCase()
        if (upperLevel in LOG_LEVELS) {
            return getLevelValue(upperLevel)
        }
        return null
    }

    /**
     * Parse prefix part from log string.
     * Extracts content from [prefix] format, handling nested prefixes.
     */
    private static parsePrefix(prefixPart: string): string {
        if (!prefixPart) {
            return ''
        }

        // Extract all bracket contents and join with ']['
        const matches = prefixPart.match(/\[([^\]]*)\]/g)
        if (!matches) {
            return ''
        }

        // Remove brackets and join
        const prefixes = matches.map((m) => m.slice(1, -1))
        return prefixes.join('][')
    }
}
