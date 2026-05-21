/**
 * 修订标记回传解析与处置判定（spec §6）。
 *
 * - parseRedlineMarks：从回传 docx 读 redlineRefs.xml + 存活 ins/del id + 按非空段落的正文语料。
 * - resolveCorpusForRef：按 redlineRefs 的 paraIdxs 取该风险所属段落的语料。
 * - classifyRedlineDecision：双层算法判定单条修订被客户接受/拒绝/未处理/需确认。
 */
import { normalizeForMatch } from '../utils/textSimilarity'
import { ClientRedlineDecision } from '#shared/types/contract'
import { loadDocxZip } from './zipRewriter'
import {
    parseOoxml,
    findFirst,
    findAll,
    getAttr,
    textOf,
    walk,
    tagOf,
    collectNonEmptyParagraphs,
} from './xmlAst'
import { locateLexseekCustomXml, REDLINE_REFS_NS, REDLINE_REFS_ROOT } from './customXmlLocator'

/** redlineRefs.xml 里一条 <ref> 的解析结果 */
export interface RedlineRefEntry {
    riskId: number
    delIds: number[]
    insId: number
    /** 该修订所跨非空段落序号（回传识别据此把比对限定在风险所属段落，spec §6.2） */
    paraIdxs: number[]
}

export interface ClassifyRedlineInput {
    ref: RedlineRefEntry
    /** 回传 docx 仍存活的 <w:ins> w:id */
    survivingInsIds: Set<number>
    /** 回传 docx 仍存活的 <w:del> w:id */
    survivingDelIds: Set<number>
    /** 该风险所属段落的 <w:t> 语料，已 normalizeForMatch 归一化（见 resolveCorpusForRef） */
    corpusT: string
    /** 该风险所属段落的 <w:delText> 语料，已 normalizeForMatch 归一化 */
    corpusDel: string
    /** 该风险所属段落的 <w:ins> 标记内语料，已归一化（区分「未处理」与「插入已接受」） */
    corpusIns: string
    /** 风险 DB 字段（原始值，函数内部归一化） */
    problematicQuote: string
    suggestedClauseText: string
    /** docx 内 w:id 是否可信（见 ParsedRedlineMarks.trustWordIds）；false 时跳过精确层 */
    trustWordIds: boolean
}

/** 单个非空段落的归一化语料 */
export interface RedlineParagraph {
    /** 该段 <w:t> 文本（含 <w:ins> 内文本），已 normalizeForMatch 归一化 */
    tNorm: string
    /** 该段 <w:delText> 文本，已 normalizeForMatch 归一化 */
    delNorm: string
    /** 该段 <w:ins> 标记内文本，已归一化。插入被接受（标记解包）后此处不再含该文本 */
    insNorm: string
}

export interface ParsedRedlineMarks {
    /** redlineRefs.xml 根元素 reviewId；文件不存在为 null */
    reviewId: number | null
    refs: RedlineRefEntry[]
    survivingInsIds: Set<number>
    survivingDelIds: Set<number>
    /** 按非空段落（collectNonEmptyParagraphs 口径）的归一化语料 */
    paragraphs: RedlineParagraph[]
    /**
     * docx 内 w:id 是否可信。身份证文件在原始路径 = docx 未被 Word 等工具规范化
     * 重写过 = w:id 未被重排 = 可信；否则不可信，修订判定须跳过精确层。
     */
    trustWordIds: boolean
}

/**
 * 解析回传 docx 的修订信息（spec §6.1）。
 * redlineRefs.xml 不存在 / 损坏、或 docxBuffer 非合法 docx → 返回空结果
 * （reviewId=null、refs=[]），不抛错；上层靠批注链路 + 安全保护兜底。
 */
