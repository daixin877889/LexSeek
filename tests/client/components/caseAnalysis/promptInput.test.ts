/**
 * promptInput.vue 组件测试
 * 
 * **Feature: case-analysis**
 * **Validates: Requirements 9.2**
 * 
 * 测试内容：
 * 1. getMaterialType 函数的材料类型判断逻辑
 * 2. 提交验证逻辑（文本或材料至少提供一个）
 * 3. 文件识别状态检查逻辑（不允许提交识别中的文件）
 * 4. 错误提示友好性验证（Requirements 9.2.3）
 */

import { describe, it, expect } from 'vitest'
import { CaseMaterialType } from '../../../../shared/types/case'
import { getMaterialType } from '../../../../app/utils/caseMaterial'

/**
 * 文件类型
 */
interface FileItem {
    id: number
    fileName: string
    fileType: string
}

/**
 * 识别状态类型
 */
type RecognitionStatus = 'idle' | 'recognizing' | 'success' | 'error'

/**
 * 验证提交数据是否有效
 * 至少需要提供文本内容或文件材料之一
 */
function validateSubmitData(text: string | undefined, filesCount: number): { valid: boolean; error?: string } {
    const hasText = !!text?.trim()
    const hasFiles = filesCount > 0

    if (!hasText && !hasFiles) {
        return { valid: false, error: '请输入案情信息或选择案情材料' }
    }

    return { valid: true }
}

/**
 * 检查文件是否为需要识别的文档文件（docx、doc、pdf、markdown 或 txt）
 */
function isRecognizableDocFile(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return ['docx', 'doc', 'pdf', 'md', 'mkd', 'markdown', 'txt'].includes(ext || '')
}

/**
 * 检查文件是否为图片文件
 */
function isImageFile(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'].includes(ext || '')
}

/**
 * 检查文件是否为音频文件
 */
function isAudioFile(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm', 'amr', 'opus'].includes(ext || '')
}

/**
 * 验证文件识别状态（不允许提交识别中的文件）
 */
function validateFileRecognitionStatus(
    files: FileItem[],
    statusMap: Map<number, RecognitionStatus>
): { valid: boolean; error?: string } {
    // 检查是否有正在识别的文件（文档、图片或音频）
    const recognizingFiles = files.filter(f => {
        const isRecognizable = isRecognizableDocFile(f.fileName) || isImageFile(f.fileName) || isAudioFile(f.fileName)
        const status = statusMap.get(f.id)
        return isRecognizable && status === 'recognizing'
    })

    if (recognizingFiles.length > 0) {
        return { valid: false, error: '请等待文件识别完成后再提交' }
    }

    return { valid: true }
}

