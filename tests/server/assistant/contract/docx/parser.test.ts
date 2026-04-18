import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseContractDocx } from '~~/server/services/assistant/contract/docx/parser'

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
