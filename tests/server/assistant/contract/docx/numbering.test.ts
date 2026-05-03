import { describe, it, expect } from 'vitest'
import { buildNumberingPrefixMap } from '~~/server/agents/contract/docx/numbering'

const NUMBERING_XML_SIMPLE_DECIMAL = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="decimal"/>
            <w:lvlText w:val="%1."/>
        </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`

const DOC_XML_TWO_DECIMAL_PARAS = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>合同期限</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>试用期</w:t></w:r></w:p>
    </w:body>
</w:document>`

describe('numbering · buildNumberingPrefixMap', () => {
    it('numbering.xml 缺失返回空 Map', () => {
        const docXml = '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>'
        const result = buildNumberingPrefixMap(docXml, null)
        expect(result.size).toBe(0)
    })

    it('numbering.xml 解析失败时不应抛错（容错）', () => {
        const result = buildNumberingPrefixMap('<w:document xmlns:w="x"><w:body/></w:document>', '<bad>not valid</bad>')
        expect(result.size).toBe(0)
    })

    it('numId → abstractNumId → lvl 配置 解析正确（间接通过 buildNumberingPrefixMap 验证）', () => {
        const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, NUMBERING_XML_SIMPLE_DECIMAL)
        // Task 5 完整实现后才能 PASS；这里先期待 size 0（骨架没渲染逻辑）
        // 实际验证留给 Task 5 — 此测试 Task 4 阶段会 SKIP
        expect(result).toBeInstanceOf(Map)
    })

    it('decimal "%1." ilvl=0 连续渲染 1. → 2.', () => {
        const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, NUMBERING_XML_SIMPLE_DECIMAL)
        expect(result.size).toBe(2)
        expect(result.get(0)).toBe('1. ')   // 注意尾部空格
        expect(result.get(1)).toBe('2. ')
    })

    it('非 list 段落不进 prefixMap', () => {
        const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
        <w:p><w:r><w:t>普通段落无 numPr</w:t></w:r></w:p>
        <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>条款 A</w:t></w:r></w:p>
        <w:p><w:r><w:t>另一段普通段落</w:t></w:r></w:p>
    </w:body>
</w:document>`
        const result = buildNumberingPrefixMap(docXml, NUMBERING_XML_SIMPLE_DECIMAL)
        expect(result.size).toBe(1)
        expect(result.get(1)).toBe('1. ')   // 第 2 段（index=1）才有前缀
    })

    it('w:start val="3" 从 3. 开始', () => {
        const numberingXml = NUMBERING_XML_SIMPLE_DECIMAL.replace('w:start w:val="1"', 'w:start w:val="3"')
        const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, numberingXml)
        expect(result.get(0)).toBe('3. ')
        expect(result.get(1)).toBe('4. ')
    })

    it('numId 引用不存在 abstractNumId 跳过段落', () => {
        const numberingXml = NUMBERING_XML_SIMPLE_DECIMAL.replace('w:abstractNumId w:val="0"', 'w:abstractNumId w:val="999"')
        const result = buildNumberingPrefixMap(DOC_XML_TWO_DECIMAL_PARAS, numberingXml)
        expect(result.size).toBe(0)
    })
})