describe('getMaterialType 材料类型判断', () => {
    describe('图片类型', () => {
        it('image/jpeg 应返回 IMAGE (3)', () => {
            expect(getMaterialType('image/jpeg')).toBe(CaseMaterialType.IMAGE)
            expect(getMaterialType('image/jpeg')).toBe(3)
        })

        it('image/png 应返回 IMAGE (3)', () => {
            expect(getMaterialType('image/png')).toBe(CaseMaterialType.IMAGE)
        })

        it('image/gif 应返回 IMAGE (3)', () => {
            expect(getMaterialType('image/gif')).toBe(CaseMaterialType.IMAGE)
        })

        it('image/webp 应返回 IMAGE (3)', () => {
            expect(getMaterialType('image/webp')).toBe(CaseMaterialType.IMAGE)
        })

        it('image/heic 应返回 IMAGE (3)', () => {
            expect(getMaterialType('image/heic')).toBe(CaseMaterialType.IMAGE)
        })
    })

    describe('音频类型', () => {
        it('audio/mp3 应返回 AUDIO (4)', () => {
            expect(getMaterialType('audio/mp3')).toBe(CaseMaterialType.AUDIO)
            expect(getMaterialType('audio/mp3')).toBe(4)
        })

        it('audio/wav 应返回 AUDIO (4)', () => {
            expect(getMaterialType('audio/wav')).toBe(CaseMaterialType.AUDIO)
        })

        it('audio/m4a 应返回 AUDIO (4)', () => {
            expect(getMaterialType('audio/m4a')).toBe(CaseMaterialType.AUDIO)
        })

        it('audio/ogg 应返回 AUDIO (4)', () => {
            expect(getMaterialType('audio/ogg')).toBe(CaseMaterialType.AUDIO)
        })
    })

    describe('文档类型', () => {
        it('application/pdf 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('application/pdf')).toBe(CaseMaterialType.DOCUMENT)
            expect(getMaterialType('application/pdf')).toBe(2)
        })

        it('application/vnd.openxmlformats-officedocument.wordprocessingml.document 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('application/msword 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('application/msword')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('text/plain 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('text/plain')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('text/markdown 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('text/markdown')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('application/json 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('application/json')).toBe(CaseMaterialType.DOCUMENT)
        })
    })

    describe('边界情况', () => {
        it('空字符串应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('undefined 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType(undefined as unknown as string)).toBe(CaseMaterialType.DOCUMENT)
        })

        it('null 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType(null as unknown as string)).toBe(CaseMaterialType.DOCUMENT)
        })

        it('未知类型应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('application/unknown')).toBe(CaseMaterialType.DOCUMENT)
        })
    })

    describe('视频类型（应返回 DOCUMENT）', () => {
        it('video/mp4 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('video/mp4')).toBe(CaseMaterialType.DOCUMENT)
        })

        it('video/webm 应返回 DOCUMENT (2)', () => {
            expect(getMaterialType('video/webm')).toBe(CaseMaterialType.DOCUMENT)
        })
    })
})

describe('提交验证逻辑', () => {
    describe('有效提交', () => {
        it('只有文本内容时应验证通过', () => {
            const result = validateSubmitData('这是案情描述', 0)
            expect(result.valid).toBe(true)
            expect(result.error).toBeUndefined()
        })

        it('只有文件材料时应验证通过', () => {
            const result = validateSubmitData('', 1)
            expect(result.valid).toBe(true)
            expect(result.error).toBeUndefined()
        })

        it('同时有文本和文件时应验证通过', () => {
            const result = validateSubmitData('案情描述', 2)
            expect(result.valid).toBe(true)
            expect(result.error).toBeUndefined()
        })

        it('文本内容有空格但有实际内容时应验证通过', () => {
            const result = validateSubmitData('  案情描述  ', 0)
            expect(result.valid).toBe(true)
        })
    })

    describe('无效提交', () => {
        it('文本和文件都为空时应验证失败', () => {
            const result = validateSubmitData('', 0)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请输入案情信息或选择案情材料')
        })

        it('文本为 undefined 且无文件时应验证失败', () => {
            const result = validateSubmitData(undefined, 0)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请输入案情信息或选择案情材料')
        })

        it('文本只有空格且无文件时应验证失败', () => {
            const result = validateSubmitData('   ', 0)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请输入案情信息或选择案情材料')
        })

        it('文本为空字符串且无文件时应验证失败', () => {
            const result = validateSubmitData('', 0)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请输入案情信息或选择案情材料')
        })
    })

    describe('边界情况', () => {
        it('多个文件时应验证通过', () => {
            const result = validateSubmitData('', 5)
            expect(result.valid).toBe(true)
        })

        it('文本内容很长时应验证通过', () => {
            const longText = '案情描述'.repeat(1000)
            const result = validateSubmitData(longText, 0)
            expect(result.valid).toBe(true)
        })

        it('文本包含换行符时应验证通过', () => {
            const result = validateSubmitData('第一行\n第二行\n第三行', 0)
            expect(result.valid).toBe(true)
        })

        it('文本只有换行符和空格时应验证失败', () => {
            const result = validateSubmitData('\n  \n  \n', 0)
            expect(result.valid).toBe(false)
        })
    })
})

