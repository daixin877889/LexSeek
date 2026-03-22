import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTool } from '~~/server/services/workflow/tools/processMaterials.tool'

vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: vi.fn(),
}))
vi.mock('~~/server/services/material/materialEmbedding.service', () => ({
    batchCheckMaterialEmbeddedService: vi.fn(),
}))
vi.mock('~~/server/services/material/materialProcess.service', () => ({
    ensureMaterialsEmbeddedService: vi.fn(),
}))

describe('process_materials tool', () => {
    const context = { userId: 1, caseId: 10, sessionId: 'test-session' }

    it('should return full content when total tokens < 32000', async () => {
        const { getMaterialsByCaseIdService } = await import(
            '~~/server/services/material/material.service'
        )
        const { batchCheckMaterialEmbeddedService } = await import(
            '~~/server/services/material/materialEmbedding.service'
        )

        vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([
            { id: 1, name: '起诉状.docx', content: '案情内容', tokenCount: 5000, type: 'document' },
        ] as any)
        vi.mocked(batchCheckMaterialEmbeddedService).mockResolvedValue(new Map([[1, true]]))

        const tool = createTool(context)
        const result = await tool.invoke({})
        const parsed = JSON.parse(result as string)

        expect(parsed.mode).toBe('full')
        expect(parsed.materials).toHaveLength(1)
        expect(parsed.materials[0].content).toBe('案情内容')
    })

    it('should return summary when total tokens >= 32000', async () => {
        const { getMaterialsByCaseIdService } = await import(
            '~~/server/services/material/material.service'
        )
        const { batchCheckMaterialEmbeddedService } = await import(
            '~~/server/services/material/materialEmbedding.service'
        )

        vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([
            { id: 1, name: '合同.docx', content: 'x'.repeat(40000), tokenCount: 35000, type: 'document' },
        ] as any)
        vi.mocked(batchCheckMaterialEmbeddedService).mockResolvedValue(new Map([[1, true]]))

        const tool = createTool(context)
        const result = await tool.invoke({})
        const parsed = JSON.parse(result as string)

        expect(parsed.mode).toBe('summary')
        expect(parsed.materials[0].content).toBeUndefined()
    })
})
