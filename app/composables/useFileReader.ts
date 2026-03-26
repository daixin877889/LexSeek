/**
 * 文件读取 Composable
 *
 * 提供浏览器端文件内容读取功能，支持：
 * - md/txt 文件：直接读取文本内容
 * - docx/doc 文件：使用 mammoth.js 提取文本内容和 HTML 内容
 *
 * @requirements 3.6, 3.7, 2.1, 2.2, 2.3, 2.4
 */

import mammoth from 'mammoth'
import TurndownService from 'turndown'
import { marked } from 'marked'
import { getExtensionFromFileName } from '~~/shared/utils/file'

/**
 * 文件读取状态
 */
export type FileReadStatus = 'idle' | 'reading' | 'success' | 'error'

/**
 * 文件读取结果
 */
export interface FileReadResult {
    /** 文件内容（纯文本） */
    content: string
    /** 文件名 */
    fileName: string
    /** 文件类型 */
    fileType: string
    /** 文件大小（字节） */
    fileSize: number
}

/**
 * 提取的图片信息
 */
export interface ExtractedImage {
    /** 图片 base64 数据（不含 data:xxx;base64, 前缀） */
    base64: string
    /** 图片 MIME 类型 */
    mimeType: string
    /** 图片替代文本 */
    altText?: string
    /** 图片在内容中的占位符 ID */
    placeholderId: string
}

/**
 * docx 文件提取结果
 */
export interface DocxExtractResult {
    /** 纯文本内容 */
    text: string
    /** HTML 内容（图片已替换为占位符） */
    html: string
    /** Markdown 内容（图片已替换为占位符） */
    markdown: string
    /** 提取的图片列表 */
    images: ExtractedImage[]
}

/**
 * Markdown 文件提取结果
 */
export interface MarkdownExtractResult {
    /** 原始 Markdown 内容 */
    originalContent: string
    /** 处理后的 Markdown 内容（图片已替换为占位符） */
    markdown: string
    /** HTML 内容（从 Markdown 转换） */
    html: string
    /** 提取的图片列表（包含 base64 和远程 URL 图片） */
    images: ExtractedImage[]
}

/**
 * 支持的文件类型
 */
const SUPPORTED_TEXT_EXTENSIONS = ['md', 'mkd', 'txt']
const SUPPORTED_DOC_EXTENSIONS = ['docx', 'doc']
const ALL_SUPPORTED_EXTENSIONS = [...SUPPORTED_TEXT_EXTENSIONS, ...SUPPORTED_DOC_EXTENSIONS]

/**
 * 检查文件是否支持读取
 */
export const isSupportedFileType = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return ALL_SUPPORTED_EXTENSIONS.includes(ext)
}

/**
 * 检查是否为文本文件（md/txt）
 */
export const isTextFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return SUPPORTED_TEXT_EXTENSIONS.includes(ext)
}

/**
 * 检查是否为 Word 文档（docx/doc）
 */
export const isWordFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return SUPPORTED_DOC_EXTENSIONS.includes(ext)
}

/**
 * 读取文本文件内容（md/txt）
 */
const readTextFile = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            resolve(reader.result as string)
        }
        reader.onerror = () => {
            reject(new Error(`读取文件失败: ${file.name}`))
        }
        reader.readAsText(file, 'utf-8')
    })
}

/**
 * 读取 Word 文档内容（docx/doc）
 * 使用 mammoth.js 提取纯文本
 */
const readWordFile = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (mammoth as any).extractRawText({ arrayBuffer })

    if (result.messages.length > 0) {
        // 记录警告信息但不阻止处理
        console.warn('mammoth 处理警告:', result.messages)
    }

    return result.value
}

/**
 * 生成图片占位符 ID
 */
