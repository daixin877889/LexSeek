/**
 * LogParser 测试
 *
 * 测试日志字符串解析功能
 *
 * **Feature: logger-parser**
 * **Validates: 日志解析功能**
 */

import { describe, it, expect } from 'vitest'
import { LogParser } from '../../../../shared/utils/logger/parser'
import { LOG_LEVELS } from '../../../../shared/utils/logger/types'

describe('LogParser.parse 日志解析', () => {
    it('应正确解析标准格式日志', () => {
        const now = new Date()
        const result = LogParser.parse(
            `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.123][INFO] test message`
        )
        expect(result).not.toBeNull()
        expect(result!.level).toBe(LOG_LEVELS.INFO)
        expect(result!.message).toBe('test message')
    })

    it('应正确解析带前缀的日志', () => {
        const now = new Date()
        const result = LogParser.parse(
            `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.456][LexSeek][DEBUG] debug message`
        )
        expect(result).not.toBeNull()
        expect(result!.level).toBe(LOG_LEVELS.DEBUG)
        expect(result!.prefix).toBe('LexSeek')
        expect(result!.message).toBe('debug message')
    })

    it('应正确解析 ERROR 级别日志', () => {
        const now = new Date()
        const result = LogParser.parse(
            `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.000][ERROR] error message`
        )
        expect(result).not.toBeNull()
        expect(result!.level).toBe(LOG_LEVELS.ERROR)
        expect(result!.message).toBe('error message')
    })

    it('应正确解析 WARN 级别日志', () => {
        const now = new Date()
        const result = LogParser.parse(
            `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.500][WARN] warning`
        )
        expect(result).not.toBeNull()
        expect(result!.level).toBe(LOG_LEVELS.WARN)
    })

    it('应正确解析多前缀日志', () => {
        const now = new Date()
        // LOG_PATTERN: timestamp + (prefix*) + [LEVEL] + message
        // 多前缀格式: [app][service] 在 [LEVEL] 之前
        const result = LogParser.parse(
            `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.789][app][service][INFO] test message`
        )
        expect(result).not.toBeNull()
        expect(result!.level).toBe(LOG_LEVELS.INFO)
        expect(result!.prefix).toBe('app][service')
        expect(result!.message).toBe('test message')
    })

    it('空字符串应返回 null', () => {
        expect(LogParser.parse('')).toBeNull()
    })

    it('null 应返回 null', () => {
        expect(LogParser.parse(null as any)).toBeNull()
    })

    it('undefined 应返回 null', () => {
        expect(LogParser.parse(undefined as any)).toBeNull()
    })

    it('无效格式应返回 null', () => {
        expect(LogParser.parse('not a log string')).toBeNull()
        // 缺少 [LEVEL] 格式应不匹配
        expect(LogParser.parse('[12:34:56.789] message')).toBeNull()
        // 缺少时间戳格式应不匹配
        expect(LogParser.parse('no brackets at all')).toBeNull()
    })

    it('非字符串输入应返回 null', () => {
        expect(LogParser.parse(123 as any)).toBeNull()
        expect(LogParser.parse({} as any)).toBeNull()
        expect(LogParser.parse([] as any)).toBeNull()
    })

    it('无效日志级别字符串应返回 null', () => {
        const now = new Date()
        const result = LogParser.parse(
            `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.123][INVALID_LEVEL] test`
        )
        expect(result).toBeNull()
    })

    it('有效格式但无效级别（非 LOG_LEVELS）应返回 null', () => {
        // 正则匹配 [A-Z]+ 但该值不在 LOG_LEVELS 中
        // TRACE 满足正则但不在 LOG_LEVELS 中
        const result = LogParser.parse('[14:30:00.000][TRACE] test trace')
        expect(result).toBeNull()
    })

    it('无效时间戳格式应返回 null', () => {
        const result = LogParser.parse('[invalid-time][INFO] test')
        expect(result).toBeNull()
    })

    it('非数字时间戳应返回 null', () => {
        const result = LogParser.parse('[ab:cd:ef.000][INFO] test')
        expect(result).toBeNull()
    })

    it('空前缀部分应返回空字符串前缀', () => {
        // 两个连续空 [] 在 [LEVEL] 之前
        // parsePrefix 提取 [] 内容返回空字符串 ""
        // 但正则 (?:\[([^\]]*)\])* 捕获每个 [] 的内容，包括空内容
        // 所以 prefixPart = '[][]', parsePrefix 返回 '' (join 空数组或空字符串?)
        // match = ['[]', '[]'], prefixes = ['', ''], join('][') = ']['
        const result = LogParser.parse('[14:30:00.000][][][INFO] test')
        expect(result).not.toBeNull()
        // 两个空 [] 匹配，prefix 提取结果为 ']['
        expect(result!.prefix).toBe('][')
    })

    it('所有已知日志级别应正确解析为数字', () => {
        const now = new Date()
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.000`
        const levels: Array<{ name: string; value: number }> = [
            { name: 'DEBUG', value: LOG_LEVELS.DEBUG },
            { name: 'INFO', value: LOG_LEVELS.INFO },
            { name: 'WARN', value: LOG_LEVELS.WARN },
            { name: 'ERROR', value: LOG_LEVELS.ERROR },
        ]
        for (const { name, value } of levels) {
            const result = LogParser.parse(`[${time}][${name}] test ${name}`)
            expect(result).not.toBeNull()
            expect(result!.level).toBe(value)
        }
    })

    it('时间戳解析应返回有效的 Date 对象', () => {
        const now = new Date()
        const result = LogParser.parse(
            `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.500][INFO] test`
        )
        expect(result).not.toBeNull()
        expect(result!.timestamp).toBeInstanceOf(Date)
        expect(result!.timestamp.getMilliseconds()).toBe(500)
    })

    it('前缀解析应正确提取内容', () => {
        const now = new Date()
        // LOG_PATTERN 中 prefix 部分只包含 [LEVEL] 之前的前缀
        // 所以 [TestPrefix][INFO] -> 前缀只提取 TestPrefix（因为 INFO 被 [LEVEL] 捕获）
        const result = LogParser.parse(
            `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.100][TestPrefix][INFO] message`
        )
        expect(result).not.toBeNull()
        expect(result!.prefix).toBe('TestPrefix')
    })
})

describe('LogParser.parse 边缘用例', () => {
    it('时间戳格式缺少秒的小数部分应返回 null', () => {
        // 时间戳正则要求 \d{3}（毫秒），但输入只有 2 位数字 → 不匹配 → return null
        const result = LogParser.parse('[14:30:00.12][INFO] test')
        expect(result).toBeNull()
    })

    it('时间戳格式缺少冒号应返回 null', () => {
        // 144500.000 不是 HH:mm:ss.SSS 格式
        const result = LogParser.parse('[144500.000][INFO] test')
        expect(result).toBeNull()
    })

    it('有效前缀但 level 解析返回 null 应导致整体返回 null', () => {
        // levelStr = 'CUSTOM' → parseLevel('CUSTOM') → 'CUSTOM' not in LOG_LEVELS → return null
        // → parse 返回 null
        const result = LogParser.parse('[14:30:00.000][MyPrefix][CUSTOM] test')
        expect(result).toBeNull()
    })

    it('解析后 prefix 为空字符串应正常返回', () => {
        // 有前缀括号但内容为空 → parsePrefix('[]') → ''
        const result = LogParser.parse('[14:30:00.000][][INFO] test')
        expect(result).not.toBeNull()
        expect(result!.prefix).toBe('')
    })

    it('带空格的前缀内容应保留', () => {
        const result = LogParser.parse('[14:30:00.000][app service][INFO] test')
        expect(result).not.toBeNull()
        expect(result!.prefix).toBe('app service')
    })

    it('数字形式的时间戳部分（非冒号格式）应返回 null', () => {
        // LOG_PATTERN 的 timestamp group 要求 HH:mm:ss.SSS 格式
        // 1445000（没有冒号和点）不匹配 → parseTimestamp 返回 null → parse 返回 null
        const result = LogParser.parse('[1445000][INFO] test')
        expect(result).toBeNull()
    })

    it('带多个嵌套前缀应正确解析', () => {
        const result = LogParser.parse('[14:30:00.000][A][B][C][INFO] test message')
        expect(result).not.toBeNull()
        expect(result!.prefix).toBe('A][B][C')
        expect(result!.message).toBe('test message')
    })

    it('消息部分可包含方括号', () => {
        const result = LogParser.parse('[14:30:00.000][INFO] test [with brackets] inside')
        expect(result).not.toBeNull()
        expect(result!.message).toBe('test [with brackets] inside')
    })
})
