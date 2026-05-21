/**
 * docx 底层 zip 读写封装。
 *
 * docx = ZIP + XML，commentInjector / parser 统一从此处操作 zip，不直接调 jszip。
 */
import JSZip from 'jszip'
import { parseOoxml, findMaxSharedId } from './xmlAst'

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

/** w:id 共享池涉及的 docx part（M16：除 document.xml 外还含页眉/页脚/脚注/尾注/原生批注） */
const W_ID_PART_PATTERN = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/

/**
 * 扫描 docx 内所有 w:id 共享池相关 part，返回全局最大 w:id（M16）。
 *
 * findMaxSharedId 仅扫单个 AST；只看 document.xml 会漏掉 header/footer 的书签、
 * 原生 comments.xml 的批注 ID —— 新分配的 w:del/w:ins/commentRange w:id 与之撞车
 * → Word 报"文件已损坏"。导出注入前必须基于本函数的结果 +1 起分配。
 */
export async function findMaxSharedIdInDocx(zip: DocxZip): Promise<number> {
    let max = -1
    for (const file of zip.file(W_ID_PART_PATTERN)) {
        try {
            const partMax = findMaxSharedId(parseOoxml(await file.async('string')))
            if (partMax > max) max = partMax
        } catch {
            // 单个 part 解析失败不阻断导出（document.xml 必然可解析）
        }
    }
    return max
}
