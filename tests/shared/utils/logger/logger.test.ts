/**
 * Logger 类测试
 *
 * 测试通用日志记录器核心功能
 *
 * **Feature: logger-core**
 * **Validates: Logger 类核心功能**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Logger } from '../../../../shared/utils/logger/logger'
import { LOG_LEVELS } from '../../../../shared/utils/logger/types'
import type { Transport, LogEntry } from '../../../../shared/utils/logger/types'

describe('Logger 构造函数', () => {
    it('默认选项应创建有效实例', () => {
        const logger = new Logger()
        expect(logger).toBeDefined()
        expect(typeof logger.debug).toBe('function')
        expect(typeof logger.info).toBe('function')
        expect(typeof logger.warn).toBe('function')
        expect(typeof logger.error).toBe('function')
    })

    it('自定义前缀应生效', () => {
        const logger = new Logger({ prefix: 'TestApp' })
        expect(logger.prefix).toBe('TestApp')
    })

    it('自定义日志级别应生效', () => {
        const logger = new Logger({ level: LOG_LEVELS.ERROR })
        expect(logger.level).toBe(LOG_LEVELS.ERROR)
    })

    it('自定义 enableTimestamp 应生效', () => {
        const logger = new Logger({ enableTimestamp: false })
        expect(logger.enableTimestamp).toBe(false)
    })
})

describe('Logger.setLevel 日志级别设置', () => {
    it('应正确设置日志级别', () => {
        const logger = new Logger()
        logger.setLevel(LOG_LEVELS.WARN)
        expect(logger.level).toBe(LOG_LEVELS.WARN)
    })

    it('应能设置为最低级别', () => {
        const logger = new Logger()
        logger.setLevel(LOG_LEVELS.SILENT)
        expect(logger.level).toBe(LOG_LEVELS.SILENT)
    })

    it('应能设置为最高详细级别', () => {
        const logger = new Logger()
        logger.setLevel(LOG_LEVELS.DEBUG)
        expect(logger.level).toBe(LOG_LEVELS.DEBUG)
    })
})

describe('Logger.setPrefix 前缀设置', () => {
    it('应正确设置前缀', () => {
        const logger = new Logger()
        logger.setPrefix('MyApp')
        expect(logger.prefix).toBe('MyApp')
    })

    it('应能清空前缀', () => {
        const logger = new Logger({ prefix: 'Old' })
        logger.setPrefix('')
        expect(logger.prefix).toBe('')
    })
})

describe('Logger.setTimestamp 时间戳设置', () => {
    it('应正确设置 enableTimestamp', () => {
        const logger = new Logger()
        logger.setTimestamp(false)
        expect(logger.enableTimestamp).toBe(false)
    })

    it('应能重新启用时间戳', () => {
        const logger = new Logger({ enableTimestamp: false })
        logger.setTimestamp(true)
        expect(logger.enableTimestamp).toBe(true)
    })
})

describe('Logger.addTransport 添加传输层', () => {
    it('应能添加自定义传输层', () => {
        const logger = new Logger()
        const mockTransport: Transport = {
            write: vi.fn(),
        }
        logger.addTransport(mockTransport)
        // 通过调用日志触发传输
        logger.debug('test')
        expect(mockTransport.write).toHaveBeenCalled()
    })
})

describe('Logger.clearTransports 清除传输层', () => {
    it('清除后应不输出任何日志', () => {
        const logger = new Logger()
        const mockTransport: Transport = {
            write: vi.fn(),
        }
        logger.addTransport(mockTransport)
        logger.clearTransports()
        logger.debug('should not be written')
        expect(mockTransport.write).not.toHaveBeenCalled()
    })
})

describe('Logger.createNamespace 创建命名空间', () => {
    it('无前缀时应直接使用命名空间', () => {
        const logger = new Logger({ level: LOG_LEVELS.DEBUG })
        const child = logger.createNamespace('Child')
        expect(child.prefix).toBe('Child')
    })

    it('有前缀时应组合父前缀和命名空间', () => {
        const logger = new Logger({ prefix: 'Parent', level: LOG_LEVELS.INFO })
        const child = logger.createNamespace('Child')
        expect(child.prefix).toBe('Parent][Child')
    })

    it('子日志器应继承父日志级别', () => {
        const logger = new Logger({ level: LOG_LEVELS.ERROR })
        const child = logger.createNamespace('Child')
        expect(child.level).toBe(LOG_LEVELS.ERROR)
    })

    it('多次嵌套应正确组合', () => {
        const logger = new Logger({ prefix: 'A' })
        const child1 = logger.createNamespace('B')
        const child2 = child1.createNamespace('C')
        expect(child2.prefix).toBe('A][B][C')
    })
})

describe('Logger.log 核心日志方法 - 级别过滤', () => {
    it('当前级别以下的日志应被过滤', () => {
        const mockTransport: Transport = { write: vi.fn() }
        const logger = new Logger({
            level: LOG_LEVELS.ERROR,
            transports: [mockTransport],
        })
        logger.debug('debug message')
        logger.info('info message')
        logger.warn('warn message')
        expect(mockTransport.write).not.toHaveBeenCalled()
    })

    it('ERROR 级别日志应总是被输出（当 level=ERROR）', () => {
        const mockTransport: Transport = { write: vi.fn() }
        const logger = new Logger({
            level: LOG_LEVELS.ERROR,
            transports: [mockTransport],
        })
        logger.error('error message')
        expect(mockTransport.write).toHaveBeenCalledTimes(1)
    })

    it('WARN 级别应输出 WARN 和 ERROR', () => {
        const mockTransport: Transport = { write: vi.fn() }
        const logger = new Logger({
            level: LOG_LEVELS.WARN,
            transports: [mockTransport],
        })
        logger.debug('debug')
        logger.info('info')
        logger.warn('warn message')
        logger.error('error message')
        expect(mockTransport.write).toHaveBeenCalledTimes(2)
    })

    it('SILENT 级别应禁止所有输出', () => {
        const mockTransport: Transport = { write: vi.fn() }
        const logger = new Logger({
            level: LOG_LEVELS.SILENT,
            transports: [mockTransport],
        })
        logger.error('silent error')
        expect(mockTransport.write).not.toHaveBeenCalled()
    })

    it('DEBUG 级别应输出所有日志', () => {
        const mockTransport: Transport = { write: vi.fn() }
        const logger = new Logger({
            level: LOG_LEVELS.DEBUG,
            transports: [mockTransport],
        })
        logger.debug('debug')
        logger.info('info')
        logger.warn('warn')
        logger.error('error')
        expect(mockTransport.write).toHaveBeenCalledTimes(4)
    })
})

describe('Logger.log 核心日志方法 - 日志条目内容', () => {
    it('应创建包含所有字段的日志条目', () => {
        let capturedEntry: LogEntry | null = null
        const mockTransport: Transport = {
            write: (entry: LogEntry) => { capturedEntry = entry },
        }
        const logger = new Logger({
            level: LOG_LEVELS.DEBUG,
            prefix: 'TestPrefix',
            transports: [mockTransport],
        })
        logger.info('test message', 'arg1', 'arg2')
        expect(capturedEntry).not.toBeNull()
        expect(capturedEntry!.level).toBe(LOG_LEVELS.INFO)
        expect(capturedEntry!.prefix).toBe('TestPrefix')
        expect(capturedEntry!.message).toBe('test message')
        expect(capturedEntry!.args).toEqual(['arg1', 'arg2'])
        expect(capturedEntry!.timestamp).toBeInstanceOf(Date)
    })

    it('多个传输层应都收到日志', () => {
        const transport1: Transport = { write: vi.fn() }
        const transport2: Transport = { write: vi.fn() }
        const logger = new Logger({
            level: LOG_LEVELS.DEBUG,
            transports: [transport1, transport2],
        })
        logger.info('broadcast test')
        expect(transport1.write).toHaveBeenCalledTimes(1)
        expect(transport2.write).toHaveBeenCalledTimes(1)
    })

    it('传输层错误不应传播', () => {
        const badTransport: Transport = {
            write: () => { throw new Error('transport error') },
        }
        const goodTransport: Transport = { write: vi.fn() }
        const logger = new Logger({
            level: LOG_LEVELS.DEBUG,
            transports: [badTransport, goodTransport],
        })
        // 不应抛出异常
        expect(() => logger.info('test')).not.toThrow()
        expect(goodTransport.write).toHaveBeenCalled()
    })
})

describe('Logger.detectProductionEnvironment Node.js 环境检测', () => {
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        // 确保 NODE_ENV 已知
        delete process.env.NODE_ENV
    })

    afterEach(() => {
        if (originalNodeEnv !== undefined) {
            process.env.NODE_ENV = originalNodeEnv
        } else {
            delete process.env.NODE_ENV
        }
    })

    it('NODE_ENV 为 production 时应检测为生产环境', () => {
        process.env.NODE_ENV = 'production'
        const logger = new Logger()
        expect(logger.level).toBe(LOG_LEVELS.INFO) // 生产环境默认 INFO
    })

    it('NODE_ENV 为 development 时应检测为开发环境', () => {
        process.env.NODE_ENV = 'development'
        const logger = new Logger()
        expect(logger.level).toBe(LOG_LEVELS.DEBUG) // 开发环境默认 DEBUG
    })

    it('NODE_ENV 未设置时应检测为开发环境（默认 DEBUG）', () => {
        delete process.env.NODE_ENV
        const logger = new Logger()
        expect(logger.level).toBe(LOG_LEVELS.DEBUG)
    })
})