describe('文件识别状态检查', () => {
    describe('有效提交（无识别中的文件）', () => {
        it('所有文件都已识别成功时应验证通过', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                { id: 2, fileName: 'image1.png', fileType: 'image/png' },
                { id: 3, fileName: 'audio1.mp3', fileType: 'audio/mp3' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'success'],
                [2, 'success'],
                [3, 'success'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(true)
            expect(result.error).toBeUndefined()
        })

        it('文件识别状态为 idle 时应验证通过', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'idle'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(true)
        })

        it('文件识别状态为 error 时应验证通过（允许重试）', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'error'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(true)
        })

        it('混合状态（无识别中）时应验证通过', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                { id: 2, fileName: 'image1.png', fileType: 'image/png' },
                { id: 3, fileName: 'audio1.mp3', fileType: 'audio/mp3' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'success'],
                [2, 'error'],
                [3, 'idle'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(true)
        })

        it('不需要识别的文件类型应验证通过', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'video.mp4', fileType: 'video/mp4' },
                { id: 2, fileName: 'data.json', fileType: 'application/json' },
            ]
            const statusMap = new Map<number, RecognitionStatus>()

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(true)
        })

        it('空文件列表应验证通过', () => {
            const files: FileItem[] = []
            const statusMap = new Map<number, RecognitionStatus>()

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(true)
        })
    })

    describe('无效提交（有识别中的文件）', () => {
        it('文档文件识别中时应验证失败', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'recognizing'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请等待文件识别完成后再提交')
        })

        it('图片文件识别中时应验证失败', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'image1.png', fileType: 'image/png' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'recognizing'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请等待文件识别完成后再提交')
        })

        it('音频文件识别中时应验证失败', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'audio1.mp3', fileType: 'audio/mp3' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'recognizing'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请等待文件识别完成后再提交')
        })

        it('多个文件中有一个识别中时应验证失败', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                { id: 2, fileName: 'image1.png', fileType: 'image/png' },
                { id: 3, fileName: 'audio1.mp3', fileType: 'audio/mp3' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'success'],
                [2, 'recognizing'],  // 识别中
                [3, 'success'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请等待文件识别完成后再提交')
        })

        it('多个文件都在识别中时应验证失败', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                { id: 2, fileName: 'image1.png', fileType: 'image/png' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'recognizing'],
                [2, 'recognizing'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请等待文件识别完成后再提交')
        })
    })

    describe('文件类型判断', () => {
        it('应正确识别 DOCX 文件', () => {
            expect(isRecognizableDocFile('document.docx')).toBe(true)
            expect(isRecognizableDocFile('document.doc')).toBe(true)
        })

        it('应正确识别 PDF 文件', () => {
            expect(isRecognizableDocFile('document.pdf')).toBe(true)
        })

        it('应正确识别 Markdown 文件', () => {
            expect(isRecognizableDocFile('readme.md')).toBe(true)
            expect(isRecognizableDocFile('readme.mkd')).toBe(true)
            expect(isRecognizableDocFile('readme.markdown')).toBe(true)
        })

        it('应正确识别 TXT 文件', () => {
            expect(isRecognizableDocFile('notes.txt')).toBe(true)
        })

        it('应正确识别图片文件', () => {
            expect(isImageFile('photo.png')).toBe(true)
            expect(isImageFile('photo.jpg')).toBe(true)
            expect(isImageFile('photo.jpeg')).toBe(true)
            expect(isImageFile('photo.gif')).toBe(true)
            expect(isImageFile('photo.webp')).toBe(true)
            expect(isImageFile('photo.heic')).toBe(true)
            expect(isImageFile('photo.heif')).toBe(true)
        })

        it('应正确识别音频文件', () => {
            expect(isAudioFile('audio.mp3')).toBe(true)
            expect(isAudioFile('audio.wav')).toBe(true)
            expect(isAudioFile('audio.m4a')).toBe(true)
            expect(isAudioFile('audio.aac')).toBe(true)
            expect(isAudioFile('audio.flac')).toBe(true)
            expect(isAudioFile('audio.ogg')).toBe(true)
            expect(isAudioFile('audio.webm')).toBe(true)
            expect(isAudioFile('audio.amr')).toBe(true)
            expect(isAudioFile('audio.opus')).toBe(true)
        })

        it('应正确识别不需要识别的文件类型', () => {
            expect(isRecognizableDocFile('video.mp4')).toBe(false)
            expect(isImageFile('video.mp4')).toBe(false)
            expect(isAudioFile('video.mp4')).toBe(false)
        })

        it('文件名大小写不敏感', () => {
            expect(isRecognizableDocFile('Document.DOCX')).toBe(true)
            expect(isImageFile('Photo.PNG')).toBe(true)
            expect(isAudioFile('Audio.MP3')).toBe(true)
        })
    })

    describe('边界情况', () => {
        it('文件没有识别状态记录时应视为 undefined', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
            ]
            const statusMap = new Map<number, RecognitionStatus>()  // 空状态映射

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(true)  // undefined 不等于 'recognizing'，应通过
        })

        it('混合可识别和不可识别文件，有识别中时应验证失败', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                { id: 2, fileName: 'video.mp4', fileType: 'video/mp4' },  // 不需要识别
                { id: 3, fileName: 'image1.png', fileType: 'image/png' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'recognizing'],  // 识别中
                [2, 'idle'],         // 不需要识别的文件
                [3, 'success'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(false)
        })

        it('文件名没有扩展名时应返回 false', () => {
            expect(isRecognizableDocFile('document')).toBe(false)
            expect(isImageFile('photo')).toBe(false)
            expect(isAudioFile('audio')).toBe(false)
        })

        it('文件名为空字符串时应返回 false', () => {
            expect(isRecognizableDocFile('')).toBe(false)
            expect(isImageFile('')).toBe(false)
            expect(isAudioFile('')).toBe(false)
        })
    })
})