const generateImagePlaceholderId = (): string => {
    return `IMG_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * 从 URL 推断图片 MIME 类型
 */
const inferMimeTypeFromUrl = (url: string): string => {
    const ext = url.split('.').pop()?.toLowerCase().split('?')[0] || ''
    const mimeMap: Record<string, string> = {
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'bmp': 'image/bmp',
        'ico': 'image/x-icon',
    }
    return mimeMap[ext] || 'image/png'
}

/**
 * 使用 Canvas 方式下载图片（需要图片支持跨域）
 * @param url 图片 URL
 * @returns base64 数据和 MIME 类型，失败返回 null
 */
const downloadImageViaCanvas = (url: string): Promise<{ base64: string; mimeType: string } | null> => {
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous' // 尝试跨域请求

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas')
                canvas.width = img.naturalWidth
                canvas.height = img.naturalHeight

                const ctx = canvas.getContext('2d')
                if (!ctx) {
                    resolve(null)
                    return
                }

                ctx.drawImage(img, 0, 0)

                // 尝试导出为 base64
                const mimeType = inferMimeTypeFromUrl(url)
                const dataUrl = canvas.toDataURL(mimeType)
                const base64 = dataUrl.split(',')[1] || ''

                resolve({ base64, mimeType })
            } catch {
                // Canvas 被污染（tainted），无法导出
                resolve(null)
            }
        }

        img.onerror = () => resolve(null)

        // 添加时间戳避免缓存问题
        img.src = url.includes('?') ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`

        // 设置超时
        setTimeout(() => resolve(null), 10000)
    })
}

/**
 * 下载远程图片并转换为 base64
 * 优先尝试 Canvas 方式，失败后通过服务端代理
 * @param url 图片 URL
 * @returns base64 数据和 MIME 类型，失败返回 null
 */
const downloadImageAsBase64 = async (url: string): Promise<{ base64: string; mimeType: string } | null> => {
    // 方案1：尝试 Canvas 方式（需要图片服务器支持 CORS）
    const canvasResult = await downloadImageViaCanvas(url)
    if (canvasResult) {
        return canvasResult
    }

    // 方案2：尝试直接 fetch（某些图片可能允许跨域）
    try {
        const response = await fetch(url, { mode: 'cors' })
        if (response.ok) {
            const blob = await response.blob()
            const mimeType = blob.type || inferMimeTypeFromUrl(url)

            return new Promise((resolve) => {
                const reader = new FileReader()
                reader.onloadend = () => {
                    const dataUrl = reader.result as string
                    const base64 = dataUrl.split(',')[1] || ''
                    resolve({ base64, mimeType })
                }
                reader.onerror = () => resolve(null)
                reader.readAsDataURL(blob)
            })
        }
    } catch {
        // fetch 失败，继续尝试服务端代理
    }

    // 方案3：通过服务端代理下载
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const proxyResponse = await ($fetch as any)(
            '/api/v1/proxy/image',
            {
                method: 'POST',
                body: { url },
            }
        ) as { code: number; data?: { base64: string; mimeType: string } }

        if (proxyResponse?.code === 0 && proxyResponse.data) {
            return {
                base64: proxyResponse.data.base64,
                mimeType: proxyResponse.data.mimeType,
            }
        }
    } catch (error) {
        console.warn(`通过代理下载图片失败: ${url}`, error)
    }

    return null
}

/**
 * 解析 base64 图片数据
 * @param dataUrl data:xxx;base64,xxx 格式的字符串
 * @returns base64 数据和 MIME 类型
 */
const parseBase64Image = (dataUrl: string): { base64: string; mimeType: string } | null => {
    // 匹配 data:image/xxx;base64,xxx 格式
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (match) {
        return {
            mimeType: match[1] || 'image/png',
            base64: match[2] || '',
        }
    }
    return null
}

/**
 * 提取 Markdown 文件中的图片并替换为占位符
 * 支持两种图片格式：
 * 1. 远程 URL 图片：![alt](https://example.com/image.png) - 尝试下载，失败则保留原 URL
 * 2. Base64 图片：![alt](data:image/png;base64,xxx)
 *
 * @param content Markdown 文件内容
 * @returns 提取结果，包含处理后的 Markdown 和图片列表
 */
