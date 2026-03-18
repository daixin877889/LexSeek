/**
 * 文件类型判断工具函数
 *
 * 提供统一的文件类型判断逻辑，供前端各模块使用
 */

import { getExtensionFromFileName } from './file'
import { IMAGE_EXTENSIONS, AUDIO_EXTENSIONS, DOC_EXTENSIONS } from './file'

/**
 * 判断是否为图片文件
 * 支持格式：PNG、JPG、JPEG、GIF、WebP、HEIC、HEIF
 */
export const isImageFile = (fileName: string): boolean => {
  const ext = getExtensionFromFileName(fileName)
  return IMAGE_EXTENSIONS.includes(ext)
}

/**
 * 判断是否为音频文件
 * 支持格式：MP3、WAV、M4A、AAC、FLAC、OGG、WebM、AMR、OPUS
 */
export const isAudioFile = (fileName: string): boolean => {
  const ext = getExtensionFromFileName(fileName)
  return AUDIO_EXTENSIONS.includes(ext)
}

/**
 * 判断是否为可识别的文档文件
 * 支持格式：docx、doc、pdf、md、mkd、markdown、txt
 */
export const isRecognizableDocFile = (fileName: string): boolean => {
  const ext = getExtensionFromFileName(fileName)
  return DOC_EXTENSIONS.includes(ext)
}
