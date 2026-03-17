/**
 * 图像识别工具函数
 *
 * 提供图像文件类型判断的工具函数
 * 识别功能已迁移到统一 API /api/v1/recognition/start
 *
 * @requirements 5.1-5.6
 */

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif']

/**
 * 判断是否为图片文件
 */
export const isImageFile = (fileName: string): boolean => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    return IMAGE_EXTENSIONS.includes(ext || '')
}
