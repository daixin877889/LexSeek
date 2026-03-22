import { describe, it, expect, vi } from 'vitest'
import { toolDefinition } from '~~/server/services/workflow/tools/extractCaseInfo.tool'

describe('extract_case_info tool definition', () => {
    it('should have correct name and schema', () => {
        expect(toolDefinition.name).toBe('extract_case_info')
        expect(toolDefinition.schema.shape.materials).toBeDefined()
    })
})
