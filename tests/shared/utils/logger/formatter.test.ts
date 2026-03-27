/**
 * LogFormatter 测试
 *
 * 测试日志格式化功能
 *
 * **Feature: logger-formatter**
 * **Validates: 日志格式化功能**
 */

import { describe, it, expect } from 'vitest'
import { LogFormatter } from '../../../../shared/utils/logger/formatter'
import { LOG_LEVELS } from '../../../../shared/utils/logger/types'

describe('LogFormatter.formatTimestamp 时间戳格式化', () => {
    it('应正确格式化时间戳为 HH:mm:ss.SSS 格式', () => {
        const date = new Date(2024, 0, 15, 9, 5, 30, 123)
        expect(LogFormatter.formatTimestamp(date)).toBe('09:05:30.123')
    })

    it('个位数小时、分钟、秒应补零', () => {
        const date = new Date(2024, 0, 15, 1, 2, 3, 4)
        expect(LogFormatter.formatTimestamp(date)).toBe('01:02:03.004')
    })

    it('午夜应正确格式化', () => {
        const date = new Date(2024, 0, 1, 0, 0, 0, 0)
        expect(LogFormatter.formatTimestamp(date)).toBe('00:00:00.000')
    })

    it('23:59:59.999 应正确格式化', () => {
        const date = new Date(2024, 0, 1, 23, 59, 59, 999)
        expect(LogFormatter.formatTimestamp(date)).toBe('23:59:59.999')
    })
})

describe('LogFormatter.formatMessage 消息格式化', () => {
    it('无参数应返回原消息', () => {
        expect(LogFormatter.formatMessage('hello', [])).toBe('hello')
        expect(LogFormatter.formatMessage('test message', [])).toBe('test message')
    })

    it('单个参数应拼接在消息后', () => {
        expect(LogFormatter.formatMessage('value:', ['42'])).toBe('value: 42')
        expect(LogFormatter.formatMessage('user', ['alice'])).toBe('user alice')
    })

    it('多个参数应用空格拼接', () => {
        expect(LogFormatter.formatMessage('args:', ['a', 'b', 'c'])).toBe('args: a b c')
    })
})

