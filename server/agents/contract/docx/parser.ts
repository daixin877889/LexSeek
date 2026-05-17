/**
 * 合同 .docx 段落提取。
 *
 * 返回：
 * - paragraphs：非空段落文本数组，索引即 spec §10.4 定义的 clauseIndex
 * - rawXml：word/document.xml 原文，供 commentInjector 按顺序定位 <w:p>
 *
 * DOCX-H4 修复：mammoth.extractRawText 不展开 w:tbl 单元格内的段落，含表格的合同
 * 表格内容会丢段。补 fallback：rawText 段落数 / rawXml 内 w:p 节点总数 < 60% 时
 * 视为 mammoth 漏段，改用 AST 直读 body 内全部 w:p（含 w:tbl 内嵌套）。
 */
import mammoth from 'mammoth'
import { loadDocxZip, readTextFromZip, type DocxZip } from './zipRewriter'
import { parseOoxml, findFirst, walk, childrenOf, tagOf, paragraphText, paragraphRejectText, hasRunChild, splitParagraphs, type Node } from './xmlAst'
import { buildNumberingPrefixMap, type NumberingPrefixMap } from './numbering'

export interface ParsedContract {
    /** 分析口径段落：递归收集所有非空 <w:p>（含 <w:tbl> 内嵌套），用于条款切分与 AI 审查。 */
    paragraphs: string[]
    rawXml: string
    /**
     * M8：批注注入口径段落——collectNonEmptyParagraphs 口径（w:body 直接子 <w:p>
     * 且 hasRunChild，含空文本段）。commentInjector / parseWordComments 的
     * anchorParagraphIndex 即此数组下标。
     */
    bodyParagraphs: string[]
    /**
     * M8：paragraphs[i]（分析口径）→ bodyParagraphs 下标的映射。
     * 段落在表格等容器内、不属 body 直接子时为 null——这类条款的批注无法注入 docx
     * （与 global_review 风险同口径，rebuildDocx 注入时按 null 过滤）。
     */
    bodyParagraphIndex: (number | null)[]
}

/**
 * 修订视图：
 * - 'accept'（默认）：接受所有修订后的定稿态文本（取 <w:ins>、丢 <w:del>），与历史行为一致。
 * - 'reject'：拒绝所有修订后的原文态文本（取 <w:del>、丢 <w:ins>），S5 回退识别用——
 *   修订稿里原问题片段随 <w:del> 被丢，定稿态对不上首轮审查锚点。
 */
export type RevisionView = 'accept' | 'reject'

export interface ParseContractDocxOptions {
    revisionView?: RevisionView
}

const TABLE_FALLBACK_RATIO = 0.6

interface AstParagraphsMeta {
    /** 分析口径段落（递归含表格内 <w:p>），与历史 paragraphsFromAst 输出一致 */
    paragraphs: string[]
    /** 批注注入口径段落（collectNonEmptyParagraphs 口径，含空文本段） */
    bodyParagraphs: string[]
    /** paragraphs[i] → bodyParagraphs 下标；表格等容器内段落为 null */
    bodyParagraphIndex: (number | null)[]
}

/**
 * 直接 AST 解析 word/document.xml 的 w:body，同时产出两种段落口径 + 下标映射。
 *
 * - paragraphs：递归收集所有非空 <w:p>（含 w:tbl 内嵌套），供条款切分 / AI 审查。
 * - bodyParagraphs：仅 w:body 直接子 <w:p>（复刻 collectNonEmptyParagraphs 判定：
 *   直接子 <w:p> + hasRunChild，不额外过滤空文本），供 commentInjector 注入批注。
 * - bodyParagraphIndex：paragraphs[i] → bodyParagraphs 下标，表格内段落为 null。
 */
