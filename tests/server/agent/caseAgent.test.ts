import { describe, it, expect, vi } from 'vitest'

vi.mock('~~/server/services/node/node.service', () => ({
    getValidNodeConfig: vi.fn(),
    getSubagentConfigsService: vi.fn(),
}))
vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(),
}))

describe('createCaseAgent', () => {
    it('should export createCaseAgent function', async () => {
        const { createCaseAgent } = await import(
            '~~/server/services/agent/caseAgent'
        )
        expect(typeof createCaseAgent).toBe('function')
    })

    it('should export runCaseChat function', async () => {
        const { runCaseChat } = await import(
            '~~/server/services/agent/caseAgent'
        )
        expect(typeof runCaseChat).toBe('function')
    })
})
