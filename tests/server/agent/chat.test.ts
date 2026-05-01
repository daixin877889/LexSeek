import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('POST /api/v1/cases/analysis/chat', () => {
    it('should have endpoint file', () => {
        const filePath = resolve(__dirname, '../../../server/api/v1/cases/analysis/chat.post.ts')
        expect(existsSync(filePath)).toBe(true)
    })
})
