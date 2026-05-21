import { describe, expect, it } from 'vitest'
import { FkRegistry } from '../src/fkRegistry'

describe('FkRegistry', () => {
  it('登记并查询父表已迁移 ID', () => {
    const reg = new FkRegistry()
    reg.record('users', new Set([1, 2, 3]))
    expect(reg.has('users', 2)).toBe(true)
    expect(reg.has('users', 9)).toBe(false)
  })
  it('未登记的表查询返回 false', () => {
    const reg = new FkRegistry()
    expect(reg.has('cases', 1)).toBe(false)
  })
  it('requireAll：全部存在返回 null，缺失返回原因', () => {
    const reg = new FkRegistry()
    reg.record('users', new Set([1]))
    reg.record('cases', new Set([10]))
    expect(reg.requireAll([['users', 1], ['cases', 10]])).toBeNull()
    expect(reg.requireAll([['users', 1], ['cases', 99]])).toMatch(/cases#99/)
  })
})
