/**
 * 法律内容解析服务 - 覆盖率补充测试
 *
 * 覆盖 parser.service.ts 中未被测试的路径：
 * - parseBottomContent 中 footer/annex 混合顺序
 * - parseJudicialDocument 中 notice/header 边缘分支
 * - parseHeadingsAndContent 中空部分处理
 * - parseMarkdownToNumber 中各种匹配模式
 * - parseContent 异常处理
 *
 * **Feature: legal-content-parser**
 * **Validates: Requirements 1.1, 1.2, 1.3**
 */

import { describe, it, expect } from 'vitest'
import {
    convertChineseNumberToArabic,
    parseDocument,
    parseJudicialDocument,
    parseContent,
} from '~~/server/services/legal/parser.service'

describe('法律内容解析服务 - 覆盖率补充', () => {
    // ==================== parseBottomContent 边界情况 ====================

    describe('parseBottomContent - footer/annex 混合顺序', () => {
        it('应正确解析 footer 在 annex 之前的情况', () => {
            const input = `# 第一编 总则

内容

>annex<
附件一
附件内容

>footer<
落款一
日期一

>annex<
附件二
附件二内容`

            const result = parseDocument(input)

            const footers = result.filter(r => r.type === 'footer')
            const annexes = result.filter(r => r.type === 'annex')

            expect(footers.length).toBe(1)
            expect(annexes.length).toBe(2)
        })

        it('应正确处理多个连续 footer', () => {
            const input = `# 第一编 总则

内容

>annex<
占位

>footer<
落款一
日期一

>footer<
落款二
日期二`

            const result = parseDocument(input)
            const footers = result.filter(r => r.type === 'footer')

            expect(footers.length).toBe(2)
            expect(footers[0]?.l3I).toBe(1)
            expect(footers[1]?.l3I).toBe(2)
        })

        it('应正确处理多个连续 annex', () => {
            const input = `# 第一编 总则

内容

>annex<
附件一
附件一内容

>annex<
附件二
附件二内容

>annex<
附件三
附件三内容`

            const result = parseDocument(input)
            const annexes = result.filter(r => r.type === 'annex')

            expect(annexes.length).toBe(3)
            expect(annexes[0]?.l3I).toBe(1)
            expect(annexes[1]?.l3I).toBe(2)
            expect(annexes[2]?.l3I).toBe(3)
        })

        it('应处理 footer 内容只有一行的情况', () => {
            const input = `# 第一编 总则

内容

>annex<
占位

>footer<
落款单行`

            const result = parseDocument(input)
            const footer = result.find(r => r.type === 'footer')

            expect(footer).toBeDefined()
            expect(footer?.l3).toBe('落款单行')
            // 没有剩余内容时 content 应为 null
            expect(footer?.content).toBeNull()
        })
    })

    // ==================== parseJudicialDocument 边缘分支 ====================

    describe('parseJudicialDocument - 边缘分支', () => {
        it('应处理 notice 标签在 header 之前的情况', () => {
            const input = `标题内容

>notice<
公告一内容

>notice<
公告二内容

>header<
第二部分标题
第二部分内容

一、关于适用范围

内容`

            const result = parseJudicialDocument(input)

            const notices = result.filter(r => r.type === 'notice')
            const headers = result.filter(r => r.type === 'header')

            expect(notices.length).toBe(2)
            expect(headers.length).toBeGreaterThanOrEqual(1)
        })

        it('应处理 header 中包含核心内容的情况', () => {
            const input = `>header<
法律标题
法律描述

一、关于适用范围

内容`

            const result = parseJudicialDocument(input)

            const headers = result.filter(r => r.type === 'header')
            const l1Items = result.filter(r => r.type === 'l1')

            // header 中的核心内容应被正确分离
            expect(headers.length).toBeGreaterThanOrEqual(1)
            expect(l1Items.length).toBe(1)
        })

        it('应处理无标签无标题的纯文本', () => {
            const result = parseJudicialDocument('这是一段纯文本内容')

            expect(Array.isArray(result)).toBe(true)
            const header = result.find(r => r.type === 'header')
            expect(header).toBeDefined()
        })

        it('应处理只有 annex 的情况', () => {
            const input = `标题

一、第一部分

内容

>annex<
附件标题
附件内容`

            const result = parseJudicialDocument(input)
            const annex = result.find(r => r.type === 'annex')
            expect(annex).toBeDefined()
        })

        it('应处理带 footer 和 annex 的司法解释', () => {
            const input = `标题

一、第一部分

内容

>annex<
附件标题
附件内容

>footer<
落款
日期`

            const result = parseJudicialDocument(input)

            const annex = result.find(r => r.type === 'annex')
            const footer = result.find(r => r.type === 'footer')

            expect(annex).toBeDefined()
            expect(footer).toBeDefined()
        })

        it('应正确解析多层级 header 内容', () => {
            const input = `>header<
第一个标题
第一个标题描述

>header<
第二个标题
第二个标题描述

一、第一部分

内容`

            const result = parseJudicialDocument(input)
            const headers = result.filter(r => r.type === 'header')

            expect(headers.length).toBeGreaterThanOrEqual(2)
        })
    })

    // ==================== parseMarkdownToNumber 匹配模式 ====================

    describe('parseMarkdownToNumber - 各种匹配模式', () => {
        it('应解析括号中文数字格式：(一) (二)', () => {
            const input = `# (一) 第一部分

内容

# (二) 第二部分

内容`

            const result = parseDocument(input)
            const l1Items = result.filter(r => r.type === 'l1')

            expect(l1Items.length).toBe(2)
            expect(l1Items[0]?.l1I).toBe(1)
            expect(l1Items[1]?.l1I).toBe(2)
        })

        it('应解析括号阿拉伯数字格式：(1) (2)', () => {
            const input = `# (1) 第一部分

内容

# (2) 第二部分

内容`

            const result = parseDocument(input)
            const l1Items = result.filter(r => r.type === 'l1')

            expect(l1Items.length).toBe(2)
            expect(l1Items[0]?.l1I).toBe(1)
            expect(l1Items[1]?.l1I).toBe(2)
        })

        it('应解析中文数字序号格式：一、二、', () => {
            const input = `# 一、第一部分

内容

# 二、第二部分

内容`

            const result = parseDocument(input)
            const l1Items = result.filter(r => r.type === 'l1')

            expect(l1Items.length).toBe(2)
            expect(l1Items[0]?.l1I).toBe(1)
            expect(l1Items[1]?.l1I).toBe(2)
        })

        it('应解析阿拉伯数字序号格式：1. 2.', () => {
            const input = `# 1. 第一部分

内容

# 2. 第二部分

内容`

            const result = parseDocument(input)
            const l1Items = result.filter(r => r.type === 'l1')

            expect(l1Items.length).toBe(2)
            expect(l1Items[0]?.l1I).toBe(1)
            expect(l1Items[1]?.l1I).toBe(2)
        })

        it('应解析各级别的标准格式', () => {
            const input = `# 第一编 总则

## 第一分编 概述

### 第一章 规定

#### 第一节 条文

##### 第一条 内容

详细内容`

            const result = parseDocument(input)

            // 验证各级别序号
            const l1 = result.find(r => r.type === 'l1')
            const l2 = result.find(r => r.type === 'l2')
            const l3 = result.find(r => r.type === 'l3')
            const l4 = result.find(r => r.type === 'l4')
            const l5 = result.find(r => r.type === 'l5')

            expect(l1?.l1I).toBe(1)
            expect(l2?.l2I).toBe(1)
            expect(l3?.l3I).toBe(1)
            expect(l4?.l4I).toBe(1)
            expect(l5?.l5I).toBe(1)
        })

        it('应解析无法匹配的标题返回 null 索引', () => {
            const input = `# 附则

内容`

            const result = parseDocument(input)
            const l1 = result.find(r => r.type === 'l1')

            expect(l1).toBeDefined()
            expect(l1?.l1I).toBeNull()
        })
    })

    // ==================== parseDocument 边缘情况 ====================

    describe('parseDocument - 额外边缘情况', () => {
        it('应正确处理 header 标签后紧跟 Markdown 标题', () => {
            const input = `>header<
法律名称
（通过日期）

# 第一编 总则

内容`

            const result = parseDocument(input)

            const header = result.find(r => r.type === 'header')
            const l1 = result.find(r => r.type === 'l1')

            expect(header).toBeDefined()
            expect(l1).toBeDefined()
        })

        it('应处理多个 notice 标签', () => {
            const input = `>notice<
公告一
>notice<
公告二
>notice<
公告三

# 第一编

内容`

            const result = parseDocument(input)
            const notices = result.filter(r => r.type === 'notice')

            expect(notices.length).toBe(3)
        })

        it('应处理 frontmatter + notice + header + 内容', () => {
            const input = `---
title: 测试
---

>notice<
公告

>header<
法律标题

# 第一编

内容

>annex<
附件

>footer<
落款`

            const result = parseDocument(input)

            expect(result.some(r => r.type === 'notice')).toBe(true)
            expect(result.some(r => r.type === 'header')).toBe(true)
            expect(result.some(r => r.type === 'l1')).toBe(true)
            expect(result.some(r => r.type === 'annex')).toBe(true)
            expect(result.some(r => r.type === 'footer')).toBe(true)
        })

        it('应正确清除低级别层级信息', () => {
            const input = `# 第一编

## 第一章

### 第一节

内容节

# 第二编

内容编`

            const result = parseDocument(input)

            // 第二编应该清除了 l2 和 l3 的信息
            const secondL1 = result.find(r => r.type === 'l1' && r.l1I === 2)
            expect(secondL1).toBeDefined()
            expect(secondL1?.l2).toBeNull()
            expect(secondL1?.l3).toBeNull()
        })
    })

    // ==================== convertChineseNumberToArabic 补充 ====================

    describe('convertChineseNumberToArabic - 补充测试', () => {
        it('应处理万位数字', () => {
            expect(convertChineseNumberToArabic('一万')).toBe(10000)
            expect(convertChineseNumberToArabic('一万零一')).toBe(10001)
            expect(convertChineseNumberToArabic('一万二千三百四十五')).toBe(12345)
        })

        it('应处理空字符串', () => {
            expect(convertChineseNumberToArabic('')).toBe(0)
        })

        it('应处理单个零', () => {
            expect(convertChineseNumberToArabic('零')).toBe(0)
        })
    })

    // ==================== parseJudicialCoreContent 边界 ====================

    describe('parseJudicialCoreContent - 混合标题格式', () => {
        it('应正确解析中文标题和阿拉伯数字标题混合', () => {
            const input = `标题

一、第一部分

说明内容

1．具体条目一

条目一内容

2．具体条目二

条目二内容

二、第二部分

第二部分内容`

            const result = parseJudicialDocument(input)

            const l1Items = result.filter(r => r.type === 'l1')
            const l2Items = result.filter(r => r.type === 'l2')

            expect(l1Items.length).toBe(2)
            expect(l2Items.length).toBe(2)

            // l2 应归属到 l1 之下
            expect(l2Items[0]?.l1).toContain('一、')
            expect(l2Items[0]?.l2I).toBe(1)
            expect(l2Items[1]?.l2I).toBe(2)
        })

        it('应处理只有阿拉伯数字标题的内容', () => {
            const input = `一、总则

1．第一项

第一项内容`

            const result = parseJudicialDocument(input)

            const l2Items = result.filter(r => r.type === 'l2')
            expect(l2Items.length).toBe(1)
            expect(l2Items[0]?.l2I).toBe(1)
        })
    })
})