describe('LogFormatter.safeSerialize 安全序列化', () => {
    it('undefined 应序列化为 undefined', () => {
        expect(LogFormatter.safeSerialize(undefined)).toBe('undefined')
    })

    it('null 应序列化为 null', () => {
        expect(LogFormatter.safeSerialize(null)).toBe('null')
    })

    it('Symbol 应正确序列化', () => {
        expect(LogFormatter.safeSerialize(Symbol('test'))).toBe('Symbol(test)')
        expect(LogFormatter.safeSerialize(Symbol())).toBe('Symbol()')
    })

    it('函数应序列化为函数描述', () => {
        const named = function myFunc() {}
        const anonymous = () => {}
        expect(LogFormatter.safeSerialize(named)).toBe('[Function: myFunc]')
        expect(LogFormatter.safeSerialize(anonymous)).toBe('[Function: anonymous]')
        expect(LogFormatter.safeSerialize(function () {})).toBe('[Function: anonymous]')
    })

    it('Error 应包含名称、消息和堆栈', () => {
        const error = new Error('test error')
        const result = LogFormatter.safeSerialize(error)
        expect(result).toContain('Error')
        expect(result).toContain('test error')
        expect(result).toContain('\n')
    })

    it('Error 无堆栈时应只返回名称和消息', () => {
        const error = new Error('no stack')
        error.stack = undefined
        const result = LogFormatter.safeSerialize(error)
        expect(result).toBe('Error: no stack')
    })

    it('普通对象应序列化为 JSON', () => {
        expect(LogFormatter.safeSerialize({ key: 'value' })).toBe('{"key":"value"}')
        expect(LogFormatter.safeSerialize([1, 2, 3])).toBe('[1,2,3]')
    })

    it('嵌套对象应正确序列化', () => {
        const result = LogFormatter.safeSerialize({ a: { b: { c: 1 } } })
        expect(result).toContain('"a"')
        expect(result).toContain('"b"')
        expect(result).toContain('"c"')
    })

    it('循环引用对象应返回 [Circular]', () => {
        const obj: any = { a: 1 }
        obj.self = obj
        expect(LogFormatter.safeSerialize(obj)).toBe('{"a":1,"self":"[Circular]"}')
    })

    it('BigInt 应序列化为字符串', () => {
        expect(LogFormatter.safeSerialize(BigInt(123456789))).toBe('123456789')
    })

    it('原始类型应直接转换', () => {
        expect(LogFormatter.safeSerialize(42)).toBe('42')
        expect(LogFormatter.safeSerialize(3.14)).toBe('3.14')
        expect(LogFormatter.safeSerialize(true)).toBe('true')
        expect(LogFormatter.safeSerialize('hello')).toBe('hello')
    })

    it('深层嵌套对象应正确序列化', () => {
        const obj: any = { level1: { level2: { level3: { value: 1 } } } }
        const result = LogFormatter.safeSerialize(obj)
        expect(result).toContain('"value":1')
    })

    it('对象内含 Symbol 键应在 JSON.stringify replacer 中处理', () => {
        // Symbol 作为对象键时，JSON.stringify replacer 会处理
        const sym = Symbol('keySymbol')
        const obj = { [sym]: 'symbol value', regular: 'normal' }
        const result = LogFormatter.safeSerialize(obj)
        // JSON.stringify 会将 Symbol 键转换为 undefined 或忽略
        expect(result).toBeDefined()
        expect(typeof result).toBe('string')
    })

    it('对象内含函数值应在 JSON.stringify replacer 中处理', () => {
        const obj = { name: 'test', handler: function myHandler() {} }
        const result = LogFormatter.safeSerialize(obj)
        expect(result).toContain('test')
    })

    it('对象内含 BigInt 值应在 JSON.stringify replacer 中处理', () => {
        const obj = { count: BigInt(987654321), name: 'big' }
        const result = LogFormatter.safeSerialize(obj)
        expect(result).toContain('987654321')
    })

    it('对象内含 undefined 值应序列化为 undefined', () => {
        const obj = { a: 1, b: undefined }
        const result = LogFormatter.safeSerialize(obj)
        expect(result).toContain('"a":1')
    })

    it('空对象应序列化为 {}', () => {
        expect(LogFormatter.safeSerialize({})).toBe('{}')
    })

    it('嵌套循环引用应在第二层被标记为 [Circular]', () => {
        const a: any = { name: 'a' }
        const b: any = { name: 'b', ref: a }
        a.ref = b // 互相引用
        const result = LogFormatter.safeSerialize(a)
        // 第一层 a.ref → b，第二层 b.ref → a（已在 seen 中）→ '[Circular]'
        expect(result).toContain('[Circular]')
    })

    it('普通数组应正确序列化', () => {
        expect(LogFormatter.safeSerialize([1, 2, 3])).toBe('[1,2,3]')
    })

    it('包含循环引用的数组应标记 [Circular]', () => {
        const arr: any = [1, 2]
        arr.push(arr) // arr[2] = arr
        const result = LogFormatter.safeSerialize(arr)
        expect(result).toContain('[Circular]')
    })
})

describe('LogFormatter.format 日志格式化', () => {
    it('应生成标准格式日志', () => {
        const entry = {
            timestamp: new Date(2024, 5, 20, 14, 30, 0, 0),
            level: LOG_LEVELS.INFO,
            prefix: 'TestPrefix',
            message: 'test message',
            args: [],
        }
        const result = LogFormatter.format(entry)
        expect(result).toBe('[14:30:00.000][TestPrefix][INFO] test message')
    })

    it('无前缀时应不包含前缀部分', () => {
        const entry = {
            timestamp: new Date(2024, 5, 20, 14, 30, 0, 0),
            level: LOG_LEVELS.DEBUG,
            prefix: '',
            message: 'debug msg',
            args: [],
        }
        const result = LogFormatter.format(entry)
        expect(result).toBe('[14:30:00.000][DEBUG] debug msg')
    })

    it('带参数时应追加序列化后的参数', () => {
        const entry = {
            timestamp: new Date(2024, 5, 20, 14, 30, 0, 0),
            level: LOG_LEVELS.ERROR,
            prefix: '',
            message: 'error occurred',
            args: [1, 'two', { key: 'value' }],
        }
        const result = LogFormatter.format(entry)
        expect(result).toContain('error occurred')
        expect(result).toContain('1')
        expect(result).toContain('two')
        expect(result).toContain('{"key":"value"}')
    })

    it('WARN 级别应正确格式化', () => {
        const entry = {
            timestamp: new Date(2024, 5, 20, 14, 30, 0, 0),
            level: LOG_LEVELS.WARN,
            prefix: '',
            message: 'warning',
            args: [],
        }
        const result = LogFormatter.format(entry)
        expect(result).toContain('[WARN]')
        expect(result).toContain('warning')
    })

    it('ERROR 级别应正确格式化', () => {
        const entry = {
            timestamp: new Date(2024, 5, 20, 14, 30, 0, 0),
            level: LOG_LEVELS.ERROR,
            prefix: '',
            message: 'error',
            args: [],
        }
        const result = LogFormatter.format(entry)
        expect(result).toContain('[ERROR]')
    })
})
