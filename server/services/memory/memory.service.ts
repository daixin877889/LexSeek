import crypto from 'node:crypto'
import type { Document } from '@langchain/core/documents'
import { addDocumentsToVectorStore } from '../legal/vectorStore.service'
import type { CaseMemoryMetadata, MemoryKind } from '#shared/types/memory'

export interface MemoryWriteInput {
  caseId: number
  kind: MemoryKind
  text: string
  subjectKey?: string
  confidence?: number
  source?: 'manual' | 'consolidator'
}

/**
 * 写入案件记忆，走 LangChain PGVectorStore（schema 同构）。
 *
 * 版本链策略：INSERT 先于 invalidate，避免写入失败时出现孤立的已失效旧记录。
 * 同 subjectKey 的旧记录在新记录写入成功后才被打上 invalidatedAt 时间戳。
 */
export async function writeMemoryService(input: MemoryWriteInput): Promise<{ id: string }> {
  let supersedes: string | undefined

  // 1. 查找同 subjectKey 的最新未失效记录
  if (input.subjectKey) {
    const prevRows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT id FROM case_memories
       WHERE metadata->>'caseId' = $1
         AND metadata->>'subjectKey' = $2
         AND (metadata->>'invalidatedAt' IS NULL)
       ORDER BY metadata->>'createdAt' DESC
       LIMIT 1`,
      String(input.caseId),
      input.subjectKey,
    )
    if (prevRows.length > 0) {
      supersedes = prevRows[0]!.id
    }
  }

  // 2. 走 LangChain PGVectorStore 写入（保持 schema 同构）
  const newId = crypto.randomUUID()
  const metadata: CaseMemoryMetadata = {
    id: newId,
    caseId: input.caseId,
    kind: input.kind,
    subjectKey: input.subjectKey,
    confidence: input.confidence,
    source: input.source,
    supersedes,
    createdAt: new Date().toISOString(),
  }
  const doc: Document = {
    pageContent: input.text,
    metadata: metadata as unknown as Record<string, unknown>,
  }
  await addDocumentsToVectorStore([doc], [newId], { tableName: 'case_memories' })

  // 3. 回填 tsv（addDocumentsToVectorStore 不写 tsv 列）
  await prisma.$executeRawUnsafe(
    `UPDATE case_memories SET tsv = to_tsvector('chinese', COALESCE(text, ''))
     WHERE id = $1::uuid`,
    newId,
  )

  // 4. 版本链：写入成功后再 invalidate 旧记录
  if (supersedes) {
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories
       SET metadata = jsonb_set(metadata, '{invalidatedAt}', to_jsonb($2::text))
       WHERE id = $1::uuid`,
      supersedes,
      new Date().toISOString(),
    )
  }

  return { id: newId }
}

/**
 * 更新记忆：改文本 和/或 打失效
 */
export async function updateMemoryService(
  id: string,
  patch: { text?: string; invalidate?: boolean },
): Promise<void> {
  if (patch.text !== undefined) {
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories
       SET text = $2,
           tsv = to_tsvector('chinese', $2)
       WHERE id = $1::uuid`,
      id,
      patch.text,
    )
  }
  if (patch.invalidate) {
    await prisma.$executeRawUnsafe(
      `UPDATE case_memories
       SET metadata = jsonb_set(metadata, '{invalidatedAt}', to_jsonb($2::text))
       WHERE id = $1::uuid`,
      id,
      new Date().toISOString(),
    )
  }
}
