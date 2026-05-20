import type { FileSourceAccept } from '../types/file'
import { FileSource } from '../types/file'
import {
  ASR_ACCEPT,
  AUDIO_EXTENSIONS,
  DOC_ACCEPT,
  DOC_EXTENSIONS,
  IMAGE_ACCEPT,
  IMAGE_EXTENSIONS,
  getFileSourceAcceptFromPolicies,
} from './uploadPolicy'

/**
 * 从文件名中提取后缀名
 * @param fileName 文件名
 * @returns 后缀名（小写，不含点号），如果没有后缀名则返回空字符串
 * @example
 * getExtensionFromFileName('song.mp3') // 'mp3'
 * getExtensionFromFileName('document.PDF') // 'pdf'
 * getExtensionFromFileName('noextension') // ''
 * getExtensionFromFileName('.gitignore') // 'gitignore'
 */
export const getExtensionFromFileName = (fileName: string): string => {
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex > 0 && lastDotIndex < fileName.length - 1) {
    return fileName.substring(lastDotIndex + 1).toLowerCase()
  }
  return ''
}

export {
  ASR_ACCEPT,
  AUDIO_EXTENSIONS,
  DOC_ACCEPT,
  DOC_EXTENSIONS,
  IMAGE_ACCEPT,
  IMAGE_EXTENSIONS,
}

/**
 * 获取文件来源允许的文件类型及最大大小
 */
export const getFileSourceAccept = (source?: FileSource): FileSourceAccept[] => {
  return getFileSourceAcceptFromPolicies(source)
}
