/**
 * docx 底层 zip 读写封装。
 *
 * docx = ZIP + XML，commentInjector / parser 统一从此处操作 zip，不直接调 jszip。
 */
import JSZip from 'jszip'

export type DocxZip = JSZip

/** 从 docx Buffer 加载 JSZip 实例 */
export async function loadDocxZip(buffer: Buffer): Promise<DocxZip> {
    return await JSZip.loadAsync(buffer)
}

/** 读取 zip 内指定路径的文本（UTF-8） */
export async function readTextFromZip(zip: DocxZip, path: string): Promise<string> {
    const file = zip.file(path)
    if (!file) throw new Error(`zip 中不存在 ${path}`)
    return await file.async('string')
}

/** 写入（或覆盖）zip 内指定路径的文本文件 */
export function writeTextToZip(zip: DocxZip, path: string, content: string): void {
    zip.file(path, content)
}

/** 序列化 zip 为 Buffer（可上传 OSS 或写入响应） */
export async function zipToBuffer(zip: DocxZip): Promise<Buffer> {
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
