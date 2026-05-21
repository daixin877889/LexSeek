import { writeFileSync } from 'node:fs'

export interface ExceptionRow {
  table: string
  oldId: number
  reason: string
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export class ExceptionCollector {
  private rows: ExceptionRow[] = []

  add(table: string, oldId: number, reason: string): void {
    this.rows.push({ table, oldId, reason })
  }

  count(): number {
    return this.rows.length
  }

  countByTable(table: string): number {
    return this.rows.filter(r => r.table === table).length
  }

  toCsv(): string {
    const header = 'table,old_id,reason'
    const body = this.rows.map(r => `${csvCell(r.table)},${csvCell(r.oldId)},${csvCell(r.reason)}`)
    return [header, ...body].join('\n')
  }

  /** 写入 reports/ 目录 */
  flush(filePath: string): void {
    writeFileSync(filePath, this.toCsv(), 'utf8')
  }
}
