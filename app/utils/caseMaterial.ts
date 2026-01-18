/**
 * 案件材料相关工具函数
 */

import type { CaseMaterialType } from '../../shared/types/case'
import { CaseMaterialType as MaterialType } from '../../shared/types/case'

/**
 * 根据 MIME 类型确定材料类型
 * 
 * 根据文件的 MIME 类型判断材料类型：
 * - 图片类型（image/*）-> IMAGE (3)
 * - 音频类型（audio/*）-> AUDIO (4)
 * - 其他类型 -> DOCUMENT (2)
 * 
 * @param mimeType - 文件的 MIME 类型
 * @returns 材料类型枚举值
 * 
 * @example
 * getMaterialType('image/jpeg') // 返回 CaseMaterialType.IMAGE (3)
 * getMaterialType('audio/mp3') // 返回 CaseMaterialType.AUDIO (4)
 * getMaterialType('application/pdf') // 返回 CaseMaterialType.DOCUMENT (2)
 */
export function getMaterialType(mimeType: string): CaseMaterialType {
    // 判断是否为图片类型
    if (mimeType?.includes('image')) {
        return MaterialType.IMAGE
    }

    // 判断是否为音频类型
    if (mimeType?.includes('audio')) {
        return MaterialType.AUDIO
    }

    // 其他文件默认为文档类型
    return MaterialType.DOCUMENT
}
