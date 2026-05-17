interface HasId {
  id: number
}

export interface Remap {
  /** 旧 ID → 新 ID；无映射返回 undefined */
  get: (oldId: number) => number | undefined
  /** 在新库找不到对应项的旧 ID 列表 */
  unmatchedOldIds: () => number[]
}

/**
 * 按自然键（keyFn，通常是 name）把旧配置表行映射到新配置表行。
 * 旧、新两侧 keyFn 取值相同的，建立 旧.id → 新.id 映射。
 */
export function buildRemap<TOld extends HasId, TNew extends HasId>(
  oldRows: TOld[],
  newRows: TNew[],
  keyFn: (row: TOld | TNew) => string,
): Remap {
  const newByKey = new Map<string, number>()
  for (const r of newRows) newByKey.set(keyFn(r), r.id)

  const map = new Map<number, number>()
  const unmatched: number[] = []
  for (const r of oldRows) {
    const newId = newByKey.get(keyFn(r))
    if (newId === undefined) unmatched.push(r.id)
    else map.set(r.id, newId)
  }

  return {
    get: oldId => map.get(oldId),
    unmatchedOldIds: () => [...unmatched],
  }
}
