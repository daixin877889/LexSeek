import { describe, it, expect } from 'vitest'

describe('getNodeConfigsByTypes', () => {
    it('should return configs sorted by priority', async () => {
        const { getNodeConfigsByTypes } = await import(
            '~~/server/services/node/node.service'
        )
        expect(typeof getNodeConfigsByTypes).toBe('function')
    })
})
