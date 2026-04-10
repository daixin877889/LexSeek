/**
 * 图片压缩工具补充覆盖率测试
 *
 * 覆盖 compressImageFromUrl 和 compressImageFromBase64 的错误路径
 *
 * **Feature: utilities**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import { compressImageFromUrl, compressImageFromBase64, compressImage } from '../../../server/utils/imageCompression'

describe('图片压缩工具 补充覆盖率', () => {
    describe('compressImageFromUrl', () => {
        beforeEach(() => {
            vi.restoreAllMocks()
        })

        it('应从 URL 下载并压缩图片', async () => {
            // 创建测试图片
            const testBuffer = await sharp({
                create: {
                    width: 500,
                    height: 500,
                    channels: 3,
                    background: { r: 255, g: 0, b: 0 },
                },
            }).jpeg({ quality: 90 }).toBuffer()

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({ 'content-type': 'image/jpeg' }),
                arrayBuffer: () => Promise.resolve(testBuffer.buffer.slice(
                    testBuffer.byteOffset,
                    testBuffer.byteOffset + testBuffer.byteLength,
                )),
            }))

            const result = await compressImageFromUrl('https://example.com/image.jpg')
            expect(result.buffer).toBeDefined()
            expect(result.mimeType).toMatch(/^image\//)
        })

        it('HTTP 错误应抛出异常', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
            }))

            await expect(
                compressImageFromUrl('https://example.com/not-found.jpg'),
            ).rejects.toThrow('从 URL 下载并压缩图片失败')
        })

        it('fetch 失败应抛出异常', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('网络错误')))

            await expect(
                compressImageFromUrl('https://example.com/image.jpg'),
            ).rejects.toThrow('从 URL 下载并压缩图片失败')
        })

        it('无 content-type 头应默认使用 image/jpeg', async () => {
            const testBuffer = await sharp({
                create: {
                    width: 100,
                    height: 100,
                    channels: 3,
                    background: { r: 0, g: 0, b: 255 },
                },
            }).jpeg({ quality: 50 }).toBuffer()

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers(), // 无 content-type
                arrayBuffer: () => Promise.resolve(testBuffer.buffer.slice(
                    testBuffer.byteOffset,
                    testBuffer.byteOffset + testBuffer.byteLength,
                )),
            }))

            const result = await compressImageFromUrl('https://example.com/image')
            expect(result.mimeType).toBe('image/jpeg')
        })
    })

    describe('compressImageFromBase64 补充', () => {
        it('带空白字符的 base64 应正确清理后处理', async () => {
            const testBuffer = await sharp({
                create: {
                    width: 100,
                    height: 100,
                    channels: 3,
                    background: { r: 255, g: 0, b: 0 },
                },
            }).jpeg({ quality: 50 }).toBuffer()

            // 添加空格和换行
            const base64WithWhitespace = testBuffer.toString('base64')
                .replace(/(.{20})/g, '$1\n')

            const result = await compressImageFromBase64(
                base64WithWhitespace,
                'image/jpeg',
            )
            expect(result.base64Data).toBeDefined()
            expect(result.mimeType).toMatch(/^image\//)
        })
    })

    describe('compressImage - PNG 格式处理', () => {
        it('应正确压缩超尺寸的 PNG 图片', async () => {
            const pngBuffer = await sharp({
                create: {
                    width: 3000,
                    height: 3000,
                    channels: 4,
                    background: { r: 0, g: 255, b: 0, alpha: 1 },
                },
            }).png().toBuffer()

            const result = await compressImage(pngBuffer, 'image/png', {
                maxWidth: 1024,
                maxHeight: 1024,
            })

            const metadata = await sharp(result.buffer).metadata()
            expect(metadata.width).toBeLessThanOrEqual(1024)
            expect(metadata.height).toBeLessThanOrEqual(1024)
            expect(result.mimeType).toBe('image/png')
        })
    })
})
