/**
 * mime 工具函数测试
 *
 * 测试 MIME 类型查找功能
 *
 * **Feature: mime-utils**
 * **Validates: MIME 类型查找功能**
 */

import { describe, it, expect } from 'vitest'
import { mime } from '../../../shared/utils/mime'

describe('mime MIME 类型查找', () => {
    it('常见图片格式应返回正确 MIME 类型', () => {
        expect(mime.getType('test.png')).toBe('image/png')
        expect(mime.getType('test.jpg')).toBe('image/jpeg')
        expect(mime.getType('test.jpeg')).toBe('image/jpeg')
        expect(mime.getType('test.gif')).toBe('image/gif')
        expect(mime.getType('test.webp')).toBe('image/webp')
        expect(mime.getType('test.svg')).toBe('image/svg+xml')
        expect(mime.getType('test.bmp')).toBe('image/bmp')
        expect(mime.getType('test.ico')).toBe('image/vnd.microsoft.icon')
    })

    it('常见文档格式应返回正确 MIME 类型', () => {
        expect(mime.getType('test.pdf')).toBe('application/pdf')
        expect(mime.getType('test.doc')).toBe('application/msword')
        expect(mime.getType('test.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        expect(mime.getType('test.xls')).toBe('application/vnd.ms-excel')
        expect(mime.getType('test.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        expect(mime.getType('test.ppt')).toBe('application/vnd.ms-powerpoint')
        expect(mime.getType('test.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    })

    it('常见音频格式应返回正确 MIME 类型', () => {
        expect(mime.getType('test.mp3')).toBe('audio/mpeg')
        expect(mime.getType('test.wav')).toBe('audio/wav')
        expect(mime.getType('test.ogg')).toBe('audio/ogg')
        expect(mime.getType('test.m4a')).toBe('audio/x-m4a')
    })

    it('常见视频格式应返回正确 MIME 类型', () => {
        expect(mime.getType('test.mp4')).toBe('video/mp4')
        expect(mime.getType('test.webm')).toBe('video/webm')
        expect(mime.getType('test.avi')).toBe('video/x-msvideo')
    })

    it('常见压缩格式应返回正确 MIME 类型', () => {
        expect(mime.getType('test.zip')).toBe('application/zip')
        expect(mime.getType('test.tar')).toBe('application/x-tar')
        expect(mime.getType('test.gz')).toBe('application/gzip')
        expect(mime.getType('test.rar')).toBe('application/vnd.rar')
        expect(mime.getType('test.7z')).toBe('application/x-7z-compressed')
    })

    it('文本格式应返回正确 MIME 类型', () => {
        expect(mime.getType('test.txt')).toBe('text/plain')
        expect(mime.getType('test.html')).toBe('text/html')
        expect(mime.getType('test.css')).toBe('text/css')
        expect(mime.getType('test.js')).toBe('text/javascript')
        expect(mime.getType('test.json')).toBe('application/json')
        expect(mime.getType('test.xml')).toBe('application/xml')
        expect(mime.getType('test.md')).toBe('text/markdown')
    })

    it('应用程序格式应返回正确 MIME 类型', () => {
        expect(mime.getType('test.exe')).toBe('application/octet-stream')
        expect(mime.getType('test.dll')).toBe('application/octet-stream')
        expect(mime.getType('test.woff')).toBe('font/woff')
        expect(mime.getType('test.woff2')).toBe('font/woff2')
    })

    it('无扩展名应返回 null', () => {
        expect(mime.getType('testfile')).toBeNull()
        expect(mime.getType('')).toBeNull()
    })

    it('未知扩展名应返回 null', () => {
        expect(mime.getType('test.abcdef')).toBeNull()
    })

    it('xyz 扩展名有对应 MIME 类型', () => {
        // mime 库包含 chemical/x-xyz 类型
        expect(mime.getType('test.xyz')).toBe('chemical/x-xyz')
    })

    it('大小写不敏感应返回正确类型', () => {
        expect(mime.getType('test.PNG')).toBe('image/png')
        expect(mime.getType('test.Jpg')).toBe('image/jpeg')
        expect(mime.getType('test.PDF')).toBe('application/pdf')
    })

    it('带路径的文件名应正确提取扩展名', () => {
        expect(mime.getType('/path/to/test.png')).toBe('image/png')
        expect(mime.getType('C:\\path\\to\\test.jpg')).toBe('image/jpeg')
        expect(mime.getType('test.file.tar.gz')).toBe('application/gzip')
    })

    it('带查询参数的文件名应正确提取扩展名', () => {
        // mime 库不会自动处理查询参数，扩展名提取以最后一段为准
        expect(mime.getType('test.png?v=1')).toBeNull()
        expect(mime.getType('test.jpg?size=large')).toBeNull()
    })
})
