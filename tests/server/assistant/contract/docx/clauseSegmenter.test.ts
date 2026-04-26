import { describe, it, expect } from 'vitest'
import { segmentClausesByRegex } from '~~/server/agents/contract/docx/clauseSegmenter'

describe('clauseSegmenter · 正则切分', () => {
    it('按 "第X条" 切分', () => {
        const text = [
            '第一条 合同标的',
            '甲方委托乙方……',
            '第二条 付款方式',
            '3.1 首付 40%',
            '第三条 争议解决',
            '以仲裁方式解决。',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['第一条', '第二条', '第三条'])
        expect(segments[0]?.text).toContain('甲方委托乙方')
    })

    it('按 "1.1" 级层级编号切分', () => {
        const text = [
            '1. 总则',
            '1.1 本合同……',
            '1.2 双方应……',
            '2. 权利义务',
            '2.1 甲方应……',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['1.', '1.1', '1.2', '2.', '2.1'])
    })

    it('按 "一、" 中文序号切分', () => {
        const text = ['一、协议内容', '双方约定如下。', '二、违约责任', '违约方承担……'].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.number)).toEqual(['一、', '二、'])
    })

    it('无编号散段整篇作为一个 segment（number=null）', () => {
        const text = '双方经友好协商，就某项目达成如下约定。'
        const { segments } = segmentClausesByRegex(text)
        expect(segments).toHaveLength(1)
        expect(segments[0]?.number).toBeNull()
        expect(segments[0]?.text).toBe(text)
    })

    it('混合编号：第X条 + 1.1 共存，各自识别', () => {
        const text = [
            '第一条 定义',
            '1.1 本合同项下……',
            '1.2 双方约定……',
            '第二条 付款',
            '2.1 总金额 100 万。',
        ].join('\n')
        const { segments } = segmentClausesByRegex(text)
        expect(segments).toHaveLength(5)
        expect(segments.map(s => s.number)).toEqual(['第一条', '1.1', '1.2', '第二条', '2.1'])
        expect(segments.map(s => s.index)).toEqual([1, 2, 3, 4, 5])
    })

    it('返回结果 index 从 1 开始且连续', () => {
        const text = '第一条 A\n第二条 B\n第三条 C'
        const { segments } = segmentClausesByRegex(text)
        expect(segments.map(s => s.index)).toEqual([1, 2, 3])
    })

    it('含 \\r\\n 时 normalizedText.slice(offsetStart, offsetEnd) === segment.text', () => {
        // 验证 \r\n 归一化后 offset 与文本仍对齐（Phase B diff 的核心保证）
        const fullText = [
            '第一条 总则\r\n甲方应履行义务。',
            '第二条 价款\r\n乙方应支付 100 万元。',
            '第三条 争议\r\n以仲裁方式解决。',
        ].join('\r\n')
        const { segments, normalizedText } = segmentClausesByRegex(fullText)
        expect(segments.length).toBeGreaterThan(0)
        for (const s of segments) {
            expect(normalizedText.slice(s.offsetStart, s.offsetEnd)).toBe(s.text)
        }
    })

    it('纯 \\n 文本 normalizedText.slice(offsetStart, offsetEnd) === segment.text', () => {
        // 验证纯 \n 文本同样满足 offset 一致性
        const fullText = '第一条 总则\n甲方应履行义务。\n第二条 价款\n乙方应支付 100 万元。'
        const { segments, normalizedText } = segmentClausesByRegex(fullText)
        expect(segments.length).toBeGreaterThan(0)
        for (const s of segments) {
            expect(normalizedText.slice(s.offsetStart, s.offsetEnd)).toBe(s.text)
        }
    })

    it('无标号散段含 \\r\\n 时 offset 也正确', () => {
        const fullText = '双方经友好协商，\r\n就某项目达成如下约定。'
        const { segments, normalizedText } = segmentClausesByRegex(fullText)
        expect(segments).toHaveLength(1)
        const s = segments[0]!
        expect(normalizedText.slice(s.offsetStart, s.offsetEnd)).toBe(s.text)
    })
})
