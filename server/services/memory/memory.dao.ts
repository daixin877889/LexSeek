/**
 * 案件记忆 DAO 层
 *
 * 沿用 LangChain PGVectorStore 同构约束：业务字段在 metadata JSON。
 * 所有查询用 raw SQL（prisma JSONB 操作能力受限）。
 */
import { prisma } from '~~/server/utils/db'

export interface MemoryRow {
    id: string
    text: string
    metadata: {
        caseId: number
        kind: string
        subjectKey?: string
        source?: string
        createdAt: string
        invalidatedAt?: string
        supersedes?: string
    }
}

/**
 * 查找指定案件 + subjectKey 的最新未失效记忆
 *
 * 用于：
 * - writeMemoryService 内部版本链（DRY 共用）
 * - afterAgent 软去重逻辑
 */
export async function findActiveMemoryBySubjectDAO(
    caseId: number,
    subjectKey: string,
): Promise<MemoryRow | null> {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; text: string; metadata: any }>>(
        `SELECT id, text, metadata FROM case_memories
         WHERE metadata->>'caseId' = $1
           AND metadata->>'subjectKey' = $2
           AND (metadata->>'invalidatedAt' IS NULL)
         ORDER BY metadata->>'createdAt' DESC
         LIMIT 1`,
        String(caseId),
        subjectKey,
    )
    if (rows.length === 0) return null
    return rows[0] as MemoryRow
}
