/**
 * 图片压缩工具测试
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { compressImage, compressImageFromBase64 } from '../../../server/utils/imageCompression'
import sharp from 'sharp'

describe('图片压缩工具', () => {
    let largeImageBuffer: Buffer
    let smallImageBuffer: Buffer

    beforeAll(async () => {
        // 创建一个大图片（使用 JPEG 格式，更容易超过 10MB）
        largeImageBuffer = await sharp({
            create: {
                width: 5000,
                height: 5000,
                channels: 3,
                background: { r: 255, g: 0, b: 0 },
            },
        })
            .jpeg({ quality: 100 })
            .toBuffer()

        // 创建一个小图片（小于 10MB）
        smallImageBuffer = await sharp({
            create: {
                width: 500,
                height: 500,
                channels: 4,
                background: { r: 0, g: 255, b: 0, alpha: 1 },
            },
        })
            .png()
            .toBuffer()
    })

    describe('compressImage', () => {
        it('应该压缩超过限制的大图片', async () => {
            const maxSize = 5 * 1024 * 1024 // 5MB - 使用更小的限制

            const result = await compressImage(largeImageBuffer, 'image/jpeg', {
                maxSizeBytes: maxSize,
            })

            // 压缩后应该小于限制
            expect(result.buffer.length).toBeLessThanOrEqual(maxSize)
            // 应该返回有效的 MIME 类型
            expect(result.mimeType).toMatch(/^image\/(png|jpeg|webp)$/)
        })

        it('应该保持小于限制的图片不变', async () => {
            const maxSize = 10 * 1024 * 1024 // 10MB

            // 确保测试图片小于限制
            expect(smallImageBuffer.length).toBeLessThan(maxSize)

            const result = await compressImage(smallImageBuffer, 'image/png', {
                maxSizeBytes: maxSize,
            })

            // 应该返回原始图片
            expect(result.buffer).toEqual(smallImageBuffer)
            expect(result.mimeType).toBe('image/png')
        })

        it('应该正确处理 JPEG 格式', async () => {
            const jpegBuffer = await sharp({
                create: {
                    width: 3000,
                    height: 3000,
                    channels: 3,
                    background: { r: 255, g: 255, b: 0 },
                },
            })
                .jpeg()
                .toBuffer()

            const result = await compressImage(jpegBuffer, 'image/jpeg', {
                maxSizeBytes: 5 * 1024 * 1024, // 5MB
            })

            expect(result.buffer.length).toBeLessThanOrEqual(5 * 1024 * 1024)
            expect(result.mimeType).toBe('image/jpeg')
        })

        it('应该在首次压缩不足时降低质量重试', async () => {
            // 创建一个非常大的图片
            const veryLargeBuffer = await sharp({
                create: {
                    width: 5000,
                    height: 5000,
                    channels: 4,
                    background: { r: 255, g: 255, b: 255, alpha: 1 },
                },
            })
                .png()
                .toBuffer()

            const result = await compressImage(veryLargeBuffer, 'image/png', {
                maxSizeBytes: 2 * 1024 * 1024, // 2MB - 很小的限制
                quality: 90,
            })

            // 应该成功压缩到限制以下
            expect(result.buffer.length).toBeLessThanOrEqual(2 * 1024 * 1024)
        })
    })

    describe('compressImageFromBase64', () => {
        it('应该正确处理 base64 图片', async () => {
            const base64Data = largeImageBuffer.toString('base64')
            const maxSize = 5 * 1024 * 1024 // 5MB

            const result = await compressImageFromBase64(base64Data, 'image/jpeg', {
                maxSizeBytes: maxSize,
            })

            // 解码 base64 检查大小
            const decodedBuffer = Buffer.from(result.base64Data, 'base64')
            expect(decodedBuffer.length).toBeLessThanOrEqual(maxSize)
            expect(result.mimeType).toMatch(/^image\/(png|jpeg|webp)$/)
        })

        it('应该保持小图片的 base64 不变', async () => {
            const base64Data = smallImageBuffer.toString('base64')
            const maxSize = 10 * 1024 * 1024 // 10MB

            const result = await compressImageFromBase64(base64Data, 'image/png', {
                maxSizeBytes: maxSize,
            })

            // 应该返回原始 base64
            expect(result.base64Data).toBe(base64Data)
            expect(result.mimeType).toBe('image/png')
        })
    })

    describe('边界情况', () => {
        it('应该处理自定义压缩选项', async () => {
            const result = await compressImage(largeImageBuffer, 'image/png', {
                maxSizeBytes: 5 * 1024 * 1024, // 5MB
                maxWidth: 1024,
                maxHeight: 1024,
                quality: 70,
            })

            expect(result.buffer.length).toBeLessThanOrEqual(5 * 1024 * 1024)

            // 验证尺寸
            const metadata = await sharp(result.buffer).metadata()
            expect(metadata.width).toBeLessThanOrEqual(1024)
            expect(metadata.height).toBeLessThanOrEqual(1024)
        })

        it('应该保持图片宽高比', async () => {
            // 创建一个宽图片
            const wideBuffer = await sharp({
                create: {
                    width: 4000,
                    height: 2000,
                    channels: 3,
                    background: { r: 100, g: 100, b: 100 },
                },
            })
                .jpeg()
                .toBuffer()

            const result = await compressImage(wideBuffer, 'image/jpeg', {
                maxWidth: 1024,
                maxHeight: 1024,
            })

            const metadata = await sharp(result.buffer).metadata()
            // 宽度应该被限制，高度应该按比例缩放
            expect(metadata.width).toBeLessThanOrEqual(1024)
            expect(metadata.height).toBeLessThanOrEqual(512) // 大约是 1024 * (2000/4000)
        })

        it('应该处理损坏的图片数据并尝试转换', async () => {
            // 创建一个无效的 buffer（模拟不支持的格式）
            const invalidBuffer = Buffer.from('invalid image data')

            // 应该抛出错误
            await expect(
                compressImage(invalidBuffer, 'image/unknown', {
                    maxSizeBytes: 5 * 1024 * 1024,
                })
            ).rejects.toThrow('不支持的图片格式')
        })
    })
})