export async function parseRedlineMarks(docxBuffer: Buffer): Promise<ParsedRedlineMarks> {
    let zip: Awaited<ReturnType<typeof loadDocxZip>>
    try {
        zip = await loadDocxZip(docxBuffer)
    } catch {
        // docxBuffer 不是合法 docx zip：修订标记是回传识别的增强项而非核心，解析失败
        // 降级为空结果，由上层批注链路 + 安全保护兜底，不中止回传。
        return { reviewId: null, refs: [], survivingInsIds: new Set(), survivingDelIds: new Set(), paragraphs: [], trustWordIds: true }
    }

    let reviewId: number | null = null
    const refs: RedlineRefEntry[] = []
    // 身份证文件按命名空间定位（兼容 Word 把 customXml 改名移位）
    const located = await locateLexseekCustomXml(zip, REDLINE_REFS_NS, REDLINE_REFS_ROOT, 'word/customXml/redlineRefs.xml')
    // 文件不在原始路径 → docx 被 Word 等规范化重写过 → docx 内 w:id 不可信
    const trustWordIds = located ? located.atOriginalPath : true
    if (located) {
        try {
            const ast = parseOoxml(located.xml)
            const root = findFirst(ast, 'lexseekRedlineRefs')
            if (root) {
                const rid = parseInt(getAttr(root, 'reviewId') ?? '', 10)
                reviewId = Number.isFinite(rid) ? rid : null
            }
            for (const node of findAll(ast, 'ref')) {
                const riskId = parseInt(getAttr(node, 'riskId') ?? '', 10)
                const insId = parseInt(getAttr(node, 'insId') ?? '', 10)
                const parseIds = (attr: string) => (getAttr(node, attr) ?? '')
                    .split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n))
                const delIds = parseIds('delIds')
                const paraIdxs = parseIds('paraIdxs')
                if (Number.isFinite(riskId) && Number.isFinite(insId) && delIds.length > 0) {
                    refs.push({ riskId, delIds, insId, paraIdxs })
                }
            }
        } catch { /* 文件损坏 → 空 refs */ }
    }

    const survivingInsIds = new Set<number>()
    const survivingDelIds = new Set<number>()
    const paragraphs: RedlineParagraph[] = []
    const docFile = zip.file('word/document.xml')
    if (docFile) {
        const ast = parseOoxml(await docFile.async('string'))
        for (const n of findAll(ast, 'w:ins')) {
            const id = parseInt(getAttr(n, 'w:id') ?? '', 10)
            if (Number.isFinite(id)) survivingInsIds.add(id)
        }
        for (const n of findAll(ast, 'w:del')) {
            const id = parseInt(getAttr(n, 'w:id') ?? '', 10)
            if (Number.isFinite(id)) survivingDelIds.add(id)
        }
        // 按非空段落收集 <w:t> / <w:delText> / <w:ins> 内文本语料
        for (const para of collectNonEmptyParagraphs(ast)) {
            let rawT = ''
            let rawDel = ''
            let rawIns = ''
            walk([para], (n) => {
                const tag = tagOf(n)
                if (tag === 'w:t') rawT += textOf(n)
                else if (tag === 'w:delText') rawDel += textOf(n)
            })
            // 单独收集 <w:ins> 标记内文本：插入标记是否存活是「未处理 vs 已接受」的关键信号
            for (const insNode of findAll([para], 'w:ins')) {
                walk([insNode], (n) => {
                    if (tagOf(n) === 'w:t') rawIns += textOf(n)
                })
            }
            paragraphs.push({
                tNorm: normalizeForMatch(rawT),
                delNorm: normalizeForMatch(rawDel),
                insNorm: normalizeForMatch(rawIns),
            })
        }
    }

    return { reviewId, refs, survivingInsIds, survivingDelIds, paragraphs, trustWordIds }
}

/**
 * 取某条修订身份证对应的比对语料（spec §6.2）：限定在 paraIdxs 记录的段落；
 * paraIdxs 越界（客户结构性增删段落致序号漂移）时回退全文语料。
 */
export function resolveCorpusForRef(
    parsed: ParsedRedlineMarks,
    ref: RedlineRefEntry,
): { corpusT: string; corpusDel: string; corpusIns: string } {
    const valid = ref.paraIdxs.filter(i => i >= 0 && i < parsed.paragraphs.length)
    const picked = valid.length > 0
        ? valid.map(i => parsed.paragraphs[i]!)
        : parsed.paragraphs // 段落序号越界 → 回退全文语料
    return {
        corpusT: picked.map(p => p.tNorm).join(' '),
        corpusDel: picked.map(p => p.delNorm).join(' '),
        corpusIns: picked.map(p => p.insNorm).join(' '),
    }
}

/**
 * 双层判定（spec §6.2）。
 * Layer 1（w:id）：全部存活→未处理；部分存活→需确认；全不存活→转 Layer 2。
 * Layer 2（正文）：按删除标记 / 插入标记的存活组合判定，兼容「客户只接受插入、删除
 *   标记残留」的半接受状态（spec §13.6）。
 */
