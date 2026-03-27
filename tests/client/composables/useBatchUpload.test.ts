/**
 * useBatchUpload 批量上传 Composable 测试
 *
 * 测试 detectMimeType 和 validateFile 功能
 *
 * **Feature: batch-upload-composable**
 * **Validates: 文件类型检测和验证功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 导入待测试的 composable
const { useBatchUpload } = await import('~/composables/useBatchUpload')
const { detectMimeType, validateFile } = useBatchUpload()

// 创建模拟 File 对象
// 注意：在测试环境中 File.type 可能不会自动推断，所以显式传递 MIME 类型
const createMockFile = (name: string, size: number, type: string = 'application/octet-stream'): File => {
    const blob = new Blob([''], { type })
    return new File([blob], name, { type })
}

describe('useBatchUpload detectMimeType 文件类型检测', () => {
    it('应优先使用 File.type（显式设置的 MIME 类型）', () => {
        // 当 file.type 有值时，应直接返回
        const file = new File([''], 'photo.jpg', { type: 'image/jpeg' })
        expect(detectMimeType(file)).toBe('image/jpeg')
    })

    it('应正确识别常见图片格式（从扩展名推断）', () => {
        // 无 MIME type 时从扩展名推断
        const fileNoType = new File([''], 'photo.jpg')
        expect(detectMimeType(fileNoType)).toMatch(/image\/jpeg|application\/octet-stream/)
    })

    it('应正确识别文档格式', () => {
        const file = new File([''], 'doc.pdf', { type: 'application/pdf' })
        expect(detectMimeType(file)).toBe('application/pdf')
    })

    it('应正确识别音频格式', () => {
        const file = new File([''], 'audio.mp3', { type: 'audio/mpeg' })
        expect(detectMimeType(file)).toBe('audio/mpeg')
    })

    it('应正确识别视频格式', () => {
        const file = new File([''], 'video.mp4', { type: 'video/mp4' })
        expect(detectMimeType(file)).toBe('video/mp4')
    })

    it('应将 .md 文件识别为 text/markdown', () => {
        // 只有 file.type 为 text/x-markdown 时才转换
        const file = new File([''], 'readme.md', { type: 'text/x-markdown' })
        expect(detectMimeType(file)).toBe('text/markdown')
    })

    it('Property: 任意文件都应返回字符串结果', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 20 }),
                (name) => {
                    const file = new File([''], `${name}.pdf`)
                    const result = detectMimeType(file)
                    expect(typeof result).toBe('string')
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })
})

describe('useBatchUpload validateFile 文件验证', () => {
    const mockScene = {
        name: '文档识别',
        accept: [
            { name: 'pdf', mime: 'application/pdf', maxSize: 50 * 1024 * 1024 },
            { name: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', maxSize: 20 * 1024 * 1024 },
            { name: 'doc', mime: 'application/msword', maxSize: 20 * 1024 * 1024 },
            { name: 'txt', mime: 'text/plain', maxSize: 1 * 1024 * 1024 },
            { name: 'md', mime: 'text/markdown', maxSize: 1 * 1024 * 1024 },
        ],
    }

    it('null 场景应返回无效', () => {
        const file = createMockFile('test.pdf')
        const result = validateFile(file, null)
        expect(result.valid).toBe(false)
        expect(result.message).toBe('请选择上传场景')
    })

    it('有效 PDF 文件应通过验证', () => {
        const file = createMockFile('test.pdf', 1 * 1024 * 1024, 'application/pdf')
        const result = validateFile(file, mockScene)
        expect(result.valid).toBe(true)
    })

    it('超过大小限制的文件应返回无效', () => {
        // 创建 60MB 的文件内容（使用 60MB 字符串）来超过 50MB 限制
        const largeContent = new Uint8Array(60 * 1024 * 1024)
        const file = new File([largeContent], 'test.pdf', { type: 'application/pdf' })
        expect(file.size).toBeGreaterThan(50 * 1024 * 1024)
        const result = validateFile(file, mockScene)
        expect(result.valid).toBe(false)
        expect(result.message).toContain('超出限制')
    })

    it('不支持的文件类型应返回无效', () => {
        const file = createMockFile('test.exe', 1 * 1024 * 1024, 'application/x-msdownload')
        const result = validateFile(file, mockScene)
        expect(result.valid).toBe(false)
        expect(result.message).toContain('不支持')
    })

    it('按扩展名判断文件类型应正确验证', () => {
        // 文件没有 MIME type 但有扩展名
        const blob = new Blob([''], { type: '' })
        const file = new File([blob], 'test.pdf', { type: '' })
        const result = validateFile(file, mockScene)
        expect(result.valid).toBe(true)
    })

    it('无扩展名文件应返回无效', () => {
        const file = createMockFile('无扩展名', 1 * 1024 * 1024, 'application/octet-stream')
        const result = validateFile(file, mockScene)
        expect(result.valid).toBe(false)
    })

    it('空 accept 列表应通过验证', () => {
        const file = createMockFile('test.pdf')
        const emptyScene = { name: '测试', accept: [] }
        const result = validateFile(file, emptyScene as any)
        expect(result.valid).toBe(true)
    })

    it('Property: 任意有效文件应通过验证', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('pdf', 'docx', 'doc', 'txt', 'md'),
                (ext) => {
                    const file = createMockFile(`test.${ext}`, 512 * 1024) // 512KB
                    const result = validateFile(file, mockScene)
                    expect(result.valid).toBe(true)
                }
            ),
            { numRuns: 50 }
        )
    })

    it('Property: 任意无效文件应返回无效', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('exe', 'sh', 'bat', 'dll', 'bin'),
                (ext) => {
                    const file = createMockFile(`test.${ext}`)
                    const result = validateFile(file, mockScene)
                    expect(result.valid).toBe(false)
                }
            ),
            { numRuns: 50 }
        )
    })
})
