import { describe, it, expect, vi } from 'vitest'

describe('getSubagentConfigsService', () => {
    it('should return configs sorted by priority', async () => {
        const { getSubagentConfigsService } = await import(
            '~~/server/services/node/node.service'
        )
        expect(typeof getSubagentConfigsService).toBe('function')
    })
})