export function classifyRedlineDecision(input: ClassifyRedlineInput): ClientRedlineDecision {
    const { ref, survivingInsIds, survivingDelIds, corpusT, corpusDel, corpusIns, trustWordIds } = input
    const oldText = normalizeForMatch(input.problematicQuote)
    const newText = normalizeForMatch(input.suggestedClauseText)
    // 防御：redlineRefs 风险理论上 old/new 必非空且不等
    if (!oldText || !newText || oldText === newText) return ClientRedlineDecision.AMBIGUOUS

    // ===== Layer 1：w:id 精确层（仅在 w:id 可信时启用）=====
    // docx 经 Word 等工具规范化重写后，w:id 被重排、新旧编号空间重叠，拿旧 id 去查
    // 会碰巧命中不相干修订 → 随机误判。trustWordIds=false 时必须跳过（spec §6）。
    if (trustWordIds) {
        const delAllAlive = ref.delIds.length > 0 && ref.delIds.every(id => survivingDelIds.has(id))
        const delNoneAlive = ref.delIds.every(id => !survivingDelIds.has(id))
        const insAlive = survivingInsIds.has(ref.insId)
        if (delAllAlive && insAlive) return ClientRedlineDecision.UNTOUCHED
        // L6：除「del 全不存活 + ins 不存活」外的所有组合（含「del 全存活 + ins 不存活」
        // 这种半接受形态）在 w:id 可信时一律落 AMBIGUOUS，不下沉 Layer 2 的半接受识别。
        // 这是有意的保守落点：AMBIGUOUS 不丢数据，且该形态在 trustWordIds=true 下极罕见
        // ——Word 接受修订通常触发规范化 → trustWordIds 翻 false → 半接受改由 Layer 2 识别。
        if (!(delNoneAlive && !insAlive)) return ClientRedlineDecision.AMBIGUOUS // 部分存活
    }

    // ===== Layer 2：正文比对层 =====
    // 删除标记（<w:del>）与插入标记（<w:ins>）的存活组合是判定核心。Word 接受一条修订
    // 需「删旧 + 插新」两个动作都生效；客户常只接受「插新」、留下「删旧」标记，形成
    // 「半接受」状态——此时不能因删除标记残留就判未处理（spec §13.6）。
    const delMarkAlive = corpusDel.includes(oldText)   // 旧文仍带 <w:del> 删除标记
    const insMarkAlive = corpusIns.includes(newText)   // 新文仍带 <w:ins> 插入标记
    const newInT = corpusT.includes(newText)           // 新文在正文（标记内或已转正）
    const oldInT = corpusT.includes(oldText)           // 旧文在普通正文（删除标记被拒绝恢复）

    // 删除标记 + 插入标记都在 → 客户完全没动
    if (delMarkAlive && insMarkAlive) return ClientRedlineDecision.UNTOUCHED

    // 删除标记残留、插入标记已消（客户接受新条款的「半接受」）：
    // 新文已转正 → 视为客户接受；新文也不在（插入被拒绝）→ 状态矛盾，交律师确认
    if (delMarkAlive && !insMarkAlive) {
        return newInT ? ClientRedlineDecision.ACCEPTED : ClientRedlineDecision.AMBIGUOUS
    }

    // 删除标记已消 → 修订已被处理，按正文最终内容判定
    if (newText.includes(oldText)) {
        // new 含 old（扩写）
        if (newInT) return ClientRedlineDecision.ACCEPTED
        if (oldInT) return ClientRedlineDecision.REJECTED
        return ClientRedlineDecision.AMBIGUOUS
    }
    if (oldText.includes(newText)) {
        // old 含 new（删减）
        if (oldInT) return ClientRedlineDecision.REJECTED
        if (newInT) return ClientRedlineDecision.ACCEPTED
        return ClientRedlineDecision.AMBIGUOUS
    }
    // 互不包含（实质重写）
    if (newInT && !oldInT) return ClientRedlineDecision.ACCEPTED
    if (oldInT && !newInT) return ClientRedlineDecision.REJECTED
    return ClientRedlineDecision.AMBIGUOUS
}

/**
 * 取全文语料（所有非空段落拼接），用于 paraIdxs 段落定位失准时的兜底重判（spec §6）。
 */
export function resolveFullCorpus(parsed: ParsedRedlineMarks): { corpusT: string; corpusDel: string; corpusIns: string } {
    return {
        corpusT: parsed.paragraphs.map(p => p.tNorm).join(' '),
        corpusDel: parsed.paragraphs.map(p => p.delNorm).join(' '),
        corpusIns: parsed.paragraphs.map(p => p.insNorm).join(' '),
    }
}

