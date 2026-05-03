/**
 * OOXML AST 轻封装（基于 fast-xml-parser）。
 *
 * 为什么不直接用 fxp：Office OOXML 对 whitespace / 属性顺序 / 命名空间声明
 * 敏感，需要 `preserveOrder: true` + 一整套 attr 前缀约定。把这些"口径"统一
 * 收束到本模块，让业务代码只看到"AST 节点怎么遍历/插入"，避免在各处重复
 * 调 parser 配置（且各处配置跑偏会导致 round-trip 丢失信息 → Word 报损坏）。
 *
 * 术语：
 *   - Node: fxp preserveOrder 模式下的节点，格式 { [tag]: Node[], ':@': attrs }
 *     叶子文本节点格式 { '#text': string }
 *   - Tag: 节点第一个非 `:@` / `#text` 的 key，即 XML 元素名
 */
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

const ATTR_PREFIX = '@_'
const ATTR_GROUP = ':@'
const TEXT_KEY = '#text'

const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    allowBooleanAttributes: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
})

const builder = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    suppressBooleanAttributes: false,
    // OOXML 约定：空元素用自闭合（<w:commentRangeStart/>）而非展开形式
    // (<w:commentRangeStart></w:commentRangeStart>)。两种形式 Word 都能解析，
    // 但自闭合是 Word/LibreOffice 的默认输出，保持一致有利于 round-trip 稳定性。
    suppressEmptyNode: true,
    processEntities: true,
})

export type Node = Record<string, unknown>
export type NodeArray = Node[]

/** 解析 OOXML 字符串为 AST 数组（顶层可能含 ?xml 声明节点，保留） */
export function parseOoxml(xml: string): NodeArray {
    return parser.parse(xml) as NodeArray
}

/** 把 AST 序列化回 XML 字符串（保留原始 XML 声明位置） */
export function stringifyOoxml(ast: NodeArray): string {
    return builder.build(ast) as string
}

/** 取节点的标签名（忽略 `:@` 属性组和 `#text` 键） */
export function tagOf(node: Node): string | null {
    for (const key of Object.keys(node)) {
        if (key === ATTR_GROUP || key === TEXT_KEY) continue
        return key
    }
    return null
}

/** 取节点的子节点数组（tag 对应的 value） */
export function childrenOf(node: Node): NodeArray {
    const t = tagOf(node)
    if (!t) return []
    const v = node[t]
    return Array.isArray(v) ? (v as NodeArray) : []
}

/** 取节点的属性对象（可变引用，直接改会写回 AST） */
export function attrsOf(node: Node): Record<string, string> {
    const existing = node[ATTR_GROUP] as Record<string, string> | undefined
    if (existing) return existing
    const created: Record<string, string> = {}
    node[ATTR_GROUP] = created
    return created
}

/** 读单个属性（attrName 不带 w: 前缀时按字面量；需带 w: 的自己拼） */
export function getAttr(node: Node, name: string): string | undefined {
    const attrs = node[ATTR_GROUP] as Record<string, string> | undefined
    return attrs?.[ATTR_PREFIX + name]
}

/** 写单个属性 */
export function setAttr(node: Node, name: string, value: string): void {
    const attrs = attrsOf(node)
    attrs[ATTR_PREFIX + name] = value
}

/** 构造一个带属性的叶子 XML 节点（空元素） */
export function makeLeaf(tag: string, attrs: Record<string, string>): Node {
    const attrGroup: Record<string, string> = {}
    for (const [k, v] of Object.entries(attrs)) attrGroup[ATTR_PREFIX + k] = v
    return { [tag]: [], [ATTR_GROUP]: attrGroup }
}

/** 构造一个带属性和子节点的元素 */
export function makeElement(tag: string, attrs: Record<string, string>, children: NodeArray): Node {
    const attrGroup: Record<string, string> = {}
    for (const [k, v] of Object.entries(attrs)) attrGroup[ATTR_PREFIX + k] = v
    return { [tag]: children, [ATTR_GROUP]: attrGroup }
}

/** 构造 #text 节点 */
export function makeText(text: string): Node {
    return { [TEXT_KEY]: text }
}

/**
 * 构造 XML 声明节点 `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`。
 * fxp 对 PI 节点（tag 以 `?` 开头）有特殊要求：必须有一个空 #text 子节点。
 */
export function makeXmlDecl(attrs: Record<string, string> = {
    version: '1.0',
    encoding: 'UTF-8',
    standalone: 'yes',
}): Node {
    const attrGroup: Record<string, string> = {}
    for (const [k, v] of Object.entries(attrs)) attrGroup[ATTR_PREFIX + k] = v
    return { '?xml': [{ [TEXT_KEY]: '' }], [ATTR_GROUP]: attrGroup }
}

/**
 * 深度优先遍历 AST。回调返回 false 停止遍历。
 * 不保证遍历顺序稳定，仅保证每个节点访问一次。
 */
export function walk(ast: NodeArray, visit: (node: Node, parent: NodeArray) => boolean | void): void {
    const stack: Array<{ nodes: NodeArray; idx: number }> = [{ nodes: ast, idx: 0 }]
    while (stack.length > 0) {
        const top = stack[stack.length - 1]!
        if (top.idx >= top.nodes.length) { stack.pop(); continue }
        const n = top.nodes[top.idx]!
        top.idx++
        const result = visit(n, top.nodes)
        if (result === false) return
        const kids = childrenOf(n)
        if (kids.length > 0) stack.push({ nodes: kids, idx: 0 })
    }
}

/** 找到第一个匹配 tag 的节点（深度优先） */
export function findFirst(ast: NodeArray, tag: string): Node | null {
    let found: Node | null = null
    walk(ast, (n) => {
        if (tagOf(n) === tag) { found = n; return false }
    })
    return found
}

