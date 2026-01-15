/**
 * MinerU ZIP 结果处理工具
 *
 * 处理 MinerU 返回的 ZIP 文件，提取 full.md 和图片
 * 支持图片路径替换为 OSS 占位符
 *
 * @requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import JSZip from 'jszip'

/** ZIP 中提取的图片信息 */
export interface ExtractedMineruImage {
    /** 图片在 ZIP 中的相对路径（如 images/xxx.png） */
    relativePath: string
    /** 图片文件名（不含路径） */
    fileName: string
    /** 图片数据 */
    data: ArrayBuffer
    /** MIME 类型 */
    mimeType: string
}

/** ZIP 提取结果 */
export interface MineruZipExtractResult {
    /** Markdown 内容（原始，包含相对路径） */
    markdown: string
    /** 图片列表 */
    images: ExtractedMineruImage[]
}

/** 图片 OSS 信息 */
export interface ImageOssInfo {
    /** bucket 名称 */
    bucket: string
    /** OSS 文件 ID */
    ossFileId: number
}

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']

/** 图片扩展名到 MIME 类型的映射 */
const MIME_TYPE_MAP: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
}

/**
 * 获取文件扩展名（小写）
 */
const getExtension = (filename: string): string => {
    const lastDot = filename.lastIndexOf('.')
    if (lastDot === -1) return ''
    return filename.slice(lastDot + 1).toLowerCase()
}

/**
 * 判断是否为图片文件
 */
const isImageFile = (filename: string): boolean => {
    const ext = getExtension(filename)
    return IMAGE_EXTENSIONS.includes(ext)
}

/**
 * 获取图片 MIME 类型
 */
const getImageMimeType = (filename: string): string => {
    const ext = getExtension(filename)
    return MIME_TYPE_MAP[ext] || 'application/octet-stream'
}

/**
 * 从 ZIP 文件中提取 full.md 和图片
 *
 * MinerU 返回的 ZIP 文件结构：
 * - full.md - 完整的 Markdown 内容
 * - images/ - 图片目录，包含文档中的所有图片
 *
 * @param zipData ZIP 文件数据
 * @returns 提取结果，包含 Markdown 内容和图片列表
 * @throws 如果 ZIP 解压失败或未找到 full.md
 */
export async function extractMineruZip(zipData: ArrayBuffer): Promise<MineruZipExtractResult> {
    // 解压 ZIP 文件
    const zip = await JSZip.loadAsync(zipData)

    let markdown = ''
    const images: ExtractedMineruImage[] = []

    // 遍历 ZIP 中的所有文件
    for (const [filename, file] of Object.entries(zip.files)) {
        // 跳过目录
        if (file.dir) continue

        // 查找 full.md 文件（可能在根目录或子目录中）
        if (filename.endsWith('full.md') || filename === 'full.md') {
            markdown = await file.async('string')
            continue
        }

        // 提取图片文件（在 images/ 目录下或任何位置的图片）
        if (isImageFile(filename)) {
            const data = await file.async('arraybuffer')
            const mimeType = getImageMimeType(filename)

            // 获取相对路径（保持原始路径结构）
            // MinerU 的图片通常在 images/ 目录下
            let relativePath = filename
            // 如果路径包含多级目录，只保留从 images/ 开始的部分
            const imagesIndex = filename.indexOf('images/')
            if (imagesIndex !== -1) {
                relativePath = filename.slice(imagesIndex)
            }

            // 获取文件名（不含路径）
            const lastSlash = filename.lastIndexOf('/')
            const fileName = lastSlash === -1 ? filename : filename.slice(lastSlash + 1)

            images.push({
                relativePath,
                fileName,
                data,
                mimeType,
            })
        }
    }

    // 验证是否找到 full.md
    if (!markdown) {
        throw new Error('ZIP 文件中未找到 full.md 文件')
    }

    return { markdown, images }
}

/**
 * 替换 Markdown 中的图片相对路径为 OSS 占位符
 *
 * 处理流程：
 * 1. 解析 Markdown 中的图片引用 ![alt](path)
 * 2. 根据相对路径查找对应的 OSS 信息
 * 3. 替换为 {{OSS_IMAGE:bucket:ossFileId}} 格式
 *
 * @param markdown 原始 Markdown 内容
 * @param imageMap 相对路径到 OSS 信息的映射
 * @returns 替换后的 Markdown 内容
 */
export function replaceImagePathsWithPlaceholders(
    markdown: string,
    imageMap: Map<string, ImageOssInfo>
): string {
    // 匹配 Markdown 图片语法：![alt](path) 或 ![](path)
    // 支持带空格的路径和各种特殊字符
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g

    return markdown.replace(imageRegex, (match, alt, path) => {
        // 清理路径（去除可能的空格和引号）
        const cleanPath = path.trim().replace(/^["']|["']$/g, '')

        // 尝试直接匹配
        let ossInfo = imageMap.get(cleanPath)

        // 如果直接匹配失败，尝试匹配文件名
        if (!ossInfo) {
            const fileName = cleanPath.split('/').pop() || cleanPath
            // 遍历 imageMap 查找匹配的文件名
            for (const [mapPath, info] of imageMap) {
                const mapFileName = mapPath.split('/').pop() || mapPath
                if (mapFileName === fileName) {
                    ossInfo = info
                    break
                }
            }
        }

        // 如果找到对应的 OSS 信息，替换为占位符
        if (ossInfo) {
            const placeholder = `{{OSS_IMAGE:${ossInfo.bucket}:${ossInfo.ossFileId}}}`
            return `![${alt}](${placeholder})`
        }

        // 未找到对应的 OSS 信息，保持原样
        return match
    })
}

/**
 * 检查 Markdown 中是否还有未替换的图片相对路径
 *
 * @param markdown Markdown 内容
 * @returns 未替换的图片路径列表
 */
export function findUnreplacedImagePaths(markdown: string): string[] {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    const unreplacedPaths: string[] = []

    let match
    while ((match = imageRegex.exec(markdown)) !== null) {
        const path = match[2]!.trim()
        // 如果不是 OSS 占位符格式，则为未替换的路径
        if (!path.startsWith('{{OSS_IMAGE:')) {
            unreplacedPaths.push(path)
        }
    }

    return unreplacedPaths
}

/**
 * 将 ArrayBuffer 转换为 Blob
 *
 * @param data ArrayBuffer 数据
 * @param mimeType MIME 类型
 * @returns Blob 对象
 */
export function arrayBufferToBlob(data: ArrayBuffer, mimeType: string): Blob {
    return new Blob([data], { type: mimeType })
}

/**
 * 将 ArrayBuffer 转换为 File
 *
 * @param data ArrayBuffer 数据
 * @param fileName 文件名
 * @param mimeType MIME 类型
 * @returns File 对象
 */
export function arrayBufferToFile(data: ArrayBuffer, fileName: string, mimeType: string): File {
    return new File([data], fileName, { type: mimeType })
}
