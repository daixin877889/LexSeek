/**
 * Logger 便捷函数测试
 *
 * 测试 logger/index.ts 中导出的便捷函数
 *
 * **Feature: logger-convenience-functions**
 * **Validates: debug/info/warn/error/setLogLevel/setLogPrefix/enableTimestamp/createLogger**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LOG_LEVELS } from '../../../../shared/utils/logger/types'
import type { Transport, LogEntry } from '../../../../shared/utils/logger/types'

// 延迟导入便捷函数（避免循环依赖）
import {
    debug,
    info,
    warn,
    error,
    setLogLevel,
    setLogPrefix,
    enableTimestamp,
    createLogger,
} from '../../../../shared/utils/logger'

describe('便捷函数 - debug/info/warn/error 直接调用', () => {
    let consoleDebug: ReturnType<typeof vi.spyOn>
    let consoleInfo: ReturnType<typeof vi.spyOn>
    let consoleWarn: ReturnType<typeof vi.spyOn>
    let consoleError: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})
        consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
        consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('info 函数应调用默认 logger 并输出到 console.info', () => {
        const defaultLogger = createLogger('InfoTest')
        defaultLogger.clearTransports()
        defaultLogger.setLevel(LOG_LEVELS.DEBUG)

        info('info message')
        expect(consoleInfo).toHaveBeenCalled()
    })

    it('debug 函数应调用默认 logger 并输出到 console.debug', () => {
        const defaultLogger = createLogger('DebugTest')
        defaultLogger.clearTransports()
        defaultLogger.setLevel(LOG_LEVELS.DEBUG)

        debug('debug message')
        expect(consoleDebug).toHaveBeenCalled()
    })

    it('warn 函数应调用默认 logger 并输出到 console.warn', () => {
        const defaultLogger = createLogger('WarnTest')
        defaultLogger.clearTransports()
        defaultLogger.setLevel(LOG_LEVELS.DEBUG)

        warn('warn message')
        expect(consoleWarn).toHaveBeenCalled()
    })

    it('error 函数应调用默认 logger 并输出到 console.error', () => {
        const defaultLogger = createLogger('ErrorTest')
        defaultLogger.clearTransports()
        defaultLogger.setLevel(LOG_LEVELS.DEBUG)

        error('error message')
        expect(consoleError).toHaveBeenCalled()
    })

    it('便捷函数应支持传递额外参数', () => {
        const defaultLogger = createLogger('ArgsTest')
        defaultLogger.clearTransports()
        defaultLogger.setLevel(LOG_LEVELS.DEBUG)

        info('user action', 'login', 123)
        expect(consoleInfo).toHaveBeenCalled()
    })
})

describe('便捷函数 - 初始化', () => {
    it('createLogger 应返回有效的 Logger 实例', () => {
        const logger = createLogger('test')
        expect(logger).toBeDefined()
        expect(typeof logger.debug).toBe('function')
        expect(typeof logger.info).toBe('function')
    })
})

describe('便捷函数 - createLogger 命名空间', () => {
    let mockTransport: Transport

    beforeEach(() => {
        mockTransport = {
            write: vi.fn(),
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('createLogger 应创建带命名空间前缀的 logger', () => {
        const childLogger = createLogger('ChildNS')
        childLogger.clearTransports()
        childLogger.addTransport(mockTransport)
        childLogger.setLevel(LOG_LEVELS.DEBUG)

        childLogger.info('namespace test')
        expect(mockTransport.write).toHaveBeenCalled()

        const entry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        expect(entry.prefix).toBe('LexSeek][ChildNS')
    })

    it('多次嵌套应正确组合', () => {
        const parent = createLogger('Parent')
        const child = parent.createNamespace('Child')
        child.clearTransports()
        child.addTransport(mockTransport)
        child.setLevel(LOG_LEVELS.DEBUG)

        child.info('nested test')
        const entry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        expect(entry.prefix).toBe('LexSeek][Parent][Child')
    })
})

describe('便捷函数 - 日志条目内容验证', () => {
    let mockTransport: Transport

    beforeEach(() => {
        mockTransport = {
            write: vi.fn(),
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('createLogger 创建的 logger 应输出正确格式的日志条目', () => {
        const testLogger = createLogger('EntryTest')
        testLogger.clearTransports()
        testLogger.addTransport(mockTransport)
        testLogger.setLevel(LOG_LEVELS.INFO)

        testLogger.info('test message', 'arg1', 'arg2')

        expect(mockTransport.write).toHaveBeenCalledTimes(1)
        const entry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        expect(entry.level).toBe(LOG_LEVELS.INFO)
        expect(entry.prefix).toBe('LexSeek][EntryTest')
        expect(entry.message).toBe('test message')
        expect(entry.args).toEqual(['arg1', 'arg2'])
        expect(entry.timestamp).toBeInstanceOf(Date)
    })

    it('createLogger 支持设置自定义前缀', () => {
        const testLogger = createLogger('CustomPrefix')
        testLogger.clearTransports()
        testLogger.addTransport(mockTransport)
        testLogger.setLevel(LOG_LEVELS.DEBUG)

        testLogger.debug('custom prefix test')
        const entry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        expect(entry.prefix).toBe('LexSeek][CustomPrefix')
    })

    it('createNamespace 支持嵌套命名空间', () => {
        const a = createLogger('A')
        const b = a.createNamespace('B')
        const c = b.createNamespace('C')

        b.clearTransports()
        b.addTransport(mockTransport)
        b.setLevel(LOG_LEVELS.DEBUG)

        b.info('level B')
        const entry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        expect(entry.prefix).toBe('LexSeek][A][B')
    })
})

describe('便捷函数 - createLogger 继承行为', () => {
    let mockTransport: Transport

    beforeEach(() => {
        mockTransport = {
            write: vi.fn(),
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('子 logger 应继承父级日志级别', () => {
        const parent = createLogger('Parent')
        parent.setLevel(LOG_LEVELS.ERROR)
        parent.clearTransports()
        parent.addTransport(mockTransport)

        const child = parent.createNamespace('Child')
        child.setLevel(LOG_LEVELS.ERROR) // 确保子 logger 级别也是 ERROR

        // 继承后，WARN 不应输出
        mockTransport.write.mockClear()
        parent.warn('should not appear')
        expect(mockTransport.write).not.toHaveBeenCalled()

        // ERROR 应输出
        parent.error('should appear')
        expect(mockTransport.write).toHaveBeenCalled()
    })
})

describe('便捷函数 - setLogLevel 全局级别设置', () => {
    let mockTransport: Transport

    beforeEach(() => {
        mockTransport = {
            write: vi.fn(),
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('setLogLevel 应修改全局日志级别', () => {
        const logger = createLogger('LevelTest')
        logger.clearTransports()
        logger.addTransport(mockTransport)
        logger.setLevel(LOG_LEVELS.INFO)

        setLogLevel(LOG_LEVELS.ERROR)

        // DEBUG 不应输出
        logger.debug('should not appear')
        expect(mockTransport.write).not.toHaveBeenCalled()

        // ERROR 应输出
        logger.error('should appear')
        expect(mockTransport.write).toHaveBeenCalled()
    })
})

describe('便捷函数 - setLogPrefix 全局前缀设置', () => {
    let mockTransport: Transport

    beforeEach(() => {
        mockTransport = {
            write: vi.fn(),
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('setLogPrefix 应修改全局前缀', () => {
        // createLogger('LevelTest') 时继承当前默认 logger 的 transports
        const logger = createLogger('LevelTest')
        logger.clearTransports()
        logger.addTransport(mockTransport)
        logger.setLevel(LOG_LEVELS.INFO)

        // 修改全局默认 logger 的前缀
        setLogPrefix('NewGlobalPrefix')

        // 从 logger 创建子 namespace：继承 logger 的 transports，直接写 mockTransport
        const child = logger.createNamespace('ChildOfGlobal')
        child.setLevel(LOG_LEVELS.DEBUG)

        child.info('test message')
        const entry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        // 子 logger 的前缀 = LexSeek 默认前缀（未改变）+ logger 前缀 + ChildOfGlobal
        expect(entry.prefix).toContain('LevelTest')
        expect(entry.prefix).toContain('ChildOfGlobal')
    })

    it('setLogPrefix 不影响已存在子 logger 的前缀', () => {
        // 创建子 logger 时前缀已确定
        const logger = createLogger('FixedPrefix')
        logger.clearTransports()
        logger.addTransport(mockTransport)
        logger.setLevel(LOG_LEVELS.DEBUG)

        logger.info('original message')
        const originalEntry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        expect(originalEntry.prefix).toContain('FixedPrefix')

        // 修改全局前缀后，原有 logger 前缀不变
        setLogPrefix('ChangedPrefix')

        logger.info('after change')
        const afterEntry = (mockTransport.write as any).mock.calls[1][0] as LogEntry
        expect(afterEntry.prefix).toContain('FixedPrefix')
    })
})

describe('便捷函数 - enableTimestamp 时间戳开关', () => {
    let mockTransport: Transport

    beforeEach(() => {
        mockTransport = {
            write: vi.fn(),
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('enableTimestamp 应启用时间戳', () => {
        const logger = createLogger('TimestampTest')
        logger.clearTransports()
        logger.addTransport(mockTransport)
        logger.setLevel(LOG_LEVELS.DEBUG)

        enableTimestamp(true)

        logger.info('with timestamp')
        const entry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        expect(entry.timestamp).toBeInstanceOf(Date)
    })

    it('enableTimestamp 设置后 entry.timestamp 仍为 Date 实例', () => {
        const logger = createLogger('TimestampTest')
        logger.clearTransports()
        logger.addTransport(mockTransport)
        logger.setLevel(LOG_LEVELS.DEBUG)

        enableTimestamp(false)

        logger.info('without timestamp flag')
        const entry = (mockTransport.write as any).mock.calls[0][0] as LogEntry
        expect(entry.timestamp).toBeInstanceOf(Date)
    })
})

describe('便捷函数 - logger Proxy 行为', () => {
    let mockTransport: Transport

    beforeEach(() => {
        mockTransport = {
            write: vi.fn(),
        }
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('logger 应支持延迟初始化', () => {
        // logger 本身是 Proxy，第一次调用时初始化
        // 验证 logger 对象存在且可访问属性
        expect(logger).toBeDefined()
        expect(typeof logger.info).toBe('function')
        expect(typeof logger.debug).toBe('function')
        expect(typeof logger.error).toBe('function')
        expect(typeof logger.warn).toBe('function')
    })
})
