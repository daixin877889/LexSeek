/**
 * 文件识别服务测试
 *
 * **Feature: file-type-detection**
 * **Validates: 根据文件扩展名自动识别材料类型**
 */

import { describe, it, expect } from 'vitest'
import { detectFileTypeService } from '../../../server/services/material/fileDetect.service'
import { CaseMaterialType } from '../../../shared/types/case'

describe('文件识别服务', () => {
    describe('图片识别', () => {
        it('应该识别 jpg 为 IMAGE 类型', () => {
            expect(detectFileTypeService('test.jpg')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该识别 jpeg 为 IMAGE 类型', () => {
            expect(detectFileTypeService('photo.jpeg')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该识别 png 为 IMAGE 类型', () => {
            expect(detectFileTypeService('image.png')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该识别 gif 为 IMAGE 类型', () => {
            expect(detectFileTypeService('animated.gif')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该识别 webp 为 IMAGE 类型', () => {
            expect(detectFileTypeService('picture.webp')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该识别 heic 为 IMAGE 类型', () => {
            expect(detectFileTypeService('photo.heic')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该识别 heif 为 IMAGE 类型', () => {
            expect(detectFileTypeService('photo.heif')).toBe(CaseMaterialType.IMAGE)
        })
    })

    describe('音频识别', () => {
        it('应该识别 mp3 为 AUDIO 类型', () => {
            expect(detectFileTypeService('recording.mp3')).toBe(CaseMaterialType.AUDIO)
        })

        it('应该识别 wav 为 AUDIO 类型', () => {
            expect(detectFileTypeService('audio.wav')).toBe(CaseMaterialType.AUDIO)
        })

        it('应该识别 m4a 为 AUDIO 类型', () => {
            expect(detectFileTypeService('music.m4a')).toBe(CaseMaterialType.AUDIO)
        })

        it('应该识别 aac 为 AUDIO 类型', () => {
            expect(detectFileTypeService('sound.aac')).toBe(CaseMaterialType.AUDIO)
        })

        it('应该识别 ogg 为 AUDIO 类型', () => {
            expect(detectFileTypeService('audio.ogg')).toBe(CaseMaterialType.AUDIO)
        })

        it('应该识别 flac 为 AUDIO 类型', () => {
            expect(detectFileTypeService('lossless.flac')).toBe(CaseMaterialType.AUDIO)
        })
    })

    describe('文档识别', () => {
        it('应该识别 pdf 为 DOCUMENT 类型', () => {
            expect(detectFileTypeService('document.pdf')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('应该识别 doc 为 DOCUMENT 类型', () => {
            expect(detectFileTypeService('word.doc')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('应该识别 docx 为 DOCUMENT 类型', () => {
            expect(detectFileTypeService('word.docx')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('应该识别 md 为 DOCUMENT 类型', () => {
            expect(detectFileTypeService('readme.md')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('应该识别 txt 为 DOCUMENT 类型', () => {
            expect(detectFileTypeService('notes.txt')).toBe(CaseMaterialType.DOCUMENT)
        })
    })

    describe('大小写忽略', () => {
        it('应该忽略大写扩展名 - JPG', () => {
            expect(detectFileTypeService('photo.JPG')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该忽略大写扩展名 - PNG', () => {
            expect(detectFileTypeService('image.PNG')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该忽略大写扩展名 - MP3', () => {
            expect(detectFileTypeService('audio.MP3')).toBe(CaseMaterialType.AUDIO)
        })

        it('应该忽略大写扩展名 - PDF', () => {
            expect(detectFileTypeService('document.PDF')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('应该忽略混合大小写 - Jpeg', () => {
            expect(detectFileTypeService('photo.Jpeg')).toBe(CaseMaterialType.IMAGE)
        })

        it('应该忽略混合大小写 - Mp3', () => {
            expect(detectFileTypeService('music.Mp3')).toBe(CaseMaterialType.AUDIO)
        })
    })

    describe('无扩展名文件', () => {
        it('应该将无扩展名文件识别为 DOCUMENT', () => {
            expect(detectFileTypeService('filename')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('应该将只有点的文件名识别为 DOCUMENT', () => {
            expect(detectFileTypeService('filename.')).toBe(CaseMaterialType.DOCUMENT)
        })
    })
})
