/**
 * clauseSegmenter 单元测试
 *
 * 覆盖目标：90%+ 行覆盖率
 *
 * 测试范围：
 * - 中文数字解析：「第一条」/「第二十条」/「第一百零五条」/「第一千零一条」
 * - 阿拉伯数字编号：「第1条」/「第10条」
 * - 多级编号：「1.」/「1.1」/「1.1.1」
 * - 中文序号：「一、」/「二、」
 * - 混合格式：「第X条」+「X.X」中只有匹配父序号才识别
 * - 无标号文本：整篇视为单 segment
 * - normalizedText：\r\n → \n
 * - 偏移量精确：offsetStart/offsetEnd 对齐 normalizedText slice
 * - LLM fallback：命中不足触发 / 命中足够不触发 / fallback 抛错降级
 *
 * **Validates: 阶段 8 测试覆盖率提升**
 */

import { describe, it, expect, vi } from 'vitest'
import {
    segmentClausesByRegex,
    segmentClauses,
} from '~~/server/agents/contract/docx/clauseSegmenter'

describe('segmentClausesByRegex', () => {
    describe('中文数字编号', () => {
        it('单字「第一条」「第二条」识别成功', () => {
            const text = '第一条 甲方义务\n第二条 乙方义务\n第三条 违约责任'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(3)
            expect(r.segments[0]?.number).toBe('第一条')
            expect(r.segments[1]?.number).toBe('第二条')
            expect(r.segments[2]?.number).toBe('第三条')
        })

        it('「第十条」「第十一条」「第二十条」识别成功', () => {
            const text = '第十条 内容A\n第十一条 内容B\n第二十条 内容C'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(3)
            expect(r.segments[0]?.number).toBe('第十条')
        })

        it('「第一百条」「第一百零五条」识别成功', () => {
            const text = '第一百条 a\n第一百零五条 b\n第一百二十三条 c'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(3)
        })

        it('「第一千条」「第一千零一条」识别成功（cn 数字 4 位）', () => {
            const text = '第一千条 a\n第一千零一条 b\n第二千零五十六条 c'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(3)
        })
    })

    describe('阿拉伯数字编号', () => {
        it('「第1条」「第10条」识别成功', () => {
            const text = '第1条 a\n第2条 b\n第10条 c'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(3)
        })
    })

    describe('多级编号', () => {
        it('单层「1.」「2.」识别成功（不含中文条款关键字）', () => {
            // 用纯阿拉伯编号文本，避免「第X条」的副作用
            const text = '1. 总则部分\n2. 双方义务\n3. 违约责任'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(3)
            expect(r.segments[0]?.number).toBe('1.')
        })

        it('多层「1.1」「2.1」识别成功', () => {
            const text = '1. 总则部分\n1.1 子条款 A\n2. 双方义务\n2.1 子条款 B'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(4)
        })
    })

    describe('中文序号「一、」', () => {
        it('「一、」「二、」识别成功', () => {
            const text = '一、第一项\n二、第二项\n三、第三项'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(3)
            expect(r.segments[0]?.number).toBe('一、')
        })
    })

    describe('混合格式', () => {
        it('「第X条」+ 匹配父序号的「X.X」识别为子条款', () => {
            const text = '第一条 总则\n1.1 子项 A\n第二条 义务\n2.1 子项 B'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(4)
        })

        it('「第X条」+ 不匹配父序号的「Y.Y」忽略（归入上一条）', () => {
            // 此场景：第一条下出现 3.1（父=1，子前缀=3，不匹配），3.1 应忽略
            const text = '第一条 总则\n3.1 不应识别\n第二条 第二项'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(2)
            expect(r.segments[0]?.text).toContain('3.1')
        })
    })

    describe('无标号文本', () => {
        it('无任何编号 → 整篇作为单 segment（number=null）', () => {
            const text = '这是一段无编号的合同正文。\n第二段也无编号。'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(1)
            expect(r.segments[0]?.number).toBeNull()
        })

        it('完全空文本 → 空 segments', () => {
            const r = segmentClausesByRegex('')
            expect(r.segments).toHaveLength(0)
        })

        it('仅空白 → 空 segments', () => {
            const r = segmentClausesByRegex('   \n  \n  ')
            expect(r.segments).toHaveLength(0)
        })
    })

    describe('normalizedText / 偏移量', () => {
        it('\\r\\n 折成 \\n', () => {
            const text = '第一条\r\n第二条\r\n'
            const r = segmentClausesByRegex(text)
            expect(r.normalizedText).toBe('第一条\n第二条\n')
        })

        it('offsetStart/offsetEnd slice normalizedText 等于 segment.text', () => {
            const text = '第一条 甲方义务\n第二条 乙方义务\n第三条 违约'
            const r = segmentClausesByRegex(text)
            for (const seg of r.segments) {
                const slice = r.normalizedText.slice(seg.offsetStart, seg.offsetEnd)
                expect(slice).toBe(seg.text)
            }
        })

        it('单 segment（无标号）时偏移量精确', () => {
            const text = '  这是一段正文，前面有空白。  '
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(1)
            const seg = r.segments[0]!
            const slice = r.normalizedText.slice(seg.offsetStart, seg.offsetEnd)
            expect(slice).toBe(seg.text)
            expect(seg.text).toBe('这是一段正文，前面有空白。')
        })
    })

    describe('index 编号', () => {
        it('index 从 1 开始连续', () => {
            const text = '第一条 a\n第二条 b\n第三条 c'
            const r = segmentClausesByRegex(text)
            expect(r.segments.map(s => s.index)).toEqual([1, 2, 3])
        })

        it('跳过空 segment 后仍连续编号', () => {
            const text = '第一条\n\n\n第二条 内容\n\n第三条 内容C'
            const r = segmentClausesByRegex(text)
            // 第一条无内容也算一条；第二、三有内容
            expect(r.segments.length).toBeGreaterThan(0)
            // 验证 index 单调递增
            for (let i = 1; i < r.segments.length; i++) {
                expect(r.segments[i]?.index).toBe((r.segments[i - 1]?.index ?? 0) + 1)
            }
        })

        it('完全空标号行（match 之间无文本）会被跳过', () => {
            // 第一条紧接第二条，中间无内容；切出来的 raw="第一条" trim 后非空
            const text = '第一条\n第二条\n第三条'
            const r = segmentClausesByRegex(text)
            expect(r.segments.length).toBeGreaterThan(0)
        })
    })

    describe('混合编号场景', () => {
        it('中文「一、」+「二、」+ 正文混合', () => {
            const text = '一、第一项内容\n详细说明 A\n二、第二项内容\n详细说明 B'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(2)
            // text 应包含正文行
            expect(r.segments[0]?.text).toContain('详细说明 A')
            expect(r.segments[1]?.text).toContain('详细说明 B')
        })
    })

    describe('M20：「第X条」行首锚定', () => {
        it('正文中段引用「第X条」（如「根据第3条约定」）不被误判为新条款起点', () => {
            const text = [
                '第一条 总则',
                '本合同自双方签字之日起生效。',
                '第二条 付款',
                '甲方应当根据第3条约定的方式支付款项。', // 正文引用，非条款起点
                '第三条 交付',
                '乙方应当按时交付货物。',
            ].join('\n')
            const r = segmentClausesByRegex(text)
            // 只应切出 3 个条款（第一/二/三条），中段引用行不算
            expect(r.segments).toHaveLength(3)
            expect(r.segments.map(s => s.number)).toEqual(['第一条', '第二条', '第三条'])
            // 引用行归入第二条正文
            expect(r.segments[1]?.text).toContain('根据第3条约定')
        })

        it('行首允许前导空白的「第X条」仍识别为条款起点', () => {
            const text = '  第一条 总则\n正文 A\n   第二条 付款\n正文 B'
            const r = segmentClausesByRegex(text)
            expect(r.segments).toHaveLength(2)
            expect(r.segments.map(s => s.number)).toEqual(['第一条', '第二条'])
        })
    })

    describe('L3：「第X.Y条」多级编号提取序号', () => {
        it('「第3.1条」能提取整数序号，使后续多级子项 3.x 正确识别', () => {
            const text = [
                '第3.1条 交付条款',
                '甲方应当按时交付。',
                '3.2 验收子项内容',
                '乙方按约验收。',
            ].join('\n')
            const r = segmentClausesByRegex(text)
            // 「第3.1条」提取出序号 3 → 后续多级子项「3.2」匹配父序号成立、独立成段。
            // 旧实现 extractDiTiaoIndex 对「第3.1条」返回 null，3.2 并入正文 → 仅 1 段。
            expect(r.segments).toHaveLength(2)
            expect(r.segments.map(s => s.number)).toEqual(['第3.1条', '3.2'])
        })
    })
})

