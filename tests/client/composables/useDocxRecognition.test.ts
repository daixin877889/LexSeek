/**
 * useDocxRecognition 文档类型识别测试
 *
 * 测试文档文件类型判断函数
 *
 * **Feature: docx-recognition-composable**
 * **Validates: 文档类型识别功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 导入待测试的函数
const {
    isDocxFile,
    isDocFile,
    isPdfFile,
    needsMineruRecognition,
    isMarkdownFile,
    isTxtFile,
} = await import('~/composables/useDocxRecognition')

describe('useDocxRecognition isDocxFile 测试', () => {
    it('docx 文件应返回 true', () => {
        expect(isDocxFile('document.docx')).toBe(true)
        expect(isDocxFile('my.file.docx')).toBe(true)
        expect(isDocxFile('DOCX')).toBe(false) // 无点号，扩展名为空字符串
        expect(isDocxFile('.docx')).toBe(false) // lastDotIndex=0，不满足 > 0
    })

    it('非 docx 文件应返回 false', () => {
        expect(isDocxFile('document.doc')).toBe(false)
        expect(isDocxFile('document.pdf')).toBe(false)
        expect(isDocxFile('document.txt')).toBe(false)
        expect(isDocxFile('document.md')).toBe(false)
    })

    it('无扩展名文件应返回 false', () => {
        expect(isDocxFile('noextension')).toBe(false)
    })

    it('属性测试：所有 docx 文件扩展名应返回 true', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1 }).filter(s => !s.includes('.')),
                (name) => {
                    const result = isDocxFile(`${name}.docx`)
                    expect(result).toBe(true)
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })
})

describe('useDocxRecognition isDocFile 测试', () => {
    it('doc 文件应返回 true', () => {
        expect(isDocFile('old-document.doc')).toBe(true)
        expect(isDocFile('my.file.doc')).toBe(true)
        expect(isDocFile('DOC')).toBe(false) // 无点号，扩展名为空字符串
        expect(isDocFile('.doc')).toBe(false) // lastDotIndex=0，不满足 > 0
    })

    it('非 doc 文件应返回 false', () => {
        expect(isDocFile('document.docx')).toBe(false)
        expect(isDocFile('document.pdf')).toBe(false)
        expect(isDocFile('document.txt')).toBe(false)
    })
})

describe('useDocxRecognition isPdfFile 测试', () => {
    it('pdf 文件应返回 true', () => {
        expect(isPdfFile('document.pdf')).toBe(true)
        expect(isPdfFile('my.file.pdf')).toBe(true)
        expect(isPdfFile('REPORT.PDF')).toBe(true)
    })

    it('非 pdf 文件应返回 false', () => {
        expect(isPdfFile('document.docx')).toBe(false)
        expect(isPdfFile('document.doc')).toBe(false)
        expect(isPdfFile('document.txt')).toBe(false)
    })
})

describe('useDocxRecognition needsMineruRecognition 测试', () => {
    it('doc 文件应返回 true', () => {
        expect(needsMineruRecognition('document.doc')).toBe(true)
    })

    it('pdf 文件应返回 true', () => {
        expect(needsMineruRecognition('document.pdf')).toBe(true)
    })

    it('docx 文件应返回 false', () => {
        expect(needsMineruRecognition('document.docx')).toBe(false)
    })

    it('txt 文件应返回 false', () => {
        expect(needsMineruRecognition('document.txt')).toBe(false)
    })

    it('md 文件应返回 false', () => {
        expect(needsMineruRecognition('document.md')).toBe(false)
    })
})

describe('useDocxRecognition isMarkdownFile 测试', () => {
    it('md 文件应返回 true', () => {
        expect(isMarkdownFile('readme.md')).toBe(true)
        expect(isMarkdownFile('notes.mkd')).toBe(true)
        expect(isMarkdownFile('changelog.markdown')).toBe(true)
    })

    it('非 md/mkd/markdown 文件应返回 false', () => {
        expect(isMarkdownFile('document.docx')).toBe(false)
        expect(isMarkdownFile('document.txt')).toBe(false)
        expect(isMarkdownFile('document.pdf')).toBe(false)
    })
})

describe('useDocxRecognition isTxtFile 测试', () => {
    it('txt 文件应返回 true', () => {
        expect(isTxtFile('log.txt')).toBe(true)
        expect(isTxtFile('data.txt')).toBe(true)
    })

    it('非 txt 文件应返回 false', () => {
        expect(isTxtFile('document.docx')).toBe(false)
        expect(isTxtFile('document.pdf')).toBe(false)
        expect(isTxtFile('document.md')).toBe(false)
    })
})

describe('useDocxRecognition 互斥性测试', () => {
    it('文件不应同时属于多个类别', () => {
        const testCases = [
            'document.docx',
            'document.doc',
            'document.pdf',
            'document.txt',
            'document.md',
            'document.mkd',
            'document.markdown',
        ]

        for (const fileName of testCases) {
            const results = [
                isDocxFile(fileName),
                isDocFile(fileName),
                isPdfFile(fileName),
                isTxtFile(fileName),
                isMarkdownFile(fileName),
            ]
            const trueCount = results.filter(Boolean).length
            expect(trueCount).toBeLessThanOrEqual(1)
        }
    })
})

describe('useDocxRecognition 边界情况测试', () => {
    it('带路径的文件名应正确处理', () => {
        expect(isDocxFile('/path/to/document.docx')).toBe(true)
        expect(isPdfFile('/path/to/document.pdf')).toBe(true)
        expect(isMarkdownFile('/path/to/readme.md')).toBe(true)
    })

    it('带多个点的文件名应正确处理', () => {
        expect(isDocxFile('my.document.v2.final.docx')).toBe(true)
        expect(isPdfFile('report.2024.final.pdf')).toBe(true)
    })

    it('空字符串应返回 false', () => {
        expect(isDocxFile('')).toBe(false)
        expect(isDocFile('')).toBe(false)
        expect(isPdfFile('')).toBe(false)
        expect(isTxtFile('')).toBe(false)
        expect(isMarkdownFile('')).toBe(false)
    })

    it('只有扩展名的字符串（无文件名前缀）应返回 false', () => {
        // getExtensionFromFileName 要求 lastDotIndex > 0，所以 .docx 返回 ''
        expect(isDocxFile('.docx')).toBe(false)
        expect(isPdfFile('.pdf')).toBe(false)
        expect(isTxtFile('.txt')).toBe(false)
    })
})
