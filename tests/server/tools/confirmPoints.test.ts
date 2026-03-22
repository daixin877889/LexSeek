import { describe, it, expect, vi } from 'vitest'
import { toolDefinition } from '~~/server/services/workflow/tools/confirmPoints.tool'

vi.mock('~~/server/services/point/pointConsumption.service', () => ({
    settlePointsService: vi.fn(),
}))

describe('confirm_points tool', () => {
    it('should have correct name', () => {
        expect(toolDefinition.name).toBe('confirm_points')
    })
    it('should accept batchId parameter', () => {
        expect(toolDefinition.schema.shape.batchId).toBeDefined()
    })
})