const extractMarkdownImages = async (content: string): Promise<Omit<MarkdownExtractResult, 'html'>> => {
    const images: ExtractedImage[] = []
    let processedContent = content

    // 匹配 Markdown 图片语法：![alt](url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    const matches = [...content.matchAll(imageRegex)]

    // 用于存储替换映射
    const replacements: Array<{ original: string; placeholder: string }> = []

    // 并行处理所有图片
    await Promise.all(matches.map(async (match) => {
        const [fullMatch, altText, imageUrl] = match
        if (!imageUrl) return

        const trimmedUrl = imageUrl.trim()
        let imageData: { base64: string; mimeType: string } | null = null

        // 判断是 base64 还是远程 URL
        if (trimmedUrl.startsWith('data:')) {
            // Base64 图片，直接解析
            imageData = parseBase64Image(trimmedUrl)
        } else if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
            // 远程 URL 图片，尝试下载
            // 注意：由于跨域限制，某些图片可能无法下载
            imageData = await downloadImageAsBase64(trimmedUrl)
        }

        // 只有成功获取到图片数据才进行替换
        if (imageData && imageData.base64) {
            const placeholderId = generateImagePlaceholderId()

            images.push({
                base64: imageData.base64,
                mimeType: imageData.mimeType,
                altText: altText || undefined,
                placeholderId,
            })

            replacements.push({
                original: fullMatch!,
                placeholder: `![${altText || ''}]({{IMAGE_PLACEHOLDER:${placeholderId}}})`,
            })
        }
        // 如果下载失败，保留原始 URL，不进行替换
    }))

    // 按原始字符串长度降序排序，避免替换冲突
    replacements.sort((a, b) => b.original.length - a.original.length)

    // 执行替换
    for (const { original, placeholder } of replacements) {
        processedContent = processedContent.replace(original, placeholder)
    }

    return {
        originalContent: content,
        markdown: processedContent,
        images,
    }
}

/**
 * 提取 docx 文件内容（HTML、Markdown 和图片）
 * 使用 mammoth.js 提取 HTML，并将图片替换为占位符
 * @param fileOrBuffer 文件对象或 ArrayBuffer
 * @returns 提取结果，包含 HTML、Markdown 和图片列表
 */
const extractDocxContent = async (fileOrBuffer: File | ArrayBuffer): Promise<DocxExtractResult> => {
    const arrayBuffer = fileOrBuffer instanceof File
        ? await fileOrBuffer.arrayBuffer()
        : fileOrBuffer

    // 存储提取的图片
    const images: ExtractedImage[] = []

    // 配置 mammoth 的图片转换器，将图片替换为占位符
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        convertImage: (mammoth as any).images.imgElement((image: any) => {
            return image.read('base64').then((base64Data: any) => {
                const placeholderId = generateImagePlaceholderId()
                const mimeType = image.contentType || 'image/png'

                // 保存图片信息
                images.push({
                    base64: base64Data,
                    mimeType,
                    placeholderId,
                })

                // 返回带占位符的 img 标签，后续会被替换
                return {
                    src: `{{IMAGE_PLACEHOLDER:${placeholderId}}}`,
                }
            })
        }),
    }

    // 提取 HTML 内容
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const htmlResult = await (mammoth as any).convertToHtml({ arrayBuffer }, options)

    if (htmlResult.messages.length > 0) {
        console.warn('mammoth HTML 转换警告:', htmlResult.messages)
    }

    // 提取纯文本内容
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textResult = await (mammoth as any).extractRawText({ arrayBuffer })

    // 将 HTML 转换为 Markdown
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
    })

    // 自定义图片规则，保留占位符格式
    turndownService.addRule('imagePlaceholder', {
        filter: (node) => {
            return node.nodeName === 'IMG' &&
                (node as HTMLImageElement).src.startsWith('{{IMAGE_PLACEHOLDER:')
        },
        replacement: (_content, node) => {
            const src = (node as HTMLImageElement).src
            const alt = (node as HTMLImageElement).alt || ''
            // 转换为 Markdown 图片格式，保留占位符
            return `![${alt}](${src})`
        },
    })

    const markdown = turndownService.turndown(htmlResult.value)

    return {
        text: textResult.value,
        html: htmlResult.value,
        markdown,
        images,
    }
}

/**
 * 文件读取 Composable
 */
