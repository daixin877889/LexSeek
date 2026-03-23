import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toolDefinition } from '~~/server/services/workflow/tools/processMaterials.tool'

describe('process_materials tool', () => {
    it('should have correct name and schema', () => {
        expect(toolDefinition.name).toBe('process_materials')
        expect(toolDefinition.description).toContain('材料')
    })
})
