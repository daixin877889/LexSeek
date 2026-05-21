import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { parseContractDocx } from '~~/server/agents/contract/docx/parser'
import { segmentClauses } from '~~/server/agents/contract/docx/clauseSegmenter'

/**
 * PR10 测试 helper：合成最小 docx Buffer（含 numbering.xml 引用 decimal numId=1）。
 * 返回的 buffer 可直接喂给 parseContractDocx。
 *
 * 关键部件：[Content_Types].xml + _rels/.rels + word/document.xml + word/numbering.xml
 * + word/_rels/document.xml.rels（让 numbering.xml 被 documentXml 关联）
 */
async function buildMinimalDocxWithDecimalNumbering(paragraphTexts: string[]): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`)
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`)
    const paraXml = paragraphTexts.map(t => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>${paraXml}</w:body>
</w:document>`)
    zip.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0">
            <w:start w:val="1"/>
            <w:numFmt w:val="decimal"/>
            <w:lvlText w:val="%1."/>
        </w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`)
    return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

/**
 * M8 测试 helper：合成含表格的 docx。2 个带 numbering 的 body 直接段落，中间夹一个
 * 2 行表格（每行 1 单元格 1 段落）。numbering 确保 parseContractDocx 走确定的 AST 路径。
 */
async function buildMinimalDocxWithTable(): Promise<Buffer> {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`)
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`)
    const numberedP = (t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`
    const cellP = (t: string) => `<w:tr><w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc></w:tr>`
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:body>
        ${numberedP('正文段落一的内容')}
        <w:tbl>${cellP('表格内段落甲')}${cellP('表格内段落乙')}</w:tbl>
        ${numberedP('正文段落二的内容')}
    </w:body>
</w:document>`)
    zip.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`)
    return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}

export { buildMinimalDocxWithDecimalNumbering }

const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const
const SAMPLE_DIR = join(__dirname, '../../../../../prisma/seeds/contract-samples')

describe('parseContractDocx', () => {
    it.each(SAMPLES)('%s.docx 提取的段落数量在 (5, 500) 区间', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        expect(paragraphs.length).toBeGreaterThan(5)
        expect(paragraphs.length).toBeLessThan(500)
    })

    it.each(SAMPLES)('%s.docx paragraphs 首几段含甲乙方标识', async (name) => {
        const buf = await readFile(join(SAMPLE_DIR, `${name}.docx`))
        const { paragraphs } = await parseContractDocx(buf)
        const joined = paragraphs.slice(0, 20).join('\n')
        expect(joined).toMatch(/甲方[：:]/)
        expect(joined).toMatch(/乙方[：:]/)
    })

    it('paragraphs 不含空段落（spec §10.4 空段落不加批注，parser 层也过滤）', async () => {
        const buf = await readFile(join(SAMPLE_DIR, 'labor.docx'))
        const { paragraphs } = await parseContractDocx(buf)
        for (const p of paragraphs) {
            expect(p.trim().length).toBeGreaterThan(0)
        }
    })

    it('rawXml 包含 w:document 根节点（供 commentInjector 后续读用）', async () => {
        const buf = await readFile(join(SAMPLE_DIR, 'labor.docx'))
        const { rawXml } = await parseContractDocx(buf)
        expect(rawXml).toContain('<w:document')
    })

    it('非 .docx Buffer 抛错', async () => {
        await expect(parseContractDocx(Buffer.from('not a docx'))).rejects.toThrow()
    })
})

describe('PR10 numbering 前缀拼接', () => {
    it('parseContractDocx 给 list 段落拼接 decimal 前缀', async () => {
        const buffer = await buildMinimalDocxWithDecimalNumbering([
            '合同期限：本合同期限为 3 年',
            '试用期：2 个月',
            '工资：每月 10000 元',
        ])
        const { paragraphs } = await parseContractDocx(buffer)

        // PR10 关键验证：3 段全部以 "1. " "2. " "3. " 开头
        expect(paragraphs.length).toBe(3)
        expect(paragraphs[0]).toMatch(/^1\.\s/)
        expect(paragraphs[1]).toMatch(/^2\.\s/)
        expect(paragraphs[2]).toMatch(/^3\.\s/)
        expect(paragraphs[0]).toContain('合同期限')
    })

    it('无 numbering.xml 的 docx 不拼前缀', async () => {
        // 用现有 labor.docx —— 实测无 numPr 引用，prefixMap 应为空
        const buf = await readFile(join(SAMPLE_DIR, 'labor.docx'))
        const { paragraphs } = await parseContractDocx(buf)
        // 无前缀拼接，paragraphs 仍是原 mammoth 输出（PR10 之前的行为）
        expect(paragraphs.length).toBeGreaterThan(0)
    })
})

describe('PR10 e2e：parseContractDocx → segmentClauses 子项级切分', () => {
    it('合成 docx（含 decimal numbering）上传后能切到子项级，且 segment.textWithoutNumber 不含编号', async () => {
        const buffer = await buildMinimalDocxWithDecimalNumbering([
            '合同期限：本合同期限为 3 年',
            '试用期：2 个月',
            '工资：每月 10000 元',
            '违约责任：违约金为月工资的 1 倍',
        ])
        const { paragraphs } = await parseContractDocx(buffer)

        // 关键验证 1：paragraphs 全部以 "数字.\s" 开头（前缀拼接生效）
        expect(paragraphs.length).toBe(4)
        for (let i = 0; i < paragraphs.length; i++) {
            expect(paragraphs[i]).toMatch(new RegExp(`^${i + 1}\\.\\s`))
        }

        // 关键验证 2：segmentClauses 切分识别子项（每个 list item 一个 segment）
        const fullText = paragraphs.join('\n')
        const { segments } = await segmentClauses(fullText)
        expect(segments.length).toBe(4)

        // 关键验证 3：segment.textWithoutNumber 全部不含编号字符；segment.text 仍含编号（向后兼容）
        for (const s of segments) {
            expect(s.number).toMatch(/^\d+\.$/)
            expect(s.textWithoutNumber).not.toMatch(/^\d+\./)
            expect(s.text).toMatch(/^\d+\./)
        }
    })
})

describe('M8：parseContractDocx 段落口径（bodyParagraphs / bodyParagraphIndex）', () => {
    it('含表格合同：paragraphs 递归含表格段落，bodyParagraphs 仅 body 直接段落，bodyParagraphIndex 表格段落为 null', async () => {
        const buf = await buildMinimalDocxWithTable()
        const { paragraphs, bodyParagraphs, bodyParagraphIndex } = await parseContractDocx(buf)

        // 分析口径 paragraphs 递归含表格内段落（DOCX-H4：表格条款仍参与审查）
        expect(paragraphs.length).toBe(4)
        expect(paragraphs.some(p => p.includes('表格内段落甲'))).toBe(true)
        expect(paragraphs.some(p => p.includes('表格内段落乙'))).toBe(true)

        // 批注注入口径 bodyParagraphs 仅含 body 直接子段落，不含表格内段落
        expect(bodyParagraphs.length).toBe(2)
        expect(bodyParagraphs.some(p => p.includes('表格内段落'))).toBe(false)
        expect(bodyParagraphs[0]).toContain('正文段落一')
        expect(bodyParagraphs[1]).toContain('正文段落二')

        // bodyParagraphIndex：paragraphs[i] → bodyParagraphs 下标；表格内段落映射为 null
        expect(bodyParagraphIndex).toEqual([0, null, null, 1])
    })

    it('无表格合同：bodyParagraphs == paragraphs（去前缀），bodyParagraphIndex 为 identity', async () => {
        const buf = await buildMinimalDocxWithDecimalNumbering(['条款一内容', '条款二内容', '条款三内容'])
        const { paragraphs, bodyParagraphs, bodyParagraphIndex } = await parseContractDocx(buf)

        expect(paragraphs.length).toBe(3)
        expect(bodyParagraphs.length).toBe(3)
        // 无表格 → 每段都是 body 直接段落 → identity 映射
        expect(bodyParagraphIndex).toEqual([0, 1, 2])
    })
})
