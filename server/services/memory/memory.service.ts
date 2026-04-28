import crypto from 'node:crypto'
import type { Document } from '@langchain/core/documents'
import { addDocumentsToVectorStore } from '../legal/vectorStore.service'
import { assertCaseWritableService } from '../case/case.service'
import type { CaseMemoryMetadata, MemoryHit, MemoryKind, MemorySource } from '#shared/types/memory'
import { retrieveWithReranking } from './retrieveWithReranking'
import { findActiveMemoryBySubjectDAO } from './memory.dao'

export interface MemoryWriteInput {
  caseId: number
  kind: MemoryKind
  text: string
  subjectKey?: string
  confidence?: number
  source?: MemorySource
}

/**
 * 写入案件记忆，走 LangChain PGVectorStore（schema 同构）。
 *
 * 版本链策略：INSERT 先于 invalidate，避免写入失败时出现孤立的已失效旧记录。
 * 同 subjectKey 的旧记录在新记录写入成功后才被打上 invalidatedAt 时间戳。
 */
export async function writeMemoryService(input: MemoryWriteInput): Promise<{ id: string }> {
  await assertCaseWritableService(input.caseId, 'WRITE_MEMORY')

  let supersedes: string | undefined

  // 1. 查找同 subjectKey 的最新未失效记录（DAO 复用）
  if (input.subjectKey) {
    const prev = await findActiveMemoryBySubjectDAO(input.caseId, input.subjectKey)
    if (prev) supersedes = prev.id
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
  // 先查记忆所在 caseId，再走统一守卫（合并为 1 次 join 可以省 1 次 round trip，
  // 但记忆元数据存 metadata->>'caseId' 不便建外键 / 关联，保留 2 次查询换可读性）
  const memRow = await prisma.$queryRawUnsafe<Array<{ caseId: number | null }>>(
    `SELECT (metadata->>'caseId')::int as "caseId" FROM case_memories WHERE id = $1::uuid`,
    id,
  )
  const caseId = memRow[0]?.caseId
  if (caseId) {
    await assertCaseWritableService(caseId, 'UPDATE_MEMORY')
  }

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

export async function recallMemoryService(params: {
  caseId: number
  query: string
  kind?: MemoryKind
  topK?: number
  includeInvalidated?: boolean
}): Promise<MemoryHit[]> {
  const { caseId, query, kind, topK = 5, includeInvalidated = false } = params

  const metadataFilter: Record<string, string | number | boolean> = { caseId }
  if (kind) metadataFilter.kind = kind

  return retrieveWithReranking({
    tableName: 'case_memories',
    query,
    topK,
    metadataFilter,
    filterInvalidated: !includeInvalidated,
    enableVersionScoring: true,
  })
}
