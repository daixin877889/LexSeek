/**
 * Logger 核心功能测试
 * 
 * 验证日志工具的基本功能是否正常工作。
 */

import { describe, it, expect } from 'vitest'
import {
    Logger,
    LogFormatter,
    LogParser,
    LOG_LEVELS,
    getLevelName,
    getLevelValue
} from '../index'

describe('Logger Types', () => {
    it('应该正确定义日志级别常量', () => {
        expect(LOG_LEVELS.DEBUG).toBe(0)
        expect(LOG_LEVELS.INFO).toBe(1)
        expect(LOG_LEVELS.WARN).toBe(2)
        expect(LOG_LEVELS.ERROR).toBe(3)
        expect(LOG_LEVELS.SILENT).toBe(4)
    })

    it('应该正确获取级别名称', () => {
        expect(getLevelName(LOG_LEVELS.DEBUG)).toBe('DEBUG')
        expect(getLevelName(LOG_LEVELS.INFO)).toBe('INFO')
        expect(getLevelName(LOG_LEVELS.WARN)).toBe('WARN')
        expect(getLevelName(LOG_LEVELS.ERROR)).toBe('ERROR')
    })

    it('应该正确获取级别值', () => {
        expect(getLevelValue('DEBUG')).toBe(0)
        expect(getLevelValue('INFO')).toBe(1)
        expect(getLevelValue('WARN')).toBe(2)
        expect(getLevelValue('ERROR')).toBe(3)
    })
})

describe('LogFormatter', () => {
    it('应该正确格式化时间戳', () => {
        const date = new Date(2025, 11, 19, 14, 30, 25, 123)
        const formatted = LogFormatter.formatTimestamp(date)
        expect(formatted).toBe('14:30:25.123')
    })

    it('应该正确格式化日志条目', () => {
        const entry = {
            timestamp: new Date(2025, 11, 19, 14, 30, 25, 123),
            level: LOG_LEVELS.INFO,
            prefix: 'Test',
            message: 'Hello World',
            args: []
        }
        const formatted = LogFormatter.format(entry)
        expect(formatted).toBe('[14:30:25.123][Test][INFO] Hello World')
    })

    it('应该正确处理无前缀的日志条目', () => {
        const entry = {
            timestamp: new Date(2025, 11, 19, 14, 30, 25, 123),
            level: LOG_LEVELS.DEBUG,
            prefix: '',
            message: 'Debug message',
            args: []
        }
        const formatted = LogFormatter.format(entry)
        expect(formatted).toBe('[14:30:25.123][DEBUG] Debug message')
    })

    it('应该安全序列化各种类型的值', () => {
        expect(LogFormatter.safeSerialize(undefined)).toBe('undefined')
        expect(LogFormatter.safeSerialize(null)).toBe('null')
        expect(LogFormatter.safeSerialize(Symbol('test'))).toBe('Symbol(test)')
        expect(LogFormatter.safeSerialize(() => { })).toMatch(/\[Function:/)
        expect(LogFormatter.safeSerialize({ a: 1 })).toBe('{"a":1}')
    })
})

describe('LogParser', () => {
    it('应该正确解析有效的日志字符串', () => {
        const logString = '[14:30:25.123][Test][INFO] Hello World'
        const parsed = LogParser.parse(logString)

        expect(parsed).not.toBeNull()
        expect(parsed!.level).toBe(LOG_LEVELS.INFO)
        expect(parsed!.prefix).toBe('Test')
        expect(parsed!.message).toBe('Hello World')
    })

    it('应该正确解析无前缀的日志字符串', () => {
        const logString = '[14:30:25.123][DEBUG] Debug message'
        const parsed = LogParser.parse(logString)

        expect(parsed).not.toBeNull()
        expect(parsed!.level).toBe(LOG_LEVELS.DEBUG)
        expect(parsed!.prefix).toBe('')
        expect(parsed!.message).toBe('Debug message')
    })

    it('应该对无效日志字符串返回 null', () => {
        expect(LogParser.parse('')).toBeNull()
        expect(LogParser.parse('invalid log')).toBeNull()
        expect(LogParser.parse('[invalid')).toBeNull()
    })
})

describe('Logger', () => {
    it('应该创建带默认设置的 Logger 实例', () => {
        const logger = new Logger()
        expect(logger.prefix).toBe('')
        expect(logger.enableTimestamp).toBe(true)
    })

    it('应该创建带自定义前缀的 Logger 实例', () => {
        const logger = new Logger({ prefix: 'MyApp' })
        expect(logger.prefix).toBe('MyApp')
    })

    it('应该正确设置日志级别', () => {
        const logger = new Logger()
        logger.setLevel(LOG_LEVELS.ERROR)
        expect(logger.level).toBe(LOG_LEVELS.ERROR)
    })

    it('应该正确创建命名空间子日志器', () => {
        const logger = new Logger({ prefix: 'Parent' })
        const child = logger.createNamespace('Child')

        expect(child.prefix).toBe('Parent][Child')
        expect(child.level).toBe(logger.level)
    })
})
