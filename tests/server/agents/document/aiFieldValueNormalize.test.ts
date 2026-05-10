/**
 * AI 字段值规范化单测
 *
 * 验证 LLM 占位字符串(「【待补充:xxx】」「【未提供】」等)被正确识别 / 转 null /
 * 丢弃,且不会误伤合法内容里包含"待补充"等关键字的真实字段值。
 */

import { describe, it, expect } from 'vitest'

import {
    isAIPlaceholderValue,
    normalizeAIInitialFieldValues,
    cleanAIFieldUpdates,
} from '~~/server/agents/document/aiFieldValueNormalize'

describe('isAIPlaceholderValue', () => {
    it('null / undefined / 空字符串 / 纯空白 → 占位符', () => {
        expect(isAIPlaceholderValue(null)).toBe(true)
        expect(isAIPlaceholderValue(undefined)).toBe(true)
        expect(isAIPlaceholderValue('')).toBe(true)
        expect(isAIPlaceholderValue('   ')).toBe(true)
    })

    it('全角【】包裹的占位关键词 → 占位符', () => {
        expect(isAIPlaceholderValue('【待补充：法院名称】')).toBe(true)
        expect(isAIPlaceholderValue('【待补充: 案件号】')).toBe(true)
        expect(isAIPlaceholderValue('【未提供】')).toBe(true)
        expect(isAIPlaceholderValue('【暂无】')).toBe(true)
        expect(isAIPlaceholderValue('【未知】')).toBe(true)
        expect(isAIPlaceholderValue('【未填】')).toBe(true)
        expect(isAIPlaceholderValue('【无】')).toBe(true)
    })

    it('半角[]包裹的占位关键词 → 占位符', () => {
        expect(isAIPlaceholderValue('[待补充: address]')).toBe(true)
        expect(isAIPlaceholderValue('[未提供：原告住址]')).toBe(true)
    })

    it('合法值不被误判：包含"待补充"三字但不是占位符模式', () => {
        expect(isAIPlaceholderValue('原告住址：北京市朝阳区，待补充详细门牌号')).toBe(false)
        expect(isAIPlaceholderValue('待补充')).toBe(false) // 无方括号包裹,认为是正常内容
        expect(isAIPlaceholderValue('张三')).toBe(false)
        expect(isAIPlaceholderValue('【强调】这一点')).toBe(false) // 不含占位关键词
    })
})

describe('normalizeAIInitialFieldValues (save 工具用：占位符 → null)', () => {
    it('占位符值转 null，真值保留，原 null 保留', () => {
        const input = {
            原告: '张三',
            被告: '【待补充：被告姓名】',
            法院名称: '【未提供】',
            诉讼请求: '继续履行合同',
            证人姓名和住所: null,
            落款日期: '【暂无】',
        }
        const out = normalizeAIInitialFieldValues(input)
        expect(out).toEqual({
            原告: '张三',
            被告: null,
            法院名称: null,
            诉讼请求: '继续履行合同',
            证人姓名和住所: null,
            落款日期: null,
        })
    })

    it('保持原 key 集合不变，所有字段都在 values 里(只是值变 null)', () => {
        const input = { a: '【待补充】', b: 'real', c: null }
        const out = normalizeAIInitialFieldValues(input)
        expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c'])
    })
})

describe('cleanAIFieldUpdates (update 工具用：占位符 → 丢弃)', () => {
    it('占位符 key 被丢弃，真值保留，显式 null 保留(清空意图)', () => {
        const input = {
            被告: '李四',
            被告住址: '【待补充：被告住址】',
            法院名称: '【未提供】',
            原告身份证号: null, // 显式清空
            诉讼请求: '继续履行合同',
        }
        const out = cleanAIFieldUpdates(input)
        expect(out).toEqual({
            被告: '李四',
            原告身份证号: null,
            诉讼请求: '继续履行合同',
        })
        // 占位符的 key 不应出现
        expect('被告住址' in out).toBe(false)
        expect('法院名称' in out).toBe(false)
    })

    it('全部都是占位符时返回空对象', () => {
        const out = cleanAIFieldUpdates({
            a: '【待补充】',
            b: '【未提供】',
        })
        expect(out).toEqual({})
    })
})
