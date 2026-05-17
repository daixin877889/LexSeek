/**
 * customXml part 通用注册器。
 *
 * 把一个 customXml part 幂等注册到 [Content_Types].xml（Override）+
 * word/_rels/document.xml.rels（Relationship）。供 redlineInjector 注册
 * redlineRefs.xml；commentInjector 的 annotationRefs 注册沿用其自有实现。
 */
import { parseOoxml, stringifyOoxml, findFirst, findAll, getAttr, makeLeaf, tagOf, type NodeArray } from './xmlAst'
import { readTextFromZip, writeTextToZip, type DocxZip } from './zipRewriter'

const CUSTOMXML_CONTENT_TYPE = 'application/xml'
const REL_CUSTOMXML = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml'

export interface CustomXmlPart {
    /** zip 内路径，如 'word/customXml/redlineRefs.xml' */
    partPath: string
    /** document.xml.rels 里的 Relationship Id（需全文件唯一），如 'rIdLexseekRedlineRefs' */
    relId: string
}

/**
 * 幂等注册一个 customXml part。
 * 已存在同名 Override / 同 Target 的 Relationship 时跳过，不重复追加。
 */
export async function registerCustomXmlPart(zip: DocxZip, part: CustomXmlPart): Promise<void> {
    const partName = '/' + part.partPath
    const relTarget = part.partPath.replace(/^word\//, '')

    // [Content_Types].xml — 追加 Override
    const ctAst = parseOoxml(await readTextFromZip(zip, '[Content_Types].xml'))
    const types = findFirst(ctAst, 'Types')
    if (types) {
        const exists = findAll(ctAst, 'Override').some(n => getAttr(n, 'PartName') === partName)
        if (!exists) {
            const typesKids = types['Types'] as NodeArray
            typesKids.push(makeLeaf('Override', { PartName: partName, ContentType: CUSTOMXML_CONTENT_TYPE }))
            writeTextToZip(zip, '[Content_Types].xml', stringifyOoxml(ctAst))
        }
    }

    // word/_rels/document.xml.rels — 追加 Relationship
    const relsAst = parseOoxml(await readTextFromZip(zip, 'word/_rels/document.xml.rels'))
    const rels = findFirst(relsAst, 'Relationships')
    if (rels) {
        const exists = findAll(relsAst, 'Relationship').some(n => getAttr(n, 'Target') === relTarget)
        if (!exists) {
            const relsKids = rels['Relationships'] as NodeArray
            relsKids.push(makeLeaf('Relationship', { Id: part.relId, Type: REL_CUSTOMXML, Target: relTarget }))
            writeTextToZip(zip, 'word/_rels/document.xml.rels', stringifyOoxml(relsAst))
        }
    }
}

/**
 * 移除一个 customXml part：删 part 文件本身（及其可能存在的 part 级 _rels）
 * + 撤销 [Content_Types].xml 的 Override + 撤销 document.xml.rels 的 Relationship。
 *
 * registerCustomXmlPart 的逆操作。part 不存在时静默无操作（幂等）。
 */
export async function removeCustomXmlPart(zip: DocxZip, part: { partPath: string }): Promise<void> {
    const partName = '/' + part.partPath
    const relTarget = part.partPath.replace(/^word\//, '')

    // 删 part 文件本身 + 其可能存在的 part 级 _rels（如 word/customXml/_rels/xxx.xml.rels）
    zip.remove(part.partPath)
    const slash = part.partPath.lastIndexOf('/')
    if (slash >= 0) {
        zip.remove(`${part.partPath.slice(0, slash)}/_rels/${part.partPath.slice(slash + 1)}.rels`)
    }

    // [Content_Types].xml — 移除 Override
    const ctAst = parseOoxml(await readTextFromZip(zip, '[Content_Types].xml'))
    const types = findFirst(ctAst, 'Types')
    if (types) {
        const typesKids = types['Types'] as NodeArray
        const before = typesKids.length
        for (let i = typesKids.length - 1; i >= 0; i--) {
            const n = typesKids[i]!
            if (tagOf(n) === 'Override' && getAttr(n, 'PartName') === partName) typesKids.splice(i, 1)
        }
        if (typesKids.length !== before) writeTextToZip(zip, '[Content_Types].xml', stringifyOoxml(ctAst))
    }

    // word/_rels/document.xml.rels — 移除 Relationship
    const relsAst = parseOoxml(await readTextFromZip(zip, 'word/_rels/document.xml.rels'))
    const rels = findFirst(relsAst, 'Relationships')
    if (rels) {
        const relsKids = rels['Relationships'] as NodeArray
        const before = relsKids.length
        for (let i = relsKids.length - 1; i >= 0; i--) {
            const n = relsKids[i]!
            if (tagOf(n) === 'Relationship' && getAttr(n, 'Target') === relTarget) relsKids.splice(i, 1)
        }
        if (relsKids.length !== before) writeTextToZip(zip, 'word/_rels/document.xml.rels', stringifyOoxml(relsAst))
    }
}
