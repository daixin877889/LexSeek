/**
 * 合同导出署名解析。
 *
 * 导出修订/批注 docx 时，AI 修订标记与 AI 批注的作者名用律师设置的署名；
 * 未设置则回退账号姓名（spec §4.1）。
 */
import { findUserExportSignatureDao } from './users.dao'

/**
 * 解析用户的合同导出署名。
 * 优先 contractExportSignature；为空/空白回退 name；用户不存在回退安全默认值，
 * 保证导出流程不因取不到署名而中断。
 */
export async function resolveContractExportSignatureService(userId: number): Promise<string> {
    const row = await findUserExportSignatureDao(userId)
    const signature = (row?.contractExportSignature ?? '').trim()
    if (signature) return signature
    return (row?.name ?? '').trim() || '审查人'
}
