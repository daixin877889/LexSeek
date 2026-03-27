/**
 * file 工具函数测试
 *
 * 测试文件扩展名提取和相关常量
 *
 * **Feature: file-utils**
 * **Validates: 文件工具函数**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
    getExtensionFromFileName,
    ASR_ACCEPT,
    DOC_ACCEPT,
    IMAGE_EXTENSIONS,
    AUDIO_EXTENSIONS,
    DOC_EXTENSIONS,
    IMAGE_ACCEPT,
    getFileSourceAccept,
} from '../../../shared/utils/file'
import { FileSource } from '../../../shared/types/file'

describe('getExtensionFromFileName 扩展名提取', () => {
    it('正常文件应正确提取扩展名', () => {
        expect(getExtensionFromFileName('photo.png')).toBe('png')
        expect(getExtensionFromFileName('document.pdf')).toBe('pdf')
        expect(getExtensionFromFileName('archive.zip')).toBe('zip')
    })

    it('大写扩展名应转换为小写', () => {
        expect(getExtensionFromFileName('photo.PNG')).toBe('png')
        expect(getExtensionFromFileName('document.PDF')).toBe('pdf')
        expect(getExtensionFromFileName('archive.ZIP')).toBe('zip')
    })

    it('多级扩展名应取最后一个', () => {
        expect(getExtensionFromFileName('document.tar.gz')).toBe('gz')
        expect(getExtensionFromFileName('my.file.docx')).toBe('docx')
    })

    it('无扩展名应返回空字符串', () => {
        expect(getExtensionFromFileName('noextension')).toBe('')
        expect(getExtensionFromFileName('')).toBe('')
        expect(getExtensionFromFileName('README')).toBe('')
    })

    it('只有点号应返回空字符串', () => {
        expect(getExtensionFromFileName('.')).toBe('')
        expect(getExtensionFromFileName('..')).toBe('')
    })

    it('前缀为点号但无扩展名应返回空字符串', () => {
        // .gitignore 这种情况，lastDotIndex = 0，不满足 > 0
        expect(getExtensionFromFileName('.gitignore')).toBe('')
        expect(getExtensionFromFileName('.env')).toBe('')
    })

    it('带路径的文件名应正确提取', () => {
        expect(getExtensionFromFileName('/path/to/photo.png')).toBe('png')
        expect(getExtensionFromFileName('/uploads/document.PDF')).toBe('pdf')
        expect(getExtensionFromFileName('C:\\Users\\file.zip')).toBe('zip')
    })

    it('Property: 有效扩展名应正确提取', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1 }).filter(s => !s.includes('.')),
                fc.constantFrom('png', 'jpg', 'pdf', 'docx', 'mp3', 'txt'),
                (name, ext) => {
                    const result = getExtensionFromFileName(`${name}.${ext}`)
                    expect(result).toBe(ext)
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })
})

describe('文件常量验证', () => {
    it('IMAGE_EXTENSIONS 应包含正确格式', () => {
        expect(IMAGE_EXTENSIONS).toContain('png')
        expect(IMAGE_EXTENSIONS).toContain('jpg')
        expect(IMAGE_EXTENSIONS).toContain('jpeg')
        expect(IMAGE_EXTENSIONS).toContain('gif')
        expect(IMAGE_EXTENSIONS).toContain('webp')
        expect(IMAGE_EXTENSIONS).toContain('heic')
        expect(IMAGE_EXTENSIONS).toContain('heif')
        expect(IMAGE_EXTENSIONS.length).toBe(7)
    })

    it('AUDIO_EXTENSIONS 应包含正确格式', () => {
        expect(AUDIO_EXTENSIONS).toContain('mp3')
        expect(AUDIO_EXTENSIONS).toContain('wav')
        expect(AUDIO_EXTENSIONS).toContain('m4a')
        expect(AUDIO_EXTENSIONS.length).toBe(9)
    })

    it('DOC_EXTENSIONS 应包含正确格式', () => {
        expect(DOC_EXTENSIONS).toContain('docx')
        expect(DOC_EXTENSIONS).toContain('doc')
        expect(DOC_EXTENSIONS).toContain('pdf')
        expect(DOC_EXTENSIONS).toContain('md')
        expect(DOC_EXTENSIONS).toContain('txt')
        expect(DOC_EXTENSIONS.length).toBe(7)
    })

    it('ASR_ACCEPT 应定义文件大小', () => {
        expect(ASR_ACCEPT.m4a).toBe(200 * 1024 * 1024)
        expect(ASR_ACCEPT.mp3).toBe(200 * 1024 * 1024)
        expect(ASR_ACCEPT.wav).toBe(500 * 1024 * 1024)
    })

    it('DOC_ACCEPT 应定义文件大小', () => {
        expect(DOC_ACCEPT.pdf).toBe(50 * 1024 * 1024)
        expect(DOC_ACCEPT.docx).toBe(20 * 1024 * 1024)
        expect(DOC_ACCEPT.txt).toBe(1 * 1024 * 1024)
    })

    it('IMAGE_ACCEPT 应定义文件大小', () => {
        expect(IMAGE_ACCEPT.png).toBe(10 * 1024 * 1024)
        expect(IMAGE_ACCEPT.jpg).toBe(10 * 1024 * 1024)
    })
})

describe('getFileSourceAccept 文件接受类型', () => {
    it('无参数应返回所有类型', () => {
        const result = getFileSourceAccept()
        expect(result.length).toBeGreaterThan(0)
    })

    it('ASR 源应有语音文件类型', () => {
        const result = getFileSourceAccept(FileSource.ASR)
        const asrSource = result.find(r => r.name === '语音识别')
        expect(asrSource).toBeDefined()
        expect(asrSource!.accept.some(a => a.name === 'm4a')).toBe(true)
        expect(asrSource!.accept.some(a => a.name === 'mp3')).toBe(true)
        expect(asrSource!.accept.some(a => a.name === 'wav')).toBe(true)
    })

    it('DOC 源应有文档文件类型', () => {
        const result = getFileSourceAccept(FileSource.DOC)
        const docSource = result.find(r => r.name === '文档识别')
        expect(docSource).toBeDefined()
        expect(docSource!.accept.some(a => a.name === 'pdf')).toBe(true)
        expect(docSource!.accept.some(a => a.name === 'docx')).toBe(true)
    })

    it('IMAGE 源应有图片类型', () => {
        const result = getFileSourceAccept(FileSource.IMAGE)
        const imageSource = result.find(r => r.name === '图片识别')
        expect(imageSource).toBeDefined()
        expect(imageSource!.accept.some(a => a.name === 'png')).toBe(true)
    })

    it('VIDEO 源应为空', () => {
        const result = getFileSourceAccept(FileSource.VIDEO)
        const videoSource = result.find(r => r.name === '视频')
        expect(videoSource).toBeDefined()
        expect(videoSource!.accept.length).toBe(0)
    })
})
