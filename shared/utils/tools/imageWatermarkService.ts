/**
 * 图片水印服务
 */

import type { TextWatermarkOptions, ImageWatermarkOptions, WatermarkPosition } from '@/types/tools'

/**
 * 添加文字水印到图片
 * @param imageSource 图片源（文件、Blob或URL）
 * @param options 水印选项
 * @returns 添加水印后的图片URL
 */
export function addTextWatermark(
    imageSource: File | Blob | string,
    options: TextWatermarkOptions = {}
): Promise<string> {
    return new Promise((resolve, reject) => {
        const {
            text = '水印文字',
            font = '20px Arial',
            color = 'rgba(255, 255, 255, 0.5)',
            position = 'center',
            rotate = -30
        } = options

        // 创建图片对象
        const img = new Image()
        img.crossOrigin = 'Anonymous'

        // 图片加载完成后处理
        img.onload = () => {
            // 创建canvas
            const canvas = document.createElement('canvas')
            canvas.width = img.width
            canvas.height = img.height

            // 获取绘图上下文
            const ctx = canvas.getContext('2d')
            if (!ctx) {
                reject(new Error('无法获取canvas上下文'))
                return
            }

            // 绘制原始图片
            ctx.drawImage(img, 0, 0, img.width, img.height)

            // 设置水印文字样式
            ctx.font = font
            ctx.fillStyle = color

            // 计算水印位置
            const textWidth = ctx.measureText(text).width
            const textHeight = parseInt(font, 10) // 近似文字高度
            const { x, y } = calculatePosition(position, img.width, img.height, textWidth, textHeight)

            // 应用旋转
            if (rotate !== 0) {
                ctx.save()
                ctx.translate(x + textWidth / 2, y - textHeight / 2)
                ctx.rotate(rotate * Math.PI / 180)
                ctx.fillText(text, -textWidth / 2, textHeight / 2)
                ctx.restore()
            } else {
                ctx.fillText(text, x, y)
            }

            // 转换为图片URL
            const dataUrl = canvas.toDataURL('image/jpeg')
            resolve(dataUrl)
        }

        // 图片加载失败处理
        img.onerror = () => {
            reject(new Error('图片加载失败'))
        }

        // 设置图片源
        if (typeof imageSource === 'string') {
            img.src = imageSource
        } else if (imageSource instanceof Blob || imageSource instanceof File) {
            img.src = URL.createObjectURL(imageSource)
        } else {
            reject(new Error('不支持的图片源类型'))
        }
    })
}

/**
 * 添加图片水印到图片
 * @param imageSource 图片源（文件、Blob或URL）
 * @param watermarkSource 水印图片源
 * @param options 水印选项
 * @returns 添加水印后的图片URL
 */
export function addImageWatermark(
    imageSource: File | Blob | string,
    watermarkSource: File | Blob | string,
    options: ImageWatermarkOptions = {}
): Promise<string> {
    return new Promise((resolve, reject) => {
        const {
            position = 'bottomRight',
            opacity = 0.5,
            scale = 0.3
        } = options

        // 创建主图片对象
        const img = new Image()
        img.crossOrigin = 'Anonymous'

        // 创建水印图片对象
        const watermark = new Image()
        watermark.crossOrigin = 'Anonymous'

        // 加载计数器
        let loadedCount = 0
        const onLoad = () => {
            loadedCount++
            if (loadedCount === 2) {
                processImages()
            }
        }

        // 处理图片
        const processImages = () => {
            // 创建canvas
            const canvas = document.createElement('canvas')
            canvas.width = img.width
            canvas.height = img.height

            // 获取绘图上下文
            const ctx = canvas.getContext('2d')
            if (!ctx) {
                reject(new Error('无法获取canvas上下文'))
                return
            }

            // 绘制原始图片
            ctx.drawImage(img, 0, 0, img.width, img.height)

            // 计算水印尺寸
            const watermarkWidth = watermark.width * scale
            const watermarkHeight = watermark.height * scale

            // 计算水印位置
            const { x, y } = calculateWatermarkPosition(position, img.width, img.height, watermarkWidth, watermarkHeight)

            // 设置透明度
            ctx.globalAlpha = opacity

            // 绘制水印
            ctx.drawImage(watermark, x, y, watermarkWidth, watermarkHeight)

            // 恢复透明度
            ctx.globalAlpha = 1.0

            // 转换为图片URL
            const dataUrl = canvas.toDataURL('image/jpeg')
            resolve(dataUrl)
        }

        // 图片加载处理
        img.onload = onLoad
        watermark.onload = onLoad

        // 图片加载失败处理
        img.onerror = () => reject(new Error('主图片加载失败'))
        watermark.onerror = () => reject(new Error('水印图片加载失败'))

        // 设置图片源
        if (typeof imageSource === 'string') {
            img.src = imageSource
        } else if (imageSource instanceof Blob || imageSource instanceof File) {
            img.src = URL.createObjectURL(imageSource)
        } else {
            reject(new Error('不支持的主图片源类型'))
            return
        }

        if (typeof watermarkSource === 'string') {
            watermark.src = watermarkSource
        } else if (watermarkSource instanceof Blob || watermarkSource instanceof File) {
            watermark.src = URL.createObjectURL(watermarkSource)
        } else {
            reject(new Error('不支持的水印图片源类型'))
        }
    })
}

/**
 * 计算文字水印位置
 */
function calculatePosition(
    position: WatermarkPosition,
    imgWidth: number,
    imgHeight: number,
    textWidth: number,
    textHeight: number
): { x: number; y: number } {
    let x: number
    let y: number

    switch (position) {
        case 'topLeft':
            x = 20
            y = 20 + textHeight
            break
        case 'topRight':
            x = imgWidth - textWidth - 20
            y = 20 + textHeight
            break
        case 'bottomLeft':
            x = 20
            y = imgHeight - 20
            break
        case 'bottomRight':
            x = imgWidth - textWidth - 20
            y = imgHeight - 20
            break
        case 'center':
        default:
            x = (imgWidth - textWidth) / 2
            y = imgHeight / 2
            break
    }

    return { x, y }
}

/**
 * 计算图片水印位置
 */
function calculateWatermarkPosition(
    position: WatermarkPosition,
    imgWidth: number,
    imgHeight: number,
    watermarkWidth: number,
    watermarkHeight: number
): { x: number; y: number } {
    let x: number
    let y: number

    switch (position) {
        case 'topLeft':
            x = 20
            y = 20
            break
        case 'topRight':
            x = imgWidth - watermarkWidth - 20
            y = 20
            break
        case 'bottomLeft':
            x = 20
            y = imgHeight - watermarkHeight - 20
            break
        case 'bottomRight':
            x = imgWidth - watermarkWidth - 20
            y = imgHeight - watermarkHeight - 20
            break
        case 'center':
        default:
            x = (imgWidth - watermarkWidth) / 2
            y = (imgHeight - watermarkHeight) / 2
            break
    }

    return { x, y }
}
