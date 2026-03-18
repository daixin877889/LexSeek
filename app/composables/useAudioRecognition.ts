/**
 * 音频识别工具函数
 *
 * 提供音频文件类型判断的工具函数
 * 识别功能已迁移到统一 API /api/v1/recognition/start
 *
 * @requirements 6.6.1, 6.6.2, 6.7.4
 */

import { getExtensionFromFileName } from '~~/shared/utils/file'
import { AsrRecordStatus, AsrRecordStatusText } from '#shared/types/recognition'

/** 支持的音频扩展名 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm', 'amr', 'opus']

/**
 * 判断是否为音频文件
 * 支持格式：MP3、WAV、M4A、AAC、FLAC、OGG、WEBM、AMR、OPUS
 */
export const isAudioFile = (fileName: string): boolean => {
    const ext = getExtensionFromFileName(fileName)
    return AUDIO_EXTENSIONS.includes(ext)
}
