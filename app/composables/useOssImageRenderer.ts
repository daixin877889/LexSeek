/**
 * OSS 图片渲染 Composable
 *
 * 解析识别结果中的图片占位符，批量获取签名 URL 并替换
 * 占位符格式：{{OSS_IMAGE:bucket:ossFileId}}
 *
 * @requirements 7.1, 7.2, 7.3, 7.4
 */

/** 图片占位符正则表达式 */
const IMAGE_PLACEHOLDER_REGEX = /\{\{OSS_IMAGE:([^:}]+):(\d+)\}\}/g

/** 图片加载失败的占位图 */
const FALLBACK_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNFNUU3RUIiLz48cGF0aCBkPSJNNDAgNDBINjBWNjBINDBWNDBaIiBmaWxsPSIjOUI5QjlCIi8+PHBhdGggZD0iTTM1IDY1TDQ1IDU1TDUwIDYwTDYwIDUwTDY1IDU1VjY1SDM1WiIgZmlsbD0iIzlCOUI5QiIvPjwvc3ZnPg=='

/**
 * 图片占位符信息
 */
export interface ImagePlaceholder {
    /** 完整占位符字符串 */
    placeholder: string
    /** bucket 名称 */
    bucket: string
    /** OSS 文件 ID */
    ossFileId: number
}

/**
 * 批量签名 URL 响应
 */
interface BatchImageSignedUrlResponse {
    urls: Record<string, string>
    failed: Array<{
        bucket: string
        ossFileId: number
        error: string
    }>
}

/**
 * OSS 图片渲染 Composable
 */
export const useOssImageRenderer = () => {
    // 签名 URL 缓存（避免重复请求）
    const urlCache = new Map<string, string>()

    /**
     * 解析内容中的所有图片占位符
     * @param content 包含占位符的内容
     * @returns 占位符列表
     */
    const parseImagePlaceholders = (content: string): ImagePlaceholder[] => {
        const placeholders: ImagePlaceholder[] = []
        const seen = new Set<string>()

        let match
        // 重置正则表达式的 lastIndex
        IMAGE_PLACEHOLDER_REGEX.lastIndex = 0

        while ((match = IMAGE_PLACEHOLDER_REGEX.exec(content)) !== null) {
            const placeholder = match[0]
            const bucket = match[1]!
            const ossFileId = parseInt(match[2]!, 10)

            // 去重
            const key = `${bucket}:${ossFileId}`
            if (!seen.has(key)) {
                seen.add(key)
                placeholders.push({
                    placeholder,
                    bucket,
                    ossFileId,
                })
            }
        }

        return placeholders
    }

    /**
     * 批量获取图片签名 URL
     * @param placeholders 占位符列表
     * @returns bucket:ossFileId 到 URL 的映射
     */
    const getSignedUrls = async (
        placeholders: ImagePlaceholder[]
    ): Promise<Map<string, string>> => {
        const result = new Map<string, string>()

        if (placeholders.length === 0) {
            return result
        }

        // 过滤出未缓存的占位符
        const uncachedPlaceholders = placeholders.filter(p => {
            const key = `${p.bucket}:${p.ossFileId}`
            const cached = urlCache.get(key)
            if (cached) {
                result.set(key, cached)
                return false
            }
            return true
        })

        if (uncachedPlaceholders.length === 0) {
            return result
        }

        try {
            // 调用批量签名 API
            const response = await useApiFetch<BatchImageSignedUrlResponse>(
                '/api/v1/oss/image-signed-urls',
                {
                    method: 'POST',
                    body: {
                        images: uncachedPlaceholders.map(p => ({
                            bucket: p.bucket,
                            ossFileId: p.ossFileId,
                        })),
                    },
                    showError: false,
                }
            )

            if (response?.urls) {
                // 缓存并返回结果
                for (const [key, url] of Object.entries(response.urls)) {
                    urlCache.set(key, url)
                    result.set(key, url)
                }
            }

            // 处理失败的图片，使用占位图
            if (response?.failed) {
                for (const item of response.failed) {
                    const key = `${item.bucket}:${item.ossFileId}`
                    result.set(key, FALLBACK_IMAGE)
                }
            }
        } catch (error) {
            console.error('获取图片签名 URL 失败:', error)
            // 所有图片使用占位图
            for (const p of uncachedPlaceholders) {
                const key = `${p.bucket}:${p.ossFileId}`
                result.set(key, FALLBACK_IMAGE)
            }
        }

        return result
    }

    /**
     * 渲染内容，替换占位符为实际 URL
     * @param content 包含占位符的内容
     * @returns 替换后的内容
     */
    const renderContent = async (content: string): Promise<string> => {
        // 解析占位符
        const placeholders = parseImagePlaceholders(content)

        if (placeholders.length === 0) {
            return content
        }

        // 获取签名 URL
        const urlMap = await getSignedUrls(placeholders)

        // 替换占位符
        let result = content
        for (const p of placeholders) {
            const key = `${p.bucket}:${p.ossFileId}`
            const url = urlMap.get(key) || FALLBACK_IMAGE
            result = result.replaceAll(p.placeholder, url)
        }

        return result
    }

    /**
     * 清除 URL 缓存
     */
    const clearCache = () => {
        urlCache.clear()
    }

    /**
     * 获取单个图片的签名 URL
     * @param bucket bucket 名称
     * @param ossFileId OSS 文件 ID
     * @returns 签名 URL 或占位图
     */
    const getImageUrl = async (bucket: string, ossFileId: number): Promise<string> => {
        const key = `${bucket}:${ossFileId}`

        // 检查缓存
        const cached = urlCache.get(key)
        if (cached) {
            return cached
        }

        // 获取签名 URL
        const urlMap = await getSignedUrls([{ placeholder: '', bucket, ossFileId }])
        return urlMap.get(key) || FALLBACK_IMAGE
    }

    return {
        parseImagePlaceholders,
        getSignedUrls,
        renderContent,
        clearCache,
        getImageUrl,
        FALLBACK_IMAGE,
    }
}
