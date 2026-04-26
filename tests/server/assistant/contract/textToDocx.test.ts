import { describe, it, expect } from 'vitest'
import mammoth from 'mammoth'
import { textToDocxService } from '~~/server/agents/contract/textToDocx.service'

describe('textToDocxService', () => {
    it('纯中文文本 → .docx → mammoth 重读内容一致', async () => {
        const text = '甲方：张三\n乙方：李四\n本合同签订于 2026 年 4 月。'
        const buf = await textToDocxService(text)
        expect(Buffer.isBuffer(buf)).toBe(true)
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value).toContain('甲方：张三')
        expect(value).toContain('乙方：李四')
    })

    it('多段落文本按换行分段', async () => {
        const text = '段落一\n段落二\n段落三'
        const buf = await textToDocxService(text)
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value).toContain('段落一')
        expect(value).toContain('段落二')
        expect(value).toContain('段落三')
    })

    it('含 XML 特殊字符（<, &, "）正确转义', async () => {
        const text = '风险条款：a < b & c = "d"'
        const buf = await textToDocxService(text)
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value).toContain('a < b & c = "d"')
    })

    it('超长文本（~50KB）也能处理', async () => {
        const text = '条款内容。'.repeat(10000)
        const buf = await textToDocxService(text)
        expect(buf.length).toBeGreaterThan(1000)
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(value.length).toBeGreaterThan(1000)
    })

    it('空字符串返回合法 .docx（单空段落）', async () => {
        const buf = await textToDocxService('')
        const { value } = await mammoth.extractRawText({ buffer: buf })
        expect(typeof value).toBe('string')
    })
})
