/**
 * file-card 解析器单元测试
 *
 * **Feature: ai-message-rendering**
 * **Validates: parseFileCardBlock / parseMessageSegments
 *  支持 LLM 缩写格式（= separator、单字段）以及标准多行格式**
 */
import { describe, it, expect } from 'vitest'
import { parseFileCardBlock, parseMessageSegments } from '../../../app/utils/fileCardParser'

describe('parseFileCardBlock 解析 [file-card] 块体', () => {
    it('标准多行格式（: separator）应完整解析', () => {
        const block = `\nfileId: 17\nfileName: presentation.pptx\nfileSize: 155790\nmimeType: application/pdf\n`
        const data = parseFileCardBlock(block)
        expect(data).toEqual({
            fileId: '17',
            fileName: 'presentation.pptx',
            fileSize: 155790,
            mimeType: 'application/pdf',
            temporary: false,
            expiresAt: undefined,
        })
    })

    it('LLM 缩写格式（= separator，仅 fileId）应解析成功，其它字段为占位', () => {
        const data = parseFileCardBlock('fileId=17')
        expect(data).not.toBeNull()
        expect(data!.fileId).toBe('17')
        expect(data!.fileName).toBe('')
        expect(data!.fileSize).toBe(0)
        expect(data!.mimeType).toBe('')
    })

    it('混用 : 和 = 时按字段就近 separator 解析', () => {
        const block = `fileId: 17\nfileName=a.pptx`
        const data = parseFileCardBlock(block)
        expect(data!.fileId).toBe('17')
        expect(data!.fileName).toBe('a.pptx')
    })

    it('临时文件标记应正确解析为 boolean，且 ISO 日期值中的冒号不会被误切', () => {
        const block = `fileId: temp_99\nfileName: tmp.txt\nfileSize: 100\nmimeType: text/plain\ntemporary: true\nexpiresAt: 2026-04-15T10:00:00.000Z`
        const data = parseFileCardBlock(block)
        expect(data!.temporary).toBe(true)
        expect(data!.expiresAt).toBe('2026-04-15T10:00:00.000Z')
    })

    it('缺少 fileId 时返回 null（无法渲染）', () => {
        expect(parseFileCardBlock('fileName: a.txt')).toBeNull()
        expect(parseFileCardBlock('')).toBeNull()
        expect(parseFileCardBlock('   ')).toBeNull()
    })

    it('fileSize 非数字时降级为 0', () => {
        const data = parseFileCardBlock('fileId=17\nfileSize=abc')
        expect(data!.fileSize).toBe(0)
    })
})

describe('parseMessageSegments 把消息切分为 markdown 与 file-card 片段', () => {
    it('无 file-card 标记时返回单一 markdown 片段', () => {
        const segments = parseMessageSegments('普通消息内容')
        expect(segments).toHaveLength(1)
        expect(segments[0]).toEqual({ type: 'markdown', text: '普通消息内容' })
    })

    it('多行标准 file-card 块应被识别', () => {
        const content = `开头描述\n\n[file-card]\nfileId: 17\nfileName: a.pptx\nfileSize: 100\nmimeType: text/plain\n[/file-card]\n\n结尾说明`
        const segments = parseMessageSegments(content)
        expect(segments).toHaveLength(3)
        expect(segments[0]!.type).toBe('markdown')
        expect(segments[1]!.type).toBe('file-card')
        expect((segments[1] as { data: { fileId: string } }).data.fileId).toBe('17')
        expect(segments[2]!.type).toBe('markdown')
    })

    it('LLM 缩写单行格式 [file-card]fileId=17[/file-card] 也能被识别', () => {
        const content = `下载链接：[file-card]fileId=17[/file-card]`
        const segments = parseMessageSegments(content)
        expect(segments).toHaveLength(2)
        expect(segments[0]).toEqual({ type: 'markdown', text: '下载链接：' })
        expect(segments[1]!.type).toBe('file-card')
        expect((segments[1] as { data: { fileId: string } }).data.fileId).toBe('17')
    })

    it('解析失败的块体应保留原文 markdown 片段（不丢失内容）', () => {
        const content = `[file-card]fileName=a.pptx[/file-card]`  // 缺 fileId
        const segments = parseMessageSegments(content)
        expect(segments).toHaveLength(1)
        expect(segments[0]).toEqual({ type: 'markdown', text: '[file-card]fileName=a.pptx[/file-card]' })
    })

    it('一条消息内多个 file-card 都应被解析', () => {
        const content = `第一个：[file-card]fileId=1[/file-card] 第二个：[file-card]fileId=2[/file-card]`
        const segments = parseMessageSegments(content)
        const cards = segments.filter(s => s.type === 'file-card')
        expect(cards).toHaveLength(2)
    })
})