/** 找到所有匹配 tag 的节点（深度优先） */
export function findAll(ast: NodeArray, tag: string): Node[] {
    const result: Node[] = []
    walk(ast, (n) => { if (tagOf(n) === tag) result.push(n) })
    return result
}

/**
 * 往 ast 的第一个 tag=parentTag 元素末尾追加新子节点（幂等由调用方用 getAttr 自己判断）。
 * 用于往 [Content_Types].xml 的 <Types> / document.xml.rels 的 <Relationships> 追加条目。
 */
export function appendChildToFirst(ast: NodeArray, parentTag: string, child: Node): void {
    const parent = findFirst(ast, parentTag)
    if (!parent) throw new Error(`未找到父节点 <${parentTag}>`)
    const tag = tagOf(parent)
    if (!tag) throw new Error(`父节点 <${parentTag}> 无 tag`)
    const kids = parent[tag] as NodeArray
    kids.push(child)
}

/** 提取文本子节点的 #text 值（浅层，不深入递归到其他叶子） */
export function textOf(node: Node): string {
    const kids = childrenOf(node)
    let s = ''
    for (const k of kids) {
        const t = k[TEXT_KEY]
        if (typeof t === 'string') s += t
    }
    return s
}

/**
 * 从一个 <w:p> AST 节点中收集所有 <w:t> 文本（递归到所有子节点）。
 *
 * 用于 commentInjector / parseWordComments 等模块按段落取文本。
 */
export function paragraphText(paraNode: Node): string {
    let s = ''
    walk([paraNode], (n) => {
        if (tagOf(n) === 'w:t') s += textOf(n)
    })
    return s
}

/**
 * 段落是否含 <w:r>（直接或嵌套在 hyperlink/sdt 等里），即"非空段落"。
 *
 * commentInjector 与 parseWordComments 的非空段落口径必须一致，统一从此处导出。
 */
export function hasRunChild(paraNode: Node): boolean {
    let found = false
    walk([paraNode], (n) => {
        if (tagOf(n) === 'w:r') { found = true; return false }
    })
    return found
}

/**
 * 把纯文本按行拆成段落数组（折 \r\n→\n，trim 每行并丢空行）。
 *
 * 与 parseContractDocx 的段落口径一致：mammoth.extractRawText 的输出按 \r?\n 拆分，
 * trim 后非空行即一个段落。多处旧代码各自实现，此处统一以避免口径漂移。
 */
export function splitParagraphs(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
}

/**
 * XML 5 字符标准转义：& < > " '
 * 同时剥离 XML 1.0 禁止的非法控制字符（否则生成的 docx 无法被 Word 打开）。
 *
 * 允许字符：U+0009 \t / U+000A \n / U+000D \r；
 * 禁止字符：U+0000-U+0008、U+000B-U+000C、U+000E-U+001F、U+FFFE、U+FFFF。
 * 客户姓名从剪贴板粘贴时偶尔混入 U+0008 退格、U+001B ESC 等，必须过滤。
 *
 * 供 textToDocx 写纯文本段落 / 其它模块直接拼字符串 XML 时使用。
 * commentInjector 走 AST 路径，不直接调用本函数。
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]", "g")
export function escapeXml(input: string): string {
    return input
        .replace(ILLEGAL_XML_CHARS, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

/**
 * 仅过滤 XML 1.0 禁用的非法控制字符（不做 entity escape，保留 & < > " '）。
 *
 * 用于 redlineInjector / commentInjector 在通过 fast-xml-parser AST 写入文本时
 * 先清理 LLM / 剪贴板可能混入的退格 / ESC / 响铃等控制字符；entity escape 由
 * fxp builder 自动负责（`processEntities: true`）。
 */
export function stripIllegalXmlChars(input: string): string {
    return input.replace(ILLEGAL_XML_CHARS, '')
}

/**
 * OOXML 共享 w:id 池涉及的标签集合。
 *
 * 来源：ECMA-376 第一部分对 `w:id` 属性的定义——同一份 docx 内多种修订/书签/批注/移动元素
 * 共享一套唯一 ID 池。撞 ID → Word 报"文件已损坏"拒打开（macOS Preview 容忍但 Windows
 * Word 严格）。redlineInjector 与 commentInjector 必须协调使用 findMaxSharedId 获取起始 ID。
 */
const ID_BEARING_TAGS = new Set([
    'w:bookmarkStart', 'w:bookmarkEnd',
    'w:ins', 'w:del', 'w:rPrChange', 'w:pPrChange',
    'w:sectPrChange', 'w:tblPrChange', 'w:tcPrChange', 'w:trPrChange',
    'w:cellIns', 'w:cellDel', 'w:cellMerge', 'w:numberingChange',
    'w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference',
    'w:moveFromRangeStart', 'w:moveToRangeStart',
    'w:moveFromRangeEnd', 'w:moveToRangeEnd',
])

/**
 * 扫描 OOXML AST 的所有 w:id 共享池标签，返回最大 w:id。
 *
 * @param rootAst 已 parseOoxml 的 document.xml AST
 * @returns 最大 w:id；不存在时返回 -1（调用方 +1 起 0）
 */
export function findMaxSharedId(rootAst: NodeArray): number {
    let max = -1
    walk(rootAst, (node) => {
        const tag = tagOf(node)
        if (!tag || !ID_BEARING_TAGS.has(tag)) return
        const idStr = getAttr(node, 'w:id')
        if (!idStr) return
        const id = parseInt(idStr, 10)
        if (Number.isFinite(id) && id > max) max = id
    })
    return max
}
