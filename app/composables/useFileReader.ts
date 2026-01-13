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
    const result = await mammoth.extractRawText({ arrayBuffer })

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
    const options = {
        convertImage: mammoth.images.imgElement((image) => {
            return image.read('base64').then((base64Data) => {
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
    const htmlResult = await mammoth.convertToHtml({ arrayBuffer }, options)

    if (htmlResult.messages.length > 0) {
        console.warn('mammoth HTML 转换警告:', htmlResult.messages)
    }

    // 提取纯文本内容
    const textResult = await mammoth.extractRawText({ arrayBuffer })

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
        reset,

        // 工具函数
        isSupportedFileType,
        isTextFile,
        isWordFile,
    }
}
