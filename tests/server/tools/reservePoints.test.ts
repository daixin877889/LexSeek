import { describe, it, expect, vi } from 'vitest'
import { toolDefinition } from '~~/server/services/workflow/tools/reservePoints.tool'

vi.mock('~~/server/services/point/pointConsumption.service', () => ({
    preDeductPointsService: vi.fn(),
    checkPointsService: vi.fn(),
    getConsumptionItemByKeyService: vi.fn(),
}))

describe('reserve_points tool', () => {
    it('should have correct name', () => {
        expect(toolDefinition.name).toBe('reserve_points')
    })

    it('should accept modules array parameter', () => {
        expect(toolDefinition.schema.shape.modules).toBeDefined()
    })
})
