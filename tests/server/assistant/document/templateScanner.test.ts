import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { scanPlaceholders } from '~~/server/services/assistant/document/templateScanner'

describe('scanPlaceholders', () => {
    it('提取纯英文占位符', async () => {
        const buf = await readFile('tests/fixtures/document-templates/english.docx')
        const result = await scanPlaceholders(buf)
        expect(result.map(p => p.name)).toEqual(expect.arrayContaining(['plaintiff_name', 'loan_amount']))
    })

    it('提取纯中文占位符', async () => {
        const buf = await readFile('tests/fixtures/document-templates/chinese.docx')
        const result = await scanPlaceholders(buf)
        expect(result.map(p => p.name)).toEqual(expect.arrayContaining(['原告', '借款金额']))
    })

    it('中英混合 + 去重', async () => {
        const buf = await readFile('tests/fixtures/document-templates/mixed.docx')
        const result = await scanPlaceholders(buf)
        const names = result.map(p => p.name)
        expect(names).toContain('原告')
        expect(names).toContain('plaintiff_id')
        expect(new Set(names).size).toBe(names.length) // 去重
    })

    it('每个占位符携带首次出现段落上下文', async () => {
        const buf = await readFile('tests/fixtures/document-templates/mixed.docx')
        const result = await scanPlaceholders(buf)
        const pl = result.find(p => p.name === '原告')
        expect(pl?.firstContext).toContain('原告')
    })

    it('无占位符返回空数组', async () => {
        const buf = await readFile('tests/fixtures/document-templates/empty.docx')
        const result = await scanPlaceholders(buf)
        expect(result).toEqual([])
    })
})
