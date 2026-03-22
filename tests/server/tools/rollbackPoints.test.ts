import { describe, it, expect, vi } from 'vitest'
import { toolDefinition } from '~~/server/services/workflow/tools/rollbackPoints.tool'

vi.mock('~~/server/services/point/pointConsumption.service', () => ({
    rollbackPreDeductService: vi.fn(),
}))

describe('rollback_points tool', () => {
    it('should have correct name', () => {
        expect(toolDefinition.name).toBe('rollback_points')
    })
    it('should accept batchId parameter', () => {
        expect(toolDefinition.schema.shape.batchId).toBeDefined()
    })
})