export const useFileReader = () => {
    // 响应式状态
    const status = ref<FileReadStatus>('idle')
    const progress = ref(0)
    const error = ref<Error | null>(null)
    const result = ref<FileReadResult | null>(null)

    /**
     * 读取单个文件内容
     * @param file 要读取的文件
     * @returns 文件读取结果
     */
    const readFile = async (file: File): Promise<FileReadResult> => {
        status.value = 'reading'
        progress.value = 0
        error.value = null
        result.value = null

        try {
            const ext = getExtensionFromFileName(file.name)

            // 检查文件类型是否支持
            if (!ALL_SUPPORTED_EXTENSIONS.includes(ext)) {
                throw new Error(`不支持的文件类型: ${ext}，支持的类型: ${ALL_SUPPORTED_EXTENSIONS.join(', ')}`)
            }

            progress.value = 30

            let content: string

            if (SUPPORTED_TEXT_EXTENSIONS.includes(ext)) {
                // 文本文件直接读取
                content = await readTextFile(file)
            } else if (SUPPORTED_DOC_EXTENSIONS.includes(ext)) {
                // Word 文档使用 mammoth 提取
                content = await readWordFile(file)
            } else {
                throw new Error(`未知的文件类型: ${ext}`)
            }

            progress.value = 100

            const readResult: FileReadResult = {
                content,
                fileName: file.name,
                fileType: ext,
                fileSize: file.size,
            }

            result.value = readResult
            status.value = 'success'

            return readResult
        } catch (e) {
            error.value = e instanceof Error ? e : new Error(String(e))
            status.value = 'error'
            throw e
        }
    }

    /**
     * 批量读取多个文件内容
     * @param files 要读取的文件列表
     * @returns 文件读取结果列表
     */
    const readFiles = async (files: File[]): Promise<FileReadResult[]> => {
        status.value = 'reading'
        progress.value = 0
        error.value = null

        const results: FileReadResult[] = []
        const total = files.length

        try {
            for (let i = 0; i < total; i++) {
                const file = files[i]!
                const ext = getExtensionFromFileName(file.name)

                // 检查文件类型是否支持
                if (!ALL_SUPPORTED_EXTENSIONS.includes(ext)) {
                    throw new Error(`不支持的文件类型: ${ext}，文件: ${file.name}`)
                }

                let content: string

                if (SUPPORTED_TEXT_EXTENSIONS.includes(ext)) {
                    content = await readTextFile(file)
                } else if (SUPPORTED_DOC_EXTENSIONS.includes(ext)) {
                    content = await readWordFile(file)
                } else {
                    throw new Error(`未知的文件类型: ${ext}`)
                }

                results.push({
                    content,
                    fileName: file.name,
                    fileType: ext,
                    fileSize: file.size,
                })

                // 更新进度
                progress.value = Math.round(((i + 1) / total) * 100)
            }

            status.value = 'success'
            return results
        } catch (e) {
            error.value = e instanceof Error ? e : new Error(String(e))
            status.value = 'error'
            throw e
        }
    }

    /**
     * 重置状态
     */
    const reset = () => {
        status.value = 'idle'
        progress.value = 0
        error.value = null
        result.value = null
    }

    /**
     * 提取 docx 文件内容（HTML、Markdown 和图片）
     * 这是识别 docx 文件的核心方法
     * @param fileOrBuffer 文件对象或 ArrayBuffer
     * @returns 提取结果，包含 HTML、Markdown 和图片列表
     */
    const extractDocx = async (fileOrBuffer: File | ArrayBuffer): Promise<DocxExtractResult> => {
        status.value = 'reading'
        progress.value = 0
        error.value = null

        try {
            progress.value = 20
            const extractResult = await extractDocxContent(fileOrBuffer)
            progress.value = 100
            status.value = 'success'
            return extractResult
        } catch (e) {
            error.value = e instanceof Error ? e : new Error(String(e))
            status.value = 'error'
            throw e
        }
    }

    /**
     * 提取 Markdown 文件内容和图片
     * 支持远程 URL 图片和 base64 图片
     * @param fileOrContent 文件对象或文本内容
     * @returns 提取结果，包含处理后的 Markdown 和图片列表
     */
    const extractMarkdown = async (fileOrContent: File | string): Promise<MarkdownExtractResult> => {
        status.value = 'reading'
        progress.value = 0
        error.value = null

        try {
            progress.value = 10

            // 获取文本内容
            let content: string
            if (typeof fileOrContent === 'string') {
                content = fileOrContent
            } else {
                content = await readTextFile(fileOrContent)
            }

            progress.value = 30

            // 提取图片并替换为占位符
            const extractResult = await extractMarkdownImages(content)

            progress.value = 80

            // 将 Markdown 转换为 HTML
            const html = await marked(extractResult.markdown)

            progress.value = 100
            status.value = 'success'

            return {
                ...extractResult,
                html,
            }
        } catch (e) {
            error.value = e instanceof Error ? e : new Error(String(e))
            status.value = 'error'
            throw e
        }
    }

    return {
        // 状态
        status: readonly(status),
        progress: readonly(progress),
        error: readonly(error),
        result: readonly(result),

        // 方法
        readFile,
        readFiles,
        extractDocx,
        extractMarkdown,
        reset,

        // 工具函数
        isSupportedFileType,
        isTextFile,
        isWordFile,
    }
}
