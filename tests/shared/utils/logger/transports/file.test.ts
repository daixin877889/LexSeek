/**
 * FileTransport 测试
 *
 * 测试文件传输层功能
 *
 * **Feature: logger-file-transport**
 * **Validates: 文件日志传输功能**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FileTransport } from '../../../../../shared/utils/logger/transports/file'
import { LOG_LEVELS } from '../../../../../shared/utils/logger/types'

describe('FileTransport.getLogFilePath 文件路径生成', () => {
    it('DEBUG 级别应生成正确的文件名', () => {
        const transport = new FileTransport()
        const date = new Date(2024, 5, 20, 14, 30, 0, 0)
        const path = transport.getLogFilePath(LOG_LEVELS.DEBUG, date)
        expect(path).toBe('logs/debug-2024-06-20.log')
    })

    it('INFO 级别应生成正确的文件名', () => {
        const transport = new FileTransport()
        const date = new Date(2024, 11, 31, 23, 59, 59, 999)
        const path = transport.getLogFilePath(LOG_LEVELS.INFO, date)
        expect(path).toBe('logs/info-2024-12-31.log')
    })

    it('WARN 级别应生成正确的文件名', () => {
        const transport = new FileTransport()
        const date = new Date(2024, 0, 1, 0, 0, 0, 0)
        const path = transport.getLogFilePath(LOG_LEVELS.WARN, date)
        expect(path).toBe('logs/warn-2024-01-01.log')
    })

    it('ERROR 级别应生成正确的文件名', () => {
        const transport = new FileTransport()
        const date = new Date(2024, 6, 15, 12, 0, 0, 0)
        const path = transport.getLogFilePath(LOG_LEVELS.ERROR, date)
        expect(path).toBe('logs/error-2024-07-15.log')
    })

    it('自定义目录应生效', () => {
        const transport = new FileTransport('custom-logs')
        const date = new Date(2024, 5, 20, 14, 30, 0, 0)
        const path = transport.getLogFilePath(LOG_LEVELS.INFO, date)
        expect(path).toBe('custom-logs/info-2024-06-20.log')
    })

    it('个位数月日应补零', () => {
        const transport = new FileTransport()
        const date = new Date(2024, 0, 5, 1, 2, 3, 4) // January 5th
        const path = transport.getLogFilePath(LOG_LEVELS.INFO, date)
        expect(path).toBe('logs/info-2024-01-05.log')
    })
})

describe('FileTransport.write 非 Node 环境行为', () => {
    // 在 Happy-DOM 环境中，isNodeEnvironment() 返回 false
    // 因为 window 对象存在于 globalThis
    it('非 Node 环境 write 方法应静默返回（不抛异常）', () => {
        const transport = new FileTransport()
        const entry = {
            timestamp: new Date(),
            level: LOG_LEVELS.INFO,
            prefix: 'TestPrefix',
            message: 'test message',
            args: [],
        }
        // 不应抛出异常
        expect(() => transport.write(entry)).not.toThrow()
    })

    it('非 Node 环境 write 方法多次调用应静默处理', () => {
        const transport = new FileTransport()
        const entry = {
            timestamp: new Date(),
            level: LOG_LEVELS.DEBUG,
            prefix: '',
            message: 'test',
            args: [],
        }
        // 多次调用不应抛异常
        expect(() => {
            transport.write(entry)
            transport.write(entry)
            transport.write(entry)
        }).not.toThrow()
    })
})

describe('FileTransport 构造函数', () => {
    it('默认构造函数应创建有效实例', () => {
        const transport = new FileTransport()
        expect(transport).toBeDefined()
    })

    it('自定义目录应正确保存', () => {
        const transport = new FileTransport('my-logs-dir')
        const path = transport.getLogFilePath(LOG_LEVELS.ERROR, new Date(2024, 3, 4))
        expect(path).toContain('my-logs-dir')
    })

    it('空字符串目录路径应为无前缀的文件名', () => {
        const transport = new FileTransport('')
        const path = transport.getLogFilePath(LOG_LEVELS.INFO, new Date(2024, 3, 4))
        expect(path).toBe('/info-2024-04-04.log')
    })
})
