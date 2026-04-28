/**
 * memoryExtraction 服务测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 afterAgent 异步任务核心逻辑**
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '~~/server/utils/db'
import { runMemoryExtractionService } from '~~/server/services/memory/memoryExtraction.service'
import { ensureTestUser, ensureTestCase, cleanupTestData } from '../assistant/test-db-helper'

vi.mock('~~/server/services/agent-platform/tools/invokeNodeJson', () => ({
    invokeNodeJson: vi.fn(),
}))

import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'

describe('runMemoryExtractionService', () => {
    let userId: number
    let caseId: number

    beforeEach(async () => {
        userId = await ensureTestUser()
        caseId = await ensureTestCase(userId)
        vi.clearAllMocks()
    })

    afterEach(async () => {
        await prisma.$executeRawUnsafe(
            `DELETE FROM case_memories WHERE metadata->>'caseId' = $1`,
            String(caseId),
        )
        await cleanupTestData()
    })

    it('正常路径：节点返回 3 条，全部写入', async () => {
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({
            memories: [
                { text: '原告住北京', kind: 'fact', subject_key: 'plaintiff.address' },
                { text: '2024-03-15 签合同', kind: 'event', subject_key: 'contract.signed_at' },
                { text: '主张违约金', kind: 'decision', subject_key: 'strategy.claim' },
            ],
        })

        await runMemoryExtractionService({
            caseId,
            sessionId: 'sess-1',
            messages: [{ role: 'user', content: '我的案件...' }],
        })

        const rows = await prisma.$queryRawUnsafe<Array<{ metadata: any }>>(
            `SELECT metadata FROM case_memories WHERE metadata->>'caseId' = $1`,
            String(caseId),
        )
        expect(rows).toHaveLength(3)
        expect(rows.every(r => r.metadata.source === 'auto_extract')).toBe(true)
    })

    it('软去重：同 subjectKey 文本相似（>0.9）跳过', async () => {
        // 先写一条 manual 的
        await prisma.$executeRawUnsafe(
            `INSERT INTO case_memories (id, text, metadata) VALUES (gen_random_uuid(), $1, $2::jsonb)`,
            '原告住北京',
            JSON.stringify({
                caseId,
                kind: 'fact',
                subjectKey: 'plaintiff.address',
                source: 'manual',
                createdAt: new Date().toISOString(),
            }),
        )

        // 节点返回非常相似的同 subjectKey
        vi.mocked(invokeNodeJson).mockResolvedValueOnce({
            memories: [{ text: '原告住北京', kind: 'fact', subject_key: 'plaintiff.address' }],
        })

        await runMemoryExtractionService({ caseId, sessionId: 'sess-1', messages: [] })

        const rows = await prisma.$queryRawUnsafe<Array<{ metadata: any }>>(
            `SELECT metadata FROM case_memories WHERE metadata->>'caseId' = $1`,
            String(caseId),
        )
        expect(rows).toHaveLength(1) // 没新增，软去重生效
        expect(rows[0]!.metadata.source).toBe('manual')
    })

    it('节点抛错时静默 catch（不抛给上层）', async () => {
        vi.mocked(invokeNodeJson).mockRejectedValueOnce(new Error('LLM down'))

        // 不应该抛错
        await expect(
            runMemoryExtractionService({ caseId, sessionId: 'sess-1', messages: [] }),
        ).resolves.toBeUndefined()
    })
})
