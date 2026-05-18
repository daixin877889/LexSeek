import type { ExceptionCollector } from './exceptions'
import { log } from './logger'
import { getLastId, type RawDb, setProgress } from './progress'

/** 转换输出：写入单元，或带原因的跳过 */
export type TransformOutput<TUnit> = { unit: TUnit } | { skip: string }

export interface MigratorSpec<TOld, TUnit> {
  /** 目标表名（同时作为进度 key 与异常清单分类名） */
  table: string
  /** 读取一批旧行：id > afterId，按 id 升序，最多 limit 条 */
  readBatch: (afterId: number, limit: number) => Promise<TOld[]>
  /** 取旧行主键 id */
  oldId: (old: TOld) => number
  /** 转换单行旧数据 → 写入单元或跳过 */
  transform: (old: TOld) => Promise<TransformOutput<TUnit>>
  /** 写入一批写入单元（内部决定写入哪些表） */
  writeBatch: (units: TUnit[]) => Promise<void>
  /** 单表熔断阈值覆盖；不设则用 RunnerDeps.failureRateThreshold。用于预期高跳过率的表 */
  failureRateThreshold?: number
}

export interface RunnerDeps {
  /** 新库（用于进度表读写） */
  newDb: RawDb
  /** 异常清单收集器 */
  exceptions: ExceptionCollector
  /** 每批行数 */
  batchSize: number
  /** 失败率熔断阈值（0~1） */
  failureRateThreshold: number
}

export interface MigrationResult {
  table: string
  read: number
  succeeded: number
  skipped: number
  /** 成功迁移的旧行 id 集合（供子表外键预校验，仅本次运行内有效） */
  migratedIds: Set<number>
}

/** 本批熔断检查的最小样本量——样本太小时失败率没有统计意义 */
const CIRCUIT_MIN_SAMPLE = 100

export async function runMigration<TOld, TUnit>(
  spec: MigratorSpec<TOld, TUnit>,
  deps: RunnerDeps,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    table: spec.table,
    read: 0,
    succeeded: 0,
    skipped: 0,
    migratedIds: new Set<number>(),
  }

  let afterId = await getLastId(deps.newDb, spec.table)
  log(`[${spec.table}] 开始迁移，从 id > ${afterId}`)

  for (;;) {
    // ③ 致命错误：readBatch 抛出的异常不在此 catch，向上传播 → 编排层中止、可 --resume
    const oldRows = await spec.readBatch(afterId, deps.batchSize)
    if (oldRows.length === 0) break
    result.read += oldRows.length

    // ① 行级转换：单行失败只跳过该行
    const units: { unit: TUnit; oldId: number }[] = []
    for (const old of oldRows) {
      const id = spec.oldId(old)
      try {
        const out = await spec.transform(old)
        if ('skip' in out) {
          result.skipped++
          deps.exceptions.add(spec.table, id, out.skip)
        } else {
          units.push({ unit: out.unit, oldId: id })
        }
      } catch (e) {
        result.skipped++
        deps.exceptions.add(spec.table, id, `转换异常：${(e as Error).message}`)
      }
    }

    // ② 批级失败：整批写入失败时降级为逐行写入，隔离坏行
    if (units.length > 0) {
      try {
        await spec.writeBatch(units.map(u => u.unit))
        for (const u of units) {
          result.succeeded++
          result.migratedIds.add(u.oldId)
        }
      } catch {
        log(`[${spec.table}] 批量写入失败，降级逐行插入定位坏行`)
        for (const u of units) {
          try {
            await spec.writeBatch([u.unit])
            result.succeeded++
            result.migratedIds.add(u.oldId)
          } catch (e) {
            result.skipped++
            deps.exceptions.add(spec.table, u.oldId, `写入失败：${(e as Error).message}`)
          }
        }
      }
    }

    afterId = spec.oldId(oldRows[oldRows.length - 1]!)
    await setProgress(deps.newDb, spec.table, afterId, 'running')

    // ④ 熔断：失败率异常高通常意味脚本 bug，主动中止
    const threshold = spec.failureRateThreshold ?? deps.failureRateThreshold
    if (
      result.read >= CIRCUIT_MIN_SAMPLE &&
      result.skipped / result.read > threshold
    ) {
      throw new Error(
        `[${spec.table}] 失败率 ${(result.skipped / result.read * 100).toFixed(1)}% ` +
        `超过阈值 ${(threshold * 100).toFixed(0)}%，疑似脚本 bug，已中止`,
      )
    }
  }

  await setProgress(deps.newDb, spec.table, afterId, 'done')
  log(`[${spec.table}] 完成：读取 ${result.read} / 成功 ${result.succeeded} / 跳过 ${result.skipped}`)
  return result
}