describe('segmentClauses（async 入口）', () => {
    it('正则命中足够 → 直接返回正则结果，不调 fallback', async () => {
        const fallback = vi.fn(async () => ({ segments: [], normalizedText: '' }))
        const text = '第一条 a\n第二条 b\n第三条 c\n第四条 d'
        const r = await segmentClauses(text, { llmFallback: fallback })
        expect(r.segments).toHaveLength(4)
        expect(fallback).not.toHaveBeenCalled()
    })

    it('正则命中不足 + 无 fallback → 直接返回正则结果', async () => {
        // 1 个编号，默认 minHits=3
        const text = '第一条 内容\n后续无编号\n继续无编号'
        const r = await segmentClauses(text)
        // 正则识别 1 条，无 fallback 直接返回
        expect(r.segments.length).toBeGreaterThanOrEqual(1)
    })

    it('正则命中不足 + fallback 返回有结果 → 使用 fallback 结果', async () => {
        const fallbackResult = {
            segments: [
                { index: 1, number: '第一条', text: 'fallback A', offsetStart: 0, offsetEnd: 10 },
                { index: 2, number: '第二条', text: 'fallback B', offsetStart: 11, offsetEnd: 21 },
            ],
            normalizedText: 'fallback A\nfallback B',
        }
        const fallback = vi.fn(async () => fallbackResult)
        // 正则只能识别 1 条，触发 fallback
        const r = await segmentClauses('零散文本无编号', { llmFallback: fallback, minRegexHits: 3 })
        expect(fallback).toHaveBeenCalledTimes(1)
        expect(r.segments).toEqual(fallbackResult.segments)
    })

    it('正则命中不足 + fallback 返回空 → 降级回正则结果', async () => {
        const fallback = vi.fn(async () => ({ segments: [], normalizedText: '' }))
        const r = await segmentClauses('无编号文本', { llmFallback: fallback, minRegexHits: 3 })
        expect(fallback).toHaveBeenCalledTimes(1)
        // fallback 返回空 → 走正则结果（单 segment 无标号）
        expect(r.segments.length).toBeGreaterThan(0)
    })

    it('正则命中不足 + fallback 抛错 → 降级回正则结果（不抛）', async () => {
        const fallback = vi.fn(async () => {
            throw new Error('LLM 调用失败')
        })
        const r = await segmentClauses('无编号文本', { llmFallback: fallback, minRegexHits: 3 })
        expect(fallback).toHaveBeenCalledTimes(1)
        expect(r.segments.length).toBeGreaterThan(0)
    })

    it('自定义 minRegexHits=1 时单条编号命中即不走 fallback', async () => {
        const fallback = vi.fn(async () => ({ segments: [], normalizedText: '' }))
        const r = await segmentClauses(
            '第一条 单条\n后面无编号',
            { llmFallback: fallback, minRegexHits: 1 },
        )
        expect(fallback).not.toHaveBeenCalled()
        expect(r.segments.length).toBeGreaterThanOrEqual(1)
    })
})
