/**
 * paragraphRejectText 单元测试（S5 · 拒绝所有修订视图）
 *
 * 拒绝视图：取 <w:delText>（被删原文）+ 非 <w:ins> 的 <w:t>（未改原文），跳过 <w:ins>。
 * 用于回传锚点迁移在定稿态失配时回退——还原首轮审查原文，原文锚点才能命中。
 *
 * **Validates: 合同审查 orphaned 专项 S5**
 */
import { describe, it, expect } from 'vitest'
import { parseOoxml, paragraphRejectText, paragraphText } from '~~/server/agents/contract/docx/xmlAst'

describe('paragraphRejectText（S5 拒绝所有修订视图）', () => {
    it('取 <w:delText> 原文 + 非 ins 的 <w:t>，跳过 <w:ins>', () => {
        const xml = '<w:p><w:r><w:t>前段不变。</w:t></w:r>'
            + '<w:del><w:r><w:delText>被删的原问题片段。</w:delText></w:r></w:del>'
            + '<w:ins><w:r><w:t>AI 建议的新文字。</w:t></w:r></w:ins>'
            + '<w:r><w:t>后段不变。</w:t></w:r></w:p>'
        const para = parseOoxml(xml)[0]!
        // 拒绝修订：保留原文（含被删片段），排除插入
        expect(paragraphRejectText(para)).toBe('前段不变。被删的原问题片段。后段不变。')
        // 接受修订（对照）：保留插入，丢被删
        expect(paragraphText(para)).toBe('前段不变。AI 建议的新文字。后段不变。')
    })

    it('无修订标记的普通段落：拒绝视图 == 接受视图', () => {
        const xml = '<w:p><w:r><w:t>第一条 甲方应当按时支付货款。</w:t></w:r></w:p>'
        const para = parseOoxml(xml)[0]!
        expect(paragraphRejectText(para)).toBe('第一条 甲方应当按时支付货款。')
        expect(paragraphRejectText(para)).toBe(paragraphText(para))
    })

    it('整条被替换（whole-clause del+ins）：拒绝视图取被删的整条原文', () => {
        const xml = '<w:p>'
            + '<w:del><w:r><w:delText>第三条 乙方逾期交付的，每日按千分之五加收滞纳金。</w:delText></w:r></w:del>'
            + '<w:ins><w:r><w:t>第三条 乙方逾期交付的，每日按万分之五加收滞纳金。</w:t></w:r></w:ins>'
            + '</w:p>'
        const para = parseOoxml(xml)[0]!
        expect(paragraphRejectText(para)).toBe('第三条 乙方逾期交付的，每日按千分之五加收滞纳金。')
    })
})
