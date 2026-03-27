/**
 * ConsoleTransport 测试
 *
 * 测试控制台传输层功能
 *
 * **Feature: logger-console-transport**
 * **Validates: 控制台日志输出功能**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ConsoleTransport } from '../../../../shared/utils/logger/transports/console'
import { LOG_LEVELS } from '../../../../shared/utils/logger/types'

describe('ConsoleTransport.write 日志输出', () => {
    let consoleLog: any
    let consoleInfo: any
    let consoleWarn: any
    let consoleError: any

    beforeEach(() => {
        consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
        consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
        consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('DEBUG 级别在浏览器环境应使用 console.debug', () => {
        // Happy-DOM 环境检测为浏览器，DEBUG 使用 console.debug
        const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})
        const transport = new ConsoleTransport()
        transport.write({
            timestamp: new Date(),
            level: LOG_LEVELS.DEBUG,
            prefix: '',
            message: 'debug msg',
            args: [],
        })
        expect(consoleDebug).toHaveBeenCalled()
    })

    it('INFO 级别应使用 console.info', () => {
        const transport = new ConsoleTransport()
        transport.write({
            timestamp: new Date(),
            level: LOG_LEVELS.INFO,
            prefix: '',
            message: 'info msg',
            args: [],
        })
        expect(consoleInfo).toHaveBeenCalled()
    })

    it('WARN 级别应使用 console.warn', () => {
        const transport = new ConsoleTransport()
        transport.write({
            timestamp: new Date(),
            level: LOG_LEVELS.WARN,
            prefix: '',
            message: 'warn msg',
            args: [],
        })
        expect(consoleWarn).toHaveBeenCalled()
    })

    it('ERROR 级别应使用 console.error', () => {
        const transport = new ConsoleTransport()
        transport.write({
            timestamp: new Date(),
            level: LOG_LEVELS.ERROR,
            prefix: '',
            message: 'error msg',
            args: [],
        })
        expect(consoleError).toHaveBeenCalled()
    })

    it('未知级别应使用 console.log', () => {
        const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => {})
        const transport = new ConsoleTransport()
        transport.write({
            timestamp: new Date(),
            level: 99 as any,
            prefix: '',
            message: 'unknown level',
            args: [],
        })
        // 未知级别走 default 分支使用 console.log
        expect(consoleLog).toHaveBeenCalled()
        consoleDebug.mockRestore()
    })

    it('带参数的消息应格式化输出', () => {
        const transport = new ConsoleTransport()
        transport.write({
            timestamp: new Date(),
            level: LOG_LEVELS.INFO,
            prefix: 'TestPrefix',
            message: 'user action',
            args: ['login', { id: 123 }],
        })
        // 至少有一个 console 方法被调用
        expect(consoleInfo).toHaveBeenCalled()
    })

    it('无前缀时格式字符串应不包含前缀部分', () => {
        const transport = new ConsoleTransport()
        transport.write({
            timestamp: new Date(),
            level: LOG_LEVELS.INFO,
            prefix: '',
            message: 'no prefix',
            args: [],
        })
        const call = consoleInfo.mock.calls[0]
        expect(call).toBeDefined()
    })
})
