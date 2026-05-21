import { describe, expect, it, vi } from 'vitest'
import { ExceptionCollector } from '../src/exceptions'
import { runMigration, type MigratorSpec, type RunnerDeps } from '../src/runner'

/** 进度表假对象：getLastId 恒返回 0，setProgress 记录调用 */
function fakeDb() {
  return {
    $executeRawUnsafe: vi.fn(async () => 0),
    $queryRawUnsafe: vi.fn(async () => [] as never[]),
  }
}

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    newDb: fakeDb(),
    exceptions: new ExceptionCollector(),
    batchSize: 2,
    failureRateThreshold: 0.5,
    ...over,
  }
}

type Old = { id: number; bad?: 'throw' | 'skip' }

/** 给定旧行集合，构造一个按 id 升序分批读取的 readBatch */
function readBatchOf(rows: Old[]) {
  return async (afterId: number, limit: number) =>
    rows.filter(r => r.id > afterId).slice(0, limit)
}

describe('runMigration', () => {
  it('全部成功：分批读取、写入、统计', async () => {
    const rows: Old[] = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const written: number[][] = []
    const spec: MigratorSpec<Old, number> = {
      table: 't',
      readBatch: readBatchOf(rows),
      oldId: o => o.id,
      transform: async o => ({ unit: o.id }),
      writeBatch: async units => { written.push(units) },
    }
    const r = await runMigration(spec, deps())
    expect(r.read).toBe(3)
    expect(r.succeeded).toBe(3)
    expect(r.skipped).toBe(0)
    expect([...r.migratedIds].sort()).toEqual([1, 2, 3])
    expect(written.flat()).toEqual([1, 2, 3])
  })

  it('行级错误：转换抛错 / 返回 skip 的行被跳过并记入异常清单，其余继续', async () => {
    const rows: Old[] = [{ id: 1 }, { id: 2, bad: 'throw' }, { id: 3, bad: 'skip' }, { id: 4 }]
    const exceptions = new ExceptionCollector()
    const spec: MigratorSpec<Old, number> = {
      table: 't',
      readBatch: readBatchOf(rows),
      oldId: o => o.id,
      transform: async o => {
        if (o.bad === 'throw') throw new Error('boom')
        if (o.bad === 'skip') return { skip: '业务规则跳过' }
        return { unit: o.id }
      },
      writeBatch: async () => {},
    }
    const r = await runMigration(spec, deps({ exceptions }))
    expect(r.succeeded).toBe(2)
    expect(r.skipped).toBe(2)
    expect(exceptions.countByTable('t')).toBe(2)
  })

  it('批级失败：writeBatch 整批抛错时降级逐行，隔离坏行', async () => {
    const rows: Old[] = [{ id: 1 }, { id: 2 }]
    const exceptions = new ExceptionCollector()
    const spec: MigratorSpec<Old, number> = {
      table: 't',
      readBatch: readBatchOf(rows),
      oldId: o => o.id,
      transform: async o => ({ unit: o.id }),
      // 整批（length>1）抛错；逐行（length===1）时 id=2 抛错
      writeBatch: async units => {
        if (units.length > 1) throw new Error('batch failed')
        if (units[0] === 2) throw new Error('row 2 bad')
      },
    }
    const r = await runMigration(spec, deps({ exceptions }))
    expect(r.succeeded).toBe(1)
    expect(r.skipped).toBe(1)
    expect(exceptions.countByTable('t')).toBe(1)
  })

  it('熔断：失败率超阈值时抛错中止', async () => {
    const rows: Old[] = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, bad: 'throw' as const }))
    const spec: MigratorSpec<Old, number> = {
      table: 't',
      readBatch: readBatchOf(rows),
      oldId: o => o.id,
      transform: async () => { throw new Error('always bad') },
      writeBatch: async () => {},
    }
    await expect(runMigration(spec, deps({ batchSize: 50 }))).rejects.toThrow(/失败率/)
  })
})