function paragraphsFromAstWithMeta(rawXml: string, view: RevisionView = 'accept'): AstParagraphsMeta {
    try {
        const ast = parseOoxml(rawXml)
        const body = findFirst(ast, 'w:body')
        if (!body) return { paragraphs: [], bodyParagraphs: [], bodyParagraphIndex: [] }
        const paragraphs: string[] = []
        const bodyParagraphs: string[] = []
        const bodyParagraphIndex: (number | null)[] = []
        const extract = (n: Node): string =>
            (view === 'reject' ? paragraphRejectText(n) : paragraphText(n)).trim()
        for (const kid of childrenOf(body)) {
            if (tagOf(kid) === 'w:p') {
                // body 直接子 <w:p>：是否进 collectNonEmptyParagraphs 仅看 hasRunChild
                if (!hasRunChild(kid)) continue
                const cneIdx = bodyParagraphs.length
                const text = extract(kid)
                bodyParagraphs.push(text)
                // 分析口径额外丢弃空文本段（与历史 paragraphsFromAst 一致）
                if (text.length > 0) {
                    paragraphs.push(text)
                    bodyParagraphIndex.push(cneIdx)
                }
            }
            else {
                // 表格 / sdt 等容器：递归收集内嵌 <w:p>——属分析口径，不属批注注入口径
                walk([kid], (n) => {
                    if (tagOf(n) !== 'w:p') return
                    if (!hasRunChild(n)) return
                    const text = extract(n)
                    if (text.length > 0) {
                        paragraphs.push(text)
                        bodyParagraphIndex.push(null)
                    }
                })
            }
        }
        return { paragraphs, bodyParagraphs, bodyParagraphIndex }
    } catch {
        return { paragraphs: [], bodyParagraphs: [], bodyParagraphIndex: [] }
    }
}

async function readNumberingXmlOrNull(zip: DocxZip): Promise<string | null> {
    const file = zip.file('word/numbering.xml')
    if (!file) return null
    return file.async('string')
}

function applyPrefixMap(paragraphs: string[], prefixMap: NumberingPrefixMap): string[] {
    return paragraphs.map((p, i) => {
        const prefix = prefixMap.get(i)
        return prefix ? prefix + p : p
    })
}

export async function parseContractDocx(buffer: Buffer, options?: ParseContractDocxOptions): Promise<ParsedContract> {
    const revisionView: RevisionView = options?.revisionView ?? 'accept'
    const zip = await loadDocxZip(buffer)
    const rawXml = await readTextFromZip(zip, 'word/document.xml')
    const numberingXml = await readNumberingXmlOrNull(zip)

    // prefixMap 与 paragraphsFromAstWithMeta 同口径（深度优先遍历 <w:p>，含表格内段落）
    const prefixMap = buildNumberingPrefixMap(rawXml, numberingXml)

    // bodyParagraphs / bodyParagraphIndex 始终取自 AST —— 批注注入口径的单一权威源。
    const astMeta = paragraphsFromAstWithMeta(rawXml, revisionView)

    let paragraphs: string[]
    let bodyParagraphs = astMeta.bodyParagraphs
    let bodyParagraphIndex = astMeta.bodyParagraphIndex

    // 以下两种情形必须走 AST（而非 mammoth 快速路径）：
    //  - reject 视图：mammoth 只能产出「接受修订」的定稿态，拒绝视图取不到。
    //  - 含 numbering：段落索引须与 prefixMap 同源，给 mammoth 段落拼前缀会错位（含表格场景）。
    // redlineInjector 的 ins/del 是段内替换、不增删段落，故两情形都套用同一份 prefixMap。
    if (revisionView === 'reject' || prefixMap.size > 0) {
        paragraphs = applyPrefixMap(astMeta.paragraphs, prefixMap)
    }
    else {
        // 无 numbering（普通粘贴 docx）：mammoth 快速路径 + DOCX-H4 兜底
        const { value: rawText } = await mammoth.extractRawText({ buffer })
        const mammothParagraphs = splitParagraphs(rawText)
        if (
            astMeta.paragraphs.length > mammothParagraphs.length
            && (astMeta.paragraphs.length === 0
                || mammothParagraphs.length / astMeta.paragraphs.length < TABLE_FALLBACK_RATIO)
        ) {
            // DOCX-H4：mammoth.extractRawText 跳过 <w:tbl> 单元格段落，漏段比例过高 → 改走 AST
            paragraphs = astMeta.paragraphs
        }
        else {
            // 纯 mammoth 路径（无明显表格漏段）：mammoth 段落全为 body 直接段落，
            // 分析口径 == 批注注入口径，bodyParagraphIndex 为 identity。
            paragraphs = mammothParagraphs
            bodyParagraphs = mammothParagraphs
            bodyParagraphIndex = mammothParagraphs.map((_, i) => i)
        }
    }

    return { paragraphs, rawXml, bodyParagraphs, bodyParagraphIndex }
}
