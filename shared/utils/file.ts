import { mime } from './mime'
import type { FileSourceAccept } from '../types/file'
import { FileSource, FileSourceName } from '../types/file'

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

/**
 * 语音识别允许的文件类型及最大大小
 */
export const ASR_ACCEPT = {
  m4a: 200 * 1024 * 1024,
  mp3: 200 * 1024 * 1024,
  wav: 500 * 1024 * 1024,
}


/**
 * 文档识别允许的文件类型及最大大小
 */
export const DOC_ACCEPT = {
  pdf: 50 * 1024 * 1024,
  md: 20 * 1024 * 1024,
  mkd: 20 * 1024 * 1024,
  txt: 1 * 1024 * 1024,
  docx: 20 * 1024 * 1024,
  doc: 20 * 1024 * 1024
}

/**
 * 图片识别允许的文件类型及最大大小
 */
export const IMAGE_ACCEPT = {
  png: 10 * 1024 * 1024,
  jpg: 10 * 1024 * 1024,
  jpeg: 10 * 1024 * 1024,
  gif: 10 * 1024 * 1024,
  webp: 10 * 1024 * 1024,
  heic: 10 * 1024 * 1024,
  heif: 10 * 1024 * 1024
}
/**
 * 将扩展名/大小映射转换为统一结构
 */
const mapAccept = (source: Record<string, number>) =>
  Object.entries(source).map(([name, maxSize]) => ({
    name,
    mime: mime.getType(name) ?? '',
    maxSize,
  }))

/**
 * 获取文件来源允许的文件类型及最大大小
 */
export const getFileSourceAccept = (source?: FileSource): FileSourceAccept[] => {
  const acceptList: FileSourceAccept[] = [
    { name: FileSourceName[FileSource.ASR], accept: mapAccept(ASR_ACCEPT) },
    { name: FileSourceName[FileSource.DOC], accept: mapAccept(DOC_ACCEPT) },
    { name: FileSourceName[FileSource.IMAGE], accept: mapAccept(IMAGE_ACCEPT) },
    { name: FileSourceName[FileSource.FILE], accept: mapAccept({ ...ASR_ACCEPT, ...DOC_ACCEPT, ...IMAGE_ACCEPT }) },
    { name: FileSourceName[FileSource.VIDEO], accept: [] },
    { name: FileSourceName[FileSource.CASE_ANALYSIS], accept: mapAccept({ ...ASR_ACCEPT, ...DOC_ACCEPT, ...IMAGE_ACCEPT }) },
  ]

  if (source) {
    const targetName = FileSourceName[source]
    return acceptList.filter(item => item.name === targetName)
  }

  return acceptList
}