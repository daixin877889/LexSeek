/**
 * 案件记忆工具单测：write_case_memory / update_case_memory / search_case_memory
 *
 * 验证：
 * - caseId 缺失返回错误
 * - 案件已归档时拒绝写/更新（search 仍允许）
 * - 正常路径调下游 service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
    writeMemoryServiceMock,
    updateMemoryServiceMock,
    recallMemoryServiceMock,
    findUniqueMock,
} = vi.hoisted(() => ({
    writeMemoryServiceMock: vi.fn(),
    updateMemoryServiceMock: vi.fn(),
    recallMemoryServiceMock: vi.fn(),
    findUniqueMock: vi.fn(),
}))

vi.mock('~~/server/services/memory/memory.service', () => ({
    writeMemoryService: writeMemoryServiceMock,
    updateMemoryService: updateMemoryServiceMock,
    recallMemoryService: recallMemoryServiceMock,
}))
vi.mock('#shared/utils/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
// 用 stubGlobal 强制覆盖 setup-files 注入的真实 prisma
vi.stubGlobal('prisma', { cases: { findUnique: findUniqueMock } })

import { createTool as createWriteTool } from '~~/server/services/agent-platform/tools/write_case_memory.tool'
import { createTool as createUpdateTool } from '~~/server/services/agent-platform/tools/update_case_memory.tool'
import { createTool as createSearchTool } from '~~/server/services/agent-platform/tools/search_case_memory.tool'

const baseCtx = { userId: 1, sessionId: 'sess-1', caseId: 100 }

beforeEach(() => {
    vi.clearAllMocks()
})

describe('write_case_memory', () => {
    it('缺 caseId 返回错误', async () => {
        const t = createWriteTool({ ...baseCtx, caseId: undefined } as any)
        const out: any = await t.invoke({ text: 'x', kind: 'fact' })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result.error).toContain('未绑定案件')
    })

    it('案件已归档时拒绝写入', async () => {
        findUniqueMock.mockResolvedValueOnce({ status: 4 /* ARCHIVED */ })
        const t = createWriteTool(baseCtx)
        const out: any = await t.invoke({ text: 'x', kind: 'fact' })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result.error).toContain('案件已归档')
        expect(writeMemoryServiceMock).not.toHaveBeenCalled()
    })

    it('案件正常时写入并返回 id', async () => {
        findUniqueMock.mockResolvedValueOnce({ status: 1 })
        writeMemoryServiceMock.mockResolvedValueOnce({ id: 'mem-1' })
        const t = createWriteTool(baseCtx)
        const out: any = await t.invoke({ text: '事实', kind: 'fact', subject_key: 'plaintiff.name' })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result).toEqual({ id: 'mem-1', ok: true })
        expect(writeMemoryServiceMock).toHaveBeenCalledWith(expect.objectContaining({
            caseId: 100, kind: 'fact', text: '事实', subjectKey: 'plaintiff.name', source: 'manual',
        }))
    })

    it('下游 writeMemoryService 抛错时返回错误对象', async () => {
        findUniqueMock.mockResolvedValueOnce({ status: 1 })
        writeMemoryServiceMock.mockRejectedValueOnce(new Error('db down'))
        const t = createWriteTool(baseCtx)
        const out: any = await t.invoke({ text: 'x', kind: 'fact' })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result.error).toBe('记忆写入失败')
        expect(result.message).toContain('db down')
    })
})

describe('update_case_memory', () => {
    it('缺 caseId 返回错误', async () => {
        const t = createUpdateTool({ ...baseCtx, caseId: undefined } as any)
        const out: any = await t.invoke({ id: '00000000-0000-4000-8000-000000000000', invalidate: true })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result.error).toContain('未绑定案件')
    })

    it('归档案件拒绝修改', async () => {
        findUniqueMock.mockResolvedValueOnce({ status: 4 })
        const t = createUpdateTool(baseCtx)
        const out: any = await t.invoke({ id: '00000000-0000-4000-8000-000000000000', invalidate: false, text: '改' })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result.error).toContain('案件已归档')
        expect(updateMemoryServiceMock).not.toHaveBeenCalled()
    })

    it('正常路径调用 updateMemoryService 并返回 ok', async () => {
        findUniqueMock.mockResolvedValueOnce({ status: 1 })
        updateMemoryServiceMock.mockResolvedValueOnce(undefined)
        const t = createUpdateTool(baseCtx)
        const out: any = await t.invoke({ id: '00000000-0000-4000-8000-000000000000', text: '新文本', invalidate: false })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result).toEqual({ ok: true })
        expect(updateMemoryServiceMock).toHaveBeenCalledWith(
            '00000000-0000-4000-8000-000000000000',
            { text: '新文本', invalidate: false },
        )
    })
})

describe('search_case_memory', () => {
    it('缺 caseId 返回错误', async () => {
        const t = createSearchTool({ ...baseCtx, caseId: undefined } as any)
        const out: any = await t.invoke({ query: '要找的事' })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result.error).toContain('未绑定案件')
    })

    it('归档案件 search 仍可召回历史记忆', async () => {
        recallMemoryServiceMock.mockResolvedValueOnce([
            {
                id: 'm1', text: '历史事实', score: 0.95,
                metadata: { kind: 'fact', createdAt: '2025-01-01' },
            },
        ])
        const t = createSearchTool(baseCtx)
        const out: any = await t.invoke({ query: '历史', include_history: true, top_k: 5 })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(Array.isArray(result)).toBe(true)
        expect(result[0]).toEqual({
            id: 'm1',
            text: '历史事实',
            score: '0.950',
            kind: 'fact',
            createdAt: '2025-01-01',
        })
        // search 工具不查 cases.findUnique（不限制归档）
        expect(findUniqueMock).not.toHaveBeenCalled()
    })

    it('正常路径透传 query/kind/top_k/include_history', async () => {
        recallMemoryServiceMock.mockResolvedValueOnce([])
        const t = createSearchTool(baseCtx)
        await t.invoke({ query: '原告地址', kind: 'fact', top_k: 3 })
        expect(recallMemoryServiceMock).toHaveBeenCalledWith({
            caseId: 100,
            query: '原告地址',
            kind: 'fact',
            topK: 3,
            includeInvalidated: false,
        })
    })

    it('下游服务抛错时返回错误对象', async () => {
        recallMemoryServiceMock.mockRejectedValueOnce(new Error('vector svc down'))
        const t = createSearchTool(baseCtx)
        const out: any = await t.invoke({ query: 'q' })
        const result = JSON.parse(typeof out === 'string' ? out : out.content)
        expect(result.error).toBe('记忆检索失败')
        expect(result.message).toContain('vector svc down')
    })
})
