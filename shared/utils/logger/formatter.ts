/**
 * Log Formatter
 *
 * Formats LogEntry objects into standardized log strings.
 * Requirements: 7.1, 6.3
 */

import { type LogEntry, getLevelName } from './types'

/**
 * LogFormatter class for converting LogEntry to formatted strings.
 */
export class LogFormatter {
    /**
     * Format a timestamp to HH:mm:ss.SSS format.
     */
    static formatTimestamp(date: Date): string {
        const hours = date.getHours().toString().padStart(2, '0')
        const minutes = date.getMinutes().toString().padStart(2, '0')
        const seconds = date.getSeconds().toString().padStart(2, '0')
        const milliseconds = date.getMilliseconds().toString().padStart(3, '0')
        return `${hours}:${minutes}:${seconds}.${milliseconds}`
    }

    /**
     * Format a LogEntry to the standard log string format.
     * Format: [timestamp][prefix][level] message
     */
    static format(entry: LogEntry): string {
        const timestamp = this.formatTimestamp(entry.timestamp)
        const levelName = getLevelName(entry.level)
        const prefix = entry.prefix ? `[${entry.prefix}]` : ''
        const message = this.formatMessage(entry.message, entry.args)

        return `[${timestamp}]${prefix}[${levelName}] ${message}`
    }

    /**
     * Format the message with additional arguments.
     * Safely serializes objects and errors.
     */
    static formatMessage(message: string, args: unknown[]): string {
        if (args.length === 0) {
            return message
        }

        const serializedArgs = args.map((arg) => this.safeSerialize(arg))
        return `${message} ${serializedArgs.join(' ')}`
    }

    /**
     * Safely serialize any value to a string without throwing exceptions.
     * Handles objects, errors, circular references, undefined, null, symbols.
     * Requirements: 6.3
     */
    static safeSerialize(value: unknown): string {
        if (value === undefined) {
            return 'undefined'
        }

        if (value === null) {
            return 'null'
        }

        if (typeof value === 'symbol') {
            return `Symbol(${value.description ?? ''})`
        }

        if (typeof value === 'function') {
            return `[Function: ${value.name || 'anonymous'}]`
        }

        if (value instanceof Error) {
            return this.serializeError(value)
        }

        if (typeof value === 'object') {
            return this.serializeObject(value)
        }

        return String(value)
    }


    /**
     * Serialize an Error object to a string.
     */
    private static serializeError(error: Error): string {
        const name = error.name || 'Error'
        const message = error.message || ''
        const stack = error.stack

        if (stack) {
            return `${name}: ${message}\n${stack}`
        }

        return `${name}: ${message}`
    }

    /**
     * Serialize an object to JSON string, handling circular references.
     */
    private static serializeObject(obj: object): string {
        const seen = new WeakSet()

        try {
            return JSON.stringify(obj, (_, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) {
                        return '[Circular]'
                    }
                    seen.add(value)
                }

                if (typeof value === 'symbol') {
                    return `Symbol(${value.description ?? ''})`
                }

                if (typeof value === 'function') {
                    return `[Function: ${value.name || 'anonymous'}]`
                }

                if (typeof value === 'bigint') {
                    return value.toString()
                }

                return value
            })
        } catch {
            return '[Object]'
        }
    }
}
