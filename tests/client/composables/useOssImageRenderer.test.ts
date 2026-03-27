/**
 * useOssImageRenderer OSS 图片渲染测试
 *
 * 测试图片占位符解析功能
 *
 * **Feature: oss-image-renderer-composable**
 * **Validates: 图片占位符解析功能**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// 导入待测试的 composable
const { useOssImageRenderer } = await import('~/composables/useOssImageRenderer')

describe('useOssImageRenderer parseImagePlaceholders 测试', () => {
    it('无占位符内容应返回空数组', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        expect(parseImagePlaceholders('普通文本内容')).toEqual([])
    })

    it('空字符串应返回空数组', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        expect(parseImagePlaceholders('')).toEqual([])
    })

    it('单个占位符应正确解析', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        const result = parseImagePlaceholders('图片: {{OSS_IMAGE:bucket1:123}}')

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
            placeholder: '{{OSS_IMAGE:bucket1:123}}',
            bucket: 'bucket1',
            ossFileId: 123,
        })
    })

    it('多个占位符应全部解析', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        const content = '图片1: {{OSS_IMAGE:bucket1:100}} 和图片2: {{OSS_IMAGE:bucket2:200}}'
        const result = parseImagePlaceholders(content)

        expect(result).toHaveLength(2)
        expect(result[0].ossFileId).toBe(100)
        expect(result[0].bucket).toBe('bucket1')
        expect(result[1].ossFileId).toBe(200)
        expect(result[1].bucket).toBe('bucket2')
    })

    it('重复占位符应去重', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        const content = '图片1: {{OSS_IMAGE:bucket1:100}} 和图片2: {{OSS_IMAGE:bucket1:100}}'
        const result = parseImagePlaceholders(content)

        expect(result).toHaveLength(1)
        expect(result[0].ossFileId).toBe(100)
    })

    it('相同 bucket 不同 ossFileId 不应去重', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        const content = '图片1: {{OSS_IMAGE:bucket1:100}} 和图片2: {{OSS_IMAGE:bucket1:200}}'
        const result = parseImagePlaceholders(content)

        expect(result).toHaveLength(2)
    })

    it('相同 ossFileId 不同 bucket 不应去重', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        const content = '图片1: {{OSS_IMAGE:bucket1:100}} 和图片2: {{OSS_IMAGE:bucket2:100}}'
        const result = parseImagePlaceholders(content)

        expect(result).toHaveLength(2)
    })

    it('占位符之间有其他文本应正确解析', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        const content = '{{OSS_IMAGE:img:1}} 这是一段文字 {{OSS_IMAGE:img:2}} 更多文字'
        const result = parseImagePlaceholders(content)

        expect(result).toHaveLength(2)
        expect(result[0].ossFileId).toBe(1)
        expect(result[1].ossFileId).toBe(2)
    })

    it('占位符在内容末尾应正确解析', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        const result = parseImagePlaceholders('内容 {{OSS_IMAGE:mybucket:999}}')

        expect(result).toHaveLength(1)
        expect(result[0].ossFileId).toBe(999)
        expect(result[0].bucket).toBe('mybucket')
    })

    it('占位符在内容开头应正确解析', () => {
        const { parseImagePlaceholders } = useOssImageRenderer()
        const result = parseImagePlaceholders('{{OSS_IMAGE:startbucket:1}} 后续内容')

        expect(result).toHaveLength(1)
        expect(result[0].bucket).toBe('startbucket')
    })

    it('FALLBACK_IMAGE 常量应存在', () => {
        const { FALLBACK_IMAGE } = useOssImageRenderer()
        expect(FALLBACK_IMAGE).toBeTruthy()
        expect(FALLBACK_IMAGE).toContain('data:image/svg+xml')
    })

    it('属性测试：占位符应正确解析', () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('}') && !s.includes('{') && !s.includes(':')),
                fc.integer({ min: 1, max: 10000 }),
                (bucket, ossFileId) => {
                    const { parseImagePlaceholders } = useOssImageRenderer()
                    const content = `{{OSS_IMAGE:${bucket}:${ossFileId}}}`
                    const result = parseImagePlaceholders(content)

                    expect(result).toHaveLength(1)
                    expect(result[0].bucket).toBe(bucket)
                    expect(result[0].ossFileId).toBe(ossFileId)
                }
            ),
            { numRuns: 100, seed: 12345 }
        )
    })

    it('属性测试：无占位符内容应返回空数组', () => {
        fc.assert(
            fc.property(
                fc.string().filter(s => !s.includes('OSS_IMAGE')),
                (content) => {
                    const { parseImagePlaceholders } = useOssImageRenderer()
                    const result = parseImagePlaceholders(content)
                    expect(result).toEqual([])
                }
            ),
            { numRuns: 50, seed: 12345 }
        )
    })
})

describe('useOssImageRenderer clearCache 测试', () => {
    it('clearCache 不应报错', () => {
        const { clearCache } = useOssImageRenderer()
        expect(() => clearCache()).not.toThrow()
    })
})
