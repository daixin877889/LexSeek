/**
 * 文件识别服务
 *
 * 根据文件扩展名自动识别材料类型
 */

import { CaseMaterialType } from '#shared/types/case'

/**
 * 从文件名获取文件扩展名
 */
function getExtensionFromFileName(fileName: string): string {
    const parts = fileName.split('.')
    return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * 根据文件扩展名识别材料类型
 *
 * @param fileName - 文件名
 * @returns 材料类型 (IMAGE, AUDIO, DOCUMENT)
 */
export function detectFileTypeService(fileName: string): CaseMaterialType {
    const ext = getExtensionFromFileName(fileName).toLowerCase()

    // 图片格式
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)) {
        return CaseMaterialType.IMAGE
    }

    // 音频格式
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) {
        return CaseMaterialType.AUDIO
    }

    // 默认返回文档类型（包括 pdf, doc, docx, md, txt 等）
    return CaseMaterialType.DOCUMENT
}
