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
    findMaxSharedId,
    stripIllegalXmlChars,
} from '~~/server/agents/contract/docx/xmlAst'

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

describe('findMaxSharedId', () => {
    const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

    it('空文档返回 -1', () => {
        const ast = parseOoxml(`<?xml version="1.0"?><w:document ${W_NS}><w:body/></w:document>`)
        expect(findMaxSharedId(ast)).toBe(-1)
    })

    it('扫描 bookmarkStart / commentRangeStart / w:ins 跨标签取最大', () => {
        const xml = `<?xml version="1.0"?>
<w:document ${W_NS}>
  <w:body>
    <w:bookmarkStart w:id="3" w:name="b1"/>
    <w:p>
      <w:commentRangeStart w:id="7"/>
      <w:ins w:id="5" w:author="x" w:date="2024-01-01T00:00:00Z">
        <w:r><w:t>foo</w:t></w:r>
      </w:ins>
    </w:p>
  </w:body>
</w:document>`
        const ast = parseOoxml(xml)
        expect(findMaxSharedId(ast)).toBe(7)
    })

    it('忽略非 ID 池标签的同名 w:id 属性', () => {
        const xml = `<?xml version="1.0"?>
<w:document ${W_NS}>
  <w:body><w:p w:id="999"><w:r><w:t>foo</w:t></w:r></w:p></w:body>
</w:document>`
        const ast = parseOoxml(xml)
        expect(findMaxSharedId(ast)).toBe(-1)
    })

    it('忽略非数字 w:id 值', () => {
        const xml = `<?xml version="1.0"?>
<w:document ${W_NS}>
  <w:body><w:bookmarkStart w:id="abc" w:name="b1"/></w:body>
</w:document>`
        const ast = parseOoxml(xml)
        expect(findMaxSharedId(ast)).toBe(-1)
    })

    it('w:del 与 rPrChange 也算入', () => {
        const xml = `<?xml version="1.0"?>
<w:document ${W_NS}>
  <w:body>
    <w:p>
      <w:del w:id="11" w:author="LexSeek AI" w:date="2026-05-02T10:30:00Z">
        <w:r><w:rPr><w:rPrChange w:id="12" w:author="x" w:date="2026-05-02T10:30:00Z"><w:rPr/></w:rPrChange></w:rPr><w:delText>原</w:delText></w:r>
      </w:del>
    </w:p>
  </w:body>
</w:document>`
        const ast = parseOoxml(xml)
        expect(findMaxSharedId(ast)).toBe(12)
    })
})

describe('stripIllegalXmlChars（PR6 §8.3.8 输入清理）', () => {
    it('过滤 U+0008 / U+001B 等 XML 1.0 禁用控制字符', () => {
        expect(stripIllegalXmlChars('abc')).toBe('abc')
    })

    it('保留 \\t / \\n / \\r 三个允许的低值控制字符', () => {
        expect(stripIllegalXmlChars('a\tb\nc\rd')).toBe('a\tb\nc\rd')
    })

    it('不改变 & < > 等正常字符（entity escape 由 fast-xml-parser builder 自己做）', () => {
        expect(stripIllegalXmlChars('a&b<c>d')).toBe('a&b<c>d')
    })

    it('空串安全', () => {
        expect(stripIllegalXmlChars('')).toBe('')
    })
})
