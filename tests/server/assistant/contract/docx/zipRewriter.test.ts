import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    loadDocxZip,
    readTextFromZip,
    writeTextToZip,
    zipToBuffer,
} from '~~/server/agents/contract/docx/zipRewriter'

const SAMPLE = join(__dirname, '../../../../../prisma/seeds/contract-samples/labor.docx')

describe('zipRewriter (jszip 封装)', () => {
    it('loadDocxZip + readTextFromZip 读到 word/document.xml 且含 w:document 根节点', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        const xml = await readTextFromZip(zip, 'word/document.xml')
        expect(xml).toContain('<w:document')
        expect(xml).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"')
    })

    it('writeTextToZip 新增文件 → generate 后 loadDocxZip 能读回', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        writeTextToZip(zip, 'word/comments.xml', '<?xml version="1.0"?><w:comments/>')
        const newBuf = await zipToBuffer(zip)
        const zip2 = await loadDocxZip(newBuf)
        expect(zip2.file('word/comments.xml')).not.toBeNull()
        const read = await readTextFromZip(zip2, 'word/comments.xml')
        expect(read).toContain('<w:comments/>')
    })

    it('writeTextToZip 覆盖既有文件', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        const original = await readTextFromZip(zip, '[Content_Types].xml')
        writeTextToZip(zip, '[Content_Types].xml', original.replace('</Types>', '<X/></Types>'))
        const newBuf = await zipToBuffer(zip)
        const zip2 = await loadDocxZip(newBuf)
        const read = await readTextFromZip(zip2, '[Content_Types].xml')
        expect(read).toContain('<X/>')
    })

    it('readTextFromZip 文件不存在时抛错', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        await expect(readTextFromZip(zip, 'not/exists.xml')).rejects.toThrow('zip 中不存在 not/exists.xml')
    })

    it('zipToBuffer 产出的 Buffer 可被 mammoth 解析（基本合法性）', async () => {
        const buf = await readFile(SAMPLE)
        const zip = await loadDocxZip(buf)
        const out = await zipToBuffer(zip)
        const mammoth = await import('mammoth')
        const { value } = await mammoth.default.extractRawText({ buffer: out })
        expect(value.length).toBeGreaterThan(0)
    })
})
