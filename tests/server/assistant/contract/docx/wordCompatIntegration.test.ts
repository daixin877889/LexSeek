/**
 * Word 兼容性回归测试：用真实「被 Word 重存过的回传 docx」验证回传解析端
 * 能定位被改名的 customXml 身份证、解析批注、并正确标记 w:id 不可信。
 *
 * 防回归目标：杜绝再次写死 word/customXml/xxx.xml 固定路径。
 *
 * 注：parseWordComments 返回的 annotationRefsByWId 以 docx 内 w:id 为 key，Word
 * 重存会重排 w:id 使其失效 —— 这是预期的，回传链路改用内容匹配（commentContentMatch
 * + uploadClientVersion），不依赖该映射；customXmlRefEntries 不经 wId 过滤，始终可用。
 */
import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseWordComments } from '~~/server/agents/contract/docx/wordCommentParser'
import { parseRedlineMarks } from '~~/server/agents/contract/docx/redlineParser'
import { loadDocxZip } from '~~/server/agents/contract/docx/zipRewriter'
import {
    locateLexseekCustomXml,
    ANNOTATION_REFS_NS, ANNOTATION_REFS_ROOT,
} from '~~/server/agents/contract/docx/customXmlLocator'

const FIXTURE = join(__dirname, 'fixtures/word-resaved-review3.docx')

describe('Word 兼容性 · 真实重存 docx', () => {
    it('parseWordComments 解析出全部 5 条批注（含 content，内容匹配的原料）', async () => {
        const buf = await readFile(FIXTURE)
        const { comments, customXmlRefEntries } = await parseWordComments(buf)
        expect(comments.length).toBe(5)
        expect(comments.every(c => c.content.length > 0)).toBe(true)
        // customXml 身份证文件被 Word 改名，定位器仍能找到 → 5 条 ref，reviewId 有效
        expect(customXmlRefEntries.length).toBe(5)
        expect(customXmlRefEntries[0]!.reviewId).toBe(3)
    })

    it('locateLexseekCustomXml 能定位被 Word 改名的批注身份证', async () => {
        const buf = await readFile(FIXTURE)
        const zip = await loadDocxZip(buf)
        const located = await locateLexseekCustomXml(
            zip, ANNOTATION_REFS_NS, ANNOTATION_REFS_ROOT, 'word/customXml/annotationRefs.xml',
        )
        expect(located).not.toBeNull()
        // 文件被 Word 移出原始路径（改名为 customXml/item*.xml）
        expect(located!.atOriginalPath).toBe(false)
        expect(located!.xml).toContain('lexseekAnnotationRefs')
    })

    it('parseRedlineMarks 能定位被改名的修订身份证，且标记 w:id 不可信', async () => {
        const buf = await readFile(FIXTURE)
        const parsed = await parseRedlineMarks(buf)
        expect(parsed.refs.length).toBe(17)
        expect(parsed.reviewId).toBe(3)
        // 身份证文件已被 Word 移出原始路径 → trustWordIds 必须为 false
        expect(parsed.trustWordIds).toBe(false)
    })
})
