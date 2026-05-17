import { describe, expect, it } from 'vitest'
import { parseExceptionCounts, rowCountVerdict } from '../../src/verify/helpers'

describe('parseExceptionCounts', () => {
  it('按表统计异常清单 CSV 的跳过行数', () => {
    const csv = 'table,old_id,reason\nusers,1,x\nusers,2,y\ncases,3,z'
    const m = parseExceptionCounts(csv)
    expect(m.get('users')).toBe(2)
    expect(m.get('cases')).toBe(1)
    expect(m.get('orders') ?? 0).toBe(0)
  })
  it('空清单（仅表头）返回空 Map', () => {
    expect(parseExceptionCounts('table,old_id,reason').size).toBe(0)
  })
})

describe('rowCountVerdict', () => {
  it('新行数 == 旧行数 - 跳过数 → ok', () => {
    expect(rowCountVerdict(100, 95, 5).status).toBe('ok')
  })
  it('不相等 → mismatch，detail 含差值', () => {
    const v = rowCountVerdict(100, 90, 5)
    expect(v.status).toBe('mismatch')
    expect(v.detail).toContain('5')
  })
})
