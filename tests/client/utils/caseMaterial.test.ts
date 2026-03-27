/**
 * caseMaterial 案件材料工具测试
 *
 * 测试材料类型判断功能
 *
 * **Feature: case-material-utils**
 * **Validates: 案件材料类型判断**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { getMaterialType } from '~/utils/caseMaterial'
import { CaseMaterialType } from '#shared/types/case'

describe('getMaterialType 根据 MIME 类型判断材料类型', () => {
    it('image/jpeg 应返回 IMAGE', () => {
        expect(getMaterialType('image/jpeg')).toBe(CaseMaterialType.IMAGE)
    })

    it('image/png 应返回 IMAGE', () => {
        expect(getMaterialType('image/png')).toBe(CaseMaterialType.IMAGE)
    })

    it('image/gif 应返回 IMAGE', () => {
        expect(getMaterialType('image/gif')).toBe(CaseMaterialType.IMAGE)
    })

    it('image/webp 应返回 IMAGE', () => {
        expect(getMaterialType('image/webp')).toBe(CaseMaterialType.IMAGE)
    })

    it('audio/mpeg 应返回 AUDIO', () => {
        expect(getMaterialType('audio/mpeg')).toBe(CaseMaterialType.AUDIO)
    })

    it('audio/mp3 应返回 AUDIO', () => {
        expect(getMaterialType('audio/mp3')).toBe(CaseMaterialType.AUDIO)
    })

    it('audio/wav 应返回 AUDIO', () => {
        expect(getMaterialType('audio/wav')).toBe(CaseMaterialType.AUDIO)
    })

    it('audio/m4a 应返回 AUDIO', () => {
        expect(getMaterialType('audio/m4a')).toBe(CaseMaterialType.AUDIO)
    })

    it('application/pdf 应返回 DOCUMENT', () => {
        expect(getMaterialType('application/pdf')).toBe(CaseMaterialType.DOCUMENT)
    })

    it('application/msword 应返回 DOCUMENT', () => {
        expect(getMaterialType('application/msword')).toBe(CaseMaterialType.DOCUMENT)
    })

    it('application/vnd.openxmlformats 应返回 DOCUMENT', () => {
        expect(getMaterialType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(CaseMaterialType.DOCUMENT)
    })

    it('text/plain 应返回 DOCUMENT', () => {
        expect(getMaterialType('text/plain')).toBe(CaseMaterialType.DOCUMENT)
    })

    it('text/html 应返回 DOCUMENT', () => {
        expect(getMaterialType('text/html')).toBe(CaseMaterialType.DOCUMENT)
    })

    it('video/mp4 应返回 DOCUMENT', () => {
        expect(getMaterialType('video/mp4')).toBe(CaseMaterialType.DOCUMENT)
    })

    it('空字符串应返回 DOCUMENT', () => {
        expect(getMaterialType('')).toBe(CaseMaterialType.DOCUMENT)
    })

    it('undefined MIME 类型应返回 DOCUMENT', () => {
        expect(getMaterialType(undefined as any)).toBe(CaseMaterialType.DOCUMENT)
    })

    it('Property: 所有图片 MIME 类型应返回 IMAGE', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'),
                (mimeType) => {
                    expect(getMaterialType(mimeType)).toBe(CaseMaterialType.IMAGE)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property: 所有音频 MIME 类型应返回 AUDIO', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/ogg', 'audio/aac'),
                (mimeType) => {
                    expect(getMaterialType(mimeType)).toBe(CaseMaterialType.AUDIO)
                }
            ),
            { numRuns: 100 }
        )
    })

    it('Property: 非图片非音频 MIME 类型应返回 DOCUMENT', () => {
        fc.assert(
            fc.property(
                fc.constantFrom('application/pdf', 'application/msword', 'text/plain', 'application/zip', 'video/mp4'),
                (mimeType) => {
                    expect(getMaterialType(mimeType)).toBe(CaseMaterialType.DOCUMENT)
                }
            ),
            { numRuns: 100 }
        )
    })
})
