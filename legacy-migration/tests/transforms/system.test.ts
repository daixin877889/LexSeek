import { describe, expect, it } from 'vitest'
import type { LSystemConfig } from '../../src/legacyTypes'
import { transformSystemConfig } from '../../src/transforms/system'

describe('transformSystemConfig', () => {
  it('一对一直拷', () => {
    const now = new Date()
    const o = {
      id: 1, configGroup: 'g', key: 'k', value: { a: 1 }, description: null,
      status: 1, createdAt: now, updatedAt: now, deletedAt: null,
    } as unknown as LSystemConfig
    expect(transformSystemConfig(o)).toEqual(o)
  })
})
