/**
 * customXml part 通用注册器。
 *
 * 把一个 customXml part 幂等注册到 [Content_Types].xml（Override）+
 * word/_rels/document.xml.rels（Relationship）。供 redlineInjector 注册
 * redlineRefs.xml；commentInjector 的 annotationRefs 注册沿用其自有实现。
 */
import { parseOoxml, stringifyOoxml, findFirst, findAll, getAttr, makeLeaf, type NodeArray } from './xmlAst'
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