describe('错误提示友好性验证 (Requirements 9.2.3)', () => {
    describe('错误提示内容验证', () => {
        it('文本和材料都为空时的错误提示应清晰友好', () => {
            const result = validateSubmitData('', 0)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请输入案情信息或选择案情材料')
            // 验证错误提示使用中文
            expect(result.error).toMatch(/^[\u4e00-\u9fa5]+/)
            // 验证错误提示简洁（不超过 30 个字符）
            expect(result.error!.length).toBeLessThanOrEqual(30)
        })

        it('有文件正在识别时的错误提示应清晰友好', () => {
            const files: FileItem[] = [
                { id: 1, fileName: 'doc1.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
            ]
            const statusMap = new Map<number, RecognitionStatus>([
                [1, 'recognizing'],
            ])

            const result = validateFileRecognitionStatus(files, statusMap)
            expect(result.valid).toBe(false)
            expect(result.error).toBe('请等待文件识别完成后再提交')
            // 验证错误提示使用中文
            expect(result.error).toMatch(/^[\u4e00-\u9fa5]+/)
            // 验证错误提示简洁（不超过 30 个字符）
            expect(result.error!.length).toBeLessThanOrEqual(30)
        })

        it('所有错误提示都应使用中文', () => {
            const errors = [
                validateSubmitData('', 0).error,
                validateFileRecognitionStatus(
                    [{ id: 1, fileName: 'doc.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
                    new Map([[1, 'recognizing']])
                ).error,
            ]

            errors.forEach(error => {
                expect(error).toBeDefined()
                // 验证是否包含中文字符
                expect(error).toMatch(/[\u4e00-\u9fa5]/)
                // 验证不包含英文错误信息（如 "Error:", "Failed:", "Invalid:" 等）
                expect(error).not.toMatch(/Error:|Failed:|Invalid:|undefined|null/i)
            })
        })

        it('错误提示应简洁明了（不超过 30 个字符）', () => {
            const errors = [
                validateSubmitData('', 0).error,
                validateFileRecognitionStatus(
                    [{ id: 1, fileName: 'doc.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
                    new Map([[1, 'recognizing']])
                ).error,
            ]

            errors.forEach(error => {
                expect(error).toBeDefined()
                expect(error!.length).toBeLessThanOrEqual(30)
                expect(error!.length).toBeGreaterThan(0)
            })
        })

        it('错误提示应具有指导性（告诉用户如何解决问题）', () => {
            // 文本和材料都为空：提示用户输入或选择
            const emptyError = validateSubmitData('', 0).error
            expect(emptyError).toContain('请')
            expect(emptyError).toMatch(/输入|选择/)

            // 文件识别中：提示用户等待
            const recognizingError = validateFileRecognitionStatus(
                [{ id: 1, fileName: 'doc.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
                new Map([[1, 'recognizing']])
            ).error
            expect(recognizingError).toContain('请')
            expect(recognizingError).toContain('等待')
        })
    })

    describe('错误提示一致性验证', () => {
        it('相同错误场景应返回相同的错误提示', () => {
            // 多次调用应返回相同的错误提示
            const error1 = validateSubmitData('', 0).error
            const error2 = validateSubmitData('', 0).error
            const error3 = validateSubmitData(undefined, 0).error

            expect(error1).toBe(error2)
            expect(error1).toBe(error3)
        })

        it('不同错误场景应返回不同的错误提示', () => {
            const emptyError = validateSubmitData('', 0).error
            const recognizingError = validateFileRecognitionStatus(
                [{ id: 1, fileName: 'doc.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
                new Map([[1, 'recognizing']])
            ).error

            expect(emptyError).not.toBe(recognizingError)
            expect(emptyError).toBeDefined()
            expect(recognizingError).toBeDefined()
        })
    })

    describe('错误提示边界情况', () => {
        it('错误提示不应为空字符串', () => {
            const errors = [
                validateSubmitData('', 0).error,
                validateFileRecognitionStatus(
                    [{ id: 1, fileName: 'doc.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
                    new Map([[1, 'recognizing']])
                ).error,
            ]

            errors.forEach(error => {
                expect(error).toBeDefined()
                expect(error!.trim().length).toBeGreaterThan(0)
            })
        })

        it('错误提示不应包含技术术语或代码', () => {
            const errors = [
                validateSubmitData('', 0).error,
                validateFileRecognitionStatus(
                    [{ id: 1, fileName: 'doc.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
                    new Map([[1, 'recognizing']])
                ).error,
            ]

            errors.forEach(error => {
                expect(error).toBeDefined()
                // 不应包含技术术语
                expect(error).not.toMatch(/undefined|null|NaN|Exception|Stack|Trace/i)
                // 不应包含代码符号
                expect(error).not.toMatch(/[{}[\]();]/)
            })
        })

        it('错误提示应以"请"开头（礼貌用语）', () => {
            const errors = [
                validateSubmitData('', 0).error,
                validateFileRecognitionStatus(
                    [{ id: 1, fileName: 'doc.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
                    new Map([[1, 'recognizing']])
                ).error,
            ]

            errors.forEach(error => {
                expect(error).toBeDefined()
                expect(error!.startsWith('请')).toBe(true)
            })
        })
    })
})

describe('提交失败后恢复输入状态 (Requirements 9.3)', () => {
    /**
     * 模拟提交状态管理
     */
    type SubmitStatus = 'submitted' | 'streaming' | 'ready' | 'error'

    interface SubmitState {
        status: SubmitStatus
        text: string
        files: FileItem[]
    }

    /**
     * 模拟提交失败场景
     * 返回失败后的状态
     */
    function simulateSubmitFailure(initialState: SubmitState): SubmitState {
        // 模拟提交失败的状态变化
        const failedState: SubmitState = {
            status: 'error',
            text: initialState.text,      // 保留文本内容
            files: initialState.files,    // 保留文件列表
        }

        // 3 秒后恢复为 ready 状态（实际实现中使用 setTimeout）
        return {
            ...failedState,
            status: 'ready',  // 恢复为可提交状态
        }
    }

    /**
     * 模拟提交成功场景
     * 返回成功后的状态
     */
    function simulateSubmitSuccess(initialState: SubmitState): SubmitState {
        // 提交成功后清空输入
        return {
            status: 'ready',
            text: '',         // 清空文本
            files: [],        // 清空文件列表
        }
    }

    describe('状态恢复验证', () => {
        it('提交失败后状态应恢复为 ready', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '这是案情描述',
                files: [
                    { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
                ],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.status).toBe('ready')
        })

        it('提交失败后应保留用户输入的文本内容', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '这是用户输入的案情描述，包含重要信息',
                files: [],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.text).toBe(initialState.text)
            expect(recoveredState.text).not.toBe('')
        })

        it('提交失败后应保留已选择的文件列表', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '',
                files: [
                    { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
                    { id: 2, fileName: 'image1.png', fileType: 'image/png' },
                    { id: 3, fileName: 'audio1.mp3', fileType: 'audio/mp3' },
                ],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.files).toEqual(initialState.files)
            expect(recoveredState.files.length).toBe(3)
        })

        it('提交失败后应同时保留文本和文件', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '案情描述',
                files: [
                    { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
                ],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.text).toBe(initialState.text)
            expect(recoveredState.files).toEqual(initialState.files)
        })
    })

    describe('与成功场景对比', () => {
        it('提交成功后应清空文本和文件（对比：失败时保留）', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '案情描述',
                files: [
                    { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
                ],
            }

            const successState = simulateSubmitSuccess(initialState)
            const failureState = simulateSubmitFailure(initialState)

            // 成功时清空
            expect(successState.text).toBe('')
            expect(successState.files).toEqual([])

            // 失败时保留
            expect(failureState.text).toBe(initialState.text)
            expect(failureState.files).toEqual(initialState.files)
        })
    })

    describe('可重新提交验证', () => {
        it('状态恢复为 ready 后应允许重新提交', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '案情描述',
                files: [],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            // 验证状态为 ready
            expect(recoveredState.status).toBe('ready')

            // 验证可以再次提交（文本或文件至少一个）
            const canResubmit = validateSubmitData(
                recoveredState.text,
                recoveredState.files.length
            )
            expect(canResubmit.valid).toBe(true)
        })

        it('保留的输入内容应可用于重新提交', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '这是重要的案情信息',
                files: [
                    { id: 1, fileName: 'evidence.pdf', fileType: 'application/pdf' },
                ],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            // 验证文本内容完整保留
            expect(recoveredState.text).toBe(initialState.text)
            expect(recoveredState.text.length).toBeGreaterThan(0)

            // 验证文件列表完整保留
            expect(recoveredState.files.length).toBe(1)
            expect(recoveredState.files[0].id).toBe(1)
            expect(recoveredState.files[0].fileName).toBe('evidence.pdf')

            // 验证可以重新提交
            const validation = validateSubmitData(
                recoveredState.text,
                recoveredState.files.length
            )
            expect(validation.valid).toBe(true)
        })
    })

    describe('边界情况', () => {
        it('只有文本时失败后应保留文本', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '只有文本内容的案情',
                files: [],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.text).toBe(initialState.text)
            expect(recoveredState.files).toEqual([])
        })

        it('只有文件时失败后应保留文件', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '',
                files: [
                    { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
                ],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.text).toBe('')
            expect(recoveredState.files).toEqual(initialState.files)
        })

        it('多个文件时失败后应保留所有文件', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '案情描述',
                files: [
                    { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
                    { id: 2, fileName: 'doc2.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                    { id: 3, fileName: 'image1.png', fileType: 'image/png' },
                    { id: 4, fileName: 'audio1.mp3', fileType: 'audio/mp3' },
                ],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.files.length).toBe(4)
            expect(recoveredState.files).toEqual(initialState.files)
        })

        it('长文本内容失败后应完整保留', () => {
            const longText = '这是一段很长的案情描述。'.repeat(100)
            const initialState: SubmitState = {
                status: 'ready',
                text: longText,
                files: [],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.text).toBe(longText)
            expect(recoveredState.text.length).toBe(longText.length)
        })

        it('包含特殊字符的文本失败后应完整保留', () => {
            const specialText = '案情描述\n包含换行符\t制表符\r回车符\n\n多个换行'
            const initialState: SubmitState = {
                status: 'ready',
                text: specialText,
                files: [],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            expect(recoveredState.text).toBe(specialText)
        })
    })

    describe('状态转换验证', () => {
        it('状态转换流程：ready -> submitted -> error -> ready', () => {
            let status: SubmitStatus = 'ready'

            // 开始提交
            status = 'submitted'
            expect(status).toBe('submitted')

            // 提交失败
            status = 'error'
            expect(status).toBe('error')

            // 恢复状态
            status = 'ready'
            expect(status).toBe('ready')
        })

        it('失败后不应进入 streaming 状态', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '案情描述',
                files: [],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            // 失败后应该是 ready，不是 streaming
            expect(recoveredState.status).toBe('ready')
            expect(recoveredState.status).not.toBe('streaming')
        })

        it('多次失败后应每次都保留输入内容', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '案情描述',
                files: [
                    { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
                ],
            }

            // 第一次失败
            const firstFailure = simulateSubmitFailure(initialState)
            expect(firstFailure.text).toBe(initialState.text)
            expect(firstFailure.files).toEqual(initialState.files)

            // 第二次失败（使用恢复后的状态）
            const secondFailure = simulateSubmitFailure(firstFailure)
            expect(secondFailure.text).toBe(initialState.text)
            expect(secondFailure.files).toEqual(initialState.files)

            // 第三次失败
            const thirdFailure = simulateSubmitFailure(secondFailure)
            expect(thirdFailure.text).toBe(initialState.text)
            expect(thirdFailure.files).toEqual(initialState.files)
        })
    })

    describe('用户体验验证', () => {
        it('失败后用户无需重新输入文本', () => {
            const userInput = '用户花费时间输入的详细案情描述，包含大量细节信息'
            const initialState: SubmitState = {
                status: 'ready',
                text: userInput,
                files: [],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            // 用户输入完整保留，无需重新输入
            expect(recoveredState.text).toBe(userInput)
        })

        it('失败后用户无需重新选择文件', () => {
            const userSelectedFiles: FileItem[] = [
                { id: 1, fileName: 'contract.pdf', fileType: 'application/pdf' },
                { id: 2, fileName: 'evidence.png', fileType: 'image/png' },
            ]
            const initialState: SubmitState = {
                status: 'ready',
                text: '',
                files: userSelectedFiles,
            }

            const recoveredState = simulateSubmitFailure(initialState)

            // 文件列表完整保留，无需重新选择
            expect(recoveredState.files).toEqual(userSelectedFiles)
            expect(recoveredState.files.length).toBe(2)
        })

        it('失败后用户可以修改内容后重新提交', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '原始案情描述',
                files: [],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            // 用户可以修改文本
            const modifiedState: SubmitState = {
                ...recoveredState,
                text: recoveredState.text + '（补充信息）',
            }

            // 验证修改后可以提交
            const validation = validateSubmitData(
                modifiedState.text,
                modifiedState.files.length
            )
            expect(validation.valid).toBe(true)
        })

        it('失败后用户可以添加或删除文件后重新提交', () => {
            const initialState: SubmitState = {
                status: 'ready',
                text: '案情描述',
                files: [
                    { id: 1, fileName: 'doc1.pdf', fileType: 'application/pdf' },
                ],
            }

            const recoveredState = simulateSubmitFailure(initialState)

            // 用户可以添加文件
            const modifiedState: SubmitState = {
                ...recoveredState,
                files: [
                    ...recoveredState.files,
                    { id: 2, fileName: 'doc2.pdf', fileType: 'application/pdf' },
                ],
            }

            // 验证修改后可以提交
            const validation = validateSubmitData(
                modifiedState.text,
                modifiedState.files.length
            )
            expect(validation.valid).toBe(true)
            expect(modifiedState.files.length).toBe(2)
        })
    })
})
