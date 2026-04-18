import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'

const SAMPLE_DIR = join(__dirname, '../../../../prisma/seeds/contract-samples')
const SAMPLES = ['labor', 'lease', 'sale', 'service', 'loan'] as const

describe('合同审查样本 fixture', () => {
    it.each(SAMPLES)('%s.docx 可 mammoth 解析 + 含甲乙方标识', async (name) => {
        const path = join(SAMPLE_DIR, `${name}.docx`)
        const buffer = await readFile(path)
        const { value: rawText } = await mammoth.extractRawText({ buffer })

        // M1 冒烟：能解析出非空文本即可；段落数详细校验推到 M2 docx parser 单测
        expect(rawText.length).toBeGreaterThan(0)
        expect(rawText).toMatch(/甲方[：:]/)
        expect(rawText).toMatch(/乙方[：:]/)
    })
})
