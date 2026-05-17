/** 解析异常清单 CSV，按表统计被跳过的行数 */
export function parseExceptionCounts(csv: string): Map<string, number> {
  const m = new Map<string, number>()
  const lines = csv.split('\n').slice(1) // 跳过表头
  for (const line of lines) {
    if (!line.trim()) continue
    // table 是第一列（不含逗号）
    const table = line.slice(0, line.indexOf(','))
    m.set(table, (m.get(table) ?? 0) + 1)
  }
  return m
}

export interface CountVerdict {
  status: 'ok' | 'mismatch'
  detail: string
}

/** 行数判定：新库行数应等于 旧库行数 − 跳过数 */
export function rowCountVerdict(oldCount: number, newCount: number, skipped: number): CountVerdict {
  const expected = oldCount - skipped
  if (newCount === expected) {
    return { status: 'ok', detail: `旧 ${oldCount} − 跳过 ${skipped} = 新 ${newCount}` }
  }
  return {
    status: 'mismatch',
    detail: `旧 ${oldCount} − 跳过 ${skipped} = 期望 ${expected}，实际新库 ${newCount}，差 ${newCount - expected}`,
  }
}
