import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { registerCustomXmlPart } from '~~/server/agents/contract/docx/customXmlRegistrar'
import { readTextFromZip } from '~~/server/agents/contract/docx/zipRewriter'

function minimalZip(): JSZip {
    const zip = new JSZip()
    zip.file('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="xml" ContentType="application/xml"/></Types>')
    zip.file('word/_rels/document.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
    return zip
}

const PART = { partPath: 'word/customXml/redlineRefs.xml', relId: 'rIdLexseekRedlineRefs' }

describe('registerCustomXmlPart', () => {
    it('注册 Override 与 Relationship', async () => {
        const zip = minimalZip()
        await registerCustomXmlPart(zip, PART)
        const ct = await readTextFromZip(zip, '[Content_Types].xml')
        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(ct).toContain('PartName="/word/customXml/redlineRefs.xml"')
        expect(rels).toContain('Target="customXml/redlineRefs.xml"')
        expect(rels).toContain('Id="rIdLexseekRedlineRefs"')
    })

    it('幂等：重复注册不产生重复条目', async () => {
        const zip = minimalZip()
        await registerCustomXmlPart(zip, PART)
        await registerCustomXmlPart(zip, PART)
        const ct = await readTextFromZip(zip, '[Content_Types].xml')
        const rels = await readTextFromZip(zip, 'word/_rels/document.xml.rels')
        expect(ct.match(/PartName="\/word\/customXml\/redlineRefs\.xml"/g)).toHaveLength(1)
        expect(rels.match(/Id="rIdLexseekRedlineRefs"/g)).toHaveLength(1)
    })
})
