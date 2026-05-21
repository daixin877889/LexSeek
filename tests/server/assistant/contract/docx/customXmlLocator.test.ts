import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import {
    locateLexseekCustomXml,
    ANNOTATION_REFS_NS, ANNOTATION_REFS_ROOT,
    REDLINE_REFS_NS, REDLINE_REFS_ROOT,
} from '~~/server/agents/contract/docx/customXmlLocator'

describe('locateLexseekCustomXml', () => {
    it('原始路径的 annotationRefs → 命中，atOriginalPath=true', async () => {
        const zip = new JSZip()
        zip.file('word/customXml/annotationRefs.xml',
            `<lexseekAnnotationRefs xmlns="${ANNOTATION_REFS_NS}"><ref wId="0"/></lexseekAnnotationRefs>`)
        const r = await locateLexseekCustomXml(zip, ANNOTATION_REFS_NS, ANNOTATION_REFS_ROOT, 'word/customXml/annotationRefs.xml')
        expect(r).not.toBeNull()
        expect(r!.path).toBe('word/customXml/annotationRefs.xml')
        expect(r!.atOriginalPath).toBe(true)
    })

    it('被 Word 改名移到包根的 redlineRefs → 命中，atOriginalPath=false', async () => {
        const zip = new JSZip()
        zip.file('customXml/item1.xml',
            `<lexseekRedlineRefs xmlns="${REDLINE_REFS_NS}"><ref riskId="1"/></lexseekRedlineRefs>`)
        const r = await locateLexseekCustomXml(zip, REDLINE_REFS_NS, REDLINE_REFS_ROOT, 'word/customXml/redlineRefs.xml')
        expect(r).not.toBeNull()
        expect(r!.path).toBe('customXml/item1.xml')
        expect(r!.atOriginalPath).toBe(false)
    })

    it('docx 内无 LexSeek customXml → 返回 null', async () => {
        const zip = new JSZip()
        zip.file('customXml/item1.xml', `<foo xmlns="urn:other"/>`)
        const r = await locateLexseekCustomXml(zip, ANNOTATION_REFS_NS, ANNOTATION_REFS_ROOT, 'word/customXml/annotationRefs.xml')
        expect(r).toBeNull()
    })

    it('itemProps 的 schemaRef 含同一 URI → 不被误识别，正确返回真正的身份证 part', async () => {
        // Word 重存后的真实结构：itemProps{N}.xml 的 <ds:schemaRef ds:uri> 带 part 的
        // 命名空间 URI，且遍历顺序可能排在 item 之前。定位器须靠根元素本地名排除。
        const zip = new JSZip()
        zip.file('customXml/itemProps2.xml',
            `<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{GUID}">`
            + `<ds:schemaRefs><ds:schemaRef ds:uri="${ANNOTATION_REFS_NS}"/></ds:schemaRefs></ds:datastoreItem>`)
        zip.file('customXml/item2.xml',
            `<lexseekAnnotationRefs xmlns="${ANNOTATION_REFS_NS}"><ref wId="0" annotationId="9" reviewId="3"/></lexseekAnnotationRefs>`)
        const r = await locateLexseekCustomXml(zip, ANNOTATION_REFS_NS, ANNOTATION_REFS_ROOT, 'word/customXml/annotationRefs.xml')
        expect(r).not.toBeNull()
        expect(r!.path).toBe('customXml/item2.xml')
    })

    it('根元素带命名空间前缀 → 剥前缀后仍能识别', async () => {
        const zip = new JSZip()
        zip.file('customXml/item1.xml',
            `<ns0:lexseekRedlineRefs xmlns:ns0="${REDLINE_REFS_NS}"><ns0:ref riskId="1"/></ns0:lexseekRedlineRefs>`)
        const r = await locateLexseekCustomXml(zip, REDLINE_REFS_NS, REDLINE_REFS_ROOT, 'word/customXml/redlineRefs.xml')
        expect(r).not.toBeNull()
        expect(r!.path).toBe('customXml/item1.xml')
    })
})
