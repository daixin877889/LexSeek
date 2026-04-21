/**
 * 加载合同全文（OSS 下载 + docx 解析 + 段落拼接）
 *
 * 给合同审查流程内多处复用：
 * - `contractReviewMainAgent` 启动前切分用
 * - `parseAndAskStance` 工具识别当事人用
 *
 * 返回 { fullText, paragraphs } —— 调用方按需取用。
 */
import { findOssFileByIdDao } from '~~/server/services/files/ossFiles.dao'
import { downloadFileService } from '~~/server/services/storage/storage.service'
import { parseContractDocx } from './index'

export interface ContractFullTextResult {
    /** 段落数组（非空行） */
    paragraphs: string[]
    /** 段落以 \n 拼接的全文 */
    fullText: string
}

/**
 * 按 originalFileId 从 OSS 下载原始 .docx 并解析为段落 + 拼接全文
 *
 * @throws 当 OSS 文件记录不存在、filePath 缺失或下载失败时抛错
 */
export async function loadContractFullText(originalFileId: number): Promise<ContractFullTextResult> {
    const ossFile = await findOssFileByIdDao(originalFileId)
    if (!ossFile) throw new Error(`loadContractFullText: OSS file ${originalFileId} not found`)
    if (!ossFile.filePath) throw new Error(`loadContractFullText: OSS file ${originalFileId} filePath 缺失`)

    const buffer = await downloadFileService(ossFile.filePath)
    const { paragraphs } = await parseContractDocx(buffer)
    return {
        paragraphs,
        fullText: paragraphs.join('\n'),
    }
}
