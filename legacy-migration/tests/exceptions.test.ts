import { describe, expect, it } from 'vitest'
import { ExceptionCollector } from '../src/exceptions'

describe('ExceptionCollector', () => {
  it('累积异常并按表统计', () => {
    const c = new ExceptionCollector()
    c.add('users', 12, '唯一约束冲突：email')
    c.add('users', 30, '唯一约束冲突：email')
    c.add('cases', 5, '外键失配：caseTypeId')
    expect(c.count()).toBe(3)
    expect(c.countByTable('users')).toBe(2)
    expect(c.countByTable('orders')).toBe(0)
  })

  it('toCsv 输出表头与数据行', () => {
    const c = new ExceptionCollector()
    c.add('users', 12, '转换异常：boom')
    const csv = c.toCsv()
    expect(csv.split('\n')[0]).toBe('table,old_id,reason')
    expect(csv).toContain('users,12,转换异常：boom')
  })

  it('reason 含逗号或引号时按 CSV 规则转义', () => {
    const c = new ExceptionCollector()
    c.add('orders', 1, '原因,含逗号')
    expect(c.toCsv()).toContain('orders,1,"原因,含逗号"')
  })
})
