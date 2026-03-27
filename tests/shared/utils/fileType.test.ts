/**
 * fileType 文件类型判断测试
 *
 * 测试图片、音频、文档文件类型判断功能
 *
 * **Feature: file-type-recognition**
 * **Validates: 统一文件类型判断功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { isImageFile, isAudioFile, isRecognizableDocFile } from '../../../shared/utils/fileType'

describe('isImageFile 图片文件判断', () => {
    it('支持的图片格式应返回 true', () => {
        expect(isImageFile('photo.png')).toBe(true)
        expect(isImageFile('photo.jpg')).toBe(true)
        expect(isImageFile('photo.jpeg')).toBe(true)
        expect(isImageFile('image.gif')).toBe(true)
        expect(isImageFile('image.webp')).toBe(true)
        expect(isImageFile('image.heic')).toBe(true)
        expect(isImageFile('image.heif')).toBe(true)
    })

    it('大写扩展名应正确处理', () => {
        expect(isImageFile('photo.PNG')).toBe(true)
        expect(isImageFile('photo.JPG')).toBe(true)
        expect(isImageFile('photo.JPEG')).toBe(true)
        expect(isImageFile('photo.GIF')).toBe(true)
        expect(isImageFile('photo.WEBP')).toBe(true)
    })

    it('非图片格式应返回 false', () => {
        expect(isImageFile('document.pdf')).toBe(false)
        expect(isImageFile('music.mp3')).toBe(false)
        expect(isImageFile('video.mp4')).toBe(false)
        expect(isImageFile('archive.zip')).toBe(false)
    })

    it('无扩展名应返回 false', () => {
        expect(isImageFile('noextension')).toBe(false)
        expect(isImageFile('')).toBe(false)
    })

    it('带路径的文件名应正确处理', () => {
        expect(isImageFile('/path/to/photo.png')).toBe(true)
        expect(isImageFile('/uploads/image.JPG')).toBe(true)
    })

    it('Property: 所有支持的图片扩展名应返回 true', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1 }).filter(s => !s.includes('.')),
                (name) => {
                    const result = isImageFile(`${name}.png`)
                    expect(result).toBe(true)
                }
            ),
            { numRuns: 50, seed: 12345 }
        )
    })
})

describe('isAudioFile 音频文件判断', () => {
    it('支持的音频格式应返回 true', () => {
        expect(isAudioFile('music.mp3')).toBe(true)
        expect(isAudioFile('audio.wav')).toBe(true)
        expect(isAudioFile('voice.m4a')).toBe(true)
        expect(isAudioFile('sound.aac')).toBe(true)
        expect(isAudioFile('track.flac')).toBe(true)
        expect(isAudioFile('podcast.ogg')).toBe(true)
        expect(isAudioFile('video.webm')).toBe(true)
        expect(isAudioFile('recording.amr')).toBe(true)
        expect(isAudioFile('stream.opus')).toBe(true)
    })

    it('大写扩展名应正确处理', () => {
        expect(isAudioFile('music.MP3')).toBe(true)
        expect(isAudioFile('audio.WAV')).toBe(true)
        expect(isAudioFile('voice.M4A')).toBe(true)
    })

    it('非音频格式应返回 false', () => {
        expect(isAudioFile('image.png')).toBe(false)
        expect(isAudioFile('video.mp4')).toBe(false)
        expect(isAudioFile('document.pdf')).toBe(false)
    })

    it('无扩展名应返回 false', () => {
        expect(isAudioFile('noextension')).toBe(false)
        expect(isAudioFile('')).toBe(false)
    })
})

describe('isRecognizableDocFile 可识别文档文件判断', () => {
    it('支持的文档格式应返回 true', () => {
        expect(isRecognizableDocFile('report.docx')).toBe(true)
        expect(isRecognizableDocFile('document.doc')).toBe(true)
        expect(isRecognizableDocFile('paper.pdf')).toBe(true)
        expect(isRecognizableDocFile('readme.md')).toBe(true)
        expect(isRecognizableDocFile('notes.mkd')).toBe(true)
        expect(isRecognizableDocFile('changelog.markdown')).toBe(true)
        expect(isRecognizableDocFile('log.txt')).toBe(true)
    })

    it('大写扩展名应正确处理', () => {
        expect(isRecognizableDocFile('report.DOCX')).toBe(true)
        expect(isRecognizableDocFile('paper.PDF')).toBe(true)
        expect(isRecognizableDocFile('readme.MD')).toBe(true)
    })

    it('非文档格式应返回 false', () => {
        expect(isRecognizableDocFile('image.png')).toBe(false)
        expect(isRecognizableDocFile('music.mp3')).toBe(false)
        expect(isRecognizableDocFile('video.mp4')).toBe(false)
        expect(isRecognizableDocFile('archive.zip')).toBe(false)
    })

    it('无扩展名应返回 false', () => {
        expect(isRecognizableDocFile('noextension')).toBe(false)
        expect(isRecognizableDocFile('')).toBe(false)
    })

    it('带路径的文件名应正确处理', () => {
        expect(isRecognizableDocFile('/docs/report.pdf')).toBe(true)
        expect(isRecognizableDocFile('/uploads/document.DOCX')).toBe(true)
    })

    it('多个点的文件名应正确处理', () => {
        expect(isRecognizableDocFile('my.document.v2.pdf')).toBe(true)
        expect(isRecognizableDocFile('report.2024.final.docx')).toBe(true)
    })
})

describe('文件类型互斥性测试', () => {
    it('文件不应同时属于多个类别', () => {
        const testCases = [
            'photo.png',
            'music.mp3',
            'document.pdf',
            'report.docx',
            'notes.md',
        ]

        for (const fileName of testCases) {
            const results = [
                isImageFile(fileName),
                isAudioFile(fileName),
                isRecognizableDocFile(fileName),
            ]
            const trueCount = results.filter(Boolean).length
            expect(trueCount).toBe(1)
        }
    })
})
