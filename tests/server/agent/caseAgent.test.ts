import { describe, it, expect, vi } from 'vitest'

vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
    getSubagentConfigsService: vi.fn(),
}))
vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(),
}))

describe('caseMainAgent', () => {
    it('should export runCaseChat function', async () => {
        const { runCaseChat } = await import(
            '~~/server/services/workflow/agents/index'
        )
        expect(typeof runCaseChat).toBe('function')
    })

    it('should export getChatThreadState function', async () => {
        const { getChatThreadState } = await import(
            '~~/server/services/workflow/agents/index'
        )
        expect(typeof getChatThreadState).toBe('function')
    })
})
