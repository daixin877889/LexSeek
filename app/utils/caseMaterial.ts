/**
 * 案件材料相关工具函数
 *
 * 前端包装层，复用 shared 中的共享映射逻辑
 */

import {
  FileTextIcon,
  FileIcon,
  ImageIcon,
  FileAudioIcon,
} from 'lucide-vue-next'
import { CaseMaterialType } from '#shared/types/case'
import { getMaterialTypeFromMime } from '#shared/types/case'

export { getMaterialTypeFromMime as getMaterialType } from '#shared/types/case'

export function getMaterialIcon(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return FileTextIcon
    case CaseMaterialType.IMAGE: return ImageIcon
    case CaseMaterialType.AUDIO: return FileAudioIcon
    case CaseMaterialType.CASE_CONTENT: return FileIcon
    default: return FileIcon
  }
}

export function getMaterialBgColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'bg-blue-500/10 dark:bg-blue-500/20'
    case CaseMaterialType.IMAGE: return 'bg-green-500/10 dark:bg-green-500/20'
    case CaseMaterialType.AUDIO: return 'bg-purple-500/10 dark:bg-purple-500/20'
    case CaseMaterialType.CASE_CONTENT: return 'bg-orange-500/10 dark:bg-orange-500/20'
    default: return 'bg-muted'
  }
}

export function getMaterialIconColor(type: number) {
  switch (type) {
    case CaseMaterialType.DOCUMENT: return 'text-blue-600 dark:text-blue-400'
    case CaseMaterialType.IMAGE: return 'text-green-600 dark:text-green-400'
    case CaseMaterialType.AUDIO: return 'text-purple-600 dark:text-purple-400'
    case CaseMaterialType.CASE_CONTENT: return 'text-orange-600 dark:text-orange-400'
    default: return 'text-muted-foreground'
  }
}

/** 材料综合显示状态：用于 list/grid item 上的小徽章 */
export interface MaterialDisplayStatus {
  text: string
  color: string
  spinning?: boolean
  showRetry?: boolean
}

/**
 * 计算材料的"识别状态徽章"显示数据。
 * 优先取前端轮询状态（getRecognitionStatus），降级走 API 返回的 material.status。
 *
 * - 待识别 / 识别中 / 已识别 / 识别失败（带重试入口）
 * - 已完成（status===3）或无前端状态时返回 null（不显示徽章）
 *
 * 前端 caseDetail 的 Overview / Materials / 其它任何材料卡片都共用同一份逻辑，
 * 避免散点 if-else 分歧。
 */
export function getMaterialDisplayStatus(
  material: { status: number; ossFileId?: number | null },
  // 容忍 'idle'（轮询尚未开始）—— 上游 RecognitionStatus = 'idle' | 'recognizing' | 'success' | 'error'
  getRecognitionStatus?: (ossFileId?: number) => 'recognizing' | 'success' | 'error' | 'idle' | null,
): MaterialDisplayStatus | null {
  if (getRecognitionStatus && material.ossFileId) {
    const r = getRecognitionStatus(material.ossFileId)
    if (r === 'recognizing') return { text: '识别中', color: 'text-amber-500', spinning: true }
    if (r === 'success') return { text: '已识别', color: 'text-green-500' }
    if (r === 'error') return { text: '识别失败', color: 'text-destructive', showRetry: true }
  }
  if (material.status === 1) return { text: '待识别', color: 'text-muted-foreground' }
  if (material.status === 2) return { text: '识别中', color: 'text-amber-500', spinning: true }
  if (material.status === 4) return { text: '识别失败', color: 'text-destructive', showRetry: true }
  return null
}
