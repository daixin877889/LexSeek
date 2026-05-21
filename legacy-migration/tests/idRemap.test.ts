import { describe, expect, it } from 'vitest'
import { buildRemap } from '../src/idRemap'

describe('buildRemap', () => {
  const oldRows = [
    { id: 1, name: '民事' },
    { id: 2, name: '刑事' },
    { id: 9, name: '已废弃类型' },
  ]
  const newRows = [
    { id: 5, name: '民事' },
    { id: 6, name: '刑事' },
    { id: 7, name: '行政' },
  ]

  it('按 name 把旧 ID 映射到新 ID', () => {
    const remap = buildRemap(oldRows, newRows, r => r.name)
    expect(remap.get(1)).toBe(5)
    expect(remap.get(2)).toBe(6)
  })

  it('新库无同名项时该旧 ID 不在映射中（返回 undefined）', () => {
    const remap = buildRemap(oldRows, newRows, r => r.name)
    expect(remap.get(9)).toBeUndefined()
  })

  it('未匹配旧 ID 清单可枚举', () => {
    const remap = buildRemap(oldRows, newRows, r => r.name)
    expect(remap.unmatchedOldIds()).toEqual([9])
  })
})
