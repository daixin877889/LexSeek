export class FkRegistry {
  private tables = new Map<string, Set<number>>()

  /** 登记某父表本次运行成功迁移的旧 ID 集合 */
  record(table: string, ids: Set<number>): void {
    const existing = this.tables.get(table)
    if (existing) for (const id of ids) existing.add(id)
    else this.tables.set(table, new Set(ids))
  }

  /** 某父表是否含该旧 ID */
  has(table: string, id: number): boolean {
    return this.tables.get(table)?.has(id) ?? false
  }

  /**
   * 校验一组外键引用是否全部存在。
   * 全部存在返回 null；任一缺失返回缺失原因字符串（供异常清单）。
   */
  requireAll(refs: [table: string, id: number][]): string | null {
    const missing = refs.filter(([t, id]) => !this.has(t, id)).map(([t, id]) => `${t}#${id}`)
    return missing.length === 0 ? null : `父行缺失：${missing.join('、')}`
  }
}
