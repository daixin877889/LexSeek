/**
 * OOXML AST helper 的基础能力测试。
 *
 * 只要本文件全绿，就能保证 AST 层的 round-trip + 属性读写 + 插入操作
 * 不会悄悄破坏 Word/LibreOffice 对 docx 的解析。
 */
import { describe, it, expect } from 'vitest'
import {
    parseOoxml,
    stringifyOoxml,
    tagOf,
    childrenOf,
    getAttr,
    setAttr,
    makeLeaf,
    makeElement,
    makeText,
    walk,
    findFirst,
    findAll,
    appendChildToFirst,
    textOf,
} from '~~/server/services/assistant/contract/docx/xmlAst'

describe('xmlAst', () => {
    const sampleDoc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p></w:body></w:document>`

    it('parse + stringify round-trip 保留 XML 声明和命名空间', () => {
        const ast = parseOoxml(sampleDoc)
        const out = stringifyOoxml(ast)
        expect(out).toContain('<?xml version="1.0" encoding="UTF-8"')
        expect(out).toContain('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"')
        expect(out).toContain('<w:t>Hello</w:t>')
        expect(out).toContain('<w:t>World</w:t>')
    })

    it('findAll 深度优先找到所有 w:p', () => {
        const ast = parseOoxml(sampleDoc)
        const paras = findAll(ast, 'w:p')
        expect(paras).toHaveLength(2)
    })

    it('findFirst 只返回第一个 w:body', () => {
        const ast = parseOoxml(sampleDoc)
        const body = findFirst(ast, 'w:body')
        expect(body).not.toBeNull()
        expect(tagOf(body!)).toBe('w:body')
    })

    it('childrenOf 返回子节点数组', () => {
        const ast = parseOoxml(sampleDoc)
        const body = findFirst(ast, 'w:body')!
        const kids = childrenOf(body)
        expect(kids).toHaveLength(2) // 两个 w:p
        expect(tagOf(kids[0]!)).toBe('w:p')
    })

    it('getAttr / setAttr 读写属性', () => {
        const xml = `<w:comment w:id="0" w:author="AI"/>`
        const ast = parseOoxml(xml)
        const node = findFirst(ast, 'w:comment')!
        expect(getAttr(node, 'w:id')).toBe('0')
        expect(getAttr(node, 'w:author')).toBe('AI')
        setAttr(node, 'w:id', '99')
        const out = stringifyOoxml(ast)
        expect(out).toContain('w:id="99"')
    })

    it('makeLeaf / makeElement / makeText 构造节点并序列化', () => {
        const leaf = makeLeaf('w:commentRangeStart', { 'w:id': '3' })
        const t = makeText('hi')
        const run = makeElement('w:r', {}, [makeElement('w:t', {}, [t])])
        const para = makeElement('w:p', {}, [leaf, run])
        const out = stringifyOoxml([para])
        expect(out).toContain('<w:commentRangeStart w:id="3"')
        expect(out).toContain('<w:r><w:t>hi</w:t></w:r>')
    })

    it('appendChildToFirst 往 Types 追加 Override', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`
        const ast = parseOoxml(xml)
        const override = makeLeaf('Override', {
            PartName: '/word/comments.xml',
            ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
        })
        appendChildToFirst(ast, 'Types', override)
        const out = stringifyOoxml(ast)
        expect(out).toContain('<Override PartName="/word/comments.xml"')
        // 用 indexOf 确认 Override 在 Default 之后
        expect(out.indexOf('<Default')).toBeLessThan(out.indexOf('<Override'))
    })

    it('walk 能停止遍历（visit 返回 false）', () => {
        const ast = parseOoxml(sampleDoc)
        let count = 0
        walk(ast, () => {
            count++
            if (count === 2) return false
        })
        expect(count).toBe(2)
    })

    it('textOf 取浅层文本', () => {
        const xml = `<w:t>Hello World</w:t>`
        const ast = parseOoxml(xml)
        const t = findFirst(ast, 'w:t')!
        expect(textOf(t)).toBe('Hello World')
    })

    it('XML 特殊字符在 round-trip 后正确转义', () => {
        const leaf = makeElement('w:t', {}, [makeText('条款 <A> 与 "B" & \'C\'')])
        const out = stringifyOoxml([leaf])
        expect(out).toContain('&lt;A&gt;')
        expect(out).toContain('&amp;')
        // 再 parse 回来能还原
        const ast2 = parseOoxml(out)
        const t = findFirst(ast2, 'w:t')!
        expect(textOf(t)).toBe('条款 <A> 与 "B" & \'C\'')
    })
})
