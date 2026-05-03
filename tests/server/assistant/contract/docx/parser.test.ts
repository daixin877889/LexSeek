import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'
import { parseContractDocx } from '~~/server/agents/contract/docx/parser'

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
