import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
    locateLexseekCustomXml,
    ANNOTATION_REFS_NS,
    REDLINE_REFS_NS,
} from '~~/server/agents/contract/docx/customXmlLocator'

describe('locateLexseekCustomXml', () => {
    it('原始路径的 annotationRefs → 命中，atOriginalPath=true', async () => {
        const zip = new JSZip()
        zip.file('word/customXml/annotationRefs.xml',
            `<lexseekAnnotationRefs xmlns="${ANNOTATION_REFS_NS}"><ref wId="0"/></lexseekAnnotationRefs>`)
        const r = await locateLexseekCustomXml(zip, ANNOTATION_REFS_NS, 'word/customXml/annotationRefs.xml')
        expect(r).not.toBeNull()
        expect(r!.path).toBe('word/customXml/annotationRefs.xml')
        expect(r!.atOriginalPath).toBe(true)
        expect(r!.xml).toContain('lexseekAnnotationRefs')
    })

    it('被 Word 改名移到包根的 redlineRefs → 命中，atOriginalPath=false', async () => {
        const zip = new JSZip()
        zip.file('customXml/item1.xml',
            `<lexseekRedlineRefs xmlns="${REDLINE_REFS_NS}"><ref riskId="1"/></lexseekRedlineRefs>`)
        zip.file('customXml/itemProps1.xml',
            `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>`)
        const r = await locateLexseekCustomXml(zip, REDLINE_REFS_NS, 'word/customXml/redlineRefs.xml')
        expect(r).not.toBeNull()
        expect(r!.path).toBe('customXml/item1.xml')
        expect(r!.atOriginalPath).toBe(false)
    })

    it('docx 内无 LexSeek customXml → 返回 null', async () => {
        const zip = new JSZip()
        zip.file('customXml/item1.xml', `<foo xmlns="urn:other"/>`)
        const r = await locateLexseekCustomXml(zip, ANNOTATION_REFS_NS, 'word/customXml/annotationRefs.xml')
        expect(r).toBeNull()
    })

    it('Word 的 itemProps（customXml properties）不被误识别', async () => {
        const zip = new JSZip()
        zip.file('customXml/itemProps1.xml',
            `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{GUID}"/>`)
        const r = await locateLexseekCustomXml(zip, REDLINE_REFS_NS, 'word/customXml/redlineRefs.xml')
        expect(r).toBeNull()
    })
})
