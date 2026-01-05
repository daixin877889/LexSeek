/**
 * 法律内容解析服务测试
 *
 * 使用 fast-check 进行属性测试，验证解析器的正确性
 *
 * **Feature: legal-content-parser**
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    convertChineseNumberToArabic,
    parseDocument,
    parseJudicialDocument,
    parseContent,
} from '~~/server/services/legal/parser.service'

describe('法律内容解析服务', () => {
    describe('convertChineseNumberToArabic - 中文数字转换', () => {
        it('应正确转换基本中文数字', () => {
            // 基本数字测试
            expect(convertChineseNumberToArabic('一')).toBe(1)
            expect(convertChineseNumberToArabic('二')).toBe(2)
            expect(convertChineseNumberToArabic('三')).toBe(3)
            expect(convertChineseNumberToArabic('四')).toBe(4)
            expect(convertChineseNumberToArabic('五')).toBe(5)
            expect(convertChineseNumberToArabic('六')).toBe(6)
            expect(convertChineseNumberToArabic('七')).toBe(7)
            expect(convertChineseNumberToArabic('八')).toBe(8)
            expect(convertChineseNumberToArabic('九')).toBe(9)
            expect(convertChineseNumberToArabic('零')).toBe(0)
        })

        it('应正确转换十位数', () => {
            expect(convertChineseNumberToArabic('十')).toBe(10)
            expect(convertChineseNumberToArabic('十一')).toBe(11)
            expect(convertChineseNumberToArabic('十二')).toBe(12)
            expect(convertChineseNumberToArabic('二十')).toBe(20)
            expect(convertChineseNumberToArabic('二十一')).toBe(21)
            expect(convertChineseNumberToArabic('九十九')).toBe(99)
        })

        it('应正确转换百位数', () => {
            expect(convertChineseNumberToArabic('一百')).toBe(100)
            expect(convertChineseNumberToArabic('一百零一')).toBe(101)
            expect(convertChineseNumberToArabic('一百一十')).toBe(110)
            expect(convertChineseNumberToArabic('三百五十六')).toBe(356)
            expect(convertChineseNumberToArabic('九百九十九')).toBe(999)
        })

        it('应正确转换千位数', () => {
            expect(convertChineseNumberToArabic('一千')).toBe(1000)
            expect(convertChineseNumberToArabic('一千零一')).toBe(1001)
            expect(convertChineseNumberToArabic('一千二百三十四')).toBe(1234)
        })

        it('应直接返回阿拉伯数字字符串', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 9999 }),
                    (num) => {
                        const result = convertChineseNumberToArabic(String(num))
                        expect(result).toBe(num)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    describe('parseDocument - Markdown 文档解析（系统一）', () => {
        it('应正确解析简单的 Markdown 标题结构', () => {
            const input = `# 第一编 总则

这是第一编的内容。

## 第一章 基本规定

这是第一章的内容。

### 第一条

这是第一条的内容。`

            const result = parseDocument(input)

            // 验证解析结果数量
            expect(result.length).toBeGreaterThan(0)

            // 验证第一个层级
            const l1 = result.find(r => r.type === 'l1')
            expect(l1).toBeDefined()
            expect(l1?.l1).toContain('第一编')
            expect(l1?.l1I).toBe(1)
        })

        it('应正确处理 header 内容', () => {
            const input = `这是法律的前言部分。

# 第一编 总则

内容`

            const result = parseDocument(input)

            // 验证 header 存在
            const header = result.find(r => r.type === 'header')
            expect(header).toBeDefined()
            expect(header?.content).toContain('前言')
        })

        it('应正确处理 notice 标签', () => {
            const input = `>notice<
这是公告内容。

# 第一编 总则

内容`

            const result = parseDocument(input)

            // 验证 notice 存在
            const notice = result.find(r => r.type === 'notice')
            expect(notice).toBeDefined()
        })

        it('应正确处理 annex 标签', () => {
            const input = `# 第一编 总则

内容

>annex<
附件一
附件内容`

            const result = parseDocument(input)

            // 验证 annex 存在
            const annex = result.find(r => r.type === 'annex')
            expect(annex).toBeDefined()
            expect(annex?.l3).toContain('附件')
        })

        it('应正确处理 footer 标签', () => {
            const input = `# 第一编 总则

内容

>annex<
附件一
附件内容

>footer<
落款
2024年1月1日`

            const result = parseDocument(input)

            // 验证 footer 存在
            const footer = result.find(r => r.type === 'footer')
            expect(footer).toBeDefined()
        })

        it('应移除 frontmatter', () => {
            const input = `---
title: 测试法律
date: 2024-01-01
---

# 第一编 总则

内容`

            const result = parseDocument(input)

            // 验证 frontmatter 被移除，不会出现在解析结果中
            const hasYaml = result.some(r =>
                r.content?.includes('title:') || r.content?.includes('date:')
            )
            expect(hasYaml).toBe(false)
        })
    })

    describe('parseJudicialDocument - 司法解释文档解析（系统二）', () => {
        it('应正确解析中文数字标题', () => {
            const input = `最高人民法院关于某某问题的解释

一、关于适用范围

本解释适用于...

二、关于具体问题

具体规定如下...`

            const result = parseJudicialDocument(input)

            // 验证解析结果
            expect(result.length).toBeGreaterThan(0)

            // 验证 l1 层级
            const l1Items = result.filter(r => r.type === 'l1')
            expect(l1Items.length).toBe(2)
            expect(l1Items[0]?.l1I).toBe(1)
            expect(l1Items[1]?.l1I).toBe(2)
        })

        it('应正确解析阿拉伯数字标题', () => {
            const input = `司法解释

一、总则

1．第一项

第一项内容

2．第二项

第二项内容`

            const result = parseJudicialDocument(input)

            // 验证 l2 层级
            const l2Items = result.filter(r => r.type === 'l2')
            expect(l2Items.length).toBe(2)
        })

        it('应正确处理 header 内容', () => {
            const input = `最高人民法院关于某某问题的解释

（2024年1月1日最高人民法院审判委员会通过）

一、关于适用范围

内容`

            const result = parseJudicialDocument(input)

            // 验证 header 存在
            const header = result.find(r => r.type === 'header')
            expect(header).toBeDefined()
        })
    })

    describe('parseContent - 自动选择解析器', () => {
        it('Markdown 格式应使用系统一解析器', () => {
            const markdownInput = `# 第一编 总则

内容`

            const result = parseContent(markdownInput)

            // 验证使用了 Markdown 解析器
            const l1 = result.find(r => r.type === 'l1')
            expect(l1).toBeDefined()
        })

        it('中文数字格式应使用系统二解析器', () => {
            const judicialInput = `司法解释标题

一、第一部分

内容`

            const result = parseContent(judicialInput)

            // 验证使用了司法解释解析器
            const l1 = result.find(r => r.type === 'l1')
            expect(l1).toBeDefined()
            expect(l1?.l1).toContain('一、')
        })
    })

    describe('Property: 解析结果结构一致性', () => {
        it('所有解析结果应包含必需字段', () => {
            const inputs = [
                `# 第一编 总则\n\n内容`,
                `一、第一部分\n\n内容`,
                `>notice<\n公告内容\n\n# 第一编\n\n内容`,
            ]

            for (const input of inputs) {
                const result = parseContent(input)

                for (const article of result) {
                    // 验证必需字段存在
                    expect(article).toHaveProperty('type')
                    expect(article).toHaveProperty('l1')
                    expect(article).toHaveProperty('l1I')
                    expect(article).toHaveProperty('l2')
                    expect(article).toHaveProperty('l2I')
                    expect(article).toHaveProperty('l3')
                    expect(article).toHaveProperty('l3I')
                    expect(article).toHaveProperty('l4')
                    expect(article).toHaveProperty('l4I')
                    expect(article).toHaveProperty('l5')
                    expect(article).toHaveProperty('l5I')
                    expect(article).toHaveProperty('content')

                    // 验证 type 是有效值
                    const validTypes = ['notice', 'header', 'footer', 'annex', 'l1', 'l2', 'l3', 'l4', 'l5']
                    expect(validTypes).toContain(article.type)
                }
            }
        })

        it('层级索引应为正整数或 null', () => {
            const input = `# 第一编 总则

## 第一章 基本规定

### 第一节 一般规定

#### 第一条

第一条内容`

            const result = parseDocument(input)

            for (const article of result) {
                // 验证索引字段
                const indexFields = ['l1I', 'l2I', 'l3I', 'l4I', 'l5I'] as const
                for (const field of indexFields) {
                    const value = article[field]
                    if (value !== null) {
                        expect(typeof value).toBe('number')
                        expect(value).toBeGreaterThan(0)
                    }
                }
            }
        })
    })

    describe('边界情况测试', () => {
        it('应处理空输入', () => {
            const result = parseDocument('')
            expect(Array.isArray(result)).toBe(true)
        })

        it('应处理只有空白的输入', () => {
            const result = parseDocument('   \n\n   ')
            expect(Array.isArray(result)).toBe(true)
        })

        it('应处理没有标题的纯文本', () => {
            const result = parseDocument('这是一段纯文本内容，没有任何标题。')
            expect(Array.isArray(result)).toBe(true)
            // 应该作为 header 处理
            const header = result.find(r => r.type === 'header')
            expect(header).toBeDefined()
        })

        it('应处理多级嵌套标题', () => {
            const input = `# 第一编

## 第一章

### 第一节

#### 第一款

##### 第一条

内容`

            const result = parseDocument(input)

            // 验证所有层级都被解析
            expect(result.some(r => r.type === 'l1')).toBe(true)
            expect(result.some(r => r.type === 'l2')).toBe(true)
            expect(result.some(r => r.type === 'l3')).toBe(true)
            expect(result.some(r => r.type === 'l4')).toBe(true)
            expect(result.some(r => r.type === 'l5')).toBe(true)
        })

        it('应处理混合标签的复杂文档', () => {
            const input = `>notice<
公告内容

>header<
法律标题

# 第一编 总则

内容

>annex<
附件一
附件内容

>footer<
落款
日期`

            const result = parseDocument(input)

            // 验证所有类型都被解析
            expect(result.some(r => r.type === 'notice')).toBe(true)
            expect(result.some(r => r.type === 'header')).toBe(true)
            expect(result.some(r => r.type === 'l1')).toBe(true)
            expect(result.some(r => r.type === 'annex')).toBe(true)
            expect(result.some(r => r.type === 'footer')).toBe(true)
        })
    })
})
